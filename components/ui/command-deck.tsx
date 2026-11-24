import * as React from "react";
import { HologramCore } from "@/components/ui/hologram-core";

/* ------------------------------------------------------------------ */
/* Reactor: the hologram inside layered HUD rings that react to voice */
/* ------------------------------------------------------------------ */

const BARS = 84;
// Fixed per-bar weights so the ring reads like a spectrum, not noise.
const WEIGHTS = Array.from({ length: BARS }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.73) * Math.cos(i * 0.61)));

export function Reactor({ isActive, audioLevel }: { isActive: boolean; audioLevel: number }) {
  const level = Math.max(0, Math.min(1, audioLevel * 6));
  const ticks = React.useMemo(
    () =>
      Array.from({ length: 120 }, (_, i) => {
        const a = (i / 120) * Math.PI * 2;
        const long = i % 10 === 0;
        const r1 = long ? 186 : 190;
        return { x1: 200 + Math.cos(a) * r1, y1: 200 + Math.sin(a) * r1, x2: 200 + Math.cos(a) * 196, y2: 200 + Math.sin(a) * 196, long };
      }),
    [],
  );

  return (
    <div className={`reactor relative aspect-square w-full ${isActive ? "is-live" : ""}`}>
      {/* Glow behind everything, grows with the voice */}
      <div
        className="absolute inset-[14%] rounded-full transition-[transform,opacity] duration-150"
        style={{
          background: "radial-gradient(circle, rgba(0,229,242,.28) 0%, rgba(0,229,242,.08) 45%, transparent 70%)",
          transform: `scale(${1 + level * 0.22})`,
          opacity: isActive ? 0.85 + level * 0.15 : 0.55,
        }}
        aria-hidden="true"
      />

      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="reactor-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7FF6FF" />
            <stop offset="1" stopColor="#00B8D9" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Outer measuring ring */}
        <g className="reactor-spin-slow">
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#00E5F2" strokeOpacity={t.long ? 0.85 : 0.35} strokeWidth={t.long ? 1.6 : 1} />
          ))}
        </g>

        {/* Voice spectrum ring */}
        <g>
          {WEIGHTS.map((w, i) => {
            const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
            const len = isActive ? 3 + level * 26 * w : 2.5;
            const r = 160;
            return (
              <line
                key={i}
                x1={200 + Math.cos(a) * r}
                y1={200 + Math.sin(a) * r}
                x2={200 + Math.cos(a) * (r + len)}
                y2={200 + Math.sin(a) * (r + len)}
                stroke="#00E5F2"
                strokeOpacity={isActive ? 0.4 + level * 0.6 * w : 0.3}
                strokeWidth="2"
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Two counter-rotating arcs */}
        <g className="reactor-spin">
          <circle cx="200" cy="200" r="150" fill="none" stroke="url(#reactor-arc)" strokeWidth="2.5" strokeDasharray="250 690" strokeLinecap="round" />
          <circle cx="200" cy="200" r="150" fill="none" stroke="#00E5F2" strokeOpacity=".5" strokeWidth="2.5" strokeDasharray="40 902" strokeDashoffset="-470" strokeLinecap="round" />
        </g>
        <g className="reactor-spin-back">
          <circle cx="200" cy="200" r="140" fill="none" stroke="#00E5F2" strokeOpacity=".22" strokeWidth="1" strokeDasharray="2 6" />
          <circle cx="200" cy="200" r="140" fill="none" stroke="#9FF7FF" strokeOpacity=".75" strokeWidth="1.5" strokeDasharray="70 810" strokeLinecap="round" />
        </g>

        {/* Inner bezel */}
        <circle cx="200" cy="200" r="128" fill="rgba(2,10,16,.55)" stroke="#00E5F2" strokeOpacity=".28" strokeWidth="1" />
      </svg>

      {/* Hologram inside the bezel */}
      <div className="absolute inset-[19%] overflow-hidden rounded-full">
        <HologramCore isActive={isActive} audioLevel={audioLevel} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Module tile                                                         */
/* ------------------------------------------------------------------ */

export function ModuleTile({
  index,
  label,
  hint,
  color,
  icon: Icon,
  onClick,
}: {
  index: number;
  label: string;
  hint: string;
  color: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hud-tile group relative flex min-h-[112px] w-full flex-1 flex-col justify-between gap-4 overflow-hidden rounded-2xl p-4 text-left"
      style={{ "--tile": color } as React.CSSProperties}
    >
      <span className="absolute inset-x-5 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} aria-hidden="true" />
      <span
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="flex items-start justify-between">
        <span
          className="grid h-11 w-11 place-items-center rounded-xl border transition-transform duration-200 group-hover:scale-105"
          style={{ borderColor: `${color}55`, background: `${color}14` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </span>
        <span className="font-mono text-[11px] text-white/30">0{index}</span>
      </span>
      <span className="block">
        <span className="font-display flex items-center justify-between gap-2 text-[16px] font-semibold text-white">
          {label}
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-white/30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-white/80" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
        <span className="mt-1 block text-[12px] leading-snug text-white/55">{hint}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Top HUD bar                                                         */
/* ------------------------------------------------------------------ */

export function TopHud({ isActive, statusText }: { isActive: boolean; statusText: string }) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const hour = now.getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <header className="flex items-center justify-between gap-4 px-1">
      <div className="flex items-center gap-3 min-w-0">
        <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
          <path d="M16 2l12 7v14l-12 7-12-7V9z" fill="none" stroke="#00E5F2" strokeWidth="1.5" />
          <path d="M11 11v6a5 5 0 0 0 10 0v-6" fill="none" stroke="#00E5F2" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold tracking-[0.32em] text-white">ULTRON</div>
          <div className="truncate text-[12px] text-white/50">{greeting}. {statusText}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`hidden sm:inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] ${
            isActive ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/[0.03] text-white/60"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-cyan-300 shadow-[0_0_8px_#22d3ee] animate-pulse" : "bg-white/35"}`} />
          {isActive ? "Live" : "Standby"}
        </span>
        <div className="text-right">
          <div className="whitespace-nowrap font-mono text-[15px] leading-none text-white tabular-nums">
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="mt-1 text-[11px] text-white/45">{now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</div>
        </div>
      </div>
    </header>
  );
}
