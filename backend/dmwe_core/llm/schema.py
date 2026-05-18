"""
Pydantic models and JSON Schema fragments for structured LLM outputs.

Used with OpenAI structured outputs when supported; callers fall back to parse_json_response.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# ---- Evidence / provenance ----


class SourceEvidence(BaseModel):
    """Citation-style evidence for a task or dependency edge."""

    chapter_ref: Optional[str] = Field(default=None, description="Chapter label e.g. 第3章")
    section_path: List[str] = Field(default_factory=list, description="Heading path top-down")
    page_start: Optional[int] = Field(default=None, ge=0, description="0-based start page in PDF")
    page_end: Optional[int] = Field(default=None, ge=0, description="0-based end page inclusive")
    source_quote: Optional[str] = Field(default=None, max_length=2000, description="Short verbatim quote")
    char_offset_start: Optional[int] = Field(default=None, description="Optional char offset in normalized text")
    char_offset_end: Optional[int] = Field(default=None, description="Optional char offset end")


class TaskNode(BaseModel):
    id: str
    name: str
    canonical_name: Optional[str] = ""
    phase: Optional[str] = "emergency_response"
    workstream: Optional[str] = "other"
    department: Optional[str] = ""
    description: Optional[str] = ""
    category: Optional[str] = ""
    source_pdf: Optional[str] = None
    page_range: Optional[str] = None
    context_snippets: List[str] = Field(default_factory=list)
    evidence: List[SourceEvidence] = Field(default_factory=list)
    actor: Dict[str, Any] = Field(default_factory=dict)
    action: Optional[str] = ""
    object: Optional[str] = ""
    scope: Optional[str] = ""
    aliases: List[str] = Field(default_factory=list)
    analysis_keys: Dict[str, Any] = Field(default_factory=dict)


class DependencyEdge(BaseModel):
    from_: str = Field(alias="from")
    to: str
    reason: Optional[str] = ""
    dependency_type: Optional[str] = "precondition"
    confidence: Optional[str] = "medium"
    evidence: List[SourceEvidence] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class TasksPayload(BaseModel):
    tasks: List[TaskNode]


class DependenciesPayload(BaseModel):
    dependencies: List[DependencyEdge]


_EVIDENCE_ITEM: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "chapter_ref",
        "section_path",
        "page_start",
        "page_end",
        "source_quote",
        "char_offset_start",
        "char_offset_end",
    ],
    "properties": {
        "chapter_ref": {"type": ["string", "null"]},
        "section_path": {"type": "array", "items": {"type": "string"}},
        "page_start": {"type": ["integer", "null"]},
        "page_end": {"type": ["integer", "null"]},
        "source_quote": {"type": "string"},
        "char_offset_start": {"type": ["integer", "null"]},
        "char_offset_end": {"type": ["integer", "null"]},
    },
}

_ACTOR_ITEM: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "org_level",
        "org_name_raw",
        "org_name_normalized",
        "department_raw",
        "department_normalized",
    ],
    "properties": {
        "org_level": {
            "type": "string",
            "enum": [
                "prefecture",
                "municipality",
                "national",
                "related_organization",
                "other",
            ],
        },
        "org_name_raw": {"type": "string"},
        "org_name_normalized": {"type": "string"},
        "department_raw": {"type": "string"},
        "department_normalized": {"type": "string"},
    },
}

_ANALYSIS_KEYS_ITEM: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["duplicate_key", "mece_axis", "owner_key"],
    "properties": {
        "duplicate_key": {"type": "string"},
        "mece_axis": {"type": "string"},
        "owner_key": {"type": "string"},
    },
}

TASKS_ROOT_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["tasks"],
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "name",
                    "canonical_name",
                    "phase",
                    "workstream",
                    "department",
                    "description",
                    "category",
                    "source_pdf",
                    "page_range",
                    "context_snippets",
                    "evidence",
                    "actor",
                    "action",
                    "object",
                    "scope",
                    "aliases",
                    "analysis_keys",
                ],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "canonical_name": {"type": "string"},
                    "phase": {
                        "type": "string",
                        "enum": [
                            "preparedness",
                            "initial_response",
                            "emergency_response",
                            "recovery",
                        ],
                    },
                    "workstream": {
                        "type": "string",
                        "enum": [
                            "command",
                            "information",
                            "evacuation",
                            "rescue_medical",
                            "logistics",
                            "external_support",
                            "vulnerable_people",
                            "public_communication",
                            "infrastructure",
                            "damage_assessment",
                            "sanitation",
                            "recovery",
                            "other",
                        ],
                    },
                    "department": {"type": ["string", "null"]},
                    "description": {"type": ["string", "null"]},
                    "category": {"type": ["string", "null"]},
                    "source_pdf": {"type": ["string", "null"]},
                    "page_range": {"type": ["string", "null"]},
                    "context_snippets": {"type": "array", "items": {"type": "string"}},
                    "evidence": {
                        "type": "array",
                        "items": _EVIDENCE_ITEM,
                    },
                    "actor": _ACTOR_ITEM,
                    "action": {"type": "string"},
                    "object": {"type": "string"},
                    "scope": {"type": "string"},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "analysis_keys": _ANALYSIS_KEYS_ITEM,
                },
            },
        }
    },
}

DEPENDENCIES_ROOT_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["dependencies"],
    "properties": {
        "dependencies": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["from", "to", "reason", "dependency_type", "confidence", "evidence"],
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "reason": {"type": ["string", "null"]},
                    "dependency_type": {
                        "type": "string",
                        "enum": [
                            "precondition",
                            "information_flow",
                            "handoff",
                            "resource_flow",
                            "decision",
                        ],
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "evidence": {
                        "type": "array",
                        "items": _EVIDENCE_ITEM,
                    },
                },
            },
        }
    },
}
