"use client";

import React from "react";
import {
  ArrowLeftRight,
  Banknote,
  Coins,
  ExternalLink,
  Flame,
  Rocket,
  Terminal,
  Wallet,
} from "lucide-react";
import type { DevTxEntry, DevWalletHistory } from "@/lib/buildcheck/types";

interface DevHistoryPanelProps {
  devHistory: DevWalletHistory;
  symbol?: string | null;
}

const TX_BADGE: Record<
  DevTxEntry["action"],
  { icon: React.ReactNode; label: string; color: string }
> = {
  burn: {
    icon: <Flame className="w-3 h-3" />,
    label: "BURN",
    color: "text-amber-300 border-amber-500/35 bg-amber-500/15",
  },
  deploy: {
    icon: <Rocket className="w-3 h-3" />,
    label: "DEPLOY",
    color: "text-sky-300 border-sky-500/35 bg-sky-500/15",
  },
  claim: {
    icon: <Banknote className="w-3 h-3" />,
    label: "CLAIM FEE",
    color: "text-emerald-300 border-emerald-500/35 bg-emerald-500/12",
  },
  swap: {
    icon: <ArrowLeftRight className="w-3 h-3" />,
    label: "SWAP",
    color: "text-violet-300 border-violet-500/35 bg-violet-500/15",
  },
  transfer: {
    icon: <Coins className="w-3 h-3" />,
    label: "TRANSFER",
    color: "text-slate-300 border-white/15 bg-white/[0.05]",
  },
  other: {
    icon: <Terminal className="w-3 h-3" />,
    label: "PROGRAM",
    color: "text-slate-400 border-white/10 bg-white/[0.03]",
  },
};

export function DevHistoryPanel({ devHistory, symbol }: DevHistoryPanelProps) {
  if (!devHistory.devAddress) {
    return (
      <div className="py-8 text-center text-xs text-slate-400">
        No verified developer/creator address found on Metaplex PDA or launchpad metadata.
      </div>
    );
  }

  const burnCount = devHistory.recentTxs.filter((t) => !t.err && t.action === "burn").length;
  const claimCount = devHistory.recentTxs.filter((t) => !t.err && t.action === "claim").length;
  const deployCount = devHistory.recentTxs.filter((t) => !t.err && t.action === "deploy").length;

  return (
    <div className="space-y-5">
      {/* Dev Wallet Profile Strip */}
      <div className="rounded-xl border border-white/[0.08] bg-[#090B10] divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] grid grid-cols-1 sm:grid-cols-12">
        <div className="p-4 sm:col-span-6 space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Wallet className="w-3.5 h-3.5 text-[#84A7FF]" />
            <span>Creator / Dev Authority</span>
          </div>
          <div className="font-mono text-xs sm:text-sm text-white break-all">
            {devHistory.devAddress}
          </div>
          <a
            href={`https://solscan.io/account/${devHistory.devAddress}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[#84A7FF] hover:text-white transition-colors"
          >
            Inspect on Solscan <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="sm:col-span-6 grid grid-cols-3 divide-x divide-white/[0.06]">
          <div className="p-4 flex flex-col justify-center">
            <span className="text-[11px] text-slate-400">SOL Balance</span>
            <span className="mt-1 font-mono tabular-nums text-sm font-semibold text-white">
              {devHistory.solBalance !== null ? `${devHistory.solBalance} SOL` : "—"}
            </span>
          </div>
          <div className="p-4 flex flex-col justify-center">
            <span className="text-[11px] text-slate-400">
              Held {symbol ? symbol.slice(0, 6) : "Token"}
            </span>
            <span
              className={`mt-1 font-mono tabular-nums text-sm font-semibold ${
                devHistory.tokenHoldingPct >= 5 ? "text-rose-400" : "text-emerald-300"
              }`}
            >
              {devHistory.tokenHoldingPct}%
            </span>
          </div>
          <div className="p-4 flex flex-col justify-center">
            <span className="text-[11px] text-slate-400">Launches</span>
            <span className="mt-1 font-mono tabular-nums text-sm font-semibold text-white">
              {devHistory.coinsLaunchedCount}
            </span>
          </div>
        </div>
      </div>

      {/* Launched Coins + Activity Breakdown */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">Creator tokens:</span>
          {devHistory.launchedTokens.map((tok) => (
            <a
              key={tok.mint}
              href={`https://solscan.io/token/${tok.mint}`}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 rounded-md border border-white/[0.08] bg-[#090B10] hover:border-[#2934FF]/60 font-mono text-xs text-slate-200 inline-flex items-center gap-1.5 transition-colors"
            >
              <span>{tok.symbol || tok.name || `${tok.mint.slice(0, 6)}...`}</span>
              <ExternalLink className="w-3 h-3 text-slate-500" />
            </a>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
          {burnCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-amber-500/12 border border-amber-500/30 text-amber-300">
              {burnCount} Burn{burnCount > 1 ? "s" : ""}
            </span>
          )}
          {deployCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-sky-500/12 border border-sky-500/30 text-sky-300">
              {deployCount} Deploy
            </span>
          )}
          {claimCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/12 border border-emerald-500/30 text-emerald-300">
              {claimCount} Fee Claim{claimCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Clean Hairline On-Chain Dev Transaction Feed */}
      <div className="rounded-xl border border-white/[0.08] bg-[#090B10] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between text-xs">
          <span className="font-medium text-slate-200">
            Recent Dev On-Chain Transactions
          </span>
          <span className="font-mono tabular-nums text-[11px] text-slate-500">
            {devHistory.recentTxs.length} sampled
          </span>
        </div>

        {devHistory.recentTxs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No recent transactions returned by RPC for this creator address.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06] max-h-[420px] overflow-y-auto">
            {devHistory.recentTxs.map((tx) => {
              const badge = TX_BADGE[tx.action];
              const ts = tx.blockTime
                ? new Date(tx.blockTime * 1000).toLocaleString()
                : `Slot ${tx.slot}`;
              return (
                <div
                  key={tx.signature}
                  className="px-4 py-3 hover:bg-white/[0.02] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono text-[10px] shrink-0 ${badge.color}`}
                    >
                      {badge.icon}
                      {badge.label}
                    </span>
                    <span className="text-slate-200 truncate">{tx.summary}</span>
                    {tx.err && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 font-mono text-[10px] text-rose-300 shrink-0">
                        FAILED
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                    <span>{ts}</span>
                    <a
                      href={`https://solscan.io/tx/${tx.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#84A7FF] hover:text-white transition-colors"
                    >
                      {tx.signature.slice(0, 8)}...
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
