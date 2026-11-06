"""Tests for the free providers (Groq, Gemini, Ollama) and the local web tools.

No network: the HTTP call is replaced by a fake that records requests.
"""

from __future__ import annotations

import io
import json
import urllib.error

import pytest

from jarvis import Brain, BrainConfig
from jarvis import providers
from jarvis.chat import FatalError, ask
from jarvis.skills import SkillsConfig
from jarvis.skills.web import _check_public, html_to_text, parse_results

KEYS = ("GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY",
        "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY",
        "JARVIS_PROVIDER", "JARVIS_MODEL", "JARVIS_FALLBACK", "JARVIS_GROQ_MODEL")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in KEYS:
        monkeypatch.delenv(k, raising=False)


def chat_reply(content=None, tool_calls=None, finish="stop"):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"model": "openai/gpt-oss-120b",
            "choices": [{"message": msg, "finish_reason": finish}]}


def call(id_, name, args, **extra):
    return {"id": id_, "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)}, **extra}


class FakePost:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, url, headers, body, timeout):
        self.requests.append({"url": url, "headers": headers, "body": json.loads(json.dumps(body))})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def http_error(status, body):
    return urllib.error.HTTPError("https://x", status, "err", {}, io.BytesIO(json.dumps(body).encode()))


def make_brain(tmp_path, monkeypatch, *replies, provider="groq", skills=("web",)):
    monkeypatch.setenv(providers.KEY_VARS[provider][0] if providers.KEY_VARS[provider] else "X", "k")
    brain = Brain(config=BrainConfig(provider=provider, data_dir=tmp_path),
                  skills=SkillsConfig(enabled=skills))
    fake = FakePost(*replies)
    brain.provider.post = fake
    return brain, fake


# ---------------------------------------------------------------- choosing

def test_groq_key_is_preferred(monkeypatch):
    assert providers.detect_provider() == "claude"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a")
    assert providers.detect_provider() == "claude"
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    assert providers.detect_provider() == "gemini"
    monkeypatch.setenv("GROQ_API_KEY", "q")
    assert providers.detect_provider() == "groq"
    monkeypatch.setenv("JARVIS_PROVIDER", "Claude")
    assert providers.detect_provider() == "claude"
    monkeypatch.setenv("JARVIS_PROVIDER", "openai")
    with pytest.raises(providers.SetupError):
        providers.detect_provider()


def test_config_uses_provider_default_model(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "q")
    cfg = BrainConfig.from_env()
    assert (cfg.provider, cfg.model) == ("groq", "openai/gpt-oss-120b")
    monkeypatch.setenv("JARVIS_MODEL", "openai/gpt-oss-20b")
    assert BrainConfig.from_env().model == "openai/gpt-oss-20b"
    assert BrainConfig().model == "claude-opus-5-5"
    monkeypatch.delenv("JARVIS_MODEL")
    monkeypatch.setenv("JARVIS_GROQ_MODEL", "qwen/qwen3.6-27b")
    assert BrainConfig.from_env().model == "qwen/qwen3.6-27b"


def test_missing_key_says_where_to_get_one(tmp_path):
    with pytest.raises(providers.SetupError, match="console.groq.com"):
        Brain(config=BrainConfig(provider="groq", data_dir=tmp_path))


def test_ollama_needs_no_key(tmp_path):
    brain = Brain(config=BrainConfig(provider="ollama", data_dir=tmp_path))
    assert brain.provider.url == "http://localhost:11434/v1/chat/completions"


# ---------------------------------------------------------------- the loop

def test_groq_tool_loop(tmp_path, monkeypatch):
    brain, fake = make_brain(
        tmp_path, monkeypatch,
        chat_reply(tool_calls=[call("c1", "calculate", {"expression": "6*7"})],
                   finish="tool_calls"),
        chat_reply("It's 42."),
    )
    reply = brain.think("6 times 7?")

    assert reply.text == "It's 42."
    assert [c.result for c in reply.tool_calls] == ["42"]
    first = fake.requests[0]
    assert first["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert first["headers"]["Authorization"] == "Bearer k"
    body = first["body"]
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1] == {"role": "user", "content": "6 times 7?"}
    names = [t["function"]["name"] for t in body["tools"]]
    # Local web tools instead of Anthropic's server tools.
    assert "web_search" in names and "web_fetch" in names
    assert all(t["type"] == "function" for t in body["tools"])

    second = fake.requests[1]["body"]["messages"]
    assert second[2]["role"] == "assistant"
    assert second[2]["tool_calls"][0]["function"] == {
        "name": "calculate", "arguments": '{"expression": "6*7"}'}
    assert second[3] == {"role": "tool", "tool_call_id": "c1", "content": "42"}


def test_gemini_schema_and_thought_signature(tmp_path, monkeypatch):
    sig = {"extra_content": {"google": {"thought_signature": "abc"}}}
    brain, fake = make_brain(
        tmp_path, monkeypatch,
        chat_reply(tool_calls=[call("g1", "calculate", {"expression": "1+1"}, **sig)]),
        chat_reply("Two."),
        provider="gemini", skills=(),
    )
    assert brain.think("1+1").text == "Two."
    body = fake.requests[0]["body"]
    assert fake.requests[0]["url"].startswith("https://generativelanguage.googleapis.com/")
    for t in body["tools"]:
        assert "additionalProperties" not in t["function"].get("parameters", {})
    # The signature Gemini sent is handed back with the call.
    assert fake.requests[1]["body"]["messages"][2]["tool_calls"][0]["extra_content"] == sig["extra_content"]


def test_bad_tool_arguments_reach_the_model_as_an_error(tmp_path, monkeypatch):
    bad = {"id": "c1", "type": "function", "function": {"name": "calculate", "arguments": "{oops"}}
    brain, fake = make_brain(tmp_path, monkeypatch, chat_reply(tool_calls=[bad]), chat_reply("Sorry."))
    reply = brain.think("hi")
    assert reply.tool_calls[0].is_error


def test_groq_tool_use_failed_is_retried_once(tmp_path, monkeypatch):
    brain, fake = make_brain(
        tmp_path, monkeypatch,
        http_error(400, {"error": {"message": "Failed to call a function", "code": "tool_use_failed"}}),
        chat_reply("Fine."),
    )
    assert brain.think("hi").text == "Fine."
    assert len(fake.requests) == 2


def test_errors_become_messages(tmp_path, monkeypatch):
    brain, _ = make_brain(tmp_path, monkeypatch,
                          http_error(429, {"error": {"message": "slow down"}}))
    assert "rate limit" in ask(brain, "hi")
    assert brain.memory.messages == []  # failed turn rolled back

    brain, _ = make_brain(tmp_path, monkeypatch,
                          http_error(401, {"error": {"message": "Invalid API Key"}}))
    with pytest.raises(FatalError, match="GROQ_API_KEY"):
        ask(brain, "hi")

    monkeypatch.setenv("JARVIS_FALLBACK", "none")  # Groq's key is still set
    brain, _ = make_brain(tmp_path, monkeypatch, provider="gemini", skills=())
    brain.provider.post = FakePost(
        http_error(400, [{"error": {"message": "API key not valid. Please pass a valid API key."}}]))
    with pytest.raises(FatalError, match="GEMINI_API_KEY"):
        ask(brain, "hi")


def test_anthropic_low_credit_points_to_free_model(tmp_path):
    import anthropic
    from types import SimpleNamespace as NS

    class Client:
        def __init__(self):
            self.messages = self.beta = self
            self.beta.messages = self

        def create(self, **_):
            err = anthropic.BadRequestError.__new__(anthropic.BadRequestError)
            Exception.__init__(err, "credit")
            err.status_code, err.response, err.body = 400, NS(status_code=400, headers={}), None
            err.message = "Your credit balance is too low to access the Anthropic API."
            raise err

    brain = Brain(config=BrainConfig(data_dir=tmp_path), client=Client())
    with pytest.raises(FatalError, match="GROQ_API_KEY"):
        ask(brain, "hi")


# ---------------------------------------------------------- switching

CLAUDE_HISTORY = [
    {"role": "user", "content": "news?"},
    {"role": "assistant", "content": [
        {"type": "thinking", "thinking": "...", "signature": "s"},
        {"type": "server_tool_use", "id": "srv1", "name": "web_search", "input": {"query": "x"}},
        {"type": "web_search_tool_result", "tool_use_id": "srv1", "content": []},
        {"type": "text", "text": "Here you go."},
    ]},
    {"role": "user", "content": "and the time?"},
    {"role": "assistant", "content": [
        {"type": "tool_use", "id": "toolu_1", "name": "get_current_time", "input": {"timezone": ""}}]},
    {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_1", "content": "noon", "is_error": False}]},
]


def test_claude_history_translates_to_openai():
    out = providers.to_openai(CLAUDE_HISTORY)
    assert out[1] == {"role": "assistant", "content": "Here you go."}
    assert out[3]["tool_calls"][0]["id"] == "toolu_1"
    assert out[4] == {"role": "tool", "tool_call_id": "toolu_1", "content": "noon"}


def test_free_model_history_is_cleaned_for_claude():
    history = [
        {"role": "assistant", "content": [{"type": "tool_use", "id": "call:1", "name": "calc",
                                           "input": {}, "provider": "gemini", "extra": {"x": 1}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call:1", "content": "2"}]},
    ]
    out = providers._claude_safe(history + CLAUDE_HISTORY)
    assert out[0]["content"][0] == {"type": "tool_use", "id": "call_1", "name": "calc", "input": {}}
    assert out[1]["content"][0]["tool_use_id"] == "call_1"
    assert out[2:] == CLAUDE_HISTORY  # Claude's own turns untouched


# --------------------------------------------------------------- web tools

DDG_HTML = """
<div class="result results_links"><h2 class="result__title">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Example <b>A</b></a>
</h2><a class="result__snippet" href="#">First &amp; best   snippet</a></div>
<div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
<div class="result"><a class="result__a" href="https://b.org/">B</a>
<a class="result__snippet">Second</a></div>
"""


def test_duckduckgo_results_are_parsed():
    assert parse_results(DDG_HTML) == [
        {"title": "Example A", "url": "https://example.com/a", "snippet": "First & best snippet"},
        {"title": "B", "url": "https://b.org/", "snippet": "Second"},
    ]


def test_html_to_text():
    title, text = html_to_text(
        "<html><head><title> Hi </title><style>x{}</style></head>"
        "<body><nav>menu</nav><h1>Head</h1><p>One &lt;two&gt;</p><script>bad()</script></body></html>")
    assert title == "Hi"
    assert text == "Head\nOne <two>"


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://localhost:8765/", "file:///etc/passwd",
                                 "http://192.168.1.1/admin"])
def test_fetch_refuses_local_addresses(url):
    with pytest.raises(ValueError):
        _check_public(url)


# ------------------------------------------------- more providers, fallback

def test_new_providers_are_detected_in_order(monkeypatch):
    monkeypatch.setenv("CEREBRAS_API_KEY", "c")
    assert providers.detect_provider() == "cerebras"
    monkeypatch.setenv("MISTRAL_API_KEY", "m")
    assert providers.detect_provider() == "mistral"
    monkeypatch.setenv("OPENROUTER_API_KEY", "o")
    assert providers.detect_provider() == "openrouter"
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    assert providers.detect_provider() == "gemini"


@pytest.mark.parametrize("name,url", [
    ("cerebras", "https://api.cerebras.ai/v1/chat/completions"),
    ("openrouter", "https://openrouter.ai/api/v1/chat/completions"),
    ("mistral", "https://api.mistral.ai/v1/chat/completions"),
])
def test_new_providers_talk_openai_format(tmp_path, monkeypatch, name, url):
    brain, fake = make_brain(tmp_path, monkeypatch, chat_reply("Hi."), provider=name, skills=())
    assert brain.think("hello").text == "Hi."
    req = fake.requests[0]
    assert req["url"] == url
    assert req["body"]["model"] == providers.DEFAULT_MODELS[name]


def test_mistral_gets_nine_character_ids():
    out = providers.to_openai(CLAUDE_HISTORY, providers._mistral_id)
    new_id = out[3]["tool_calls"][0]["id"]
    assert len(new_id) == 9 and new_id.isalnum()
    assert out[4]["tool_call_id"] == new_id
    assert providers._mistral_id("abcDEF123") == "abcDEF123"


def test_fallback_list(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "q")
    assert providers.fallback_names("groq") == []
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("CEREBRAS_API_KEY", "c")
    assert providers.fallback_names("groq") == ["gemini", "cerebras"]
    assert providers.fallback_names("claude") == []
    monkeypatch.setenv("JARVIS_FALLBACK", "gemini,mistral")  # no Mistral key: skipped
    assert providers.fallback_names("groq") == ["gemini"]
    monkeypatch.setenv("JARVIS_FALLBACK", "none")
    assert providers.fallback_names("groq") == []
    monkeypatch.setenv("JARVIS_FALLBACK", "teleport")
    with pytest.raises(providers.SetupError):
        providers.fallback_names("groq")


def test_switches_provider_on_rate_limit(tmp_path, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "q")
    monkeypatch.setenv("CEREBRAS_API_KEY", "c")
    monkeypatch.setenv("JARVIS_GROQ_MODEL", "openai/gpt-oss-20b")
    brain = Brain(config=BrainConfig(provider="groq", data_dir=tmp_path), skills=SkillsConfig(enabled=()))
    fb = brain.provider
    assert [p.name for p in fb.providers] == ["groq", "cerebras"]
    groq, cerebras = fb.providers
    assert groq.model == "openai/gpt-oss-120b"  # BrainConfig's model wins for the main one
    now = [0.0]
    fb.clock = lambda: now[0]
    switches = []
    fb.on_switch = lambda a, b, e: switches.append((a, b))
    groq.post = FakePost(http_error(429, {"error": {"message": "limit"}}), chat_reply("Groq again."))
    cerebras.post = FakePost(chat_reply("From Cerebras."), chat_reply("Still Cerebras."))

    assert brain.think("one").text == "From Cerebras."
    assert switches == [("groq", "cerebras")]
    now[0] = 30  # Groq is still resting: goes straight to Cerebras
    assert brain.think("two").text == "Still Cerebras."
    assert len(groq.post.requests) == 1
    now[0] = 61  # rested: back to Groq
    assert brain.think("three").text == "Groq again."


def test_all_providers_failing_reports_the_first_error(tmp_path, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "q")
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    brain = Brain(config=BrainConfig(provider="groq", data_dir=tmp_path), skills=SkillsConfig(enabled=()))
    groq, gemini = brain.provider.providers
    groq.post = FakePost(http_error(429, {"error": {"message": "limit"}}))
    gemini.post = FakePost(http_error(503, {"error": {"message": "busy"}}))
    assert "rate limit" in ask(brain, "hi")
