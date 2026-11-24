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

// Everything below is a smooth warp of the photo (no pasted patches), so no
// edges or seams can appear. Only the lid line and the inner mouth get a soft
// shade.

// One eye: lifts the brow and slides the upper lid down over the eye.
vec2 eye(vec2 p, vec2 c) {
  vec2 q = rot(p - c, -EA);
  float bw = exp(-pow((q.y + 52.0) / 26.0, 2.0)) * exp(-pow(q.x / (HW + 15.0), 4.0));
  q.y += uBrow * 6.0 * bw;
  if (uBlink > 0.01) {
    float s = exp(-pow(q.x / HW, 4.0));             // soft at the eye corners
    float top = -HH - 4.0;
    float travel = HH * 2.05 * s;
    float lid = top + uBlink * travel;
    float a = top - 22.0;                          // lid crease; brows stay put
    if (q.y > a && q.y < lid) {
      // The lid skin between crease and lashes stretches down to the new lid line.
      q.y = a + (q.y - a) * (top - a) / (lid - a);
    }
  }
  return c + rot(q, EA);
}

float lidLine(vec2 p, vec2 c) {
  vec2 q = rot(p - c, -EA);
  float s = exp(-pow(q.x / HW, 4.0));
  float lid = -HH - 4.0 + uBlink * HH * 2.05 * s;
  return exp(-pow((q.y - lid) / 2.0, 2.0)) * s * smoothstep(0.15, 0.6, uBlink);
}

void main() {
  vec2 p = vUv * S;
  float lash = 0.0;
  vec2 src = p;
  if (distance(p, E0) < 120.0) { src = eye(p, E0); lash = lidLine(p, E0); }
  else if (distance(p, E1) < 120.0) { src = eye(p, E1); lash = lidLine(p, E1); }

  // Jaw: a smooth field that drops the lower lip and chin; the upper lip and
  // upper teeth stay where they are.
  vec2 m = rot(p - MC, -MA);
  m.y += 0.0016 * m.x * m.x;                       // follow the smile curve
  float open = uMouth * 12.0;
  float width = mix(MW * 0.7, 150.0, smoothstep(0.0, 70.0, m.y));
  float hx = exp(-pow(m.x / width, 4.0));
  float vy = smoothstep(-24.0, 4.0, m.y) * (1.0 - smoothstep(80.0, 230.0, m.y));
  float drop = open * hx * vy;
  float shade = 0.0;
  if (drop > 0.01) {
    vec2 ms = m;
    ms.y -= drop;
    ms.y -= 0.0016 * ms.x * ms.x;
    src = MC + rot(ms, MA);
    // A soft shadow in the stretched opening, strongest at its centre.
    shade = uMouth * exp(-pow(m.x / (MW * 0.75), 4.0)) * exp(-pow((m.y - open * 0.35) / (4.0 + open * 0.5), 2.0));
  }

  vec3 col = tex(src);
  col *= 1.0 - shade * 0.55;
  col = mix(col, vec3(0.10, 0.06, 0.06), lash * 0.65);
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
