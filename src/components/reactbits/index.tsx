"use client";

import React, { useState, useEffect, useRef, ReactNode } from "react";

export { default as DitherVeil } from "./DitherVeil";

/* ==========================================================================
   1. REACT BITS — DecryptedText (https://reactbits.dev/text-animations/decrypted-text)
   ========================================================================== */
interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  characters?: string;
  className?: string;
  encryptedClassName?: string;
  animateOn?: "view" | "hover" | "both";
}

export function DecryptedText({
  text,
  speed = 32,
  maxIterations = 10,
  sequential = true,
  characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+<>?",
  className = "",
  encryptedClassName = "opacity-60",
  animateOn = "both",
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isScrambling, setIsScrambling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const triggerDecrypt = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsScrambling(true);
    let iteration = 0;

    intervalRef.current = setInterval(() => {
      setDisplayText(
        text
          .split("")
          .map((char, idx) => {
            if (char === " " || char === "\n") return char;
            const threshold = sequential
              ? (iteration / maxIterations) * text.length
              : maxIterations;
            if (sequential ? idx < threshold : iteration >= maxIterations) {
              return text[idx];
            }
            return characters[Math.floor(Math.random() * characters.length)];
          })
          .join("")
      );

      iteration += 1;
      if (iteration > maxIterations) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setDisplayText(text);
        setIsScrambling(false);
      }
    }, speed);
  };

  useEffect(() => {
    if (animateOn === "view" || animateOn === "both") {
      triggerDecrypt();
    } else {
      setDisplayText(text);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <span
      onMouseEnter={() => {
        if (animateOn === "hover" || animateOn === "both") triggerDecrypt();
      }}
      className={`inline-block ${className}`}
    >
      {displayText.split("").map((char, idx) => {
        const isRevealed = char === text[idx] && !isScrambling;
        return (
          <span
            key={idx}
            className={isRevealed ? "" : encryptedClassName}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}

/* ==========================================================================
   2. REACT BITS — BlurText (https://reactbits.dev/text-animations/blur-text)
   ========================================================================== */
interface BlurTextProps {
  text: string;
  delay?: number;
  className?: string;
}

export function BlurText({ text, delay = 65, className = "" }: BlurTextProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, [text]);

  const words = text.split(" ");

  return (
    <span className={`inline-flex flex-wrap gap-x-[0.26em] ${className}`}>
      {words.map((word, idx) => (
        <span
          key={`${word}-${idx}`}
          style={{
            transitionDelay: `${idx * delay}ms`,
            filter: mounted ? "blur(0px)" : "blur(10px)",
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translate3d(0,0,0)" : "translate3d(0,12px,0)",
          }}
          className="inline-block transition-all duration-700 ease-out will-change-[transform,filter,opacity]"
        >
          {word}
        </span>
      ))}
    </span>
  );
}

/* ==========================================================================
   3. REACT BITS — Magnet (https://reactbits.dev/animations/magnet)
   ========================================================================== */
interface MagnetProps {
  children: ReactNode;
  padding?: number;
  disabled?: boolean;
  magnetStrength?: number;
  className?: string;
}

export function Magnet({
  children,
  padding = 64,
  disabled = false,
  magnetStrength = 2.6,
  className = "",
}: MagnetProps) {
  const [isActive, setIsActive] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const magnetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) {
      setPosition({ x: 0, y: 0 });
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!magnetRef.current) return;
      const { left, top, width, height } =
        magnetRef.current.getBoundingClientRect();
      const centerX = left + width / 2;
      const centerY = top + height / 2;

      const distX = Math.abs(centerX - e.clientX);
      const distY = Math.abs(centerY - e.clientY);

      if (distX < width / 2 + padding && distY < height / 2 + padding) {
        setIsActive(true);
        const offsetX = (e.clientX - centerX) / magnetStrength;
        const offsetY = (e.clientY - centerY) / magnetStrength;
        setPosition({ x: offsetX, y: offsetY });
      } else {
        setIsActive(false);
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [padding, disabled, magnetStrength]);

  return (
    <div
      ref={magnetRef}
      className={`inline-block ${className}`}
      style={{ position: "relative" }}
    >
      <div
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          transition: isActive
            ? "transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)"
            : "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ==========================================================================
   4. REACT BITS — TiltedCard (https://reactbits.dev/components/tilted-card)
   ========================================================================== */
interface TiltedCardProps {
  children: ReactNode;
  rotateAmplitude?: number;
  scaleOnHover?: number;
  showGlare?: boolean;
  className?: string;
}

export function TiltedCard({
  children,
  rotateAmplitude = 8,
  scaleOnHover = 1.015,
  showGlare = true,
  className = "",
}: TiltedCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState(
    "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)"
  );
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50, opacity: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;

    const rotationX = (-offsetY / (rect.height / 2)) * rotateAmplitude;
    const rotationY = (offsetX / (rect.width / 2)) * rotateAmplitude;

    setTransform(
      `perspective(1000px) rotateX(${rotationX.toFixed(2)}deg) rotateY(${rotationY.toFixed(
        2
      )}deg) scale3d(${scaleOnHover}, ${scaleOnHover}, ${scaleOnHover})`
    );

    const gx = ((e.clientX - rect.left) / rect.width) * 100;
    const gy = ((e.clientY - rect.top) / rect.height) * 100;
    setGlarePos({ x: gx, y: gy, opacity: 0.16 });
  };

  const handleMouseLeave = () => {
    setTransform(
      "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)"
    );
    setGlarePos((prev) => ({ ...prev, opacity: 0 }));
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform,
        transition: "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
        transformStyle: "preserve-3d",
      }}
      className={`relative ${className}`}
    >
      {children}
      {showGlare && (
        <div
          pointer-events-none="true"
          style={{
            background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255,255,255,${glarePos.opacity}), transparent 60%)`,
          }}
          className="pointer-events-none absolute inset-0 z-20 transition-opacity duration-300"
        />
      )}
    </div>
  );
}

/* ==========================================================================
   5. REACT BITS — SpotlightCard (https://reactbits.dev/components/spotlight-card)
   ========================================================================== */
interface SpotlightCardProps {
  children: ReactNode;
  spotlightColor?: string;
  className?: string;
}

export function SpotlightCard({
  children,
  spotlightColor = "rgba(41, 52, 255, 0.18)",
  className = "",
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={`relative overflow-hidden ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-500"
        style={{
          opacity,
          background: `radial-gradient(520px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 45%)`,
        }}
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}

/* ==========================================================================
   6. REACT BITS — ClickSpark (https://reactbits.dev/animations/click-spark)
   ========================================================================== */
interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

export function ClickSpark({
  children,
  sparkColor = "#2934FF",
  sparkSize = 11,
  sparkRadius = 22,
  sparkCount = 8,
  duration = 420,
}: {
  children: ReactNode;
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let animId: number;
    const draw = (timestamp: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparksRef.current = sparksRef.current.filter((spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= duration) return false;

        const progress = elapsed / duration;
        const eased = progress * (2 - progress);
        const distance = eased * sparkRadius;
        const lineLength = sparkSize * (1 - eased);

        const x1 = spark.x + distance * Math.cos(spark.angle);
        const y1 = spark.y + distance * Math.sin(spark.angle);
        const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
        const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);

        ctx.strokeStyle = sparkColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        return true;
      });
      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animId);
    };
  }, [sparkColor, sparkSize, sparkRadius, duration]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const now = performance.now();
    const newSparks: Spark[] = Array.from({ length: sparkCount }, (_, i) => ({
      x: e.clientX,
      y: e.clientY,
      angle: (2 * Math.PI * i) / sparkCount,
      startTime: now,
    }));
    sparksRef.current.push(...newSparks);
  };

  return (
    <div onClick={handleClick} className="relative min-h-screen">
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-50"
      />
      {children}
    </div>
  );
}

/* ==========================================================================
   7. Inline Textured Cobalt 3D Sphere (HexaCore "Adaptive AI [●] Guard" Orb)
   ========================================================================== */
export function CobaltSphere3D({ className = "w-11 h-11 xl:w-13 xl:h-13" }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden select-none align-middle shadow-[0_0_30px_rgba(41,52,255,0.55)] ${className}`}
      style={{
        background:
          "radial-gradient(circle at 32% 28%, #6B78FF 0%, #2934FF 42%, #0F1580 78%, #050726 100%)",
      }}
    >
      {/* Internal neural surface texture */}
      <svg
        viewBox="0 0 64 64"
        className="w-full h-full opacity-55 mix-blend-screen animate-[spin_18s_linear_infinite]"
      >
        <defs>
          <radialGradient id="orbGlow" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#93A0FF" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#2934FF" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#070A3A" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#orbGlow)" />
        <ellipse
          cx="32"
          cy="32"
          rx="26"
          ry="11"
          fill="none"
          stroke="#8FA0FF"
          strokeWidth="1.2"
          strokeDasharray="3 4"
          transform="rotate(-28 32 32)"
        />
        <ellipse
          cx="32"
          cy="32"
          rx="24"
          ry="14"
          fill="none"
          stroke="#4F5EFF"
          strokeWidth="1.1"
          strokeDasharray="2 5"
          transform="rotate(38 32 32)"
        />
        <path
          d="M14 26 Q32 12 50 28 T18 44"
          fill="none"
          stroke="#B4BEFF"
          strokeWidth="1"
          strokeOpacity="0.6"
        />
      </svg>
      {/* Specular top-left highlight */}
      <span
        className="pointer-events-none absolute top-1.5 left-2 w-3.5 h-2 rounded-full bg-white/40 blur-[1.5px] -rotate-25"
      />
    </span>
  );
}
