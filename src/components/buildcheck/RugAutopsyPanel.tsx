"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileWarning,
  ShieldAlert,
  Share2,
} from "lucide-react";
import { buildRugAutopsyReport } from "@/lib/buildcheck/rug-autopsy";
import type { BuildCheckReport } from "@/lib/buildcheck/types";
import { downloadRugAutopsyCardPng } from "./autopsy-card-canvas";

interface RugAutopsyPanelProps {
  report: BuildCheckReport;
  showStandaloneLink?: boolean;
}

export function RugAutopsyPanel({
  report,
  showStandaloneLink = true,
}: RugAutopsyPanelProps) {
  const [copiedThread, setCopiedThread] = useState(false);

  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://sol-shield.xyz";

  const autopsy = useMemo(
    () => buildRugAutopsyReport(report, origin),
    [report, origin]
  );

  const severityTone =
    autopsy.severity === "CRITICAL_AUTOPSY"
      ? {
          border: "border-rose-500/40",
          bg: "bg-rose-500/10",
          text: "text-rose-300",
          label: "CRITICAL FORENSIC AUTOPSY",
        }
      : autopsy.severity === "ELEVATED_RISK"
        ? {
            border: "border-amber-500/40",
            bg: "bg-amber-500/10",
            text: "text-amber-300",
            label: "ELEVATED RISK AUTOPSY",
          }
        : {
            border: "border-emerald-500/40",
            bg: "bg-emerald-500/10",
            text: "text-emerald-300",
            label: "CLEAN FORENSIC PROFILE",
          };

  async function handleCopyThread() {
    try {
      await navigator.clipboard.writeText(autopsy.xThread.join("\n\n---\n\n"));
      setCopiedThread(true);
      setTimeout(() => setCopiedThread(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  }

  return (
    <div data-testid="rug-autopsy-panel" className="space-y-5">
      {/* Header Banner */}
      <div
        className={`rounded-xl border ${severityTone.border} ${severityTone.bg} p-5 flex flex-col md:flex-row md:items-center justify-between gap-4`}
      >
        <div className="space-y-1.5 min-w-0">
          <div className={`text-xs font-mono font-semibold ${severityTone.text} inline-flex items-center gap-1.5`}>
            <FileWarning className="w-3.5 h-3.5" />
            <span>
              {severityTone.label} · {autopsy.networkName}
            </span>
          </div>
          <h3 className="text-lg sm:text-xl font-semibold text-white">
            {autopsy.subjectLabel} — {autopsy.classification}
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">{autopsy.headline}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyThread}
            className="px-3.5 py-2 rounded-lg border border-white/[0.14] bg-[#0B0F1A] hover:bg-[#131929] text-xs font-semibold text-slate-100 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copiedThread ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Thread Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy X Breakdown Thread</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => downloadRugAutopsyCardPng(autopsy)}
            className="px-3.5 py-2 rounded-lg bg-[#2934FF] hover:bg-[#3843FF] text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Autopsy Card PNG</span>
          </button>

          {showStandaloneLink && (
            <Link
              href={`/autopsy?report=${encodeURIComponent(autopsy.reportId)}`}
              className="px-3 py-2 rounded-lg border border-white/[0.12] text-xs font-medium text-slate-300 hover:text-white inline-flex items-center gap-1"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Open Full Page</span>
            </Link>
          )}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {[
          { k: "Trust Index", v: `${autopsy.authenticityScore}/100` },
          { k: "Liquidity", v: autopsy.metrics.liquidityLabel },
          { k: "Exit / Sell Tax", v: autopsy.metrics.sellTaxLabel },
          { k: "Insiders + Snipers", v: autopsy.metrics.insiderPctLabel },
          { k: "Possible MMs", v: String(autopsy.metrics.possibleMmCount) },
          { k: "Early Exits", v: String(autopsy.metrics.exitedEarlyCount) },
        ].map((m) => (
          <div
            key={m.k}
            className="px-3.5 py-2.5 rounded-lg border border-white/[0.07] bg-[#090C14]"
          >
            <div className="text-[11px] text-slate-400">{m.k}</div>
            <div className="text-sm font-mono font-semibold text-white mt-0.5 truncate">
              {m.v}
            </div>
          </div>
        ))}
      </div>

      {/* Chronological Forensic Timeline */}
      <div className="rounded-xl border border-white/[0.08] bg-[#090C14] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Chronological Attack &amp; Proof Timeline
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            {autopsy.timeline.length} stages reconstructed
          </span>
        </div>

        <div className="divide-y divide-white/[0.06]">
          {autopsy.timeline.map((ev) => {
            const tone =
              ev.severity === "CRITICAL"
                ? "text-rose-300 bg-rose-500/12 border-rose-500/35"
                : ev.severity === "WARNING"
                  ? "text-amber-300 bg-amber-500/12 border-amber-500/35"
                  : ev.severity === "CLEAN"
                    ? "text-emerald-300 bg-emerald-500/12 border-emerald-500/35"
                    : "text-sky-300 bg-sky-500/12 border-sky-500/35";
            const Icon =
              ev.severity === "CRITICAL"
                ? ShieldAlert
                : ev.severity === "WARNING"
                  ? AlertTriangle
                  : CheckCircle2;

            return (
              <div key={ev.stage} className="p-4 flex flex-col sm:flex-row gap-3">
                <div className="sm:w-44 shrink-0 space-y-1">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${tone}`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{ev.stage}</span>
                  </span>
                  <div className="text-xs font-medium text-slate-400">
                    {ev.phaseLabel}
                  </div>
                </div>
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white">{ev.title}</div>
                  <p className="text-xs font-mono text-slate-300 leading-relaxed break-words">
                    {ev.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Flagged Key Wallets + Ready X Thread */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {autopsy.flaggedWallets.length > 0 && (
          <div className="lg:col-span-6 rounded-xl border border-white/[0.08] bg-[#090C14] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.07] text-xs font-semibold uppercase tracking-wider text-slate-300">
              Key Actors Observed ({autopsy.flaggedWallets.length})
            </div>
            <div className="divide-y divide-white/[0.06]">
              {autopsy.flaggedWallets.map((w) => (
                <div key={w.address} className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-sky-300 truncate">
                      {w.address}
                    </span>
                    <a
                      href={w.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1 shrink-0"
                    >
                      <span>{w.roleLabel}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-xs text-slate-400">{w.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          className={`${
            autopsy.flaggedWallets.length > 0 ? "lg:col-span-6" : "lg:col-span-12"
          } rounded-xl border border-white/[0.08] bg-[#090C14] overflow-hidden`}
        >
          <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Ready-to-Post X Autopsy Thread ({autopsy.xThread.length} tweets)
            </span>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {autopsy.xThread.map((post, idx) => (
              <pre
                key={idx}
                className="p-3.5 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed"
              >
                {post}
              </pre>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
