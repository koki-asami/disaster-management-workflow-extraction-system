"""JSON workflow chat (no Mermaid)."""

from __future__ import annotations

import json
import logging
import traceback
from typing import Any

from dmwe_core.llm.client import chat_model, get_openai_client
from dmwe_core.llm.prompt_loader import load_prompt

logger = logging.getLogger(__name__)


def handle_chat_update(data: dict[str, Any]) -> dict[str, Any] | tuple[dict, int]:
    if not data:
        return {"error": "Request body is required"}, 400

    user_instruction = data.get("instruction")
    file_id = data.get("file_id")
    past_messages = data.get("history") or []
    graph_data = data.get("graph_data")

    if not user_instruction:
        return {"error": "Instruction is required"}, 400

    system_prompt = load_prompt("chat_update")
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]

    if graph_data:
        try:
            workflow_json = json.dumps(graph_data, ensure_ascii=False)
        except Exception:
            workflow_json = str(graph_data)
        messages.append(
            {
                "role": "system",
                "content": f"現在のワークフローJSON:\n{workflow_json}",
            }
        )
    for entry in past_messages:
        role = entry.get("role", "user")
        content = entry.get("content") or ""
        if entry.get("chart"):
            content = (
                f"{content}\n\n（注: 過去メッセージにチャート参照がありました。"
                "Mermaid は使用しません。内容は上記テキストのみ参照してください。）"
            )
        messages.append({"role": role, "content": content})

    user_msg: dict[str, Any] = {"role": "user", "content": user_instruction}
    if file_id:
        user_msg["attachments"] = [
            {"file_id": file_id, "tools": [{"type": "code_interpreter"}]},
        ]
    else:
        logger.info("chat_update called without file_id; proceeding without attachments")
    messages.append(user_msg)

    client = get_openai_client()
    try:
        response = client.chat.completions.create(model=chat_model(), messages=messages)
        response_content = response.choices[0].message.content or ""

        parsed = None
        try:
            text = response_content.strip()
            if text.startswith("```"):
                first_newline = text.find("\n")
                if first_newline != -1:
                    text = text[first_newline + 1 :]
                if text.endswith("```"):
                    text = text[:-3]
                text = text.strip()
            parsed = json.loads(text)
        except Exception:
            logger.warning("Failed to parse chat_update response as JSON; returning raw text")

        result: dict[str, Any] = {}
        graph_result = None

        if isinstance(parsed, dict):
            mode = parsed.get("mode")
            answer = parsed.get("answer") or response_content
            updated_workflow = parsed.get("updated_workflow")

            if isinstance(updated_workflow, dict):
                tasks = updated_workflow.get("tasks")
                deps = updated_workflow.get("dependencies")
                if isinstance(tasks, list) and isinstance(deps, list):
                    graph_result = {
                        **{
                            k: v
                            for k, v in updated_workflow.items()
                            if k not in {"tasks", "dependencies"}
                        },
                        "tasks": tasks,
                        "dependencies": deps,
                    }

            result["message"] = answer
            if mode is not None:
                result["mode"] = mode
            if graph_result is not None:
                result["graph_data"] = graph_result
        else:
            result["message"] = response_content

        return result
    except Exception as e:
        error_msg = f"OpenAI API error: {str(e)}"
        logger.error("%s\n%s", error_msg, traceback.format_exc())
        return {"error": error_msg}, 500
