"use client";

import React, { useEffect, useRef } from "react";

type FooterWordmarkProps = {
  text?: string;
  inkColor: string;
  rimColor?: string;
  cellSize?: number;
  revealRadius?: number;
  className?: string;
};

// Exact port of the 8x8 Bayer index used in DitherVeil.tsx `bayer(vec2 cell)`
function bayer(x: number, y: number): number {
  const px = x & 7;
  const py = y & 7;
  const v = px ^ py;
  const m =
    ((v & 1) << 5) |
    ((py & 1) << 4) |
    ((v & 2) << 2) |
    ((py & 2) << 1) |
    ((v & 4) >> 1) |
    ((py & 4) >> 2);
  return (m + 0.5) / 64;
}

/**
 * Giant editorial "SolShield" wordmark rendered with the hero's exact 2px
 * Bayer 8x8 ordered-dither grid. Solid sculptural crown fading smoothly into
 * fine halftone stipple toward the baseline, with delicate Cobalt transition
 * sparks and an interactive hover-heal halo.
 */
export default function FooterWordmark({
  text = "SolShield",
  inkColor,
  rimColor = "#2934FF",
  cellSize = 2,
  revealRadius = 175,
  className = "",
}: FooterWordmarkProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cols = 0;
    let rows = 0;
    let coverage = new Float32Array(0);
    let cssW = 0;
    let cssH = 0;
    let raf = 0;
    let disposed = false;

    const pointer = { x: -9999, y: -9999, inside: false };
    let strength = 0;

    const fontStack = `"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`;

    const applyFontAndTracking = (
      targetCtx: CanvasRenderingContext2D,
      sizePx: number
    ) => {
      targetCtx.font = `600 ${sizePx}px ${fontStack}`;
      if ("letterSpacing" in targetCtx) {
        (targetCtx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
          `${-0.038 * sizePx}px`;
      }
    };

    const layout = () => {
      cssW = Math.max(1, Math.floor(wrap.clientWidth));
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) return;
      applyFontAndTracking(probe, 100);
      const refW = probe.measureText(text).width || 1;
      const fontSize = (cssW / refW) * 100 * 0.992;
      applyFontAndTracking(probe, fontSize);
      const fm = probe.measureText(text);
      const ascent = fm.actualBoundingBoxAscent || fontSize * 0.74;
      const descent = fm.actualBoundingBoxDescent || 0;
      const left = fm.actualBoundingBoxLeft || 0;
      const textW =
        (fm.actualBoundingBoxRight || fm.width) + (fm.actualBoundingBoxLeft || 0);
      const scaleX = textW > cssW ? cssW / textW : 1;

      cssH = Math.ceil(ascent + descent + cellSize * 2);
      cols = Math.ceil(cssW / cellSize);
      rows = Math.ceil(cssH / cellSize);

      const off = document.createElement("canvas");
      off.width = cssW;
      off.height = cssH;
      const octx = off.getContext("2d");
      if (!octx) return;
      octx.fillStyle = "#fff";
      applyFontAndTracking(octx, fontSize);
      octx.textBaseline = "alphabetic";
      octx.save();
      octx.scale(scaleX, 1);
      octx.fillText(text, left, ascent + cellSize);
      octx.restore();
      const data = octx.getImageData(0, 0, cssW, cssH).data;

      coverage = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        const sy = Math.min(cssH - 1, Math.floor((r + 0.5) * cellSize));
        for (let c = 0; c < cols; c++) {
          const sx = Math.min(cssW - 1, Math.floor((c + 0.5) * cellSize));
          coverage[r * cols + c] = data[(sy * cssW + sx) * 4 + 3] / 255;
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      const r2 = revealRadius * revealRadius;
      const ink: [number, number][] = [];
      const rim: [number, number][] = [];

      for (let r = 0; r < rows; r++) {
        const yn = rows > 1 ? r / (rows - 1) : 0;
        // Solid crown for upper ~36%, then smooth dissolve keeping a legible ~0.26 baseline
        const ramp =
          yn < 0.34 ? 1.0 : Math.max(0.24, 1.0 - ((yn - 0.34) / 0.66) * 0.76);
        const cy = (r + 0.5) * cellSize;
        for (let c = 0; c < cols; c++) {
          const cov = coverage[r * cols + c];
          if (cov < 0.45) continue;
          let tone = ramp * (0.72 + 0.28 * cov);
          let localRim = 0.055; // restrained static cobalt edge accent

          if (strength > 0.001) {
            const dx = (c + 0.5) * cellSize - pointer.x;
            const dy = cy - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < r2) {
              const dist = Math.sqrt(d2) / revealRadius;
              const k = 1 - dist;
              const smooth = k * k * (3 - 2 * k) * strength;
              tone = Math.min(1, tone + smooth * 1.15);
              // Bright cobalt halo along the circular cursor frontier
              localRim = Math.max(
                localRim,
                Math.sin(dist * Math.PI) * 0.16 * strength
              );
            }
          }

          const t = bayer(c, r);
          if (tone >= 0.995 || t < tone) {
            ink.push([c, r]);
          } else if (t < tone + localRim) {
            rim.push([c, r]);
          }
        }
      }

      ctx.fillStyle = inkColor;
      for (const [c, r] of ink) ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      ctx.fillStyle = rimColor;
      for (const [c, r] of rim) ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    };

    const tick = () => {
      raf = 0;
      const target = pointer.inside ? 1 : 0;
      strength += (target - strength) * (pointer.inside ? 0.24 : 0.07);
      if (Math.abs(target - strength) < 0.004) strength = target;
      draw();
      if (strength !== target) raf = requestAnimationFrame(tick);
    };
    const schedule = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = true;
      schedule();
    };
    const onLeave = () => {
      pointer.inside = false;
      schedule();
    };

    const ro = new ResizeObserver(() => layout());
    ro.observe(wrap);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);

    layout();
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!disposed) layout();
      });
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
    };
  }, [text, inkColor, rimColor, cellSize, revealRadius]);

  return (
    <div ref={wrapRef} className={`relative w-full select-none ${className}`}>
      <span className="sr-only">{text}</span>
      <canvas ref={canvasRef} aria-hidden="true" className="block" />
    </div>
  );
}
