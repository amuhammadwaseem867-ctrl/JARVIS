"""Settings for the JARVIS brain, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_SYSTEM_PROMPT = """\
You are JARVIS, a personal AI assistant. You are calm, precise, and a little dry \
in your humour. Address the user as "sir" or "ma'am" only if they ask you to.

Keep spoken-style answers short and direct: lead with the answer, then any detail \
the user needs. Use your tools when they help: check the time instead of guessing it, \
use the calculator for arithmetic, and save things the user asks you to remember \
with the memory tools. When you recall something from memory, say so. If no tool \
can do what the user asked, tell them plainly instead of pretending."""


def _data_dir() -> Path:
    return Path(os.environ.get("JARVIS_DATA_DIR", Path.home() / ".jarvis"))


@dataclass
class BrainConfig:
    """Everything the brain needs to know to think.

    Every field can be set from the environment, so the rest of the app
    can just call ``BrainConfig.from_env()``.
    """

    model: str = "claude-opus-5-5"
    # low | medium | high | xhigh | max. Claude Opus 5.5 defaults to medium;
    # we set it explicitly so changing models doesn't silently change depth.
    effort: str = "medium"
    max_tokens: int = 16000
    # Safety guard against a runaway tool loop within one user turn.
    max_tool_rounds: int = 20
    # Re-run a declined request on Anthropic's recommended fallback model.
    use_fallbacks: bool = True
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    data_dir: Path = field(default_factory=_data_dir)

    @classmethod
    def from_env(cls) -> "BrainConfig":
        cfg = cls()
        cfg.model = os.environ.get("JARVIS_MODEL", cfg.model)
        cfg.effort = os.environ.get("JARVIS_EFFORT", cfg.effort)
        cfg.max_tokens = int(os.environ.get("JARVIS_MAX_TOKENS", cfg.max_tokens))
        cfg.max_tool_rounds = int(
            os.environ.get("JARVIS_MAX_TOOL_ROUNDS", cfg.max_tool_rounds)
        )
        cfg.use_fallbacks = os.environ.get("JARVIS_FALLBACKS", "1") not in ("0", "false", "no")
        prompt_file = os.environ.get("JARVIS_SYSTEM_PROMPT_FILE")
        if prompt_file:
            cfg.system_prompt = Path(prompt_file).read_text(encoding="utf-8")
        return cfg

    @property
    def conversation_path(self) -> Path:
        return self.data_dir / "conversation.json"

    @property
    def facts_path(self) -> Path:
        return self.data_dir / "facts.json"
