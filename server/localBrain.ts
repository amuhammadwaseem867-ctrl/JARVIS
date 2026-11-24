/**
 * Ultron local mode: works without any API key.
 *
 * 1. Common commands (time, date, open an app, volume, battery, disk...) are
 *    understood by a built-in parser, in English and Roman Urdu/Hindi.
 * 2. Everything else goes to a local model through Ollama, if it is running
 *    on this computer. Nothing leaves the machine.
 * 3. Without Ollama, Ultron explains what it can do and how to enable chat.
 *
 * The local model only produces text and is never given tools, so a prompt
 * injection cannot make it act. Parsed commands still pass through the normal
 * approval policy.
 */

export interface LocalAction {
  action: string;
  [key: string]: unknown;
}

export interface IntentResult {
  reply: string;
  action?: LocalAction;
}

const OPEN_WORDS = /\b(open|launch|start|khol(o|do|en|ein|na)?|chala(o|do)?)\b/i;

const APPS: Array<[RegExp, string, string]> = [
  [/\bwhats ?app\b/, "WhatsApp", "WhatsApp"],
  [/\bchrome\b/, "Google Chrome", "Chrome"],
  [/\bsafari\b/, "Safari", "Safari"],
  [/\bfinder\b/, "Finder", "Finder"],
  [/\bnotes\b/, "Notes", "Notes"],
  [/\bspotify\b/, "Spotify", "Spotify"],
  [/\b(vs ?code|visual studio code)\b/, "Visual Studio Code", "VS Code"],
  [/\bcalculator\b/, "Calculator", "Calculator"],
  [/\bcalendar\b/, "Calendar", "Calendar"],
  [/\bmail\b/, "Mail", "Mail"],
  [/\bmessages\b/, "Messages", "Messages"],
  [/\bmusic\b/, "Music", "Music"],
  [/\bsettings\b/, "settings", "Settings"],
  [/\bnotepad\b/, "notepad", "Notepad"],
  [/\b(file explorer|explorer|files)\b/, "file explorer", "File Explorer"],
  [/\b(edge|microsoft edge)\b/, "edge", "Edge"],
  [/\bword\b/, "word", "Word"],
  [/\bexcel\b/, "excel", "Excel"],
  [/\bpaint\b/, "paint", "Paint"],
  [/\bcamera\b/, "camera", "Camera"],
  [/\byoutube\b/, "youtube", "YouTube"],
  [/\bgmail\b/, "gmail", "Gmail"],
  [/\bgithub\b/, "github", "GitHub"],
  [/\bgoogle\b/, "google", "Google"],
];

/** Understands simple commands without any AI model. Returns null when it is not a command. */
export function parseIntent(input: string, now = new Date()): IntentResult | null {
  const text = input.trim().toLowerCase().replace(/[?!.]+$/, "");
  if (!text) return null;

  if (/\b(what('?s| is) the time|time (kya|kia) (hai|hua)|kitne baje|current time)\b/.test(text) || text === "time") {
    return { reply: `It's ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.` };
  }
  if (/\b(what('?s| is) (the )?date|today'?s date|aaj (ki )?(date|tareekh|tarikh)|what day is it)\b/.test(text)) {
    return {
      reply: `Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`,
    };
  }
  if (OPEN_WORDS.test(text)) {
    for (const [re, target, label] of APPS) {
      if (re.test(text)) return { reply: `Opening ${label}.`, action: { action: "open_app", target } };
    }
  }
  if (/\b(unmute|awaz (on|kholo|wapas))\b/.test(text)) {
    return { reply: "Unmuting.", action: { action: "volume", mute: false } };
  }
  if (/\b(mute|awaz band)\b/.test(text)) {
    return { reply: "Muting.", action: { action: "volume", mute: true } };
  }
  const vol = text.match(/\b(?:volume|awaz)\b\D{0,20}(\d{1,3})\b/) || text.match(/\b(\d{1,3})\s*%?\s*(?:pe |par )?(?:volume|awaz)\b/);
  if (vol) {
    const level = Math.max(0, Math.min(100, Number(vol[1])));
    return { reply: `Setting volume to ${level}.`, action: { action: "volume", level } };
  }
  if (/\b(battery|charging)\b/.test(text)) {
    return { reply: "Checking your battery.", action: { action: "run_command", preset: "battery" } };
  }
  if (/\b(disk|storage|space left)\b/.test(text)) {
    return { reply: "Checking disk space.", action: { action: "run_command", preset: "disk_usage" } };
  }
  if (/\buptime\b/.test(text)) {
    return { reply: "Checking uptime.", action: { action: "run_command", preset: "uptime" } };
  }
  if (/\bwi-?fi\b/.test(text)) {
    return { reply: "Checking your Wi-Fi.", action: { action: "run_command", preset: "wifi_name" } };
  }
  const shell = input.trim().match(/^(?:run|command|cmd|chalao)\s*[:>]?\s+(.+)$/i);
  if (shell) {
    return { reply: `Running: ${shell[1]}`, action: { action: "run_shell", command: shell[1] } };
  }
  if (/\b(system status|mac status)\b/.test(text)) {
    return { reply: "Checking system status.", action: { action: "status" } };
  }
  return null;
}

export const LOCAL_HELP =
  "I'm in local mode, without an API key. I can tell the time and date, open apps (say \"open WhatsApp\"), set the volume, mute, and check battery, disk space, uptime and Wi-Fi. For free conversation, install Ollama from ollama.com, run \"ollama pull llama3.2\", and ask me again.";

/* ---------- Ollama ---------- */

const OLLAMA_URL = (process.env.ULTRON_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.ULTRON_OLLAMA_MODEL || "llama3.2";

function ollamaIsLocal(): boolean {
  try {
    const host = new URL(OLLAMA_URL).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

export function pickModel(models: string[], preferred = OLLAMA_MODEL): string {
  if (models.includes(preferred)) return preferred;
  return models.find((m) => m.split(":")[0] === preferred.split(":")[0]) || models[0] || preferred;
}

export async function ollamaStatus(): Promise<{ available: boolean; model: string }> {
  if (!ollamaIsLocal()) return { available: false, model: OLLAMA_MODEL };
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { available: false, model: OLLAMA_MODEL };
    const data: any = await res.json();
    const models: string[] = Array.isArray(data?.models) ? data.models.map((m: any) => String(m.name)) : [];
    return { available: models.length > 0, model: pickModel(models) };
  } catch {
    return { available: false, model: OLLAMA_MODEL };
  }
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function ollamaChat(system: string, history: ChatTurn[], model: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { num_predict: 400 },
      messages: [{ role: "system", content: system }, ...history],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data: any = await res.json();
  return String(data?.message?.content || "").trim();
}
