"""A small local web server for the HUD, built on the standard library.

* ``GET /``            the HUD page
* ``GET /static/...``  its CSS and JavaScript
* ``GET /events``      a live stream of events (Server-Sent Events)
* ``POST /api/...``    send a message, press the mic, answer a yes/no, ...

* ``POST /api/audio``   speech recorded in the browser (phone mode)

It only listens on 127.0.0.1. Because JARVIS can open apps and change files,
every API call needs a secret token that is baked into the page when it is
served, and requests whose Host isn't this computer are refused. That stops
other websites open in your browser from talking to JARVIS behind your back.

Phone mode (``--phone``) adds a second server for the local network, over
HTTPS, that only answers phones paired with the code or QR code shown on the
computer (see ``phone.py``).
"""

from __future__ import annotations

import json
import logging
import queue
import secrets
import threading
import ssl
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import Any
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import phone
from .app import Busy, HudApp

log = logging.getLogger("jarvis.hud")

STATIC_TYPES = {".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml"}
KEEPALIVE_SECONDS = 15
MAX_BODY = 64 * 1024
MAX_AUDIO = 2 * 1024 * 1024  # about a minute of 16 kHz speech


def _static(name: str) -> bytes:
    return resources.files("jarvis.hud").joinpath("static", name).read_bytes()


class HudServer(ThreadingHTTPServer):
    """The HUD for this computer, on http://127.0.0.1 only."""

    daemon_threads = True
    allow_reuse_address = True
    remote = False

    def __init__(
        self,
        app: HudApp,
        host: str = "127.0.0.1",
        port: int = 8765,
        token: str | None = None,
    ):
        self.app = app
        self.token = token or secrets.token_urlsafe(24)
        self.phone: PhoneServer | None = None  # set when phone mode is on
        super().__init__((host, port), HudHandler)

    @property
    def url(self) -> str:
        host, port = self.server_address[:2]
        return f"http://{host}:{port}/"

    def allowed_hosts(self) -> set[str]:
        port = self.server_address[1]
        return {f"{h}:{port}" for h in ("127.0.0.1", "localhost", "[::1]")}

    def host_ok(self, host: str) -> bool:
        return host in self.allowed_hosts()


class PhoneServer(HudServer):
    """The HUD for phones: HTTPS on the local network, paired devices only."""

    remote = True

    def __init__(
        self,
        app: HudApp,
        ip: str,
        port: int,
        token: str,
        folder: Path,
        pairing: phone.Pairing | None = None,
    ):
        self.ip = ip
        self.pairing = pairing or phone.Pairing(folder)
        cert, key = phone.ensure_certificate(folder, ip)
        super().__init__(app, host="0.0.0.0", port=port, token=token)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(cert, key)
        # Handshake in the request's own thread, so a slow phone can't hold up others.
        self.socket = ctx.wrap_socket(self.socket, server_side=True, do_handshake_on_connect=False)

    @property
    def url(self) -> str:
        return f"https://{self.ip}:{self.server_address[1]}/"

    @property
    def pair_url(self) -> str:
        return self.pairing.pair_url(self.url)

    def host_ok(self, host: str) -> bool:
        return phone.is_ip_host(host)

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Phones drop the connection while showing the certificate warning;
        # that's expected, not worth a traceback.
        log.debug("phone connection from %s failed", client_address, exc_info=True)


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
        return self.server.host_ok(self.headers.get("Host", ""))

    def _paired(self) -> bool:
        """On the phone server: is this a paired phone? Always True locally."""
        if not self.server.remote:
            return True
        try:
            jar = SimpleCookie(self.headers.get("Cookie", ""))
        except CookieError:
            return False
        morsel = jar.get(phone.COOKIE)
        return self.server.pairing.is_paired(morsel.value if morsel else None)

    def _redirect(self, where: str, cookie: str | None = None) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", where)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header(
                "Set-Cookie",
                f"{phone.COOKIE}={cookie}; Path=/; Max-Age={phone.SESSION_DAYS * 86400}; "
                "Secure; HttpOnly; SameSite=Lax",
            )
        self.end_headers()

    def _pair_page(self, error: str = "", status: int = HTTPStatus.OK) -> None:
        page = _static("pair.html").decode().replace("__ERROR__", error)
        self._send(status, page.encode(), "text/html")

    def _do_pair(self, sid: str | None) -> None:
        if sid:
            log.info("paired a phone from %s", self.client_address[0])
            print(f"Phone paired ({self.client_address[0]}).")
            return self._redirect("/", cookie=sid)
        pairing = self.server.pairing
        if pairing.tries_left <= 0:
            msg = "Too many wrong codes. Scan the QR code on the computer, or restart JARVIS."
        else:
            msg = f"That code isn't right. {pairing.tries_left} tries left."
        return self._pair_page(msg, HTTPStatus.FORBIDDEN)

    def _token_ok(self, given: str | None) -> bool:
        return bool(given) and secrets.compare_digest(given, self.server.token)

    # ---------------------------------------------------------------- GET

    def do_GET(self) -> None:
        if not self._host_ok():
            return self._json(HTTPStatus.FORBIDDEN, {"error": "bad host"})
        url = urlparse(self.path)
        if self.server.remote and url.path == "/pair":
            key = parse_qs(url.query).get("key", [""])[0]
            if key:
                return self._do_pair(self.server.pairing.pair_with_key(key))
            return self._pair_page()
        if url.path == "/":
            if not self._paired():
                return self._pair_page()
            page = (
                _static("index.html")
                .decode()
                .replace("__JARVIS_TOKEN__", self.server.token)
                .replace("__JARVIS_CLIENT__", "phone" if self.server.remote else "local")
            )
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
            if not (self._token_ok(token) and self._paired()):
                return self._json(HTTPStatus.FORBIDDEN, {"error": "bad token"})
            return self._stream_events()
        if url.path == "/api/phone" and not self.server.remote:
            token = parse_qs(url.query).get("token", [None])[0]
            if not self._token_ok(token):
                return self._json(HTTPStatus.FORBIDDEN, {"error": "bad token"})
            return self._json(HTTPStatus.OK, phone_info(self.server.phone))
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

    def _length(self, limit: int) -> int | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > limit:
            self.close_connection = True
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "too large"})
            return None
        return length

    def do_POST(self) -> None:
        if not self._host_ok():
            return self._json(HTTPStatus.FORBIDDEN, {"error": "bad host"})
        path = urlparse(self.path).path
        if self.server.remote and path == "/pair":
            length = self._length(1024)
            if length is None:
                return None
            code = parse_qs(self.rfile.read(length).decode(errors="replace")).get("code", [""])[0]
            return self._do_pair(self.server.pairing.pair_with_code(code))
        if not (self._token_ok(self.headers.get("X-Jarvis-Token")) and self._paired()):
            return self._json(HTTPStatus.FORBIDDEN, {"error": "bad token"})
        if path == "/api/audio":
            return self._audio()
        length = self._length(MAX_BODY)
        if length is None:
            return None
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "expected a JSON object"})

        app = self.server.app
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

    def _audio(self) -> None:
        """Speech recorded in the browser: 16 kHz mono 16-bit PCM."""
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/octet-stream":
            return self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "expected raw audio"})
        length = self._length(MAX_AUDIO)
        if length is None:
            return None
        pcm = self.rfile.read(length)
        try:
            self.server.app.submit_audio(pcm)
        except Busy:
            return self._json(HTTPStatus.CONFLICT, {"error": "I'm still working on the last one."})
        except RuntimeError as exc:
            return self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(exc)})
        except ValueError:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "That was too short to hear anything."})
        return self._json(HTTPStatus.OK, {"ok": True})


def phone_info(server: PhoneServer | None) -> dict[str, Any]:
    """What the computer's HUD shows in its "Connect phone" card."""
    if server is None:
        return {"on": False}
    return {
        "on": True,
        "url": server.url,
        "pair_url": server.pair_url,
        "code": server.pairing.code if server.pairing.tries_left > 0 else None,
        "qr_svg": phone.qr_svg(server.pair_url),
    }


def _start_phone(app: HudApp, local: HudServer, port: int, folder: Path) -> PhoneServer:
    ip = phone.lan_ip()
    if not ip:
        raise RuntimeError(
            "Couldn't find this computer's Wi-Fi address. Is it connected to a network? "
            "You can set it yourself with JARVIS_LAN_IP=192.168.x.x"
        )
    try:
        server = PhoneServer(app, ip=ip, port=port, token=local.token, folder=folder)
    except OSError as exc:
        raise RuntimeError(
            f"Couldn't start phone mode on port {port} ({exc.strerror}). "
            "Try --phone-port with another number."
        ) from exc
    local.phone = server
    threading.Thread(target=server.serve_forever, name="jarvis-phone", daemon=True).start()

    print()
    print("Phone mode is on. To use your phone's mic, on the same Wi-Fi:")
    if phone.print_qr(server.pair_url):
        print("  1. Scan this QR code with your phone's camera (also shown on the HUD), or")
    else:
        print(f"  1. For a QR code to scan: {phone.PHONE_INSTALL}. Or")
    print(f"     open {server.url} on the phone and type the code {server.pairing.code}")
    print("  2. Your phone warns that the connection isn't private. That's expected:")
    print("     the certificate was made on this computer. Tap Advanced > Proceed")
    print("     (Chrome) or Show Details > visit this website (Safari).")
    print("  3. Tap the mic and allow microphone access.")
    print()
    return server


def serve(
    app: HudApp,
    port: int = 8765,
    open_browser: bool = True,
    phone_port: int | None = None,
    data_dir: Path | None = None,
) -> int:
    """Run the HUD until Ctrl+C. ``phone_port`` turns on phone mode."""
    try:
        server = HudServer(app, port=port)
    except OSError as exc:
        raise RuntimeError(
            f"Couldn't start the HUD on port {port} ({exc.strerror}). "
            "Is it already running? Try --port with another number."
        ) from exc
    servers: list[HudServer] = [server]
    try:
        if phone_port is not None:
            folder = (data_dir or Path.home() / ".jarvis") / "phone"
            servers.append(_start_phone(app, server, phone_port, folder))
    except BaseException:
        server.server_close()
        raise
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
        for s in servers:
            if s is not server:
                s.shutdown()
            s.server_close()
    return 0
