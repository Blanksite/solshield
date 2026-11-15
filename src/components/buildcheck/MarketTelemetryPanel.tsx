"use client";

import React from "react";
import { History, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { DexPairSummary, TokenDeepMarketStats } from "@/lib/buildcheck/types";
import {
  computeMarketPulse,
  formatCompactUsd,
  formatRelativeTime,
  formatSignedPct,
} from "@/lib/buildcheck/war-room-metrics";
import type { ScannedTokenSummary } from "@/lib/scanned-token-types";

interface MarketTelemetryPanelProps {
  tokenMarket: TokenDeepMarketStats | null | undefined;
  dexPair?: DexPairSummary | null;
  directoryEntry?: ScannedTokenSummary | null;
  activeReportId?: string;
  onSelectReportId?: (reportId: string) => void;
}

export function MarketTelemetryPanel({
  tokenMarket,
  dexPair,
  directoryEntry,
  activeReportId,
  onSelectReportId,
}: MarketTelemetryPanelProps) {
  if (!tokenMarket && !directoryEntry) return null;

  const pulse = computeMarketPulse({
    market: tokenMarket,
    dexPair,
    firstPriceUsd: directoryEntry?.firstPriceUsd,
    firstMarketCapUsd: directoryEntry?.firstMarketCapUsd,
    firstSeenAt: directoryEntry?.firstSeenAt,
  });

  const pulseBadge =
    pulse.flowState === "BULLISH FLOW"
      ? {
          cls: "bg-emerald-500/12 text-emerald-300 border-emerald-500/35",
          Icon: TrendingUp,
        }
      : pulse.flowState === "SELL PRESSURE"
        ? {
            cls: "bg-rose-500/12 text-rose-300 border-rose-500/35",
            Icon: TrendingDown,
          }
        : {
            cls: "bg-white/[0.05] text-slate-300 border-white/15",
            Icon: Minus,
          };

  const PulseIcon = pulseBadge.Icon;
  const checkpoints = directoryEntry?.scoreHistory ?? [];

  return (
    <div
      data-testid="market-telemetry-panel"
      className="rounded-xl border border-white/[0.08] bg-[#0D1017] overflow-hidden divide-y divide-white/[0.06]"
    >
      {/* Header + Market Flow Status */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono uppercase tracking-[0.08em] text-slate-400">
            Market Telemetry
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border inline-flex items-center gap-1 ${pulseBadge.cls}`}
          >
            <PulseIcon className="w-3 h-3" />
            <span>{pulse.flowState}</span>
          </span>
        </div>

        {/* Delta vs First Audit Baseline */}
        {(pulse.pctSinceFirstAudit !== null || directoryEntry?.firstSeenAt) && (
          <div className="rounded-lg border border-white/[0.07] bg-[#090B10] px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-slate-300">
                Delta vs. 1st Audit
              </div>
              <div className="text-[10px] font-mono text-slate-500 truncate">
                {pulse.baselineLabel ||
                  (directoryEntry?.firstSeenAt
                    ? `First indexed ${formatRelativeTime(directoryEntry.firstSeenAt)}`
                    : "Baseline established now")}
              </div>
            </div>
            <div
              className={`font-mono tabular-nums text-sm font-bold shrink-0 ${
                pulse.pctSinceFirstAudit === null
                  ? "text-slate-400"
                  : pulse.pctSinceFirstAudit > 0
                    ? "text-emerald-400"
                    : pulse.pctSinceFirstAudit < 0
                      ? "text-rose-400"
                      : "text-slate-300"
              }`}
            >
              {pulse.pctSinceFirstAudit !== null
                ? formatSignedPct(pulse.pctSinceFirstAudit)
                : "Baseline"}
            </div>
          </div>
        )}

        {/* 5m / 1h / 6h / 24h Returns */}
        {tokenMarket && (
          <>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "5m", val: tokenMarket.priceChange5m },
                { label: "1h", val: tokenMarket.priceChange1h },
                { label: "6h", val: tokenMarket.priceChange6h },
                { label: "24h", val: tokenMarket.priceChange24h },
              ].map((w) => (
                <div
                  key={w.label}
                  className="rounded-lg bg-white/[0.03] border border-white/[0.06] py-1.5 px-1"
                >
                  <div className="text-[10px] font-mono uppercase text-slate-500">
                    {w.label}
                  </div>
                  <div
                    className={`text-xs font-mono tabular-nums font-semibold mt-0.5 ${
                      w.val === null
                        ? "text-slate-400"
                        : w.val >= 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                    }`}
                  >
                    {w.val !== null
                      ? `${w.val >= 0 ? "+" : ""}${w.val.toFixed(1)}%`
                      : "—"}
                  </div>
                </div>
              ))}
            </div>

            {pulse.buyRatioPct !== null && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-emerald-400 tabular-nums">
                    {pulse.buyRatioPct}% buys ({pulse.buyRatioWindow})
                  </span>
                  <span className="text-rose-400 tabular-nums">
                    {100 - pulse.buyRatioPct}% sells
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-rose-500/40 overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${pulse.buyRatioPct}%` }}
                  />
                </div>
              </div>
            )}

            {(tokenMarket.buys24h !== null || tokenMarket.sells24h !== null) && (
              <div className="flex items-center justify-between text-xs font-mono pt-1">
                <span className="text-slate-400">24h Order Count</span>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-emerald-400">
                    {tokenMarket.buys24h?.toLocaleString() ?? "0"} buys
                  </span>
                  <span className="text-rose-400">
                    {tokenMarket.sells24h?.toLocaleString() ?? "0"} sells
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Audit Checkpoint Timeline */}
      {checkpoints.length > 0 && (
        <div
          data-testid="audit-checkpoints-timeline"
          className="p-4 bg-[#0A0C12] space-y-2.5"
        >
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.08em] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-[#84A7FF]" />
              <span>Audit Checkpoints</span>
            </span>
            <span className="tabular-nums text-slate-500">
              {directoryEntry?.scanCount ?? checkpoints.length}{" "}
              {(directoryEntry?.scanCount ?? checkpoints.length) === 1
                ? "scan"
                : "scans"}
            </span>
          </div>

          <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.07] bg-[#090B10] overflow-hidden max-h-52 overflow-y-auto">
            {checkpoints.slice(0, 6).map((cp, idx) => {
              const isCurrent =
                Boolean(cp.reportId) && cp.reportId === activeReportId;
              const canLoad =
                Boolean(cp.reportId) && Boolean(onSelectReportId) && !isCurrent;

              return (
                <div
                  key={`${cp.scannedAt}-${cp.reportId || idx}`}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-[11px] font-mono"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <span className="tabular-nums">
                        {formatRelativeTime(cp.scannedAt)}
                      </span>
                      {cp.marketCapUsd ? (
                        <span className="text-slate-500 tabular-nums">
                          · MC {formatCompactUsd(cp.marketCapUsd)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 tabular-nums">
                      {typeof cp.buildScore === "number" && (
                        <span
                          className={
                            cp.buildScore >= 70
                              ? "text-emerald-400"
                              : cp.buildScore >= 42
                                ? "text-amber-300"
                                : "text-rose-400"
                          }
                        >
                          Build {cp.buildScore}/100
                        </span>
                      )}
                      <span>Risk {cp.riskScore}/100</span>
                    </div>
                  </div>

                  {isCurrent ? (
                    <span className="px-1.5 py-0.5 rounded bg-[#2934FF]/20 border border-[#2934FF]/40 text-[10px] text-[#93C5FD] shrink-0">
                      Viewing
                    </span>
                  ) : canLoad ? (
                    <button
                      type="button"
                      onClick={() => onSelectReportId?.(cp.reportId!)}
                      className="px-2 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[10px] text-slate-200 cursor-pointer shrink-0 transition-colors"
                    >
                      Open
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
