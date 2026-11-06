"""Real-world skills for JARVIS, built on the tool registry.

Each skill group lives in its own module and is switched on or off with the
``JARVIS_SKILLS`` environment variable (default: all of them)::

    JARVIS_SKILLS=web,weather,apps,system,files   # the default
    JARVIS_SKILLS=web,weather                     # only these two
    JARVIS_SKILLS=none                            # no extra skills

| group     | tools                                                         |
|-----------|---------------------------------------------------------------|
| web       | web_search, web_fetch (Anthropic's with Claude, DuckDuckGo otherwise) |
| weather   | get_weather (Open-Meteo, no API key)                          |
| apps      | open_website, open_app                                        |
| system    | get_system_info, set_volume, mute                             |
| files     | list_files, find_files, read_file, write_file, move_file, delete_file |

Risky actions (overwriting, moving or deleting files, opening a program that
isn't on the trusted list) ask the user first through ``registry.ask_user``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from ..tools import ToolRegistry

ALL_SKILLS = ("web", "weather", "apps", "system", "files")

DEFAULT_TRUSTED_APPS = (
    "calculator", "calendar", "camera", "chrome", "google chrome", "code",
    "visual studio code", "vscode", "discord", "edge", "microsoft edge", "excel",
    "explorer", "file explorer", "files", "finder", "firefox", "mail", "maps",
    "music", "notepad", "notes", "outlook", "paint", "photos", "powerpoint",
    "safari", "settings", "slack", "spotify", "teams", "textedit", "vlc",
    "whatsapp", "word", "zoom",
)


def _csv(value: str) -> list[str]:
    return [v.strip().lower() for v in value.split(",") if v.strip()]


@dataclass
class SkillsConfig:
    enabled: tuple[str, ...] = ALL_SKILLS
    # Weather: a default place for "what's the weather?" and the unit system.
    home_location: str = ""
    units: str = "metric"  # or "imperial"
    # Apps that open without asking first. Anything else needs a yes.
    trusted_apps: tuple[str, ...] = DEFAULT_TRUSTED_APPS
    # File tools can only touch paths inside this folder.
    files_root: Path = field(default_factory=Path.home)
    # Web search: how many searches Claude may run per request.
    max_web_searches: int = 5

    @classmethod
    def from_env(cls) -> "SkillsConfig":
        cfg = cls()
        skills = os.environ.get("JARVIS_SKILLS")
        if skills is not None:
            names = _csv(skills)
            cfg.enabled = () if names in ([], ["none"]) else tuple(names)
            unknown = set(cfg.enabled) - set(ALL_SKILLS)
            if unknown:
                raise ValueError(
                    f"Unknown skill(s) in JARVIS_SKILLS: {', '.join(sorted(unknown))}. "
                    f"Choose from: {', '.join(ALL_SKILLS)}"
                )
        cfg.home_location = os.environ.get("JARVIS_HOME_LOCATION", cfg.home_location)
        cfg.units = os.environ.get("JARVIS_UNITS", cfg.units).lower()
        extra = _csv(os.environ.get("JARVIS_TRUSTED_APPS", ""))
        cfg.trusted_apps = tuple(dict.fromkeys(cfg.trusted_apps + tuple(extra)))
        root = os.environ.get("JARVIS_FILES_ROOT")
        if root:
            cfg.files_root = Path(root).expanduser()
        cfg.max_web_searches = int(os.environ.get("JARVIS_MAX_WEB_SEARCHES", cfg.max_web_searches))
        return cfg


def register_skills(
    registry: ToolRegistry, config: SkillsConfig | None = None, server_web: bool = True
) -> None:
    """Add every enabled skill group's tools to ``registry``.

    ``server_web`` uses Anthropic's own web search (Claude only). Other
    providers get JARVIS's built-in DuckDuckGo search and page reader instead.
    """
    from . import apps, files, system, weather, web

    config = config or SkillsConfig.from_env()
    modules = {"web": web, "weather": weather, "apps": apps, "system": system, "files": files}
    for name in config.enabled:
        if name == "web":
            web.register(registry, config, server=server_web)
        else:
            modules[name].register(registry, config)


__all__ = ["ALL_SKILLS", "SkillsConfig", "register_skills"]
