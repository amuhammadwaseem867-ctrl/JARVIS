"""Settings for the JARVIS brain, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .providers import DEFAULT_MODELS, detect_provider

DEFAULT_SYSTEM_PROMPT = """\
You are JARVIS, a personal AI assistant. You are calm, precise, and a little dry \
in your humour. Address the user as "sir" or "ma'am" only if they ask you to.

Keep spoken-style answers short and direct: lead with the answer, then any detail \
the user needs. Use your tools when they help: check the time instead of guessing it, \
use the calculator for arithmetic, and save things the user asks you to remember \
with the memory tools. When you recall something from memory, say so. If no tool \
can do what the user asked, tell them plainly instead of pretending.

You can search the web, read web pages, check the weather, open websites and apps, \
report on and control the computer (volume, system info) and work with the user's \
files, when those skills are switched on. Search the web for anything recent or \
anything you're unsure of, and mention where the answer came from. For risky actions \
(overwriting, moving or deleting files, opening an unfamiliar program) the app itself \
asks the user to confirm, so just call the tool rather than asking first as well. If a \
tool says the user declined, accept that and don't try another way around it."""


def _data_dir() -> Path:
    return Path(os.environ.get("JARVIS_DATA_DIR", Path.home() / ".jarvis"))


@dataclass
class BrainConfig:
    """Everything the brain needs to know to think.

    Every field can be set from the environment, so the rest of the app
    can just call ``BrainConfig.from_env()``.
    """

    # Which AI service thinks: groq | gemini | claude | ollama (see providers.py).
    provider: str = "claude"
    # Empty means the provider's default model.
    model: str = ""
    # low | medium | high | xhigh | max. Claude Opus 5.5 defaults to medium;
    # we set it explicitly so changing models doesn't silently change depth.
    effort: str = "medium"
    # 0 means the provider's default: 16000 for Claude, 4096 for the free
    # ones (their per-minute token limits count the requested maximum).
    max_tokens: int = 0
    # Safety guard against a runaway tool loop within one user turn.
    max_tool_rounds: int = 20
    # Re-run a declined request on Anthropic's recommended fallback model.
    use_fallbacks: bool = True
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    data_dir: Path = field(default_factory=_data_dir)

    def __post_init__(self) -> None:
        if not self.model:
            self.model = DEFAULT_MODELS.get(self.provider, DEFAULT_MODELS["claude"])
        if not self.max_tokens:
            self.max_tokens = 16000 if self.provider == "claude" else 4096

    @classmethod
    def from_env(cls) -> "BrainConfig":
        provider = detect_provider()
        cfg = cls(provider=provider, model=os.environ.get("JARVIS_MODEL", ""))
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
