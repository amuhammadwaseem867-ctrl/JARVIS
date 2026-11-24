import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PRO_SKILLS } from "../src/types/proSkills";

const ROOT = path.resolve(import.meta.dirname, "..");
const TOKEN = "s".repeat(40);

async function withServer(dataDir: string, port: number, fn: (base: string) => Promise<void>) {
  const child = spawn(process.execPath, [path.join(ROOT, "dist", "server.cjs")], {
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), AIRA_APP_ROOT: ROOT, AIRA_DATA_DIR: dataDir, ULTRON_SESSION_TOKEN: TOKEN, ULTRON_QUIET_URL: "1", ULTRON_PHONE: "", ULTRON_WAKE: "" },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(base + "/");
        break;
      } catch {
        if (i > 80) throw new Error("server did not start");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await fn(base);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
}

const api = (base: string, p: string, method = "GET") =>
  fetch(base + p, { method, headers: { "X-Ultron-Token": TOKEN } }).then((r) => r.json());

test("professional skills: no double hyphens, all filled in", () => {
  assert.equal(PRO_SKILLS.length, 8);
  for (const s of PRO_SKILLS) {
    assert.ok(s.description && s.whenToUse && s.content.length > 400, s.name);
    assert.ok(!`${s.description}${s.whenToUse}${s.content}`.includes("--"), s.name);
  }
});

test("existing installs get the new skills once; deleted ones stay deleted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-skills-"));
  const file = path.join(dir, "data", "aira-core.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ skills: [{ name: "my-own", description: "x", whenToUse: "", content: "y", enabled: true, usable: true, updatedAt: "" }] }));
  try {
    await withServer(dir, 3981, async (base) => {
      const names = (await api(base, "/api/core")).state.skills.map((s: any) => s.name);
      assert.ok(names.includes("my-own"));
      for (const s of PRO_SKILLS) assert.ok(names.includes(s.name), s.name);
      await api(base, "/api/core/skills/video-editor", "DELETE");
    });
    await withServer(dir, 3982, async (base) => {
      const names = (await api(base, "/api/core")).state.skills.map((s: any) => s.name);
      assert.ok(!names.includes("video-editor"));
      assert.ok(names.includes("web-developer"));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
