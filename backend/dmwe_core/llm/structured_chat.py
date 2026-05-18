"""Chat Completions with optional JSON-schema response_format (structured outputs)."""

from __future__ import annotations

import time
from typing import Any


def completion_parse_json(
    *,
    model: str,
    messages: list[dict[str, Any]],
    json_schema: dict[str, Any] | None,
    expected_root_key: str | None,
    client: Any,
) -> dict:
    """
    Try structured output via response_format json_schema; on failure or if unsupported,
    fall back to plain chat + json_util.parse_json_response.
    """
    from dmwe_core.llm import json_util

    kwargs: dict[str, Any] = {"model": model, "messages": messages}
    if json_schema is not None:
        kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "payload",
                "schema": json_schema,
                "strict": True,
            },
        }
    try:
        resp = client.chat.completions.create(**kwargs)
        content = (resp.choices[0].message.content or "").strip()
        return json_util.parse_json_response(content, expected_root_key=expected_root_key)
    except Exception:
        kwargs.pop("response_format", None)
        resp = client.chat.completions.create(**kwargs)
        content = (resp.choices[0].message.content or "").strip()
        return json_util.parse_json_response(content, expected_root_key=expected_root_key)


def completion_parse_json_with_retry(
    *,
    model: str,
    messages: list[dict[str, Any]],
    json_schema: dict[str, Any] | None,
    expected_root_key: str | None,
    client: Any,
    max_retries: int = 5,
    base_delay: float = 1.0,
) -> dict:
    attempt = 0
    last_error: Exception | None = None
    while attempt <= max_retries:
        try:
            return completion_parse_json(
                model=model,
                messages=messages,
                json_schema=json_schema,
                expected_root_key=expected_root_key,
                client=client,
            )
        except Exception as e:
            last_error = e
            message = str(e) or e.__class__.__name__
            lower = message.lower()
            is_rate = "rate limit" in lower or "429" in lower
            is_timeout = "timeout" in lower or "timed out" in lower
            is_connection = "connection error" in lower or "connection aborted" in lower
            if attempt >= max_retries or not (is_rate or is_timeout or is_connection):
                raise
            delay = base_delay * (2**attempt)
            time.sleep(max(delay, 0.5))
            attempt += 1
    if last_error:
        raise last_error
    raise RuntimeError("completion_parse_json_with_retry failed")
