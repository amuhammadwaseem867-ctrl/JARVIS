"""A small local web server for the HUD, built on the standard library.

* ``GET /``            the HUD page
* ``GET /static/...``  its CSS and JavaScript
* ``GET /events``      a live stream of events (Server-Sent Events)
* ``POST /api/...``    send a message, press the mic, answer a yes/no, ...

It only listens on 127.0.0.1. Because JARVIS can open apps and change files,
every API call needs a secret token that is baked into the page when it is
served, and requests whose Host isn't this computer are refused. That stops
other websites open in your browser from talking to JARVIS behind your back.
"""

from __future__ import annotations

import json
import logging
import queue
import secrets
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import Any
from urllib.parse import parse_qs, urlparse

from .app import Busy, HudApp

log = logging.getLogger("jarvis.hud")

STATIC_TYPES = {".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml"}
KEEPALIVE_SECONDS = 15
MAX_BODY = 64 * 1024


def _static(name: str) -> bytes:
    return resources.files("jarvis.hud").joinpath("static", name).read_bytes()


class HudServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, app: HudApp, host: str = "127.0.0.1", port: int = 8765):
        self.app = app
        self.token = secrets.token_urlsafe(24)
        super().__init__((host, port), HudHandler)

    @property
    def url(self) -> str:
        host, port = self.server_address[:2]
        return f"http://{host}:{port}/"

    def allowed_hosts(self) -> set[str]:
        port = self.server_address[1]
        return {f"{h}:{port}" for h in ("127.0.0.1", "localhost", "[::1]")}


class HudHandler(BaseHTTPRequestHandler):
    server: HudServer
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        log.debug("%s " + fmt, self.address_string(), *args)

    # ------------------------------------------------------------- helpers

    def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: Any) -> None:
        self._send(status, json.dumps(data).encode())

    def _host_ok(self) -> bool:
        return self.headers.get("Host", "") in self.server.allowed_hosts()

    def _token_ok(self, given: str | None) -> bool:
        return bool(given) and secrets.compare_digest(given, self.server.token)

    # ---------------------------------------------------------------- GET

    def do_GET(self) -> None:
        if not self._host_ok():
            return self._json(HTTPStatus.FORBIDDEN, {"error": "bad host"})
        url = urlparse(self.path)
        if url.path == "/":
            page = _static("index.html").decode().replace("__JARVIS_TOKEN__", self.server.token)
            return self._send(HTTPStatus.OK, page.encode(), "text/html")
        if url.path.startswith("/static/"):
            name = url.path[len("/static/"):]
            ext = name[name.rfind("."):] if "." in name else ""
            if "/" in name or ".." in name or ext not in STATIC_TYPES:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            try:
                return self._send(HTTPStatus.OK, _static(name), STATIC_TYPES[ext])
            except FileNotFoundError:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        if url.path == "/events":
            token = parse_qs(url.query).get("token", [None])[0]
            if not self._token_ok(token):
                return self._json(HTTPStatus.FORBIDDEN, {"error": "bad token"})
            return self._stream_events()
        return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def _stream_events(self) -> None:
        app = self.server.app
        q = app.bus.subscribe()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self._event(app.snapshot())
            while True:
                try:
                    event = q.get(timeout=KEEPALIVE_SECONDS)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue
                if event.get("type") == "shutdown":
                    return
                self._event(event)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            app.bus.unsubscribe(q)

    def _event(self, event: dict[str, Any]) -> None:
        self.wfile.write(b"data: " + json.dumps(event).encode() + b"\n\n")
        self.wfile.flush()

    # --------------------------------------------------------------- POST

    def do_POST(self) -> None:
        if not self._host_ok():
            return self._json(HTTPStatus.FORBIDDEN, {"error": "bad host"})
        if not self._token_ok(self.headers.get("X-Jarvis-Token")):
            return self._json(HTTPStatus.FORBIDDEN, {"error": "bad token"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "expected a JSON object"})

        app = self.server.app
        path = urlparse(self.path).path
        try:
            if path == "/api/message":
                app.submit_text(str(body.get("text", "")))
            elif path == "/api/listen":
                app.listen()
            elif path == "/api/confirm":
                if not app.answer_confirm(int(body.get("id", 0)), body.get("answer") is True):
                    return self._json(HTTPStatus.GONE, {"error": "that question has expired"})
            elif path == "/api/voice":
                app.set_speak_replies(bool(body.get("speak_replies")))
            elif path == "/api/reset":
                app.reset()
            else:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except Busy:
            return self._json(HTTPStatus.CONFLICT, {"error": "I'm still working on the last one."})
        except RuntimeError as exc:
            return self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(exc)})
        except (TypeError, ValueError):
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "bad request"})
        return self._json(HTTPStatus.OK, {"ok": True})


def serve(app: HudApp, port: int = 8765, open_browser: bool = True) -> int:
    """Run the HUD until Ctrl+C."""
    try:
        server = HudServer(app, port=port)
    except OSError as exc:
        raise RuntimeError(
            f"Couldn't start the HUD on port {port} ({exc.strerror}). "
            "Is it already running? Try --port with another number."
        ) from exc
    print(f"JARVIS HUD online at {server.url}  (Ctrl+C to stop)")
    if open_browser:
        import webbrowser

        webbrowser.open(server.url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        app.bus.publish({"type": "shutdown"})
        app.close()
        server.server_close()
    return 0
