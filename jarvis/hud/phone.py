"""Let a phone on the same Wi-Fi use the HUD, and its microphone.

Phones only let web pages use the microphone over HTTPS, so phone mode serves
the HUD a second time on the local network, over HTTPS with a certificate made
on this computer (``~/.jarvis/phone``). The phone shows a one-time warning
about that certificate, because no public authority signed it.

Because JARVIS can open apps and change files, nobody on the Wi-Fi gets in
without pairing first: scanning the QR code shown on the computer, or typing
the 6-digit code. A paired phone gets a long random cookie and stays paired
for 30 days (``--forget-phones`` unpairs every phone).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import ipaddress
import json
import os
import secrets
import socket
import threading
import time
from pathlib import Path

PHONE_INSTALL = 'pip install -e ".[phone]"'
SESSION_DAYS = 30
MAX_CODE_TRIES = 5
COOKIE = "jarvis_phone"


def lan_ip() -> str | None:
    """This computer's address on the local network, e.g. 192.168.1.20.

    ``JARVIS_LAN_IP`` overrides it (for computers with several networks).
    Connecting a UDP socket sends nothing; it just asks the OS which address
    it would use to reach the internet.
    """
    override = os.environ.get("JARVIS_LAN_IP", "").strip()
    if override:
        return override
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
        except OSError:
            return None
    return None if ip.startswith("127.") else ip


def is_ip_host(host: str) -> bool:
    """True if a Host header is an IP address (with optional port).

    Web pages can only trick a browser into calling JARVIS through a domain
    name they control (DNS rebinding), so the phone server only answers
    requests addressed to a bare IP.
    """
    if host.startswith("["):
        addr = host[1:host.find("]")] if "]" in host else ""
    else:
        addr = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    try:
        ipaddress.ip_address(addr)
    except ValueError:
        return False
    return True


def ensure_certificate(folder: Path, ip: str) -> tuple[Path, Path]:
    """A self-signed certificate for ``ip``, made once and reused.

    It is remade when the computer's address changes, which means the phone
    shows the certificate warning once more.
    """
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.x509.oid import NameOID
    except ImportError as exc:
        raise RuntimeError(
            f"Phone mode needs the 'cryptography' package. Install it with:  {PHONE_INSTALL}"
        ) from exc

    folder.mkdir(parents=True, exist_ok=True)
    cert_path, key_path = folder / "cert.pem", folder / "key.pem"
    if cert_path.exists() and key_path.exists():
        try:
            cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
            sans = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            fresh = cert.not_valid_after_utc > dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=7)
            if fresh and ipaddress.ip_address(ip) in sans.get_values_for_type(x509.IPAddress):
                return cert_path, key_path
        except Exception:
            pass  # unreadable or old: make a new one

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "JARVIS on this computer")])
    now = dt.datetime.now(dt.timezone.utc)
    alt = [x509.IPAddress(ipaddress.ip_address(ip)), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=397))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path


def _hash(sid: str) -> str:
    return hashlib.sha256(sid.encode()).hexdigest()


class Pairing:
    """Who may use JARVIS from the network.

    * ``code``: 6 digits to type on the phone. After 5 wrong tries typing is
      switched off until JARVIS restarts (the QR code keeps working).
    * ``key``: a long secret inside the QR code's link.
    * Paired phones are remembered in ``devices.json`` as hashes, so the file
      itself can't be used to get in.
    """

    def __init__(self, folder: Path, days: int = SESSION_DAYS):
        self.file = folder / "devices.json"
        self.days = days
        self.code = f"{secrets.randbelow(10**6):06d}"
        self.key = secrets.token_urlsafe(18)
        self.tries_left = MAX_CODE_TRIES
        self._lock = threading.Lock()
        self._devices = self._load()

    def _load(self) -> dict[str, float]:
        try:
            data = json.loads(self.file.read_text())
            now = time.time()
            return {h: float(exp) for h, exp in data.items() if float(exp) > now}
        except (OSError, ValueError, AttributeError):
            return {}

    def _save(self) -> None:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps(self._devices))

    def _new_session(self) -> str:
        sid = secrets.token_urlsafe(32)
        self._devices[_hash(sid)] = time.time() + self.days * 86400
        self._save()
        return sid

    def pair_with_code(self, code: str) -> str | None:
        """A session id if ``code`` is right, else None (and one try used up)."""
        with self._lock:
            if self.tries_left <= 0:
                return None
            if secrets.compare_digest(code.strip().replace(" ", ""), self.code):
                return self._new_session()
            self.tries_left -= 1
            return None

    def pair_with_key(self, key: str) -> str | None:
        with self._lock:
            if key and secrets.compare_digest(key, self.key):
                return self._new_session()
            return None

    def is_paired(self, sid: str | None) -> bool:
        if not sid:
            return False
        with self._lock:
            exp = self._devices.get(_hash(sid))
            return exp is not None and exp > time.time()

    def forget_all(self) -> int:
        with self._lock:
            n = len(self._devices)
            self._devices = {}
            self._save()
            return n

    def pair_url(self, base: str) -> str:
        return f"{base}pair?key={self.key}"


def qr_svg(url: str) -> str | None:
    """The link as an SVG QR code, or None if ``segno`` isn't installed."""
    try:
        import segno
    except ImportError:
        return None
    return segno.make(url, error="m").svg_inline(scale=6, dark="#03080f", light="#ffffff", border=3)


def print_qr(url: str) -> bool:
    """Print a QR code in the terminal. False if ``segno`` isn't installed."""
    try:
        import segno
    except ImportError:
        return False
    try:
        segno.make(url, error="l").terminal(compact=True)
    except Exception:  # some Windows consoles can't draw it
        return False
    return True
