"""Tests for phase 2: rate-limit budget, retries, tiers and the cache (no network)."""

from __future__ import annotations

import io
import json
import threading
import time
import urllib.error
from datetime import datetime, timezone
from email.message import Message
from types import SimpleNamespace as NS

import pytest

from jarvis import Brain, BrainConfig, providers
from jarvis.budget import Budget, Limits, estimate_tokens, load_limits, parse_duration
from jarvis.cache import Cache
from jarvis.chat import agent_command
from jarvis.skills import SkillsConfig

KEYS = ("GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY",
        "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY",
        "JARVIS_PROVIDER", "JARVIS_MODEL", "JARVIS_FALLBACK", "JARVIS_GROQ_MODEL",
        "JARVIS_GROQ_SMALL_MODEL", "JARVIS_CACHE", "JARVIS_MAX_WAIT", "JARVIS_MAX_PARALLEL")

# 2026-11-06 12:00 UTC
NOON = datetime(2026, 11, 6, 12, tzinfo=timezone.utc).timestamp()


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in KEYS:
        monkeypatch.delenv(k, raising=False)


def chat_reply(content="ok", tool_calls=None, tokens=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    data = {"model": "m", "choices": [{"message": msg, "finish_reason": "tool_calls" if tool_calls else "stop"}]}
    if tokens is not None:
        data["usage"] = {"total_tokens": tokens}
    return data


class FakePost:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, url, headers, body, timeout):
        self.requests.append(json.loads(json.dumps(body)))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def http_error(status, message, headers=None):
    hdrs = Message()
    for k, v in (headers or {}).items():
        hdrs[k] = v
    body = json.dumps({"error": {"message": message}}).encode()
    return urllib.error.HTTPError("https://x", status, "err", hdrs, io.BytesIO(body))


def free_brain(tmp_path, monkeypatch, *names, skills=()):
    for n in names:
        monkeypatch.setenv(providers.KEY_VARS[n][0], "k")
    return Brain(config=BrainConfig(provider=names[0], data_dir=tmp_path),
                 skills=SkillsConfig(enabled=skills))


# -------------------------------------------------------------------- budget


def test_requests_per_minute():
    now = [NOON]
    b = Budget(limits={"groq": Limits(rpm=2)}, clock=lambda: now[0])
    assert b.wait_time("groq") == 0
    b.reserve("groq", 10)
    now[0] += 10
    b.reserve("groq", 10)
    assert b.wait_time("groq") == pytest.approx(50)
    now[0] += 50.5
    assert b.wait_time("groq") == 0


def test_tokens_per_minute_and_settle():
    now = [NOON]
    b = Budget(limits={"groq": Limits(tpm=1000)}, clock=lambda: now[0])
    t = b.reserve("groq", 900)
    assert b.wait_time("groq", 200) == pytest.approx(60)
    b.settle(t, 300)  # the real call was smaller than estimated
    assert b.wait_time("groq", 200) == 0
    assert b.status()["groq"]["day_tokens"] == 300
    # A call bigger than the whole limit waits for an empty window, then goes.
    assert b.wait_time("groq", 5000) == pytest.approx(60)
    now[0] += 61
    assert b.wait_time("groq", 5000) == 0


def test_daily_limit_waits_for_utc_midnight_and_resets():
    now = [NOON]
    b = Budget(limits={"gemini": Limits(rpd=1)}, clock=lambda: now[0])
    b.reserve("gemini", 1)
    assert b.wait_time("gemini") == pytest.approx(12 * 3600)
    now[0] += 12 * 3600 + 1
    assert b.wait_time("gemini") == 0


def test_today_survives_a_restart_but_not_a_new_day(tmp_path):
    now = [NOON]
    path = tmp_path / "budget.json"
    b = Budget(path, limits={"gemini": Limits(rpd=2)}, clock=lambda: now[0])
    b.settle(b.reserve("gemini", 100), 150)
    b.rest("gemini", 30, "rate limited")
    again = Budget(path, limits={"gemini": Limits(rpd=2)}, clock=lambda: now[0])
    s = again.status()["gemini"]
    assert (s["day_requests"], s["day_tokens"], s["resting"]) == (1, 150, 30)
    now[0] += 86400
    tomorrow = Budget(path, limits={"gemini": Limits(rpd=2)}, clock=lambda: now[0])
    assert tomorrow.status() == {}


def test_corrupt_budget_file_is_ignored(tmp_path):
    (tmp_path / "budget.json").write_text("{nope", encoding="utf-8")
    assert Budget(tmp_path / "budget.json").status() == {}


def test_limits_from_file_and_env(tmp_path, monkeypatch):
    (tmp_path / "limits.json").write_text(json.dumps({"groq": {"rpm": 5}, "new": {"rpd": 9}}))
    monkeypatch.setenv("JARVIS_LIMITS_GROQ", "tpm=123, rpd=7")
    limits = load_limits(tmp_path)
    assert limits["groq"] == Limits(rpm=5, tpm=123, rpd=7, tpd=200_000)
    assert limits["new"].rpd == 9
    assert limits["ollama"] == Limits()


def test_best_orders_ready_providers_first():
    now = [NOON]
    b = Budget(limits={"groq": Limits(rpm=1), "gemini": Limits(rpm=1), "mistral": Limits()},
               clock=lambda: now[0])
    b.reserve("groq", 1)
    now[0] += 30
    b.reserve("gemini", 1)
    assert b.best(["groq", "gemini", "mistral"], 1) == ["mistral", "groq", "gemini"]


def test_slots_limit_parallel_calls():
    b = Budget(limits={}, max_parallel=2)
    running, peak, lock = [0], [0], threading.Lock()

    def work():
        with b.slot():
            with lock:
                running[0] += 1
                peak[0] = max(peak[0], running[0])
            time.sleep(0.05)
            with lock:
                running[0] -= 1

    threads = [threading.Thread(target=work) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak[0] == 2


@pytest.mark.parametrize("text, seconds", [
    ("30", 30), ("7.66s", 7.66), ("2m59.5s", 179.5), ("1h2m", 3720), ("120ms", 0.12),
    ("", None), ("soon", None), ("5x", None),
])
def test_parse_duration(text, seconds):
    assert parse_duration(text) == (pytest.approx(seconds) if seconds is not None else None)


def test_estimate_counts_prompt_and_expected_output():
    small = estimate_tokens("hi", [], [])
    big = estimate_tokens("x" * 4000, [{"role": "user", "content": "y" * 4000}], [])
    assert big - small >= 1900


# ----------------------------------------------------- providers + budget


def test_retry_after_header_rests_the_provider(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    brain.provider.post = FakePost(http_error(429, "slow down", {"retry-after": "42"}))
    with pytest.raises(providers.RateLimited) as info:
        brain.provider.create("s", [{"role": "user", "content": "hi"}], [])
    assert info.value.retry_after == 42
    assert brain.budget.status()["groq"]["resting"] == 42


def test_groq_reset_headers_and_daily_message():
    p = providers.OpenAICompatProvider("groq", "https://x", "k", BrainConfig(provider="groq"))
    hdrs = Message()
    hdrs["x-ratelimit-reset-requests"] = "2m"
    hdrs["x-ratelimit-reset-tokens"] = "7.5s"
    assert p._error(429, "{}", hdrs).retry_after == 120
    daily = p._error(429, json.dumps({"error": {"message": "Rate limit reached: requests per day (RPD)"}}))
    assert daily.retry_after == 3600
    assert p._error(429, "{}").retry_after is None


def test_full_provider_is_skipped_without_a_request(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq", "gemini")
    groq, gemini = brain.provider.providers
    groq.post, gemini.post = FakePost(), FakePost(chat_reply("From Gemini."))
    brain.budget.limits["groq"] = Limits(rpm=1)
    brain.budget.reserve("groq", 10)  # Groq used its one request this minute
    assert brain.think("hi").text == "From Gemini."
    assert groq.post.requests == []


def test_short_wait_sleeps_instead_of_switching(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    p = brain.provider
    slept = []
    p.sleep = slept.append
    p.post = FakePost(chat_reply("hi"))
    brain.budget.limits["groq"] = Limits(rpm=1)
    brain.budget.reserve("groq", 10)
    brain.budget._usage["groq"].minute[0][0] -= 55  # frees up in ~5 s
    assert brain.think("hi").text == "hi"
    assert slept and 4 < slept[0] <= 5.5


def test_usage_from_reply_is_recorded(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    brain.provider.post = FakePost(chat_reply("hi", tokens=1234))
    brain.think("hello")
    s = brain.budget.status()["groq"]
    assert (s["day_requests"], s["day_tokens"]) == (1, 1234)
    assert json.loads((tmp_path / "budget.json").read_text())["providers"]["groq"]["tokens"] == 1234


def test_network_hiccup_is_retried_but_timeout_is_not(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    p = brain.provider
    p.sleep = lambda s: None
    p.post = FakePost(urllib.error.URLError("reset"), chat_reply("made it"))
    assert brain.think("hi").text == "made it"
    p.post = FakePost(urllib.error.URLError(TimeoutError("timed out")), chat_reply("never"))
    with pytest.raises(providers.ConnectionFailed):
        p.create("s", [{"role": "user", "content": "x"}], [])
    assert len(p.post.requests) == 1


def test_tiers_limit_output_and_can_pick_a_model(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_GROQ_SMALL_MODEL", "llama-3.1-8b-instant")
    brain = free_brain(tmp_path, monkeypatch, "groq")
    brain.provider.post = fake = FakePost(chat_reply(), chat_reply(), chat_reply())
    msgs = [{"role": "user", "content": "x"}]
    brain.provider.create("s", msgs, [], tier="small")
    brain.provider.create("s", msgs, [], tier="large")
    brain.provider.create("s", msgs, [])
    assert [(r["model"], r["max_tokens"]) for r in fake.requests] == [
        ("llama-3.1-8b-instant", 1024), ("openai/gpt-oss-120b", 4096), ("openai/gpt-oss-120b", 4096)]


def test_agents_send_their_tier(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    brain.provider.post = fake = FakePost(chat_reply("Shab bakhair"))
    assert brain.run_agent("translator", "good night").ok  # translator is "medium"
    assert fake.requests[0]["max_tokens"] == 2048


def test_ollama_is_added_as_last_resort_when_running(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(providers, "ollama_model", lambda: "qwen3:8b")
    assert providers.fallback_names("groq") == ["ollama"]
    monkeypatch.setattr(providers, "ollama_model", lambda: "")
    assert providers.fallback_names("groq") == []


def test_ollama_probe_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("JARVIS_OLLAMA", "0")
    assert providers.ollama_model() == ""


# --------------------------------------------------------------------- cache


def test_cache_expires_and_survives_restart(tmp_path):
    now = [100.0]
    c = Cache(tmp_path / "c.db", clock=lambda: now[0])
    c.put("ns", "k", "v", ttl=10)
    assert Cache(tmp_path / "c.db", clock=lambda: now[0]).get("ns", "k") == "v"
    now[0] = 111
    assert c.get("ns", "k") is None
    assert c.stats()["entries"] == 0


def test_corrupt_cache_file_falls_back_to_memory(tmp_path):
    (tmp_path / "c.db").write_bytes(b"not a database at all" * 100)
    c = Cache(tmp_path / "c.db")
    c.put("ns", "k", "v", 10)
    assert c.get("ns", "k") == "v"


def test_weather_results_are_cached_but_time_is_not(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    calls = []

    @brain.tools.tool(description="w", parameters={"city": {"type": "string"}}, name="get_weather")
    def weather(city):
        calls.append(city)
        return f"Sunny in {city}"

    assert brain.tools.run("get_weather", {"city": "Lahore"}) == ("Sunny in Lahore", False)
    assert brain.tools.run("get_weather", {"city": "Lahore"}) == ("Sunny in Lahore", False)
    assert brain.tools.run("get_weather", {"city": "Karachi"})[0] == "Sunny in Karachi"
    assert calls == ["Lahore", "Karachi"]
    t1 = brain.tools.run("get_current_time", {"timezone": "UTC"})[0]
    time.sleep(1.1)
    assert brain.tools.run("get_current_time", {"timezone": "UTC"})[0] != t1


def test_agent_answers_are_reused_only_when_safe(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    brain.provider.post = fake = FakePost(
        chat_reply("Shab bakhair"),
        chat_reply(None, [{"id": "c1", "type": "function",
                           "function": {"name": "get_current_time", "arguments": '{"timezone": ""}'}}]),
        chat_reply("It's noon."),
        chat_reply(None, [{"id": "c2", "type": "function",
                           "function": {"name": "get_current_time", "arguments": '{"timezone": ""}'}}]),
        chat_reply("It's 12:01."),
    )
    first = brain.run_agent("translator", "Good night")
    again = brain.run_agent("translator", "  good   NIGHT ")
    assert (first.cached, again.cached, again.text) == (False, True, "Shab bakhair")
    assert agent_command(brain, "/agent translator good night") == "[translator, from cache] Shab bakhair"

    brain.agents.get("weather").tools = ("get_current_time",)
    assert brain.run_agent("weather", "what time").text == "It's noon."
    assert brain.run_agent("weather", "what time").text == "It's 12:01."  # time: never reused
    assert len(fake.requests) == 5


def test_cache_can_be_switched_off(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_CACHE", "0")
    brain = free_brain(tmp_path, monkeypatch, "groq")
    assert brain.cache is None and brain.tools.cache is None
    assert "Cache:" not in agent_command(brain, "/status")


def test_status_shows_free_tier_use(tmp_path, monkeypatch):
    brain = free_brain(tmp_path, monkeypatch, "groq")
    brain.provider.post = FakePost(chat_reply("hi", tokens=500))
    brain.think("hello")
    status = agent_command(brain, "/status")
    assert "groq" in status and "1/30 req" in status and "1/1000 req" in status
    assert "Cache:" in status
