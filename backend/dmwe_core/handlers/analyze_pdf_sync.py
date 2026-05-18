from __future__ import annotations

import base64
import io
import json
import traceback
from typing import Any, Optional, Tuple, Union

from dmwe_core.llm.client import (
    dependency_extraction_model,
    get_openai_client,
    task_extraction_model,
)
from dmwe_core.llm.prompt_loader import load_prompt
from dmwe_core.llm.schema import DEPENDENCIES_ROOT_JSON_SCHEMA, TASKS_ROOT_JSON_SCHEMA
from dmwe_core.llm.structured_chat import completion_parse_json_with_retry
from dmwe_core.utils.logger import get_logger
from dmwe_core.workflow_v2 import enrich_workflow_v2, workflow_root_extras
from dmwe_core.workers.extraction_evidence import (
    ensure_dependency_evidence,
    ensure_task_evidence,
)

logger = get_logger(__name__)


def run_analyze_pdf(request_body: Optional[dict[str, Any]]) -> Union[dict, Tuple[dict, int]]:
    """
    Synchronous full-document extraction (sync API path; not Batch).
    Returns a result dict, or (error_body, status_code) on error.
    """
    logger.info("PDF analysis handler invoked")
    if not request_body:
        logger.warning("Invalid request: Request body is missing")
        return {"error": "PDF data is required"}, 400

    pdf_items: list[dict] = []

    files_payload = request_body.get("files")
    if isinstance(files_payload, list) and files_payload:
        for item in files_payload:
            if not isinstance(item, dict):
                continue
            base64_data = item.get("pdf_data")
            if not base64_data:
                continue
            filename = item.get("filename") or "地域防災計画.pdf"
            try:
                logger.info("Decoding PDF data for %s", filename)
                pdf_bytes = base64.b64decode(base64_data)
                logger.info("Decoded %s, size: %d bytes", filename, len(pdf_bytes))
            except Exception as e:
                logger.error("Failed to decode PDF data for %s: %s", filename, str(e))
                return {"error": f"Invalid PDF data for {filename}: {str(e)}"}, 400
            pdf_items.append({"filename": filename, "data": pdf_bytes})

    elif "pdf_data" in request_body:
        filename = request_body.get("filename", "地域防災計画.pdf")
        try:
            logger.info("Decoding single PDF data for %s", filename)
            pdf_bytes = base64.b64decode(request_body.get("pdf_data"))
            logger.info("Decoded %s, size: %d bytes", filename, len(pdf_bytes))
        except Exception as e:
            logger.error("Failed to decode PDF data: %s", str(e))
            return {"error": f"Invalid PDF data: {str(e)}"}, 400
        pdf_items.append({"filename": filename, "data": pdf_bytes})

    if not pdf_items:
        logger.warning("No valid PDF data found in request")
        return {"error": "PDF data is required"}, 400

    try:
        client = get_openai_client()
        uploaded_files: list[dict] = []
        for item in pdf_items:
            pdf_file = io.BytesIO(item["data"])
            pdf_file.name = item["filename"]
            logger.info("Uploading PDF file to OpenAI: %s", pdf_file.name)
            upload_response = client.files.create(
                file=pdf_file,
                purpose="user_data",
            )
            uploaded_files.append(
                {
                    "filename": item["filename"],
                    "file_id": upload_response.id,
                }
            )
        logger.info("Uploaded %d files to OpenAI", len(uploaded_files))

        file_names_str = ", ".join(f["filename"] for f in uploaded_files)
        attachments = [
            {
                "file_id": f["file_id"],
                "tools": [{"type": "code_interpreter"}],
            }
            for f in uploaded_files
        ]

        logger.info("Calling OpenAI for task extraction")
        task_system_prompt = f"""対象となるPDFファイル: {file_names_str}

{load_prompt("task_extraction")}
"""

        task_user_message = "防災計画PDF群から災害対応タスクを抽出し、指定のJSONフォーマットで返してください。"

        task_json = completion_parse_json_with_retry(
            model=task_extraction_model(),
            messages=[
                {"role": "system", "content": task_system_prompt},
                {
                    "role": "user",
                    "content": task_user_message,
                    "attachments": attachments,
                },
            ],
            json_schema=TASKS_ROOT_JSON_SCHEMA,
            expected_root_key="tasks",
            client=client,
        )

        tasks = task_json.get("tasks", [])
        for t in tasks:
            ensure_task_evidence(t)
        tasks, _ = enrich_workflow_v2(tasks, [])

        logger.info("Calling OpenAI for dependency extraction")
        tasks_json_text = json.dumps({"tasks": tasks}, ensure_ascii=False)

        dependency_system_prompt = f"""対象となるPDFファイル: {file_names_str}

以下のタスク一覧(JSON)に対して、タスク同士の依存関係を抽出してください:
{tasks_json_text}

{load_prompt("dependency_extraction")}
"""

        dependency_user_message = "上記タスク間の依存関係を、指定のJSONフォーマットで抽出してください。"

        dependency_json = completion_parse_json_with_retry(
            model=dependency_extraction_model(),
            messages=[
                {"role": "system", "content": dependency_system_prompt},
                {
                    "role": "user",
                    "content": dependency_user_message,
                    "attachments": attachments,
                },
            ],
            json_schema=DEPENDENCIES_ROOT_JSON_SCHEMA,
            expected_root_key="dependencies",
            client=client,
        )

        dependencies = dependency_json.get("dependencies", [])
        for d in dependencies:
            ensure_dependency_evidence(d)
        _, dependencies = enrich_workflow_v2([], dependencies)

        primary_file_id = uploaded_files[0]["file_id"] if uploaded_files else None

        return {
            "tasks": tasks,
            "dependencies": dependencies,
            "files": uploaded_files,
            "file_id": primary_file_id,
            **workflow_root_extras(),
        }
    except Exception as e:
        error_msg = f"OpenAI API error: {str(e)}"
        logger.error("%s\n%s", error_msg, traceback.format_exc())
        return {"error": f"OpenAI API error: {str(e)}"}, 500
