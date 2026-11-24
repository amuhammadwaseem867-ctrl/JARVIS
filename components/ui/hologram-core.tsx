"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { HOLOGRAM_POINTS } from "./hologram-points";

interface HologramCoreProps {
  className?: string;
  isActive?: boolean;
  audioLevel?: number;
}

interface RenderParticle {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  size: number;
  phase: number;
  speed: number;
  drift: number;
}

function buildParticles(): RenderParticle[] {
  let seed = 77319;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Reference image natural aspect ratio (936 / 732 = 1.2787)
  const aspectX = 1.2787;

  return HOLOGRAM_POINTS.map(([qx, qy, qBright, r, g, b]) => {
    const nx = (qx / 1000) * aspectX;
    const ny = qy / 1000;
    const bright = qBright / 100;

    // Estimate subtle 3D depth: center face/chest forward, outer aura slightly recessed
    const distFromCenter = Math.hypot(nx * 0.9, ny + 0.05);
    const nz = Math.max(-0.18, 0.22 - distFromCenter * 0.45) + (rand() - 0.5) * 0.06;

    // Preserve subtle facial shading and rich cobalt/cyan depth under additive blending
    const rr = Math.min(240, Math.round(r * 0.92));
    const gg = Math.min(248, Math.round(g * 0.98));
    const bb = Math.min(255, Math.round(Math.max(b, 115 * bright + 70)));

    return {
      x: nx,
      y: ny,
      z: nz,
      r: rr,
      g: gg,
      b: bb,
      alpha: Math.min(0.46, 0.14 + bright * 0.32),
      size: 0.45 + bright * 0.55 + rand() * 0.22,
      phase: rand() * Math.PI * 2,
      speed: 0.6 + rand() * 1.1,
      drift: 0.002 + (1 - bright) * 0.0038,
    };
  });
}

export function HologramCore({ className, isActive = false, audioLevel = 0 }: HologramCoreProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isActiveRef = useRef(isActive);
  const audioLevelRef = useRef(audioLevel);

  useEffect(() => {
    isActiveRef.current = isActive;
    audioLevelRef.current = audioLevel;
  }, [isActive, audioLevel]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = buildParticles();
    let animId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const startTime = performance.now();

    const render = (now: number) => {
      const t = (now - startTime) * 0.001;
      if (width > 0 && height > 0) {
        ctx.clearRect(0, 0, width, height);

        const active = isActiveRef.current;
        const audio = audioLevelRef.current;

        // Fit the 1.28:1 hologram silhouette cleanly inside the chamber viewport
        const scale = Math.min(width / 1.18, height / 0.92);
        const cx = width * 0.5;
        const cy = height * 0.53;

        // Soft volumetric backdrop glow matching reference atmosphere
        const halo = ctx.createRadialGradient(
          cx,
          cy - scale * 0.12,
          scale * 0.04,
          cx,
          cy - scale * 0.04,
          scale * 0.52
        );
        const haloStrength = active ? 0.24 + audio * 0.16 : 0.16;
        halo.addColorStop(0, `rgba(56, 189, 248, ${haloStrength})`);
        halo.addColorStop(0.55, `rgba(14, 116, 204, ${haloStrength * 0.42})`);
        halo.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, width, height);

        // Subtle 3D breathing sway
        const yaw = Math.sin(t * 0.4) * 0.045;
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        const sizeScale = Math.max(0.75, scale / 235);

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const pulse = Math.sin(t * p.speed + p.phase);
          const rx = p.x * cosY - p.z * sinY;
          const rz = p.x * sinY + p.z * cosY;

          const audioJitter = active ? audio * 0.015 * pulse : 0;
          const px = cx + (rx + Math.cos(t * 0.8 + p.phase) * p.drift + audioJitter) * scale;
          const py = cy + (p.y + pulse * p.drift * 0.85) * scale;

          const perspective = 1 + rz * 0.25;
          const radius = Math.max(0.45, p.size * perspective * sizeScale);
          const twinkle = 0.84 + 0.16 * pulse + (active ? audio * 0.2 : 0);
          const alpha = Math.min(1, p.alpha * twinkle);

          ctx.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className={cn("relative w-full h-full select-none", className)}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
