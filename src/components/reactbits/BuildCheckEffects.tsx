"use client";

import React, { useEffect, useRef, useState, ReactNode } from "react";

/* ==========================================================================
   REACT BITS — Interactive DotGrid Background
   Inspired by https://reactbits.dev/backgrounds/dot-grid
   ========================================================================== */
interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  className?: string;
}

export function InteractiveDotGrid({
  dotSize = 1.6,
  gap = 28,
  baseColor = "rgba(148, 163, 184, 0.16)",
  activeColor = "rgba(96, 165, 250, 0.78)",
  proximity = 150,
  className = "",
}: DotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: -9999,
    y: -9999,
    active: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const onMove = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY, active: true };
    };
    const onLeave = () => {
      pointerRef.current.active = false;
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);

    let rafId = 0;
    const drawFrame = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      const t = prefersReduced ? 0 : time * 0.0012;
      const px = pointerRef.current.x;
      const py = pointerRef.current.y;
      const isHovering = pointerRef.current.active;

      const cols = Math.ceil(width / gap) + 1;
      const rows = Math.ceil(height / gap) + 1;
      const offsetX = ((width % gap) * 0.5) | 0;
      const offsetY = ((height % gap) * 0.5) | 0;

      for (let r = 0; r < rows; r += 1) {
        const y = offsetY + r * gap;
        for (let c = 0; c < cols; c += 1) {
          const x = offsetX + c * gap;

          let boost = 0;
          if (isHovering && !prefersReduced) {
            const dx = x - px;
            const dy = y - py;
            const dist = Math.hypot(dx, dy);
            if (dist < proximity) {
              boost = 1 - dist / proximity;
              boost = boost * boost;
            }
          }

          // Subtle ambient wave ripple across top-center hero band
          const wave = prefersReduced
            ? 0
            : Math.max(0, Math.sin(x * 0.015 + y * 0.012 - t) * 0.5 + 0.5) * 0.12;

          const radius = dotSize + boost * 1.9 + wave * 0.45;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);

          if (boost > 0.05) {
            ctx.fillStyle = `rgba(96, 165, 250, ${(0.22 + boost * 0.68).toFixed(3)})`;
          } else if (wave > 0.06) {
            ctx.fillStyle = `rgba(147, 197, 253, ${(0.14 + wave * 0.45).toFixed(3)})`;
          } else {
            ctx.fillStyle = baseColor;
          }
          ctx.fill();
        }
      }

      if (!prefersReduced) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    if (prefersReduced) {
      drawFrame(0);
    } else {
      rafId = requestAnimationFrame(drawFrame);
    }

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [dotSize, gap, baseColor, activeColor, proximity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 ${className}`}
    />
  );
}

/* ==========================================================================
   REACT BITS — ShinyText (https://reactbits.dev/text-animations/shiny-text)
   ========================================================================== */
export function ShinyText({
  text,
  className = "",
  speedSec = 4.5,
}: {
  text: string;
  className?: string;
  speedSec?: number;
}) {
  return (
    <span
      className={`rb-shiny-text inline-block bg-clip-text text-transparent ${className}`}
      style={{
        animationDuration: `${speedSec}s`,
      }}
    >
      {text}
    </span>
  );
}

/* ==========================================================================
   REACT BITS — CountUp (https://reactbits.dev/text-animations/count-up)
   ========================================================================== */
export function CountUp({
  to,
  from = 0,
  durationMs = 850,
  className = "",
}: {
  to: number;
  from?: number;
  durationMs?: number;
  className?: string;
}) {
  const [val, setVal] = useState(from);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || durationMs <= 0) {
      setVal(to);
      return;
    }

    let rafId = 0;
    const start = performance.now();
    const diff = to - from;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(from + diff * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [to, from, durationMs]);

  return <span className={className}>{val}</span>;
}

/* ==========================================================================
   REACT BITS — StarBorder (https://reactbits.dev/animations/star-border)
   ========================================================================== */
export function StarBorder({
  children,
  active = false,
  color = "#60A5FA",
  speed = "6.5s",
  className = "",
}: {
  children: ReactNode;
  active?: boolean;
  color?: string;
  speed?: string;
  className?: string;
}) {
  return (
    <div className={`relative p-[1px] overflow-hidden ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[120%] rb-border-spin"
        style={{
          animationDuration: speed,
          opacity: active ? 1 : 0.55,
          background: `conic-gradient(from 0deg, transparent 0deg 285deg, ${color} 325deg, #2934FF 348deg, transparent 360deg)`,
        }}
      />
      <div className="relative z-10 bg-[#0A0A0C]">{children}</div>
    </div>
  );
}
