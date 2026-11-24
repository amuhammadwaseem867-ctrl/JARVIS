import { cn } from "@/lib/utils";
import { TalkingFace } from "@/components/ui/talking-face";

interface CharacterOrbProps {
  className?: string;
  isActive?: boolean;
  /** 0..1 live voice level (mic or Silvia's voice). Drives the glow and rings. */
  audioLevel?: number;
  /** Portrait to show; defaults to the built-in Silvia character. */
  src?: string;
}

/**
 * Silvia's character: a round portrait with two orbiting rings, a halo that
 * follows the voice level, slow breathing and a scan line. Pure CSS, so it is
 * light on phones; all motion stops under "reduce motion".
 */
export function CharacterOrb({ className, isActive = false, audioLevel = 0, src = "/character/silvia.jpg" }: CharacterOrbProps) {
  const level = Math.max(0, Math.min(1, audioLevel * 6));
  return (
    <div className={cn("ultron-orb relative aspect-square h-full max-h-full max-w-full", isActive && "is-live", className)}>
      <div
        className="ultron-orb-halo absolute inset-[6%] rounded-full"
        style={{ transform: `scale(${1 + level * 0.18})`, opacity: isActive ? 0.55 + level * 0.45 : 0.35 }}
        aria-hidden="true"
      />
      <svg className="ultron-orb-ring1 absolute inset-0 h-full w-full" viewBox="0 0 500 500" aria-hidden="true">
        <circle cx="250" cy="250" r="238" fill="none" stroke="#22d3ee" strokeOpacity=".5" strokeWidth="2" strokeDasharray="2 14" />
        <path d="M250 12a238 238 0 0 1 168 70" fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <svg className="ultron-orb-ring2 absolute inset-[6%] h-[88%] w-[88%]" viewBox="0 0 440 440" aria-hidden="true">
        <circle cx="220" cy="220" r="212" fill="none" stroke="#22d3ee" strokeOpacity=".22" strokeWidth="1" />
        <path d="M8 220a212 212 0 0 1 60-148" fill="none" stroke="#7ff4fa" strokeWidth="2" strokeLinecap="round" />
        <path d="M432 220a212 212 0 0 1-60 148" fill="none" stroke="#7ff4fa" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="ultron-orb-face absolute inset-[12%] overflow-hidden rounded-full shadow-[0_0_0_1px_rgba(34,211,238,.5),0_24px_70px_rgba(34,211,238,.18)]">
        <TalkingFace src={src} isActive={isActive} className="block h-full w-full object-cover" />
        <div className="ultron-orb-scan pointer-events-none absolute inset-0" aria-hidden="true" />
      </div>
    </div>
  );
}
