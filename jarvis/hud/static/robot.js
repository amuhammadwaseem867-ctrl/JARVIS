// JARVIS HUD: a 3D humanoid robot that acts out what JARVIS is doing.
//
// Built from three.js shapes in code, so there is no model file to download
// or license. It watches <body data-state="..."> (set by hud.js) and moves:
//   idle       breathes, blinks, follows the mouse with its head
//   listening  leans in and tilts its head (also "recording")
//   thinking   hand on chin, eyes scanning, halo rings spin fast
//   speaking   mouth lights move, hands gesture
//   offline    powers down, head bowed
// Colours follow the HUD's --accent colour. If WebGL isn't available this
// file does nothing and the HUD keeps its original reactor animation.

import * as THREE from "./three.module.min.js";

const host = document.getElementById("robot");
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

function start(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 0.8, 0.1, 20);
  const LOOK_AT = new THREE.Vector3(0, 1.5, 0);
  camera.position.set(0, 1.6, 2.15);
  camera.lookAt(LOOK_AT);

  scene.environment = makeEnvironment(renderer);

  // ------------------------------------------------------------ materials

  const glow = new THREE.Color("#3fd0ff");      // follows --accent
  const glowTarget = glow.clone();
  let glowLevel = 1, glowLevelTarget = 1;

  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xdfe7ee, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12,
  });
  const plate = new THREE.MeshPhysicalMaterial({
    color: 0x8fa1b2, metalness: 0.95, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.2,
  });
  const metal = new THREE.MeshStandardMaterial({ color: 0x10161d, metalness: 0.85, roughness: 0.45 });
  const visor = new THREE.MeshPhysicalMaterial({
    color: 0x02050a, metalness: 0.4, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04,
  });
  const light = new THREE.MeshBasicMaterial({ color: glow, toneMapped: false });
  const lightSoft = new THREE.MeshBasicMaterial({
    color: glow, toneMapped: false, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const lightFaint = lightSoft.clone();
  lightFaint.opacity = 0.18;

  const halo = new THREE.SpriteMaterial({
    map: glowTexture(), color: glow, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });

  const mesh = (geo, mat, parent, pos, rot, scale) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    parent.add(m);
    return m;
  };
  const group = (parent, pos) => {
    const g = new THREE.Group();
    if (pos) g.position.set(...pos);
    parent.add(g);
    return g;
  };
  const sprite = (parent, pos, size, opacity = 1) => {
    const s = new THREE.Sprite(halo.clone());
    s.position.set(...pos);
    s.scale.setScalar(size);
    s.material.opacity = opacity;
    s.userData.baseOpacity = opacity;
    parent.add(s);
    sprites.push(s);
    return s;
  };
  const sprites = [];
  const sphere = (r, w = 32, h = 20) => new THREE.SphereGeometry(r, w, h);
  const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 8, 20);

  // ---------------------------------------------------------------- body

  const robot = group(scene);
  const hips = group(robot, [0, 0.9, 0]);
  mesh(lathe([[0.0, -0.06], [0.11, -0.05], [0.15, 0.0], [0.155, 0.05], [0.12, 0.09], [0.0, 0.1]]),
    shell, hips, null, null, [1, 1, 0.68]);

  const spine = group(hips, [0, 0.08, 0]);
  // abdomen: stacked mechanical rings
  for (let i = 0; i < 4; i++) {
    mesh(new THREE.CylinderGeometry(0.105 - i * 0.004, 0.112 - i * 0.004, 0.035, 28), metal, spine,
      [0, 0.01 + i * 0.042, 0], null, [1, 1, 0.72]);
  }
  mesh(new THREE.TorusGeometry(0.108, 0.0035, 6, 48), lightFaint, spine, [0, 0.075, 0], [Math.PI / 2, 0, 0], [1, 0.72, 1]);

  const chest = group(spine, [0, 0.16, 0]);
  // torso: a V-shaped lathe, flattened front to back
  mesh(lathe([[0.0, -0.02], [0.115, -0.01], [0.135, 0.06], [0.175, 0.15], [0.235, 0.26], [0.25, 0.32],
    [0.215, 0.38], [0.12, 0.42], [0.05, 0.43]]), shell, chest, null, null, [1, 1, 0.58]);
  // rib band and centre groove split the torso into panels
  mesh(new THREE.TorusGeometry(0.168, 0.009, 8, 64), metal, chest, [0, 0.135, 0], [Math.PI / 2, 0, 0], [1, 0.6, 1]);
  mesh(new THREE.TorusGeometry(0.175, 0.0025, 6, 64), lightFaint, chest, [0, 0.148, 0], [Math.PI / 2, 0, 0], [1, 0.6, 1]);
  // collar
  mesh(new THREE.TorusGeometry(0.075, 0.012, 10, 40), metal, chest, [0, 0.425, 0], [Math.PI / 2, 0, 0], [1, 0.8, 1]);
  mesh(new THREE.TorusGeometry(0.083, 0.003, 6, 48), light, chest, [0, 0.432, 0], [Math.PI / 2, 0, 0], [1, 0.8, 1]);
  // arc reactor
  const reactor = group(chest, [0, 0.215, 0.14]);
  mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.02, 40), metal, reactor, null, [Math.PI / 2, 0, 0]);
  mesh(new THREE.TorusGeometry(0.036, 0.006, 10, 48), light, reactor, [0, 0, 0.011]);
  const reactorCore = mesh(new THREE.CircleGeometry(0.018, 32), light, reactor, [0, 0, 0.012]);
  const reactorSpokes = group(reactor, [0, 0, 0.012]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    mesh(new THREE.BoxGeometry(0.004, 0.012, 0.002), lightSoft, reactorSpokes,
      [Math.cos(a) * 0.026, Math.sin(a) * 0.026, 0], [0, 0, a + Math.PI / 2]);
  }
  const reactorHalo = sprite(reactor, [0, 0, 0.03], 0.22, 0.75);
  // light seams down the sides of the chest
  for (const s of [-1, 1]) {
    mesh(capsule(0.0025, 0.13), light, chest, [0.16 * s, 0.235, 0.098], [0.25, 0, -0.5 * s]);
  }

  // --------------------------------------------------------------- head

  const neck = group(chest, [0, 0.425, 0]);
  mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 24), metal, neck, [0, 0.04, 0]);
  for (let i = 0; i < 3; i++) {
    mesh(new THREE.TorusGeometry(0.05 - i * 0.003, 0.004, 6, 32), plate, neck, [0, 0.015 + i * 0.026, 0], [Math.PI / 2, 0, 0]);
  }

  const HX = 0.128, HY = 0.15, HZ = 0.138;           // head ellipsoid radii
  const head = group(neck, [0, 0.19, 0]);
  mesh(sphere(1, 48, 32), shell, head, null, null, [HX, HY, HZ]);
  // face: a glossy black visor wrapped round the front
  mesh(new THREE.SphereGeometry(1, 48, 32, Math.PI / 2 - 0.95, 1.9, 0.78, 1.0), visor, head,
    [0, -0.004, 0.004], null, [HX * 1.02, HY * 1.02, HZ * 1.03]);
  // jaw and cheek plates
  mesh(sphere(1, 32, 16), plate, head, [0, -0.1, 0.035], null, [0.075, 0.045, 0.09]);
  // crest along the top
  mesh(capsule(0.012, 0.16), plate, head, [0, 0.12, -0.01], [Math.PI / 2 + 0.35, 0, 0], [1, 1, 0.8]);
  mesh(capsule(0.003, 0.15), light, head, [0, 0.135, 0.005], [Math.PI / 2 + 0.45, 0, 0]);

  const surfZ = (x, y) => HZ * 1.03 * Math.sqrt(Math.max(0, 1 - (x / HX) ** 2 - (y / HY) ** 2));

  const eyes = group(head);
  const eyeMeshes = [];
  for (const s of [-1, 1]) {
    const x = 0.046 * s, y = 0.02;
    const eye = group(eyes, [x, y, surfZ(x, y) + 0.002]);
    eye.rotation.set(-0.12, Math.atan2(x, HZ) * 0.9, 0.12 * s);
    eyeMeshes.push(mesh(capsule(0.0075, 0.032), light, eye, null, [0, 0, Math.PI / 2]));
    sprite(eye, [0, 0, 0.01], 0.11, 0.8);
  }

  const mouthBars = [];
  const mouth = group(head, [0, -0.05, surfZ(0, -0.05) + 0.002]);
  mouth.rotation.x = 0.3;
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 0.0095;
    const bar = mesh(new THREE.BoxGeometry(0.005, 0.026, 0.003), light, mouth, [x, 0, -Math.abs(x) * 0.25]);
    bar.rotation.y = x * 4;
    bar.userData.i = i;
    mouthBars.push(bar);
  }

  // ears: discs with glowing rings
  const earRings = [];
  for (const s of [-1, 1]) {
    const ear = group(head, [HX * 0.98 * s, 0.0, -0.005]);
    ear.rotation.z = (Math.PI / 2) * s;
    mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 32), metal, ear);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.034, 32), plate, ear);
    const ring = mesh(new THREE.TorusGeometry(0.039, 0.0035, 8, 40), light, ear, [0, 0.017 * s, 0], [Math.PI / 2, 0, 0]);
    earRings.push(ring);
    mesh(capsule(0.006, 0.07), plate, ear, [0, 0.01 * s, -0.03], [Math.PI / 2 + 0.6, 0, 0]);
  }

  // --------------------------------------------------------------- arms

  function makeArm(side) {
    const s = side;
    const shoulder = group(chest, [0.28 * s, 0.35, -0.01]);
    mesh(sphere(0.06), metal, shoulder);
    mesh(sphere(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), shell, shoulder,
      [0.012 * s, 0.012, 0], [0, 0, -0.35 * s], [0.085, 0.075, 0.08]);
    mesh(new THREE.TorusGeometry(0.07, 0.003, 6, 40, Math.PI * 1.2), light, shoulder,
      [0.02 * s, 0.0, 0], [0, (Math.PI / 2) * s, Math.PI * 0.9]);

    const upper = group(shoulder);
    mesh(capsule(0.05, 0.16), shell, upper, [0, -0.15, 0]);
    mesh(new THREE.CylinderGeometry(0.049, 0.049, 0.02, 24), metal, upper, [0, -0.08, 0]);

    const elbow = group(upper, [0, -0.29, 0]);
    mesh(sphere(0.042), metal, elbow);
    mesh(capsule(0.047, 0.15), shell, elbow, [0, -0.13, 0], null, [1, 1, 1.05]);
    mesh(new THREE.TorusGeometry(0.046, 0.004, 8, 32), light, elbow, [0, -0.215, 0], [Math.PI / 2, 0, 0]);

    const hand = group(elbow, [0, -0.265, 0]);
    mesh(sphere(0.022), metal, hand);
    mesh(sphere(1, 24, 16), plate, hand, [0, -0.045, 0.005], null, [0.02, 0.042, 0.036]);
    const fingers = [];
    for (let i = 0; i < 4; i++) {
      const f = group(hand, [0, -0.082, 0.026 - i * 0.017]);
      mesh(capsule(0.0075, 0.035), metal, f, [0, -0.02, 0]);
      fingers.push(f);
    }
    const thumb = group(hand, [-0.012 * s, -0.04, 0.035]);
    thumb.rotation.set(0.6, 0, 0.5 * s);
    mesh(capsule(0.008, 0.03), metal, thumb, [0, -0.02, 0]);
    return { shoulder, upper, elbow, hand, fingers };
  }
  const armL = makeArm(1);   // robot's left: viewer's right
  const armR = makeArm(-1);  // robot's right: viewer's left

  // --------------------------------------------------------- holo halo

  const holo = group(scene, [0, 1.62, -0.45]);
  const ringA = mesh(new THREE.TorusGeometry(0.5, 0.003, 6, 128), lightFaint, holo);
  const ringB = group(holo);
  for (let i = 0; i < 3; i++) {
    mesh(new THREE.TorusGeometry(0.56, 0.006, 6, 64, 1.2), lightSoft, ringB, null, [0, 0, (i * Math.PI * 2) / 3]);
  }
  const ringC = group(holo);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, long = i % 5 === 0;
    mesh(new THREE.BoxGeometry(0.004, long ? 0.035 : 0.016, 0.002), lightFaint, ringC,
      [Math.cos(a) * 0.63, Math.sin(a) * 0.63, 0], [0, 0, a + Math.PI / 2]);
  }

  // drifting particles
  const N = reducedMotion ? 40 : 110;
  const pPos = new Float32Array(N * 3), pSpeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.45;
    pPos.set([Math.cos(a) * r, 0.9 + Math.random() * 1.2, Math.sin(a) * r * 0.6 - 0.2], i * 3);
    pSpeed[i] = 0.03 + Math.random() * 0.07;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    color: glow, size: 0.018, map: glowTexture(), transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  scene.add(new THREE.Points(pGeo, pMat));

  // --------------------------------------------------------------- lights

  scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x05080c, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-1.2, 2.6, 2.2);
  scene.add(key);
  const rimL = new THREE.PointLight(glow, 3.2, 4, 1.5);
  rimL.position.set(0.9, 1.9, -0.7);
  const rimR = new THREE.PointLight(glow, 3.2, 4, 1.5);
  rimR.position.set(-0.9, 1.5, -0.7);
  const front = new THREE.PointLight(glow, 0.6, 1.2, 2);
  front.position.set(0, 1.3, 0.55);
  scene.add(rimL, rimR, front);

  // ---------------------------------------------------------------- poses
  //
  // Each pose is a set of joint angles (radians). The robot eases towards the
  // pose for the current state; small motions are added on top every frame.

  const POSES = {
    idle: {
      spineX: 0, spineZ: 0, headX: 0.04, headY: 0, headZ: 0,
      lX: 0.06, lZ: 0.12, lE: -0.22, rX: 0.06, rZ: -0.12, rE: -0.22, curl: 0.35,
    },
    listening: {
      spineX: 0.1, spineZ: 0.03, headX: 0.1, headY: -0.12, headZ: 0.2,
      lX: -0.15, lZ: 0.16, lE: -0.55, rX: 0.04, rZ: -0.14, rE: -0.3, curl: 0.4,
    },
    thinking: {
      spineX: 0.02, spineZ: -0.03, headX: -0.1, headY: 0.22, headZ: -0.1,
      lX: -0.35, lY: -0.5, lZ: -0.15, lE: -1.5, rX: -1.1, rY: 0.9, rZ: 0.15, rE: -2.3, curl: 0.9,
    },
    speaking: {
      spineX: 0.02, spineZ: 0, headX: 0.02, headY: 0, headZ: 0,
      lX: -0.5, lZ: 0.22, lE: -0.95, rX: -0.5, rZ: -0.22, rE: -0.95, curl: 0.2,
    },
    offline: {
      spineX: 0.14, spineZ: 0, headX: 0.5, headY: 0, headZ: 0,
      lX: 0.08, lZ: 0.05, lE: -0.08, rX: 0.08, rZ: -0.05, rE: -0.08, curl: 0.5,
    },
  };
  for (const p of Object.values(POSES)) { p.lY ??= 0; p.rY ??= 0; }
  POSES.recording = POSES.listening;
  POSES.loading = POSES.thinking;
  POSES.connecting = POSES.offline;

  const GLOW_LEVEL = { idle: 1, listening: 1.1, recording: 1.1, thinking: 1, loading: 0.8, speaking: 1.15, offline: 0.12, connecting: 0.3 };
  const LOOK_WEIGHT = { idle: 1, listening: 0.4, recording: 0.4, thinking: 0.1, loading: 0.1, speaking: 0.6, offline: 0, connecting: 0 };

  const cur = { ...POSES.offline };
  let state = document.body.dataset.state || "connecting";

  function readState() {
    state = document.body.dataset.state || "idle";
    const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
    if (accent) {
      try { glowTarget.set(accent); } catch {}
    }
    glowLevelTarget = GLOW_LEVEL[state] ?? 1;
  }
  new MutationObserver(readState).observe(document.body, { attributes: true, attributeFilter: ["data-state"] });
  readState();
  glow.copy(glowTarget);

  // head follows the pointer
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.25;
    look.tx = THREE.MathUtils.clamp((e.clientX - cx) / (window.innerWidth / 2), -1, 1);
    look.ty = THREE.MathUtils.clamp((e.clientY - cy) / (window.innerHeight / 2), -1, 1);
  }, { passive: true });

  // ---------------------------------------------------------------- frame

  let nextBlink = 2, blinkUntil = 0;
  let speech = 0;
  const clock = new THREE.Clock();
  const tmp = new THREE.Color();

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    const motion = reducedMotion ? 0.3 : 1;
    const ease = (speed) => 1 - Math.exp(-dt * speed);

    // ease joints towards the pose for this state
    const pose = POSES[state] || POSES.idle;
    for (const k in pose) cur[k] += (pose[k] - cur[k]) * ease(state === "offline" || state === "connecting" ? 2 : 4.5);

    // colour and brightness
    glow.lerp(glowTarget, ease(4));
    glowLevel += (glowLevelTarget - glowLevel) * ease(3);
    let level = glowLevel;
    if (state === "thinking" || state === "loading") level *= 0.8 + 0.2 * Math.sin(t * 6);
    if (state === "listening" || state === "recording") level *= 0.9 + 0.1 * Math.sin(t * 9);
    tmp.copy(glow).multiplyScalar(level);
    light.color.copy(tmp);
    lightSoft.color.copy(tmp);
    lightFaint.color.copy(tmp);
    pMat.color.copy(tmp);
    for (const s of sprites) {
      s.material.color.copy(glow);
      s.material.opacity = s.userData.baseOpacity * Math.min(level, 1.2);
    }
    rimL.color.copy(glow); rimR.color.copy(glow); front.color.copy(glow);
    rimL.intensity = rimR.intensity = 3.2 * Math.max(level, 0.25);
    front.intensity = 0.6 * level;

    // breathing and idle sway
    const breath = Math.sin(t * 1.6) * 0.012 * motion;
    chest.scale.set(1 + breath * 0.5, 1 + breath * 0.3, 1 + breath);
    robot.position.y = Math.sin(t * 1.6) * 0.004 * motion;
    robot.rotation.y = Math.sin(t * 0.35) * 0.06 * motion;

    // head: pose + pointer + state-specific motion
    look.x += (look.tx - look.x) * ease(3);
    look.y += (look.ty - look.y) * ease(3);
    const lw = LOOK_WEIGHT[state] ?? 0.5;
    let hx = cur.headX + look.y * 0.22 * lw, hy = cur.headY + look.x * 0.55 * lw, hz = cur.headZ;
    if (state === "speaking") {
      hx += Math.sin(t * 3.1) * 0.04 * motion;
      hy += Math.sin(t * 1.3) * 0.08 * motion;
    } else if (state === "thinking" || state === "loading") {
      hy += Math.sin(t * 0.9) * 0.06 * motion;
    } else if (state === "idle") {
      hy += Math.sin(t * 0.5) * 0.05 * motion;
      hx += Math.sin(t * 0.7 + 1) * 0.02 * motion;
    }
    head.rotation.set(hx * 0.6, hy * 0.7, hz * 0.6);
    neck.rotation.set(hx * 0.4, hy * 0.3, hz * 0.4);
    spine.rotation.set(cur.spineX * 0.5, 0, cur.spineZ);
    chest.rotation.set(cur.spineX * 0.5, (state === "speaking" ? Math.sin(t * 1.3) * 0.05 : 0) * motion, 0);

    // arms
    let lX = cur.lX, lY = cur.lY, rY = cur.rY, lZ = cur.lZ, lE = cur.lE, rX = cur.rX, rZ = cur.rZ, rE = cur.rE;
    if (state === "speaking") {
      lX += Math.sin(t * 2.3) * 0.12 * motion; lE += Math.sin(t * 2.9 + 1) * 0.25 * motion;
      rX += Math.sin(t * 2.0 + 2) * 0.12 * motion; rE += Math.sin(t * 2.6 + 0.4) * 0.25 * motion;
    } else {
      const sway = Math.sin(t * 1.6) * 0.015 * motion;
      lZ += sway; rZ -= sway;
    }
    armL.shoulder.rotation.set(lX, lY, lZ);
    armR.shoulder.rotation.set(rX, rY, rZ);
    armL.elbow.rotation.set(lE, 0, 0);
    armR.elbow.rotation.set(rE, 0, 0);
    armL.hand.rotation.set(0, 0, 0);
    armR.hand.rotation.set(state === "thinking" || state === "loading" ? 0.3 : 0, 0, 0);
    for (const arm of [armL, armR]) {
      arm.fingers.forEach((f, i) => { f.rotation.x = -cur.curl * (1 + i * 0.08); });
    }

    // eyes: blink, scan while thinking
    if (t > nextBlink) { blinkUntil = t + 0.12; nextBlink = t + 2.5 + Math.random() * 3.5; }
    const blink = t < blinkUntil && level > 0.3 ? 0.15 : 1;
    eyeMeshes.forEach((e) => e.scale.set(blink, 1, 1));  // capsule lies on its side
    eyes.position.x = state === "thinking" || state === "loading" ? Math.sin(t * 2.2) * 0.008 * motion : 0;
    eyes.position.y = state === "thinking" || state === "loading" ? 0.004 : 0;

    // mouth: an equaliser while speaking, a thin line otherwise
    const talking = state === "speaking";
    const syllable = Math.max(0, Math.sin(t * 9.5) * 0.6 + Math.sin(t * 15.7 + 1.3) * 0.4);
    speech += ((talking ? 0.25 + 0.75 * syllable : 0) - speech) * ease(talking ? 22 : 8);
    for (const bar of mouthBars) {
      const i = bar.userData.i, centre = 1 - Math.abs(i - 3) / 4;
      const wobble = 0.55 + 0.45 * Math.abs(Math.sin(t * 17 + i * 1.7));
      bar.scale.y = 0.12 + speech * (0.4 + 0.6 * centre) * wobble;
    }

    // ears pulse while listening
    const listen = state === "listening" || state === "recording";
    earRings.forEach((r) => r.scale.setScalar(listen ? 1 + 0.12 * Math.sin(t * 8) : 1));

    // reactor and halo rings
    const fast = state === "thinking" || state === "loading" ? 6 : state === "speaking" ? 2 : 1;
    reactorSpokes.rotation.z += dt * 0.8 * fast * motion;
    reactorCore.scale.setScalar(1 + (talking ? speech * 0.25 : Math.sin(t * 2) * 0.05));
    reactorHalo.scale.setScalar(0.22 * (1 + (talking ? speech * 0.3 : 0)));
    ringA.rotation.z += dt * 0.1 * fast * motion;
    ringB.rotation.z -= dt * 0.25 * fast * motion;
    ringC.rotation.z += dt * 0.05 * fast * motion;
    holo.scale.setScalar(listen ? 1 + 0.02 * Math.sin(t * 6) : 1);

    // particles drift upwards
    const rise = (state === "thinking" ? 2.5 : 1) * motion;
    for (let i = 0; i < N; i++) {
      let y = pPos[i * 3 + 1] + pSpeed[i] * dt * rise;
      if (y > 2.15) y = 0.85;
      pPos[i * 3 + 1] = y;
    }
    pGeo.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- sizing

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep head and chest in view in wide or tall boxes
    camera.fov = camera.aspect < 0.8 ? 30 * (0.8 / camera.aspect) ** 0.35 : 30;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);

  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    document.body.classList.remove("has-robot");
  });

  document.body.classList.add("has-robot");
  resize();
  renderer.setAnimationLoop(tick);
}

// ------------------------------------------------------------------ helpers

function lathe(points) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), 48);
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// A small dark studio with soft light panels, used for metal reflections.
function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x0a1420, side: THREE.BackSide }),
  ));
  const panel = (color, pos, scale) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.scale.set(...scale);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(0xffffff, [0, 4.5, 1], [5, 2, 1]);        // soft top light
  panel(0xcfe8ff, [-4.5, 1, 2], [2, 4, 1]);       // key side
  panel(0x3fd0ff, [4.5, 0.5, -2], [1.5, 4, 1]);   // cyan side
  panel(0x3fd0ff, [0, -1, -4.5], [6, 0.4, 1]);    // cyan strip behind
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  return tex;
}

// ------------------------------------------------------------------ go

if (host && webglOk()) {
  try {
    start(host);
  } catch (e) {
    console.warn("JARVIS robot disabled:", e);
    document.body.classList.remove("has-robot");
  }
}
