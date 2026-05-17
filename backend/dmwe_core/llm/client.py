"""Shared OpenAI client and model env defaults."""

from __future__ import annotations

import os
from typing import Optional

import openai

_CLIENT: Optional[openai.OpenAI] = None


def get_openai_client() -> openai.OpenAI:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = openai.OpenAI()
    return _CLIENT


def task_extraction_model() -> str:
    return os.environ.get("TASK_EXTRACTION_MODEL", "gpt-5.2")


def dependency_extraction_model() -> str:
    return os.environ.get("DEPENDENCY_EXTRACTION_MODEL", "gpt-5.2")


def chat_model() -> str:
    return os.environ.get("CHAT_MODEL", "gpt-5.2")
