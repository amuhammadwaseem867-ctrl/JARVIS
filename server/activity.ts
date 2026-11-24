import type { Response } from "express";

/**
 * Silvia live activity: one event stream shared by every open Silvia window
 * (the computer and paired phones), so both show the same conversation and
 * actions, and a spoken command is only acted on once.
 */

type Client = { res: Response; phone: boolean; id: string; sessionOn: boolean };

const clients = new Set<Client>();

export function addClient(res: Response, phone: boolean, id = ""): () => void {
  const client = { res, phone, id, sessionOn: false };
  clients.add(client);
  return () => clients.delete(client);
}

/** A window reports when its voice session starts or stops. */
export function setSessionOn(id: string, on: boolean): boolean {
  let found = false;
  for (const c of clients) if (id && c.id === id) ((c.sessionOn = on), (found = true));
  return found;
}

export function anySessionOn(): boolean {
  return [...clients].some((c) => c.sessionOn);
}

function write(client: Client, event: string, data: unknown) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

/**
 * The person pressed Connect or Terminate on one device: the other open
 * windows follow, so the phone and the computer switch on and off together.
 */
export function broadcastSessionSwitch(data: { on: boolean; clientId: string; from: "pc" | "phone" }): number {
  let sent = 0;
  for (const c of clients) {
    if (c.id === data.clientId) continue;
    write(c, "session", data);
    sent++;
  }
  return sent;
}

/** Sends an activity item (what was said or done) to every window. */
export function broadcastActivity(item: { from: "pc" | "phone"; kind: "user" | "ai" | "action"; text: string; clientId?: string }) {
  const data = { ...item, text: item.text.slice(0, 2000), at: Date.now() };
  for (const c of clients) write(c, "activity", data);
  return clients.size;
}

/**
 * The wake listener runs on the computer's microphone, so the wake goes to the
 * computer's windows. Phones only get it when no computer window is open.
 * Without this, the computer and the phone would both start a session and
 * both run the same command. While any session is on, wakes are dropped.
 */
export function broadcastWake(data: { command: string; source: string }): number {
  // A live session already hears the room through its own microphone; a second
  // copy of the command from the wake listener would run everything twice.
  if (anySessionOn()) return 0;
  const pcs = [...clients].filter((c) => !c.phone);
  const targets = pcs.length > 0 ? pcs : [...clients];
  for (const c of targets) write(c, "wake", data);
  return targets.length;
}

export function clientCount() {
  return clients.size;
}

/**
 * Drops repeats of the same visible action fired within a few seconds, e.g.
 * the model calling openWebsite and openApplication for one "open YouTube",
 * or hearing its own voice and asking again. The first call runs; repeats
 * get the same success answer without opening another window.
 */
export class ActionDeduper {
  private seen = new Map<string, number>();
  constructor(private windowMs = 5000) {}

  static key(payload: Record<string, any>): string | null {
    const action = String(payload.action || "");
    const norm = (v: unknown) =>
      String(v ?? "")
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/+$/, "")
        .replace(/\.(com|net|org|io|pk|co|app)$/, ""); // "youtube.com" and "YouTube" are the same request
    if (action === "open_app") return `open:${norm(payload.target || payload.app)}`;
    if (action === "run_command") return `preset:${norm(payload.preset || payload.command)}`;
    if (action === "notify") return `notify:${norm(payload.title)}:${norm(payload.message)}`;
    if (action === "volume") return `volume:${norm(payload.level)}:${norm(payload.mute)}`;
    return null;
  }

  /** True when this action already ran inside the window. Records it otherwise. */
  isRepeat(payload: Record<string, any>, now = Date.now()): boolean {
    const key = ActionDeduper.key(payload);
    if (!key) return false;
    for (const [k, t] of this.seen) if (now - t > this.windowMs) this.seen.delete(k);
    const last = this.seen.get(key);
    if (last !== undefined && now - last <= this.windowMs) return true;
    this.seen.set(key, now);
    return false;
  }
}
