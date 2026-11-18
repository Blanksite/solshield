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
  Trash2,
  Wallet,
} from "lucide-react";
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

const TAG_STYLE: Record<TrackedWalletItem["tag"], { label: string; cls: string }> = {
  possible_mm: {
    label: "Possible MM",
    cls: "border-violet-500/40 bg-violet-500/15 text-violet-300",
  },
  early_buyer: {
    label: "Early Buyer",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  cabal_linked: {
    label: "Cabal Cluster",
    cls: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  },
  dev_linked: {
    label: "Dev / Creator",
    cls: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  },
  top_holder: {
    label: "Top Holder",
    cls: "border-white/20 bg-white/[0.06] text-slate-200",
  },
  custom: {
    label: "Custom Watch",
    cls: "border-emerald-500/35 bg-emerald-500/12 text-emerald-300",
  },
};

export default function WalletTrackerPanel() {
  const [wallets, setWallets] = useState<TrackedWalletItem[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, WatchedWalletActivitySnapshot>>({});
  const [newMovesById, setNewMovesById] = useState<Record<string, boolean>>({});
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  const [addressInput, setAddressInput] = useState("");
  const [chainInput, setChainInput] = useState<WatchWalletChain>("robinhood");
  const [tokenInput, setTokenInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [tagInput, setTagInput] = useState<TrackedWalletItem["tag"]>("custom");
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const syncLocal = () => setWallets(readLocalWatchedWallets());
    syncLocal();

    // Hydrate from distributed Upstash Redis if local storage was empty
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
      // Keep previous snapshots cleanly
    } finally {
      setIsRefreshingAll(false);
    }
  };

  // Auto-select Solana chain when user pastes a Base58 address
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

  return (
    <div className="min-h-screen bg-[#07080D] text-white">
      <header className="border-b border-white/[0.08] bg-[#0A0C12]/92 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/buildcheck"
              className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>BuildCheck</span>
            </Link>
            <span className="text-white/20">/</span>
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="w-4 h-4 text-[#84A7FF] shrink-0" />
              <span className="font-semibold tracking-tight text-sm sm:text-base truncate">
                Wallets to Watch
              </span>
            </div>
            <Link
              href="/wallet-detox"
              className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-emerald-300/90 hover:text-white border border-emerald-500/25 bg-emerald-500/[0.06]"
            >
              Wallet Detox
            </Link>
            <Link
              href="/dev-lineage"
              className="hidden md:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-purple-300/90 hover:text-white border border-purple-500/25 bg-purple-500/[0.06]"
            >
              Dev Lineage
            </Link>
          </div>

          <button
            type="button"
            onClick={() => void refreshLiveActivity()}
            disabled={isRefreshingAll || wallets.length === 0}
            className="px-3.5 min-h-[38px] rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 shrink-0"
          >
            {isRefreshingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Refresh Live Activity</span>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Hero / 3-Second Clarity */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
              Multi-Chain Wallet Tracker &amp; Watchlist
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              Track possible Market Makers, early buyers, devs, and top holders across Solana, Ethereum, Base, and Robinhood L2 — inspect live token movements or mirror alerts into Telegram.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-white/[0.08] bg-[#0D1017] divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
            <div className="px-4 py-3">
              <span className="text-xs text-slate-400 block">Watched Wallets</span>
              <span className="mt-1 font-mono tabular-nums text-lg font-semibold text-white">
                {chainSummary.total}
              </span>
            </div>
            <div className="px-4 py-3">
              <span className="text-xs text-slate-400 block">Solana Targets</span>
              <span className="mt-1 font-mono tabular-nums text-lg font-semibold text-[#84A7FF]">
                {chainSummary.solana}
              </span>
            </div>
            <div className="px-4 py-3">
              <span className="text-xs text-slate-400 block">EVM Targets</span>
              <span className="mt-1 font-mono tabular-nums text-lg font-semibold text-emerald-300">
                {chainSummary.evm}
              </span>
            </div>
            <div className="px-4 py-3">
              <span className="text-xs text-slate-400 block">New Moves Detected</span>
              <span className="mt-1 font-mono tabular-nums text-lg font-semibold text-amber-300">
                {chainSummary.newMoves}
              </span>
            </div>
          </div>
        </section>

        {/* Add Wallet Form */}
        <section className="rounded-xl border border-white/[0.08] bg-[#0D1017] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#84A7FF]" />
              <span>Track New Wallet</span>
            </h2>
            <a
              href="https://t.me/UseSolShieldBot"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#84A7FF] hover:text-white inline-flex items-center gap-1"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>24/7 Telegram Push Alerts via @UseSolShieldBot</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <form onSubmit={handleAddWallet} className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-4">
              <input
                type="text"
                value={addressInput}
                onChange={(e) => handleAddressChange(e.target.value)}
                placeholder="Wallet address (Solana or 0x...)"
                className="w-full px-3 py-2.5 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/70 outline-none text-xs font-mono text-white placeholder:text-slate-500"
              />
            </div>

            <div className="md:col-span-2">
              <select
                value={chainInput}
                onChange={(e) => setChainInput(e.target.value as WatchWalletChain)}
                className="w-full px-3 py-2.5 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/70 outline-none text-xs text-white"
              >
                {Object.values(WATCH_CHAIN_META).map((meta) => (
                  <option key={meta.key} value={meta.key}>
                    {meta.shortName}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value as TrackedWalletItem["tag"])}
                className="w-full px-3 py-2.5 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/70 outline-none text-xs text-white"
              >
                <option value="custom">Custom Watch</option>
                <option value="possible_mm">Possible MM</option>
                <option value="early_buyer">Early Buyer</option>
                <option value="top_holder">Top Holder</option>
                <option value="cabal_linked">Cabal Cluster</option>
                <option value="dev_linked">Dev / Creator</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Label (e.g. Smart Whale)"
                className="w-full px-3 py-2.5 rounded-lg bg-[#07080D] border border-white/[0.1] focus:border-[#2934FF]/70 outline-none text-xs text-white placeholder:text-slate-500"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="w-full min-h-[40px] rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Wallet</span>
              </button>
            </div>

            <div className="md:col-span-12">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Optional: Token Contract Address (tracks specific ERC-20 / SPL buy & sell transfers for this wallet)"
                className="w-full px-3 py-2 rounded-lg bg-[#07080D] border border-white/[0.08] focus:border-[#2934FF]/60 outline-none text-xs font-mono text-slate-200 placeholder:text-slate-500"
              />
            </div>
          </form>

          {formError && <p className="text-xs text-rose-400">{formError}</p>}
        </section>

        {/* Watched Wallets Feed */}
        <section className="rounded-xl border border-white/[0.08] bg-[#0D1017] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Active Watchlist Feed
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              Synced locally &amp; persistent storage
            </span>
          </div>

          {wallets.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Wallet className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-white">No wallets watched yet</p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Paste any address above or click <strong className="text-slate-200">Watch Wallet</strong> inside any BuildCheck token report&apos;s <strong className="text-slate-200">Wallets to Watch</strong> tab.
                </p>
              </div>
              <Link
                href="/buildcheck"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-white"
              >
                <span>Scan a Token in BuildCheck</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {wallets.map((w) => {
                const snap = snapshots[w.id];
                const tagMeta = TAG_STYLE[w.tag] || TAG_STYLE.custom;
                const isNewMove = Boolean(newMovesById[w.id]);
                const tgCommand = `/watch ${w.address}${w.chain !== "solana" ? ` ${w.chain}` : ""}`;

                return (
                  <div key={w.id} className="p-5 space-y-3 hover:bg-white/[0.015] transition-colors">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-white/[0.06] border border-white/10 font-mono text-[11px] text-slate-200">
                            {getChainDisplayName(w.chain)}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-medium ${tagMeta.cls}`}
                          >
                            {tagMeta.label}
                          </span>
                          <span className="text-xs font-medium text-white">{w.label}</span>
                          {w.tokenSymbol && (
                            <span className="px-1.5 py-0.5 rounded bg-[#2934FF]/15 border border-[#2934FF]/35 font-mono text-[10px] text-[#BFD0FF]">
                              ${w.tokenSymbol}
                            </span>
                          )}
                          {isNewMove && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 font-mono text-[10px] text-emerald-300">
                              NEW ACTIVITY
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs sm:text-sm text-white break-all">
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
                        </div>

                        <p className="text-xs text-slate-400">
                          {snap?.latestSummary || w.lastTxSummary || "Click Refresh Live Activity to fetch current balance and recent moves."}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
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
                          className="px-2.5 min-h-[36px] rounded-lg border border-white/12 bg-white/[0.03] hover:bg-white/[0.07] text-[11px] font-mono text-slate-300 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedKey === `tg-${w.id}` ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Bell className="w-3 h-3 text-[#84A7FF]" />
                          )}
                          <span>{copiedKey === `tg-${w.id}` ? "Copied /watch" : "TG Alert Cmd"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void refreshLiveActivity([w])}
                          className="p-2 rounded-lg border border-white/12 bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 hover:text-white cursor-pointer"
                          title="Check this wallet now"
                        >
                          <Activity className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => removeLocalWatchedWallet(w.address, w.chain)}
                          className="p-2 rounded-lg border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 cursor-pointer"
                          title="Remove from watchlist"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {snap && snap.events.length > 0 && (
                      <div className="rounded-lg border border-white/[0.06] bg-[#07090D] divide-y divide-white/[0.05]">
                        {snap.events.slice(0, 4).map((ev) => (
                          <div
                            key={`${ev.txHash}-${ev.action}`}
                            className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-slate-200">{ev.summary}</span>
                            <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                              {ev.timestamp && (
                                <span>{new Date(ev.timestamp).toLocaleString()}</span>
                              )}
                              <a
                                href={ev.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#84A7FF] hover:text-white inline-flex items-center gap-1"
                              >
                                {ev.txHash.slice(0, 10)}...
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
