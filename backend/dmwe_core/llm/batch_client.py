"""OpenAI Batch API helpers (submit / poll / cancel)."""

from __future__ import annotations

import json
import time
from typing import Any

from dmwe_core.llm import json_util
from dmwe_core.llm.client import get_openai_client


def submit_jsonl_batch(file_bytes: bytes, endpoint: str = "/v1/chat/completions") -> str:
    """
    Upload a JSONL batch file and create a batch job.
    Returns batch id.
    """
    client = get_openai_client()
    import io

    file_obj = io.BytesIO(file_bytes)
    file_obj.name = "batch.jsonl"
    upload = client.files.create(file=file_obj, purpose="batch")
    batch = client.batches.create(
        input_file_id=upload.id,
        endpoint=endpoint,
        completion_window="24h",
    )
    return batch.id


def get_batch_status(batch_id: str) -> dict[str, Any]:
    client = get_openai_client()
    b = client.batches.retrieve(batch_id)
    request_counts = getattr(b, "request_counts", None)
    if isinstance(request_counts, dict):
        counts = {
            "total": request_counts.get("total"),
            "completed": request_counts.get("completed"),
            "failed": request_counts.get("failed"),
        }
    elif request_counts:
        counts = {
            "total": getattr(request_counts, "total", None),
            "completed": getattr(request_counts, "completed", None),
            "failed": getattr(request_counts, "failed", None),
        }
    else:
        counts = None
    return {
        "id": b.id,
        "status": b.status,
        "output_file_id": getattr(b, "output_file_id", None),
        "error_file_id": getattr(b, "error_file_id", None),
        "request_counts": counts,
    }


def cancel_batch(batch_id: str) -> bool:
    client = get_openai_client()
    try:
        client.batches.cancel(batch_id)
        return True
    except Exception:
        return False


def normalize_openai_batch_status(
    openai_status: str | None,
    *,
    phase: str,
    progress_start: int,
    progress_done: int,
) -> dict[str, Any]:
    """Map OpenAI Batch status to the internal job status fields."""
    status = (openai_status or "unknown").lower()
    progress_mid = progress_start + max(0, int((progress_done - progress_start) * 0.5))
    if status in ("validating", "in_progress", "finalizing"):
        progress = {
            "validating": progress_start,
            "in_progress": progress_mid,
            "finalizing": max(progress_mid, progress_done - 1),
        }[status]
        return {
            "status": "processing",
            "phase": phase,
            "progress": progress,
            "openai_batch_status": status,
        }
    if status == "completed":
        return {
            "status": "processing",
            "phase": phase,
            "progress": progress_done,
            "openai_batch_status": status,
        }
    if status == "cancelling":
        return {
            "status": "cancelling",
            "phase": "cancelling",
            "progress": progress_start,
            "openai_batch_status": status,
        }
    if status == "cancelled":
        return {
            "status": "cancelled",
            "phase": "cancelled",
            "progress": progress_start,
            "openai_batch_status": status,
        }
    if status in ("failed", "expired", "timeout"):
        return {
            "status": "failed",
            "phase": phase,
            "progress": progress_start,
            "openai_batch_status": status,
            "error_code": f"openai_batch_{status}",
        }
    return {
        "status": "processing",
        "phase": phase,
        "progress": progress_start,
        "openai_batch_status": status,
    }


def wait_for_batch(batch_id: str, poll_seconds: float = 30.0, timeout: float = 86400.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        st = get_batch_status(batch_id)
        if st["status"] in ("completed", "failed", "cancelled", "expired"):
            return st
        time.sleep(poll_seconds)
    return {"id": batch_id, "status": "timeout", "output_file_id": None, "error_file_id": None}


def build_chat_batch_line(
    custom_id: str,
    model: str,
    messages: list[dict],
    max_tokens: int | None = None,
    json_schema: dict[str, Any] | None = None,
) -> str:
    body: dict[str, Any] = {"model": model, "messages": messages}
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    if json_schema is not None:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "payload",
                "schema": json_schema,
                "strict": True,
            },
        }
    rec = {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": body,
    }
    return json.dumps(rec, ensure_ascii=False)


def download_file_text(file_id: str, client: Any | None = None) -> str:
    """Download a Batch output file as UTF-8 text."""
    client = client or get_openai_client()
    content = client.files.content(file_id)
    if hasattr(content, "text"):
        text = content.text
        if isinstance(text, str):
            return text
    if hasattr(content, "content"):
        raw = content.content
    elif hasattr(content, "read"):
        raw = content.read()
    else:
        raw = bytes(content)
    if isinstance(raw, str):
        return raw
    return raw.decode("utf-8")


def summarize_batch_error_file(error_file_id: str, *, max_lines: int = 3) -> str:
    """Return a compact summary of OpenAI Batch item errors."""
    output_text = download_file_text(error_file_id)
    summaries: list[str] = []
    for line in output_text.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            summaries.append(line.strip()[:500])
            continue
        custom_id = record.get("custom_id") or record.get("id") or "unknown"
        error = record.get("error") or {}
        if not error:
            body = ((record.get("response") or {}).get("body") or {})
            error = body.get("error") or {}
        code = error.get("code") or error.get("type") or "error"
        message = error.get("message") or json.dumps(error, ensure_ascii=False)
        summaries.append(f"{custom_id}: {code}: {message}")
        if len(summaries) >= max_lines:
            break
    return " | ".join(summaries) if summaries else "Batch error file was empty"


def parse_chat_batch_output(
    output_text: str,
    *,
    expected_root_key: str,
) -> dict[str, dict]:
    """
    Parse OpenAI Batch JSONL output into {custom_id: parsed_json}.
    Raises on per-line API errors so the caller can fail the job explicitly.
    """
    parsed: dict[str, dict] = {}
    for line in output_text.splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        custom_id = record.get("custom_id")
        if not custom_id:
            continue
        if record.get("error"):
            raise RuntimeError(f"Batch item {custom_id} failed: {record['error']}")
        response = record.get("response") or {}
        if response.get("status_code") and int(response["status_code"]) >= 400:
            raise RuntimeError(f"Batch item {custom_id} returned {response['status_code']}")
        body = response.get("body") or {}
        choices = body.get("choices") or []
        if not choices:
            raise RuntimeError(f"Batch item {custom_id} returned no choices")
        content = ((choices[0].get("message") or {}).get("content") or "").strip()
        parsed[custom_id] = json_util.parse_json_response(
            content,
            expected_root_key=expected_root_key,
        )
    return parsed
