import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

/**
 * Silvia: human approval gate.
 *
 * Every risky action the AI asks for (typing, clicking, reading the clipboard,
 * screenshots, file writes, links, WhatsApp messages, screen control) shows
 * this dialog. Only a click on Approve asks the server for a one-time grant
 * bound to that exact action. The AI cannot click it.
 */

export interface ApprovalRequest {
  title: string;
  detail: string;
  risk: 'medium' | 'high';
  action: Record<string, unknown>;
}

type Pending = ApprovalRequest & { resolve: (approvalId: string | null) => void };

let enqueue: ((p: Pending) => void) | null = null;

/** Ask the person. Resolves to a server grant id, or null if declined. */
export function requestApproval(req: ApprovalRequest): Promise<string | null> {
  return new Promise((resolve) => {
    if (!enqueue) return resolve(null);
    enqueue({ ...req, resolve });
  });
}

/** POST with approval: tries without one first, asks only when the server requires it. */
export async function postWithApproval(
  url: string,
  body: Record<string, unknown>,
  describe: (action: Record<string, any>) => Omit<ApprovalRequest, 'action'>,
): Promise<any> {
  const send = (extra: Record<string, unknown> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...extra }),
    }).then((r) => r.json());

  const first = await send();
  if (!first?.needsApproval) return first;
  // The server tells us the exact action it will run; that is what gets approved.
  const action = (first.approve || body) as Record<string, any>;
  const approvalId = await requestApproval({ ...describe(action), action });
  if (!approvalId) return { ok: false, success: false, declined: true, error: 'The person declined this action.' };
  return send({ approvalId });
}

export function describeSystemAction(a: Record<string, any>): Omit<ApprovalRequest, 'action'> {
  const t = (v: unknown, n = 160) => {
    const s = String(v ?? '');
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  switch (a.action) {
    case 'type_text':
      return { title: 'Type on your keyboard', detail: `Silvia wants to type: "${t(a.text, 300)}"${a.pressEnter ? ' and press Enter' : ''}.`, risk: 'high' };
    case 'hotkey':
      return { title: 'Press a shortcut', detail: `Silvia wants to press ${t(a.keys, 40)}.`, risk: 'medium' };
    case 'mouse_click':
      return { title: 'Click on your screen', detail: `Silvia wants to ${a.button === 'right' ? 'right-click' : 'click'} at (${Math.round(a.x)}, ${Math.round(a.y)}).`, risk: 'medium' };
    case 'screenshot':
      return { title: 'Capture your screen', detail: 'Silvia wants a screenshot. It will be sent to Google Gemini for analysis.', risk: 'medium' };
    case 'clipboard_get':
      return { title: 'Read your clipboard', detail: 'Silvia wants to read your clipboard. It may contain passwords or private text.', risk: 'high' };
    case 'clipboard_set':
      return { title: 'Replace your clipboard', detail: `Silvia wants to copy: "${t(a.text)}".`, risk: 'medium' };
    case 'fs_op':
      return { title: a.operation === 'read' ? 'Read a file' : 'Change a file', detail: `${t(a.operation, 10)} "${t(a.path, 200)}" in your Silvia workspace folder.`, risk: a.operation === 'read' ? 'medium' : 'high' };
    case 'whatsapp_send':
      return { title: 'Send a WhatsApp message', detail: a.audio ? `Silvia wants to send a voice note to ${t(a.contact, 80)}.` : `Silvia wants to send to ${t(a.contact, 80)}: "${t(a.text, 400)}"`, risk: 'high' };
    case 'screen_task':
      return { title: 'Let Silvia control your screen', detail: `Goal: "${t(a.goal, 300)}". Silvia will take screenshots, click and type for up to ${Number(a.maxSteps) || 5} steps. You can stop it at any time.`, risk: 'high' };
    case 'open_app':
      return { title: 'Open a link', detail: `Silvia wants to open ${t(a.target, 300)}. Check the address before approving.`, risk: 'medium' };
    default:
      return { title: 'Allow system action', detail: `Action: ${t(a.action, 40)}`, risk: 'medium' };
  }
}

export function ApprovalHost() {
  const [queue, setQueue] = React.useState<Pending[]>([]);
  const [busy, setBusy] = React.useState(false);
  const current = queue[0];
  const approveRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    enqueue = (p) => setQueue((q) => [...q, p]);
    return () => {
      enqueue = null;
    };
  }, []);

  const finish = React.useCallback((id: string | null) => {
    setQueue((q) => {
      q[0]?.resolve(id);
      return q.slice(1);
    });
    setBusy(false);
  }, []);

  const approve = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: current.action }),
      });
      const data = await res.json();
      finish(data?.ok ? data.approvalId : null);
    } catch {
      finish(null);
    }
  };

  React.useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, finish]);

  if (!current) return null;
  const high = current.risk === 'high';

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maya-approval-title"
      aria-describedby="maya-approval-detail"
    >
      <div className="w-full max-w-md bg-[#0a0d13] rounded-2xl border border-white/10 shadow-2xl p-6">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border ${
              high ? 'bg-red-500/10 border-red-400/30' : 'bg-amber-500/10 border-amber-400/30'
            }`}
          >
            <ShieldAlert className={`w-5 h-5 ${high ? 'text-red-400' : 'text-amber-300'}`} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-1">Approval needed</p>
            <h2 id="maya-approval-title" className="text-[18px] font-semibold text-white tracking-tight">
              {current.title}
            </h2>
          </div>
        </div>
        <p id="maya-approval-detail" className="mt-4 text-[14px] leading-relaxed text-white/80 break-words">
          {current.detail}
        </p>
        <p className="mt-3 text-[12px] text-white/45">
          Only approve if you asked for this. Instructions hidden in web pages, messages or files can try to make an assistant act on their behalf.
        </p>
        {queue.length > 1 && <p className="mt-2 text-[12px] text-white/45">{queue.length - 1} more waiting.</p>}
        <div className="mt-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => finish(null)}
            className="h-10 px-4 rounded-lg text-[14px] font-medium text-white/85 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            Decline
          </button>
          <button
            ref={approveRef}
            type="button"
            onClick={approve}
            disabled={busy}
            className="h-10 px-4 rounded-lg text-[14px] font-semibold text-black bg-cyan-300 hover:bg-cyan-200 disabled:opacity-60 transition-colors inline-flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" aria-hidden />
            {busy ? 'Approving' : 'Approve once'}
          </button>
        </div>
      </div>
    </div>
  );
}
