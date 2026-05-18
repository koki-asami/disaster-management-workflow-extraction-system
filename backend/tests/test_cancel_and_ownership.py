import pytest
from fastapi import HTTPException


class FakeJobsTable:
    def __init__(self):
        self.calls = []

    def update_item(self, **kwargs):
        self.calls.append(kwargs)
        return {"Attributes": {}}


def test_request_job_cancel_terminal_is_noop(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    from dmwe_core.utils import database

    monkeypatch.setattr(database, "get_job", lambda job_id: {"status": "completed", "user_sub": "u1"})

    msg, status = database.request_job_cancel("job-1", user_sub="u1")

    assert (msg, status) == ("no_op", 200)


def test_request_job_cancel_running_updates_and_cancels_batch(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    from dmwe_core.llm import batch_client
    from dmwe_core.utils import database

    table = FakeJobsTable()
    cancelled = []
    monkeypatch.setattr(
        database,
        "get_job",
        lambda job_id: {"status": "processing", "user_sub": "u1", "batch_id": "batch-1"},
    )
    monkeypatch.setattr(database, "get_jobs_table", lambda: table)
    monkeypatch.setattr(batch_client, "cancel_batch", lambda batch_id: cancelled.append(batch_id) or True)

    msg, status = database.request_job_cancel("job-1", user_sub="u1")

    assert (msg, status) == ("ok", 200)
    assert table.calls
    assert table.calls[0]["ExpressionAttributeValues"][":s"] == "cancelling"
    assert cancelled == ["batch-1"]


def test_create_extraction_rejects_other_users_upload(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    from dmwe_api.routers import extractions

    monkeypatch.setattr(
        extractions,
        "get_upload",
        lambda upload_id: {
            "upload_id": upload_id,
            "object_key": "uploads/u/file.pdf",
            "filename": "file.pdf",
            "user_sub": "other-user",
        },
    )

    with pytest.raises(HTTPException) as exc:
        extractions.create_extraction(
            extractions.CreateExtractionBody(upload_ids=["upload-1"]),
            user="current-user",
        )

    assert exc.value.status_code == 404


def test_flowchart_list_hides_other_users(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    from dmwe_api.routers import flowcharts

    monkeypatch.setattr(
        flowcharts,
        "list_flowcharts",
        lambda location_type=None, location_name=None: [
            {"id": "legacy"},
            {"id": "mine", "user_sub": "current-user"},
            {"id": "other", "user_sub": "other-user"},
        ],
    )

    result = flowcharts.list_flowcharts_endpoint(user="current-user")

    assert [row["id"] for row in result["flowcharts"]] == ["legacy", "mine"]


def test_cognito_app_client_id_is_validated(monkeypatch):
    from dmwe_api import deps

    class FakeJwkClient:
        def __init__(self, url):
            self.url = url

        def get_signing_key_from_jwt(self, token):
            return type("Key", (), {"key": "fake"})()

    monkeypatch.setenv("COGNITO_REGION", "us-east-1")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "pool")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "client-a")
    monkeypatch.setattr(deps.jwt, "PyJWKClient", FakeJwkClient, raising=False)
    monkeypatch.setattr(
        deps.jwt,
        "decode",
        lambda *args, **kwargs: {
            "token_use": "id",
            "sub": "user-1",
            "aud": "different-client",
        },
        raising=False,
    )

    with pytest.raises(HTTPException) as exc:
        deps._decode_cognito_jwt("token")

    assert exc.value.status_code == 401
