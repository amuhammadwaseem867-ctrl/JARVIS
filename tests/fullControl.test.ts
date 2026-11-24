import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3912;
const TOKEN = "f".repeat(40);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess;
let dataDir: string;

function env(extra: Record<string, string> = {}) {
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    AIRA_APP_ROOT: ROOT,
    AIRA_DATA_DIR: dataDir,
    ULTRON_SESSION_TOKEN: TOKEN,
    ULTRON_QUIET_URL: "1",
    ULTRON_FULL_CONTROL: "1",
    ...extra,
  };
}

async function api(p: string, body: unknown, token = TOKEN) {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ultron-Token": token },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-fc-"));
  child = spawn(process.execPath, [path.join(ROOT, "dist", "server.cjs")], { env: env(), stdio: "pipe" });
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

test("Full Control: shell commands run without approval", async () => {
  const r = await api("/api/system/action", { action: "run_shell", command: "echo ultron-ok" });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.match(r.json.stdout, /ultron-ok/);
});

test("Full Control: no approval prompts", async () => {
  const r = await api("/api/system/action", { action: "type_text", text: "hi" });
  assert.equal(r.status, 200);
  assert.notEqual(r.json.needsApproval, true);
});

test("Full Control: still needs the session token", async () => {
  const r = await api("/api/system/action", { action: "run_shell", command: "echo x" }, "wrong");
  assert.equal(r.status, 401);
});

test("Full Control: capabilities report it so the UI can show the badge", async () => {
  const r = await fetch(BASE + "/api/capabilities", { headers: { "X-Ultron-Token": TOKEN } }).then((x) => x.json());
  assert.equal(r.fullControl, true);
});

test("Full Control: actions are audited", async () => {
  await new Promise((r) => setTimeout(r, 200));
  const log = fs.readFileSync(path.join(dataDir, "data", "audit.log"), "utf8");
  assert.match(log, /run_shell/);
});

test("Full Control refuses to start when exposed to the network", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "dist", "server.cjs")], {
    env: env({ ULTRON_HOST: "0.0.0.0", PORT: "3913" }),
    timeout: 10_000,
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to start/);
});
