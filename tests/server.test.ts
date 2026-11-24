import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3911;
const TOKEN = "t".repeat(40);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess;
let dataDir: string;

function raw(method: string, p: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function api(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", "X-Ultron-Token": TOKEN, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-test-"));
  child = spawn(process.execPath, [path.join(ROOT, "dist", "server.cjs")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      AIRA_APP_ROOT: ROOT,
      AIRA_DATA_DIR: dataDir,
      ULTRON_SESSION_TOKEN: TOKEN,
      ULTRON_QUIET_URL: "1",
      GEMINI_API_KEY: "AIzaTEST-SECRET-KEY-123456",
      ULTRON_WORKSPACE: path.join(dataDir, "ws-home-check"),
    },
    stdio: "pipe",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE + "/");
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

test("API rejects requests without the session token", async () => {
  const r = await fetch(BASE + "/api/core");
  assert.equal(r.status, 401);
});

test("API rejects a wrong token", async () => {
  const r = await api("GET", "/api/core", undefined, { "X-Ultron-Token": "wrong" });
  assert.equal(r.status, 401);
});

test("old key endpoint no longer leaks the Gemini key", async () => {
  const r = await api("GET", "/api/config");
  assert.ok(!JSON.stringify(r.json).includes("AIzaTEST"));
});

test("DNS rebinding: foreign Host header is refused", async () => {
  const r = await raw("GET", "/api/core", { Host: `evil.example:${PORT}`, "X-Ultron-Token": TOKEN });
  assert.equal(r.status, 421);
});

test("cross-origin requests are refused even with a token", async () => {
  const r = await raw("POST", "/api/core/memory", {
    Host: `localhost:${PORT}`,
    Origin: "https://evil.example",
    "Content-Type": "application/json",
    "X-Ultron-Token": TOKEN,
  }, JSON.stringify({ content: "x" }));
  assert.equal(r.status, 403);
});

test("saved API keys are masked in every response", async () => {
  const r = await api("POST", "/api/core/settings", { keys: { geminiApiKeyOverride: "AIzaUSERKEY-abcdef9999" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.state.settings.keys.geminiApiKeyOverride, "••••9999");
  const g = await api("GET", "/api/core");
  assert.ok(!JSON.stringify(g.json).includes("AIzaUSERKEY"));
  // Sending the mask back keeps the real key.
  await api("POST", "/api/core/settings", { keys: { geminiApiKeyOverride: "••••9999" } });
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "data", "aira-core.json"), "utf8"));
  assert.equal(stored.settings.keys.geminiApiKeyOverride, "AIzaUSERKEY-abcdef9999");
});

test("data files are private to the user", async () => {
  const mode = fs.statSync(path.join(dataDir, "data", "aira-core.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("shell execution is gone", async () => {
  const r = await api("POST", "/api/system/action", { action: "run_shell", command: "id" });
  assert.equal(r.status, 403);
  const old = await api("POST", "/api/system/python", { action: "run_shell", command: "id" });
  assert.equal(old.status, 410);
});

test("typing needs a one-time approval bound to the exact action", async () => {
  const action = { action: "type_text", text: "hello" };
  const first = await api("POST", "/api/system/action", action);
  assert.equal(first.status, 403);
  assert.equal(first.json.needsApproval, true);
  assert.deepEqual(first.json.approve, action);

  // A grant for different text cannot be reused.
  const other = await api("POST", "/api/approvals", { action: { action: "type_text", text: "rm -rf" } });
  const swapped = await api("POST", "/api/system/action", { ...action, approvalId: other.json.approvalId });
  assert.equal(swapped.status, 403);

  const grant = await api("POST", "/api/approvals", { action });
  const ok = await api("POST", "/api/system/action", { ...action, approvalId: grant.json.approvalId });
  assert.equal(ok.status, 200); // runs (fails on Linux with "requires macOS", which is fine)

  const replay = await api("POST", "/api/system/action", { ...action, approvalId: grant.json.approvalId });
  assert.equal(replay.status, 403, "grants are single use");
});

test("safe actions run without approval", async () => {
  const r = await api("POST", "/api/system/action", { action: "run_command", preset: "uptime" });
  assert.equal(r.status, 200);
  assert.equal(r.json.preset, "uptime");
});

test("screen control needs approval", async () => {
  const r = await api("POST", "/api/system/screen-task", { goal: "open notes" });
  assert.equal(r.status, 403);
  assert.equal(r.json.needsApproval, true);
});

test("WhatsApp bridge is off by default", async () => {
  const r = await api("GET", "/api/whatsapp/status");
  assert.equal(r.status, 403);
});

test("security headers are set", async () => {
  const r = await fetch(BASE + "/");
  assert.match(r.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("audit log records actions without the typed text", async () => {
  await new Promise((r) => setTimeout(r, 200));
  const log = fs.readFileSync(path.join(dataDir, "data", "audit.log"), "utf8");
  assert.match(log, /system\.action/);
  assert.ok(!log.includes('"hello"'));
});

test("production bundle contains no API key", () => {
  const assets = path.join(ROOT, "dist", "assets");
  for (const f of fs.readdirSync(assets, { recursive: true }) as string[]) {
    const full = path.join(assets, f);
    if (!fs.statSync(full).isFile() || !/\.(js|css|html)$/.test(f)) continue;
    const c = fs.readFileSync(full, "utf8");
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(c), `key-like string in ${f}`);
  }
});

test("local mode works without any API key", async () => {
  const r = await api("POST", "/api/local/chat", { text: "open whatsapp" });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.source, "command");
  assert.deepEqual(r.json.action, { action: "open_app", target: "WhatsApp" });
  const chat = await api("POST", "/api/local/chat", { text: "tell me a story" });
  assert.equal(chat.json.ok, true);
  assert.ok(["help", "ollama"].includes(chat.json.source));
});

test("local chat also needs the session token", async () => {
  const r = await fetch(BASE + "/api/local/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
});
