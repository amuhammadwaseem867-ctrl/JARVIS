"""Tests for phone mode: pairing, the HTTPS phone server, and recorded audio.

A fake Claude client and a fake Whisper; the phone server runs for real over
TLS on a free port, with the certificate it makes itself.
"""

from __future__ import annotations

import http.client
import json
import ssl
import threading
from urllib.parse import urlencode

import pytest

pytest.importorskip("cryptography")

from jarvis.hud import HudServer
from jarvis.hud import phone
from jarvis.hud.server import PhoneServer, phone_info
from jarvis.voice import WakeWord

from test_brain import response, text
from test_hud import FakeMouth, make_app, wait_idle


class FakeTranscriber:
    def __init__(self, *heard):
        self.heard = list(heard)
        self.got: list[bytes] = []

    def transcribe(self, pcm):
        self.got.append(pcm)
        return self.heard.pop(0) if self.heard else ""


SECOND = b"\x01\x00" * 16000  # one second of (very quiet) 16 kHz audio


def test_pairing_code_key_and_lockout(tmp_path):
    p = phone.Pairing(tmp_path)
    assert len(p.code) == 6 and p.code.isdigit()
    assert not p.is_paired(None) and not p.is_paired("made-up")

    sid = p.pair_with_code(p.code[:3] + " " + p.code[3:])  # spaces are fine
    assert sid and p.is_paired(sid)
    assert p.pair_with_key(p.key) and p.pair_with_key("wrong") is None

    wrong = "000000" if p.code != "000000" else "111111"
    for left in range(phone.MAX_CODE_TRIES - 1, -1, -1):
        assert p.pair_with_code(wrong) is None
        assert p.tries_left == left
    assert p.pair_with_code(p.code) is None  # locked out, even with the right code
    assert p.pair_with_key(p.key)  # the QR code still works


def test_paired_phones_are_remembered_as_hashes(tmp_path):
    p = phone.Pairing(tmp_path)
    sid = p.pair_with_key(p.key)
    saved = (tmp_path / "devices.json").read_text()
    assert sid not in saved

    again = phone.Pairing(tmp_path)  # JARVIS restarted: new code, same phones
    assert again.code != p.code or again.key != p.key
    assert again.is_paired(sid)
    assert again.forget_all() == 1
    assert not phone.Pairing(tmp_path).is_paired(sid)


def test_expired_pairing(tmp_path):
    p = phone.Pairing(tmp_path, days=-1)
    assert not p.is_paired(p.pair_with_key(p.key))


def test_only_ip_hosts_are_accepted():
    for ok in ("192.168.1.20:8766", "10.0.0.5", "[fe80::1]:8766", "127.0.0.1:1"):
        assert phone.is_ip_host(ok), ok
    for bad in ("evil.example:8766", "localhost:8766", "", "192.168.1.20.nip.io:8766"):
        assert not phone.is_ip_host(bad), bad


def test_certificate_is_made_once_per_address(tmp_path):
    cert, key = phone.ensure_certificate(tmp_path, "192.168.1.20")
    first = cert.read_bytes()
    assert key.exists()
    assert phone.ensure_certificate(tmp_path, "192.168.1.20")[0].read_bytes() == first
    assert phone.ensure_certificate(tmp_path, "10.0.0.7")[0].read_bytes() != first
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)  # a usable pair


def test_lan_ip_override(monkeypatch):
    monkeypatch.setenv("JARVIS_LAN_IP", "192.168.7.7")
    assert phone.lan_ip() == "192.168.7.7"


def test_audio_is_transcribed_and_answered(tmp_path):
    whisper, mouth, statuses = FakeTranscriber("Jarvis, say hi"), FakeMouth(), []

    def factory(status):
        statuses.append("loaded")
        return whisper

    app = make_app(
        tmp_path, response(text("Hi.")),
        mouth=mouth, transcriber_factory=factory, wake=WakeWord(["jarvis"]),
    )
    assert app.snapshot()["voice"]["browser_mic"] is True
    q = app.bus.subscribe()
    app.submit_audio(SECOND + b"\x00")  # odd byte dropped
    seen = wait_idle(app, q)

    assert whisper.got == [SECOND] and statuses == ["loaded"]
    states = [e["state"] for e in seen if e["type"] == "state"]
    assert states == ["loading", "thinking", "thinking", "speaking", "idle"]
    assert [e["text"] for e in seen if e["type"] == "message"] == ["say hi", "Hi."]
    assert mouth.said == ["Hi."]


def test_audio_nothing_heard_or_unavailable(tmp_path):
    app = make_app(tmp_path, transcriber_factory=lambda status: FakeTranscriber(""))
    q = app.bus.subscribe()
    app.submit_audio(SECOND)
    seen = wait_idle(app, q)
    assert not [e for e in seen if e["type"] == "message"]
    assert any(e["type"] == "status" and "didn't catch" in e["text"] for e in seen)
    with pytest.raises(ValueError):
        app.submit_audio(b"\x00" * 10)

    plain = make_app(tmp_path / "b", voice_error="no whisper")
    with pytest.raises(RuntimeError, match="no whisper"):
        plain.submit_audio(SECOND)


@pytest.fixture
def phone_server(tmp_path):
    app = make_app(
        tmp_path, response(text("Hello, phone.")),
        transcriber_factory=lambda status: FakeTranscriber("what's up"),
    )
    local = HudServer(app, port=0)
    srv = PhoneServer(app, ip="127.0.0.1", port=0, token=local.token, folder=tmp_path / "phone")
    local.phone = srv
    for s in (local, srv):
        threading.Thread(target=s.serve_forever, daemon=True).start()
    yield srv, local
    app.bus.publish({"type": "shutdown"})
    for s in (local, srv):
        s.shutdown()
        s.server_close()


def https(srv, method, path, body=None, headers=None, host=None):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # self-signed, like the phone's "proceed anyway"
    port = srv.server_address[1]
    conn = http.client.HTTPSConnection("127.0.0.1", port, timeout=5, context=ctx)
    hdrs = {"Host": host or f"127.0.0.1:{port}", **(headers or {})}
    conn.request(method, path, body=body, headers=hdrs)
    r = conn.getresponse()
    return r.status, dict(r.getheaders()), r.read()


def test_phone_must_pair_first(phone_server):
    srv, _ = phone_server
    auth = {"X-Jarvis-Token": srv.token, "Content-Type": "application/json"}

    status, _, page = https(srv, "GET", "/")
    assert status == 200 and b"Pair this phone" in page and srv.token.encode() not in page
    assert https(srv, "GET", f"/events?token={srv.token}")[0] == 403
    assert https(srv, "POST", "/api/message", b'{"text":"hi"}', auth)[0] == 403
    assert https(srv, "GET", "/", host="evil.example:8766")[0] == 403
    assert https(srv, "GET", "/static/hud.css")[0] == 200
    assert https(srv, "GET", "/api/phone?token=" + srv.token)[0] == 404  # computer only

    form = {"Content-Type": "application/x-www-form-urlencoded"}
    status, _, page = https(srv, "POST", "/pair", urlencode({"code": "nope"}).encode(), form)
    assert status == 403 and b"tries left" in page


def test_pair_with_code_then_talk(phone_server):
    srv, _ = phone_server
    form = {"Content-Type": "application/x-www-form-urlencoded"}
    status, headers, _ = https(srv, "POST", "/pair", urlencode({"code": srv.pairing.code}).encode(), form)
    assert status == 303 and headers["Location"] == "/"
    cookie = headers["Set-Cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie
    jar = {"Cookie": cookie.split(";")[0]}

    status, _, page = https(srv, "GET", "/", headers=jar)
    assert status == 200 and srv.token.encode() in page
    assert b'content="phone"' in page

    app = srv.app
    q = app.bus.subscribe()
    auth = {**jar, "X-Jarvis-Token": srv.token}
    wrong_type = {**auth, "Content-Type": "audio/webm"}
    assert https(srv, "POST", "/api/audio", SECOND, wrong_type)[0] == 415
    raw = {**auth, "Content-Type": "application/octet-stream"}
    status, _, body = https(srv, "POST", "/api/audio", SECOND, raw)
    assert (status, json.loads(body)) == (200, {"ok": True})
    seen = wait_idle(app, q)
    assert [e["text"] for e in seen if e["type"] == "message"] == ["what's up", "Hello, phone."]

    # Pairing doesn't replace the token: a paired cookie alone can't post.
    assert https(srv, "POST", "/api/reset", b"{}", jar)[0] == 403


def test_qr_link_pairs(phone_server):
    srv, _ = phone_server
    status, headers, _ = https(srv, "GET", f"/pair?key={srv.pairing.key}")
    assert status == 303 and phone.COOKIE in headers["Set-Cookie"]
    assert https(srv, "GET", "/pair?key=wrong")[0] == 403


def test_computer_hud_shows_pairing_info(phone_server):
    srv, local = phone_server
    info = phone_info(local.phone)
    assert info["on"] and info["url"].startswith("https://127.0.0.1:")
    assert info["code"] == srv.pairing.code and srv.pairing.key in info["pair_url"]
    assert phone_info(None) == {"on": False}

    port = local.server_address[1]
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("GET", f"/api/phone?token={local.token}", headers={"Host": f"127.0.0.1:{port}"})
    r = conn.getresponse()
    assert r.status == 200 and json.loads(r.read())["code"] == srv.pairing.code
