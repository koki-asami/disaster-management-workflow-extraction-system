"""Synchronous analyze_pdf (Batch 禁止の同期パス)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from dmwe_core.handlers.analyze_pdf_sync import run_analyze_pdf
from dmwe_api.deps import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["analyze"])


@router.post("/analyze_pdf")
def analyze_pdf(user: CurrentUser, body: dict = Body(...)):
    _ = user
    out = run_analyze_pdf(body)
    if isinstance(out, tuple):
        payload, code = out
        return JSONResponse(status_code=code, content=payload)
    return out
