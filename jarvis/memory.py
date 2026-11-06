"""JARVIS's two kinds of memory.

* ``ConversationMemory`` is short-term memory: the running chat history that is
  sent to Claude on every turn. It is saved to disk so JARVIS keeps the thread
  across restarts.
* ``FactStore`` is long-term memory: small facts the user asks JARVIS to
  remember ("my sister's birthday is 3 May"). Claude reads and writes it
  through the memory tools in ``tools.py``.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _to_plain(block: Any) -> Any:
    """Turn an SDK content block (pydantic model) into plain JSON data."""
    if hasattr(block, "to_dict"):
        return block.to_dict()
    if hasattr(block, "model_dump"):
        return block.model_dump(mode="json", exclude_unset=True)
    return block


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


class ConversationMemory:
    """The message history, kept append-only.

    Assistant turns are stored exactly as Claude returned them (including
    thinking and tool_use blocks). Editing or reordering earlier turns would
    invalidate Claude's thinking blocks, so the only ways to change history
    are ``append``, ``rollback`` (drop a turn that just failed) and ``clear``.
    """

    def __init__(self, path: Path | None = None):
        self.path = path
        self.messages: list[dict[str, Any]] = []
        if path and path.exists():
            self.messages = json.loads(path.read_text(encoding="utf-8"))

    def __len__(self) -> int:
        return len(self.messages)

    def add_user(self, content: str | list[Any]) -> None:
        self.messages.append({"role": "user", "content": content})

    def add_assistant(self, content: list[Any]) -> None:
        self.messages.append(
            {"role": "assistant", "content": [_to_plain(b) for b in content]}
        )

    def checkpoint(self) -> int:
        return len(self.messages)

    def rollback(self, checkpoint: int) -> None:
        """Drop everything added since ``checkpoint`` (used when a turn fails)."""
        del self.messages[checkpoint:]

    def clear(self) -> None:
        self.messages = []
        self.save()

    def save(self) -> None:
        if self.path:
            _write_json(self.path, self.messages)


class FactStore:
    """A tiny key/value store of things the user wants remembered."""

    def __init__(self, path: Path | None = None):
        self.path = path
        self.facts: dict[str, dict[str, str]] = {}
        if path and path.exists():
            self.facts = json.loads(path.read_text(encoding="utf-8"))

    def remember(self, key: str, value: str) -> None:
        self.facts[key.strip().lower()] = {
            "value": value,
            "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        self._save()

    def forget(self, key: str) -> bool:
        removed = self.facts.pop(key.strip().lower(), None) is not None
        if removed:
            self._save()
        return removed

    def search(self, query: str = "") -> dict[str, str]:
        """Facts whose key or value contains every word of ``query``."""
        words = query.lower().split()
        return {
            k: v["value"]
            for k, v in self.facts.items()
            if all(w in f"{k} {v['value']}".lower() for w in words)
        }

    def _save(self) -> None:
        if self.path:
            _write_json(self.path, self.facts)
