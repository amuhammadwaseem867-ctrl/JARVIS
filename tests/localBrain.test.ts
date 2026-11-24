import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent, pickModel } from "../server/localBrain";

test("understands time and date in English and Roman Urdu", () => {
  const now = new Date("2026-11-24T17:05:00");
  assert.match(parseIntent("what's the time?", now)!.reply, /5:05/);
  assert.match(parseIntent("time kya hai", now)!.reply, /5:05/);
  assert.match(parseIntent("aaj ki date", now)!.reply, /November 24, 2026/);
});

test("maps open commands to safe open_app actions", () => {
  assert.deepEqual(parseIntent("open whatsapp")!.action, { action: "open_app", target: "WhatsApp" });
  assert.deepEqual(parseIntent("chrome kholo")!.action, { action: "open_app", target: "Google Chrome" });
  assert.equal(parseIntent("open terminal"), null, "unknown apps fall through to chat, never to a raw target");
});

test("volume and presets", () => {
  assert.deepEqual(parseIntent("volume 40")!.action, { action: "volume", level: 40 });
  assert.deepEqual(parseIntent("set the volume to 250")!.action, { action: "volume", level: 100 });
  assert.deepEqual(parseIntent("mute")!.action, { action: "volume", mute: true });
  assert.deepEqual(parseIntent("battery kitni hai")!.action, { action: "run_command", preset: "battery" });
});

test("ordinary conversation is not treated as a command", () => {
  assert.equal(parseIntent("tell me a joke about cats"), null);
  assert.equal(parseIntent("how are you"), null);
});

test("picks an installed Ollama model", () => {
  assert.equal(pickModel(["llama3.2:latest", "qwen2.5:7b"], "llama3.2"), "llama3.2:latest");
  assert.equal(pickModel(["qwen2.5:7b"], "llama3.2"), "qwen2.5:7b");
});

test("run <command> maps to run_shell", () => {
  assert.deepEqual(parseIntent("run ls -la ~/Desktop")!.action, { action: "run_shell", command: "ls -la ~/Desktop" });
});

test("several commands in one sentence become several actions", async () => {
  const { parseIntents } = await import("../server/localBrain");
  const r = parseIntents("open YouTube and volume 40, then check battery")!;
  assert.deepEqual(r.actions, [
    { action: "open_app", target: "youtube" },
    { action: "volume", level: 40 },
    { action: "run_command", preset: "battery" },
  ]);
  // The open verb carries over: "YouTube aur Chrome kholo".
  assert.deepEqual(parseIntents("youtube aur chrome kholo")!.actions.map((a) => a.target), ["youtube", "Google Chrome"]);
  // Shell commands are never split.
  assert.equal(parseIntents("run echo a and echo b")!.actions.length, 1);
  // Not all parts are commands: one request.
  assert.equal(parseIntents("open youtube and tell me a joke")!.actions.length, 1);
});
