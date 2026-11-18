"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeftRight,
  Bell,
  Check,
  Clock,
  Copy,
  Crown,
  ExternalLink,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import type {
  HoldersDeepAnalysis,
  WalletToWatchEntry,
  WalletWatchCategory,
} from "@/lib/buildcheck/types";
import {
  addOrUpdateLocalWatchedWallet,
  getChainDisplayName,
  getWatchedWalletExplorerUrl,
  makeWatchedWalletId,
  normalizeWatchedAddressClient,
  readLocalWatchedWallets,
  removeLocalWatchedWallet,
  WATCHLIST_CHANGED_EVENT,
  type WatchedWalletActivitySnapshot,
  type WatchWalletChain,
} from "@/lib/wallet-watch-client";

interface WalletsToWatchPanelProps {
  mintAddress: string;
  symbol?: string | null;
  networkName?: string | null;
  chainFamily?: "solana" | "evm" | "unknown";
  holders: HoldersDeepAnalysis;
  devAddress?: string | null;
}

type CategoryFilter = "all" | "possible_mm" | "early_buyer" | "top_holder" | "cabal_dev";

const CATEGORY_STYLE: Record<
  WalletWatchCategory,
  { label: string; badgeCls: string }
> = {
  possible_mm: {
    label: "Possible MM",
    badgeCls: "border-violet-500/40 bg-violet-500/15 text-violet-300",
  },
  early_buyer: {
    label: "Early Buyer",
    badgeCls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  cabal_linked: {
    label: "Cabal Cluster",
    badgeCls: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  },
  dev_linked: {
    label: "Dev / Creator",
    badgeCls: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  },
  top_holder: {
    label: "Top Holder",
    badgeCls: "border-white/20 bg-white/[0.06] text-slate-200",
  },
};

function inferDefaultChain(
  mintAddress: string,
  chainKeyHint?: string | null,
  networkName?: string | null
): WatchWalletChain {
  const hint = (chainKeyHint || networkName || "").toLowerCase();
  if (hint.includes("robinhood")) return "robinhood";
  if (hint.includes("base")) return "base";
  if (hint.includes("arbitrum")) return "arbitrum";
  if (hint.includes("optimism")) return "optimism";
  if (hint.includes("polygon")) return "polygon";
  if (hint.includes("bsc")) return "bsc";
  if (hint.includes("eth")) return "ethereum";
  if (mintAddress.startsWith("0x")) return "robinhood";
  return "solana";
}

function buildFallbackEntries(params: {
  mintAddress: string;
  holders: HoldersDeepAnalysis;
  chainKey: WatchWalletChain;
  devAddress?: string | null;
}): WalletToWatchEntry[] {
  const chainFamily = params.chainKey === "solana" ? "solana" : "evm";
  const out: WalletToWatchEntry[] = [];
  const seen = new Set<string>();

  for (const node of params.holders.nodes || []) {
    if (node.role === "pool" || node.role === "burn") continue;
    if (seen.has(node.address)) continue;
    seen.add(node.address);
    const category: WalletWatchCategory =
      node.role === "cabal"
        ? "cabal_linked"
        : node.role === "sniper"
          ? "early_buyer"
          : node.role === "dev"
            ? "dev_linked"
            : "top_holder";
    out.push({
      address: node.address,
      chainFamily,
      chainKey: params.chainKey,
      category,
      tags: [CATEGORY_STYLE[category].label],
      holdingPct: node.pct,
      firstSeenSlotOrBlock: node.firstSlot,
      txCount: node.txCount,
      isFresh: node.isFresh,
      funder: node.funder,
      confidence: node.role === "cabal" || node.role === "sniper" ? "HIGH" : "MEDIUM",
      reason: `Top non-pool wallet holding ${node.pct.toFixed(2)}% supply`,
      explorerUrl: getWatchedWalletExplorerUrl(node.address, params.chainKey),
    });
  }

  if (params.devAddress && !seen.has(params.devAddress)) {
    out.push({
      address: params.devAddress,
      chainFamily,
      chainKey: params.chainKey,
      category: "dev_linked",
      tags: ["Creator / Deployer"],
      holdingPct: params.holders.distribution?.devPct ?? 0,
      confidence: "HIGH",
      reason: "Contract deployer / token authority",
      explorerUrl: getWatchedWalletExplorerUrl(params.devAddress, params.chainKey),
    });
  }

  return out;
}

export function WalletsToWatchPanel({
  mintAddress,
  symbol,
  networkName,
  holders,
  devAddress,
}: WalletsToWatchPanelProps) {
  const defaultChain = inferDefaultChain(
    mintAddress,
    holders.walletsToWatch?.[0]?.chainKey,
    networkName
  );

  const entries = useMemo(() => {
    if (Array.isArray(holders.walletsToWatch) && holders.walletsToWatch.length > 0) {
      return holders.walletsToWatch;
    }
    return buildFallbackEntries({
      mintAddress,
      holders,
      chainKey: defaultChain,
      devAddress,
    });
  }, [mintAddress, holders, defaultChain, devAddress]);

  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const [activityById, setActivityById] = useState<Record<string, WatchedWalletActivitySnapshot>>({});
  const [loadingAddr, setLoadingAddr] = useState<string | null>(null);
  const [customWallet, setCustomWallet] = useState("");
  const [customNote, setCustomNote] = useState("");
  const [customFeedback, setCustomFeedback] = useState<string | null>(null);

  useEffect(() => {
    const refreshWatched = () => {
      const saved = readLocalWatchedWallets();
      setWatchedIds(new Set(saved.map((w) => w.id)));
    };
    refreshWatched();
    window.addEventListener(WATCHLIST_CHANGED_EVENT, refreshWatched);
    return () => window.removeEventListener(WATCHLIST_CHANGED_EVENT, refreshWatched);
  }, []);

  const isMmMatch = (e: WalletToWatchEntry) =>
    e.category === "possible_mm" || e.tags.some((t) => t.startsWith("Possible MM"));
  const isEarlyMatch = (e: WalletToWatchEntry) =>
    e.category === "early_buyer" || e.tags.some((t) => t.startsWith("Early Buyer"));
  const isCabalDevMatch = (e: WalletToWatchEntry) =>
    e.category === "cabal_linked" ||
    e.category === "dev_linked" ||
    e.tags.some((t) => t.includes("Bundle") || t.includes("Creator"));
  const isTopMatch = (e: WalletToWatchEntry) =>
    e.category === "top_holder" || e.holdingPct >= 0.4;

  const counts = useMemo(() => {
    return {
      all: entries.length,
      possible_mm: entries.filter(isMmMatch).length,
      early_buyer: entries.filter(isEarlyMatch).length,
      top_holder: entries.filter(isTopMatch).length,
      cabal_dev: entries.filter(isCabalDevMatch).length,
    };
  }, [entries]);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "possible_mm") return entries.filter(isMmMatch);
    if (filter === "early_buyer") return entries.filter(isEarlyMatch);
    if (filter === "top_holder") return entries.filter(isTopMatch);
    if (filter === "cabal_dev") return entries.filter(isCabalDevMatch);
    return entries;
  }, [entries, filter]);

  const toggleWatch = (entry: WalletToWatchEntry) => {
    const chain = (entry.chainKey as WatchWalletChain) || defaultChain;
    const id = makeWatchedWalletId(entry.address, chain);
    if (watchedIds.has(id)) {
      removeLocalWatchedWallet(entry.address, chain);
    } else {
      addOrUpdateLocalWatchedWallet({
        address: entry.address,
        chain,
        tag: entry.category,
        tokenSymbol: symbol,
        tokenAddress: mintAddress,
        label: `${symbol ? `$${symbol} · ` : ""}${CATEGORY_STYLE[entry.category].label}`,
      });
    }
  };

  const handleCopy = (addr: string) => {
    void navigator.clipboard?.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1600);
  };

  const inspectLiveActivity = async (entry: WalletToWatchEntry) => {
    const chain = (entry.chainKey as WatchWalletChain) || defaultChain;
    const id = makeWatchedWalletId(entry.address, chain);
    if (activityById[id]) {
      setActivityById((prev) => {
        const clone = { ...prev };
        delete clone[id];
        return clone;
      });
      return;
    }
    setLoadingAddr(entry.address);
    try {
      const qs = new URLSearchParams({
        address: entry.address,
        chain,
        ...(mintAddress ? { token: mintAddress } : {}),
      });
      const res = await fetch(`/api/wallet-tracker?${qs.toString()}`);
      const json = (await res.json()) as {
        ok?: boolean;
        snapshot?: WatchedWalletActivitySnapshot;
      };
      if (json.ok && json.snapshot) {
        setActivityById((prev) => ({ ...prev, [id]: json.snapshot! }));
      }
    } catch {
      // Ignore transient lookup failure
    } finally {
      setLoadingAddr(null);
    }
  };

  const handleAddCustomWallet = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeWatchedAddressClient(customWallet, defaultChain);
    if (!norm.valid) {
      setCustomFeedback(norm.error || "Invalid wallet address");
      return;
    }
    addOrUpdateLocalWatchedWallet({
      address: norm.address,
      chain: norm.chain,
      tag: "custom",
      tokenSymbol: symbol,
      tokenAddress: mintAddress,
      label:
        customNote.trim() ||
        `${symbol ? `$${symbol} · ` : ""}Custom Watch (${getChainDisplayName(norm.chain)})`,
    });
    setCustomWallet("");
    setCustomNote("");
    setCustomFeedback("Added to your Watchlist.");
    setTimeout(() => setCustomFeedback(null), 2400);
  };

  return (
    <div className="space-y-5" data-testid="wallets-to-watch-panel">
      {/* 3-Second Clarity Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-[#84A7FF]" />
            <h3 className="text-sm sm:text-base font-semibold text-white">
              Wallets to Watch on {symbol ? `$${symbol}` : "This Token"}
            </h3>
            <span className="px-2 py-0.5 rounded bg-white/[0.06] border border-white/10 font-mono text-[11px] text-slate-300">
              {getChainDisplayName(defaultChain)}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400">
            Key wallets traced from on-chain transfers &amp; top holders — spot possible MM bots, early buyers, and clustered insiders before you trade.
          </p>
        </div>

        <Link
          href="/wallets"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 min-h-[40px] rounded-lg border border-[#2934FF]/45 bg-[#2934FF]/15 hover:bg-[#2934FF]/25 text-xs font-medium text-[#BFD0FF] transition-colors shrink-0"
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Open Live Watchlist ({watchedIds.size})</span>
        </Link>
      </div>

      {/* Key Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-white/[0.08] bg-[#090B10] divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
        <div className="px-4 py-3">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <ArrowLeftRight className="w-3 h-3 text-violet-400" />
            Possible MM Wallets
          </span>
          <span className="mt-1 block font-mono tabular-nums text-base font-semibold text-violet-300">
            {Math.max(counts.possible_mm, holders.possibleMmCount ?? 0)}
          </span>
        </div>
        <div className="px-4 py-3">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-amber-400" />
            Early Buyer Wallets
          </span>
          <span className="mt-1 block font-mono tabular-nums text-base font-semibold text-amber-300">
            {Math.max(counts.early_buyer, holders.earlyBuyersCount ?? 0)}
          </span>
        </div>
        <div className="px-4 py-3">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            Cabal / Dev Linked
          </span>
          <span className="mt-1 block font-mono tabular-nums text-base font-semibold text-rose-300">
            {counts.cabal_dev}
          </span>
        </div>
        <div className="px-4 py-3">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Crown className="w-3 h-3 text-slate-300" />
            Top Holders Traced
          </span>
          <span className="mt-1 block font-mono tabular-nums text-base font-semibold text-white">
            {counts.top_holder}
          </span>
        </div>
      </div>

      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: "all", label: `All (${counts.all})` },
            { id: "possible_mm", label: `Possible MM (${counts.possible_mm})` },
            { id: "early_buyer", label: `Early Buyers (${counts.early_buyer})` },
            { id: "cabal_dev", label: `Cabal & Dev (${counts.cabal_dev})` },
            { id: "top_holder", label: `Top Holders (${counts.top_holder})` },
          ] as const
        ).map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                active
                  ? "bg-[#2934FF]/22 border-[#2934FF]/55 text-white"
                  : "bg-[#090B10] border-white/[0.08] text-slate-400 hover:text-white hover:border-white/20"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Clean Hairline Wallet Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#090B10] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Wallet className="w-6 h-6 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-400">
              No wallets matched this filter on the current on-chain window.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {filtered.map((entry) => {
              const style = CATEGORY_STYLE[entry.category];
              const chain = (entry.chainKey as WatchWalletChain) || defaultChain;
              const watchId = makeWatchedWalletId(entry.address, chain);
              const isWatched = watchedIds.has(watchId);
              const snapshot = activityById[watchId];
              const isBusy = loadingAddr === entry.address;

              return (
                <div key={`${entry.address}-${entry.category}`} className="p-4 hover:bg-white/[0.02] transition-colors space-y-2.5">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Left: Role + Address + Tags */}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded border text-[11px] font-medium ${style.badgeCls}`}
                        >
                          {style.label}
                        </span>
                        {entry.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] font-mono text-[11px] text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                        <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
                          {entry.confidence}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs sm:text-sm text-white break-all">
                          {entry.address}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(entry.address)}
                          aria-label={`Copy ${entry.address}`}
                          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
                        >
                          {copiedAddr === entry.address ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <a
                          href={entry.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-[#84A7FF] hover:text-white"
                        >
                          <span>Explorer</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <p className="text-xs text-slate-400">{entry.reason}</p>
                    </div>

                    {/* Right: Metrics + Live Activity + Watch Button */}
                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      <div className="text-left lg:text-right pr-2">
                        <span className="text-[10px] uppercase tracking-wide text-slate-500 block">
                          Held Supply
                        </span>
                        <span className="font-mono tabular-nums text-sm font-semibold text-white">
                          {entry.holdingPct > 0 ? `${entry.holdingPct.toFixed(2)}%` : "Exited / ~0%"}
                        </span>
                        {(entry.buyCount || entry.sellCount) ? (
                          <span className="block font-mono tabular-nums text-[11px] text-slate-400">
                            {entry.buyCount ?? 0}B / {entry.sellCount ?? 0}S
                          </span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => void inspectLiveActivity(entry)}
                        disabled={isBusy}
                        className="px-3 min-h-[38px] rounded-lg border border-white/12 bg-white/[0.03] hover:bg-white/[0.07] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Activity className="w-3.5 h-3.5 text-[#84A7FF]" />
                        )}
                        <span>{snapshot ? "Hide Feed" : "Live Activity"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleWatch(entry)}
                        className={`px-3.5 min-h-[38px] rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                          isWatched
                            ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20"
                            : "border-[#2934FF]/55 bg-[#2934FF]/20 text-white hover:bg-[#2934FF]/35"
                        }`}
                      >
                        {isWatched ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Watching</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Watch Wallet</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Live Activity Drawer */}
                  {snapshot && (
                    <div className="mt-2 pt-3 border-t border-white/[0.06] space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                        <span className="font-mono">
                          Balance:{" "}
                          <strong className="text-white">
                            {snapshot.nativeBalance || "Unavailable"}
                          </strong>
                          {snapshot.nonce !== null ? ` · Nonce ${snapshot.nonce}` : ""}
                          {snapshot.tokenBalancePct !== null
                            ? ` · Live Token ${snapshot.tokenBalancePct}%`
                            : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => void inspectLiveActivity(entry)}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Close</span>
                        </button>
                      </div>
                      {snapshot.events.length === 0 ? (
                        <p className="text-slate-400">{snapshot.latestSummary}</p>
                      ) : (
                        <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#07090D]">
                          {snapshot.events.slice(0, 4).map((ev) => (
                            <div
                              key={`${ev.txHash}-${ev.action}`}
                              className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                            >
                              <span className="text-slate-200">{ev.summary}</span>
                              <a
                                href={ev.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-[11px] text-[#84A7FF] hover:text-white inline-flex items-center gap-1"
                              >
                                {ev.txHash.slice(0, 10)}...
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Custom Wallet Watch Bar */}
      <form
        onSubmit={handleAddCustomWallet}
        className="rounded-xl border border-white/[0.08] bg-[#090B10] p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
      >
        <input
          type="text"
          value={customWallet}
          onChange={(e) => setCustomWallet(e.target.value)}
          placeholder="Add any Solana or 0x wallet to watch on this token..."
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/65 outline-none text-xs font-mono text-white placeholder:text-slate-500"
        />
        <input
          type="text"
          value={customNote}
          onChange={(e) => setCustomNote(e.target.value)}
          placeholder="Optional label (e.g. MM Bot #2)"
          className="sm:w-52 px-3 py-2 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/65 outline-none text-xs text-white placeholder:text-slate-500"
        />
        <button
          type="submit"
          className="px-4 min-h-[38px] rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Watch</span>
        </button>
        {customFeedback && (
          <span className="text-xs text-emerald-300 font-medium">{customFeedback}</span>
        )}
      </form>
    </div>
  );
}
