from __future__ import annotations

from dmwe_core.utils.database import get_job, update_job_progress

__all__ = (
    "consume_cancel_if_requested",
    "ensure_task_evidence",
    "ensure_dependency_evidence",
)


def consume_cancel_if_requested(job_id: str) -> bool:
    """If cancel was requested, mark job cancelled and return True."""
    j = get_job(job_id)
    if j and j.get("cancel_requested_at"):
        update_job_progress(
            job_id,
            status="cancelled",
            phase="cancelled",
            detail="ユーザーによりキャンセルされました",
            progress=int(j.get("progress") or 0),
        )
        return True
    return False


def ensure_task_evidence(task: dict) -> None:
    if task.get("evidence"):
        evidence = task["evidence"]
        if isinstance(evidence, dict):
            evidence = [evidence]
        task["evidence"] = [_complete_evidence_item(item, "（抜粋なし）") for item in evidence if isinstance(item, dict)]
        if task["evidence"]:
            return
    snippets = task.get("context_snippets") or []
    if isinstance(snippets, str):
        snippets = [snippets]
    q = (snippets[0] if snippets else "") or "（抜粋なし）"
    task["evidence"] = [_complete_evidence_item({"source_quote": q[:2000]}, "（抜粋なし）")]


def ensure_dependency_evidence(dep: dict) -> None:
    reason = (dep.get("reason") or "").strip()
    default_quote = reason[:2000] if reason else "（根拠テキストなし）"
    if dep.get("evidence"):
        evidence = dep["evidence"]
        if isinstance(evidence, dict):
            evidence = [evidence]
        dep["evidence"] = [_complete_evidence_item(item, default_quote) for item in evidence if isinstance(item, dict)]
        if dep["evidence"]:
            return
    dep["evidence"] = [_complete_evidence_item({"source_quote": default_quote}, default_quote)]


def _complete_evidence_item(item: dict, default_quote: str) -> dict:
    out = dict(item)
    out["source_quote"] = (out.get("source_quote") or default_quote or "（抜粋なし）")[:2000]
    out.setdefault("chapter_ref", None)
    section_path = out.get("section_path")
    out["section_path"] = section_path if isinstance(section_path, list) else []
    out.setdefault("page_start", None)
    out.setdefault("page_end", None)
    out.setdefault("char_offset_start", None)
    out.setdefault("char_offset_end", None)
    return out
