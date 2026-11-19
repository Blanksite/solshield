"use client";

import React, { useState } from "react";
import Link from "next/link";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  Network,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import {
  CobaltSphere3D,
  CountUp,
  DecryptedText,
  InteractiveDotGrid,
  Magnet,
  SpotlightCard,
} from "@/components/reactbits";
import type {
  DevLineageReport,
  LineageNode,
  FundingEdge,
} from "@/lib/dev-lineage";

const SAMPLE_WALLETS = [
  {
    label: "$SHIELD Deployer (Verified Mint)",
    address: "Edwc4wHn1bfPHLfMu5SeydhwDKeuJwVSAuFfbgZ7aLqJ",
  },
  {
    label: "Mainnet Wallet Sample",
    address: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
  },
];

function shortAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

function riskLevelColor(level: string): string {
  switch (level) {
    case "SERIAL_RUGPULLER":
      return "text-red-400";
    case "HIGH_RISK":
      return "text-orange-400";
    case "SUSPICIOUS":
      return "text-yellow-400";
    default:
      return "text-emerald-400";
  }
}

function riskLevelBg(level: string): string {
  switch (level) {
    case "SERIAL_RUGPULLER":
      return "bg-red-500/20 border-red-500/40";
    case "HIGH_RISK":
      return "bg-orange-500/20 border-orange-500/40";
    case "SUSPICIOUS":
      return "bg-yellow-500/20 border-yellow-500/40";
    default:
      return "bg-emerald-500/20 border-emerald-500/40";
  }
}

function riskDialColor(score: number): string {
  if (score >= 70) return "#ef4444";
  if (score >= 40) return "#f97316";
  if (score >= 15) return "#eab308";
  return "#10b981";
}

/* ── Lineage Tree Visualization ───────────────────────────── */

function LineageTreeNode({
  node,
  edges,
  allNodes,
  isRoot,
  ancestors = new Set([node.wallet]),
}: {
  node: LineageNode;
  edges: FundingEdge[];
  allNodes: LineageNode[];
  isRoot: boolean;
  ancestors?: ReadonlySet<string>;
}) {
  const [expanded, setExpanded] = useState(isRoot);
  const childEdges = edges.filter((e) => e.to === node.wallet);
  const seenChildWallets = new Set<string>();
  const childNodes = childEdges
    .filter((e) => !ancestors.has(e.from))
    .filter((e) => {
      if (seenChildWallets.has(e.from)) return false;
      seenChildWallets.add(e.from);
      return true;
    })
    .map((e) => allNodes.find((n) => n.wallet === e.from))
    .filter(Boolean) as LineageNode[];

  return (
    <div className="ml-4 border-l border-zinc-700/50 pl-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 py-2 px-3 rounded-lg w-full text-left transition-colors ${
          isRoot
            ? "bg-zinc-800/80 border border-zinc-600/50"
            : "hover:bg-zinc-800/40"
        }`}
      >
        <span className="flex-shrink-0">
          {node.isCex ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
              CEX
            </span>
          ) : node.isSerialDeployer ? (
            <ShieldAlert className="w-4 h-4 text-red-400" />
          ) : node.totalDeployedTokenCount > 0 ? (
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
          ) : (
            <Wallet className="w-4 h-4 text-zinc-400" />
          )}
        </span>

        <span className="font-mono text-xs text-zinc-300">
          {node.cexLabel || shortAddress(node.wallet)}
        </span>

        {node.totalDeployedTokenCount > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
            {node.totalDeployedTokenCount} token{node.totalDeployedTokenCount > 1 ? "s" : ""}
          </span>
        )}

        {node.solBalance > 0 && (
          <span className="text-[10px] text-zinc-500">
            {node.solBalance.toFixed(4)} SOL
          </span>
        )}

        {isRoot && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-600/50 text-zinc-300">
            TARGET
          </span>
        )}

        <span className="ml-auto text-zinc-500">
          {childNodes.length > 0 &&
            (expanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            ))}
        </span>
      </button>

      {expanded && node.deployedTokens.length > 0 && (
        <div className="ml-6 mt-1 space-y-1">
          {node.deployedTokens.map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-[11px] text-zinc-400 py-0.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500/60" />
              <span className="font-mono">{shortAddress(t.mint)}</span>
              <span className="text-zinc-500">
                {t.deployPlatform}
                {t.deployBlockTime
                  ? ` · ${new Date(t.deployBlockTime * 1000).toLocaleDateString()}`
                  : ""}
              </span>
              <a
                href={`https://solscan.io/token/${t.mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ))}
        </div>
      )}

      {expanded &&
        childNodes.map((child) => {
          const nextAncestors = new Set(ancestors);
          nextAncestors.add(child.wallet);
          return (
            <LineageTreeNode
              key={child.wallet}
              node={child}
              edges={edges}
              allNodes={allNodes}
              isRoot={false}
              ancestors={nextAncestors}
            />
          );
        })}

      {expanded && childEdges.length > 0 && (
        <div className="ml-6 mt-1 space-y-0.5">
          {childEdges.map((e, i) => (
            <div
              key={i}
              className="flex items-center gap-1 text-[10px] text-zinc-500"
            >
              <GitBranch className="w-3 h-3 text-zinc-600" />
              <span>{e.amountSol.toFixed(4)} SOL</span>
              <span>from {e.cexLabel || shortAddress(e.from)}</span>
              {e.blockTime && (
                <span>
                  · {new Date(e.blockTime * 1000).toLocaleDateString()}
                </span>
              )}
              <a
                href={`https://solscan.io/tx/${e.txSignature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Panel ───────────────────────────────────────────── */

interface DevLineagePanelProps {
  initialAddress?: string;
}

export default function DevLineagePanel({
  initialAddress,
}: DevLineagePanelProps) {
  const [address, setAddress] = useState(initialAddress || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DevLineageReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [showVenice, setShowVenice] = useState(false);

  async function runAnalysis(walletAddr?: string) {
    const target = walletAddr || address;
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const res = await fetch(
        `/api/dev-lineage?address=${encodeURIComponent(target.trim())}`,
        { credentials: "same-origin", cache: "no-store" }
      );
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }

      setReport(data.report);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error. Please retry."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!report) return;
    navigator.clipboard.writeText(
      JSON.stringify(report, null, 2)
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="solshield-subpage min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden">
      {/* Background Grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03]">
        <InteractiveDotGrid
          className="opacity-30"
          baseColor="rgba(161, 161, 170, 0.25)"
          activeColor="rgba(168, 85, 247, 0.6)"
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60">
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-purple-400" />
            <h1 className="text-sm font-semibold tracking-tight">
              <DecryptedText
                text="Dev Lineage & Cabal Tree"
                sequential
                speed={30}
              />
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-[10px] text-zinc-500 font-mono">
              SolShield® × Venice AI
            </span>
            <ThemeToggleButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6 relative z-10">
        {/* Input Section */}
        <SpotlightCard
          spotlightColor="rgba(168,85,247,0.08)"
          className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 p-6 backdrop-blur-sm"
        >
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">
              Paste any Solana wallet address to trace its funding lineage,
              discover deployed tokens, and detect serial rugpuller patterns.
              <span className="text-purple-400 ml-1">
                100% read-only. Zero data retention.
              </span>
            </p>

            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runAnalysis()}
                  placeholder="Solana wallet address (Base58)..."
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-sm font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all"
                  spellCheck={false}
                />
              </div>
              <button
                onClick={() => runAnalysis()}
                disabled={loading || !address.trim()}
                className="w-full sm:w-auto justify-center px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center gap-2 flex-shrink-0"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Network className="w-4 h-4" />
                )}
                Trace Lineage
              </button>
            </div>

            {/* Sample Wallets */}
            <div className="flex flex-wrap gap-2">
              {SAMPLE_WALLETS.map((s) => (
                <button
                  key={s.address}
                  onClick={() => {
                    setAddress(s.address);
                    runAnalysis(s.address);
                  }}
                  disabled={loading}
                  className="px-2.5 py-1 text-[11px] bg-zinc-800/60 border border-zinc-700/40 rounded-md text-zinc-400 hover:text-zinc-200 hover:border-purple-500/30 transition-colors disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </SpotlightCard>

        {/* Error Banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <CobaltSphere3D className="w-20 h-20" />
            <p className="text-sm text-zinc-400 animate-pulse">
              Tracing wallet lineage on Solana Mainnet...
            </p>
            <p className="text-[10px] text-zinc-600">
              Recursive RPC calls in progress — this may take 10-30 seconds
            </p>
          </div>
        )}

        {/* Results */}
        {report && !loading && (
          <div className="space-y-6">
            {report.rpcDegraded && (
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>
                  {report.rpcWarning ||
                    "Solana RPC encountered rate limits during tracing; results may be incomplete."}
                </span>
              </div>
            )}

            {/* Risk Overview Card */}
            <SpotlightCard
              spotlightColor={
                report.riskScore >= 70
                  ? "rgba(239,68,68,0.1)"
                  : report.riskScore >= 40
                    ? "rgba(249,115,22,0.1)"
                    : report.riskScore >= 15
                      ? "rgba(234,179,8,0.1)"
                      : "rgba(16,185,129,0.1)"
              }
              className={`rounded-2xl border p-6 backdrop-blur-sm ${riskLevelBg(report.riskLevel)}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-2">
                    {report.riskLevel === "SERIAL_RUGPULLER" ? (
                      <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
                    ) : report.riskLevel === "HIGH_RISK" ? (
                      <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0" />
                    ) : report.riskLevel === "SUSPICIOUS" ? (
                      <Search className="w-5 h-5 text-yellow-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    )}
                    <p
                      className={`text-lg font-bold ${riskLevelColor(report.riskLevel)}`}
                    >
                      {report.verdictLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                    <span>
                      Risk Score:{" "}
                      <span className={`font-bold ${riskLevelColor(report.riskLevel)}`}>
                        <CountUp
                          from={0}
                          to={report.riskScore}
                          durationMs={800}
                        />
                        /100
                      </span>
                    </span>
                    <span>
                      Wallets Traced:{" "}
                      <span className="text-zinc-200 font-medium">
                        {report.totalUniqueWallets}
                      </span>
                    </span>
                    <span>
                      Tokens Found:{" "}
                      <span className="text-zinc-200 font-medium">
                        {report.totalDeployedTokens}
                      </span>
                    </span>
                    <span>
                      Max Depth:{" "}
                      <span className="text-zinc-200 font-medium">
                        {report.maxDepthReached}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Risk Dial */}
                <div className="flex-shrink-0 w-20 h-20">
                  <svg viewBox="0 0 100 100" className="w-full h-full">
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="none"
                      stroke="#27272a"
                      strokeWidth="8"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      fill="none"
                      stroke={riskDialColor(report.riskScore)}
                      strokeWidth="8"
                      strokeDasharray={`${(report.riskScore / 100) * 264} 264`}
                      strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                      className="transition-all duration-1000"
                    />
                    <text
                      x="50"
                      y="50"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={riskDialColor(report.riskScore)}
                      fontSize="18"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {report.riskScore}
                    </text>
                  </svg>
                </div>
              </div>

              {/* Cabal & Serial Deployer Badges */}
              <div className="flex flex-wrap gap-2 mt-3">
                {report.cabalDetected && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                    <Users className="w-3 h-3" />
                    CABAL DETECTED
                  </span>
                )}
                {report.serialDeployerCount > 0 && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30">
                    <ShieldAlert className="w-3 h-3" />
                    {report.serialDeployerCount} SERIAL DEPLOYER
                    {report.serialDeployerCount > 1 ? "S" : ""}
                  </span>
                )}
                <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-zinc-800/60 text-zinc-400 border border-zinc-700/40">
                  <Shield className="w-3 h-3" />
                  {report.inferenceMode === "venice-live-api"
                    ? "Venice AI Live"
                    : "Deterministic Engine"}
                </span>
                <span className="text-[10px] text-zinc-500 self-center">
                  {report.latencyMs}ms
                </span>
              </div>
            </SpotlightCard>

            {/* Lineage Tree */}
            <SpotlightCard
              spotlightColor="rgba(168,85,247,0.06)"
              className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 p-6 backdrop-blur-sm"
            >
              <div className="flex items-center gap-2 mb-4">
                <GitBranch className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-semibold">Funding Lineage Tree</h2>
                <span className="text-[10px] text-zinc-500 ml-auto">
                  {report.totalUniqueWallets} wallets · {report.fundingEdges.length}{" "}
                  funding edges
                </span>
              </div>

              {report.lineageNodes.length > 0 ? (
                <div className="max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-track-zinc-900 scrollbar-thumb-zinc-700">
                  {(() => {
                    const rootNode = report.lineageNodes.find(
                      (n) => n.depth === 0
                    );
                    if (!rootNode) return null;
                    return (
                      <LineageTreeNode
                        node={rootNode}
                        edges={report.fundingEdges}
                        allNodes={report.lineageNodes}
                        isRoot
                      />
                    );
                  })()}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 text-center py-4">
                  No lineage data found for this wallet.
                </p>
              )}
            </SpotlightCard>

            {/* Venice AI Analysis */}
            <SpotlightCard
              spotlightColor="rgba(168,85,247,0.06)"
              className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 p-6 backdrop-blur-sm"
            >
              <button
                onClick={() => setShowVenice(!showVenice)}
                className="flex items-center gap-2 w-full text-left"
              >
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-semibold">
                  Venice AI Forensic Analysis
                </h2>
                <span className="text-[10px] text-zinc-500 ml-1">
                  Zero Data Retention
                </span>
                <span className="ml-auto text-zinc-500">
                  {showVenice ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </button>

              {showVenice && (
                <div className="mt-4 space-y-3">
                  <div className="p-3 bg-zinc-800/40 rounded-lg text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {report.veniceSummary}
                  </div>

                  {report.veniceRecommendations.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-zinc-300">
                        Recommendations:
                      </p>
                      {report.veniceRecommendations.map((rec, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-[11px] text-zinc-400"
                        >
                          <CheckCircle2 className="w-3 h-3 text-purple-400 mt-0.5 flex-shrink-0" />
                          <span>{rec}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-[10px] text-zinc-600">
                    <Shield className="w-3 h-3" />
                    {report.privacyAttestation}
                  </div>
                </div>
              )}
            </SpotlightCard>

            {/* Action Bar */}
            <div className="flex items-center gap-3">
              <Magnet>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-zinc-800/60 border border-zinc-700/40 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copied ? "Copied!" : "Copy Report JSON"}
                </button>
              </Magnet>
              <a
                href={`https://solscan.io/account/${report.targetWallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-zinc-800/60 border border-zinc-700/40 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                View on Solscan
              </a>
              <Link
                href="/wallet-detox"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-zinc-800/60 border border-zinc-700/40 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Shield className="w-3 h-3" />
                Wallet Detox
              </Link>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!report && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
            <Network className="w-12 h-12 text-zinc-700" />
            <p className="text-sm text-zinc-500">
              Enter a wallet address above to trace its funding lineage and
              detect serial rugpuller patterns.
            </p>
            <p className="text-[10px] text-zinc-600 max-w-md">
              SolShield traces who funded the deployer, discovers every token
              they created, and identifies cabal treasury wallets — all
              read-only via Solana RPC with zero data retention.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/40 mt-16">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-4">
          <div className="flex flex-wrap items-center justify-center gap-4 text-[10px] text-zinc-500">
            <Link href="/" className="hover:text-zinc-400 transition-colors">
              Home
            </Link>
            <Link
              href="/buildcheck"
              className="hover:text-zinc-400 transition-colors"
            >
              BuildCheck
            </Link>
            <Link
              href="/wallet-detox"
              className="hover:text-zinc-400 transition-colors"
            >
              Wallet Detox
            </Link>
            <Link
              href="/privacy"
              className="hover:text-zinc-400 transition-colors"
            >
              Privacy
            </Link>
          </div>
          <span className="text-[10px] text-zinc-700 font-mono">
            SolShield® × Venice AI · Zero Data Retention
          </span>
        </div>
      </footer>
    </div>
  );
}
