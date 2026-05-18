"""Presigned uploads (same contract as legacy Chalice routes)."""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from dmwe_core.utils.database import (
    create_upload_record,
    delete_upload_record,
    get_upload,
    list_uploads,
    mark_upload_complete,
)
from dmwe_core.utils.s3_storage import create_presigned_upload_url, delete_object
from dmwe_api.deps import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["uploads"])


class PresignBody(BaseModel):
    filename: str = Field(min_length=1)
    content_type: str = "application/pdf"


class CompleteBody(BaseModel):
    upload_id: str
    size_bytes: Optional[int] = None


@router.post("/uploads/presign")
def presign_upload(body: PresignBody, user: CurrentUser):
    _ = user
    upload_id = str(uuid.uuid4())
    object_key = f"uploads/{upload_id}/{body.filename}"
    try:
        upload_url = create_presigned_upload_url(
            object_key=object_key,
            content_type=body.content_type,
        )
        record = create_upload_record(
            filename=body.filename,
            object_key=object_key,
            status="pending",
            size_bytes=None,
            user_sub=user,
            upload_id=upload_id,
        )
        return {
            "upload_id": record["upload_id"],
            "object_key": object_key,
            "upload_url": upload_url,
        }
    except Exception as e:
        logger.error("presign: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to create presigned upload: {e}") from e


@router.post("/uploads/complete")
def complete_upload(body: CompleteBody, user: CurrentUser):
    item = mark_upload_complete(
        upload_id=body.upload_id,
        size_bytes=body.size_bytes,
        user_sub=user,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Upload not found or failed to update")
    return {"upload": item}


@router.get("/uploads")
def list_uploads_endpoint(user: CurrentUser):
    try:
        uploads = list_uploads(user_sub=user)
        uploads = sorted(uploads, key=lambda x: x.get("created_at", ""), reverse=True)
        return {"uploads": uploads}
    except Exception as e:
        logger.error("list uploads: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/uploads/{upload_id}")
def delete_upload(upload_id: str, user: CurrentUser):
    item = get_upload(upload_id)
    if not item or item.get("user_sub") != user:
        raise HTTPException(status_code=404, detail="Upload not found")
    object_key = item.get("object_key")
    if object_key:
        try:
            delete_object(object_key)
        except Exception:
            pass
    if not delete_upload_record(upload_id, user_sub=user):
        raise HTTPException(status_code=500, detail="Failed to delete upload record")
    return {"message": "Upload deleted", "upload_id": upload_id}
