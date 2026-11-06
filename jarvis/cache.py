"""A small on-disk cache so JARVIS doesn't ask the internet the same thing twice.

Used for tool results that don't change every second (weather, web searches,
web pages) and for specialist agents' answers to the exact same task. Saves
API quota and makes repeated questions instant on a slow connection.

Stored in one SQLite file (``~/.jarvis/cache.db``, standard library only).
Set ``JARVIS_CACHE=0`` to switch it off.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Callable

log = logging.getLogger("jarvis.cache")

# Seconds a tool's result stays fresh. Tools not listed are never cached
# (the time, files, system state and anything with side effects).
TOOL_TTL: dict[str, float] = {
    "get_weather": 10 * 60,
    "web_search": 30 * 60,
    "web_fetch": 60 * 60,
}

# An agent answer that used no tools at all (a translation, a draft, code).
AGENT_TTL = 60 * 60


class Cache:
    def __init__(self, path: Path | None = None, clock: Callable[[], float] = time.time) -> None:
        """``path=None`` keeps the cache in memory only."""
        self.clock = clock
        self.hits = 0
        self.misses = 0
        self._lock = threading.Lock()
        self._db = self._open(path)

    def _open(self, path: Path | None) -> sqlite3.Connection:
        target = ":memory:"
        if path is not None:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                target = str(path)
            except OSError as exc:
                log.warning("cache folder unavailable (%s); using memory", exc)
        try:
            db = sqlite3.connect(target, check_same_thread=False)
            db.execute(
                "CREATE TABLE IF NOT EXISTS cache (ns TEXT, key TEXT, value TEXT, expires REAL,"
                " PRIMARY KEY (ns, key))"
            )
            db.execute("DELETE FROM cache WHERE expires < ?", (self.clock(),))
            db.commit()
            return db
        except sqlite3.Error as exc:  # corrupt file, locked, ...: carry on in memory
            log.warning("cache file %s unusable (%s); using memory", target, exc)
            db = sqlite3.connect(":memory:", check_same_thread=False)
            db.execute("CREATE TABLE cache (ns TEXT, key TEXT, value TEXT, expires REAL, PRIMARY KEY (ns, key))")
            return db

    def get(self, ns: str, key: str) -> str | None:
        try:
            with self._lock:
                row = self._db.execute(
                    "SELECT value, expires FROM cache WHERE ns = ? AND key = ?", (ns, key)
                ).fetchone()
        except sqlite3.Error as exc:
            log.warning("cache read failed: %s", exc)
            return None
        if row is None or row[1] < self.clock():
            self.misses += 1
            return None
        self.hits += 1
        return row[0]

    def put(self, ns: str, key: str, value: str, ttl: float) -> None:
        if ttl <= 0:
            return
        try:
            with self._lock:
                self._db.execute(
                    "INSERT OR REPLACE INTO cache VALUES (?, ?, ?, ?)",
                    (ns, key, value, self.clock() + ttl),
                )
                self._db.commit()
        except sqlite3.Error as exc:
            log.warning("cache write failed: %s", exc)

    def clear(self) -> None:
        with self._lock:
            self._db.execute("DELETE FROM cache")
            self._db.commit()

    def stats(self) -> dict[str, int]:
        with self._lock:
            (entries,) = self._db.execute(
                "SELECT COUNT(*) FROM cache WHERE expires >= ?", (self.clock(),)
            ).fetchone()
        return {"entries": entries, "hits": self.hits, "misses": self.misses}
