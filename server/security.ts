import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import { PHONE_PORT, isPairedCookie, isPhoneRequest, lanIp } from "./phone";

/**
 * Silvia: request guard for the local backend.
 *
 * The original AIRA server listened on 0.0.0.0 with no authentication, so any
 * device on the same network (or any web page, through DNS rebinding) could
 * read the Gemini key and run shell commands. Every /api call now needs:
 *   1. a Host header that is this machine (blocks DNS rebinding),
 *   2. no foreign Origin (blocks cross-site requests),
 *   3. the per-launch session token (blocks other local users and apps).
 */

export const SESSION_TOKEN: string =
  process.env.ULTRON_SESSION_TOKEN && process.env.ULTRON_SESSION_TOKEN.length >= 32
    ? process.env.ULTRON_SESSION_TOKEN
    : crypto.randomBytes(32).toString("base64url");

export const TOKEN_HEADER = "x-ultron-token";

function allowedHosts(port: number): Set<string> {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function hostAndOriginGuard(port: number) {
  const localHosts = allowedHosts(port);
  return (req: Request, res: Response, next: NextFunction) => {
    // Phone listener: only this computer's LAN address on the phone port.
    const ip = isPhoneRequest(req) ? lanIp() : null;
    const hosts = ip ? new Set([`${ip}:${PHONE_PORT}`]) : localHosts;
    const host = String(req.headers.host || "").toLowerCase();
    if (!hosts.has(host)) {
      return res.status(421).json({ ok: false, error: "Unrecognised host." });
    }
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    // Browsers send "Origin: null" on same-page form posts under Referrer-Policy: no-referrer.
    const nullSameOrigin = origin === "null" && site === "same-origin";
    if (origin && !nullSameOrigin && !hosts.has(origin.replace(/^https?:\/\//, "").toLowerCase())) {
      return res.status(403).json({ ok: false, error: "Cross-origin request blocked." });
    }
    if (req.path.startsWith("/api") && site && site !== "same-origin" && site !== "none") {
      return res.status(403).json({ ok: false, error: "Cross-site request blocked." });
    }
    next();
  };
}

export function requireToken(req: Request, res: Response, next: NextFunction) {
  if (isPhoneRequest(req)) {
    if (req.path.startsWith("/phone/")) {
      return res.status(403).json({ ok: false, error: "Phone settings can only be changed on the computer." });
    }
    return isPairedCookie(req.headers.cookie) ? next() : res.status(401).json({ ok: false, error: "This phone is not paired." });
  }
  const supplied = String(req.headers[TOKEN_HEADER] || "");
  if (!supplied || !safeEqual(supplied, SESSION_TOKEN)) {
    return res.status(401).json({ ok: false, error: "Missing or invalid session token. Open Silvia from the link printed at startup." });
  }
  next();
}

export function securityHeaders(isProd: boolean) {
  const csp = [
    "default-src 'self'",
    // Vite dev server injects inline scripts for React refresh.
    isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:* wss://generativelanguage.googleapis.com https://generativelanguage.googleapis.com https://api.spaceflightnewsapi.net",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
    next();
  };
}

/* ---------- Action policy ---------- */

export type Risk = "auto" | "confirm" | "blocked";

const URL_ALIASES = new Set(["youtube", "facebook", "gmail", "github", "twitter", "x", "google"]);

/**
 * Decide whether a system action may run on its own or needs the person to
 * approve it first. Anything that types, clicks, reads private data, sends
 * data to a new destination or writes files needs approval.
 */
export function classifyAction(payload: Record<string, any>): Risk {
  const action = String(payload?.action || "");
  switch (action) {
    case "status":
    case "volume":
    case "notify":
    case "mouse_move":
    case "run_command":
      return "auto";
    case "open_app": {
      const target = String(payload.target || payload.app || "").trim().toLowerCase();
      if (/^https?:\/\//.test(target)) return "confirm"; // a link can carry data out in its query string
      if (URL_ALIASES.has(target)) return "auto";
      return "auto";
    }
    case "fs_op":
      return payload.operation === "list" ? "auto" : "confirm";
    case "screenshot":
    case "mouse_click":
    case "type_text":
    case "hotkey":
    case "clipboard_get":
    case "clipboard_set":
      return "confirm";
    default:
      return "blocked";
  }
}

/* ---------- Approvals ---------- */

/**
 * One-time approval grants. The UI asks the person, then calls
 * POST /api/approvals with the exact action; the server returns a grant id
 * bound to a hash of that action. A grant works once, for that action only,
 * within 60 seconds. This keeps the server, not the browser code, as the
 * final gate.
 */
const grants = new Map<string, { hash: string; expires: number }>();

function hashAction(payload: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((k) => k !== "approvalId").sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function createGrant(payload: unknown): string {
  const id = crypto.randomBytes(16).toString("hex");
  grants.set(id, { hash: hashAction(payload), expires: Date.now() + 60_000 });
  return id;
}

export function consumeGrant(id: unknown, payload: unknown): boolean {
  if (typeof id !== "string") return false;
  const grant = grants.get(id);
  grants.delete(id);
  if (!grant || grant.expires < Date.now()) return false;
  return grant.hash === hashAction(payload);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, g] of grants) if (g.expires < now) grants.delete(id);
}, 30_000).unref();

/* ---------- Audit log ---------- */

let auditFile = "";

export function initAudit(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  auditFile = path.join(dataDir, "audit.log");
}

const REDACT_KEYS = new Set(["text", "content", "imageBase64", "audioBytes"]);

export function audit(event: string, detail: Record<string, any>) {
  if (!auditFile) return;
  const safe: Record<string, any> = {};
  for (const [k, v] of Object.entries(detail || {})) {
    if (REDACT_KEYS.has(k) && typeof v === "string") safe[k] = `[${v.length} chars]`;
    else safe[k] = v;
  }
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...safe }) + "\n";
  fs.appendFile(auditFile, line, { mode: 0o600 }, () => {});
}

/* ---------- Secrets ---------- */

export function maskSecret(value: string | undefined): string {
  const v = String(value || "");
  if (!v) return "";
  return v.length <= 8 ? "••••" : `••••${v.slice(-4)}`;
}

export function isMasked(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("••••");
}
