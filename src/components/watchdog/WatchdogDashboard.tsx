"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  GitBranch,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { WatchedProjectRecord } from "@/lib/project-watchdog";

const SYNC_KEY_STORAGE = "solshield_watchdog_sync_key_v1";

export function getOrCreateWatchdogSyncKey(): string {
  if (typeof window === "undefined") return "000000000000000000000000";
  try {
    const existing = localStorage.getItem(SYNC_KEY_STORAGE);
    if (existing && /^[a-f0-9]{16,48}$/i.test(existing)) return existing;
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(SYNC_KEY_STORAGE, hex);
    return hex;
  } catch {
    return "0123456789abcdef01234567";
  }
}

export default function WatchdogDashboard() {
  const [syncKey, setSyncKey] = useState("");
  const [projects, setProjects] = useState<WatchedProjectRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chain, setChain] = useState("robinhood");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [githubRepo, setGithubRepo] = useState("");

  useEffect(() => {
    const key = getOrCreateWatchdogSyncKey();
    setSyncKey(key);

    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (p.get("label")) setLabel(p.get("label") || "");
      if (p.get("ca")) setContractAddress(p.get("ca") || "");
      if (p.get("chain")) setChain(p.get("chain") || "robinhood");
      if (p.get("web")) setWebsiteUrl(p.get("web") || "");
      if (p.get("repo")) setGithubRepo(p.get("repo") || "");
    }

    void (async () => {
      const res = await fetch(`/api/watchdog?syncKey=${encodeURIComponent(key)}`, {
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.projects)) {
          setProjects(data.projects as WatchedProjectRecord[]);
        }
      }
    })();
  }, []);

  async function handleAddProject(e: React.FormEvent) {
    e.preventDefault();
    if (!syncKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/watchdog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "add",
          syncKey,
          label: label.trim() || undefined,
          contractAddress: contractAddress.trim() || undefined,
          chain,
          websiteUrl: websiteUrl.trim() || undefined,
          githubRepo: githubRepo.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to add project");
      if (Array.isArray(data.projects)) {
        setProjects(data.projects as WatchedProjectRecord[]);
      }
      setLabel("");
      setContractAddress("");
      setWebsiteUrl("");
      setGithubRepo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to monitor project");
    } finally {
      setLoading(false);
    }
  }

  async function handleProbe(id?: string) {
    if (!syncKey) return;
    setProbingId(id || "ALL");
    setError(null);
    try {
      const res = await fetch("/api/watchdog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: id ? "probe" : "probe_all",
          syncKey,
          id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Re-probe failed");
      if (Array.isArray(data.projects)) {
        setProjects(data.projects as WatchedProjectRecord[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-probe failed");
    } finally {
      setProbingId(null);
    }
  }

  async function handleRemove(id: string) {
    if (!syncKey) return;
    const res = await fetch("/api/watchdog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "remove", syncKey, id }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.projects)) {
        setProjects(data.projects as WatchedProjectRecord[]);
      }
    }
  }

  async function copyTgWatchCommand(proj: WatchedProjectRecord) {
    const target = proj.contractAddress || proj.githubRepo || proj.websiteUrl || "";
    const cmd = `/watchproject ${target}${proj.contractAddress ? ` ${proj.chain}` : ""}`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedId(proj.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore
    }
  }

  const mutatedCount = projects.filter((p) => p.status === "MUTATED").length;
  const ghostingCount = projects.filter((p) => p.status === "GHOSTING").length;

  return (
    <div className="solshield-subpage min-h-screen bg-[#06080E] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#06080E]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/buildcheck"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>BuildCheck</span>
            </Link>
            <span className="text-slate-700">/</span>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">
                Proof-of-Ship Watchdog
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/wallets"
              className="hidden sm:inline-flex px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/[0.05]"
            >
              Wallets
            </Link>
            <Link
              href="/autopsy"
              className="hidden sm:inline-flex px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/[0.05]"
            >
              Rug Autopsy
            </Link>
            <Link
              href="/agent-firewall"
              className="hidden sm:inline-flex px-2.5 py-1 rounded-md text-xs text-sky-300 hover:bg-sky-500/10 border border-sky-500/25"
            >
              Agent MCP
            </Link>
            <button
              type="button"
              disabled={probingId !== null || projects.length === 0}
              onClick={() => handleProbe()}
              className="px-3 py-1.5 rounded-lg bg-[#2934FF] hover:bg-[#3843FF] disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${probingId === "ALL" ? "animate-spin" : ""}`}
              />
              <span>Re-Probe All</span>
            </button>
            <ThemeToggleButton />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        <section className="space-y-3 max-w-3xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white leading-[1.15]">
            Continuous Proof-of-Ship Watchdog.
          </h1>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Catch post-launch rugs after the initial scan. SolShield continuously checks
            all 3 layers against your baseline: on-chain proxy/tax/LP mutations, live
            website availability &amp; phishing redirects, and GitHub repo visibility or
            dev ghosting.
          </p>
        </section>

        {/* Summary Strip */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-xl border border-white/[0.08] bg-[#0B0F19]">
            <div className="text-xs text-slate-400">Monitored Projects</div>
            <div className="text-2xl font-mono font-bold text-white mt-1">
              {projects.length}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-white/[0.08] bg-[#0B0F19]">
            <div className="text-xs text-slate-400">Critical Mutations</div>
            <div className="text-2xl font-mono font-bold text-rose-400 mt-1">
              {mutatedCount}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-white/[0.08] bg-[#0B0F19]">
            <div className="text-xs text-slate-400">Ghosting / Offline</div>
            <div className="text-2xl font-mono font-bold text-amber-300 mt-1">
              {ghostingCount}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-white/[0.08] bg-[#0B0F19]">
            <div className="text-xs text-slate-400">Telegram Command</div>
            <div className="text-sm font-mono font-semibold text-sky-300 mt-2 truncate">
              /watchproject &lt;CA&gt;
            </div>
          </div>
        </section>

        {/* Add Project Form */}
        <section className="rounded-xl border border-white/[0.08] bg-[#0B0F19] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">
              Add Project to 3-Layer Continuous Monitor
            </h2>
            <button
              type="button"
              onClick={() => {
                setLabel("Archivum ($ARCH)");
                setContractAddress("0xda4283f14b487034b90d865aac489994f2c680c4");
                setChain("robinhood");
                setGithubRepo("tryarchivum/archivum");
                setWebsiteUrl("");
              }}
              className="text-xs font-mono text-sky-300 hover:text-sky-200 cursor-pointer"
            >
              Load Archivum Sample
            </button>
          </div>

          <form onSubmit={handleAddProject} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Project label (e.g. Archivum $ARCH)"
                className="sm:col-span-3 h-10 px-3 rounded-lg bg-[#06080E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-sky-400"
              />
              <input
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value)}
                placeholder="Solana CA or EVM 0x contract (optional)"
                className="sm:col-span-6 h-10 px-3 rounded-lg bg-[#06080E] border border-white/[0.1] text-sm font-mono text-white focus:outline-none focus:border-sky-400"
              />
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className="sm:col-span-3 h-10 px-3 rounded-lg bg-[#06080E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-sky-400"
              >
                <option value="robinhood">Robinhood L2</option>
                <option value="solana">Solana</option>
                <option value="base">Base</option>
                <option value="ethereum">Ethereum</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="optimism">Optimism</option>
                <option value="polygon">Polygon</option>
                <option value="bsc">BSC</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="Live Website URL (e.g. https://sol-shield.xyz)"
                className="sm:col-span-5 h-10 px-3 rounded-lg bg-[#06080E] border border-white/[0.1] text-sm font-mono text-white focus:outline-none focus:border-sky-400"
              />
              <input
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="GitHub repo (owner/repo or URL)"
                className="sm:col-span-4 h-10 px-3 rounded-lg bg-[#06080E] border border-white/[0.1] text-sm font-mono text-white focus:outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={loading}
                className="sm:col-span-3 h-10 rounded-lg bg-[#2934FF] hover:bg-[#3843FF] disabled:opacity-60 text-sm font-semibold text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Capturing Baseline...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>Monitor Project</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {error && (
            <div className="p-3 rounded-lg border border-rose-500/35 bg-rose-500/10 text-xs text-rose-300">
              {error}
            </div>
          )}
        </section>

        {/* Monitored Projects List */}
        <section className="space-y-4">
          {projects.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0F19] p-10 text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-300">
                No projects monitored yet
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Add a token contract, website, or GitHub repo above (or click &ldquo;Monitor
                Project&rdquo; on any BuildCheck audit) to detect silent post-launch
                mutations.
              </p>
            </div>
          ) : (
            projects.map((proj) => {
              const statusBadge =
                proj.status === "MUTATED"
                  ? "text-rose-300 border-rose-500/45 bg-rose-500/15"
                  : proj.status === "GHOSTING"
                    ? "text-amber-300 border-amber-500/45 bg-amber-500/15"
                    : proj.status === "SHIPPING"
                      ? "text-sky-300 border-sky-500/45 bg-sky-500/15"
                      : "text-emerald-300 border-emerald-500/45 bg-emerald-500/15";

              return (
                <div
                  key={proj.id}
                  className="rounded-xl border border-white/[0.08] bg-[#0B0F19] overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border ${statusBadge}`}
                        >
                          {proj.status}
                        </span>
                        <h3 className="text-base font-semibold text-white truncate">
                          {proj.label}
                        </h3>
                        <span className="text-xs font-mono text-slate-500 uppercase">
                          {proj.chain}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-400">
                        Last probed: {new Date(proj.latest.checkedAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyTgWatchCommand(proj)}
                        className="px-2.5 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.07] text-xs font-mono text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedId === proj.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied TG Cmd</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>TG /watchproject</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={probingId !== null}
                        onClick={() => handleProbe(proj.id)}
                        className="px-3 py-1.5 rounded-lg border border-sky-500/35 bg-sky-500/10 hover:bg-sky-500/18 text-xs font-medium text-sky-200 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${probingId === proj.id ? "animate-spin" : ""}`}
                        />
                        <span>Re-Probe</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemove(proj.id)}
                        className="p-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-rose-300 hover:border-rose-500/35 cursor-pointer"
                        aria-label="Remove project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 3-Layer Status Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
                    {/* Layer 1: On-Chain */}
                    <div className="p-4 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                        <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                        <span>Layer 1 · On-Chain Bytecode &amp; LP</span>
                      </div>
                      {!proj.latest.onchain.queried ? (
                        <p className="text-xs text-slate-500">No contract configured</p>
                      ) : proj.latest.onchain.error ? (
                        <p className="text-xs text-amber-300">
                          {proj.latest.onchain.error}
                        </p>
                      ) : (
                        <div className="text-xs font-mono text-slate-300 space-y-0.5">
                          <div>
                            Proxy:{" "}
                            <span
                              className={
                                proj.latest.onchain.isProxy
                                  ? "text-amber-300"
                                  : "text-emerald-300"
                              }
                            >
                              {proj.latest.onchain.isProxy ? "UPGRADEABLE" : "Non-Proxy"}
                            </span>
                          </div>
                          <div>
                            Exit / Tax:{" "}
                            <span className="text-white">
                              {proj.latest.onchain.honeypotStatus || "Checked"}{" "}
                              {proj.latest.onchain.sellTaxPct !== null
                                ? `(${proj.latest.onchain.sellTaxPct}%)`
                                : ""}
                            </span>
                          </div>
                          <div>
                            DEX LP:{" "}
                            <span className="text-white">
                              {proj.latest.onchain.liquidityUsd !== null
                                ? `$${proj.latest.onchain.liquidityUsd.toLocaleString()}`
                                : "Unindexed"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Layer 2: Live Web */}
                    <div className="p-4 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                        <Globe className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Layer 2 · Live Website &amp; Domain</span>
                      </div>
                      {!proj.latest.web.queried ? (
                        <p className="text-xs text-slate-500">No website configured</p>
                      ) : (
                        <div className="text-xs font-mono text-slate-300 space-y-0.5">
                          <div>
                            Status:{" "}
                            <span
                              className={
                                proj.latest.web.online
                                  ? "text-emerald-300"
                                  : "text-rose-400"
                              }
                            >
                              {proj.latest.web.online
                                ? `ONLINE (${proj.latest.web.httpStatus})`
                                : `OFFLINE (${proj.latest.web.error || proj.latest.web.httpStatus})`}
                            </span>
                          </div>
                          <div className="truncate">
                            Host: {proj.latest.web.finalHostname || "unknown"} (
                            {proj.latest.web.domainStatus || "N/A"})
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Layer 3: GitHub Repo */}
                    <div className="p-4 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                        <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                        <span>Layer 3 · GitHub Proof-of-Ship</span>
                      </div>
                      {!proj.latest.github.queried ? (
                        <p className="text-xs text-slate-500">No GitHub repo configured</p>
                      ) : (
                        <div className="text-xs font-mono text-slate-300 space-y-0.5">
                          <div>
                            Visibility:{" "}
                            <span
                              className={
                                proj.latest.github.accessible
                                  ? "text-emerald-300"
                                  : "text-rose-400"
                              }
                            >
                              {proj.latest.github.accessible
                                ? `PUBLIC (${proj.latest.github.stars ?? 0} stars)`
                                : proj.latest.github.error || "INACCESSIBLE"}
                            </span>
                          </div>
                          <div>
                            Last push:{" "}
                            <span className="text-white">
                              {proj.latest.github.daysSincePush !== null
                                ? `${proj.latest.github.daysSincePush}d ago`
                                : "Unknown"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Detected Mutations Strip */}
                  {proj.mutations.length > 0 && (
                    <div className="px-5 py-3.5 border-t border-white/[0.07] bg-[#080B13] space-y-2">
                      <div className="text-xs font-semibold text-slate-300">
                        Mutations &amp; Activity Since Baseline ({proj.mutations.length})
                      </div>
                      <div className="space-y-1.5">
                        {proj.mutations.map((m, idx) => (
                          <div
                            key={`${m.code}_${idx}`}
                            className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                              m.severity === "CRITICAL"
                                ? "border-rose-500/35 bg-rose-500/10 text-rose-200"
                                : m.severity === "WARNING"
                                  ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                                  : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                            }`}
                          >
                            {m.severity === "CRITICAL" ? (
                              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                            ) : m.severity === "WARNING" ? (
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className="font-semibold">{m.title}: </span>
                              <span className="font-mono">{m.detail}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
