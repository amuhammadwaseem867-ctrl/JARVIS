"""Keeps one failing part of JARVIS from taking the rest down.

Every agent run goes through ``Supervisor.run``. It

- runs the job with a time limit (time spent waiting for the user to answer a
  confirmation doesn't count),
- turns any exception into a plain ``Outcome`` instead of letting it escape,
- and, like a fuse, switches a job off for a while after it fails several
  times in a row in a short time ("circuit breaker"), so JARVIS stops wasting
  time and API quota on something that is broken.

A Python thread can't be killed, so a job that times out keeps running in the
background until it finishes on its own; JARVIS just stops waiting for it.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as JobStillRunning
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("jarvis.supervisor")


@dataclass
class Outcome:
    ok: bool
    value: Any = None
    error: str = ""
    seconds: float = 0.0


@dataclass
class _Health:
    failures: deque = field(default_factory=deque)  # times of recent failures
    resting_until: float = 0.0
    runs: int = 0
    failed: int = 0
    last_error: str = ""


class Supervisor:
    def __init__(
        self,
        max_failures: int = 3,
        window: float = 300.0,
        rest: float = 600.0,
        workers: int = 4,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """
        Args:
            max_failures: failures within ``window`` seconds that switch a job off.
            window: seconds over which failures are counted.
            rest: seconds a job stays switched off.
            workers: jobs that can run at the same time.
        """
        self.max_failures = max_failures
        self.window = window
        self.rest = rest
        self.clock = clock
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="jarvis-job")
        self._health: dict[str, _Health] = {}

    def resting(self, key: str) -> float:
        """Seconds until ``key`` may run again (0 if it can run now)."""
        h = self._health.get(key)
        return max(0.0, h.resting_until - self.clock()) if h else 0.0

    def run(
        self,
        key: str,
        job: Callable[[], Any],
        timeout: float = 60.0,
        paused: Callable[[], bool] = lambda: False,
    ) -> Outcome:
        """Run ``job`` safely. Never raises; failures come back as ``Outcome(ok=False)``.

        Args:
            key: names the job for health tracking, e.g. ``"agent:weather"``.
            timeout: seconds before giving up on the job.
            paused: returns True while the clock should stop (e.g. the job is
                waiting for the user to answer "yes" or "no").
        """
        h = self._health.setdefault(key, _Health())
        wait = self.resting(key)
        if wait:
            return Outcome(False, error=f"switched off after repeated failures; back in {wait:.0f}s")

        h.runs += 1
        start = time.monotonic()
        try:
            future = self._pool.submit(job)
        except RuntimeError as exc:  # pool shut down
            return self._failed(key, f"could not start: {exc}", start)

        used = 0.0
        last = time.monotonic()
        while True:
            try:
                value = future.result(timeout=0.1)
            except JobStillRunning:
                pass
            except Exception as exc:  # the job itself failed
                log.exception("%s failed", key)
                return self._failed(key, f"{type(exc).__name__}: {exc}", start)
            else:
                h.failures.clear()
                return Outcome(True, value=value, seconds=time.monotonic() - start)
            now = time.monotonic()
            if not paused():
                used += now - last
            last = now
            if used >= timeout:
                return self._failed(key, f"took longer than {timeout:.0f}s", start)

    def _failed(self, key: str, error: str, start: float) -> Outcome:
        h = self._health[key]
        now = self.clock()
        h.failed += 1
        h.last_error = error
        h.failures.append(now)
        while h.failures and h.failures[0] < now - self.window:
            h.failures.popleft()
        if len(h.failures) >= self.max_failures:
            h.resting_until = now + self.rest
            h.failures.clear()
            log.warning("%s failed %d times; switching it off for %.0fs", key, self.max_failures, self.rest)
        return Outcome(False, error=error, seconds=time.monotonic() - start)

    def reset(self, key: str | None = None) -> None:
        """Switch a job (or every job) back on and forget its failures."""
        for k in [key] if key else list(self._health):
            if k in self._health:
                self._health[k] = _Health()

    def status(self) -> dict[str, dict[str, Any]]:
        """Health of every job that has run, for ``/status``."""
        out = {}
        for key, h in sorted(self._health.items()):
            wait = self.resting(key)
            out[key] = {
                "state": f"resting {wait:.0f}s" if wait else "ok",
                "runs": h.runs,
                "failed": h.failed,
                "last_error": h.last_error,
            }
        return out
