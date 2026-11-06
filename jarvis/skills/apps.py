"""Open websites and programs on the user's computer."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import webbrowser
from typing import TYPE_CHECKING

from ..tools import ToolRegistry

if TYPE_CHECKING:
    from . import SkillsConfig

# Only plain names: letters, digits, spaces and . + - _ (no shell characters,
# no paths, no arguments).
_APP_NAME = re.compile(r"^[\w][\w .+\-]{0,60}$")

# Friendly names -> what each OS actually launches.
WINDOWS = {
    "calculator": "calc", "file explorer": "explorer", "files": "explorer",
    "settings": "ms-settings:", "camera": "microsoft.windows.camera:",
    "paint": "mspaint", "word": "winword", "powerpoint": "powerpnt",
    "google chrome": "chrome", "edge": "msedge", "microsoft edge": "msedge",
    "visual studio code": "code", "vscode": "code", "photos": "ms-photos:",
    "mail": "outlookmail:", "calendar": "outlookcal:", "maps": "bingmaps:",
    "teams": "msteams:", "spotify": "spotify:", "whatsapp": "whatsapp:",
}
MAC = {
    "calculator": "Calculator", "files": "Finder", "file explorer": "Finder",
    "settings": "System Settings", "chrome": "Google Chrome",
    "edge": "Microsoft Edge", "code": "Visual Studio Code", "vscode": "Visual Studio Code",
    "word": "Microsoft Word", "excel": "Microsoft Excel",
    "powerpoint": "Microsoft PowerPoint", "outlook": "Microsoft Outlook",
    "teams": "Microsoft Teams", "camera": "Photo Booth",
}
LINUX = {
    "calculator": ["gnome-calculator", "kcalc", "galculator"],
    "files": ["nautilus", "dolphin", "thunar", "nemo"],
    "file explorer": ["nautilus", "dolphin", "thunar", "nemo"],
    "settings": ["gnome-control-center", "systemsettings"],
    "chrome": ["google-chrome", "chromium", "chromium-browser"],
    "google chrome": ["google-chrome", "chromium"],
    "vscode": ["code"], "visual studio code": ["code"],
    "notepad": ["gedit", "gnome-text-editor", "kate", "mousepad"],
    "terminal": ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"],
    "music": ["rhythmbox"], "photos": ["eog", "shotwell"],
    "camera": ["cheese"], "mail": ["thunderbird"],
}


def normalize_url(url: str) -> str:
    url = url.strip()
    if not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
        if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", url, re.I):  # mailto:, javascript:, ...
            raise ValueError(f"only web addresses (http/https) can be opened, not '{url}'")
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"only web addresses (http/https) can be opened, not '{url}'")
    return url


def open_url(url: str) -> None:
    if not webbrowser.open(url):
        raise RuntimeError("couldn't find a web browser to open it with")


def launch_command(name: str, platform: str | None = None) -> list[str]:
    """Work out the command that opens app ``name`` on this OS."""
    platform = platform or sys.platform
    key = name.lower()
    if platform.startswith("win"):
        target = WINDOWS.get(key, name)
        # `start` resolves App Paths names (chrome, winword) and URI schemes.
        return ["cmd", "/c", "start", "", target]
    if platform == "darwin":
        return ["open", "-a", MAC.get(key, name)]
    for candidate in LINUX.get(key, []) + [key, key.replace(" ", "-")]:
        path = shutil.which(candidate)
        if path:
            return [path]
    if shutil.which("gtk-launch"):
        return ["gtk-launch", key.replace(" ", "-")]
    raise LookupError(f"couldn't find an app called '{name}' on this computer")


def run_detached(cmd: list[str]) -> None:
    kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL,
                    "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    else:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(cmd, **kwargs)
    if cmd[0] == "open":  # macOS `open` exits quickly and reports a missing app
        if proc.wait(timeout=10) != 0:
            raise LookupError(f"couldn't find an app called '{cmd[-1]}'")


def register(registry: ToolRegistry, config: "SkillsConfig") -> None:
    trusted = set(config.trusted_apps)

    @registry.tool(
        description=(
            "Open a website in the user's web browser. Accepts a full URL or a bare "
            "domain like 'youtube.com'. To search a site, build its search URL, e.g. "
            "https://www.youtube.com/results?search_query=lofi+music."
        ),
        parameters={"url": {"type": "string"}},
    )
    def open_website(url: str) -> str:
        url = normalize_url(url)
        open_url(url)
        return f"Opened {url}"

    @registry.tool(
        description=(
            "Open a program on the user's computer by its name, e.g. 'calculator', "
            "'spotify', 'notepad', 'chrome'. Just the name: no file paths or "
            "command-line arguments. Programs the user hasn't marked as trusted "
            "need their confirmation, which the app asks for."
        ),
        parameters={"name": {"type": "string", "description": "The app's name"}},
    )
    def open_app(name: str) -> str:
        name = name.strip()
        if not _APP_NAME.match(name):
            raise ValueError("give just the app's name, without paths, quotes or arguments")
        cmd = launch_command(name)
        if name.lower() not in trusted:
            registry.ask_user(f"Open the program '{name}'?")
        run_detached(cmd)
        return f"Opened {name}."
