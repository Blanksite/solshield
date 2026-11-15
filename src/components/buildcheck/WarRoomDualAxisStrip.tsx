"use client";

import React from "react";
import { Flame, Layers, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import type { BuildCheckReport } from "@/lib/buildcheck/types";
import {
  computeDualAxisSummary,
  type AxisTone,
} from "@/lib/buildcheck/war-room-metrics";

function toneStyles(tone: AxisTone): {
  pill: string;
  bar: string;
  text: string;
} {
  switch (tone) {
    case "emerald":
      return {
        pill: "bg-emerald-500/12 text-emerald-300 border-emerald-500/35",
        bar: "bg-emerald-400",
        text: "text-emerald-400",
      };
    case "amber":
      return {
        pill: "bg-amber-500/12 text-amber-300 border-amber-500/35",
        bar: "bg-amber-400",
        text: "text-amber-300",
      };
    case "rose":
      return {
        pill: "bg-rose-500/12 text-rose-300 border-rose-500/35",
        bar: "bg-rose-400",
        text: "text-rose-400",
      };
    default:
      return {
        pill: "bg-white/[0.05] text-slate-300 border-white/15",
        bar: "bg-slate-500",
        text: "text-slate-300",
      };
  }
}

export function WarRoomDualAxisStrip({ report }: { report: BuildCheckReport }) {
  const { buildIntegrity, holderPosture, deployerRecord } =
    computeDualAxisSummary(report);

  const buildTone = toneStyles(buildIntegrity.tone);
  const holderTone = toneStyles(holderPosture.tone);
  const devTone = deployerRecord ? toneStyles(deployerRecord.tone) : null;

  return (
    <div
      data-testid="dual-axis-profile"
      className="border-b border-white/[0.06] bg-[#0B0E14] divide-y divide-white/[0.06]"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
        {/* Axis 1: Product / Build Integrity */}
        <div className="px-5 py-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="w-3.5 h-3.5 text-[#84A7FF] shrink-0" />
              <span className="text-[11px] font-mono uppercase tracking-[0.08em] text-slate-300">
                Build Integrity
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${buildTone.pill}`}
              >
                {buildIntegrity.label}
              </span>
              <span className={`font-mono tabular-nums text-sm font-bold ${buildTone.text}`}>
                {buildIntegrity.score ?? "—"}
                <span className="text-[11px] font-normal text-slate-500">/100</span>
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${buildTone.bar}`}
                style={{ width: `${buildIntegrity.score ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
              <span>Vaporware Risk</span>
              <span>Mixed Evidence</span>
              <span>Verified Build</span>
            </div>
          </div>

          <div className="text-[11px] font-mono text-slate-400">
            {buildIntegrity.breakdown}
          </div>
        </div>

        {/* Axis 2: Holder & Chain Hygiene */}
        <div className="px-5 py-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {holderPosture.tone === "rose" ? (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-[#84A7FF] shrink-0" />
              )}
              <span className="text-[11px] font-mono uppercase tracking-[0.08em] text-slate-300">
                Holder &amp; Chain Hygiene
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${holderTone.pill}`}
              >
                {holderPosture.label}
              </span>
              <span className={`font-mono tabular-nums text-sm font-bold ${holderTone.text}`}>
                {holderPosture.score !== null ? holderPosture.score : "N/A"}
                {holderPosture.score !== null && (
                  <span className="text-[11px] font-normal text-slate-500">/100</span>
                )}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${holderTone.bar}`}
                style={{ width: `${holderPosture.score ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
              <span>Elevated Exposure</span>
              <span>Watchlist</span>
              <span>Clean Posture</span>
            </div>
          </div>

          <div className="text-[11px] font-mono text-slate-400">
            {holderPosture.breakdown}
          </div>
        </div>
      </div>

      {/* Deployer Track Record Strip */}
      {deployerRecord && devTone && (
        <div
          data-testid="deployer-track-record"
          className="px-5 py-2.5 bg-[#090B10] flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-slate-400">
              <Wallet className="w-3.5 h-3.5 text-[#84A7FF]" />
              <span>Deployer Track Record</span>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${devTone.pill}`}
            >
              {deployerRecord.label}
            </span>
            {deployerRecord.devAddress && (
              <a
                href={`https://solscan.io/account/${deployerRecord.devAddress}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-[#84A7FF] hover:text-white transition-colors"
              >
                {deployerRecord.devAddress.slice(0, 5)}…
                {deployerRecord.devAddress.slice(-4)}
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[11px]">
            <span className="text-slate-300">
              {deployerRecord.priorMintsCount}{" "}
              <span className="text-slate-500">
                {deployerRecord.priorMintsCount === 1 ? "mint" : "mints"}
              </span>
            </span>
            <span
              className={
                deployerRecord.alertCount > 0 ? "text-rose-400 font-semibold" : "text-slate-300"
              }
            >
              {deployerRecord.alertCount}{" "}
              <span className="font-normal text-slate-500">
                {deployerRecord.alertCount === 1 ? "alert" : "alerts"}
              </span>
            </span>
            {deployerRecord.burnsCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Flame className="w-3 h-3" />
                <span>
                  {deployerRecord.burnsCount}{" "}
                  {deployerRecord.burnsCount === 1 ? "burn" : "burns"}
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
