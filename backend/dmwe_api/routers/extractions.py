"""Async extraction jobs: create, status, cancel."""

from __future__ import annotations

import json
import logging
from typing import List

import boto3
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from dmwe_core.runtime.extraction_queue import (
    EXTRACTION_QUEUE_URL,
    invoke_worker_locally as _invoke_worker_locally,
    is_running_in_lambda as _is_running_in_lambda,
    sqs_client,
)
from dmwe_core.utils.database import (
    create_job,
    get_job,
    get_upload,
    request_job_cancel,
    update_job_progress,
)
from dmwe_core.utils.s3_storage import BUCKET_NAME
from dmwe_api.deps import CurrentUser

logger = logging.getLogger(__name__)
_s3 = boto3.client("s3")


class CreateExtractionBody(BaseModel):
    upload_ids: List[str] = Field(min_length=1)


def _assert_job_owner(job: dict, user_sub: str) -> None:
    owner = job.get("user_sub")
    if owner and owner != user_sub:
        raise HTTPException(status_code=404, detail="Job not found")


def _job_to_response(job_id: str, job: dict) -> dict:
    def _num(v):
        return int(v) if v is not None else 0

    status = job.get("status", "unknown")
    progress = _num(job.get("progress")) if job.get("progress") is not None else 0
    processed_pages = _num(job.get("processed_pages"))
    total_pages = _num(job.get("total_pages"))
    summary = job.get("summary")
    phase = job.get("phase")
    detail = job.get("detail")
    phase_current = int(job["phase_current"]) if job.get("phase_current") is not None else None
    phase_total = int(job["phase_total"]) if job.get("phase_total") is not None else None
    phase_unit = job.get("phase_unit")
    result_s3_key = job.get("result_s3_key")
    batch_request_total = (
        int(job["openai_batch_request_total"])
        if job.get("openai_batch_request_total") is not None
        else None
    )
    batch_request_completed = (
        int(job["openai_batch_request_completed"])
        if job.get("openai_batch_request_completed") is not None
        else None
    )
    batch_request_failed = (
        int(job["openai_batch_request_failed"])
        if job.get("openai_batch_request_failed") is not None
        else None
    )

    response_body: dict = {
        "job_id": job_id,
        "status": status,
        "progress": progress,
        "processed_pages": processed_pages,
        "total_pages": total_pages,
        "summary": summary,
        "phase": phase,
        "detail": detail,
        "phase_current": phase_current,
        "phase_total": phase_total,
        "phase_unit": phase_unit,
        "openai_batch_request_counts": {
            "total": batch_request_total,
            "completed": batch_request_completed,
            "failed": batch_request_failed,
        }
        if any(
            x is not None
            for x in (
                batch_request_total,
                batch_request_completed,
                batch_request_failed,
            )
        )
        else None,
        "result": None,
    }
    for extra_key in (
        "cancel_requested_at",
        "batch_id",
        "openai_batch_status",
        "error_code",
        "error_detail",
        "created_at",
        "updated_at",
    ):
        if job.get(extra_key) is not None:
            response_body[extra_key] = job[extra_key]

    if status == "completed" and result_s3_key:
        try:
            obj = _s3.get_object(Bucket=BUCKET_NAME, Key=result_s3_key)
            content = obj["Body"].read().decode("utf-8")
            response_body["result"] = json.loads(content)
        except Exception as e:
            logger.error("Failed to load result for %s: %s", job_id, e)

    return response_body


router = APIRouter(tags=["extractions"])


@router.post("/extractions")
def create_extraction(body: CreateExtractionBody, user: CurrentUser):
    uploads_payload: list[dict] = []
    for upload_id in body.upload_ids:
        item = get_upload(upload_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"Upload not found: {upload_id}")
        if item.get("user_sub") != user:
            raise HTTPException(status_code=404, detail=f"Upload not found: {upload_id}")
        uploads_payload.append(
            {
                "upload_id": item["upload_id"],
                "object_key": item["object_key"],
                "filename": item.get("filename") or item["object_key"],
            }
        )

    job_item = create_job(uploads=uploads_payload, status="queued", user_sub=user)
    job_id = job_item["job_id"]
    update_job_progress(job_id, status="queued", phase="queued", detail="ジョブを作成しました")

    if not _is_running_in_lambda():
        logger.info("Running extraction worker locally for job %s", job_id)
        import threading

        t = threading.Thread(
            target=_invoke_worker_locally,
            args=(job_id, uploads_payload),
            daemon=True,
        )
        t.start()
        return JSONResponse(
            status_code=202,
            content={"job_id": job_id, "status": "processing", "mode": "local"},
        )

    if not EXTRACTION_QUEUE_URL:
        raise HTTPException(
            status_code=500,
            detail="EXTRACTION_QUEUE_URL is not configured for Lambda",
        )
    try:
        sqs_client.send_message(
            QueueUrl=EXTRACTION_QUEUE_URL,
            MessageBody=json.dumps({"job_id": job_id, "uploads": uploads_payload}),
        )
    except Exception as e:
        logger.error("Enqueue failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to enqueue extraction job: {e}") from e

    return {"job_id": job_id, "status": "queued", "mode": "sqs"}


@router.get("/extractions/{job_id}")
def get_extraction(job_id: str, user: CurrentUser):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    _assert_job_owner(job, user)
    return _job_to_response(job_id, job)


@router.post("/extractions/{job_id}/cancel")
def cancel_extraction(job_id: str, user: CurrentUser):
    msg, status = request_job_cancel(job_id, user_sub=user)
    if msg == "not_found":
        raise HTTPException(status_code=404, detail="Job not found")
    if msg == "forbidden":
        raise HTTPException(status_code=403, detail="Forbidden")
    if msg == "error":
        raise HTTPException(status_code=500, detail="Cancel failed")
    if msg == "no_op":
        return {"job_id": job_id, "status": "noop", "message": "already terminal or cancelling"}
    return {"job_id": job_id, "status": "cancelling", "message": "cancel requested"}
