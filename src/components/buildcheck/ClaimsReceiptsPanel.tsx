"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookmarkCheck,
  Check,
  CheckCircle2,
  Copy,
  Download,
  History,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import {
  diffClaimSnapshots,
  extractClaimsReceiptsLedger,
  type ClaimsReceiptsLedger,
} from "@/lib/buildcheck/claims-receipts";
import type { BuildCheckReport, ClaimStatus } from "@/lib/buildcheck/types";
import { downloadClaimsReceiptsCardPng } from "./autopsy-card-canvas";

interface ClaimsReceiptsPanelProps {
  report: BuildCheckReport;
  onMonitorProject?: () => void;
}

const STORAGE_PREFIX = "solshield_claims_baseline_v1_";

function makeBaselineKey(report: BuildCheckReport): string {
  const anchor =
    report.chain?.mintAddress ||
    report.target.contractAddress ||
    report.target.mintAddress ||
    report.github?.fullName ||
    report.domain?.registrableDomain ||
    report.id;
  return `${STORAGE_PREFIX}${anchor.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64)}`;
}

export function ClaimsReceiptsPanel({
  report,
  onMonitorProject,
}: ClaimsReceiptsPanelProps) {
  const [filter, setFilter] = useState<"ALL" | ClaimStatus>("ALL");
  const [copied, setCopied] = useState(false);
  const [baselineSaved, setBaselineSaved] = useState(false);
  const [savedBaseline, setSavedBaseline] = useState<ClaimsReceiptsLedger | null>(
    null
  );

  const ledger = useMemo(() => extractClaimsReceiptsLedger(report), [report]);
  const storageKey = useMemo(() => makeBaselineKey(report), [report]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as ClaimsReceiptsLedger;
        if (parsed && Array.isArray(parsed.items)) {
          setSavedBaseline(parsed);
        }
      } else {
        setSavedBaseline(null);
      }
    } catch {
      setSavedBaseline(null);
    }
  }, [storageKey]);

  const snapshotDiff = useMemo(() => {
    if (!savedBaseline) return null;
    if (savedBaseline.reportId === ledger.reportId) return null;
    return diffClaimSnapshots(savedBaseline, ledger);
  }, [savedBaseline, ledger]);

  const filteredItems = useMemo(() => {
    if (filter === "ALL") return ledger.items;
    return ledger.items.filter((i) => i.status === filter);
  }, [ledger.items, filter]);

  function handleSaveBaseline() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(ledger));
      setSavedBaseline(ledger);
      setBaselineSaved(true);
      setTimeout(() => setBaselineSaved(false), 2200);
    } catch {
      // Ignore storage error
    }
  }

  async function handleCopyForX() {
    try {
      await navigator.clipboard.writeText(ledger.shareTextForX);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  }

  return (
    <div data-testid="claims-receipts-panel" className="p-5 space-y-4">
      {/* Header + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-white">
            Claims vs Receipts Tracker
          </h3>
          <p className="text-xs text-slate-400">
            Audits founder promises &amp; landing-page claims against raw bytecode, Chromium DOM, and GitHub proof.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveBaseline}
            className="px-3 py-1.5 rounded-lg border border-sky-500/35 bg-sky-500/10 hover:bg-sky-500/18 text-xs font-medium text-sky-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {baselineSaved ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Baseline Saved</span>
              </>
            ) : (
              <>
                <BookmarkCheck className="w-3.5 h-3.5" />
                <span>{savedBaseline ? "Update Promise Baseline" : "Save Promise Baseline"}</span>
              </>
            )}
          </button>

          {onMonitorProject && (
            <button
              type="button"
              onClick={onMonitorProject}
              className="px-3 py-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/18 text-xs font-medium text-emerald-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>Track on Watchdog</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyForX}
            className="px-3 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy for X</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => downloadClaimsReceiptsCardPng(ledger)}
            className="px-3 py-1.5 rounded-lg bg-[#2934FF] hover:bg-[#3843FF] text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Receipts PNG</span>
          </button>
        </div>
      </div>

      {/* Re-Verify Diff Banner (if a prior baseline exists for this project) */}
      {snapshotDiff && (
        <div className="p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/8 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="space-y-0.5">
            <div className="font-semibold text-sky-200">
              Promise Baseline Diff Detected (vs {new Date(snapshotDiff.baselineCapturedAt).toLocaleDateString()})
            </div>
            <div className="text-slate-300">
              Score delta:{" "}
              <span
                className={`font-mono font-semibold ${
                  snapshotDiff.scoreDelta >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {snapshotDiff.scoreDelta >= 0 ? `+${snapshotDiff.scoreDelta}%` : `${snapshotDiff.scoreDelta}%`}
              </span>{" "}
              · Newly Verified: <span className="font-mono">{snapshotDiff.newlyVerified}</span> · Newly Contradicted:{" "}
              <span className="font-mono text-rose-300">{snapshotDiff.newlyContradicted}</span>
            </div>
          </div>
          {snapshotDiff.changes.length === 0 && (
            <span className="font-mono text-slate-400">No claim status drift</span>
          )}
        </div>
      )}

      {/* Scorecard Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="px-3.5 py-2.5 rounded-lg border border-white/[0.07] bg-[#090C14]">
          <div className="text-[11px] text-slate-400">Receipt Integrity</div>
          <div
            className={`text-xl font-mono font-bold tabular-nums ${
              ledger.receiptScorePct >= 75
                ? "text-emerald-400"
                : ledger.receiptScorePct >= 45
                  ? "text-amber-300"
                  : "text-rose-400"
            }`}
          >
            {ledger.receiptScorePct}%
          </div>
        </div>
        <div className="px-3.5 py-2.5 rounded-lg border border-white/[0.07] bg-[#090C14]">
          <div className="text-[11px] text-slate-400">Verified</div>
          <div className="text-xl font-mono font-bold tabular-nums text-emerald-300">
            {ledger.verifiedCount}
          </div>
        </div>
        <div className="px-3.5 py-2.5 rounded-lg border border-white/[0.07] bg-[#090C14]">
          <div className="text-[11px] text-slate-400">Contradicted</div>
          <div className="text-xl font-mono font-bold tabular-nums text-rose-400">
            {ledger.contradictedCount}
          </div>
        </div>
        <div className="px-3.5 py-2.5 rounded-lg border border-white/[0.07] bg-[#090C14]">
          <div className="text-[11px] text-slate-400">Unverified / Mixed</div>
          <div className="text-xl font-mono font-bold tabular-nums text-amber-300">
            {ledger.unverifiedCount + ledger.mixedCount}
          </div>
        </div>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: "ALL", label: `All (${ledger.items.length})` },
            { id: "CONTRADICTED", label: `Contradicted (${ledger.contradictedCount})` },
            { id: "UNVERIFIED", label: `Unverified (${ledger.unverifiedCount})` },
            { id: "VERIFIED", label: `Verified (${ledger.verifiedCount})` },
            { id: "MIXED", label: `Mixed (${ledger.mixedCount})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filter === tab.id
                ? "bg-[#2934FF] text-white"
                : "text-slate-400 hover:text-white bg-white/[0.03] border border-white/[0.07]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Clean Hairline Claims Ledger */}
      <div className="divide-y divide-white/[0.06] border-t border-b border-white/[0.06]">
        {filteredItems.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No claims in this filter bucket.
          </div>
        ) : (
          filteredItems.map((item) => {
            const badgeCls =
              item.status === "VERIFIED"
                ? "text-emerald-300 border-emerald-500/35 bg-emerald-500/10"
                : item.status === "CONTRADICTED"
                  ? "text-rose-300 border-rose-500/35 bg-rose-500/12"
                  : item.status === "MIXED"
                    ? "text-sky-300 border-sky-500/35 bg-sky-500/10"
                    : "text-amber-300 border-amber-500/35 bg-amber-500/10";
            const Icon =
              item.status === "VERIFIED"
                ? CheckCircle2
                : item.status === "CONTRADICTED"
                  ? ShieldAlert
                  : item.status === "MIXED"
                    ? AlertTriangle
                    : ShieldQuestion;

            return (
              <div
                key={item.id}
                className="py-3.5 hover:bg-white/[0.015] transition-colors flex flex-col gap-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border inline-flex items-center gap-1 shrink-0 ${badgeCls}`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{item.status}</span>
                    </span>
                    <span className="text-sm font-medium text-white">
                      {item.claim}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 shrink-0">
                    Source: {item.source}
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-300 leading-relaxed break-words">
                  {item.receipt}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
