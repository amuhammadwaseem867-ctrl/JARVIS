import React from 'react';
import { Smartphone, X, RefreshCw } from 'lucide-react';

/**
 * "Connect phone" button and pairing dialog (computer only).
 * Shows a QR code and a 6-digit code; the phone pairs once and stays paired 30 days.
 */
export function PhoneConnect() {
  const [available, setAvailable] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [pair, setPair] = React.useState<{ code: string; url: string; qr: string; expires: number } | null>(null);
  const [devices, setDevices] = React.useState<{ name: string; created: number }[]>([]);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    fetch('/api/capabilities')
      .then((r) => r.json())
      .then((d) => setAvailable(Boolean(d?.phone) && !d?.onPhone))
      .catch(() => {});
  }, []);

  const load = React.useCallback(async () => {
    setError('');
    try {
      const [p, d] = await Promise.all([
        fetch('/api/phone/pair-code', { method: 'POST' }).then((r) => r.json()),
        fetch('/api/phone/devices').then((r) => r.json()),
      ]);
      if (!p?.ok) setError(p?.error || 'Could not start pairing.');
      else setPair(p);
      setDevices(d?.devices || []);
    } catch {
      setError('Could not reach Ultron.');
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, load]);

  const forget = async () => {
    await fetch('/api/phone/forget', { method: 'POST' }).catch(() => {});
    setDevices([]);
  };

  if (!available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[240] inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-[#0d1117]/90 border border-white/10 text-white/80 hover:text-white hover:border-cyan-400/40 text-[12px] font-medium backdrop-blur transition-colors"
      >
        <Smartphone className="w-4 h-4" aria-hidden />
        Connect phone
      </button>
      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="phone-title">
          <div className="absolute inset-0" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm bg-[#0a0d13] rounded-2xl border border-white/10 shadow-2xl p-6">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute top-4 right-4 w-8 h-8 inline-flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/5">
              <X className="w-4 h-4" />
            </button>
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-1">iPhone and Android</p>
            <h2 id="phone-title" className="text-[18px] font-semibold text-white tracking-tight">Connect your phone</h2>
            <p className="mt-2 text-[13px] text-white/60 leading-relaxed">
              Phone and computer must be on the same Wi-Fi. Scan with the camera app. The first time, the phone warns about the certificate: choose Show details, then Visit website (iPhone) or Advanced, then Proceed (Android).
            </p>
            {error ? (
              <p className="mt-5 text-[13px] text-red-300" role="alert">{error}</p>
            ) : pair ? (
              <div className="mt-5 flex flex-col items-center">
                <img src={pair.qr} alt="Pairing QR code" width={220} height={220} className="rounded-xl bg-white p-2" />
                <p className="mt-4 text-[12px] text-white/50">Or open {pair.url} and type</p>
                <p className="mt-1 text-[30px] font-semibold tracking-[0.3em] text-white tabular-nums">{pair.code}</p>
                <p className="text-[11px] text-white/40">Valid for 10 minutes, one phone.</p>
              </div>
            ) : (
              <p className="mt-5 text-[13px] text-white/50">Preparing code…</p>
            )}
            <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between gap-3">
              <span className="text-[12px] text-white/50">
                {devices.length ? `Paired: ${devices.map((d) => d.name).join(', ')}` : 'No phones paired yet'}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={load} aria-label="New code" className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/70">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                {devices.length > 0 && (
                  <button type="button" onClick={forget} className="h-8 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-[12px] text-white/80">
                    Unpair all
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
