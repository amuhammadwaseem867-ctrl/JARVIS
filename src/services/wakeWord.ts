/**
 * Ultron wake word: say "Ultron" and the assistant switches itself on.
 *
 * Two sources, whichever is available:
 *  1. The background listener on the computer (python/wake_listener.py),
 *     delivered over /api/events. Works in the desktop app and the browser.
 *  2. The browser's own speech recognition while Ultron is idle (Chrome, Edge,
 *     Safari, and phone browsers). Not available inside the desktop app.
 */

const ALIASES = /\b(?:(?:hey|hi|ok|okay|suno)\s+)?(ultron|ultran|altron|ultra\s?on|all\s?tron|wake[\s-]?up)\b[\s,.:;!-]*/i;
// "Ultron, wake up" only wakes it; "wake up" is not sent as a command.
const WAKE_UP_ONLY = /^(?:please\s+)?wake[\s-]?up(?:\s+please)?[\s.!]*$/i;

/** Returns the command after the wake word, "" if only woken, or null if not said. */
export function matchWake(transcript: string): string | null {
  const m = transcript.match(ALIASES);
  if (!m || m.index === undefined) return null;
  const rest = (transcript.slice(0, m.index) + ' ' + transcript.slice(m.index + m[0].length))
    .replace(/\s+/g, ' ')
    .replace(/\s+([?.!])/g, '$1')
    .replace(/^[\s,.;:!-]+|[\s,;:-]+$/g, '')
    .trim();
  return /\w/.test(rest) && !WAKE_UP_ONLY.test(rest) ? rest : '';
}

export type ActivityItem = { from: 'pc' | 'phone'; kind: 'user' | 'ai' | 'action'; text: string; clientId?: string; at: number };

/** This window's id, so it can skip its own activity echoes and report its session state. */
export const CLIENT_ID = Math.random().toString(36).slice(2, 12);

export class WakeWatcher {
  private onWake: (command: string, source: string) => void;
  private onActivity: (item: ActivityItem) => void;
  /** Connect or Terminate was pressed on another device. */
  onSessionSwitch: (on: boolean, from: 'pc' | 'phone') => void = () => {};
  private abort: AbortController | null = null;
  private recognition: any = null;
  private browserWanted = false;
  private stopped = false;
  private needsTap = false;

  constructor(onWake: (command: string, source: string) => void, onActivity: (item: ActivityItem) => void = () => {}) {
    this.onWake = onWake;
    this.onActivity = onActivity;
  }

  start() {
    this.stopped = false;
    void this.streamEvents();
  }

  stop() {
    this.stopped = true;
    this.abort?.abort();
    this.setBrowserListening(false);
  }

  /** Browser wake listening runs only while Ultron is idle, so it never fights the live mic. */
  setBrowserListening(on: boolean) {
    this.browserWanted = on;
    if (on) this.startBrowser();
    else this.stopBrowser();
  }

  private async streamEvents(attempt = 0) {
    if (this.stopped) return;
    this.abort = new AbortController();
    try {
      const res = await fetch(`/api/events?client=${CLIENT_ID}`, { signal: this.abort.signal });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      attempt = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const type = block.match(/^event: (\w+)/)?.[1];
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          try {
            const evt = JSON.parse(data?.slice(6) || '{}');
            if (type === 'wake') this.onWake(String(evt.command || ''), String(evt.source || 'listener'));
            else if (type === 'activity' && evt.clientId !== CLIENT_ID) this.onActivity(evt as ActivityItem);
            else if (type === 'session' && evt.clientId !== CLIENT_ID) this.onSessionSwitch(evt.on === true, evt.from === 'phone' ? 'phone' : 'pc');
          } catch {}
        }
      }
    } catch {
      if (this.stopped) return;
    }
    window.setTimeout(() => this.streamEvents(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
  }

  private startBrowser() {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor || this.recognition || (window as any).airaDesktop?.isElectron) return;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (!event.results[i].isFinal) continue;
          const cmd = matchWake(event.results[i][0].transcript);
          if (cmd !== null) this.onWake(cmd, 'browser');
        }
      };
      rec.onend = () => {
        this.recognition = null;
        if (this.browserWanted && !this.stopped && !this.needsTap) window.setTimeout(() => this.startBrowser(), 400);
      };
      rec.onerror = (e: any) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          // Phones (iPhone above all) only allow the mic after a tap: listen again on the next tap.
          if (this.needsTap) return;
          this.needsTap = true;
          window.addEventListener('pointerdown', () => {
            this.needsTap = false;
            if (this.browserWanted && !this.stopped) this.startBrowser();
          }, { once: true });
        }
      };
      rec.start();
      this.recognition = rec;
    } catch {
      this.recognition = null;
    }
  }

  private stopBrowser() {
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {}
    }
  }
}
