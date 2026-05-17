"""Plan quality / MECE diagnostics."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from dmwe_core.workflow_v2 import (
    DEFAULT_TAXONOMIES,
    diagnose_workflow_quality,
    enrich_workflow_v2,
)
from dmwe_api.deps import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["plan"])


class DiagnoseBody(BaseModel):
    graph_data: Optional[Dict[str, Any]] = None


@router.post("/plan/diagnose")
def plan_diagnose(body: DiagnoseBody, user: CurrentUser):
    _ = user
    graph_data = body.graph_data or {}
    tasks = graph_data.get("tasks") if isinstance(graph_data.get("tasks"), list) else []
    dependencies = (
        graph_data.get("dependencies")
        if isinstance(graph_data.get("dependencies"), list)
        else []
    )
    taxonomies = graph_data.get("taxonomies") or DEFAULT_TAXONOMIES
    normalized_tasks, normalized_dependencies = enrich_workflow_v2(tasks, dependencies)
    findings = diagnose_workflow_quality(normalized_tasks, normalized_dependencies, taxonomies)
    return {
        "schema_version": "2.0",
        "quality_findings": findings,
        "tasks": normalized_tasks,
        "dependencies": normalized_dependencies,
        "taxonomies": taxonomies,
    }
