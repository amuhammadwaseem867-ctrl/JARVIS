"""The HUD's logic, separate from HTTP so it can be tested on its own.

``HudApp`` owns the brain and runs one request at a time on a worker thread.
Everything that happens (state changes, messages, tool calls, questions for
the user) is published as an event; the web page receives them live.

States shown on the HUD::

    idle ──text──► thinking ──► speaking ──► idle
      └──mic──► listening ──► thinking ──► ...
"""

from __future__ import annotations

import itertools
import logging
import queue
import threading
import time
from typing import Any, Callable

from ..brain import Brain, ToolCall
from ..chat import FatalError, ask

log = logging.getLogger("jarvis.hud")

CONFIRM_TIMEOUT = 120.0  # seconds to answer a yes/no card before it counts as no
LISTEN_TIMEOUT = 8.0  # seconds to start speaking after pressing the mic


class EventBus:
    """Fan-out of events to every open HUD page (each gets its own queue)."""

    def __init__(self) -> None:
        self._subs: list[queue.Queue] = []
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def publish(self, event: dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            q.put(event)


class Busy(Exception):
    """JARVIS is already handling a request."""


class HudApp:
    def __init__(
        self,
        brain: Brain,
        mouth: Any | None = None,
        ears_factory: Callable[[Callable[[str], None]], Any] | None = None,
        wake: Any | None = None,
        voice_error: str | None = None,
    ):
        """
        Args:
            brain: the JARVIS brain. Its tool callback and confirm hook are
                taken over so the HUD can show tools and ask questions.
            mouth: speaks replies (``Mouth`` from the voice package), or None.
            ears_factory: builds the microphone + Whisper ``Ears`` on first
                mic press (loading the speech model is slow). Called with a
                status callback. None means no mic.
            wake: a ``WakeWord`` to strip "Jarvis," from what was heard.
            voice_error: why voice isn't available, shown on the HUD.
        """
        self.brain = brain
        self.mouth = mouth
        self.ears_factory = ears_factory
        self.ears: Any | None = None
        self.wake = wake
        self.voice_error = voice_error
        self.speak_replies = mouth is not None
        self.bus = EventBus()
        self.state = "idle"
        self.fatal: str | None = None

        self._work = threading.Lock()  # one request at a time
        self._ids = itertools.count(1)
        self._pending: dict[int, dict[str, Any]] = {}
        self._pending_lock = threading.Lock()

        brain.on_tool_call = self._on_tool
        brain.tools.confirm = self.confirm

    # --------------------------------------------------------------- status

    def snapshot(self) -> dict[str, Any]:
        """Everything a freshly opened page needs to draw itself."""
        with self._pending_lock:
            pending = [
                {"id": i, "question": p["question"]} for i, p in self._pending.items()
            ]
        return {
            "type": "hello",
            "state": self.state,
            "model": self.brain.config.model,
            "history": history_of(self.brain.memory.messages),
            "voice": {
                "mic": self.ears_factory is not None,
                "speech": self.mouth is not None,
                "speak_replies": self.speak_replies,
                "error": self.voice_error,
            },
            "pending": pending,
            "fatal": self.fatal,
        }

    def _set_state(self, state: str) -> None:
        self.state = state
        self.bus.publish({"type": "state", "state": state})

    def _publish(self, **event: Any) -> None:
        self.bus.publish(event)

    def _on_tool(self, call: ToolCall) -> None:
        self._publish(
            type="tool",
            name=call.name,
            input=call.input,
            result=call.result[:2000],
            is_error=call.is_error,
            at=time.time(),
        )

    # ------------------------------------------------------------- requests

    def submit_text(self, text: str) -> None:
        """Answer a typed message in the background. Raises Busy."""
        text = text.strip()
        if not text:
            return
        self._start(self._answer, text)

    def listen(self) -> None:
        """Listen on the microphone, then answer. Raises Busy or RuntimeError."""
        if self.ears_factory is None:
            raise RuntimeError(self.voice_error or "No microphone available.")
        self._start(self._listen_and_answer)

    def set_speak_replies(self, on: bool) -> None:
        self.speak_replies = bool(on) and self.mouth is not None
        self._publish(type="voice", speak_replies=self.speak_replies)

    def reset(self) -> None:
        if not self._work.acquire(blocking=False):
            raise Busy()
        try:
            self.brain.reset()
        finally:
            self._work.release()
        self._publish(type="reset")

    def _start(self, target: Callable[..., None], *args: Any) -> None:
        if self.fatal:
            raise RuntimeError(self.fatal)
        if not self._work.acquire(blocking=False):
            raise Busy()

        def run() -> None:
            try:
                target(*args)
            except Exception as exc:  # keep the HUD alive whatever happens
                log.exception("request failed")
                self._publish(type="error", text=f"Something went wrong: {exc}")
            finally:
                self._set_state("idle")
                self._work.release()

        threading.Thread(target=run, name="jarvis-hud-worker", daemon=True).start()

    def _answer(self, text: str) -> None:
        self._publish(type="message", role="user", text=text)
        self._set_state("thinking")
        try:
            answer = ask(self.brain, text)
        except FatalError as exc:
            self.fatal = str(exc)
            self._publish(type="fatal", text=self.fatal)
            return
        self._publish(type="message", role="assistant", text=answer)
        self._say(answer)

    def _listen_and_answer(self) -> None:
        if self.ears is None:
            self._set_state("loading")
            try:
                self.ears = self.ears_factory(lambda msg: self._publish(type="status", text=msg))
            except Exception as exc:
                self.ears_factory = None
                self.voice_error = f"Microphone unavailable: {exc}"
                self._publish(type="voice", mic=False, error=self.voice_error)
                return
        heard = self._hear(LISTEN_TIMEOUT)
        if heard is None:
            self._publish(type="status", text="I didn't hear anything.")
            return
        request = self.wake.strip(heard) if self.wake else heard.strip()
        if request:
            self._answer(request)
        else:
            self._publish(type="message", role="user", text=heard)
            self._publish(type="message", role="assistant", text="Yes?")
            self._say("Yes?")

    def _hear(self, timeout: float) -> str | None:
        self._set_state("listening")
        try:
            return self.ears.listen(timeout=timeout) or None
        finally:
            self._set_state("thinking")

    def _say(self, text: str) -> None:
        if not (self.speak_replies and self.mouth and text):
            return
        self._set_state("speaking")
        try:
            self.mouth.say(text)
        except Exception as exc:
            log.warning("speech failed: %s", exc)
        finally:
            if self.ears is not None:
                self.ears.flush()  # don't hear ourselves

    # ------------------------------------------------------- confirmations

    def confirm(self, question: str) -> bool:
        """Ask the user yes/no on the HUD. Blocks the tool until answered.

        Called from the worker thread when a skill wants to do something
        risky. Anything but a clear yes (including no answer in time) is no.
        """
        cid = next(self._ids)
        done = threading.Event()
        with self._pending_lock:
            self._pending[cid] = {"question": question, "event": done, "answer": False}
        self._publish(type="confirm", id=cid, question=question)
        if self.speak_replies and self.mouth:
            try:
                self.mouth.say(question)
            except Exception:
                pass
        answered = done.wait(CONFIRM_TIMEOUT)
        with self._pending_lock:
            answer = self._pending.pop(cid)["answer"] if answered else False
            self._pending.pop(cid, None)
        self._publish(type="confirm_done", id=cid, answer=answer)
        return answer

    def answer_confirm(self, cid: int, yes: bool) -> bool:
        """Record the user's answer. Returns False if the question is gone."""
        with self._pending_lock:
            pending = self._pending.get(cid)
            if pending is None:
                return False
            pending["answer"] = bool(yes)
            pending["event"].set()
        return True

    def close(self) -> None:
        with self._pending_lock:
            for p in self._pending.values():
                p["event"].set()
        if self.ears is not None:
            try:
                self.ears.close()
            except Exception:
                pass


def history_of(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    """The readable part of the saved conversation: user and JARVIS text only."""
    out = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            text = content
        else:
            text = "\n".join(
                b.get("text", "")
                for b in content or []
                if isinstance(b, dict) and b.get("type") == "text"
            ).strip()
        if text:
            out.append({"role": m["role"], "text": text})
    return out
