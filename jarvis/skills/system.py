"""System info and volume control.

Uses ``psutil`` for richer info when it's installed (``pip install -e
".[system]"``); works without it too. Volume uses what each OS already has:
AppleScript on macOS, ``pactl``/``amixer`` on Linux and the media volume keys
on Windows.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..tools import ToolRegistry

if TYPE_CHECKING:
    from . import SkillsConfig

try:
    import psutil  # type: ignore
except ImportError:  # optional
    psutil = None


def _gb(n: float) -> str:
    return f"{n / 1024**3:.1f} GB"


def _duration(seconds: float) -> str:
    seconds = int(seconds)
    d, rem = divmod(seconds, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    return " ".join(f"{v}{u}" for v, u in ((d, "d"), (h, "h"), (m, "m")) if v) or "under a minute"


def system_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "os": f"{platform.system()} {platform.release()}",
        "computer_name": platform.node(),
        "cpu": platform.processor() or platform.machine(),
        "cpu_cores": os.cpu_count(),
        "python": platform.python_version(),
    }
    disk = shutil.disk_usage(Path.home())
    info["disk"] = f"{_gb(disk.free)} free of {_gb(disk.total)}"
    if psutil:
        info["cpu_use"] = f"{psutil.cpu_percent(interval=0.3)}%"
        mem = psutil.virtual_memory()
        info["memory"] = f"{_gb(mem.available)} free of {_gb(mem.total)} ({mem.percent}% used)"
        info["uptime"] = _duration(time.time() - psutil.boot_time())
        battery = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
        if battery:
            plugged = "charging" if battery.power_plugged else "on battery"
            info["battery"] = f"{round(battery.percent)}% ({plugged})"
    elif hasattr(os, "getloadavg"):
        info["load_average"] = [round(x, 2) for x in os.getloadavg()]
    return info


def _run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=10).stdout


def _windows_keys(key: int, times: int) -> None:
    import ctypes

    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    for _ in range(times):
        user32.keybd_event(key, 0, 0, 0)
        user32.keybd_event(key, 0, 2, 0)  # KEYEVENTF_KEYUP


VK_VOLUME_MUTE, VK_VOLUME_DOWN, VK_VOLUME_UP = 0xAD, 0xAE, 0xAF


def set_volume(level: int, platform_name: str | None = None) -> str:
    level = max(0, min(int(level), 100))
    p = platform_name or sys.platform
    if p == "darwin":
        _run(["osascript", "-e", f"set volume output volume {level}"])
    elif p.startswith("win"):
        # Each key press moves Windows volume by 2%: go to 0, then up.
        _windows_keys(VK_VOLUME_DOWN, 50)
        _windows_keys(VK_VOLUME_UP, round(level / 2))
    elif shutil.which("pactl"):
        _run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level}%"])
    elif shutil.which("amixer"):
        _run(["amixer", "-q", "sset", "Master", f"{level}%"])
    else:
        raise RuntimeError("no volume control found (install pulseaudio-utils or alsa-utils)")
    return f"Volume set to {level}%."


def mute(muted: bool, platform_name: str | None = None) -> str:
    p = platform_name or sys.platform
    if p == "darwin":
        _run(["osascript", "-e", f"set volume output muted {'true' if muted else 'false'}"])
    elif p.startswith("win"):
        # Windows only has a mute *toggle* key; it can't read the current state.
        _windows_keys(VK_VOLUME_MUTE, 1)
        return "Toggled mute."
    elif shutil.which("pactl"):
        _run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1" if muted else "0"])
    elif shutil.which("amixer"):
        _run(["amixer", "-q", "sset", "Master", "mute" if muted else "unmute"])
    else:
        raise RuntimeError("no volume control found (install pulseaudio-utils or alsa-utils)")
    return "Muted." if muted else "Unmuted."


def register(registry: ToolRegistry, config: "SkillsConfig") -> None:
    @registry.tool(
        description=(
            "Get information about the user's computer: operating system, CPU, "
            "memory, free disk space, battery and uptime."
        ),
    )
    def get_system_info() -> dict[str, Any]:
        return system_info()

    @registry.tool(
        name="set_volume",
        description="Set the computer's speaker volume, 0 to 100 percent.",
        parameters={"level": {"type": "integer", "description": "0 to 100"}},
    )
    def set_volume_tool(level: int) -> str:
        return set_volume(level)

    @registry.tool(
        name="mute",
        description="Mute (true) or unmute (false) the computer's sound.",
        parameters={"muted": {"type": "boolean"}},
    )
    def mute_tool(muted: bool) -> str:
        return mute(muted)
