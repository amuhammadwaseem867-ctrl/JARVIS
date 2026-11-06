"""Shared test setup: no test may reach the real internet or a local Ollama."""

from __future__ import annotations

import urllib.error

import pytest

from jarvis import providers


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setenv("JARVIS_OLLAMA", "0")
    for var in [v for v in __import__("os").environ if v.startswith("JARVIS_LIMITS_")]:
        monkeypatch.delenv(var)

    def offline(url, headers, body, timeout):
        raise urllib.error.URLError("network disabled in tests")

    monkeypatch.setattr(providers, "http_post", offline)
    monkeypatch.setattr(providers, "NETWORK_RETRY_WAITS", (0.0, 0.0))
    providers._ollama_cache.clear()
