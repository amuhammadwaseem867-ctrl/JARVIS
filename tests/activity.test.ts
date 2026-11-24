import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionDeduper } from "../server/activity";

test("the same open request twice in a few seconds runs once", () => {
  const d = new ActionDeduper(5000);
  assert.equal(d.isRepeat({ action: "open_app", target: "YouTube" }, 1000), false);
  assert.equal(d.isRepeat({ action: "open_app", target: "https://www.youtube.com/" }, 2000), true);
  assert.equal(d.isRepeat({ action: "open_app", target: "youtube.com" }, 3000), true);
  assert.equal(d.isRepeat({ action: "open_app", target: "Chrome" }, 3000), false);
  // After the window it can be opened again on purpose.
  assert.equal(d.isRepeat({ action: "open_app", target: "youtube" }, 9000), false);
});

test("typing, clicks and shell commands are never merged", () => {
  const d = new ActionDeduper(5000);
  for (const p of [{ action: "type_text", text: "a" }, { action: "mouse_click" }, { action: "run_shell", command: "dir" }]) {
    assert.equal(d.isRepeat(p, 1), false);
    assert.equal(d.isRepeat(p, 2), false);
  }
});

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3961;
const TOKEN = "a".repeat(40);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess;
let dataDir: string;

const post = (p: string, body: unknown) =>
  fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ultron-Token": TOKEN },
    body: JSON.stringify(body),
  }).then((r) => r.json());

/** Opens the event stream and collects events until closed. */
async function listen(client: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/events?client=${client}`, { headers: { "X-Ultron-Token": TOKEN }, signal: ctrl.signal });
  const events: { type: string; data: any }[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = block.match(/^event: (\w+)/)?.[1];
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (type && data) events.push({ type, data: JSON.parse(data.slice(6)) });
        }
      }
    } catch {}
  })();
  await new Promise((r) => setTimeout(r, 150));
  return { events, close: () => ctrl.abort() };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-act-"));
  child = spawn(process.execPath, [path.join(ROOT, "dist", "server.cjs")], {
    env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), AIRA_APP_ROOT: ROOT, AIRA_DATA_DIR: dataDir, ULTRON_SESSION_TOKEN: TOKEN, ULTRON_QUIET_URL: "1" },
    stdio: "pipe",
  });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(BASE + "/");
      return;
    } catch {
      await wait(100);
    }
  }
  throw new Error("server did not start");
});

after(() => {
  child?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("what is said in one window shows in the others", async () => {
  const a = await listen("winA");
  const b = await listen("winB");
  assert.equal((await post("/api/activity", { kind: "user", text: "open youtube", clientId: "winA" })).ok, true);
  await wait(150);
  assert.deepEqual(b.events.filter((e) => e.type === "activity").map((e) => [e.data.kind, e.data.text, e.data.from]), [["user", "open youtube", "pc"]]);
  // The sender gets it too, tagged with its id, so it can skip its own copy.
  assert.equal(a.events.find((e) => e.type === "activity")?.data.clientId, "winA");
  assert.equal((await post("/api/activity", { kind: "hack", text: "x" })).ok, false);
  a.close();
  b.close();
});

test("the wake word is not delivered while a session is already listening", async () => {
  const a = await listen("winC");
  assert.equal((await post("/api/wake", { command: "open youtube" })).delivered, 1);
  assert.equal((await post("/api/session-state", { clientId: "winC", on: true })).ok, true);
  assert.equal((await post("/api/wake", { command: "open youtube" })).delivered, 0);
  await post("/api/session-state", { clientId: "winC", on: false });
  assert.equal((await post("/api/wake", { command: "" })).delivered, 1);
  await wait(100);
  assert.equal(a.events.filter((e) => e.type === "wake").length, 2);
  a.close();
});

test("Connect on one device switches the other devices too, not itself", async () => {
  const phone = await listen("devPhone");
  const pc = await listen("devPc");
  assert.equal((await post("/api/session-switch", { on: true, clientId: "devPhone" })).delivered, 1);
  await post("/api/session-switch", { on: false, clientId: "devPhone" });
  await wait(150);
  assert.deepEqual(pc.events.filter((e) => e.type === "session").map((e) => e.data.on), [true, false]);
  assert.equal(phone.events.filter((e) => e.type === "session").length, 0);
  assert.equal((await post("/api/session-switch", { on: true })).ok, false);
  phone.close();
  pc.close();
});
