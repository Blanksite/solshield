"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileWarning,
  Loader2,
  Search,
  ShieldAlert,
} from "lucide-react";
import type { BuildCheckReport } from "@/lib/buildcheck/types";
import type { ScannedTokenSummary } from "@/lib/scanned-token-types";
import { RugAutopsyPanel } from "@/components/buildcheck/RugAutopsyPanel";

export default function AutopsyWorkbench() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BuildCheckReport | null>(null);
  const [recentScans, setRecentScans] = useState<ScannedTokenSummary[]>([]);

  useEffect(() => {
    fetch("/api/scanned-tokens", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.tokens)) {
          setRecentScans(data.tokens.slice(0, 8));
        }
      })
      .catch(() => {});

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const reportParam = params.get("report")?.trim();
      if (reportParam) {
        setQuery(reportParam);
        void loadAutopsy(reportParam);
      }
    }
  }, []);

  async function loadAutopsy(rawInput?: string) {
    const clean = (rawInput ?? query).trim();
    if (!clean) return;
    setLoading(true);
    setError(null);

    try {
      // Extract bc_<id> if user pasted report permalink or ID
      const reportIdMatch = clean.match(/\b(bc_[a-z0-9_-]{4,36})\b/i);
      if (reportIdMatch) {
        const res = await fetch(
          `/api/buildcheck/report?id=${encodeURIComponent(reportIdMatch[1])}`,
          { credentials: "same-origin" }
        );
        const data = await res.json();
        if (!res.ok || !data?.report) {
          throw new Error(data?.error || "Report not found or expired.");
        }
        setReport(data.report as BuildCheckReport);
        return;
      }

      // Otherwise run a live BuildCheck audit via POST /api/buildcheck
      const res = await fetch("/api/buildcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          input: clean,
          enableBrowser: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.report) {
        throw new Error(
          data?.error || "Could not generate forensic autopsy for this target."
        );
      }
      setReport(data.report as BuildCheckReport);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate rug autopsy."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#06080E] text-slate-100">
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
              <FileWarning className="w-4 h-4 text-rose-400" />
              <span className="text-sm font-semibold text-white">
                Rug Autopsy Generator
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-2">
            <Link
              href="/wallets"
              className="px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/[0.05]"
            >
              Wallets
            </Link>
            <Link
              href="/watchdog"
              className="px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/[0.05]"
            >
              Watchdog
            </Link>
            <Link
              href="/agent-firewall"
              className="px-2.5 py-1 rounded-md text-xs text-sky-300 hover:bg-sky-500/10 border border-sky-500/25"
            >
              Agent MCP
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        <section className="space-y-3 max-w-3xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white leading-[1.15]">
            1-Click Forensic Rug Autopsy.
          </h1>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Paste any BuildCheck report ID, Solana mint, or EVM contract to reconstruct
            the full timeline from deployer origin and bundle entry to MM exits and
            export an X-ready breakdown card &amp; thread.
          </p>
        </section>

        {/* Input Bar */}
        <section className="rounded-xl border border-white/[0.08] bg-[#0B0F19] p-4 sm:p-5 space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadAutopsy();
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Paste BuildCheck report ID (bc_...), Solana CA, or 0x EVM address..."
                className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#06080E] border border-white/[0.1] text-sm font-mono text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="h-11 px-5 rounded-lg bg-[#2934FF] hover:bg-[#3843FF] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Reconstructing...</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Generate Autopsy</span>
                </>
              )}
            </button>
          </form>

          {recentScans.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-400">
                Or open a recent SolShield audit:
              </div>
              <div className="flex flex-wrap gap-2">
                {recentScans.map((tok) => {
                  const score = tok.buildScore ?? Math.max(0, 100 - tok.riskScore);
                  const targetId = tok.buildCheckId || tok.mintAddress;
                  return (
                    <button
                      key={tok.buildCheckId || tok.mintAddress}
                      type="button"
                      onClick={() => {
                        setQuery(targetId);
                        void loadAutopsy(targetId);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#070A12] hover:border-sky-400/45 text-xs font-mono text-slate-200 cursor-pointer transition-colors"
                    >
                      {tok.symbol ? `$${tok.symbol}` : tok.mintAddress.slice(0, 8)} ·{" "}
                      <span
                        className={
                          score >= 70
                            ? "text-emerald-400"
                            : score >= 42
                              ? "text-amber-300"
                              : "text-rose-400"
                        }
                      >
                        {score}/100
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg border border-rose-500/35 bg-rose-500/10 text-xs text-rose-300">
              {error}
            </div>
          )}
        </section>

        {report && <RugAutopsyPanel report={report} showStandaloneLink={false} />}
      </main>
    </div>
  );
}
