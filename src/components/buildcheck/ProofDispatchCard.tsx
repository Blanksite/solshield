"use client";

import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Radio,
  Zap,
} from "lucide-react";
import {
  buildProofDispatch,
  formatSolShieldDispatchText,
  formatSolShieldThreadReplies,
} from "@/lib/buildcheck/proof-dispatch";
import type { BuildCheckReport } from "@/lib/buildcheck/types";

type DispatchViewMode = "dossier" | "social" | "thread";

interface ProofDispatchCardProps {
  report: BuildCheckReport;
}

export function ProofDispatchCard({ report }: ProofDispatchCardProps) {
  const [viewMode, setViewMode] = useState<DispatchViewMode>("dossier");
  const [copied, setCopied] = useState(false);

  const shareOrigin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://sol-shield.xyz";

  const dispatch = useMemo(
    () =>
      buildProofDispatch(report, {
        appPublicUrl: shareOrigin,
        maskAddresses: false,
        includeUrl: true,
      }),
    [report, shareOrigin]
  );

  const fullStoryText = useMemo(
    () =>
      formatSolShieldDispatchText(report, {
        appPublicUrl: shareOrigin,
        maskAddresses: false,
        includeUrl: true,
      }),
    [report, shareOrigin]
  );

  const threadReplies = useMemo(
    () =>
      formatSolShieldThreadReplies(report, shareOrigin, {
        includeUrl: true,
      }),
    [report, shareOrigin]
  );

  const verdictRailCls =
    report.verdict === "VERIFIED_BUILD"
      ? "border-l-emerald-400"
      : report.verdict === "UNPROVEN_HYPE"
        ? "border-l-amber-400"
        : "border-l-rose-400";

  const copyPayload =
    viewMode === "thread"
      ? `${threadReplies.primary}\n\n---\n\n${threadReplies.followup}`
      : fullStoryText;

  async function handleCopyDispatch() {
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <section
      data-testid="proof-dispatch-card"
      className="rounded-xl border border-white/[0.08] bg-[#0D1017] overflow-hidden"
    >
      {/* Header Bar */}
      <div className="px-4 py-2.5 border-b border-white/[0.06] bg-[#090B10] flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-[#84A7FF] shrink-0" />
          <span className="text-xs font-mono uppercase tracking-[0.08em] text-white font-semibold">
            SolShield® Proof Dispatch
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[10px] font-mono text-slate-400">
            <Radio className="w-2.5 h-2.5 text-[#84A7FF]" />
            <span>
              {report.inferenceMode === "venice-live-api"
                ? "Venice AI Brief"
                : "Forensic Brief"}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-md bg-white/[0.04] border border-white/[0.08] p-0.5 text-[11px] font-mono">
            {(
              [
                { id: "dossier", label: "Brief" },
                { id: "social", label: "Full Story" },
                { id: "thread", label: "2-Tweet" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  viewMode === tab.id
                    ? "bg-[#2934FF]/30 text-white border border-[#5D82FF]/45"
                    : "text-slate-400 hover:text-white border border-transparent"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopyDispatch}
            className="px-2.5 py-1 rounded-md bg-[#2934FF]/20 hover:bg-[#2934FF]/35 border border-[#5D82FF]/40 text-[11px] font-mono text-[#BFD0FF] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Copied Dispatch</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy Story</span>
              </>
            )}
          </button>
        </div>
      </div>

      {viewMode === "dossier" ? (
        <div className="divide-y divide-white/[0.06]">
          {/* Lead Narrative & Synthesis */}
          <div className="px-5 py-4 space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums text-slate-400">
              <span className="text-white font-semibold">
                {dispatch.subjectLabel} · INDEX {dispatch.indexScore}/100
              </span>
              <span>·</span>
              <span>
                BUILD {dispatch.buildScore ?? "N/A"} ({dispatch.buildLabel})
              </span>
              {dispatch.postureScore !== null && (
                <>
                  <span>·</span>
                  <span>
                    POSTURE {dispatch.postureScore} ({dispatch.postureLabel})
                  </span>
                </>
              )}
            </div>

            <div className={`pl-3.5 border-l-2 ${verdictRailCls} space-y-1.5`}>
              <p className="text-sm text-white font-medium leading-snug">
                {dispatch.leadBrief}
              </p>
              {dispatch.takeaway && dispatch.takeaway !== dispatch.leadBrief && (
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {dispatch.takeaway}
                </p>
              )}
            </div>

            {dispatch.contradictionCallout && (
              <div
                data-testid="proof-dispatch-callout"
                className="rounded-lg border border-rose-500/35 bg-rose-500/[0.08] px-3.5 py-2.5 flex items-start gap-2.5"
              >
                <Zap className="w-3.5 h-3.5 text-rose-300 mt-0.5 shrink-0" />
                <div className="space-y-0.5 min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-rose-300 font-semibold">
                    Claim vs Proof Call-Out · Unfiltered
                  </div>
                  <p className="text-xs text-rose-100 leading-relaxed">
                    {dispatch.contradictionCallout}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Balanced Two-Column Evidence Sheet */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06] bg-[#0A0C12]">
            <div className="px-5 py-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Confirmed Evidence ({dispatch.confirmedPoints.length})</span>
              </div>
              {dispatch.confirmedPoints.length > 0 ? (
                <ul className="space-y-1.5">
                  {dispatch.confirmedPoints.map((pt, i) => (
                    <li
                      key={`${i}-${pt.slice(0, 16)}`}
                      className="text-xs text-slate-200 leading-relaxed flex items-start gap-2"
                    >
                      <span className="text-emerald-400 font-mono mt-0.5 shrink-0">
                        ✓
                      </span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  No verified build claims corroborated yet in this target scope.
                </p>
              )}
            </div>

            <div className="px-5 py-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Open Gaps &amp; Watchpoints ({dispatch.openGaps.length})</span>
              </div>
              {dispatch.openGaps.length > 0 ? (
                <ul className="space-y-1.5">
                  {dispatch.openGaps.map((gap, i) => (
                    <li
                      key={`${i}-${gap.slice(0, 16)}`}
                      className="text-xs text-slate-200 leading-relaxed flex items-start gap-2"
                    >
                      <span className="text-amber-400 font-mono mt-0.5 shrink-0">
                        ◦
                      </span>
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  No critical gaps surfaced in audited scope — continue monitoring live on-chain flows.
                </p>
              )}
            </div>
          </div>

          {/* Trace & Methodology Footer */}
          <div className="px-5 py-2.5 bg-[#090B10] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {dispatch.chainTraceLine
                  ? `CHAIN TRACE: ${dispatch.chainTraceLine}`
                  : `TARGET TYPE: ${report.target.kind.replace("_", " ").toUpperCase()}`}
              </span>
              {dispatch.mindshareLine && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-[#93C5FD]">
                    X MINDSHARE: {dispatch.mindshareLine}
                  </span>
                </>
              )}
            </div>
            <span className="text-slate-500 text-[10px]">
              {dispatch.closingNote}
            </span>
          </div>
        </div>
      ) : viewMode === "social" ? (
        <div className="p-4 sm:p-5 bg-[#0A0C12] space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Long-Form Social / Dispatch Copy ({fullStoryText.length} chars)</span>
            <span className="text-slate-500">Ready for X Premium / Telegram / Discord</span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-200 leading-relaxed rounded-lg border border-white/[0.08] bg-[#07090E] p-3.5">
            {fullStoryText}
          </pre>
        </div>
      ) : (
        <div className="p-4 sm:p-5 bg-[#0A0C12] grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { label: "Tweet 1 / Scorecard + Link", body: threadReplies.primary },
            { label: "Tweet 2 / Proof Dispatch Reply", body: threadReplies.followup },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-white/[0.08] bg-[#07090E] p-3.5 space-y-2"
            >
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>{item.label}</span>
                <span className="tabular-nums text-emerald-400">
                  {item.body.length}/280
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-200 leading-relaxed">
                {item.body}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
