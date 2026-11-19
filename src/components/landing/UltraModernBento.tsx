"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Cpu,
  Eye,
  FileWarning,
  GitBranch,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";

export interface UltraModernBentoProps {
  lang: "en" | "id";
  darkMode: boolean;
  onOpenTxFirewall: () => void;
  onOpenIntent: () => void;
  onOpenVault: () => void;
}

export default function UltraModernBento({
  lang,
  darkMode,
  onOpenTxFirewall,
}: UltraModernBentoProps) {
  const cardBase = darkMode
    ? "bg-[#0A0D16] border-white/10 hover:border-[#2934FF]/50 text-[#F4F6FA]"
    : "bg-[#FFFFFF] border-black/10 hover:border-[#2934FF]/50 text-[#141413] shadow-[0_1px_3px_rgba(0,0,0,0.04)]";

  const innerSurface = darkMode
    ? "bg-[#0F1422] border-white/10"
    : "bg-[#F4F3EF] border-black/10";

  const mutedText = darkMode ? "text-[#8E98AD]" : "text-[#575653]";

  return (
    <section
      aria-label="SolShield Unified Security Suite"
      className={`w-full border-b transition-colors ${
        darkMode
          ? "bg-[#06080E] border-white/10 text-[#F4F6FA]"
          : "bg-[#FAF9F6] border-black/10 text-[#141413]"
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 xl:px-12 py-14 sm:py-20">
        {/* Top Editorial Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 sm:mb-10">
          <div>
            <div className="inline-flex items-center gap-2 text-[11.5px] font-mono uppercase tracking-[0.12em] text-[#2934FF] font-semibold mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2934FF]" />
              <span>
                {lang === "en"
                  ? "UNIFIED SECURITY ARCHITECTURE · 8 CHAINS"
                  : "ARSITEKTUR KEAMANAN TERPADU · 8 CHAIN"}
              </span>
            </div>
            <h2 className="text-[28px] sm:text-[36px] font-semibold tracking-[-0.035em] leading-[1.12]">
              {lang === "en"
                ? "Every attack surface. One engine."
                : "Setiap celah serangan. Satu mesin."}
            </h2>
          </div>

          <a
            href="https://github.com/veniceai/builtinvenice/pull/194"
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1.5 text-[13px] font-mono transition-colors shrink-0 ${
              darkMode
                ? "text-[#8E98AD] hover:text-white"
                : "text-[#575653] hover:text-[#0A0A0C]"
            }`}
          >
            <span>Built in Venice #194</span>
            <ArrowUpRight className="w-4 h-4 text-[#2934FF]" />
          </a>
        </div>

        {/* Asymmetric Top Row (7 / 5) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* LARGE LEFT BENTO: BuildCheck & Dev Forensics */}
          <div
            className={`lg:col-span-7 relative rounded-2xl border p-6 sm:p-7 overflow-hidden transition-colors flex flex-col justify-between ${cardBase}`}
          >
            {/* Subtle overhead cobalt specular glow */}
            {darkMode && (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2934FF]/60 to-transparent" />
                <div
                  className="pointer-events-none absolute -top-24 left-1/4 w-72 h-52 rounded-full opacity-20 blur-3xl"
                  style={{ background: "#2934FF" }}
                />
              </>
            )}

            <div className="relative z-10 flex flex-wrap items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.025em]">
                  BuildCheck &amp; Dev Forensics
                </h3>
                <p className={`text-[13.5px] mt-1 max-w-md ${mutedText}`}>
                  {lang === "en"
                    ? "Verify contracts, live websites, GitHub repos, Claims vs Receipts, deployer lineage, and 1-click Rug Autopsy."
                    : "Verifikasi kontrak, situs live, repo GitHub, bukti klaim, silsilah deployer, hingga Rug Autopsy 1-klik."}
                </p>
              </div>
              <Link
                href="/buildcheck"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2934FF] hover:bg-[#1E27E6] text-white text-[12.5px] font-medium transition-colors shrink-0"
              >
                <span>Open BuildCheck</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* Graphic Micro-UI Vignette: Arc Authenticity Gauge + Lineage Nodes + Receipt Pills */}
            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              {/* SVG Arc Gauge */}
              <div
                className={`sm:col-span-4 rounded-xl border p-4 flex flex-col items-center justify-center ${innerSurface}`}
              >
                <div className="relative w-32 h-24 flex items-center justify-center">
                  <svg
                    viewBox="0 0 140 96"
                    className="w-full h-full overflow-visible"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient
                        id="solshieldGaugeGrad"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#2934FF" />
                        <stop offset="65%" stopColor="#60A5FA" />
                        <stop offset="100%" stopColor="#10B981" />
                      </linearGradient>
                    </defs>
                    {/* Track */}
                    <path
                      d="M 16 82 A 56 56 0 1 1 124 82"
                      fill="none"
                      stroke={
                        darkMode
                          ? "rgba(255,255,255,0.1)"
                          : "rgba(10,10,12,0.1)"
                      }
                      strokeWidth="8"
                      strokeLinecap="round"
                    />
                    {/* Progress Arc (~92%) */}
                    <path
                      d="M 16 82 A 56 56 0 1 1 124 82"
                      fill="none"
                      stroke="url(#solshieldGaugeGrad)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray="248"
                      strokeDashoffset="22"
                    />
                  </svg>
                  <div className="absolute inset-x-0 bottom-1 text-center">
                    <div className="font-mono text-[24px] font-semibold tracking-tight leading-none">
                      92
                      <span className={`text-[13px] font-normal ${mutedText}`}>
                        /100
                      </span>
                    </div>
                    <span className="inline-block mt-1 text-[10px] font-mono font-semibold uppercase tracking-[0.12em] text-emerald-500">
                      VERIFIED
                    </span>
                  </div>
                </div>
              </div>

              {/* Lineage Flow + Receipt Bars */}
              <div className="sm:col-span-8 space-y-3">
                {/* Deployer -> Treasury -> LP Pool Node Graph */}
                <div
                  className={`rounded-xl border px-4 py-3.5 flex items-center justify-between gap-2 overflow-x-auto ${innerSurface}`}
                >
                  {[
                    { label: "Deployer", icon: GitBranch },
                    { label: "Treasury", icon: Wallet },
                    { label: "LP Pool", icon: ShieldCheck },
                  ].map((node, i) => {
                    const Icon = node.icon;
                    return (
                      <React.Fragment key={node.label}>
                        <div
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-mono whitespace-nowrap ${
                            darkMode
                              ? "bg-[#090C14] border-white/10 text-white/90"
                              : "bg-white border-black/10 text-[#141413]"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 text-[#2934FF]" />
                          <span>{node.label}</span>
                        </div>
                        {i < 2 && (
                          <ArrowRight className="w-3.5 h-3.5 opacity-40 shrink-0" />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Crisp Receipt Pills */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div
                    className={`rounded-xl border px-3.5 py-2.5 flex items-center gap-2 text-[12.5px] font-medium ${innerSurface}`}
                  >
                    <span className="w-1 h-4 rounded-full bg-emerald-500 shrink-0" />
                    <span className="truncate">Bytecode Verified</span>
                  </div>
                  <div
                    className={`rounded-xl border px-3.5 py-2.5 flex items-center gap-2 text-[12.5px] font-medium ${innerSurface}`}
                  >
                    <span className="w-1 h-4 rounded-full bg-emerald-500 shrink-0" />
                    <span className="truncate">LP 100% Locked</span>
                  </div>
                </div>

                {/* Deep-link shortcuts — single balanced horizontal row */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-0.5 text-[11.5px] font-mono">
                  <Link
                    href="/dev-lineage"
                    className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-[#2934FF] transition-colors ${mutedText}`}
                  >
                    <GitBranch className="w-3.5 h-3.5 shrink-0" />
                    <span>Dev Lineage</span>
                    <ArrowUpRight className="w-3 h-3 shrink-0" />
                  </Link>
                  <span className="opacity-25">·</span>
                  <Link
                    href="/autopsy"
                    className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-[#2934FF] transition-colors ${mutedText}`}
                  >
                    <FileWarning className="w-3.5 h-3.5 shrink-0" />
                    <span>Rug Autopsy</span>
                    <ArrowUpRight className="w-3 h-3 shrink-0" />
                  </Link>
                  <span className="opacity-25">·</span>
                  <button
                    type="button"
                    onClick={onOpenTxFirewall}
                    className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-[#2934FF] transition-colors cursor-pointer ${mutedText}`}
                  >
                    <span>Tx Sandbox</span>
                    <ArrowUpRight className="w-3 h-3 shrink-0" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT BENTO: SolShield MCP · AI Agent Bodyguard */}
          <Link
            href="/agent-firewall"
            className={`lg:col-span-5 relative rounded-2xl border p-6 sm:p-7 overflow-hidden transition-colors flex flex-col justify-between group ${cardBase}`}
          >
            {darkMode && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            )}

            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold mb-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>STREAMABLE HTTP · /API/MCP</span>
                </div>
                <h3 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.025em]">
                  SolShield MCP · Agent Bodyguard
                </h3>
                <p className={`text-[13.5px] mt-1 ${mutedText}`}>
                  {lang === "en"
                    ? "Read-only firewall guarding autonomous AI trading agents before signing — never trades, never holds keys."
                    : "Firewall read-only yang menjaga AI trading agent sebelum sign — tidak pernah trade atau pegang kunci."}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[12px] font-medium transition-colors shrink-0 ${
                  darkMode
                    ? "border-white/15 bg-white/[0.03] text-[#E4E7EE] group-hover:border-[#2934FF] group-hover:text-white"
                    : "border-black/15 bg-[#FAF9F6] text-[#141413] group-hover:border-[#2934FF] group-hover:text-[#2934FF]"
                }`}
              >
                <span>Open MCP</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-75 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </span>
            </div>

            {/* Intercepted Tool Call Micro-UI */}
            <div className={`rounded-xl border p-4 space-y-3 ${innerSurface}`}>
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className={mutedText}>Intercepted Tool Call</span>
                <span className="text-emerald-500">Read-Only</span>
              </div>

              <div className="space-y-2.5">
                <div
                  className={`rounded-lg border px-3 py-2 font-mono text-[12px] flex items-center justify-between gap-2 ${
                    darkMode
                      ? "bg-[#070910] border-white/10 text-white/90"
                      : "bg-white border-black/10 text-[#141413]"
                  }`}
                >
                  <span>solshield_guard_trade()</span>
                  <ArrowRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                </div>
                <div
                  className={`rounded-lg border px-3.5 py-2.5 flex items-center justify-between gap-3 ${
                    darkMode
                      ? "bg-rose-500/10 border-rose-500/40 text-rose-300"
                      : "bg-red-50 border-red-300 text-red-800"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
                    <div className="leading-tight min-w-0">
                      <div className="text-[12px] font-mono font-semibold">
                        BLOCK · 100/100
                      </div>
                      <div className="text-[11px] opacity-85 truncate">
                        Prompt Injection + Typosquat Phishing Caught
                      </div>
                    </div>
                  </div>
                  <span className="text-[10.5px] font-mono opacity-75 shrink-0">
                    142ms
                  </span>
                </div>
              </div>

              <div
                className={`flex items-center justify-between pt-2 border-t text-[11px] font-mono ${
                  darkMode
                    ? "border-white/10 text-[#8E98AD]"
                    : "border-black/10 text-[#575653]"
                }`}
              >
                <span>Claude · OpenClaw · Cursor</span>
                <span className="text-[#2934FF] font-medium">
                  6 MCP Tools ↗
                </span>
              </div>
            </div>
          </Link>
        </div>

        {/* Bottom 3-Tile Micro-Visual Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {/* Tile 1: Wallet Detox */}
          <Link
            href="/wallet-detox"
            className={`rounded-2xl border p-5 flex items-center justify-between gap-4 transition-colors group ${cardBase}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[#2934FF] shrink-0" />
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] truncate">
                  Wallet Detox
                </h3>
              </div>
              <p className={`text-[12.5px] mt-1 truncate ${mutedText}`}>
                {lang === "en"
                  ? "SPL & EVM/Permit2 Revoker"
                  : "Pencabut Approval SPL & EVM"}
              </p>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full border text-[11px] font-mono font-medium whitespace-nowrap shrink-0 ${
                darkMode
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              Revoke Risky →
            </span>
          </Link>

          {/* Tile 2: Proof-of-Ship Watchdog */}
          <Link
            href="/watchdog"
            className={`rounded-2xl border p-5 flex items-center justify-between gap-4 transition-colors group ${cardBase}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-[#2934FF] shrink-0" />
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] truncate">
                  Proof-of-Ship Watchdog
                </h3>
              </div>
              <p className={`text-[12.5px] mt-1 truncate ${mutedText}`}>
                On-Chain · Web · GitHub Alerts
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
            </div>
          </Link>

          {/* Tile 3: Wallets to Watch */}
          <Link
            href="/wallets"
            className={`rounded-2xl border p-5 flex items-center justify-between gap-4 transition-colors group ${cardBase}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#2934FF] shrink-0" />
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] truncate">
                  Wallets to Watch
                </h3>
              </div>
              <p className={`text-[12.5px] mt-1 truncate ${mutedText}`}>
                Early Buyers &amp; MM Radar
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono font-medium whitespace-nowrap shrink-0 ${
                darkMode
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live Radar</span>
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
