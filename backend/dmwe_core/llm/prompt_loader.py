"""Load prompt text files from dmwe_core/llm/prompts/."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


@lru_cache(maxsize=32)
def load_prompt(name: str) -> str:
    """Load ``name``.md from the prompts directory (no extension in ``name``)."""
    path = _PROMPTS_DIR / f"{name}.md"
    return path.read_text(encoding="utf-8")
