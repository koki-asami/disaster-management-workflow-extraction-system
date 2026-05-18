from __future__ import annotations

import io
import json
import os
import time

import boto3

from dmwe_core.llm.batch_client import (
    build_chat_batch_line,
    download_file_text,
    get_batch_status,
    normalize_openai_batch_status,
    parse_chat_batch_output,
    submit_jsonl_batch,
    summarize_batch_error_file,
)
from dmwe_core.llm.client import (
    dependency_extraction_model,
    get_openai_client,
    task_extraction_model,
)
from dmwe_core.llm.prompt_loader import load_prompt
from dmwe_core.llm.schema import (
    DEPENDENCIES_ROOT_JSON_SCHEMA,
    TASKS_ROOT_JSON_SCHEMA,
)
from dmwe_core.llm.structured_chat import completion_parse_json_with_retry
from dmwe_core.utils.database import save_job_result, update_job_progress
from dmwe_core.utils.logger import get_logger
from dmwe_core.utils.s3_storage import BUCKET_NAME
from dmwe_core.workflow_v2 import enrich_workflow_v2, workflow_root_extras
from dmwe_core.workers.extraction_evidence import (
    consume_cancel_if_requested,
    ensure_dependency_evidence,
    ensure_task_evidence,
)
from dmwe_core.workers.pdf_text import extract_text_by_page_from_s3

logger = get_logger(__name__)
s3_client = boto3.client("s3")

# 分割処理用: 1回のLLM呼び出しあたりのページ数・1ページあたりの最大文字数
PAGES_PER_CHUNK = 50
MAX_CHARS_PER_PAGE = 5000

# 依存関係抽出: 1回のLLM呼び出しあたりのタスク数（超過時はオーバーラップ付きチャンク分割）
TASKS_PER_DEPENDENCY_CHUNK = 80
DEPENDENCY_CHUNK_OVERLAP = 20

# 依存抽出用プロンプトは、保存用の詳細タスクから必要最小限だけを渡す。
# evidence をそのまま全件渡すと大規模計画で Batch の context limit を超える。
DEPENDENCY_REGISTRY_SCOPE_CHARS = 120
DEPENDENCY_CHUNK_DESCRIPTION_CHARS = 220
DEPENDENCY_CHUNK_EVIDENCE_CHARS = 180
DEPENDENCY_CHUNK_SNIPPET_CHARS = 160


def _extraction_mode() -> str:
    mode = os.environ.get("EXTRACTION_MODE", "batch").lower().strip()
    return "sync" if mode == "sync" else "batch"


def _structured_outputs_enabled() -> bool:
    return os.environ.get("USE_STRUCTURED_LLM_OUTPUTS", "1").lower() not in (
        "0",
        "false",
        "no",
    )


def _batch_poll_seconds() -> float:
    return float(os.environ.get("BATCH_POLL_SECONDS", "30"))


def _batch_timeout_seconds() -> float:
    return float(os.environ.get("BATCH_TIMEOUT_SECONDS", "86400"))


def _task_schema() -> dict | None:
    return TASKS_ROOT_JSON_SCHEMA if _structured_outputs_enabled() else None


def _dependency_schema() -> dict | None:
    return DEPENDENCIES_ROOT_JSON_SCHEMA if _structured_outputs_enabled() else None


def _pages_flat(doc_summaries: list[dict]) -> list[dict]:
    pages: list[dict] = []
    for doc in doc_summaries:
        for p in doc["pages"]:
            pages.append(
                {
                    "filename": doc["filename"],
                    "object_key": doc["object_key"],
                    "page_index": p["page_index"],
                    "text": p["text"],
                }
            )
    return pages


def _chunk_documents(chunk_pages: list[dict]) -> list[dict]:
    docs_in_chunk: dict[tuple[str, str], dict] = {}
    for p in chunk_pages:
        key = (p["filename"], p["object_key"])
        if key not in docs_in_chunk:
            docs_in_chunk[key] = {
                "filename": p["filename"],
                "object_key": p["object_key"],
                "pages": [],
            }
        docs_in_chunk[key]["pages"].append(
            {
                "page_index": p["page_index"],
                "text": p["text"],
            }
        )
    return list(docs_in_chunk.values())


def _dedupe_tasks(raw_tasks: list[dict]) -> list[dict]:
    deduped_tasks: list[dict] = []
    index_by_key: dict[tuple[str, str], int] = {}

    for t in raw_tasks:
        name = (t.get("name") or "").strip()
        department = (t.get("department") or "").strip()
        ctx = t.get("context_snippets") or []
        if isinstance(ctx, str):
            ctx = [ctx]
        t["context_snippets"] = ctx
        ensure_task_evidence(t)

        if not name:
            deduped_tasks.append(t)
            continue

        canonical_name = (t.get("canonical_name") or name).strip()
        key = (canonical_name.lower(), department.lower())
        if key not in index_by_key:
            index_by_key[key] = len(deduped_tasks)
            deduped_tasks.append(t)
            continue

        existing = deduped_tasks[index_by_key[key]]
        existing_desc = existing.get("description")
        new_desc = t.get("description")
        if new_desc and new_desc != existing_desc:
            if existing_desc:
                if new_desc not in existing_desc:
                    existing["description"] = f"{existing_desc} / {new_desc}"
            else:
                existing["description"] = new_desc

        ctx1 = existing.get("context_snippets") or []
        if isinstance(ctx1, str):
            ctx1 = [ctx1]
        merged_ctx: list[str] = []
        for s in ctx1 + ctx:
            if s and s not in merged_ctx:
                merged_ctx.append(s)
        existing["context_snippets"] = merged_ctx[:5]

        ev1 = existing.get("evidence") or []
        ev2 = t.get("evidence") or []
        if isinstance(ev1, dict):
            ev1 = [ev1]
        if isinstance(ev2, dict):
            ev2 = [ev2]
        merged_ev: list[dict] = []
        seen_q: set[str] = set()
        for x in ev1 + ev2:
            if not isinstance(x, dict):
                continue
            q = (x.get("source_quote") or "").strip()
            if q and q not in seen_q:
                seen_q.add(q)
                merged_ev.append(x)
        existing["evidence"] = merged_ev[:8]

    for i, t in enumerate(deduped_tasks):
        ensure_task_evidence(t)
        t["id"] = f"t{i + 1:03d}"
    normalized_tasks, _ = enrich_workflow_v2(deduped_tasks, [])
    return normalized_tasks


def _dependency_chunks(tasks: list[dict]) -> list[list[dict]]:
    if len(tasks) <= TASKS_PER_DEPENDENCY_CHUNK:
        return [tasks]

    chunks = []
    start = 0
    step = max(1, TASKS_PER_DEPENDENCY_CHUNK - DEPENDENCY_CHUNK_OVERLAP)
    while start < len(tasks):
        end = min(start + TASKS_PER_DEPENDENCY_CHUNK, len(tasks))
        chunks.append(tasks[start:end])
        if end >= len(tasks):
            break
        start += step
    return chunks


def _truncate_text(value: object, max_chars: int) -> str:
    text = str(value or "").replace("\n", " ").strip()
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}..."


def _compact_actor(task: dict) -> dict:
    actor = task.get("actor") if isinstance(task.get("actor"), dict) else {}
    return {
        "org_level": actor.get("org_level") or "",
        "org_name_normalized": actor.get("org_name_normalized") or "",
        "department_normalized": actor.get("department_normalized")
        or task.get("department")
        or "",
    }


def _first_text_items(value: object, *, limit: int, max_chars: int) -> list[str]:
    items = value if isinstance(value, list) else ([value] if value else [])
    output: list[str] = []
    for item in items:
        text = _truncate_text(item, max_chars)
        if text:
            output.append(text)
        if len(output) >= limit:
            break
    return output


def _evidence_quotes(task: dict, *, limit: int = 1) -> list[str]:
    evidence = task.get("evidence") or []
    if isinstance(evidence, dict):
        evidence = [evidence]
    quotes = []
    for ev in evidence:
        if not isinstance(ev, dict):
            continue
        quote = _truncate_text(ev.get("source_quote"), DEPENDENCY_CHUNK_EVIDENCE_CHARS)
        if quote:
            quotes.append(quote)
        if len(quotes) >= limit:
            break
    return quotes


def _compact_dependency_task(task: dict, *, include_context: bool) -> dict:
    compact = {
        "id": task.get("id"),
        "name": _truncate_text(task.get("name"), 80),
        "canonical_name": _truncate_text(task.get("canonical_name"), 80),
        "phase": task.get("phase") or "",
        "workstream": task.get("workstream") or "",
        "category": _truncate_text(task.get("category"), 80),
        "department": _truncate_text(task.get("department"), 80),
        "actor": _compact_actor(task),
        "action": _truncate_text(task.get("action"), 40),
        "object": _truncate_text(task.get("object"), 60),
        "scope": _truncate_text(task.get("scope") or task.get("description"), DEPENDENCY_REGISTRY_SCOPE_CHARS),
    }
    if include_context:
        compact.update(
            {
                "description": _truncate_text(
                    task.get("description"), DEPENDENCY_CHUNK_DESCRIPTION_CHARS
                ),
                "source_pdf": _truncate_text(task.get("source_pdf"), 80),
                "page_range": _truncate_text(task.get("page_range"), 30),
                "context_snippets": _first_text_items(
                    task.get("context_snippets"),
                    limit=1,
                    max_chars=DEPENDENCY_CHUNK_SNIPPET_CHARS,
                ),
                "evidence_quotes": _evidence_quotes(task, limit=1),
            }
        )
    return compact


def _dependency_registry_payload(tasks: list[dict]) -> dict:
    return {
        "tasks": [
            _compact_dependency_task(task, include_context=False)
            for task in tasks
            if task.get("id")
        ]
    }


def _dependency_chunk_payload(chunk_tasks: list[dict]) -> dict:
    return {
        "tasks": [
            _compact_dependency_task(task, include_context=True)
            for task in chunk_tasks
            if task.get("id")
        ]
    }


def _merge_dependencies(raw_dependencies: list[dict], tasks: list[dict]) -> list[dict]:
    task_ids = {t.get("id") for t in tasks if t.get("id")}
    dependencies: list[dict] = []
    seen_dep_keys: set[tuple[str, str]] = set()
    for dep in raw_dependencies:
        from_id = dep.get("from")
        to_id = dep.get("to")
        if not from_id or not to_id:
            continue
        if from_id not in task_ids or to_id not in task_ids:
            continue
        ensure_dependency_evidence(dep)
        key = (from_id, to_id)
        if key in seen_dep_keys:
            continue
        seen_dep_keys.add(key)
        dependencies.append(dep)
    _, normalized_dependencies = enrich_workflow_v2([], dependencies)
    return normalized_dependencies


def _save_result_payload(
    *,
    job_id: str,
    tasks: list[dict],
    dependencies: list[dict],
    all_docs: list[dict],
    uploaded_files: list[dict],
    primary_file_id: str | None,
    total_pages: int,
) -> None:
    deps_by_task: dict[str, list[str]] = {}
    for dep in dependencies:
        from_id = dep.get("from")
        to_id = dep.get("to")
        if from_id and to_id:
            deps_by_task.setdefault(to_id, []).append(from_id)

    enriched_tasks: list[dict] = []
    for t in tasks:
        tid = t.get("id")
        if not tid:
            enriched_tasks.append(t)
            continue
        t_copy = dict(t)
        t_copy["dependencies"] = deps_by_task.get(tid, [])
        enriched_tasks.append(t_copy)

    update_job_progress(
        job_id,
        status="processing",
        phase="finalizing",
        detail="結果を保存・可視化用データに整形中",
        progress=97,
        phase_unit="tasks",
        phase_current=len(tasks),
        phase_total=len(tasks),
    )
    result_payload = {
        "job_id": job_id,
        "tasks": enriched_tasks,
        "dependencies": dependencies,
        "documents": [
            {
                "filename": d["filename"],
                "object_key": d["object_key"],
            }
            for d in all_docs
        ],
        "files": uploaded_files,
        "file_id": primary_file_id,
        **workflow_root_extras(),
    }

    result_key = f"extractions/{job_id}.json"
    s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=result_key,
        Body=json.dumps(result_payload, ensure_ascii=False),
        ContentType="application/json",
    )
    logger.info("Saved extraction result for job %s to s3://%s/%s", job_id, BUCKET_NAME, result_key)

    summary = {
        "task_count": len(tasks),
        "dependency_count": len(dependencies),
        "document_count": len(all_docs),
    }
    save_job_result(job_id, result_s3_key=result_key, summary=summary)
    update_job_progress(
        job_id,
        processed_pages=total_pages,
        total_pages=total_pages,
        status="completed",
        phase="completed",
        detail="完了",
        progress=100,
        phase_unit="tasks",
        phase_current=len(tasks),
        phase_total=len(tasks),
    )


def _poll_batch_until_done(
    *,
    job_id: str,
    batch_id: str,
    phase: str,
    detail: str,
    progress_start: int,
    progress_done: int,
) -> dict:
    def _request_count_kwargs(status_payload: dict) -> dict:
        request_counts = status_payload.get("request_counts") or {}
        kwargs: dict = {}
        if request_counts.get("total") is not None:
            kwargs["openai_batch_request_total"] = request_counts["total"]
        if request_counts.get("completed") is not None:
            kwargs["openai_batch_request_completed"] = request_counts["completed"]
        if request_counts.get("failed") is not None:
            kwargs["openai_batch_request_failed"] = request_counts["failed"]
        return kwargs

    deadline = time.monotonic() + _batch_timeout_seconds()
    last_status: dict | None = None
    while time.monotonic() < deadline:
        if consume_cancel_if_requested(job_id):
            return {"id": batch_id, "status": "cancelled", "output_file_id": None}
        status = get_batch_status(batch_id)
        last_status = status
        mapped = normalize_openai_batch_status(
            status.get("status"),
            phase=phase,
            progress_start=progress_start,
            progress_done=progress_done,
        )
        update_job_progress(
            job_id,
            detail=detail,
            batch_id=batch_id,
            **mapped,
            **_request_count_kwargs(status),
        )
        if status["status"] in ("completed", "failed", "cancelled", "expired"):
            return status
        time.sleep(_batch_poll_seconds())

    mapped = normalize_openai_batch_status(
        "timeout",
        phase=phase,
        progress_start=progress_start,
        progress_done=progress_done,
    )
    update_job_progress(
        job_id,
        detail=f"{detail}がタイムアウトしました",
        batch_id=batch_id,
        **mapped,
        **_request_count_kwargs(last_status or {}),
    )
    return last_status or {"id": batch_id, "status": "timeout", "output_file_id": None}


def _batch_error_detail(status: dict, default_detail: str) -> tuple[str, str]:
    openai_status = str(status.get("status") or "unknown")
    counts = status.get("request_counts") or {}
    failed = counts.get("failed")
    completed = counts.get("completed")
    total = counts.get("total")
    count_text = ""
    if any(v is not None for v in (total, completed, failed)):
        count_text = f" request_counts(total={total}, completed={completed}, failed={failed})."

    error_file_id = status.get("error_file_id")
    if error_file_id:
        try:
            item_errors = summarize_batch_error_file(str(error_file_id))
            return (
                "openai_batch_item_errors",
                f"{default_detail}: OpenAI Batch status={openai_status}.{count_text} {item_errors}",
            )
        except Exception as e:
            return (
                "openai_batch_item_errors",
                (
                    f"{default_detail}: OpenAI Batch status={openai_status}.{count_text} "
                    f"Failed to read error_file_id={error_file_id}: {e}"
                ),
            )

    if openai_status == "completed" and not status.get("output_file_id"):
        return (
            "openai_batch_no_output",
            f"{default_detail}: OpenAI Batch completed but output_file_id was empty.{count_text}",
        )
    return (
        f"openai_batch_{openai_status}",
        f"{default_detail}: OpenAI Batch status={openai_status}.{count_text}",
    )


def _missing_custom_ids(results: dict[str, dict], prefix: str, count: int) -> list[str]:
    return [f"{prefix}-{i}" for i in range(count) if f"{prefix}-{i}" not in results]


def _run_batch_extraction_and_save(
    *,
    job_id: str,
    all_docs: list[dict],
    doc_summaries: list[dict],
    uploaded_files: list[dict],
    primary_file_id: str | None,
    file_names_str: str,
    total_pages: int,
) -> None:
    all_pages_flat = _pages_flat(doc_summaries)
    num_chunks = (len(all_pages_flat) + PAGES_PER_CHUNK - 1) // PAGES_PER_CHUNK
    task_prompt_base = load_prompt("task_extraction")
    task_lines: list[str] = []
    for chunk_idx in range(num_chunks):
        start = chunk_idx * PAGES_PER_CHUNK
        end = min(start + PAGES_PER_CHUNK, len(all_pages_flat))
        chunk_docs = _chunk_documents(all_pages_flat[start:end])
        context_json = json.dumps({"documents": chunk_docs}, ensure_ascii=False)
        system_prompt = f"""対象となるPDFファイル: {file_names_str}

### コンテキストJSON（チャンク {chunk_idx + 1}/{num_chunks}）
{context_json}

{task_prompt_base}
"""
        task_lines.append(
            build_chat_batch_line(
                custom_id=f"task-{chunk_idx}",
                model=task_extraction_model(),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": "防災計画PDF群から災害対応タスクを抽出し、指定のJSONフォーマットで返してください。",
                    },
                ],
                json_schema=_task_schema(),
            )
        )

    update_job_progress(
        job_id,
        status="processing",
        phase="task_extraction",
        detail=f"OpenAI Batchにタスク抽出を投入中（{num_chunks}チャンク）",
        progress=60,
        phase_unit="chunks",
        phase_current=0,
        phase_total=num_chunks,
    )
    task_batch_id = submit_jsonl_batch(("\n".join(task_lines) + "\n").encode("utf-8"))
    task_status = _poll_batch_until_done(
        job_id=job_id,
        batch_id=task_batch_id,
        phase="task_extraction",
        detail="OpenAI Batchでタスク抽出中",
        progress_start=60,
        progress_done=80,
    )
    if task_status.get("status") != "completed" or not task_status.get("output_file_id"):
        error_code, error_detail = _batch_error_detail(
            task_status,
            "Task extraction batch did not produce usable output",
        )
        update_job_progress(
            job_id,
            status="failed" if task_status.get("status") != "cancelled" else "cancelled",
            phase="task_extraction",
            progress=80,
            openai_batch_status=str(task_status.get("status")),
            error_code=error_code,
            error_detail=error_detail,
        )
        return

    task_output = download_file_text(str(task_status["output_file_id"]))
    task_results = parse_chat_batch_output(task_output, expected_root_key="tasks")
    missing_task_ids = _missing_custom_ids(task_results, "task", num_chunks)
    if missing_task_ids:
        error_code, error_detail = _batch_error_detail(
            task_status,
            f"Task extraction batch is missing output for {', '.join(missing_task_ids[:5])}",
        )
        update_job_progress(
            job_id,
            status="failed",
            phase="task_extraction",
            progress=80,
            batch_id=task_batch_id,
            openai_batch_status=str(task_status.get("status")),
            error_code=error_code,
            error_detail=error_detail,
        )
        return
    all_raw_tasks: list[dict] = []
    for chunk_idx in range(num_chunks):
        chunk_tasks = task_results.get(f"task-{chunk_idx}", {}).get("tasks", [])
        for t in chunk_tasks:
            ensure_task_evidence(t)
            tid = t.get("id")
            if tid and not str(tid).startswith("chunk"):
                t["id"] = f"chunk{chunk_idx}_{tid}"
        all_raw_tasks.extend(chunk_tasks)

    tasks = _dedupe_tasks(all_raw_tasks)
    update_job_progress(
        job_id,
        status="processing",
        phase="task_extraction",
        detail=f"タスク抽出完了（{len(tasks)}件）",
        progress=80,
        phase_unit="tasks",
        phase_current=len(tasks),
        phase_total=len(tasks),
        batch_id=task_batch_id,
        openai_batch_status="completed",
    )

    if consume_cancel_if_requested(job_id):
        return

    dep_chunks = _dependency_chunks(tasks)
    full_task_registry = json.dumps(_dependency_registry_payload(tasks), ensure_ascii=False)
    dep_prompt_base = load_prompt("dependency_extraction")
    dep_lines: list[str] = []
    for dep_idx, chunk_tasks in enumerate(dep_chunks):
        tasks_json_text = json.dumps(
            _dependency_chunk_payload(chunk_tasks), ensure_ascii=False
        )
        system_prompt = f"""対象となるPDFファイル: {file_names_str}

### 全文書タスクレジストリ（圧縮版・章横断/別チャンクのタスク ID 参照用）
{full_task_registry}

### 依存抽出対象タスク部分集合(JSON・短い根拠抜粋付き)（{dep_idx + 1}/{len(dep_chunks)}）
{tasks_json_text}

{dep_prompt_base}
"""
        dep_lines.append(
            build_chat_batch_line(
                custom_id=f"dep-{dep_idx}",
                model=dependency_extraction_model(),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": "上記タスク間の依存関係を、指定のJSONフォーマットで抽出してください。",
                    },
                ],
                json_schema=_dependency_schema(),
            )
        )

    update_job_progress(
        job_id,
        status="processing",
        phase="dependency_extraction",
        detail=f"OpenAI Batchに依存関係抽出を投入中（{len(dep_chunks)}チャンク）",
        progress=80,
        phase_unit="chunks",
        phase_current=0,
        phase_total=len(dep_chunks),
    )
    dep_batch_id = submit_jsonl_batch(("\n".join(dep_lines) + "\n").encode("utf-8"))
    dep_status = _poll_batch_until_done(
        job_id=job_id,
        batch_id=dep_batch_id,
        phase="dependency_extraction",
        detail="OpenAI Batchで依存関係抽出中",
        progress_start=80,
        progress_done=95,
    )
    if dep_status.get("status") != "completed" or not dep_status.get("output_file_id"):
        error_code, error_detail = _batch_error_detail(
            dep_status,
            "Dependency extraction batch did not produce usable output",
        )
        update_job_progress(
            job_id,
            status="failed" if dep_status.get("status") != "cancelled" else "cancelled",
            phase="dependency_extraction",
            progress=95,
            batch_id=dep_batch_id,
            openai_batch_status=str(dep_status.get("status")),
            error_code=error_code,
            error_detail=error_detail,
        )
        return

    dep_output = download_file_text(str(dep_status["output_file_id"]))
    dep_results = parse_chat_batch_output(dep_output, expected_root_key="dependencies")
    missing_dep_ids = _missing_custom_ids(dep_results, "dep", len(dep_chunks))
    if missing_dep_ids:
        error_code, error_detail = _batch_error_detail(
            dep_status,
            f"Dependency extraction batch is missing output for {', '.join(missing_dep_ids[:5])}",
        )
        update_job_progress(
            job_id,
            status="failed",
            phase="dependency_extraction",
            progress=95,
            batch_id=dep_batch_id,
            openai_batch_status=str(dep_status.get("status")),
            error_code=error_code,
            error_detail=error_detail,
        )
        return
    all_raw_dependencies: list[dict] = []
    for dep_idx in range(len(dep_chunks)):
        all_raw_dependencies.extend(
            dep_results.get(f"dep-{dep_idx}", {}).get("dependencies", [])
        )
    dependencies = _merge_dependencies(all_raw_dependencies, tasks)
    update_job_progress(
        job_id,
        status="processing",
        phase="dependency_extraction",
        detail=f"依存関係抽出完了（{len(dependencies)}件）",
        progress=95,
        phase_unit="tasks",
        phase_current=len(tasks),
        phase_total=len(tasks),
        batch_id=dep_batch_id,
        openai_batch_status="completed",
    )

    if consume_cancel_if_requested(job_id):
        return

    _save_result_payload(
        job_id=job_id,
        tasks=tasks,
        dependencies=dependencies,
        all_docs=all_docs,
        uploaded_files=uploaded_files,
        primary_file_id=primary_file_id,
        total_pages=total_pages,
    )


def extraction_worker(event, context):
    """
    SQS からトリガーされる非同期ワーカー。

    期待するメッセージボディ:
        {
          "job_id": "<JOB_ID>",
          "uploads": [
            {
              "upload_id": "...",
              "object_key": "uploads/....pdf",
              "filename": "xxx.pdf"
            },
            ...
          ]
        }
    """
    logger.info("extraction_worker invoked with event: %s", json.dumps(event))

    # SQS イベントの場合 Records 配列内の body にペイロードが入る
    records = event.get("Records", [])
    if not records:
        logger.warning("No Records in event for extraction_worker")
        return {"status": "no_records"}

    for record in records:
        try:
            body_str = record.get("body", "")
            logger.info("Processing SQS message body: %s", body_str)
            body = json.loads(body_str)
        except Exception as e:
            logger.error("Failed to parse SQS message body: %s", str(e))
            continue

        job_id = body.get("job_id")
        uploads = body.get("uploads") or []

        if not job_id or not uploads:
            logger.warning("Invalid message: missing job_id or uploads")
            continue

        client = get_openai_client()

        # ページ総数の計算とテキスト抽出
        all_docs: list[dict] = []  # [{upload_id, filename, object_key, pages: [{page_index,text}, ...]}, ...]
        total_pages = 0

        for item in uploads:
            object_key = item.get("object_key")
            upload_id = item.get("upload_id")
            filename = item.get("filename") or object_key

            if not object_key:
                logger.warning("Upload item missing object_key: %s", item)
                continue

            pages = extract_text_by_page_from_s3(object_key)
            total_pages += len(pages)
            all_docs.append(
                {
                    "upload_id": upload_id,
                    "filename": filename,
                    "object_key": object_key,
                    "pages": pages,
                }
            )

        if total_pages == 0:
            logger.warning("No pages found for job %s", job_id)
            update_job_progress(job_id, processed_pages=0, total_pages=0, status="failed")
            continue

        # 進捗配分（全体 0-100 のうち、各フェーズに割り当て）
        # - テキスト抽出: 0-60（ページ進捗に比例）
        # - タスク抽出: 60-80
        # - 依存関係抽出: 80-95
        # - 整形/保存: 95-100
        processed_pages = 0
        update_job_progress(
            job_id,
            processed_pages=0,
            total_pages=total_pages,
            status="processing",
            phase="text_extraction",
            detail="PDFのテキスト抽出中",
            progress=0,
            phase_unit="pages",
            phase_current=0,
            phase_total=total_pages,
        )

        # ページごとのメタ情報（全文テキスト）を LLM に渡すために組み立てる
        doc_summaries: list[dict] = []
        text_phase_cancelled = False
        for doc in all_docs:
            pages_meta = []
            for page in doc["pages"]:
                processed_pages += 1
                raw_text = page["text"] or ""
                text = raw_text[:MAX_CHARS_PER_PAGE] if MAX_CHARS_PER_PAGE else raw_text
                pages_meta.append(
                    {
                        "page_index": page["page_index"],
                        "text": text,
                    }
                )
                # 進捗を各ページごとに更新（ジョブ全体 0-60% にマッピング）
                scaled_progress = int((processed_pages / total_pages) * 60) if total_pages else 0
                update_job_progress(
                    job_id,
                    processed_pages=processed_pages,
                    total_pages=total_pages,
                    status="processing",
                    phase="text_extraction",
                    progress=scaled_progress,
                    phase_unit="pages",
                    phase_current=processed_pages,
                    phase_total=total_pages,
                )
                if processed_pages % 10 == 0 and consume_cancel_if_requested(job_id):
                    text_phase_cancelled = True
                    break
            if text_phase_cancelled:
                break

            doc_summaries.append(
                {
                    "filename": doc["filename"],
                    "object_key": doc["object_key"],
                    "pages": pages_meta,
                }
            )

        if text_phase_cancelled:
            logger.info("Job %s cancelled during text extraction", job_id)
            continue

        file_names_str = ", ".join(d["filename"] for d in all_docs)
        logger.info("Starting LLM-based extraction for job %s", job_id)

        # ---- OpenAI ファイルアップロード（チャット用の file_id 取得）----
        uploaded_files: list[dict] = []
        try:
            for doc in all_docs:
                object_key = doc["object_key"]
                filename = doc["filename"]
                logger.info(
                    "Uploading PDF to OpenAI for chat use: %s (key=%s)",
                    filename,
                    object_key,
                )
                obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=object_key)
                pdf_bytes = obj["Body"].read()
                pdf_file = io.BytesIO(pdf_bytes)
                pdf_file.name = filename
                upload_resp = client.files.create(file=pdf_file, purpose="user_data")
                uploaded_files.append(
                    {
                        "filename": filename,
                        "file_id": upload_resp.id,
                    }
                )
            logger.info(
                "Uploaded %d PDF files to OpenAI for job %s",
                len(uploaded_files),
                job_id,
            )
        except Exception as e:
            # チャット用のファイルアップロードが失敗しても、抽出自体は継続する
            logger.error(
                "Failed to upload PDFs to OpenAI for job %s: %s", job_id, str(e)
            )
            uploaded_files = []

        primary_file_id = uploaded_files[0]["file_id"] if uploaded_files else None

        if consume_cancel_if_requested(job_id):
            logger.info("Job %s cancelled before task extraction", job_id)
            continue

        if _extraction_mode() == "batch":
            try:
                _run_batch_extraction_and_save(
                    job_id=job_id,
                    all_docs=all_docs,
                    doc_summaries=doc_summaries,
                    uploaded_files=uploaded_files,
                    primary_file_id=primary_file_id,
                    file_names_str=file_names_str,
                    total_pages=total_pages,
                )
            except Exception as e:
                logger.error("Batch extraction failed for job %s: %s", job_id, str(e))
                update_job_progress(
                    job_id,
                    processed_pages=processed_pages,
                    total_pages=total_pages,
                    status="failed",
                    phase="failed",
                    error_code="batch_worker_error",
                    error_detail=str(e),
                )
            continue

        # ---- タスク抽出（分割処理: 全ページをチャンクに分けてLLM呼び出し、結果をマージ）
        try:
            all_pages_flat = _pages_flat(doc_summaries)

            num_chunks = (len(all_pages_flat) + PAGES_PER_CHUNK - 1) // PAGES_PER_CHUNK
            logger.info(
                "Task extraction for job %s: %d pages in %d chunks (%d pages/chunk)",
                job_id,
                len(all_pages_flat),
                num_chunks,
                PAGES_PER_CHUNK,
            )

            all_raw_tasks: list[dict] = []
            extraction_aborted = False
            task_system_base = load_prompt("task_extraction")

            for chunk_idx in range(num_chunks):
                if consume_cancel_if_requested(job_id):
                    extraction_aborted = True
                    break
                start = chunk_idx * PAGES_PER_CHUNK
                end = min(start + PAGES_PER_CHUNK, len(all_pages_flat))
                chunk_pages = all_pages_flat[start:end]

                update_job_progress(
                    job_id,
                    status="processing",
                    phase="task_extraction",
                    detail=f"タスク抽出中（{chunk_idx + 1}/{num_chunks}チャンク）",
                    progress=60 + int(((chunk_idx + 1) / num_chunks) * 18),
                    phase_unit="chunks",
                    phase_current=chunk_idx,
                    phase_total=num_chunks,
                )

                chunk_docs = _chunk_documents(chunk_pages)
                context_json = json.dumps({"documents": chunk_docs}, ensure_ascii=False)

                task_system_prompt = f"""対象となるPDFファイル: {file_names_str}

### コンテキストJSON（チャンク {chunk_idx + 1}/{num_chunks}）
{context_json}
""" + task_system_base

                task_user_message = "防災計画PDF群から災害対応タスクを抽出し、指定のJSONフォーマットで返してください。"

                task_json = completion_parse_json_with_retry(
                    model=task_extraction_model(),
                    messages=[
                        {"role": "system", "content": task_system_prompt},
                        {"role": "user", "content": task_user_message},
                    ],
                    json_schema=_task_schema(),
                    expected_root_key="tasks",
                    client=client,
                )
                logger.info(
                    "Task extraction chunk %d/%d (job %s) ok",
                    chunk_idx + 1,
                    num_chunks,
                    job_id,
                )
                chunk_tasks = task_json.get("tasks", [])
                for t in chunk_tasks:
                    ensure_task_evidence(t)
                    tid = t.get("id")
                    if tid and not tid.startswith("chunk"):
                        t["id"] = f"chunk{chunk_idx}_{tid}"
                all_raw_tasks.extend(chunk_tasks)

            if extraction_aborted:
                continue

            tasks = _dedupe_tasks(all_raw_tasks)
            num_tasks = len(tasks)
            update_job_progress(
                job_id,
                status="processing",
                phase="task_extraction",
                detail=f"タスク抽出完了（{num_tasks}件）",
                # タスク抽出完了時点で 80% まで進める
                progress=80,
                phase_unit="tasks",
                phase_current=num_tasks,
                phase_total=num_tasks,
            )
        except Exception as e:
            logger.error("Task extraction failed for job %s: %s", job_id, str(e))
            update_job_progress(job_id, processed_pages=processed_pages, total_pages=total_pages, status="failed")
            continue

        # ---- 依存関係抽出（タスク数が多い場合はオーバーラップ付きチャンク分割）----
        try:
            dep_chunks = _dependency_chunks(tasks)
            num_dep_chunks = len(dep_chunks)
            logger.info(
                "Dependency extraction for job %s: %d tasks in %d chunks",
                job_id,
                len(tasks),
                num_dep_chunks,
            )

            all_dependencies: list[dict] = []

            full_task_registry = json.dumps(_dependency_registry_payload(tasks), ensure_ascii=False)
            dep_extraction_aborted = False
            dependency_prompt_base = load_prompt("dependency_extraction")

            for dep_idx, chunk_tasks in enumerate(dep_chunks):
                if consume_cancel_if_requested(job_id):
                    dep_extraction_aborted = True
                    break
                update_job_progress(
                    job_id,
                    status="processing",
                    phase="dependency_extraction",
                    detail=f"依存関係抽出中（{dep_idx + 1}/{num_dep_chunks}チャンク）",
                    progress=80 + int(((dep_idx + 1) / num_dep_chunks) * 15),
                    phase_unit="chunks",
                    phase_current=dep_idx,
                    phase_total=num_dep_chunks,
                )

                tasks_json_text = json.dumps(
                    _dependency_chunk_payload(chunk_tasks), ensure_ascii=False
                )
                dependency_system_prompt = f"""対象となるPDFファイル: {file_names_str}

### 全文書タスクレジストリ（圧縮版・章横断/別チャンクのタスク ID 参照用）
{full_task_registry}

### 依存抽出対象タスク部分集合(JSON・短い根拠抜粋付き)（{dep_idx + 1}/{num_dep_chunks}）
{tasks_json_text}

{dependency_prompt_base}
"""

                dependency_user_message = "上記タスク間の依存関係を、指定のJSONフォーマットで抽出してください。"

                dependency_json = completion_parse_json_with_retry(
                    model=dependency_extraction_model(),
                    messages=[
                        {"role": "system", "content": dependency_system_prompt},
                        {"role": "user", "content": dependency_user_message},
                    ],
                    json_schema=_dependency_schema(),
                    expected_root_key="dependencies",
                    client=client,
                )
                logger.info(
                    "Dependency extraction chunk %d/%d (job %s) ok",
                    dep_idx + 1,
                    num_dep_chunks,
                    job_id,
                )
                chunk_deps = dependency_json.get("dependencies", [])
                all_dependencies.extend(chunk_deps)

            if dep_extraction_aborted:
                continue

            dependencies = _merge_dependencies(all_dependencies, tasks)
            update_job_progress(
                job_id,
                status="processing",
                phase="dependency_extraction",
                detail=f"依存関係抽出完了（{len(dependencies)}件）",
                progress=95,
                phase_unit="tasks",
                phase_current=len(tasks),
                phase_total=len(tasks),
            )
        except Exception as e:
            logger.error("Dependency extraction failed for job %s: %s", job_id, str(e))
            update_job_progress(job_id, processed_pages=processed_pages, total_pages=total_pages, status="failed")
            continue

        try:
            _save_result_payload(
                job_id=job_id,
                tasks=tasks,
                dependencies=dependencies,
                all_docs=all_docs,
                uploaded_files=uploaded_files,
                primary_file_id=primary_file_id,
                total_pages=total_pages,
            )
        except Exception as e:
            logger.error("Failed to save result for job %s: %s", job_id, str(e))
            update_job_progress(job_id, processed_pages=processed_pages, total_pages=total_pages, status="failed")

    return {"status": "ok"}
