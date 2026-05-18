"""Flowchart CRUD + default PDF (legacy paths under /api/v1)."""

from __future__ import annotations

import logging
import traceback
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from dmwe_core.utils.database import (
    delete_flowchart,
    get_default_pdf as lookup_default_pdf_url,
    get_flowchart,
    list_flowcharts,
    save_flowchart,
)
from dmwe_api.deps import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["flowcharts"])


class SaveFlowchartBody(BaseModel):
    chart_code: Optional[str] = ""
    location_type: Optional[str] = None
    location_name: Optional[str] = None
    title: Optional[str] = None
    file_id: Optional[str] = None
    chart_id: Optional[str] = None
    graph_data: Optional[Dict[str, Any]] = None


def _flowchart_readable_by_user(item: dict, user_sub: str) -> bool:
    owner = item.get("user_sub")
    return not owner or owner == user_sub


def _flowchart_owned_by_user(item: dict, user_sub: str) -> bool:
    return item.get("user_sub") == user_sub


@router.post("/save_flowchart")
def save_flowchart_endpoint(body: SaveFlowchartBody, user: CurrentUser):
    if not body.chart_code and body.graph_data is None:
        raise HTTPException(
            status_code=400,
            detail="Either chart_code or graph_data is required",
        )
    if not body.location_type:
        raise HTTPException(status_code=400, detail="Location type is required")
    if not body.location_name:
        raise HTTPException(status_code=400, detail="Location name is required")

    try:
        if body.chart_id:
            existing = get_flowchart(body.chart_id)
            if not existing:
                raise HTTPException(status_code=404, detail="Flowchart not found")
            owner = existing.get("user_sub")
            if owner and owner != user:
                raise HTTPException(status_code=404, detail="Flowchart not found")

        success, error_message, chart_id = save_flowchart(
            body.chart_code or "",
            body.location_type,
            body.location_name,
            body.title,
            chart_id=body.chart_id,
            file_id=body.file_id,
            graph_data=body.graph_data,
            user_sub=user,
        )
        if not success:
            raise HTTPException(status_code=500, detail=error_message)
        return {"id": chart_id, "message": "Flowchart saved successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("%s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/get_flowchart/{chart_id}")
def get_flowchart_endpoint(chart_id: str, user: CurrentUser):
    fc = get_flowchart(chart_id)
    if not fc or not _flowchart_readable_by_user(fc, user):
        raise HTTPException(status_code=404, detail="Flowchart not found")
    return fc


@router.get("/list_flowcharts")
def list_flowcharts_endpoint(
    user: CurrentUser,
    location_type: Optional[str] = None,
    location_name: Optional[str] = None,
):
    try:
        rows = list_flowcharts(location_type, location_name)
        rows = [row for row in rows if _flowchart_readable_by_user(row, user)]
        return {"flowcharts": rows}
    except Exception as e:
        logger.error("%s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/delete_flowchart/{chart_id}")
def delete_flowchart_endpoint(chart_id: str, user: CurrentUser):
    fc = get_flowchart(chart_id)
    if not fc:
        return JSONResponse(
            status_code=404,
            content={"error": "指定されたIDのフローチャートが見つかりません"},
        )
    if not _flowchart_owned_by_user(fc, user):
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    success, error_message = delete_flowchart(chart_id)
    if not success:
        code = 404 if "見つかりません" in error_message else 500
        return JSONResponse(status_code=code, content={"error": error_message})
    return JSONResponse(
        content={"message": "フローチャートが正常に削除されました", "id": chart_id}
    )


@router.get("/flowcharts/default-pdf")
def flowcharts_default_pdf(user: CurrentUser, location_name: Optional[str] = None):
    if not location_name:
        raise HTTPException(status_code=400, detail="location_name is required")
    pdf_url = lookup_default_pdf_url(location_name, user_sub=user)
    if not pdf_url:
        raise HTTPException(status_code=404, detail="No PDF found for this location")
    return {"pdf_url": pdf_url}
