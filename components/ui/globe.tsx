"use client";

import { useEffect, useRef } from "react";
import createGlobe from "cobe";
import { cn } from "@/lib/utils";

interface GlobeProps {
  className?: string;
  isActive?: boolean;
  audioLevel?: number;
}

export function Globe({ className, isActive = false, audioLevel = 0 }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerInteracting = useRef<number | null>(null);
  const pointerInteractionMovement = useRef(0);
  const phiRef = useRef(0);
  const audioLevelRef = useRef(audioLevel);
  const isActiveRef = useRef(isActive);
  const sizeRef = useRef(220);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
    isActiveRef.current = isActive;
  }, [audioLevel, isActive]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const syncCanvasSize = (triggerResize: boolean) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const nextSize = Math.max(120, Math.floor(Math.min(rect.width, rect.height, 280)));
      if (nextSize !== sizeRef.current || canvas.style.width !== `${nextSize}px`) {
        sizeRef.current = nextSize;
        canvas.style.width = `${nextSize}px`;
        canvas.style.height = `${nextSize}px`;
        if (triggerResize) {
          window.dispatchEvent(new Event("resize"));
        }
      }
    };

    syncCanvasSize(false);

    const resizeObserver = new ResizeObserver(() => {
      syncCanvasSize(true);
    });
    resizeObserver.observe(container);

    let globeInstance: any = null;

    try {
      globeInstance = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: sizeRef.current * dpr,
        height: sizeRef.current * dpr,
        phi: 0,
        theta: 0.25,
        dark: 1,
        diffuse: 1.4,
        mapSamples: 16000,
        mapBrightness: 6,
        baseColor: [0.08, 0.15, 0.22],
        markerColor: [0, 0.95, 1],
        glowColor: [0, 0.6, 0.9],
        offset: [0, 0],
        markers: [
          { location: [28.6139, 77.2090], size: 0.08 }, // India / New Delhi
          { location: [37.7749, -122.4194], size: 0.05 }, // SF
          { location: [51.5074, -0.1278], size: 0.05 }, // London
          { location: [35.6762, 139.6503], size: 0.05 }, // Tokyo
          { location: [1.3521, 103.8198], size: 0.04 }, // Singapore
          { location: [-33.8688, 151.2093], size: 0.04 }, // Sydney
        ],
        onRender: (state) => {
          // Subtle spin + mouse drag interaction + voice reactive acceleration
          const currentAudio = audioLevelRef.current;
          const active = isActiveRef.current;
          const speed = (active ? 0.012 + currentAudio * 0.025 : 0.005);

          if (!pointerInteracting.current) {
            phiRef.current += speed;
          }
          state.phi = phiRef.current + pointerInteractionMovement.current;
          state.width = sizeRef.current * dpr;
          state.height = sizeRef.current * dpr;
        },
      });
    } catch (e) {
      console.error("Failed to initialize Cobe Globe:", e);
    }

    // Fade in canvas smoothly
    setTimeout(() => {
      if (canvasRef.current) {
        canvasRef.current.style.opacity = "1";
      }
    }, 50);

    return () => {
      resizeObserver.disconnect();
      if (globeInstance) {
        try {
          globeInstance.destroy();
        } catch (e) {}
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full flex items-center justify-center select-none",
        className
      )}
      onPointerDown={(e) => {
        pointerInteracting.current = e.clientX - pointerInteractionMovement.current;
      }}
      onPointerUp={() => {
        pointerInteracting.current = null;
      }}
      onPointerOut={() => {
        pointerInteracting.current = null;
      }}
      onMouseMove={(e) => {
        if (pointerInteracting.current !== null) {
          const delta = e.clientX - pointerInteracting.current;
          pointerInteractionMovement.current = delta * 0.005;
        }
      }}
      onTouchMove={(e) => {
        if (pointerInteracting.current !== null && e.touches[0]) {
          const delta = e.touches[0].clientX - pointerInteracting.current;
          pointerInteractionMovement.current = delta * 0.005;
        }
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: 220,
          height: 220,
          opacity: 0,
          transition: "opacity 0.6s ease",
        }}
        className="block shrink-0 pointer-events-auto cursor-grab active:cursor-grabbing drop-shadow-[0_0_35px_rgba(0,242,255,0.3)]"
      />
    </div>
  );
}
