"""Which AI model JARVIS thinks with.

JARVIS can run on several providers. Pick one with ``JARVIS_PROVIDER`` (or
``python -m jarvis --provider groq``). Without it, JARVIS uses the first
provider whose API key it finds, in this order:

| provider   | key variable          | cost                        | default model            |
|------------|-----------------------|-----------------------------|--------------------------|
| groq       | ``GROQ_API_KEY``      | free tier, no card          | llama-3.3-70b-versatile  |
| cerebras   | ``CEREBRAS_API_KEY``  | free tier, no card          | gpt-oss-120b             |
| gemini     | ``GEMINI_API_KEY``    | free tier, no card          | gemini-2.5-flash         |
| openrouter | ``OPENROUTER_API_KEY``| free models, no card        | openrouter/free          |
| mistral    | ``MISTRAL_API_KEY``   | free "Experiment" plan      | mistral-small-latest     |
| claude     | ``ANTHROPIC_API_KEY`` | paid                        | claude-opus-5-5          |
| ollama     | none                  | free, runs on your computer | llama3.1                 |

``JARVIS_<PROVIDER>_MODEL`` (e.g. ``JARVIS_GROQ_MODEL``) changes one
provider's model; ``JARVIS_MODEL`` changes the main provider's model.

**Auto-switch.** When the main free provider hits its rate limit (or fails),
JARVIS asks the next free provider you have a key for, so you can keep
talking. ``JARVIS_FALLBACK`` controls it: ``auto`` (default: every other free
provider with a key), a list such as ``cerebras,gemini``, or ``none``.

All the free providers speak the OpenAI "chat completions" format, so one
small client (standard library only, no extra packages) covers them all.

The conversation is always stored in Claude's message format, whichever
provider is active. ``OpenAICompatProvider`` translates it on the way out and
translates each answer back, so the rest of JARVIS never sees the difference
and you can switch providers without losing the conversation.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("jarvis.providers")

PROVIDERS = ("groq", "cerebras", "gemini", "openrouter", "mistral", "claude", "ollama")
# Free providers that need a key, in the order JARVIS prefers them.
FREE_PROVIDERS = ("groq", "cerebras", "gemini", "openrouter", "mistral")

DEFAULT_MODELS = {
    "claude": "claude-opus-5-5",
    "groq": "llama-3.3-70b-versatile",
    "cerebras": "gpt-oss-120b",
    "gemini": "gemini-2.5-flash",
    # OpenRouter's own router: picks a free model that supports tools.
    "openrouter": "openrouter/free",
    "mistral": "mistral-small-latest",
    "ollama": "llama3.1",
}

BASE_URLS = {
    "groq": "https://api.groq.com/openai/v1",
    "cerebras": "https://api.cerebras.ai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "openrouter": "https://openrouter.ai/api/v1",
    "mistral": "https://api.mistral.ai/v1",
    "ollama": "http://localhost:11434/v1",
}

KEY_VARS = {
    "groq": ("GROQ_API_KEY",),
    "cerebras": ("CEREBRAS_API_KEY",),
    "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "openrouter": ("OPENROUTER_API_KEY",),
    "mistral": ("MISTRAL_API_KEY",),
    "claude": ("ANTHROPIC_API_KEY",),
    "ollama": (),
}

KEY_PAGES = {
    "groq": "https://console.groq.com/keys",
    "cerebras": "https://cloud.cerebras.ai",
    "gemini": "https://aistudio.google.com/apikey",
    "openrouter": "https://openrouter.ai/keys",
    "mistral": "https://console.mistral.ai/api-keys",
    "claude": "https://platform.claude.com",
}

# Seconds to skip a provider after it hit its rate limit or failed.
COOLDOWN = 60.0

FALLBACK_BETA = "server-side-fallback-2026-07-01"


# --------------------------------------------------------------------- errors


class ProviderError(Exception):
    """Something went wrong talking to a non-Claude provider."""

    def __init__(self, message: str, provider: str = "", status: int | None = None):
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.status = status


class AuthError(ProviderError):
    """Missing or wrong API key."""


class RateLimited(ProviderError):
    """Too many requests (the free tiers have per-minute limits)."""


class ConnectionFailed(ProviderError):
    """Couldn't reach the provider at all."""


class SetupError(RuntimeError):
    """The chosen provider can't start (unknown name, no key...)."""


# ------------------------------------------------------------------ choosing


def _key_for(provider: str) -> str:
    for var in KEY_VARS.get(provider, ()):
        if os.environ.get(var):
            return os.environ[var]
    return ""


def detect_provider() -> str:
    """``JARVIS_PROVIDER`` if set, else the first provider with a key."""
    chosen = os.environ.get("JARVIS_PROVIDER", "").strip().lower()
    if chosen:
        if chosen not in PROVIDERS:
            raise SetupError(
                f"Unknown JARVIS_PROVIDER '{chosen}'. Choose from: {', '.join(PROVIDERS)}"
            )
        return chosen
    for name in FREE_PROVIDERS + ("claude",):
        if _key_for(name):
            return name
    return "claude"  # nothing set: keeps the old behaviour and error message


def model_for(name: str, main: str = "", main_model: str = "") -> str:
    """The model to use for provider ``name``."""
    if name == main and main_model:
        return main_model
    return os.environ.get(f"JARVIS_{name.upper()}_MODEL") or DEFAULT_MODELS[name]


def fallback_names(main: str) -> list[str]:
    """Free providers to try after ``main``, from ``JARVIS_FALLBACK``."""
    if main not in FREE_PROVIDERS and main != "ollama":
        return []  # Claude: no switching to other services behind your back
    setting = os.environ.get("JARVIS_FALLBACK", "auto").strip().lower()
    if setting in ("", "none", "off", "0", "no", "false"):
        return []
    if setting == "auto":
        names = [n for n in FREE_PROVIDERS if _key_for(n)]
    else:
        names = [n.strip() for n in setting.split(",") if n.strip()]
        unknown = [n for n in names if n not in BASE_URLS]
        if unknown:
            raise SetupError(
                f"Unknown provider(s) in JARVIS_FALLBACK: {', '.join(unknown)}. "
                f"Choose from: {', '.join(n for n in PROVIDERS if n != 'claude')}"
            )
        names = [n for n in names if n == "ollama" or _key_for(n)]
    return [n for n in dict.fromkeys(names) if n != main]


def _compat(name: str, config: Any, model: str) -> "OpenAICompatProvider":
    if name not in BASE_URLS:
        raise SetupError(f"Unknown provider '{name}'. Choose from: {', '.join(PROVIDERS)}")
    key = _key_for(name)
    if not key and name != "ollama":
        raise SetupError(
            f"No API key for {name}. Get a free one at {KEY_PAGES[name]} and set "
            f"{KEY_VARS[name][0]}, for example in PowerShell:\n"
            f'    $env:{KEY_VARS[name][0]}="your-key-here"'
        )
    base = os.environ.get(f"JARVIS_{name.upper()}_URL", BASE_URLS[name])
    return OpenAICompatProvider(name, base, key or "ollama", config, model=model)


def make_provider(config: Any, client: Any | None = None) -> "Provider":
    """Build the provider ``config.provider`` names, plus any fallbacks.

    ``client`` is an Anthropic client (tests pass a fake one); it is only used
    for Claude.
    """
    name = config.provider
    if name == "claude":
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        return ClaudeProvider(client, config)
    main = _compat(name, config, config.model)
    backups = [_compat(n, config, model_for(n)) for n in fallback_names(name)]
    return FallbackProvider([main] + backups) if backups else main


# ------------------------------------------------------------------- Claude


class Provider:
    name = ""

    def create(self, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Any:
        """One model call. Returns an object with ``content`` (blocks with a
        ``type``), ``stop_reason`` and ``model``, shaped like Claude's reply."""
        raise NotImplementedError


class ClaudeProvider(Provider):
    name = "claude"

    def __init__(self, client: Any, config: Any):
        self.client = client
        self.config = config

    def create(self, system, messages, tools):
        params: dict[str, Any] = {
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "system": system,
            "messages": _claude_safe(messages),
            "tools": tools,
            "output_config": {"effort": self.config.effort},
            # Caches the system prompt, tools and history between calls.
            "cache_control": {"type": "ephemeral"},
        }
        if self.config.use_fallbacks:
            return self.client.beta.messages.create(
                betas=[FALLBACK_BETA], fallbacks="default", **params
            )
        return self.client.messages.create(**params)


_ID_OK = re.compile(r"^[a-zA-Z0-9_-]+$")


def _claude_id(id_: str) -> str:
    return id_ if _ID_OK.match(id_ or "") else re.sub(r"[^a-zA-Z0-9_-]", "_", id_ or "id")


def _claude_safe(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Make turns written by another provider acceptable to Claude.

    Only tool_use blocks that came from another provider (marked with a
    ``provider`` field) and tool results with odd ids need touching. Claude's
    own blocks, including thinking blocks, pass through unchanged.
    """
    out = []
    for m in messages:
        content = m.get("content")
        if not isinstance(content, list):
            out.append(m)
            continue
        blocks, changed = [], False
        for b in content:
            if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("provider"):
                b = {"type": "tool_use", "id": _claude_id(b["id"]), "name": b["name"],
                     "input": b.get("input") or {}}
                changed = True
            elif (isinstance(b, dict) and b.get("type") == "tool_result"
                  and _claude_id(b.get("tool_use_id", "")) != b.get("tool_use_id")):
                b = {**b, "tool_use_id": _claude_id(b.get("tool_use_id", ""))}
                changed = True
            blocks.append(b)
        out.append({**m, "content": blocks} if changed else m)
    return out


# ------------------------------------------------- Groq / Gemini / Ollama


@dataclass
class Block:
    """A content block in Claude's shape, built from an OpenAI-style reply."""

    type: str
    text: str = ""
    id: str = ""
    name: str = ""
    input: dict[str, Any] = field(default_factory=dict)
    provider: str = ""
    extra: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        if self.type == "text":
            return {"type": "text", "text": self.text}
        d: dict[str, Any] = {"type": "tool_use", "id": self.id, "name": self.name,
                             "input": self.input, "provider": self.provider}
        if self.extra:
            d["extra"] = self.extra
        return d


@dataclass
class Response:
    content: list[Block]
    stop_reason: str
    model: str
    provider: str = ""


_STOP = {"stop": "end_turn", "tool_calls": "tool_use", "length": "max_tokens",
         "content_filter": "refusal", "function_call": "tool_use"}

Post = Callable[[str, dict[str, str], dict[str, Any], float], dict[str, Any]]


def http_post(url: str, headers: dict[str, str], body: dict[str, Any], timeout: float) -> dict[str, Any]:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


class OpenAICompatProvider(Provider):
    def __init__(self, name: str, base_url: str, api_key: str, config: Any,
                 post: Post | None = None, model: str | None = None):
        self.name = name
        self.model = model or config.model
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.api_key = api_key
        self.config = config
        self.post = post or http_post
        self.timeout = float(os.environ.get("JARVIS_HTTP_TIMEOUT", 120))

    # ---- request

    def create(self, system, messages, tools):
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}]
            + to_openai(messages, _mistral_id if self.name == "mistral" else None),
            "max_tokens": self.config.max_tokens,
        }
        fns = [t for t in (self._tool(s) for s in tools) if t]
        if fns:
            body["tools"] = fns
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "JARVIS-assistant/0.1",
        }
        if self.name == "openrouter":
            headers["X-Title"] = "JARVIS"
        try:
            data = self._send(headers, body)
        except ProviderError as exc:
            # Groq's open models sometimes write a malformed tool call; one
            # retry usually fixes it.
            if exc.status == 400 and "tool_use_failed" in exc.message:
                data = self._send(headers, body)
            else:
                raise
        return self._parse(data)

    def _tool(self, spec: dict[str, Any]) -> dict[str, Any] | None:
        if "input_schema" not in spec:  # a Claude server tool: not available here
            return None
        schema = dict(spec["input_schema"])
        fn: dict[str, Any] = {"name": spec["name"], "description": spec.get("description", "")}
        if schema.get("properties"):
            if self.name == "gemini":
                schema.pop("additionalProperties", None)  # Gemini rejects it
            fn["parameters"] = schema
        return {"type": "function", "function": fn}

    def _send(self, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.post(self.url, headers, body, self.timeout)
        except urllib.error.HTTPError as exc:
            raise self._error(exc.code, exc.read().decode("utf-8", "replace")) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            if self.name == "ollama":
                raise ConnectionFailed(
                    "I can't reach Ollama. Is it installed and running? (https://ollama.com)",
                    self.name,
                ) from None
            raise ConnectionFailed(f"I can't reach {self.name}: {exc}", self.name) from None

    def _error(self, status: int, raw: str) -> ProviderError:
        message = raw
        try:
            data = json.loads(raw)
            if isinstance(data, list) and data:
                data = data[0]
            err = data.get("error", data) if isinstance(data, dict) else data
            if isinstance(err, dict):
                message = err.get("message") or json.dumps(err)
                if err.get("code") == "tool_use_failed":
                    message = f"tool_use_failed: {message}"
            elif isinstance(err, str):
                message = err
        except (ValueError, AttributeError):
            pass
        message = message.strip()[:500]
        if status in (401, 403) or (status == 400 and "api key" in message.lower()):
            return AuthError(message, self.name, status)
        if status == 429:
            return RateLimited(message, self.name, status)
        return ProviderError(message, self.name, status)

    # ---- response

    def _parse(self, data: dict[str, Any]) -> Response:
        try:
            choice = data["choices"][0]
        except (KeyError, IndexError, TypeError):
            raise ProviderError(f"Unexpected reply: {json.dumps(data)[:300]}", self.name) from None
        msg = choice.get("message") or {}
        blocks: list[Block] = []
        text = msg.get("content")
        if isinstance(text, list):  # some servers send content parts
            text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
        if text and text.strip():
            blocks.append(Block(type="text", text=text.strip()))
        for call in msg.get("tool_calls") or []:
            fn = call.get("function") or {}
            args = fn.get("arguments") or "{}"
            if isinstance(args, str):
                try:
                    args = json.loads(args) if args.strip() else {}
                except ValueError:
                    args = {"_unparsed_arguments": args}
            if not isinstance(args, dict):
                args = {"_unparsed_arguments": args}
            extra = {k: v for k, v in call.items() if k not in ("id", "type", "function", "index")}
            blocks.append(Block(
                type="tool_use",
                id=call.get("id") or f"call_{uuid.uuid4().hex[:24]}",
                name=fn.get("name", ""),
                input=args,
                provider=self.name,
                extra=extra or None,
            ))
        stop = _STOP.get(choice.get("finish_reason") or "stop", "end_turn")
        if any(b.type == "tool_use" for b in blocks) and stop == "end_turn":
            stop = "tool_use"  # some servers say "stop" even with tool calls
        return Response(content=blocks, stop_reason=stop, model=data.get("model", self.model), provider=self.name)


class FallbackProvider(Provider):
    """Tries the main provider, then the backups, skipping any that just failed.

    A provider that hits its rate limit (or errors) is skipped for
    ``COOLDOWN`` seconds, so the next request goes straight to one that works.
    """

    def __init__(self, providers: list[OpenAICompatProvider], clock: Callable[[], float] = time.monotonic):
        self.providers = providers
        self.name = providers[0].name
        self.clock = clock
        self._resting: dict[str, float] = {}
        # Called with (from_name, to_name, error) when JARVIS switches.
        self.on_switch: Callable[[str, str, ProviderError], None] | None = None

    @property
    def model(self) -> str:
        return self.providers[0].model

    def create(self, system, messages, tools):
        now = self.clock()
        ready = [p for p in self.providers if self._resting.get(p.name, 0) <= now]
        order = ready or self.providers  # all resting: try them all anyway
        first_error: ProviderError | None = None
        for i, provider in enumerate(order):
            try:
                response = provider.create(system, messages, tools)
            except ProviderError as exc:
                first_error = first_error or exc
                self._resting[provider.name] = self.clock() + COOLDOWN
                if i + 1 < len(order):
                    nxt = order[i + 1].name
                    log.warning("%s failed (%s); switching to %s", provider.name, exc.message, nxt)
                    if self.on_switch:
                        self.on_switch(provider.name, nxt, exc)
                continue
            self._resting.pop(provider.name, None)
            return response
        assert first_error is not None
        raise first_error


def _plain_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return json.dumps(content, ensure_ascii=False, default=str)


def _mistral_id(id_: str) -> str:
    """Mistral only accepts tool-call ids of exactly 9 letters/digits."""
    if re.fullmatch(r"[A-Za-z0-9]{9}", id_ or ""):
        return id_
    return hashlib.sha1((id_ or "").encode()).hexdigest()[:9]


def to_openai(
    messages: list[dict[str, Any]], id_fn: Callable[[str], str] | None = None
) -> list[dict[str, Any]]:
    """Translate the stored (Claude-format) history to OpenAI chat messages.

    Claude-only blocks (thinking, Anthropic's web search results) are left out.
    ``id_fn`` rewrites tool-call ids for providers with strict id rules.
    """
    fix = id_fn or (lambda i: i)
    out: list[dict[str, Any]] = []
    for m in messages:
        role, content = m.get("role"), m.get("content")
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue
        if not isinstance(content, list):
            continue
        if role == "assistant":
            text = _plain_text(content).strip()
            calls = []
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    call = {
                        "id": fix(b["id"]),
                        "type": "function",
                        "function": {"name": b["name"],
                                     "arguments": json.dumps(b.get("input") or {}, ensure_ascii=False)},
                    }
                    call.update(b.get("extra") or {})  # e.g. Gemini's thought signatures
                    calls.append(call)
            if not text and not calls:
                continue
            msg: dict[str, Any] = {"role": "assistant", "content": text or None}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        else:
            texts = []
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_result":
                    result = _plain_text(b.get("content", ""))
                    if b.get("is_error"):
                        result = f"Error: {result}"
                    out.append({"role": "tool", "tool_call_id": fix(b["tool_use_id"]),
                                "content": result or "(no output)"})
                elif b.get("type") == "text":
                    texts.append(b.get("text", ""))
            if any(t.strip() for t in texts):
                out.append({"role": "user", "content": "\n".join(texts)})
    return out
