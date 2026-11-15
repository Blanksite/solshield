"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Network,
  ShieldAlert,
} from "lucide-react";
import type {
  HolderClusterNode,
  HoldersDeepAnalysis,
} from "@/lib/buildcheck/types";

interface SniperCabalGraphProps {
  mintAddress: string;
  symbol?: string | null;
  holders: HoldersDeepAnalysis;
}

const ROLE_COLORS: Record<
  HolderClusterNode["role"],
  { fill: string; stroke: string; badge: string; label: string }
> = {
  cabal: {
    fill: "rgba(239, 68, 68, 0.24)",
    stroke: "#EF4444",
    badge: "text-rose-300 border-rose-500/40 bg-rose-500/15",
    label: "Linked Cabal",
  },
  sniper: {
    fill: "rgba(245, 158, 11, 0.22)",
    stroke: "#F59E0B",
    badge: "text-amber-300 border-amber-500/40 bg-amber-500/15",
    label: "Launch Sniper",
  },
  pool: {
    fill: "rgba(16, 185, 129, 0.2)",
    stroke: "#10B981",
    badge: "text-emerald-300 border-emerald-500/40 bg-emerald-500/15",
    label: "LP / Pool Vault",
  },
  burn: {
    fill: "rgba(16, 185, 129, 0.2)",
    stroke: "#10B981",
    badge: "text-emerald-300 border-emerald-500/40 bg-emerald-500/15",
    label: "Burned",
  },
  dev: {
    fill: "rgba(96, 165, 250, 0.24)",
    stroke: "#60A5FA",
    badge: "text-sky-300 border-sky-500/40 bg-sky-500/15",
    label: "Dev Wallet",
  },
  retail: {
    fill: "rgba(255, 255, 255, 0.08)",
    stroke: "#71717A",
    badge: "text-white/75 border-white/15 bg-white/[0.06]",
    label: "Holder",
  },
};

export function SniperCabalGraph({
  mintAddress,
  symbol,
  holders,
}: SniperCabalGraphProps) {
  const [selectedNode, setSelectedNode] = useState<HolderClusterNode | null>(
    () =>
      holders.nodes.find((n) => n.role === "cabal" || n.role === "sniper") ||
      holders.nodes[0] ||
      null
  );
  const [showChecks, setShowChecks] = useState(true);

  const layout = useMemo(() => {
    const cx = 320;
    const cy = 175;
    const visibleNodes = holders.nodes.slice(0, 14);
    const placedNodes = visibleNodes.map((node, idx) => {
      const angle = (idx / Math.max(visibleNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius =
        node.role === "pool" || node.role === "burn"
          ? 92
          : node.role === "cabal" || node.role === "sniper"
            ? 122
            : 136;
      return {
        node,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * (radius * 0.85),
        r: Math.max(9, Math.min(20, 8 + node.pct * 0.45)),
      };
    });

    // Place unique shared funders near the outer edge of their cluster
    const funders = Array.from(
      new Set(
        placedNodes
          .filter((p) => p.node.funder && (p.node.role === "cabal" || p.node.role === "sniper"))
          .map((p) => p.node.funder!)
      )
    ).slice(0, 4);

    const funderHubs = funders.map((funder) => {
      const children = placedNodes.filter((p) => p.node.funder === funder);
      const avgX = children.reduce((s, c) => s + c.x, 0) / Math.max(children.length, 1);
      const avgY = children.reduce((s, c) => s + c.y, 0) / Math.max(children.length, 1);
      const dx = avgX - cx;
      const dy = avgY - cy;
      const len = Math.hypot(dx, dy) || 1;
      return {
        funder,
        x: Math.max(36, Math.min(604, cx + (dx / len) * 165)),
        y: Math.max(26, Math.min(324, cy + (dy / len) * 145)),
        children,
      };
    });

    return { cx, cy, placedNodes, funderHubs };
  }, [holders.nodes]);

  const verdictBadgeClass =
    holders.verdict === "OK"
      ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-300"
      : holders.verdict === "SKETCHY"
        ? "border-amber-500/35 bg-amber-500/15 text-amber-300"
        : "border-rose-500/35 bg-rose-500/15 text-rose-300";

  const verdictDisplayLabel =
    holders.verdict === "OK"
      ? "CLEAN POSTURE"
      : holders.verdict === "SKETCHY"
        ? "WATCHLIST"
        : "ELEVATED EXPOSURE";

  return (
    <div className="space-y-5">
      {/* Header Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`px-2.5 py-1 rounded-md border font-mono text-xs font-semibold ${verdictBadgeClass}`}>
            {verdictDisplayLabel} · {holders.score} / 100
          </span>
          {holders.distribution.insidersPct > 0 ? (
            <span className="px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 font-mono text-[11px] text-rose-300">
              CABAL {holders.distribution.insidersPct}%
            </span>
          ) : null}
          {holders.totalHolders !== null ? (
            <span className="font-mono text-xs text-white/50">
              {holders.totalHolders.toLocaleString("en-US")} total holders
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono text-white/55">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Cabal
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Sniper
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> LP/Burn
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-zinc-400" /> Retail
          </span>
        </div>
      </div>

      {/* Stacked Supply Distribution Bar */}
      <div className="space-y-2">
        <div className="h-3 w-full rounded-full overflow-hidden bg-white/[0.06] flex">
          {holders.distribution.insidersPct > 0 ? (
            <div
              style={{ width: `${Math.min(100, holders.distribution.insidersPct)}%` }}
              className="bg-rose-500 h-full"
              title={`Insiders / Cabal ${holders.distribution.insidersPct}%`}
            />
          ) : null}
          {holders.distribution.snipersPct > 0 ? (
            <div
              style={{ width: `${Math.min(100, holders.distribution.snipersPct)}%` }}
              className="bg-amber-400 h-full"
              title={`Launch Snipers ${holders.distribution.snipersPct}%`}
            />
          ) : null}
          {holders.distribution.burnedOrLockedPct > 0 ? (
            <div
              style={{ width: `${Math.min(100, holders.distribution.burnedOrLockedPct)}%` }}
              className="bg-emerald-500 h-full"
              title={`Burned / Locked ${holders.distribution.burnedOrLockedPct}%`}
            />
          ) : null}
          {holders.distribution.devPct > 0 ? (
            <div
              style={{ width: `${Math.min(100, holders.distribution.devPct)}%` }}
              className="bg-sky-400 h-full"
              title={`Dev ${holders.distribution.devPct}%`}
            />
          ) : null}
          <div className="bg-zinc-600/70 h-full flex-1" title="Retail / Remaining Holders" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-white/[0.08] bg-[#090B10] divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] text-xs">
          <div className="px-3.5 py-2.5">
            <span className="text-slate-400 block text-[11px]">Insiders / Cabal</span>
            <span className="font-mono tabular-nums text-rose-300 font-semibold">
              {holders.distribution.insidersPct}%
            </span>
          </div>
          <div className="px-3.5 py-2.5">
            <span className="text-slate-400 block text-[11px]">Launch Snipers</span>
            <span className="font-mono tabular-nums text-amber-300 font-semibold">
              {holders.distribution.snipersPct}%
            </span>
          </div>
          <div className="px-3.5 py-2.5">
            <span className="text-slate-400 block text-[11px]">Burned / Locked</span>
            <span className="font-mono tabular-nums text-emerald-300 font-semibold">
              {holders.distribution.burnedOrLockedPct}%
            </span>
          </div>
          <div className="px-3.5 py-2.5">
            <span className="text-slate-400 block text-[11px]">Dev / Retail</span>
            <span className="font-mono tabular-nums text-white font-semibold">
              {holders.distribution.devPct}% / {holders.distribution.retailPct}%
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Cluster Topology SVG + Node Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#07090D] p-2 relative overflow-hidden">
          {layout.placedNodes.length === 0 ? (
            <div className="h-[320px] flex flex-col items-center justify-center text-xs text-white/45 gap-2">
              <Network className="w-6 h-6 text-white/25" />
              <span>Top holder clustering unavailable on this mint.</span>
            </div>
          ) : (
            <svg viewBox="0 0 640 350" className="w-full h-[320px] select-none">
              <defs>
                <radialGradient id="cabalCenterGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(41,52,255,0.34)" />
                  <stop offset="100%" stopColor="rgba(41,52,255,0)" />
                </radialGradient>
              </defs>
              <circle cx={layout.cx} cy={layout.cy} r={115} fill="url(#cabalCenterGlow)" />

              {/* Edges: Holder -> Mint */}
              {layout.placedNodes.map(({ node, x, y }) => {
                const isSuspicious = node.role === "cabal" || node.role === "sniper";
                return (
                  <line
                    key={`edge-${node.tokenAccount}`}
                    x1={layout.cx}
                    y1={layout.cy}
                    x2={x}
                    y2={y}
                    stroke={
                      isSuspicious
                        ? "rgba(239, 68, 68, 0.35)"
                        : node.role === "pool" || node.role === "burn"
                          ? "rgba(16, 185, 129, 0.32)"
                          : "rgba(255, 255, 255, 0.1)"
                    }
                    strokeWidth={isSuspicious ? 1.6 : 1}
                    strokeDasharray={isSuspicious ? "4 3" : undefined}
                  />
                );
              })}

              {/* Funder -> Cabal Co-Funded Edges */}
              {layout.funderHubs.map((hub) => (
                <g key={`funder-${hub.funder}`}>
                  {hub.children.map((child) => (
                    <line
                      key={`fe-${hub.funder}-${child.node.address}`}
                      x1={hub.x}
                      y1={hub.y}
                      x2={child.x}
                      y2={child.y}
                      stroke="rgba(244, 63, 94, 0.65)"
                      strokeWidth={1.5}
                    />
                  ))}
                  <rect
                    x={hub.x - 28}
                    y={hub.y - 10}
                    width={56}
                    height={20}
                    rx={6}
                    fill="#1C1016"
                    stroke="#F43F5E"
                    strokeWidth={1}
                  />
                  <text
                    x={hub.x}
                    y={hub.y + 3}
                    textAnchor="middle"
                    fill="#FDA4AF"
                    fontSize="8.5"
                    fontFamily="monospace"
                  >
                    FND {hub.funder.slice(0, 4)}
                  </text>
                </g>
              ))}

              {/* Holder Nodes */}
              {layout.placedNodes.map(({ node, x, y, r }) => {
                const style = ROLE_COLORS[node.role];
                const isSelected = selectedNode?.address === node.address;
                return (
                  <g
                    key={`node-${node.tokenAccount}`}
                    className="cursor-pointer"
                    onClick={() => setSelectedNode(node)}
                  >
                    {isSelected ? (
                      <circle
                        cx={x}
                        cy={y}
                        r={r + 5}
                        fill="none"
                        stroke="#84A7FF"
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                      />
                    ) : null}
                    <circle
                      cx={x}
                      cy={y}
                      r={r}
                      fill={style.fill}
                      stroke={style.stroke}
                      strokeWidth={isSelected ? 2.2 : 1.4}
                    />
                    <text
                      x={x}
                      y={y + 3}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      {node.pct >= 1 ? `${node.pct.toFixed(1)}%` : `${node.pct}%`}
                    </text>
                  </g>
                );
              })}

              {/* Center Mint Node */}
              <circle
                cx={layout.cx}
                cy={layout.cy}
                r={26}
                fill="#111633"
                stroke="#2934FF"
                strokeWidth={2}
              />
              <text
                x={layout.cx}
                y={layout.cy + 3}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="10"
                fontWeight="600"
                fontFamily="monospace"
              >
                ${(symbol || mintAddress.slice(0, 4)).slice(0, 7)}
              </text>
            </svg>
          )}
        </div>

        {/* Selected Node Inspector & Detected Clusters */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {selectedNode ? (
            <div className="p-4 rounded-xl border border-white/[0.08] bg-[#090B10] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`px-2 py-0.5 rounded border text-[11px] font-medium ${
                    ROLE_COLORS[selectedNode.role].badge
                  }`}
                >
                  {ROLE_COLORS[selectedNode.role].label}
                </span>
                <a
                  href={`https://solscan.io/account/${selectedNode.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-[#84A7FF] hover:text-white"
                >
                  Solscan <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="font-mono text-xs text-white break-all">
                {selectedNode.address}
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-1 text-xs border-t border-white/[0.06]">
                <div>
                  <span className="text-slate-400 block text-[11px]">Supply Share</span>
                  <span className="font-mono tabular-nums text-white font-semibold">{selectedNode.pct}%</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Wallet Age</span>
                  <span className={`font-mono tabular-nums ${selectedNode.isFresh ? "text-amber-300" : "text-slate-200"}`}>
                    {selectedNode.txCount === 0
                      ? "Vault/Program"
                      : selectedNode.isFresh
                        ? `Fresh (${selectedNode.txCount} txs)`
                        : "60+ txs"}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block text-[11px]">Traced Funder / First Slot</span>
                  <span className="font-mono tabular-nums text-slate-300">
                    {selectedNode.funder
                      ? `${selectedNode.funder.slice(0, 12)}...`
                      : "Self / Multi-hop"}
                    {selectedNode.firstSlot ? ` · Slot ${selectedNode.firstSlot}` : ""}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {holders.clusters.length > 0 ? (
            <div className="p-3.5 rounded-xl border border-rose-500/25 bg-[#160D11] space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-300">
                <ShieldAlert className="w-3.5 h-3.5" /> Linked Clusters Detected
              </div>
              {holders.clusters.map((cl) => (
                <div
                  key={cl.clusterId}
                  className="text-xs border-t border-white/[0.07] pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center justify-between text-slate-200 font-mono text-[11px]">
                    <span>{cl.label}</span>
                    <span className="text-rose-300 font-semibold">{cl.combinedPct}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-[#0B1410] text-xs text-emerald-200/90">
              No co-funded cabal clusters detected among top 10 non-pool wallets.
            </div>
          )}
        </div>
      </div>

      {/* Expandable "What We Checked" Audit Checklist */}
      <div className="rounded-xl border border-white/[0.08] bg-[#090B10] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowChecks((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between text-xs font-medium text-slate-200 hover:bg-white/[0.02] cursor-pointer"
        >
          <span>
            What we checked ({holders.flagsCount} flags · {holders.watchCount} watch ·{" "}
            {holders.clearCount} clear)
          </span>
          {showChecks ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>
        {showChecks ? (
          <div className="px-4 pb-3 divide-y sm:divide-y-0 grid grid-cols-1 sm:grid-cols-2 gap-x-6 border-t border-white/[0.06] pt-2">
            {holders.checks.map((chk, idx) => (
              <div
                key={`${chk.label}-${idx}`}
                className="flex items-center justify-between gap-2 py-2 border-b border-white/[0.04] text-xs"
              >
                <span className="flex items-center gap-2 text-slate-200">
                  {chk.status === "flag" ? (
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  ) : chk.status === "watch" ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                  {chk.label}
                </span>
                {chk.value ? (
                  <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                    {chk.value}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
