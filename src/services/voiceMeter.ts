/**
 * Measures Silvia's own voice so the character can move her lips in time
 * with it. Gemini audio is routed through an AnalyserNode; the offline voice
 * (browser speech synthesis has no audio graph) drives a syllable-like
 * envelope instead.
 */

let analyser: AnalyserNode | null = null;
let analyserCtx: BaseAudioContext | null = null;
let buf: Float32Array<ArrayBuffer> | null = null;
let syntheticSince = 0;

/** Where voice playback should connect instead of ctx.destination. */
export function voiceOutput(ctx: AudioContext): AudioNode {
  if (!analyser || analyserCtx !== ctx) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    analyser.connect(ctx.destination);
    analyserCtx = ctx;
    buf = new Float32Array(analyser.fftSize);
  }
  return analyser;
}

/** Marks the offline voice as talking (true) or quiet (false). */
export function setSyntheticVoice(on: boolean) {
  syntheticSince = on ? performance.now() : 0;
}

/** Current loudness of Silvia's voice, 0..1, ready for lip movement. */
export function voiceLevel(now = performance.now()): number {
  if (syntheticSince) {
    // About 5 syllables a second with natural variation, never fully shut.
    const t = (now - syntheticSince) / 1000;
    const s = Math.abs(Math.sin(t * 15.7)) * (0.55 + 0.45 * Math.sin(t * 3.1 + 1.3) ** 2);
    return 0.15 + 0.7 * s;
  }
  if (!analyser || !buf) return 0;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  // Speech RMS sits roughly between 0.02 and 0.25.
  return Math.max(0, Math.min(1, (rms - 0.012) * 5.5));
}
