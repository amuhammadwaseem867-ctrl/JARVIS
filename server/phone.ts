import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { Request } from "express";

/**
 * Silvia phone mode: use Silvia from an iPhone or Android browser on the same
 * Wi-Fi, microphone included.
 *
 * Phones only allow the microphone on HTTPS pages, so Silvia serves itself a
 * second time on the local network over HTTPS, with a certificate made on this
 * computer. Nobody on the Wi-Fi gets in without pairing first: scanning the QR
 * code shown in Silvia on the computer, or typing its 6-digit code. A paired
 * phone gets a long random cookie and stays paired for 30 days.
 *
 * Same design as the original JARVIS phone mode.
 */

export const PHONE_ENABLED = process.env.ULTRON_PHONE === "1";
export const PHONE_PORT = Number(process.env.ULTRON_PHONE_PORT) || 3443;
export const PHONE_COOKIE = "ultron_phone";
const SESSION_DAYS = 30;
const MAX_CODE_TRIES = 5;
const CODE_TTL_MS = 10 * 60_000;

let dir = "";

export function initPhone(dataDir: string) {
  dir = path.join(dataDir, "phone");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** This computer's address on the local network. ULTRON_LAN_IP overrides it. */
export function lanIp(): string | null {
  const override = (process.env.ULTRON_LAN_IP || "").trim();
  if (override) return override;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal && isPrivate(a.address)) return a.address;
    }
  }
  return null;
}

function isPrivate(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

export function phoneOrigin(): string | null {
  const ip = lanIp();
  return ip ? `https://${ip}:${PHONE_PORT}` : null;
}

export function isPhoneRequest(req: Request): boolean {
  return PHONE_ENABLED && req.socket.localPort === PHONE_PORT;
}

/* ---------- certificate ---------- */

const CERT_FORMAT = "v2"; // v2: leaf signed by a local Silvia CA (iPhone can trust it)

async function selfsignedGenerate(): Promise<(attrs: unknown, opts: unknown) => Promise<{ private: string; cert: string }>> {
  const selfsigned: any = await import("selfsigned");
  return selfsigned.generate ?? selfsigned.default?.generate;
}

/**
 * A small certificate authority made on this computer, used only to sign the
 * phone listener's certificate. Installing it on an iPhone (Settings, then
 * Certificate Trust Settings) removes the warning and lets the home screen
 * app open; iOS refuses untrusted certificates in home screen apps.
 */
async function loadOrCreateCa(): Promise<{ key: string; cert: string }> {
  const keyFile = path.join(dir, "ca-key.pem");
  const certFile = path.join(dir, "ca.pem");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile, "utf8"), cert: fs.readFileSync(certFile, "utf8") };
  }
  const gen = await selfsignedGenerate();
  const pems = await gen([{ name: "commonName", value: "Silvia local CA (this computer only)" }, { name: "organizationName", value: "Silvia" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 10 * 365 * 86400_000),
    extensions: [
      { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    ],
  });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert, { mode: 0o600 });
  return { key: pems.private, cert: pems.cert };
}

/** The CA certificate (public part only) for installing on the phone. */
export async function caCertificate(): Promise<string> {
  return (await loadOrCreateCa()).cert;
}

export async function loadOrCreateCert(ip: string): Promise<{ key: string; cert: string }> {
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  const ipFile = path.join(dir, "cert-ip.txt");
  const stamp = `${ip}|${CERT_FORMAT}`;
  const fresh = fs.existsSync(certFile) && Date.now() - fs.statSync(certFile).mtimeMs < 380 * 86400_000;
  if (fresh && fs.existsSync(keyFile) && fs.existsSync(ipFile) && fs.readFileSync(ipFile, "utf8").trim() === stamp) {
    return { key: fs.readFileSync(keyFile, "utf8"), cert: fs.readFileSync(certFile, "utf8") };
  }
  const ca = await loadOrCreateCa();
  const gen = await selfsignedGenerate();
  const pems = await gen([{ name: "commonName", value: ip }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 397 * 86400_000), // Apple's limit for server certificates
    ca,
    extensions: [
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 7, ip }, { type: 2, value: "localhost" }] },
    ],
  });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  // Send the CA along with the leaf so phones can build the chain.
  const chain = `${pems.cert.trim()}\n${ca.cert.trim()}\n`;
  fs.writeFileSync(certFile, chain, { mode: 0o600 });
  fs.writeFileSync(ipFile, stamp, { mode: 0o600 });
  return { key: pems.private, cert: chain };
}

/* ---------- pairing ---------- */

let pairing: { code: string; link: string; expires: number; tries: number } | null = null;

/** A fresh 6-digit code plus a one-time link token for the QR code. */
export function newPairing(): { code: string; token: string; expires: number } {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const token = crypto.randomBytes(24).toString("base64url");
  pairing = { code, link: token, expires: Date.now() + CODE_TTL_MS, tries: 0 };
  return { code, token, expires: pairing.expires };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Check a code or QR token. Wrong guesses burn the pairing after 5 tries. */
export function redeem(input: { code?: unknown; token?: unknown }): "ok" | "wrong" | "expired" {
  if (!pairing || pairing.expires < Date.now()) {
    pairing = null;
    return "expired";
  }
  const code = typeof input.code === "string" ? input.code.replace(/\D/g, "") : "";
  const token = typeof input.token === "string" ? input.token : "";
  const good = (code && safeEqual(code, pairing.code)) || (token && safeEqual(token, pairing.link));
  if (good) {
    pairing = null; // single use
    return "ok";
  }
  pairing.tries += 1;
  if (pairing.tries >= MAX_CODE_TRIES) pairing = null;
  return "wrong";
}

/* ---------- paired devices ---------- */

type Device = { hash: string; name: string; created: number; expires: number };

function devicesFile() {
  return path.join(dir, "devices.json");
}

function readDevices(): Device[] {
  try {
    const list: Device[] = JSON.parse(fs.readFileSync(devicesFile(), "utf8"));
    return list.filter((d) => d.expires > Date.now());
  } catch {
    return [];
  }
}

function writeDevices(list: Device[]) {
  fs.writeFileSync(devicesFile(), JSON.stringify(list, null, 2), { mode: 0o600 });
}

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** Store a new paired phone. Returns the cookie value (only its hash is kept). */
export function addDevice(userAgent: string): string {
  const secret = crypto.randomBytes(32).toString("base64url");
  const list = readDevices();
  list.push({
    hash: sha(secret),
    name: describeDevice(userAgent),
    created: Date.now(),
    expires: Date.now() + SESSION_DAYS * 86_400_000,
  });
  writeDevices(list.slice(-10));
  return secret;
}

export function isPairedCookie(cookieHeader: string | undefined): boolean {
  const value = readCookie(cookieHeader, PHONE_COOKIE);
  if (!value) return false;
  const h = sha(value);
  return readDevices().some((d) => safeEqual(d.hash, h));
}

export function listDevices() {
  return readDevices().map((d) => ({ name: d.name, created: d.created, expires: d.expires }));
}

export function forgetAllDevices() {
  writeDevices([]);
}

export function cookieHeader(secret: string): string {
  return `${PHONE_COOKIE}=${secret}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

function readCookie(header: string | undefined, name: string): string {
  for (const part of String(header || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

function describeDevice(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  return "Phone";
}

/* ---------- pairing page ---------- */

export function pairPage(error = ""): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#05070a"><title>Pair with Silvia</title>
<style>
:root{--bg:#05070a;--card:#0d1117;--line:rgba(255,255,255,.1);--text:#f4f6f8;--muted:#8b949e;--accent:#00e5f2;--err:#ff6b6b}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px 16px}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 22px}
p.k{margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
h1{margin:0 0 8px;font-size:24px;letter-spacing:-.01em}p{color:var(--muted);margin:0 0 20px;font-size:15px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:8px}
input{width:100%;height:56px;border-radius:12px;border:1px solid var(--line);background:#05070a;color:var(--text);font-size:28px;letter-spacing:.4em;text-align:center;font-variant-numeric:tabular-nums}
input:focus{outline:2px solid var(--accent);outline-offset:2px}
button{margin-top:16px;width:100%;height:50px;border:0;border-radius:12px;background:var(--accent);color:#001316;font-size:16px;font-weight:650}
.err{color:var(--err);font-size:14px;margin:12px 0 0}
</style></head><body><main>
<p class="k">Silvia</p><h1>Pair this phone</h1>
<p>On your computer, open Silvia and press <strong>Connect phone</strong>. Scan the QR code, or type the 6-digit code here.</p>
<form method="post" action="/pair"><label for="c">Pairing code</label>
<input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
<button type="submit">Pair</button>${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}</form>
<p style="margin:18px 0 0;font-size:14px"><a href="/install" style="color:var(--accent)">Install Silvia as an app on this phone</a></p>
</main></body></html>`;
}

/* ---------- install as an app ---------- */

export function installPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#05070a"><title>Install Silvia</title>
<style>
:root{--bg:#05070a;--card:#0d1117;--line:rgba(255,255,255,.1);--text:#f4f6f8;--muted:#8b949e;--accent:#00e5f2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:28px 16px}
main{max-width:460px;margin:0 auto}p.k{margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
h1{margin:0 0 20px;font-size:26px;letter-spacing:-.01em}h2{font-size:17px;margin:28px 0 10px}
ol{margin:0;padding-left:22px;color:var(--muted)}li{margin:0 0 10px}strong{color:var(--text)}
a.btn{display:block;text-align:center;margin:14px 0 6px;height:50px;line-height:50px;border-radius:12px;background:var(--accent);color:#001316;font-weight:650;text-decoration:none}
.note{font-size:13px;color:var(--muted);border-top:1px solid var(--line);margin-top:28px;padding-top:16px}
</style></head><body><main>
<p class="k">Silvia</p><h1>Install Silvia on your phone</h1>
<h2>iPhone (Safari)</h2>
<ol>
<li><strong>Trust this computer once.</strong> Tap the button below and choose <strong>Allow</strong>.
<a class="btn" href="/ultron-ca.crt">Download Silvia certificate</a></li>
<li>Open <strong>Settings</strong>, tap <strong>Profile Downloaded</strong> at the top, then <strong>Install</strong>.</li>
<li>Go to <strong>Settings, General, About, Certificate Trust Settings</strong> and switch on <strong>Silvia local CA</strong>.</li>
<li>Back in Safari, open this page's address again, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
<li>Open Silvia from the new icon and pair once with the 6-digit code from your computer.</li>
</ol>
<h2>Android (Chrome)</h2>
<ol>
<li>Tap the <strong>three dots</strong> menu, then <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
<li>Open Silvia from the new icon and pair once.</li>
</ol>
<p class="note">The certificate is made on your computer and only works for Silvia on your own Wi-Fi. To remove it later, delete the profile in Settings, General, VPN and Device Management. Voice works while Silvia is open on screen; phones do not let web apps listen when locked or in the background.</p>
</main></body></html>`;
}
