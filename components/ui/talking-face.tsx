import * as React from "react";
import { voiceLevel } from "@/src/services/voiceMeter";

/**
 * Silvia's living portrait. The photo is drawn on a WebGL mesh with a face
 * shaped depth, so small head turns, nods and tilts read as 3D. Eyes blink,
 * brows lift on emphasis, and the jaw opens in time with Silvia's real voice.
 * Falls back to the still photo when WebGL is not available.
 *
 * Landmarks are in pixels of the 720x720 built in portrait.
 */
const FACE = {
  size: 720,
  eyes: [
    [268, 405],
    [458, 358],
  ] as const,
  eyeAngle: -0.243,
  eyeHalf: [45, 17] as const,
  mouth: [406, 584] as const,
  mouthAngle: -0.219,
  mouthHalfWidth: 84,
  faceCenter: [385, 440] as const,
  faceRadius: [235, 310] as const,
};

const VERT = `
attribute vec2 aUv;
uniform vec2 uHead;     // yaw, pitch in -1..1
uniform float uRoll;    // radians
uniform float uBreath;  // 0..1
varying vec2 vUv;
const vec2 FC = vec2(${FACE.faceCenter[0]}., ${FACE.faceCenter[1]}.);
const vec2 FR = vec2(${FACE.faceRadius[0]}., ${FACE.faceRadius[1]}.);
void main() {
  vUv = aUv;
  vec2 p = aUv * ${FACE.size}.;
  vec2 d = (p - FC) / FR;
  float z = sqrt(max(0.0, 1.0 - dot(d, d)));        // face bulge, 0 at the edge
  p += vec2(uHead.x * 16.0, uHead.y * 11.0) * z;     // nearer parts move more
  p.y -= uBreath * 3.0 * z;
  vec2 pivot = vec2(${FACE.faceCenter[0]}., 860.0);  // neck
  float c = cos(uRoll), s = sin(uRoll);
  p = pivot + mat2(c, s, -s, c) * (p - pivot);
  vec2 clip = (p / ${FACE.size}. - 0.5) * 2.0 / 0.9; // zoom a little so edges never show
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uMouth;   // 0..1 jaw open
uniform float uBlink;   // 0..1 lids closed
uniform float uBrow;    // 0..1 brows raised
varying vec2 vUv;
const float S = ${FACE.size}.;
const vec2 E0 = vec2(${FACE.eyes[0][0]}., ${FACE.eyes[0][1]}.);
const vec2 E1 = vec2(${FACE.eyes[1][0]}., ${FACE.eyes[1][1]}.);
const vec2 MC = vec2(${FACE.mouth[0]}., ${FACE.mouth[1]}.);
const float EA = ${FACE.eyeAngle};
const float MA = ${FACE.mouthAngle};
const float HW = ${FACE.eyeHalf[0]}.;
const float HH = ${FACE.eyeHalf[1]}.;
const float MW = ${FACE.mouthHalfWidth}.;

vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec3 tex(vec2 px) { return texture2D(uTex, clamp(px / S, 0.0, 1.0)).rgb; }

// One eye: returns the source pixel (brows lifted). When the lid is down,
// lidSrc is the upper lid skin to show and cover says how much of it.
vec2 eye(vec2 p, vec2 c, inout vec2 lidSrc, inout float cover, inout float lash) {
  vec2 q = rot(p - c, -EA);
  // Brows: pull the band above the eye upwards.
  float bw = exp(-pow((q.y + 52.0) / 26.0, 2.0)) * smoothstep(HW + 30.0, HW - 10.0, abs(q.x));
  q.y += uBrow * 6.0 * bw;
  vec2 src = c + rot(q, EA);
  if (uBlink > 0.01 && abs(q.x) < HW) {
    float s = sqrt(1.0 - (q.x / HW) * (q.x / HW));
    float top = -HH * s - 3.0;
    float bot = HH * s * 0.8;
    float lid = mix(top, bot, uBlink);
    if (q.y < lid + 1.5) {
      float t = clamp((q.y - top) / max(lid - top, 1.0), 0.0, 1.0);
      // Lid skin from the crease area, stretched down over the eye.
      lidSrc = c + rot(vec2(q.x * 0.96, top - 24.0 + t * 12.0), EA);
      cover = smoothstep(top - 4.0, top + 3.0, q.y) * smoothstep(0.0, 0.35, s) * smoothstep(lid + 1.5, lid - 0.5, q.y);
    }
    lash = smoothstep(1.8, 0.0, abs(q.y - lid)) * uBlink * smoothstep(0.1, 0.5, s);
  }
  return src;
}

void main() {
  vec2 p = vUv * S;
  float lash = 0.0, cover = 0.0;
  vec2 lidSrc = p;
  vec2 src = p;
  if (distance(p, E0) < 110.0) src = eye(p, E0, lidSrc, cover, lash);
  else if (distance(p, E1) < 110.0) src = eye(p, E1, lidSrc, cover, lash);

  // Jaw: everything below the lip line drops, most at the centre of the lips.
  vec2 m = rot(p - MC, -MA);
  m.y += 0.0016 * m.x * m.x;          // the lip line curves up into the smile
  float lips = clamp(1.0 - (m.x / MW) * (m.x / MW), 0.0, 1.0);
  float jaw = clamp(1.0 - (m.x / 170.0) * (m.x / 170.0), 0.0, 1.0);
  float open = uMouth * 15.0;
  float gap = open * lips * lips;
  float inside = 0.0;
  if (m.y > 0.0 && m.y < 230.0 && uMouth > 0.001) {
    float w = mix(lips, jaw, smoothstep(0.0, 45.0, m.y)) * smoothstep(230.0, 60.0, m.y);
    if (m.y < gap) {
      inside = smoothstep(0.05, 0.45, lips);
    } else {
      m.y -= open * w;
      m.y -= 0.0016 * m.x * m.x;
      src = MC + rot(m, MA);
    }
  }

  vec3 col = tex(src);
  if (cover > 0.0) col = mix(col, tex(lidSrc), cover);
  if (inside > 0.0) {
    float t = clamp(m.y / max(gap, 1.0), 0.0, 1.0);
    vec3 mouthIn = mix(vec3(0.30, 0.10, 0.11), vec3(0.16, 0.05, 0.06), t);
    col = mix(col, mouthIn, inside);
  }
  col = mix(col, vec3(0.10, 0.06, 0.06), lash * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, code: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, code);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
  return sh;
}

/** A spring that eases a value towards its target, like real muscle. */
class Spring {
  v = 0;
  x = 0;
  constructor(public stiffness = 60, public damping = 12) {}
  step(target: number, dt: number) {
    this.v += ((target - this.x) * this.stiffness - this.v * this.damping) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

interface TalkingFaceProps {
  src?: string;
  /** True while a voice session is on: she looks attentive instead of idle. */
  isActive?: boolean;
  className?: string;
}

export function TalkingFace({ src = "/character/silvia.jpg", isActive = false, className }: TalkingFaceProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const activeRef = React.useRef(isActive);
  const [failed, setFailed] = React.useState(false);
  activeRef.current = isActive;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
    if (!gl) {
      setFailed(true);
      return;
    }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    } catch (e) {
      console.warn("Talking face disabled:", e);
      setFailed(true);
      return;
    }
    gl.useProgram(prog);

    // A fine grid so the depth bend is smooth.
    const N = 48;
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) uvs.push(x / N, y / N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * (N + 1) + x;
        idx.push(i, i + 1, i + N + 1, i + 1, i + N + 2, i + N + 1);
      }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(prog, "aUv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uHead = u("uHead"), uRoll = u("uRoll"), uBreath = u("uBreath");
    const uMouth = u("uMouth"), uBlink = u("uBlink"), uBrow = u("uBrow");

    let ready = false;
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      ready = true;
    };
    img.onerror = () => setFailed(true);
    img.src = src;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      if (canvas.width !== w) {
        canvas.width = w;
        canvas.height = w;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const yaw = new Spring(18, 7), pitch = new Spring(30, 8), roll = new Spring(16, 7);
    const brow = new Spring(90, 14), mouth = new Spring(420, 30);
    let nextBlink = performance.now() + 1500;
    let blinkStart = -1;
    let gesture = { yaw: 0, pitch: 0, roll: 0, until: 0 };
    let nextGesture = 0;
    let talk = 0; // smoothed "is she talking"
    let prevLevel = 0;
    let nodKick = 0;
    let browKick = 0;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!ready || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const still = reduce.matches;

      const level = voiceLevel(now);
      talk += ((level > 0.06 ? 1 : 0) - talk) * Math.min(1, dt * (level > 0.06 ? 8 : 2));
      // A new phrase or a stressed syllable: small nod and brow lift.
      if (level - prevLevel > 0.28 && level > 0.45) {
        nodKick = 1;
        if (Math.random() < 0.35) browKick = 1;
      }
      prevLevel = level;
      nodKick *= Math.exp(-dt * 7);
      browKick *= Math.exp(-dt * 3);

      // Gestures: while talking she turns and tilts now and then, like people do.
      if (now > nextGesture) {
        const talking = talk > 0.5;
        gesture = {
          yaw: (Math.random() * 2 - 1) * (talking ? 0.7 : 0.35),
          pitch: (Math.random() * 2 - 1) * (talking ? 0.35 : 0.2),
          roll: (Math.random() * 2 - 1) * (talking ? 0.045 : 0.025),
          until: now + 1200 + Math.random() * 1800,
        };
        nextGesture = gesture.until + (talking ? 300 : 1500) + Math.random() * 2500;
      }
      const g = now < gesture.until ? gesture : { yaw: 0, pitch: 0, roll: 0 };
      const listening = activeRef.current && talk < 0.3;
      const idleYaw = Math.sin(t * 0.37) * 0.22 + Math.sin(t * 0.83) * 0.08;
      const idlePitch = Math.sin(t * 0.29 + 1) * 0.12;
      const idleRoll = Math.sin(t * 0.23 + 2) * 0.012;

      const y = yaw.step(still ? 0 : idleYaw + g.yaw, dt);
      const p = pitch.step(still ? 0 : idlePitch + g.pitch + (listening ? 0.25 : 0) + nodKick * 0.55, dt);
      const r = roll.step(still ? 0 : idleRoll + g.roll + (listening ? 0.03 : 0), dt);
      const b = brow.step(Math.min(1, browKick + (listening ? 0.35 : 0)), dt);
      const m = mouth.step(level, dt);

      // Blink every 2 to 6 seconds, sometimes twice.
      if (blinkStart < 0 && now > nextBlink) blinkStart = now;
      let blink = 0;
      if (blinkStart >= 0) {
        const k = (now - blinkStart) / 170;
        if (k >= 1) {
          blinkStart = -1;
          nextBlink = now + (Math.random() < 0.15 ? 180 : 2000 + Math.random() * 4000);
        } else blink = Math.sin(k * Math.PI);
      }

      gl.uniform2f(uHead, y, p);
      gl.uniform1f(uRoll, r);
      gl.uniform1f(uBreath, still ? 0 : (Math.sin(t * 1.4) + 1) / 2);
      gl.uniform1f(uMouth, Math.max(0, Math.min(1, m)));
      gl.uniform1f(uBlink, blink);
      gl.uniform1f(uBrow, Math.max(0, Math.min(1, b)));
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [src]);

  if (failed) return <img src={src} alt="Silvia" className={className} draggable={false} />;
  return <canvas ref={canvasRef} role="img" aria-label="Silvia" className={className} />;
}
