"""Specialist agents that work under JARVIS.

An agent is not a running program. It is a small Markdown file: a header that
says what the agent is for and which tools it may use, and a body that is its
prompt::

    ---
    name: weather
    description: Current weather and forecasts for any city.
    keywords: weather, rain, temperature, forecast, mausam, barish
    tools: get_weather, get_current_time
    tier: small
    max_rounds: 3
    timeout: 30
    ---
    You are JARVIS's weather specialist. ...

Built-in agents live next to this file in ``builtin/``. Your own go in
``~/.jarvis/agents/`` (a file there with the same name replaces the built-in).

At startup the registry reads only the headers, which is cheap even for 50
agents. The prompt is read the first time an agent is used, and only the last
few used agents are kept in memory. Header keys JARVIS doesn't know (such as
``color`` or ``emoji`` in agents written for other tools) are ignored, and a
broken file is skipped and reported rather than stopping JARVIS.
"""

from __future__ import annotations

import logging
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("jarvis.agents")

BUILTIN_DIR = Path(__file__).parent / "builtin"
TIERS = ("small", "medium", "large")
_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")


class AgentFileError(ValueError):
    """An agent file is missing its header or a required field."""


@dataclass
class AgentSpec:
    name: str
    description: str
    path: Path
    keywords: tuple[str, ...] = ()
    tools: tuple[str, ...] = ()
    # Model size the agent needs. Phase 1 uses the main model for all tiers;
    # the budget queue (phase 2) will pick a provider per tier.
    tier: str = "medium"
    # Rounds of tool use before the agent must answer.
    max_rounds: int = 4
    # Seconds the agent may run (time spent waiting for the user to confirm
    # a risky action doesn't count).
    timeout: float = 60.0
    background: bool = False
    # Filled in lazily by ``AgentRegistry.get``.
    prompt: str = field(default="", repr=False)


def _split_list(value: str) -> tuple[str, ...]:
    value = value.strip().strip("[]")
    return tuple(v.strip().strip("'\"") for v in value.split(",") if v.strip().strip("'\""))


def _read_header(path: Path) -> tuple[dict[str, str], str]:
    """Return ``(header fields, prompt body)`` of an agent file."""
    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise AgentFileError("must start with a '---' header")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise AgentFileError("header has no closing '---'") from None
    fields: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        fields[key.strip().lower()] = value.strip().strip("'\"")
    return fields, "\n".join(lines[end + 1 :]).strip()


def parse_agent(path: Path, with_prompt: bool = False) -> AgentSpec:
    """Read an agent file. Raises ``AgentFileError`` if it is unusable."""
    fields, body = _read_header(path)
    name = fields.get("name", "").strip().lower()
    if not _NAME.match(name):
        raise AgentFileError(f"needs a 'name' of lowercase letters, digits and dashes (got {name!r})")
    description = fields.get("description", "").strip()
    if not description:
        raise AgentFileError("needs a 'description'")
    tier = fields.get("tier", "medium").lower()
    if tier not in TIERS:
        raise AgentFileError(f"'tier' must be one of {', '.join(TIERS)} (got {tier!r})")
    try:
        max_rounds = max(1, min(int(fields.get("max_rounds", 4)), 10))
        timeout = max(5.0, min(float(fields.get("timeout", 60)), 600.0))
    except ValueError as exc:
        raise AgentFileError(f"bad number in header: {exc}") from None
    spec = AgentSpec(
        name=name,
        description=description,
        path=path,
        keywords=tuple(k.lower() for k in _split_list(fields.get("keywords", ""))),
        tools=_split_list(fields.get("tools", "")),
        tier=tier,
        max_rounds=max_rounds,
        timeout=timeout,
        background=fields.get("background", "").lower() in ("1", "true", "yes"),
    )
    if with_prompt:
        if not body:
            raise AgentFileError("has no prompt after the header")
        spec.prompt = body
    return spec


class AgentRegistry:
    """Knows every agent by its header; loads prompts only when needed."""

    def __init__(self, dirs: list[Path] | None = None, cache_size: int = 10) -> None:
        self.dirs = dirs if dirs is not None else [BUILTIN_DIR]
        self.cache_size = cache_size
        self._specs: dict[str, AgentSpec] = {}
        self._loaded: OrderedDict[str, AgentSpec] = OrderedDict()
        # (file, problem) for every agent file that couldn't be used.
        self.errors: list[tuple[Path, str]] = []
        self.reload()

    def reload(self) -> None:
        """Re-scan the agent folders (later folders win on name clashes)."""
        self._specs.clear()
        self._loaded.clear()
        self.errors.clear()
        for folder in self.dirs:
            if not folder.is_dir():
                continue
            for path in sorted(folder.glob("*.md")):
                try:
                    spec = parse_agent(path)
                except (AgentFileError, OSError, UnicodeDecodeError) as exc:
                    log.warning("skipping agent file %s: %s", path, exc)
                    self.errors.append((path, str(exc)))
                    continue
                self._specs[spec.name] = spec

    def __contains__(self, name: str) -> bool:
        return name in self._specs

    def __len__(self) -> int:
        return len(self._specs)

    def names(self) -> list[str]:
        return sorted(self._specs)

    def all(self) -> list[AgentSpec]:
        """Every agent's header (prompts not loaded)."""
        return [self._specs[n] for n in self.names()]

    def loaded(self) -> list[str]:
        """Agents whose prompt is currently in memory, oldest first."""
        return list(self._loaded)

    def get(self, name: str) -> AgentSpec:
        """The agent with its prompt loaded. Raises ``KeyError`` or ``AgentFileError``."""
        name = name.strip().lower()
        if name in self._loaded:
            self._loaded.move_to_end(name)
            return self._loaded[name]
        if name not in self._specs:
            raise KeyError(name)
        spec = parse_agent(self._specs[name].path, with_prompt=True)
        self._loaded[name] = spec
        while len(self._loaded) > self.cache_size:
            self._loaded.popitem(last=False)
        return spec
