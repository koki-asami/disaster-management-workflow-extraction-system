"""Chat workflow updates (sync API; JSON のみ)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from dmwe_core.handlers.chat import handle_chat_update
from dmwe_api.deps import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])


@router.post("/chat_update")
def chat_update(user: CurrentUser, body: dict = Body(...)):
    _ = user
    out = handle_chat_update(body)
    if isinstance(out, tuple):
        payload, code = out
        return JSONResponse(status_code=code, content=payload)
    return out
