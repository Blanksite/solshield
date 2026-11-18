"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bell,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  ClickSpark,
  CountUp,
  InteractiveDotGrid,
  Magnet,
  SpotlightCard,
} from "@/components/reactbits";
import {
  addOrUpdateLocalWatchedWallet,
  getChainDisplayName,
  getOrCreateLocalWatchlistSyncKey,
  getWatchedWalletExplorerUrl,
  normalizeWatchedAddressClient,
  readLocalWatchedWallets,
  removeLocalWatchedWallet,
  saveLocalWatchedWallets,
  WATCH_CHAIN_META,
  WATCHLIST_CHANGED_EVENT,
  type TrackedWalletItem,
  type WatchedWalletActivitySnapshot,
  type WatchWalletChain,
} from "@/lib/wallet-watch-client";
import {
  formatTelegramWatchCmd,
  getWalletRoleMeta,
  WalletActivityTimeline,
  WalletRoleAvatar,
} from "./WalletWatchPrimitives";

const TAG_PILL_OPTIONS: Array<{ id: TrackedWalletItem["tag"]; label: string }> = [
  { id: "early_buyer", label: "Early Buyer" },
  { id: "possible_mm", label: "Possible MM" },
  { id: "top_holder", label: "Top Holder" },
  { id: "cabal_linked", label: "Cabal Cluster" },
  { id: "dev_linked", label: "Dev / Creator" },
  { id: "custom", label: "Custom Watch" },
];

const DEMO_SAMPLE_WALLETS: Array<{
  address: string;
  chain: WatchWalletChain;
  label: string;
  tag: TrackedWalletItem["tag"];
  tokenSymbol: string;
  tokenAddress: string;
}> = [
  {
    address: "eRFvZSDGxr4PwjEWeKrQtx8UsywjNhsf5pFXNkZtRBH",
    chain: "solana",
    label: "SHIELD Slot+0 Early Buyer",
    tag: "early_buyer",
    tokenSymbol: "SHIELD",
    tokenAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
  },
  {
    address: "0x5136067ccc0065c20ac16cd7191d08564e19d71e",
    chain: "robinhood",
    label: "Archivum Early Buyer (+7 blk)",
    tag: "early_buyer",
    tokenSymbol: "ARCH",
    tokenAddress: "0xda4283f14b487034b90d865aac489994f2c680c4",
  },
  {
    address: "0xa1247f9063ca97ffa7eea68b14c25b111f7d8ce5",
    chain: "robinhood",
    label: "Archivum Two-Way MM",
    tag: "possible_mm",
    tokenSymbol: "ARCH",
    tokenAddress: "0xda4283f14b487034b90d865aac489994f2c680c4",
  },
];

type ChainFilter = "all" | "solana" | "evm";

export default function WalletTrackerPanel() {
  const [wallets, setWallets] = useState<TrackedWalletItem[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, WatchedWalletActivitySnapshot>>({});
  const [newMovesById, setNewMovesById] = useState<Record<string, boolean>>({});
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  const [addressInput, setAddressInput] = useState("");
  const [chainInput, setChainInput] = useState<WatchWalletChain>("robinhood");
  const [tokenInput, setTokenInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [tagInput, setTagInput] = useState<TrackedWalletItem["tag"]>("early_buyer");
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const syncLocal = () => setWallets(readLocalWatchedWallets());
    syncLocal();

    const syncKey = getOrCreateLocalWatchlistSyncKey();
    if (syncKey && readLocalWatchedWallets().length === 0) {
      void fetch(`/api/wallet-tracker?syncKey=${encodeURIComponent(syncKey)}`)
        .then((r) => r.json())
        .then((data: { ok?: boolean; wallets?: TrackedWalletItem[] }) => {
          if (data.ok && Array.isArray(data.wallets) && data.wallets.length > 0) {
            saveLocalWatchedWallets(data.wallets);
            setWallets(data.wallets);
          }
        })
        .catch(() => {});
    }

    window.addEventListener(WATCHLIST_CHANGED_EVENT, syncLocal);
    return () => window.removeEventListener(WATCHLIST_CHANGED_EVENT, syncLocal);
  }, []);

  const refreshLiveActivity = async (targetList?: TrackedWalletItem[]) => {
    const list = (targetList || wallets).slice(0, 10);
    if (list.length === 0) return;
    setIsRefreshingAll(true);
    try {
      const res = await fetch("/api/wallet-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activity",
          wallets: list.map((w) => ({
            address: w.address,
            chain: w.chain,
            tokenAddress: w.tokenAddress || null,
          })),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        snapshots?: WatchedWalletActivitySnapshot[];
      };
      if (json.ok && Array.isArray(json.snapshots)) {
        const nextSnapshots: Record<string, WatchedWalletActivitySnapshot> = {};
        const nextNewMoves: Record<string, boolean> = {};
        const updatedList = readLocalWatchedWallets().map((w) => {
          const snap = json.snapshots!.find(
            (s) =>
              s.chain === w.chain &&
              s.address.toLowerCase() === w.address.toLowerCase()
          );
          if (!snap) return w;
          nextSnapshots[w.id] = snap;
          if (w.lastTxHash && snap.latestTxHash && w.lastTxHash !== snap.latestTxHash) {
            nextNewMoves[w.id] = true;
          }
          return {
            ...w,
            lastCheckedAt: snap.checkedAt,
            lastTxHash: snap.latestTxHash || w.lastTxHash || null,
            lastTxSummary: snap.latestSummary || w.lastTxSummary || null,
            lastNativeBalance: snap.nativeBalance || w.lastNativeBalance || null,
            lastNonce: snap.nonce ?? w.lastNonce ?? null,
          };
        });
        saveLocalWatchedWallets(updatedList);
        setSnapshots((prev) => ({ ...prev, ...nextSnapshots }));
        setNewMovesById((prev) => ({ ...prev, ...nextNewMoves }));
      }
    } catch {
      // Preserve existing state
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleAddressChange = (val: string) => {
    setAddressInput(val);
    setFormError(null);
    const trimmed = val.trim();
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
      setChainInput("solana");
    } else if (trimmed.startsWith("0x") && chainInput === "solana") {
      setChainInput("robinhood");
    }
  };

  const handleAddWallet = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeWatchedAddressClient(addressInput, chainInput);
    if (!norm.valid) {
      setFormError(norm.error || "Please enter a valid Solana or EVM wallet address.");
      return;
    }

    const updated = addOrUpdateLocalWatchedWallet({
      address: norm.address,
      chain: norm.chain,
      label: labelInput.trim() || undefined,
      tag: tagInput,
      tokenAddress: tokenInput.trim() || null,
    });
    setAddressInput("");
    setTokenInput("");
    setLabelInput("");
    setFormError(null);
    void refreshLiveActivity(updated.slice(0, 1));
  };

  const handleLoadSamples = () => {
    let latest: TrackedWalletItem[] = [];
    for (const s of [...DEMO_SAMPLE_WALLETS].reverse()) {
      latest = addOrUpdateLocalWatchedWallet(s);
    }
    void refreshLiveActivity(latest.slice(0, 3));
  };

  const handleCopy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const chainSummary = useMemo(() => {
    return {
      total: wallets.length,
      solana: wallets.filter((w) => w.chain === "solana").length,
      evm: wallets.filter((w) => w.chain !== "solana").length,
      newMoves: Object.values(newMovesById).filter(Boolean).length,
    };
  }, [wallets, newMovesById]);

  const filteredWallets = useMemo(() => {
    let list = wallets;
    if (chainFilter === "solana") list = list.filter((w) => w.chain === "solana");
    else if (chainFilter === "evm") list = list.filter((w) => w.chain !== "solana");

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (w) =>
          w.address.toLowerCase().includes(q) ||
          w.label.toLowerCase().includes(q) ||
          (w.tokenSymbol || "").toLowerCase().includes(q) ||
          w.chain.toLowerCase().includes(q)
      );
    }
    return list;
  }, [wallets, chainFilter, searchQuery]);

  return (
    <ClickSpark sparkColor="#2934FF" sparkSize={10} sparkRadius={18} sparkCount={8}>
      <div className="min-h-screen bg-[#07080D] text-white selection:bg-[#2934FF] selection:text-white relative overflow-x-clip">
        <InteractiveDotGrid
          className="opacity-30"
          baseColor="rgba(148, 163, 184, 0.25)"
          activeColor="rgba(41, 52, 255, 0.7)"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 -top-40 h-[460px] z-0"
          style={{
            background:
              "radial-gradient(62% 56% at 50% 0%, rgba(41, 52, 255, 0.22) 0%, rgba(79, 70, 229, 0.06) 48%, rgba(7, 8, 13, 0) 100%)",
          }}
        />

        {/* Sticky Top Header */}
        <header className="border-b border-white/[0.08] bg-[#0A0C12]/92 backdrop-blur-xl sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Magnet padding={20} magnetStrength={4}>
                <Link
                  href="/buildcheck"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>BuildCheck</span>
                </Link>
              </Magnet>
              <span className="text-white/20">/</span>
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/logo.png?v=2"
                  alt="SolShield Logo"
                  className="w-7 h-7 rounded-md border border-white/15 shrink-0 hidden sm:block"
                />
                <Eye className="w-4 h-4 text-[#84A7FF] shrink-0 sm:hidden" />
                <span className="font-semibold tracking-tight text-sm sm:text-base whitespace-nowrap">
                  <span className="hidden sm:inline">Wallets to Watch</span>
                  <span className="sm:hidden">Watchlist</span>
                </span>
              </div>
              <Link
                href="/wallet-detox"
                className="hidden md:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-emerald-300/90 hover:text-white border border-emerald-500/25 hover:border-emerald-400/50 bg-emerald-500/[0.06] transition-colors"
              >
                Wallet Detox
              </Link>
              <Link
                href="/dev-lineage"
                className="hidden lg:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-purple-300/90 hover:text-white border border-purple-500/25 hover:border-purple-400/50 bg-purple-500/[0.06] transition-colors"
              >
                Dev Lineage
              </Link>
            </div>

            <button
              type="button"
              onClick={() => void refreshLiveActivity()}
              disabled={isRefreshingAll || wallets.length === 0}
              className="px-3.5 min-h-[38px] rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 shrink-0 transition-colors shadow-[0_6px_18px_rgba(41,52,255,0.28)]"
            >
              {isRefreshingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>
                <span className="hidden sm:inline">Refresh Live Activity</span>
                <span className="sm:hidden">Refresh</span>
              </span>
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-7 sm:py-9 space-y-6 relative z-10">
          {/* Hero Command Header + Quick Actions */}
          <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-[#2934FF]/35 bg-[#2934FF]/10 text-[11px] font-mono text-[#BFD0FF]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>SOLANA · ETHEREUM · BASE · ROBINHOOD L2</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-[1.15] text-white">
                Multi-Chain Wallet Watchlist &amp; Activity Feed
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                Monitor possible Market Makers, early buyers, devs, and whale holders across EVM and Solana — inspect live buy/sell flows or push 24/7 alerts into Telegram.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleLoadSamples}
                className="px-3.5 min-h-[40px] rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#84A7FF]" />
                <span>Load Sample Wallets</span>
              </button>
              <a
                href="https://t.me/UseSolShieldBot"
                target="_blank"
                rel="noreferrer"
                className="px-3.5 min-h-[40px] rounded-lg border border-[#2934FF]/40 bg-[#2934FF]/12 hover:bg-[#2934FF]/22 text-xs font-medium text-[#BFD0FF] inline-flex items-center gap-1.5 transition-colors"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Telegram /watch Alerts</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </section>

          {/* Telemetry KPI Strip */}
          <SpotlightCard
            className="rounded-xl border border-white/[0.09] bg-[#0C0F16]/90 backdrop-blur"
            spotlightColor="rgba(41, 52, 255, 0.16)"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07]">
              <div className="px-5 py-4">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                  Watched Wallets
                </span>
                <span className="mt-1 block font-mono tabular-nums text-2xl font-semibold text-white">
                  <CountUp to={chainSummary.total} durationMs={650} />
                </span>
              </div>
              <div className="px-5 py-4">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                  Solana Targets
                </span>
                <span className="mt-1 block font-mono tabular-nums text-2xl font-semibold text-[#84A7FF]">
                  <CountUp to={chainSummary.solana} durationMs={650} />
                </span>
              </div>
              <div className="px-5 py-4">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                  EVM Targets
                </span>
                <span className="mt-1 block font-mono tabular-nums text-2xl font-semibold text-emerald-300">
                  <CountUp to={chainSummary.evm} durationMs={650} />
                </span>
              </div>
              <div className="px-5 py-4">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                  New Moves Detected
                </span>
                <span className="mt-1 block font-mono tabular-nums text-2xl font-semibold text-amber-300">
                  <CountUp to={chainSummary.newMoves} durationMs={650} />
                </span>
              </div>
            </div>
          </SpotlightCard>

          {/* Polished Track New Wallet Console (Pill Controls, zero ugly native dropdowns) */}
          <SpotlightCard
            className="rounded-xl border border-white/[0.09] bg-[#0C0F16]/95 p-5 space-y-4"
            spotlightColor="rgba(41, 52, 255, 0.14)"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#84A7FF]" />
                <span>Add Wallet to Watchlist</span>
              </h2>
              <span className="text-[11px] font-mono text-slate-500">
                Auto-detects Solana Base58 vs EVM 0x addresses
              </span>
            </div>

            <form onSubmit={handleAddWallet} className="space-y-3.5">
              {/* Address + Label + Token + Submit */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                <div className="md:col-span-5">
                  <input
                    type="text"
                    value={addressInput}
                    onChange={(e) => handleAddressChange(e.target.value)}
                    placeholder="Paste Solana or EVM (0x...) wallet address"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#07080D] border border-white/[0.12] focus:border-[#2934FF]/75 outline-none text-xs font-mono text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="md:col-span-3">
                  <input
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="Label (e.g. MM Bot #1)"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#07080D] border border-white/[0.12] focus:border-[#2934FF]/75 outline-none text-xs text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <input
                    type="text"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Token CA (optional)"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/75 outline-none text-xs font-mono text-slate-200 placeholder:text-slate-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full min-h-[40px] rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Wallet</span>
                  </button>
                </div>
              </div>

              {/* Clean Segmented Chain & Role Pills */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-mono text-slate-500 mr-1">Chain:</span>
                  {Object.values(WATCH_CHAIN_META).map((meta) => {
                    const active = chainInput === meta.key;
                    return (
                      <button
                        key={meta.key}
                        type="button"
                        onClick={() => setChainInput(meta.key)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                          active
                            ? "border-[#2934FF]/65 bg-[#2934FF]/22 text-white"
                            : "border-white/[0.08] bg-[#07080D] text-slate-400 hover:text-white hover:border-white/20"
                        }`}
                      >
                        {meta.shortName}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-mono text-slate-500 mr-1">Role:</span>
                  {TAG_PILL_OPTIONS.map((opt) => {
                    const active = tagInput === opt.id;
                    const roleMeta = getWalletRoleMeta(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTagInput(opt.id)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                          active
                            ? roleMeta.badgeCls
                            : "border-white/[0.08] bg-[#07080D] text-slate-400 hover:text-white hover:border-white/20"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </form>

            {formError && <p className="text-xs text-rose-400">{formError}</p>}
          </SpotlightCard>

          {/* Active Watchlist Feed */}
          <section className="rounded-xl border border-white/[0.09] bg-[#0C0F16]/95 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.07] bg-white/[0.015] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-200 mr-2">
                  Active Watchlist Feed ({filteredWallets.length})
                </span>
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "solana", label: "Solana" },
                    { id: "evm", label: "EVM" },
                  ] as const
                ).map((cf) => (
                  <button
                    key={cf.id}
                    type="button"
                    onClick={() => setChainFilter(cf.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono border cursor-pointer transition-colors ${
                      chainFilter === cf.id
                        ? "border-[#2934FF]/55 bg-[#2934FF]/20 text-white"
                        : "border-white/[0.08] bg-[#07080D] text-slate-400 hover:text-white"
                    }`}
                  >
                    {cf.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search label, ticker, or wallet..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#07080D] border border-white/[0.09] focus:border-[#2934FF]/60 outline-none text-xs font-mono text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {filteredWallets.length === 0 ? (
              <div className="p-10 text-center space-y-4">
                <div className="w-11 h-11 rounded-2xl border border-[#2934FF]/35 bg-[#2934FF]/12 flex items-center justify-center mx-auto text-[#84A7FF]">
                  <Wallet className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">
                    {wallets.length === 0
                      ? "Your Multi-Chain Watchlist Is Empty"
                      : "No watched wallets match your filter"}
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    {wallets.length === 0
                      ? "Paste any Solana or EVM wallet above, load live example wallets ($ARCH + $SHIELD), or click Watch Wallet inside any BuildCheck audit."
                      : "Clear the chain filter or search query to view all watched wallets."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {wallets.length === 0 && (
                    <button
                      type="button"
                      onClick={handleLoadSamples}
                      className="px-4 min-h-[38px] rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Load Live Example Wallets</span>
                    </button>
                  )}
                  <Link
                    href="/buildcheck"
                    className="inline-flex items-center gap-1.5 px-4 min-h-[38px] rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-white"
                  >
                    <span>Open BuildCheck Auditor</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {filteredWallets.map((w) => {
                  const snap = snapshots[w.id];
                  const roleMeta = getWalletRoleMeta(w.tag);
                  const isNewMove = Boolean(newMovesById[w.id]);
                  const tgCommand = formatTelegramWatchCmd(w);

                  return (
                    <div
                      key={w.id}
                      className="p-5 hover:bg-white/[0.015] transition-colors"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <WalletRoleAvatar role={w.tag} />

                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.1] font-mono text-[11px] text-slate-200">
                                {getChainDisplayName(w.chain)}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${roleMeta.badgeCls}`}
                              >
                                {roleMeta.label}
                              </span>
                              <span className="text-xs sm:text-sm font-medium text-white">
                                {w.label}
                              </span>
                              {w.tokenSymbol && (
                                <Link
                                  href={`/buildcheck?target=${encodeURIComponent(w.tokenAddress || w.tokenSymbol)}`}
                                  className="px-1.5 py-0.5 rounded bg-[#2934FF]/15 border border-[#2934FF]/35 hover:border-[#60A5FA]/70 font-mono text-[10px] text-[#BFD0FF] transition-colors"
                                  title="Open token audit in BuildCheck"
                                >
                                  ${w.tokenSymbol}
                                </Link>
                              )}
                              {isNewMove && (
                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 font-mono text-[10px] text-emerald-300">
                                  NEW ACTIVITY
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs sm:text-sm text-slate-200 break-all">
                                {w.address}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(`addr-${w.id}`, w.address)}
                                className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
                                aria-label="Copy address"
                              >
                                {copiedKey === `addr-${w.id}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <a
                                href={getWatchedWalletExplorerUrl(w.address, w.chain)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-mono text-[#84A7FF] hover:text-white"
                              >
                                <span>Explorer</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              {w.tokenAddress && !w.tokenSymbol && (
                                <Link
                                  href={`/buildcheck?target=${encodeURIComponent(w.tokenAddress)}`}
                                  className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-white"
                                >
                                  <span>Audit Token</span>
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              )}
                            </div>

                            <p className="text-xs text-slate-400">
                              {snap?.latestSummary ||
                                w.lastTxSummary ||
                                "Click Refresh Live Activity to fetch current balance and recent moves."}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0 pl-12 lg:pl-0">
                          <div className="text-left lg:text-right pr-2">
                            <span className="text-[10px] uppercase tracking-wide text-slate-500 block">
                              Native Balance
                            </span>
                            <span className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-white">
                              {snap?.nativeBalance || w.lastNativeBalance || "—"}
                            </span>
                            {(snap?.tokenBalancePct ?? null) !== null && (
                              <span className="block font-mono tabular-nums text-[11px] text-emerald-300">
                                Token {snap!.tokenBalancePct}%
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleCopy(`tg-${w.id}`, tgCommand)}
                            title={`Copy Telegram command: ${tgCommand}`}
                            className="px-2.5 min-h-[36px] rounded-lg border border-white/12 bg-white/[0.03] hover:bg-white/[0.08] text-[11px] font-mono text-slate-300 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            {copiedKey === `tg-${w.id}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Bell className="w-3 h-3 text-[#84A7FF]" />
                            )}
                            <span>
                              {copiedKey === `tg-${w.id}` ? "Copied /watch" : "TG Alert Cmd"}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void refreshLiveActivity([w])}
                            className="p-2 rounded-lg border border-white/12 bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white cursor-pointer transition-colors"
                            title="Check this wallet now"
                          >
                            <Activity className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => removeLocalWatchedWallet(w.address, w.chain)}
                            className="p-2 rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 cursor-pointer transition-colors"
                            title="Remove from watchlist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {snap && (
                        <WalletActivityTimeline
                          snapshot={snap}
                          onRefreshSingle={() => void refreshLiveActivity([w])}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    </ClickSpark>
  );
}
