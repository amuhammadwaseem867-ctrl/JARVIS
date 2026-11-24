import React from 'react';
import { ShieldOff } from 'lucide-react';

/** Always-visible notice when Full Control mode is on, so it is never forgotten. */
export function FullControlBadge() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    fetch('/api/capabilities')
      .then((r) => r.json())
      .then((d) => setOn(Boolean(d?.fullControl)))
      .catch(() => {});
  }, []);
  if (!on) return null;
  return (
    <div
      role="status"
      title="Silvia can run shell commands and change any file in your home folder without asking. Turn off by removing ULTRON_FULL_CONTROL from .env."
      aria-label="Full control on"
      className="fixed top-2 right-2 sm:top-3 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 z-[250] inline-flex items-center gap-2 h-7 px-2 sm:px-3 rounded-full bg-red-500/15 border border-red-400/40 text-red-300 text-[11px] font-semibold tracking-[0.12em] uppercase pointer-events-auto"
    >
      <ShieldOff className="w-3.5 h-3.5" aria-hidden />
      <span className="hidden sm:inline">Full control on</span>
    </div>
  );
}
