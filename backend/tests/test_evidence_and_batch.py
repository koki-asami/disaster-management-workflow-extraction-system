import json

from dmwe_core.llm import batch_client
from dmwe_core.llm.batch_client import normalize_openai_batch_status
from dmwe_core.llm.schema import DEPENDENCIES_ROOT_JSON_SCHEMA, TASKS_ROOT_JSON_SCHEMA
from dmwe_core.workers.extraction_evidence import (
    ensure_dependency_evidence,
    ensure_task_evidence,
)


def test_ensure_task_evidence_fills_empty_list():
    task = {"context_snippets": ["避難所を開設する。"]}

    ensure_task_evidence(task)

    assert task["evidence"]
    assert task["evidence"][0]["source_quote"] == "避難所を開設する。"


def test_ensure_dependency_evidence_fills_empty_list():
    dep = {"from": "t001", "to": "t002", "reason": "被害確認後に報告するため"}

    ensure_dependency_evidence(dep)

    assert dep["evidence"]
    assert dep["evidence"][0]["source_quote"] == "被害確認後に報告するため"


def test_normalize_openai_batch_status_running():
    mapped = normalize_openai_batch_status(
        "in_progress",
        phase="task_extraction",
        progress_start=60,
        progress_done=80,
    )

    assert mapped["status"] == "processing"
    assert mapped["phase"] == "task_extraction"
    assert mapped["progress"] == 70
    assert mapped["openai_batch_status"] == "in_progress"


def test_normalize_openai_batch_status_failed():
    mapped = normalize_openai_batch_status(
        "expired",
        phase="dependency_extraction",
        progress_start=80,
        progress_done=95,
    )

    assert mapped["status"] == "failed"
    assert mapped["phase"] == "dependency_extraction"
    assert mapped["error_code"] == "openai_batch_expired"


def test_summarize_batch_error_file(monkeypatch):
    error_text = "\n".join(
        [
            json.dumps(
                {
                    "custom_id": "task-0",
                    "error": {
                        "code": "invalid_request_error",
                        "message": "Invalid schema",
                    },
                }
            )
        ]
    )
    monkeypatch.setattr(batch_client, "download_file_text", lambda file_id: error_text)

    summary = batch_client.summarize_batch_error_file("file-error")

    assert "task-0" in summary
    assert "invalid_request_error" in summary
    assert "Invalid schema" in summary


def _assert_strict_objects(schema):
    if schema.get("type") == "object":
        assert schema.get("additionalProperties") is False
        assert set(schema.get("required", [])) == set(schema.get("properties", {}).keys())
    for prop in schema.get("properties", {}).values():
        _assert_strict_objects(prop)
    items = schema.get("items")
    if isinstance(items, dict):
        _assert_strict_objects(items)


def test_batch_json_schemas_are_strict_objects():
    _assert_strict_objects(TASKS_ROOT_JSON_SCHEMA)
    _assert_strict_objects(DEPENDENCIES_ROOT_JSON_SCHEMA)
