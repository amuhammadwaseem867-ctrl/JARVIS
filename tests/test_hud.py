"""Tests for the HUD: the app logic and the local web server.

Uses a fake Claude client, fake ears and mouth, and a real server on a free
port. No API key, microphone or browser needed.
"""

from __future__ import annotations

import http.client
import json
import queue
import threading
import time

import pytest

from jarvis import Brain, BrainConfig
from jarvis.hud import HudApp, HudServer, history_of
from jarvis.hud.app import Busy
from jarvis.voice import VoiceConfig, WakeWord

from test_brain import FakeClient, response, text, tool_use


def make_app(tmp_path, *responses, **kw):
    brain = Brain(config=BrainConfig(data_dir=tmp_path), client=FakeClient(*responses))
    return HudApp(brain, **kw)


def events_until(q: queue.Queue, kind: str, value=None, timeout=5.0) -> list[dict]:
    """Collect events until one of ``kind`` (and state ``value``) arrives."""
    seen = []
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        ev = q.get(timeout=end - time.monotonic())
        seen.append(ev)
        if ev["type"] == kind and (value is None or ev.get("state") == value):
            return seen
    raise AssertionError(f"no {kind} event; saw {seen}")


def wait_idle(app: HudApp, q: queue.Queue) -> list[dict]:
    seen = events_until(q, "state", "idle")
    for _ in range(50):  # the worker releases its lock just after "idle"
        if app._work.acquire(blocking=False):
            app._work.release()
            break
        time.sleep(0.01)
    return seen


def test_text_message_flow(tmp_path):
    app = make_app(
        tmp_path,
        response(tool_use("t1", "calculate", {"expression": "2+2"}), stop_reason="tool_use"),
        response(text("It's **4**.")),
    )
    q = app.bus.subscribe()
    app.submit_text("what's 2+2?")
    seen = wait_idle(app, q)

    kinds = [(e["type"], e.get("state") or e.get("role") or e.get("name")) for e in seen]
    assert kinds == [
        ("message", "user"),
        ("state", "thinking"),
        ("tool", "calculate"),
        ("message", "assistant"),
        ("state", "idle"),
    ]
    assert seen[2]["result"] == "4"
    assert seen[3]["text"] == "It's **4**."
    assert history_of(app.brain.memory.messages) == [
        {"role": "user", "text": "what's 2+2?"},
        {"role": "assistant", "text": "It's **4**."},
    ]


def test_one_request_at_a_time(tmp_path):
    app = make_app(tmp_path, response(text("ok")))
    gate = threading.Event()
    real = app.brain.think
    app.brain.think = lambda t: (gate.wait(5), real(t))[1]
    q = app.bus.subscribe()
    app.submit_text("first")
    with pytest.raises(Busy):
        app.submit_text("second")
    gate.set()
    wait_idle(app, q)


def test_confirm_yes_and_no(tmp_path):
    app = make_app(tmp_path)
    q = app.bus.subscribe()
    results = []

    def ask():
        results.append(app.confirm("Delete notes.txt?"))

    for answer in (True, False):
        t = threading.Thread(target=ask)
        t.start()
        ev = events_until(q, "confirm")[-1]
        assert ev["question"] == "Delete notes.txt?"
        assert app.snapshot()["pending"] == [{"id": ev["id"], "question": "Delete notes.txt?"}]
        assert app.answer_confirm(ev["id"], answer)
        t.join(5)
        done = events_until(q, "confirm_done")[-1]
        assert done == {"type": "confirm_done", "id": ev["id"], "answer": answer}
    assert results == [True, False]
    assert not app.answer_confirm(999, True)  # unknown question


def test_confirm_times_out_as_no(tmp_path, monkeypatch):
    monkeypatch.setattr("jarvis.hud.app.CONFIRM_TIMEOUT", 0.05)
    app = make_app(tmp_path)
    assert app.confirm("Open SketchyApp?") is False
    assert app.snapshot()["pending"] == []


def test_risky_tool_asks_on_the_hud(tmp_path):
    app = make_app(tmp_path)

    @app.brain.tools.tool(description="Unlock the door.", parameters={})
    def unlock() -> str:
        app.brain.tools.ask_user("Unlock the front door?")
        return "unlocked"

    app.brain.client.responses = [
        response(tool_use("t1", "unlock", {}), stop_reason="tool_use"),
        response(text("Door unlocked.")),
    ]
    q = app.bus.subscribe()
    app.submit_text("unlock the door")
    ev = events_until(q, "confirm")[-1]
    app.answer_confirm(ev["id"], True)
    seen = wait_idle(app, q)
    tool = next(e for e in seen if e["type"] == "tool")
    assert tool["result"] == "unlocked" and not tool["is_error"]


class FakeEars:
    def __init__(self, *heard):
        self.heard = list(heard)
        self.flushed = 0

    def listen(self, timeout=None):
        return self.heard.pop(0) if self.heard else None

    def flush(self):
        self.flushed += 1

    def close(self):
        pass


class FakeMouth:
    def __init__(self):
        self.said = []

    def say(self, t):
        self.said.append(t)


def test_mic_flow_strips_wake_word_and_speaks(tmp_path):
    ears, mouth, statuses = FakeEars("Jarvis, say hi"), FakeMouth(), []

    def factory(status):
        status("Loading speech model...")
        statuses.append(True)
        return ears

    app = make_app(
        tmp_path,
        response(text("Hi there.")),
        mouth=mouth,
        ears_factory=factory,
        wake=WakeWord(VoiceConfig().wake_aliases),
    )
    q = app.bus.subscribe()
    app.listen()
    seen = wait_idle(app, q)
    states = [e["state"] for e in seen if e["type"] == "state"]
    assert states == ["loading", "listening", "thinking", "thinking", "speaking", "idle"]
    assert [e["text"] for e in seen if e["type"] == "message"] == ["say hi", "Hi there."]
    assert mouth.said == ["Hi there."]
    assert ears.flushed == 1

    # Second press reuses the loaded ears; silence just says so.
    app.listen()
    seen = wait_idle(app, q)
    assert statuses == [True]
    assert any(e["type"] == "status" and "didn't hear" in e["text"] for e in seen)


def test_speak_toggle_and_no_mic(tmp_path):
    app = make_app(tmp_path, response(text("Quiet.")), mouth=FakeMouth(), voice_error="no mic")
    app.set_speak_replies(False)
    q = app.bus.subscribe()
    app.submit_text("hi")
    wait_idle(app, q)
    assert app.mouth.said == []
    with pytest.raises(RuntimeError, match="no mic"):
        app.listen()
    assert app.snapshot()["voice"] == {
        "mic": False, "browser_mic": False, "speech": True, "speak_replies": False,
        "error": "no mic",
    }


def test_bad_api_key_is_fatal(tmp_path, monkeypatch):
    from jarvis.chat import FatalError

    def no_key(brain, text):
        raise FatalError("No valid API key. Set ANTHROPIC_API_KEY and try again.")

    monkeypatch.setattr("jarvis.hud.app.ask", no_key)
    app = make_app(tmp_path)
    q = app.bus.subscribe()
    app.submit_text("hello")
    seen = wait_idle(app, q)
    assert any(e["type"] == "fatal" and "ANTHROPIC_API_KEY" in e["text"] for e in seen)
    with pytest.raises(RuntimeError):
        app.submit_text("again")


def test_history_skips_tool_turns():
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": [{"type": "thinking", "thinking": "..."},
                                          {"type": "tool_use", "id": "x", "name": "n", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "r"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "Hello."}]},
    ]
    assert history_of(msgs) == [{"role": "user", "text": "hi"}, {"role": "assistant", "text": "Hello."}]


@pytest.fixture
def server(tmp_path):
    app = make_app(tmp_path, response(text("Hello from the HUD.")))
    srv = HudServer(app, port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv
    app.bus.publish({"type": "shutdown"})
    srv.shutdown()
    srv.server_close()


def request(srv, method, path, body=None, headers=None, host=None):
    port = srv.server_address[1]
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    hdrs = {"Host": host or f"127.0.0.1:{port}", **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    if data:
        hdrs["Content-Type"] = "application/json"
    conn.request(method, path, body=data, headers=hdrs)
    r = conn.getresponse()
    return r.status, r.read()


def test_page_has_token_and_static_files(server):
    status, page = request(server, "GET", "/")
    assert status == 200
    assert server.token.encode() in page and b"__JARVIS_TOKEN__" not in page
    for name in ("hud.css", "hud.js", "favicon.svg"):
        assert request(server, "GET", f"/static/{name}")[0] == 200
    assert request(server, "GET", "/static/../app.py")[0] == 404
    assert request(server, "GET", "/static/app.py")[0] == 404


def test_rejects_other_hosts_and_missing_token(server):
    # DNS-rebinding style request: right IP, foreign Host header.
    assert request(server, "GET", "/", host="evil.example:8765")[0] == 403
    assert request(server, "POST", "/api/message", {"text": "hi"})[0] == 403
    bad = {"X-Jarvis-Token": "nope"}
    assert request(server, "POST", "/api/message", {"text": "hi"}, bad)[0] == 403
    assert request(server, "GET", "/events?token=nope")[0] == 403


def test_message_round_trip_over_http(server):
    app = server.app
    q = app.bus.subscribe()
    auth = {"X-Jarvis-Token": server.token}
    status, body = request(server, "POST", "/api/message", {"text": "hello"}, auth)
    assert (status, json.loads(body)) == (200, {"ok": True})
    seen = wait_idle(app, q)
    assert [e["text"] for e in seen if e["type"] == "message"] == ["hello", "Hello from the HUD."]
    assert request(server, "POST", "/api/listen", {}, auth)[0] == 503  # no mic here
    assert request(server, "POST", "/api/confirm", {"id": 42, "answer": True}, auth)[0] == 410
    assert request(server, "POST", "/api/nope", {}, auth)[0] == 404


def test_event_stream_starts_with_snapshot(server):
    port = server.server_address[1]
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("GET", f"/events?token={server.token}", headers={"Host": f"localhost:{port}"})
    r = conn.getresponse()
    assert r.status == 200 and r.getheader("Content-Type") == "text/event-stream"
    line = r.fp.readline()
    hello = json.loads(line[len(b"data: "):])
    assert hello["type"] == "hello" and hello["state"] == "idle"
    assert hello["model"] == "claude-opus-5-5"
    conn.close()
