"""JSON parsing helpers for LLM chat responses."""

from __future__ import annotations

import json


def parse_json_response(raw_text: str, expected_root_key: str | None = None) -> dict:
    """
    Extract a JSON object from LLM text (strips fences, finds first {...}).
    If expected_root_key is set, validates the key exists at top level.
    """
    if not isinstance(raw_text, str):
        raise ValueError("Response content is not a string")

    raw_text = raw_text.strip()

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError:
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON object found in response") from None
        data = json.loads(raw_text[start : end + 1])

    if expected_root_key is not None and expected_root_key not in data:
        raise ValueError(f"Expected root key '{expected_root_key}' not found in JSON response")
    return data
