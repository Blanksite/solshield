"use client";

import React, { useMemo, useState } from "react";
import { Coins, RefreshCw, Search } from "lucide-react";
import {
  classifyLedgerTier,
  computePctDelta,
  filterAndSortScannedTokens,
  formatCompactUsd,
  formatRelativeTime,
  formatSignedPct,
  type AuditLedgerFilter,
} from "@/lib/buildcheck/war-room-metrics";
import type { ScannedTokenSummary } from "@/lib/scanned-token-types";

interface AuditLedgerSectionProps {
  tokens: ScannedTokenSummary[];
  onOpenPermalink: (reportId: string) => void;
  onRunAudit: (mintAddress: string) => void;
  onRefresh: () => void;
  onClearLocal: () => void;
}

const FILTER_TABS: Array<{ id: AuditLedgerFilter; label: string }> = [
  { id: "all", label: "All Audits" },
  { id: "verified", label: "Verified Builds" },
  { id: "watchlist", label: "Watchlist" },
  { id: "critical", label: "Critical Risk" },
];

export function AuditLedgerSection({
  tokens,
  onOpenPermalink,
  onRunAudit,
  onRefresh,
  onClearLocal,
}: AuditLedgerSectionProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AuditLedgerFilter>("all");

  const counts = useMemo(() => {
    const out = { all: tokens.length, verified: 0, watchlist: 0, critical: 0 };
    for (const tok of tokens) {
      out[classifyLedgerTier(tok)] += 1;
    }
    return out;
  }, [tokens]);

  const filteredTokens = useMemo(
    () => filterAndSortScannedTokens(tokens, { query, filter }),
    [tokens, query, filter]
  );

  return (
    <section
      data-testid="verified-audit-ledger"
      className="rounded-xl border border-white/[0.08] bg-[#0D1017] p-5 space-y-4 rb-fade-up"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.08em] text-[#93C5FD]">
            <Coins className="w-3.5 h-3.5" />
            <span>Verified Audit Ledger ({tokens.length})</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Live index of genuine Solana audits synced across web, X bot, and Telegram.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRefresh}
            className="text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onClearLocal}
            className="text-[11px] font-mono text-slate-500 hover:text-slate-300 cursor-pointer transition-colors"
          >
            Clear Local
          </button>
        </div>
      </div>

      {/* Filter Tabs + Live Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors cursor-pointer border inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-[#2934FF]/20 border-[#2934FF]/50 text-white"
                    : "bg-[#090B10] border-white/[0.07] text-slate-400 hover:text-slate-200 hover:border-white/15"
                }`}
              >
                <span>{tab.label}</span>
                <span className="tabular-nums text-[10px] text-slate-500">
                  {counts[tab.id]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by ticker, project, or mint..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#090B10] border border-white/[0.08] focus:border-[#2934FF]/60 outline-none text-xs text-slate-200 placeholder:text-slate-600 font-mono"
          />
        </div>
      </div>

      {filteredTokens.length === 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-[#090B10] px-4 py-6 text-center text-xs font-mono text-slate-500">
          No audited tokens match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filteredTokens.slice(0, 18).map((tok) => {
            const tier = classifyLedgerTier(tok);
            const tierBadgeCls =
              tier === "verified"
                ? "bg-emerald-500/12 text-emerald-300 border-emerald-500/35"
                : tier === "watchlist"
                  ? "bg-amber-500/12 text-amber-300 border-amber-500/35"
                  : "bg-rose-500/12 text-rose-300 border-rose-500/35";

            const deltaPct =
              computePctDelta(tok.priceUsd, tok.firstPriceUsd) ??
              computePctDelta(tok.marketCapUsd, tok.firstMarketCapUsd);

            return (
              <div
                key={tok.mintAddress}
                className="group rounded-lg border border-white/[0.08] bg-[#090B10] hover:border-[#2934FF]/45 transition-all flex flex-col justify-between"
              >
                <button
                  type="button"
                  onClick={() =>
                    tok.buildCheckId
                      ? onOpenPermalink(tok.buildCheckId)
                      : onRunAudit(tok.mintAddress)
                  }
                  className="text-left p-3 space-y-2 cursor-pointer flex-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-white truncate">
                          {tok.symbol || tok.name || tok.mintAddress.slice(0, 6)}
                        </span>
                        {tok.verifiedIssuer && (
                          <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-[9px] font-mono text-slate-300 truncate max-w-[90px]">
                            {tok.verifiedIssuer}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {tok.name || "Solana Token"}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {typeof tok.buildScore === "number" ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums border ${tierBadgeCls}`}
                        >
                          Build {tok.buildScore}
                        </span>
                      ) : (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums border ${tierBadgeCls}`}
                        >
                          Risk {tok.riskScore}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                    <span>
                      MC {formatCompactUsd(tok.marketCapUsd)}
                    </span>
                    <span
                      className={
                        deltaPct === null
                          ? "text-slate-500"
                          : deltaPct > 0
                            ? "text-emerald-400"
                            : deltaPct < 0
                              ? "text-rose-400"
                              : "text-slate-300"
                      }
                    >
                      {deltaPct !== null ? `${formatSignedPct(deltaPct)} vs 1st` : tok.classification}
                    </span>
                  </div>
                </button>

                <div className="px-3 py-1.5 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[10px] font-mono text-slate-500">
                  <span className="truncate tabular-nums">
                    {tok.mintAddress.slice(0, 5)}…{tok.mintAddress.slice(-4)} ·{" "}
                    {tok.scanCount}x · {formatRelativeTime(tok.scannedAt)}
                  </span>
                  <button
                    type="button"
                    title="Re-run fresh live audit"
                    onClick={() => onRunAudit(tok.mintAddress)}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-white cursor-pointer shrink-0 transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>Live</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
