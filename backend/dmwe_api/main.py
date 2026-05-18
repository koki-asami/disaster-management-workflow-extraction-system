"""FastAPI entrypoint: business routes under /api/v1, GET /health at root."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dmwe_api.routers import chat, extractions, flowcharts, health, legacy_analyze, plan_quality, uploads


def _allowed_origins() -> list[str]:
    raw = os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://127.0.0.1:5173")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(title="Disaster Management Workflow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(uploads.router, prefix="/api/v1")
app.include_router(extractions.router, prefix="/api/v1")
app.include_router(legacy_analyze.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(flowcharts.router, prefix="/api/v1")
app.include_router(plan_quality.router, prefix="/api/v1")
