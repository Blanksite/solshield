"use client";

import React from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Flame,
  ExternalLink,
  Layers,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Zap,
} from "lucide-react";
import type { RobinhoodVerificationReport } from "@/lib/buildcheck/types";

interface RobinhoodAuditCardProps {
  robinhood: RobinhoodVerificationReport | null | undefined;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  address?: string | null;
}

export function RobinhoodAuditCard({
  robinhood,
  tokenSymbol,
  tokenName,
  address,
}: RobinhoodAuditCardProps) {
  if (!robinhood) {
    return (
      <div className="p-6 rounded-xl border border-white/[0.08] bg-[#0A0D14] text-center text-slate-400">
        <HelpCircle className="w-8 h-8 mx-auto text-slate-500 mb-2" />
        <p className="text-sm font-mono">No Robinhood forensics data available for this target.</p>
      </div>
    );
  }

  const isOfficial = robinhood.status === "OFFICIAL_LISTED";
  const isHoodChain = robinhood.status === "ROBINHOOD_CHAIN_NATIVE";
  const isImpostor = robinhood.status === "IMPOSTOR_ALERT";
  const isClone = robinhood.status === "TICKER_CLONE_WARNING";

  return (
    <div className="space-y-4">
      {/* Top Banner based on status */}
      {isImpostor && (
        <div
          data-testid="robinhood-impostor-alert"
          className="p-4 sm:p-5 rounded-xl border border-red-500/50 bg-gradient-to-r from-red-950/60 via-red-900/30 to-red-950/60 shadow-[0_0_30px_rgba(239,68,68,0.25)] relative overflow-hidden"
        >
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-lg bg-red-500/20 text-red-400 shrink-0 border border-red-500/30">
              <Flame className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-red-400 bg-red-500/20 px-2.5 py-0.5 rounded border border-red-500/40">
                  Critical Contradiction
                </span>
                <span className="text-xs font-mono text-red-300">
                  Impostor Risk: {robinhood.impostorRiskScore}/100
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Robinhood Impostor Scam Alert
              </h3>
              <p className="text-xs sm:text-sm text-red-200/90 leading-relaxed">
                {robinhood.warning ||
                  "This token exploits Robinhood branding or falsely claims official listing. Robinhood (NASDAQ: HOOD) has not deployed a meme token on DEXs."}
              </p>
            </div>
          </div>
        </div>
      )}

      {isClone && (
        <div
          data-testid="robinhood-clone-alert"
          className="p-4 sm:p-5 rounded-xl border border-amber-500/50 bg-gradient-to-r from-amber-950/50 via-amber-900/25 to-amber-950/50 shadow-[0_0_25px_rgba(245,158,11,0.2)]"
        >
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 border border-amber-500/30">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/20 px-2.5 py-0.5 rounded border border-amber-500/40">
                  Lookalike Warning
                </span>
                <span className="text-xs font-mono text-amber-300">
                  Risk Score: {robinhood.impostorRiskScore}/100
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Unverified Clone of Robinhood Asset (${tokenSymbol})
              </h3>
              <p className="text-xs sm:text-sm text-amber-200/90 leading-relaxed">
                {robinhood.warning}
              </p>
            </div>
          </div>
        </div>
      )}

      {isOfficial && (
        <div
          data-testid="robinhood-official-badge"
          className="p-4 sm:p-5 rounded-xl border border-emerald-500/45 bg-gradient-to-r from-emerald-950/50 via-emerald-900/20 to-emerald-950/50 shadow-[0_0_25px_rgba(16,185,129,0.2)]"
        >
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0 border border-emerald-500/30">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2.5 py-0.5 rounded border border-emerald-500/40">
                  Verified Official Asset
                </span>
                {robinhood.tradingPair && (
                  <span className="font-mono text-xs text-emerald-200 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                    Pair: {robinhood.tradingPair}
                  </span>
                )}
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Official Robinhood Crypto Listing
              </h3>
              <p className="text-xs sm:text-sm text-emerald-200/90 leading-relaxed">
                {robinhood.summary}
              </p>
            </div>
          </div>
        </div>
      )}

      {isHoodChain && (
        <div
          data-testid="robinhood-chain-badge"
          className="p-4 sm:p-5 rounded-xl border border-sky-500/45 bg-gradient-to-r from-sky-950/50 via-indigo-950/30 to-sky-950/50 shadow-[0_0_25px_rgba(56,189,248,0.2)]"
        >
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-lg bg-sky-500/20 text-sky-400 shrink-0 border border-sky-500/30">
              <Layers className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-sky-300 bg-sky-500/20 px-2.5 py-0.5 rounded border border-sky-500/40">
                  Robinhood Chain Native (L2)
                </span>
                <span className="font-mono text-xs text-sky-200 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-500/30">
                  Chain ID: 4663
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Robinhood Chain (Arbitrum Orbit L2)
              </h3>
              <p className="text-xs sm:text-sm text-sky-200/90 leading-relaxed">
                {robinhood.summary}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Spec Card */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0A0D14] overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-white/[0.08] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34D399]" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              Robinhood Telemetry & Listing Matrix
            </span>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            Chain: {robinhood.networkName || (robinhood.chainFamily === "evm" ? "EVM" : "Solana")}
          </span>
        </div>

        <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-3.5 rounded-lg bg-black/40 border border-white/[0.06] space-y-1">
            <span className="text-slate-400 block text-[11px]">Robinhood Listing Status</span>
            <span
              className={`font-bold text-sm block ${
                isOfficial
                  ? "text-emerald-400"
                  : isImpostor
                  ? "text-red-400"
                  : isClone
                  ? "text-amber-400"
                  : isHoodChain
                  ? "text-sky-400"
                  : "text-slate-300"
              }`}
            >
              {robinhood.status.replace(/_/g, " ")}
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-black/40 border border-white/[0.06] space-y-1">
            <span className="text-slate-400 block text-[11px]">Trading Pair on Robinhood</span>
            <span className="font-bold text-sm text-white block">
              {robinhood.tradingPair || "None (Not Tradable on RH)"}
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-black/40 border border-white/[0.06] space-y-1">
            <span className="text-slate-400 block text-[11px]">Asset Classification</span>
            <span className="text-slate-200 block capitalize">
              {robinhood.assetType.replace(/_/g, " ")}
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-black/40 border border-white/[0.06] space-y-1">
            <span className="text-slate-400 block text-[11px]">Robinhood Chain L2 Physical Contract</span>
            <span className="text-slate-200 block">
              {robinhood.isRobinhoodChain ? (
                <span className="text-sky-400 font-bold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Deployed (Chain ID 4663)
                </span>
              ) : (
                <span className="text-slate-400">Not on Robinhood Chain L2</span>
              )}
            </span>
          </div>
        </div>

        {/* Official vs Scanned Contract comparison if clone or impostor */}
        {(robinhood.officialContract || isImpostor) && (
          <div className="px-4 sm:px-6 py-3.5 bg-black/60 border-t border-white/[0.08] text-xs font-mono space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span>Contract Address Verification</span>
              <span className="text-[11px]">Strict Matching</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              <div className="p-2.5 rounded bg-white/[0.02] border border-white/[0.06] overflow-hidden">
                <span className="text-slate-500 block">Scanned Contract:</span>
                <span className="text-white break-all">{address || "N/A"}</span>
              </div>
              <div className="p-2.5 rounded bg-white/[0.02] border border-white/[0.06] overflow-hidden">
                <span className="text-slate-500 block">Official Robinhood Contract:</span>
                <span className="text-emerald-400 break-all">
                  {robinhood.officialContract || "No official contract exists (Robinhood meme token is a hoax)"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footer Links & Info */}
        <div className="px-4 sm:px-6 py-3 bg-[#07090E] border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-slate-500">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span>Robinhood Chain RPC: rpc.mainnet.chain.robinhood.com (Chain ID 4663)</span>
          </div>
          {robinhood.blockscoutUrl && (
            <a
              href={robinhood.blockscoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-white inline-flex items-center gap-1 transition-colors"
            >
              <span>Block Explorer</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
