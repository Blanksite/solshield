"use client";

import React from "react";
import Link from "next/link";
import { Download, Shield } from "lucide-react";

export interface ArchitecturalProofStripProps {
  lang: "en" | "id";
  darkMode: boolean;
}

export default function ArchitecturalProofStrip({
  lang,
  darkMode,
}: ArchitecturalProofStripProps) {
  const mutedText = darkMode ? "text-[#8E98AD]" : "text-[#575653]";

  return (
    <section
      id="browser-guard"
      aria-label="Protocol Proof Metrics and Browser Guard"
      className={`w-full border-t transition-colors ${
        darkMode
          ? "bg-[#06080E] border-white/10 text-[#F4F6FA]"
          : "bg-[#FAF9F6] border-black/10 text-[#141413]"
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 xl:px-12 py-12 sm:py-16 space-y-8">
        {/* Sculptural 4-Column Metric Strip */}
        <div
          className={`grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x rounded-2xl border ${
            darkMode
              ? "bg-[#0A0D16] border-white/10 divide-white/10"
              : "bg-white border-black/10 divide-black/10"
          }`}
        >
          <div className="p-6">
            <div className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.035em] leading-none">
              8 Chains
            </div>
            <div className={`text-[12.5px] font-mono mt-2 ${mutedText}`}>
              Solana + 7 EVM Networks
            </div>
          </div>

          <div className="p-6">
            <div className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.035em] leading-none">
              &lt;400ms
            </div>
            <div className={`text-[12.5px] font-mono mt-2 ${mutedText}`}>
              Pre-Sign Guard Latency
            </div>
          </div>

          <div className="p-6">
            <div className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.035em] leading-none">
              0 Bytes
            </div>
            <div className={`text-[12.5px] font-mono mt-2 ${mutedText}`}>
              Venice AI Zero-Retention
            </div>
          </div>

          <div className="p-6">
            <div className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.035em] leading-none">
              4 Channels
            </div>
            <div
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-mono mt-2 ${mutedText}`}
            >
              <Link href="/buildcheck" className="hover:text-[#2934FF] transition-colors">
                Web
              </Link>
              <span className="opacity-35">·</span>
              <a
                href="https://x.com/usesolshield"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#2934FF] transition-colors"
              >
                X Bot
              </a>
              <span className="opacity-35">·</span>
              <a
                href="https://t.me/UseSolShieldBot"
                target="_blank"
                rel="noreferrer"
                className="hover:text-[#2934FF] transition-colors"
              >
                Telegram
              </a>
              <span className="opacity-35">·</span>
              <Link href="/agent-firewall" className="hover:text-[#2934FF] transition-colors">
                MCP
              </Link>
            </div>
          </div>
        </div>

        {/* Machined-Glass Chrome MV3 Browser Guard Banner */}
        <div
          className={`relative rounded-2xl border p-6 sm:p-7 overflow-hidden flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 ${
            darkMode
              ? "bg-[#0B0E17] border-white/15"
              : "bg-white border-black/15"
          }`}
        >
          {darkMode && (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2934FF]/60 to-transparent" />
          )}

          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-[11.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                {lang === "en"
                  ? "CHROME MV3 EXTENSION BETA · v0.3.0"
                  : "EKSTENSI CHROME MV3 BETA · v0.3.0"}
              </span>
            </div>
            <h3 className="text-[22px] sm:text-[26px] font-semibold tracking-[-0.03em] leading-tight">
              {lang === "en"
                ? "SolShield Browser Guard — Pre-Sign Firewall Before Phantom Pops Up."
                : "SolShield Browser Guard — Firewall Pra-Sign Sebelum Popup Phantom."}
            </h3>
            <p className={`text-[14px] leading-relaxed ${mutedText}`}>
              {lang === "en"
                ? "Intercepts Legacy & Wallet Standard sign requests via isolated MessageChannel + Shadow DOM modal with zero transaction mutation."
                : "Mencegat permintaan sign Legacy & Wallet Standard lewat MessageChannel terisolasi + Shadow DOM tanpa mengubah objek transaksi."}
            </p>
            <div className="pt-1 flex flex-wrap gap-2 text-[11.5px] font-mono">
              {[
                "1. Unzip package",
                "2. chrome://extensions → Developer mode",
                "3. Load unpacked dist/",
              ].map((step) => (
                <span
                  key={step}
                  className={`px-2.5 py-1 rounded-lg border ${
                    darkMode
                      ? "border-white/10 bg-white/[0.03] text-[#A8B0BC]"
                      : "border-black/10 bg-black/[0.03] text-[#47474F]"
                  }`}
                >
                  {step}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <a
              href="/downloads/solshield-browser-guard-v0.3.0.zip"
              download
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#2934FF] hover:bg-[#1E27E6] text-white text-[13px] font-semibold tracking-[-0.01em] transition-colors shadow-[0_8px_24px_rgba(41,52,255,0.3)] whitespace-nowrap"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>
                {lang === "en"
                  ? "Download Chrome MV3 (.ZIP)"
                  : "Unduh Ekstensi MV3 (.ZIP)"}
              </span>
            </a>

            <Link
              href="/privacy"
              className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-[13px] font-medium transition-colors whitespace-nowrap ${
                darkMode
                  ? "border-white/15 hover:border-[#2934FF] text-[#E4E7EE]"
                  : "border-black/15 hover:border-[#2934FF] text-[#141413]"
              }`}
            >
              <Shield className="w-4 h-4 text-[#2934FF] shrink-0" />
              <span>{lang === "en" ? "Privacy Policy" : "Kebijakan Privasi"}</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
