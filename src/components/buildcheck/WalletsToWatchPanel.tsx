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
  Search,
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
import {
  BuySellFlowBar,
  formatTelegramWatchCmd,
  getWalletRoleMeta,
  SupplyRetentionMeter,
  WalletActivityTimeline,
  WalletRoleAvatar,
} from "@/components/wallets/WalletWatchPrimitives";

interface WalletsToWatchPanelProps {
  mintAddress: string;
  symbol?: string | null;
  networkName?: string | null;
  chainFamily?: "solana" | "evm" | "unknown";
  holders: HoldersDeepAnalysis;
  devAddress?: string | null;
}

type CategoryFilter = "all" | "possible_mm" | "early_buyer" | "top_holder" | "cabal_dev";
type SortMode = "priority" | "holding" | "swaps" | "earliest";

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
      tags: [getWalletRoleMeta(category).label],
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
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [searchQuery, setSearchQuery] = useState("");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
    let base = entries;
    if (filter === "possible_mm") base = base.filter(isMmMatch);
    else if (filter === "early_buyer") base = base.filter(isEarlyMatch);
    else if (filter === "top_holder") base = base.filter(isTopMatch);
    else if (filter === "cabal_dev") base = base.filter(isCabalDevMatch);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      base = base.filter(
        (e) =>
          e.address.toLowerCase().includes(q) ||
          e.reason.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (sortMode === "holding") {
      return [...base].sort((a, b) => b.holdingPct - a.holdingPct);
    }
    if (sortMode === "swaps") {
      return [...base].sort(
        (a, b) =>
          (b.buyCount || 0) + (b.sellCount || 0) - ((a.buyCount || 0) + (a.sellCount || 0))
      );
    }
    if (sortMode === "earliest") {
      return [...base].sort(
        (a, b) =>
          (a.entryOffset ?? Number.MAX_SAFE_INTEGER) -
          (b.entryOffset ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return base;
  }, [entries, filter, searchQuery, sortMode]);

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
        label: `${symbol ? `$${symbol} · ` : ""}${getWalletRoleMeta(entry.category).label}`,
      });
    }
  };

  const handleCopy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const inspectLiveActivity = async (entry: WalletToWatchEntry, forceFetch = false) => {
    const chain = (entry.chainKey as WatchWalletChain) || defaultChain;
    const id = makeWatchedWalletId(entry.address, chain);
    if (activityById[id] && !forceFetch) {
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
    setCustomFeedback("Saved to your live watchlist.");
    setTimeout(() => setCustomFeedback(null), 2400);
  };

  return (
    <div className="space-y-5" data-testid="wallets-to-watch-panel">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Eye className="w-4 h-4 text-[#84A7FF]" />
            <h3 className="text-sm sm:text-base font-semibold tracking-tight text-white">
              Wallets to Watch on {symbol ? `$${symbol}` : "This Token"}
            </h3>
            <span className="px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.1] font-mono text-[11px] text-slate-300">
              {getChainDisplayName(defaultChain)}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400">
            Traced from live transfers &amp; holder snapshots — spot two-way MM cycling, early launch entries, and clustered wallets before trading.
          </p>
        </div>

        <Link
          href="/wallets"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 min-h-[40px] rounded-lg border border-[#2934FF]/50 bg-[#2934FF]/16 hover:bg-[#2934FF]/28 text-xs font-semibold text-[#D6E4FF] transition-colors shrink-0"
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Open Live Watchlist ({watchedIds.size})</span>
        </Link>
      </div>

      {/* Key Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-white/[0.08] bg-[#090B10] divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
        <div className="px-4 py-3.5 flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-slate-400 block">Possible MM Wallets</span>
            <span className="mt-1 block font-mono tabular-nums text-lg font-semibold text-violet-300">
              {Math.max(counts.possible_mm, holders.possibleMmCount ?? 0)}
            </span>
          </div>
          <ArrowLeftRight className="w-4 h-4 text-violet-400/70 shrink-0" />
        </div>
        <div className="px-4 py-3.5 flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-slate-400 block">Early Buyer Wallets</span>
            <span className="mt-1 block font-mono tabular-nums text-lg font-semibold text-amber-300">
              {Math.max(counts.early_buyer, holders.earlyBuyersCount ?? 0)}
            </span>
          </div>
          <Clock className="w-4 h-4 text-amber-400/70 shrink-0" />
        </div>
        <div className="px-4 py-3.5 flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-slate-400 block">Cabal / Dev Linked</span>
            <span className="mt-1 block font-mono tabular-nums text-lg font-semibold text-rose-300">
              {counts.cabal_dev}
            </span>
          </div>
          <ShieldAlert className="w-4 h-4 text-rose-400/70 shrink-0" />
        </div>
        <div className="px-4 py-3.5 flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] text-slate-400 block">Top Holders Traced</span>
            <span className="mt-1 block font-mono tabular-nums text-lg font-semibold text-white">
              {counts.top_holder}
            </span>
          </div>
          <Crown className="w-4 h-4 text-slate-400/70 shrink-0" />
        </div>
      </div>

      {/* Category Pills + Search & Sort Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
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
                    ? "bg-[#2934FF]/22 border-[#2934FF]/60 text-white"
                    : "bg-[#090B10] border-white/[0.08] text-slate-400 hover:text-white hover:border-white/20"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter wallet..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#090B10] border border-white/[0.08] focus:border-[#2934FF]/60 outline-none text-xs font-mono text-white placeholder:text-slate-500"
            />
          </div>

          <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#090B10] p-0.5 text-[11px]">
            {(
              [
                { id: "priority", label: "Priority" },
                { id: "holding", label: "Held %" },
                { id: "swaps", label: "Swaps" },
                { id: "earliest", label: "Early" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSortMode(s.id)}
                className={`px-2 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                  sortMode === s.id
                    ? "bg-[#2934FF]/25 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Terminal Wallet Rows */}
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
              const roleMeta = getWalletRoleMeta(entry.category);
              const chain = (entry.chainKey as WatchWalletChain) || defaultChain;
              const watchId = makeWatchedWalletId(entry.address, chain);
              const isWatched = watchedIds.has(watchId);
              const snapshot = activityById[watchId];
              const isBusy = loadingAddr === entry.address;
              const secondarySignals = entry.tags
                .filter((t) => t !== roleMeta.label)
                .slice(0, 2)
                .join(" · ");
              const tgCmd = formatTelegramWatchCmd({ address: entry.address, chain });

              return (
                <div
                  key={`${entry.address}-${entry.category}`}
                  className="p-4 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Avatar + Single Badge + Compact Signals + Address */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <WalletRoleAvatar role={entry.category} />

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${roleMeta.badgeCls}`}
                          >
                            {roleMeta.label}
                          </span>
                          {secondarySignals && (
                            <span className="font-mono text-[11px] text-slate-300 truncate">
                              {secondarySignals}
                            </span>
                          )}
                          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                            {entry.confidence}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs sm:text-sm text-white break-all">
                            {entry.address}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(`addr-${entry.address}`, entry.address)}
                            aria-label={`Copy ${entry.address}`}
                            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
                            title="Copy address"
                          >
                            {copiedKey === `addr-${entry.address}` ? (
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
                          <button
                            type="button"
                            onClick={() => handleCopy(`tg-${entry.address}`, tgCmd)}
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer"
                            title={`Copy Telegram command: ${tgCmd}`}
                          >
                            {copiedKey === `tg-${entry.address}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Bell className="w-3 h-3 text-[#84A7FF]" />
                            )}
                            <span>
                              {copiedKey === `tg-${entry.address}` ? "Copied /watch" : "TG /watch"}
                            </span>
                          </button>
                        </div>

                        <p className="text-xs text-slate-400 leading-relaxed">{entry.reason}</p>
                      </div>
                    </div>

                    {/* Right: Supply Retention Bar + Buy/Sell Flow Bar + Actions */}
                    <div className="flex flex-wrap items-center gap-4 shrink-0 pl-12 lg:pl-0">
                      <SupplyRetentionMeter
                        holdingPct={entry.holdingPct}
                        acquiredPct={entry.acquiredPct}
                      />

                      <BuySellFlowBar
                        buyCount={entry.buyCount}
                        sellCount={entry.sellCount}
                      />

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void inspectLiveActivity(entry)}
                          disabled={isBusy}
                          className={`px-3 min-h-[38px] rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 ${
                            snapshot
                              ? "border-[#2934FF]/45 bg-[#2934FF]/15 text-[#BFD0FF]"
                              : "border-white/12 bg-white/[0.03] hover:bg-white/[0.07] text-slate-200"
                          }`}
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
                              ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/22"
                              : "border-[#2934FF]/60 bg-[#2934FF] text-white hover:bg-[#1E28E6]"
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
                  </div>

                  {snapshot && (
                    <WalletActivityTimeline
                      snapshot={snapshot}
                      onRefreshSingle={() => void inspectLiveActivity(entry, true)}
                      onClose={() => void inspectLiveActivity(entry, false)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Any Custom Wallet Bar */}
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
          placeholder="Label (optional)"
          className="sm:w-48 px-3 py-2 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/65 outline-none text-xs text-white placeholder:text-slate-500"
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
