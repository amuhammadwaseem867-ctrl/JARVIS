import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { matchWake } from "../src/services/wakeWord";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3931;
const PHONE_PORT = 3932;
const PHONE_IP = "127.0.0.2";
const TOKEN = "w".repeat(40);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess;
let dataDir: string;

function phone(
  method: string,
  p: string,
  opts: { body?: string; cookie?: string; type?: string; extra?: Record<string, string> } = {},
) {
  return new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
    const req = https.request(
      {
        host: PHONE_IP,
        port: PHONE_PORT,
        method,
        path: p,
        rejectUnauthorized: false,
        headers: {
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
          ...(opts.body ? { "Content-Type": opts.type || "application/x-www-form-urlencoded" } : {}),
          ...(opts.extra || {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function desktop(method: string, p: string, body?: unknown) {
  const res = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", "X-Ultron-Token": TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-pw-"));
  child = spawn(process.execPath, [path.join(ROOT, "dist", "server.cjs")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      AIRA_APP_ROOT: ROOT,
      AIRA_DATA_DIR: dataDir,
      ULTRON_SESSION_TOKEN: TOKEN,
      ULTRON_QUIET_URL: "1",
      ULTRON_PHONE: "1",
      ULTRON_PHONE_PORT: String(PHONE_PORT),
      ULTRON_LAN_IP: PHONE_IP,
    },
    stdio: "pipe",
  });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(BASE + "/");
      await phone("GET", "/");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start");
});

after(() => {
  child?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("wake word matcher", () => {
  assert.equal(matchWake("Ultron, open WhatsApp"), "open WhatsApp");
  assert.equal(matchWake("hey ultron"), "");
  assert.equal(matchWake("what is the time ultron?"), "what is the time?");
  assert.equal(matchWake("open notes please"), null);
  assert.equal(matchWake("ultra on volume 40"), "volume 40");
  assert.equal(matchWake("wake up"), "");
  assert.equal(matchWake("Ultron, wake up!"), "");
  assert.equal(matchWake("wake up, open YouTube"), "open YouTube");
});

test("wake events reach open windows and need the token", async () => {
  const noTok = await fetch(BASE + "/api/wake", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(noTok.status, 401);

  const ctrl = new AbortController();
  const stream = await fetch(BASE + "/api/events", { headers: { "X-Ultron-Token": TOKEN }, signal: ctrl.signal });
  const reader = stream.body!.getReader();
  await reader.read(); // ": connected"
  const sent = await desktop("POST", "/api/wake", { command: "open notes", source: "voice" });
  assert.equal(sent.delivered, 1);
  let text = "";
  while (!text.includes("event: wake")) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"command":"open notes"/);
  ctrl.abort();
});

test("phone: unpaired phones only see the pairing page", async () => {
  const page = await phone("GET", "/");
  assert.equal(page.status, 401);
  assert.match(page.body, /Pair this phone/);
  const apiCall = await phone("GET", "/api/core");
  assert.equal(apiCall.status, 401);
});

test("phone: pairing with the 6-digit code gives a 30-day secure cookie", async () => {
  const pair = await desktop("POST", "/api/phone/pair-code");
  assert.equal(pair.ok, true);
  assert.match(pair.code, /^\d{6}$/);
  assert.match(pair.qr, /^data:image\/png;base64,/);

  const res = await phone("POST", "/pair", { body: `code=${pair.code}` });
  assert.equal(res.status, 303);
  const cookie = String(res.headers["set-cookie"]?.[0] || "");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);

  const core = await phone("GET", "/api/core", { cookie: cookie.split(";")[0] });
  assert.equal(core.status, 200);

  // Code is single use.
  const again = await phone("POST", "/pair", { body: `code=${pair.code}` });
  assert.notEqual(again.status, 303);

  // A paired phone still cannot create pairing codes or unpair devices.
  const mgmt = await phone("POST", "/api/phone/pair-code", { cookie: cookie.split(";")[0], body: "{}", type: "application/json" });
  assert.equal(mgmt.status, 403);

  const devices = await desktop("GET", "/api/phone/devices");
  assert.equal(devices.devices.length, 1);
});

test("phone: QR link pairs once", async () => {
  const pair = await desktop("POST", "/api/phone/pair-code");
  const t = new URL(pair.url + "/pair?x=1").origin; // origin is the LAN https address
  assert.equal(t, `https://${PHONE_IP}:${PHONE_PORT}`);
});

test("phone: five wrong codes burn the pairing code", async () => {
  const pair = await desktop("POST", "/api/phone/pair-code");
  const wrong = pair.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await phone("POST", "/pair", { body: `code=${wrong}` });
  const late = await phone("POST", "/pair", { body: `code=${pair.code}` });
  assert.equal(late.status, 410);
});

test("phone: the pairing form works from a no-referrer page, and only same-origin", async () => {
  const pair = await desktop("POST", "/api/phone/pair-code");
  const forged = await phone("POST", "/pair", { body: `code=${pair.code}`, extra: { Origin: "null", "Sec-Fetch-Site": "cross-site" } });
  assert.equal(forged.status, 403);
  const real = await phone("POST", "/pair", { body: `code=${pair.code}`, extra: { Origin: "null", "Sec-Fetch-Site": "same-origin" } });
  assert.equal(real.status, 303);
});

test("phone: unpair all", async () => {
  await desktop("POST", "/api/phone/forget");
  const devices = await desktop("GET", "/api/phone/devices");
  assert.equal(devices.devices.length, 0);
});

test("phone can install the app before pairing, and the CA really signs the phone certificate", async () => {
  const install = await phone("GET", "/install");
  assert.equal(install.status, 200);
  assert.match(install.body, /Add to Home Screen/);
  const ca = await phone("GET", "/ultron-ca.crt");
  assert.equal(ca.status, 200);
  assert.match(String(ca.headers["content-type"]), /x509-ca-cert/);
  assert.match(ca.body, /BEGIN CERTIFICATE/);
  assert.equal((await phone("GET", "/manifest.webmanifest")).status, 200);
  // Everything else still needs pairing.
  assert.equal((await phone("GET", "/")).status, 401);
  assert.equal((await phone("GET", "/api/capabilities")).status, 401);
  // A phone that trusts only the Ultron CA accepts the connection (no warning).
  const trusted = await new Promise<number>((resolve, reject) => {
    const req = https.request({ host: PHONE_IP, port: PHONE_PORT, path: "/install", ca: ca.body, rejectUnauthorized: true }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(trusted, 200);
});
