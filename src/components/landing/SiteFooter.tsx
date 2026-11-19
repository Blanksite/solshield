"use client";

import React from "react";
import Link from "next/link";
import { ArrowUp, ArrowUpRight, Key, Shield } from "lucide-react";
import FooterWordmark from "@/components/FooterWordmark";

export interface SiteFooterProps {
  lang: "en" | "id";
  darkMode: boolean;
  liveSlot: number | null;
  onOpenKeyModal: () => void;
  solscanUrl: string;
  xUrl: string;
  xHandle: string;
}

function VeniceMark({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.295 16.074a4.239 4.239 0 00-1.37-.685 4.255 4.255 0 00-1.636-.138 4.27 4.27 0 00-1.566.499c-.472.26-.875.602-1.19.973-.315.37-.59.824-.773 1.336a4.432 4.432 0 00-.257 1.644c.02.564.155 1.125.375 1.621s.528.93.87 1.275c.34.346.766.657 1.256.881.49.224 1.041.36 1.598.381a4.258 4.258 0 001.62-.26 4.25 4.25 0 001.318-.786c.365-.319.703-.728.959-1.206.256-.479.43-1.027.492-1.589a4.436 4.436 0 00-.137-1.659 4.346 4.346 0 00-.675-1.39l.95-.964.691.702h.393l.475-.481v-.399l-.692-.702L12 14.11l1.004 1.018-.691.702v.399l.474.48h.393l.691-.701.95.964a4.346 4.346 0 00-.675 1.39 4.435 4.435 0 00-.137 1.66c.062.56.236 1.11.492 1.588s.594.887.96 1.206c.364.32.812.599 1.316.785a4.258 4.258 0 001.621.261 4.262 4.262 0 001.598-.38c.49-.225.916-.536 1.257-.882.341-.346.648-.779.869-1.275.22-.496.355-1.057.375-1.62a4.433 4.433 0 00-.257-1.645 4.338 4.338 0 00-.774-1.336 4.272 4.272 0 00-1.189-.973 4.27 4.27 0 00-1.566-.5 4.255 4.255 0 00-1.635.14 4.239 4.239 0 00-1.37.684l-.933-.947.69-.702v-.398l-.49-.498h-.393l-.692.701-1.004-1.018L18.15 7.87l2.132 2.163v-2.25H22.5L20.368 5.62 22.5 3.457V3.06l-.491-.498h-.393L12 12.316 2.384 2.56H1.99l-.491.498v.398L3.632 5.62 1.5 7.782h2.218v2.25L5.85 7.87l5.266 5.342-1.004 1.018-.692-.701h-.393l-.49.498v.399l.69.7-.932.948zm8.546 4.95a1.59 1.59 0 00.107 1.49c.256.43.799.73 1.294.716.494.014 1.037-.287 1.293-.716a1.59 1.59 0 00.108-1.49l.054-.06a1.53 1.53 0 001.471-.107c.424-.26.72-.81.707-1.313.014-.502-.283-1.053-.707-1.313a1.53 1.53 0 00-1.471-.107l-.054-.059a1.59 1.59 0 00-.108-1.49c-.256-.43-.799-.73-1.293-.717-.495-.013-1.038.287-1.294.716a1.59 1.59 0 00-.107 1.491l-.054.059a1.53 1.53 0 00-1.472.107c-.424.26-.72.81-.707 1.313-.013.502.283 1.053.707 1.313a1.53 1.53 0 001.472.107l.054.06zm-9.79 1.49a1.59 1.59 0 00.108-1.49l.054-.06a1.53 1.53 0 001.471-.107c.424-.26.72-.81.707-1.313.014-.502-.283-1.053-.707-1.313a1.53 1.53 0 00-1.47-.107l-.055-.059a1.59 1.59 0 00-.107-1.49c-.257-.43-.8-.73-1.294-.717-.495-.013-1.037.287-1.294.716a1.59 1.59 0 00-.107 1.491l-.054.059a1.53 1.53 0 00-1.471.107c-.424.26-.72.81-.707 1.313-.014.502.283 1.053.707 1.313a1.53 1.53 0 001.471.107l.054.06a1.59 1.59 0 00.107 1.49c.257.43.8.73 1.294.716.495.014 1.037-.287 1.294-.716z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.274 2.56L14.8 0l1.25 1.268v4.274l-3.462 3.512h-.625L8.5 5.542V1.268L9.75 0l2.524 2.56zM9.75.898l2.212 2.243v4.12L9.75 5.018V.897zm2.837 2.243L14.799.897v4.12l-2.212 2.244V3.14z"
      />
    </svg>
  );
}

export default function SiteFooter({
  lang,
  darkMode,
  liveSlot,
  onOpenKeyModal,
  solscanUrl,
  xUrl,
  xHandle,
}: SiteFooterProps) {
  const borderClass = darkMode ? "border-white/10" : "border-black/10";
  const mutedText = darkMode ? "text-[#8E98AD]" : "text-[#575653]";
  const linkClass = darkMode
    ? "text-[#9CA5B8] hover:text-white transition-colors"
    : "text-[#4D4C49] hover:text-[#2934FF] transition-colors";
  const pillClass = darkMode
    ? "border-white/15 bg-white/[0.03] text-[#D7DCE8] hover:border-[#2934FF] hover:text-white"
    : "border-black/15 bg-white text-[#1D1D1B] hover:border-[#2934FF] hover:text-[#2934FF]";

  const scrollToTop = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer
      aria-label="SolShield Site Footer"
      className={`w-full border-t transition-colors ${
        darkMode
          ? "bg-[#05070C] text-[#F4F6FA] border-white/10"
          : "bg-[#F4F3EF] text-[#141413] border-black/10"
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 xl:px-12">
        {/* Band 1: Clean Minimal Brand + Social & Utility Bar */}
        <div className="py-8 sm:py-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          {/* Left: Brand Identity + Concise Tagline */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <a
                href="#top"
                onClick={scrollToTop}
                className="inline-flex items-center gap-2.5 group focus:outline-none"
              >
                <span className="relative inline-flex shrink-0">
                  <img
                    src="/logo.jpg"
                    alt="SolShield Logo"
                    className={`w-8 h-8 rounded-lg object-cover border transition-transform group-hover:scale-105 ${
                      darkMode ? "border-white/20" : "border-black/15"
                    }`}
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ${
                      darkMode ? "ring-[#05070C]" : "ring-[#F4F3EF]"
                    }`}
                  />
                </span>
                <span className="text-[19px] font-semibold tracking-[-0.03em]">
                  SolShield
                  <sup className="text-[10px] font-normal ml-0.5 opacity-65">
                    ®
                  </sup>
                </span>
              </a>

              <a
                href="https://github.com/veniceai/builtinvenice/pull/194"
                target="_blank"
                rel="noreferrer"
                title="Official Built in Venice Directory"
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[10.5px] font-mono uppercase tracking-[0.08em] transition-colors whitespace-nowrap ${
                  darkMode
                    ? "bg-white/[0.04] border-white/15 text-white/80 hover:border-[#E05A2D]/70 hover:text-white"
                    : "bg-white border-black/15 text-[#262624] hover:border-[#E05A2D]/70"
                }`}
              >
                <VeniceMark className="w-3.5 h-3.5 text-[#E05A2D] shrink-0" />
                <span>
                  Built in{" "}
                  <span className="text-[#E05A2D] font-semibold">Venice</span>
                </span>
              </a>
            </div>

            <p className={`text-[13px] leading-relaxed ${mutedText}`}>
              {lang === "en"
                ? "Pre-sign transaction firewall, developer forensics & autonomous MCP security guard across Solana and 7 EVM networks."
                : "Firewall transaksi pra-sign, forensik developer & guard keamanan MCP otonom untuk Solana dan 7 jaringan EVM."}
            </p>
          </div>

          {/* Right: Uniform Social & Live Utility Pills */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span
              title="Live Solana RPC Telemetry"
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[11px] font-mono font-medium uppercase tracking-[0.06em] whitespace-nowrap ${
                darkMode
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-emerald-600/30 bg-emerald-500/10 text-emerald-700"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span>
                {liveSlot !== null
                  ? `SLOT #${liveSlot.toLocaleString("en-US")}`
                  : "RPC SYNC"}
              </span>
            </span>

            <a
              href={xUrl}
              target="_blank"
              rel="noreferrer"
              title={`X (${xHandle})`}
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg border text-[11.5px] font-medium transition-colors whitespace-nowrap ${pillClass}`}
            >
              <span>X</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
            </a>

            <a
              href="https://t.me/UseSolShieldBot"
              target="_blank"
              rel="noreferrer"
              title="SolShield Telegram Bot"
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg border text-[11.5px] font-medium transition-colors whitespace-nowrap ${pillClass}`}
            >
              <span>Telegram</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
            </a>

            <a
              href="https://github.com/Blanksite/solshield"
              target="_blank"
              rel="noreferrer"
              title="Open-Source Repository"
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg border text-[11.5px] font-medium transition-colors whitespace-nowrap ${pillClass}`}
            >
              <span>GitHub</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
            </a>

            <button
              type="button"
              onClick={onOpenKeyModal}
              title="Configure Venice AI Zero-Retention Key"
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${pillClass}`}
            >
              <Key className="w-3.5 h-3.5 text-[#2934FF] shrink-0" />
              <span>BYOK Key</span>
            </button>

            <button
              type="button"
              onClick={scrollToTop}
              title="Back to Top"
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg border text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${pillClass}`}
            >
              <span>{lang === "en" ? "Top" : "Atas"}</span>
              <ArrowUp className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>

        {/* Band 2: Clean Legal, Verification & Non-Custodial Guarantee Strip */}
        <div
          className={`py-4 border-t ${borderClass} flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[12px] ${mutedText}`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span>© 2026 SolShield® Protocol</span>
            <span className="opacity-35">·</span>
            <span>MIT License</span>
            <span className="opacity-35">·</span>
            <Link href="/privacy" className={linkClass}>
              {lang === "en" ? "Privacy Policy" : "Kebijakan Privasi"}
            </Link>
            <span className="opacity-35">·</span>
            <a
              href={solscanUrl || "https://solscan.io"}
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              Solscan
            </a>
            <span className="opacity-35">·</span>
            <a
              href="https://github.com/Blanksite/solshield/blob/main/programs/solshield-policy/src/lib.rs"
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              Anchor Policy PDA
            </a>
          </div>

          <div className="inline-flex items-center gap-2 text-[11.5px] font-mono tracking-[0.03em]">
            <Shield className="w-3.5 h-3.5 text-[#2934FF] shrink-0" />
            <span>
              {lang === "en"
                ? "Non-Custodial · Zero-Retention Venice AI · Verify Before Signing"
                : "Non-Kustodian · Venice AI Zero-Retention · Verifikasi Sebelum Sign"}
            </span>
          </div>
        </div>

        {/* Band 3: Preserved Signature Editorial Giant Bayer-Dithered Wordmark */}
        <div className={`pt-9 sm:pt-12 pb-8 sm:pb-10 border-t ${borderClass}`}>
          <div
            className={`flex items-end justify-between gap-4 mb-4 sm:mb-5 text-[11.5px] font-mono uppercase tracking-[0.12em] ${mutedText}`}
          >
            <span>
              <span className="text-[#2934FF]">●</span> Multi-Chain Security
              Protocol — Est. 2026
            </span>
            <span className="hidden sm:inline">
              {lang === "en"
                ? "Verify before you sign ↘"
                : "Verifikasi sebelum sign ↘"}
            </span>
          </div>
          <FooterWordmark
            inkColor={darkMode ? "#E2E4E8" : "#0A0A0C"}
            rimColor="#2934FF"
            cellSize={2}
            className="cursor-crosshair"
          />
        </div>
      </div>
    </footer>
  );
}
