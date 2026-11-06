"""A tiny JSON-over-HTTPS helper (standard library only)."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

USER_AGENT = "JARVIS-assistant/0.1 (+https://github.com/amuhammadwaseem867-ctrl/JARVIS)"


def get_json(url: str, params: dict[str, Any] | None = None, timeout: float = 10) -> Any:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))
