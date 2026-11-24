import type { AIRALiveCallbacks } from "./geminiLiveService";
import { describeSystemAction, postWithApproval } from "../security/approval";

/** What App.tsx needs from any assistant engine (Gemini Live or local). */
export interface AssistantEngine {
  connect(): Promise<void>;
  sendText(text: string): void;
  sendVideoFrame(base64Data: string): void;
  setVoice(voiceName: string): void;
  getVoice(): string;
  terminate(): void;
}

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Ultron local mode: no API key needed.
 * Speech in: the browser's speech recognition, where available.
 * Speech out: the system voices (speechSynthesis), fully offline.
 * Brain: built-in commands, plus a local Ollama model when installed.
 */
export class LocalAssistantService implements AssistantEngine {
  private callbacks: AIRALiveCallbacks;
  private system: string;
  private voiceName: string;
  private history: Turn[] = [];
  private recognition: any = null;
  private listening = false;
  private speaking = false;
  private active = false;
  private levelTimer: number | null = null;
  private busy = false; // a request is being answered
  private lastHeard = { text: "", at: 0 };

  constructor(callbacks: AIRALiveCallbacks, voiceName: string, systemInstruction: string) {
    this.callbacks = callbacks;
    this.voiceName = voiceName;
    this.system = systemInstruction;
  }

  static speechInputSupported(): boolean {
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  async connect() {
    this.active = true;
    this.callbacks.onStatusChange("LOCAL MODE");
    this.startListening();
    const caps = await fetch("/api/capabilities").then((r) => r.json()).catch(() => null);
    const chat = caps?.ollama?.available ? `chat via ${caps.ollama.model}` : "commands only (install Ollama for chat)";
    const mic = LocalAssistantService.speechInputSupported() ? "voice and text" : "text only on this browser";
    this.callbacks.onSystemEvent?.("LOCAL MODE", `No API key. ${mic}, ${chat}.`);
  }

  setVoice(voiceName: string) {
    this.voiceName = voiceName;
  }

  getVoice() {
    return this.voiceName;
  }

  sendVideoFrame(_base64Data: string) {
    // Vision needs a cloud model; local mode ignores camera frames.
  }

  sendText(text: string) {
    void this.handle(text, false);
  }

  terminate() {
    this.active = false;
    this.stopListening();
    try {
      window.speechSynthesis?.cancel();
    } catch {}
    this.stopLevel();
    this.history = [];
  }

  /* ---------- conversation ---------- */

  private async handle(text: string, fromVoice: boolean) {
    const clean = text.trim();
    if (!clean || !this.active) return;
    if (fromVoice) {
      // Ignore what the mic hears while Ultron is answering or talking (its own
      // voice), and the duplicate final results some phone browsers send.
      if (this.busy || this.speaking) return;
      const key = clean.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");
      if (key === this.lastHeard.text && Date.now() - this.lastHeard.at < 4000) return;
      this.lastHeard = { text: key, at: Date.now() };
      this.stopListening();
      this.callbacks.onTranscription(clean, true);
    }
    this.busy = true;
    try {
      await this.answer(clean);
    } finally {
      this.busy = false;
      if (!this.speaking && this.active) this.startListening();
    }
  }

  private async answer(clean: string) {
    let reply = "";
    try {
      const res = await fetch("/api/local/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, history: this.history, system: this.system }),
      });
      const data = await res.json();
      reply = data?.ok ? String(data.reply || "") : String(data?.error || "Something went wrong.");
      const actions: Record<string, any>[] = Array.isArray(data?.actions) ? data.actions : data?.action ? [data.action] : [];
      if (data?.ok && actions.length === 1) reply = await this.runAction(actions[0], reply);
      else if (data?.ok && actions.length > 1) {
        // Multitasking: every action starts at the same time.
        const said: string[] = Array.isArray(data.replies) ? data.replies : [];
        const results = await Promise.all(actions.map((a, i) => this.runAction(a, said[i] || "Done.")));
        reply = results.join(" ");
      }
    } catch {
      reply = "I can't reach my local backend right now.";
    }
    if (!this.active) return;

    this.history.push({ role: "user", content: clean }, { role: "assistant", content: reply });
    this.history = this.history.slice(-12);
    this.callbacks.onTranscription(reply, false);
    this.speak(reply);
  }

  private async runAction(action: Record<string, any>, announce: string): Promise<string> {
    const result = await postWithApproval("/api/system/action", action, describeSystemAction);
    this.callbacks.onSystemEvent?.("LOCAL_ACTION", `${action.action}: ${result?.ok ? "OK" : result?.error || "Failed"}`);
    if (result?.declined) return "Okay, I won't do that.";
    if (!result?.ok) return `I couldn't do that: ${result?.error || "unknown error"}.`;
    if (action.action === "run_command" && result.stdout) {
      return `${announce.replace(/^Checking/, "Here's")}\n${String(result.stdout).trim().split("\n").slice(0, 6).join("\n")}`;
    }
    if (action.action === "run_shell") {
      const out = String(result.stdout || result.stderr || "").trim();
      return out ? `Done.\n${out.split("\n").slice(-12).join("\n")}` : "Done.";
    }
    if (action.action === "status") {
      return `Python ${result.pythonVersion}. Active app: ${result.frontmostApp || "desktop"}.`;
    }
    return announce.replace(/^Opening/, "Opened").replace(/^Setting/, "Set").replace(/ing\.$/, "ed.");
  }

  /* ---------- speech out ---------- */

  private speak(text: string) {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, "").slice(0, 600));
      const voices = synth.getVoices();
      const lang = navigator.language || "en-US";
      utter.voice =
        voices.find((v) => v.name.toLowerCase().includes(this.voiceName.toLowerCase())) ||
        voices.find((v) => v.lang === lang) ||
        voices.find((v) => v.lang.startsWith("en")) ||
        null;
      utter.rate = 1.02;
      utter.onstart = () => {
        this.speaking = true;
        this.stopListening();
        this.startLevel();
      };
      let finished = false;
      let guard: number | undefined;
      const done = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(guard);
        this.speaking = false;
        this.stopLevel();
        // Short pause so the tail of its own voice is not picked up as a command.
        if (this.active) window.setTimeout(() => this.startListening(), 450);
      };
      utter.onend = done;
      utter.onerror = done;
      // Mark speaking now, not on start: onstart can lag, and the mic must be off first.
      this.speaking = true;
      this.stopListening();
      synth.speak(utter);
      // Some browsers never fire onend; never leave the mic switched off.
      guard = window.setTimeout(done, 4000 + utter.text.length * 90);
    } catch {
      this.speaking = false;
    }
  }

  private startLevel() {
    this.stopLevel();
    this.levelTimer = window.setInterval(() => this.callbacks.onAudioLevelChange(0.25 + Math.random() * 0.5), 90);
  }

  private stopLevel() {
    if (this.levelTimer !== null) window.clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.callbacks.onAudioLevelChange(0);
  }

  /* ---------- speech in ---------- */

  private startListening() {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor || this.listening || this.speaking || this.busy || !this.active) return;
    try {
      const rec = new Ctor();
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) void this.handle(event.results[i][0].transcript, true);
        }
      };
      rec.onend = () => {
        this.listening = false;
        // Browsers stop recognition after silence; resume while the session is on.
        if (this.active && !this.speaking && !this.busy) window.setTimeout(() => this.startListening(), 300);
      };
      rec.onerror = (e: any) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          this.active && this.callbacks.onSystemEvent?.("MIC", "Microphone blocked. You can still type.");
          this.recognition = null;
          this.listening = false;
          rec.onend = null;
        }
      };
      rec.start();
      this.recognition = rec;
      this.listening = true;
    } catch {
      this.listening = false;
    }
  }

  private stopListening() {
    const rec = this.recognition;
    this.recognition = null;
    this.listening = false;
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {}
    }
  }
}
