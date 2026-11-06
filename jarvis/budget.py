"""Spends the free tiers' rate limits carefully, so JARVIS slows down instead of failing.

Every free provider allows only so many requests and tokens per minute and per
day. The ``Budget`` keeps count of what JARVIS has used with each provider and
answers one question before every model call: "can I call this provider right
now, and if not, how long until I can?" The provider-switching code uses that
answer to go straight to a provider that has room, instead of finding out from
a "429 Too Many Requests" error (which costs a slow round trip on a slow
connection).

The limits below are rough free-tier numbers and change often. They are
deliberately on the safe side, and JARVIS still *tries* a provider when the
estimate says it's full but nothing else is available, because the estimate
can be wrong. Change them for your account in ``~/.jarvis/limits.json``::

    {"groq": {"rpm": 30, "tpm": 8000, "rpd": 1000, "tpd": 200000},
     "gemini": {"rpd": 500}}

or with an environment variable: ``JARVIS_LIMITS_GROQ="rpm=30,tpm=8000"``.
``0`` means "no limit". Keys: ``rpm`` requests/minute, ``tpm`` tokens/minute,
``rpd`` requests/day, ``tpd`` tokens/day.

What was used today is saved to ``~/.jarvis/budget.json``, so restarting
JARVIS doesn't make it forget that today's quota is nearly gone. Days are
counted in UTC, like most providers do.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

log = logging.getLogger("jarvis.budget")


@dataclass
class Limits:
    rpm: int = 0
    tpm: int = 0
    rpd: int = 0
    tpd: int = 0


# Rough free-tier limits (November 2026). Safe-side guesses; see module doc.
DEFAULT_LIMITS: dict[str, Limits] = {
    "groq": Limits(rpm=30, tpm=8_000, rpd=1_000, tpd=200_000),
    "cerebras": Limits(rpm=30, tpm=60_000, rpd=14_400, tpd=1_000_000),
    "gemini": Limits(rpm=10, tpm=250_000, rpd=250),
    "openrouter": Limits(rpm=20, rpd=50),
    "mistral": Limits(rpm=60, tpm=500_000),
    "ollama": Limits(),  # runs on your computer: no limits
    "claude": Limits(),  # paid: Anthropic enforces its own limits
}

# Output tokens reserved per call when estimating (the real number is
# recorded once the reply arrives).
EXPECTED_OUTPUT = 800


def estimate_tokens(system: str, messages: list[Any], tools: list[Any]) -> int:
    """Rough token count of a request: about 4 characters per token."""
    size = len(system) + len(json.dumps(messages, default=str)) + len(json.dumps(tools, default=str))
    return size // 4 + EXPECTED_OUTPUT


def _parse_limits(text: str) -> dict[str, int]:
    out = {}
    for part in text.split(","):
        key, _, value = part.partition("=")
        key = key.strip().lower()
        if key in ("rpm", "tpm", "rpd", "tpd") and value.strip():
            out[key] = int(value)
    return out


def load_limits(data_dir: Path | None) -> dict[str, Limits]:
    """Default limits, then ``limits.json``, then ``JARVIS_LIMITS_<NAME>``."""
    limits = {name: Limits(**asdict(l)) for name, l in DEFAULT_LIMITS.items()}
    if data_dir is not None:
        path = data_dir / "limits.json"
        if path.exists():
            try:
                for name, values in json.loads(path.read_text(encoding="utf-8")).items():
                    current = limits.setdefault(name.lower(), Limits())
                    for key, value in values.items():
                        if key in ("rpm", "tpm", "rpd", "tpd"):
                            setattr(current, key, int(value))
            except (ValueError, AttributeError, TypeError) as exc:
                log.warning("ignoring %s: %s", path, exc)
    for var, value in os.environ.items():
        if var.startswith("JARVIS_LIMITS_"):
            name = var[len("JARVIS_LIMITS_") :].lower()
            try:
                for key, number in _parse_limits(value).items():
                    setattr(limits.setdefault(name, Limits()), key, number)
            except ValueError:
                log.warning("ignoring %s=%r (use e.g. rpm=30,tpm=8000)", var, value)
    return limits


@dataclass
class _Usage:
    minute: deque = field(default_factory=deque)  # (time, tokens) in the last 60 s
    day_requests: int = 0
    day_tokens: int = 0
    resting_until: float = 0.0
    rest_reason: str = ""


@dataclass
class Ticket:
    """One reserved call, settled with the real token count afterwards."""

    name: str
    tokens: int
    entry: list  # [time, tokens], shared with the minute window


class Budget:
    def __init__(
        self,
        path: Path | None = None,
        limits: dict[str, Limits] | None = None,
        max_parallel: int | None = None,
        max_wait: float | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        """
        Args:
            path: where today's counts are saved (None: memory only).
            limits: per-provider limits; defaults to ``load_limits``.
            max_parallel: model calls allowed at the same time
                (``JARVIS_MAX_PARALLEL``, default 2).
            max_wait: seconds JARVIS will wait for room on a provider before
                trying another one instead (``JARVIS_MAX_WAIT``, default 8).
        """
        self.path = path
        self.limits = limits if limits is not None else load_limits(path.parent if path else None)
        if max_parallel is None:
            max_parallel = int(os.environ.get("JARVIS_MAX_PARALLEL", 2))
        self.max_parallel = max(1, max_parallel)
        self.max_wait = float(os.environ.get("JARVIS_MAX_WAIT", 8)) if max_wait is None else max_wait
        self.clock = clock
        self._slots = threading.BoundedSemaphore(self.max_parallel)
        self._lock = threading.Lock()
        self._usage: dict[str, _Usage] = {}
        self._day = self._today()
        self._load()

    # ------------------------------------------------------------ questions

    def limits_for(self, name: str) -> Limits:
        return self.limits.get(name, Limits())

    def wait_time(self, name: str, tokens: int = 0) -> float:
        """Seconds until ``name`` has room for a call of ``tokens`` (0 = now)."""
        with self._lock:
            return self._wait_time(name, tokens)

    def _wait_time(self, name: str, tokens: int) -> float:
        now = self.clock()
        self._roll_day()
        u = self._usage.setdefault(name, _Usage())
        lim = self.limits_for(name)
        self._trim(u, now)
        waits = [max(0.0, u.resting_until - now)]
        if (lim.rpd and u.day_requests >= lim.rpd) or (lim.tpd and u.day_tokens + tokens > lim.tpd):
            waits.append(self._seconds_to_midnight(now))
        if lim.rpm and len(u.minute) >= lim.rpm:
            waits.append(u.minute[len(u.minute) - lim.rpm][0] + 60 - now)
        if lim.tpm and u.minute:
            used = sum(t for _, t in u.minute)
            if used + tokens > lim.tpm:
                # Wait until enough old calls drop out of the 60 s window. A
                # single call bigger than the whole limit can only go when
                # the window is empty.
                need = used + min(tokens, lim.tpm) - lim.tpm
                freed = 0
                for when, t in u.minute:
                    freed += t
                    if freed >= need:
                        waits.append(when + 60 - now)
                        break
        return max(waits)

    def best(self, names: list[str], tokens: int) -> list[str]:
        """``names`` reordered: ready ones first (in the given order), then the
        rest by how soon they'll have room."""
        with self._lock:
            waits = {n: self._wait_time(n, tokens) for n in names}
        ready = [n for n in names if waits[n] <= 0]
        later = sorted((n for n in names if waits[n] > 0), key=lambda n: waits[n])
        return ready + later

    # -------------------------------------------------------------- actions

    @contextmanager
    def slot(self) -> Iterator[None]:
        """Hold one of the ``max_parallel`` call slots while calling a model."""
        with self._slots:
            yield

    def reserve(self, name: str, tokens: int) -> Ticket:
        """Count a call that is about to be made."""
        with self._lock:
            self._roll_day()
            u = self._usage.setdefault(name, _Usage())
            entry = [self.clock(), tokens]
            u.minute.append(entry)
            u.day_requests += 1
            u.day_tokens += tokens
        return Ticket(name, tokens, entry)

    def settle(self, ticket: Ticket, actual_tokens: int | None) -> None:
        """Replace a reservation's estimate with the real token count."""
        if actual_tokens is None or actual_tokens < 0:
            self._save()
            return
        with self._lock:
            u = self._usage.setdefault(ticket.name, _Usage())
            diff = actual_tokens - ticket.entry[1]
            ticket.entry[1] = actual_tokens
            u.day_tokens = max(0, u.day_tokens + diff)
        self._save()

    def rest(self, name: str, seconds: float, reason: str = "") -> None:
        """Don't use ``name`` for ``seconds`` (e.g. it said "retry after 30s")."""
        with self._lock:
            u = self._usage.setdefault(name, _Usage())
            u.resting_until = max(u.resting_until, self.clock() + seconds)
            u.rest_reason = reason
        log.info("resting %s for %.0fs (%s)", name, seconds, reason)
        self._save()

    def status(self) -> dict[str, dict[str, Any]]:
        """Use so far per provider, for ``/status``."""
        out = {}
        with self._lock:
            now = self.clock()
            self._roll_day()
            for name, u in sorted(self._usage.items()):
                self._trim(u, now)
                lim = self.limits_for(name)
                wait = max(0.0, u.resting_until - now)
                out[name] = {
                    "minute_requests": len(u.minute),
                    "minute_tokens": sum(t for _, t in u.minute),
                    "day_requests": u.day_requests,
                    "day_tokens": u.day_tokens,
                    "limits": asdict(lim),
                    "resting": round(wait),
                    "rest_reason": u.rest_reason if wait else "",
                }
        return out

    # ------------------------------------------------------------ internals

    @staticmethod
    def _trim(u: _Usage, now: float) -> None:
        while u.minute and u.minute[0][0] <= now - 60:
            u.minute.popleft()

    def _today(self) -> str:
        return datetime.fromtimestamp(self.clock(), timezone.utc).strftime("%Y-%m-%d")

    def _seconds_to_midnight(self, now: float) -> float:
        dt = datetime.fromtimestamp(now, timezone.utc)
        midnight = (dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return (midnight - dt).total_seconds()

    def _roll_day(self) -> None:
        today = self._today()
        if today != self._day:
            self._day = today
            for u in self._usage.values():
                u.day_requests = u.day_tokens = 0

    def _load(self) -> None:
        if self.path is None or not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            log.warning("ignoring %s: %s", self.path, exc)
            return
        now = self.clock()
        if data.get("day") == self._day:
            for name, saved in data.get("providers", {}).items():
                u = self._usage.setdefault(name, _Usage())
                u.day_requests = int(saved.get("requests", 0))
                u.day_tokens = int(saved.get("tokens", 0))
        for name, until in data.get("resting_until", {}).items():
            if until > now:
                self._usage.setdefault(name, _Usage()).resting_until = until

    def _save(self) -> None:
        if self.path is None:
            return
        with self._lock:
            data = {
                "day": self._day,
                "providers": {
                    n: {"requests": u.day_requests, "tokens": u.day_tokens}
                    for n, u in self._usage.items()
                },
                "resting_until": {n: u.resting_until for n, u in self._usage.items() if u.resting_until},
            }
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
            tmp.replace(self.path)
        except OSError as exc:  # a full disk mustn't stop JARVIS
            log.warning("couldn't save %s: %s", self.path, exc)


def parse_duration(text: str) -> float | None:
    """Seconds from "30", "7.66s", "2m59.56s", "1h2m" or "120ms"; None if unreadable."""
    text = (text or "").strip().lower()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        pass
    total, number = 0.0, ""
    i = 0
    found = False
    while i < len(text):
        ch = text[i]
        if ch.isdigit() or ch == ".":
            number += ch
        elif text.startswith("ms", i) and number:
            total += float(number) / 1000
            number, found = "", True
            i += 1
        elif ch in "hms" and number:
            total += float(number) * {"h": 3600, "m": 60, "s": 1}[ch]
            number, found = "", True
        else:
            return None
        i += 1
    return total if found and not number else None
