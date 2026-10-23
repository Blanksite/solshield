"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Terminal,
  Sparkles,
  KeyRound,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Cpu,
  Code2,
  ArrowRightLeft,
  EyeOff,
  Play,
  Copy,
  Check,
} from "lucide-react";
import { SIMULATION_PRESETS } from "@/lib/presets";
import {
  SOLSHIELD_IDL_SUMMARY,
  deriveSecurityPolicyPda,
} from "@/lib/anchor-idl";
import type { DeterministicSimulationReport } from "@/lib/solana-parser";
import type { VeniceSecurityAuditResult } from "@/lib/venice-ai";

export default function SolShieldDashboard() {
  const [activeTab, setActiveTab] = useState<"firewall" | "intent" | "policy">(
    "firewall"
  );

  // Venice AI BYOK State (stored only in browser sessionStorage)
  const [veniceApiKey, setVeniceApiKey] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(false);

  // On-Chain Policy Guardrails State
  const [walletAddress, setWalletAddress] = useState(
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
  );
  const [maxAllowedRiskScore, setMaxAllowedRiskScore] = useState<number>(35);
  const [maxDailySol, setMaxDailySol] = useState<number>(5.0);
  const [blockUnknownHooks, setBlockUnknownHooks] = useState<boolean>(true);
  const [emergencyLocked, setEmergencyLocked] = useState<boolean>(false);

  // Firewall State
  const [selectedPresetId, setSelectedPresetId] =
    useState<string>("safe-jupiter-swap");
  const [customBase64, setCustomBase64] = useState<string>(
    SIMULATION_PRESETS[0].base64Transaction
  );
  const [customBlinkUrl, setCustomBlinkUrl] = useState<string>(
    SIMULATION_PRESETS[0].blinkActionUrl
  );
  const [inputMode, setInputMode] = useState<"preset" | "base64" | "blink">(
    "preset"
  );

  const [loading, setLoading] = useState<boolean>(false);
  const [simulation, setSimulation] =
    useState<DeterministicSimulationReport | null>(null);
  const [veniceAudit, setVeniceAudit] =
    useState<VeniceSecurityAuditResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // DeFi Intent Copilot State
  const [intentPrompt, setIntentPrompt] = useState<string>(
    "Swap 1.5 SOL to USDC via Jupiter v6 with max 0.5% slippage and verify Token-2022 hooks"
  );
  const [intentExplanation, setIntentExplanation] = useState<string | null>(
    null
  );

  const [copiedBlink, setCopiedBlink] = useState<boolean>(false);

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("solshield_venice_key")
        : null;
    if (saved) setVeniceApiKey(saved);
  }, []);

  const saveApiKey = (val: string) => {
    setVeniceApiKey(val);
    if (typeof window !== "undefined") {
      if (val.trim()) {
        window.sessionStorage.setItem("solshield_venice_key", val.trim());
      } else {
        window.sessionStorage.removeItem("solshield_venice_key");
      }
    }
  };

  const runAudit = useCallback(
    async (overridePresetId?: string) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const targetPreset = overridePresetId ?? selectedPresetId;
        const payload: Record<string, unknown> = {
          veniceApiKey,
          maxAllowedRiskScore: emergencyLocked ? 0 : maxAllowedRiskScore,
          maxDailySol,
          blockUnknownTransferHooks: blockUnknownHooks,
        };

        if (overridePresetId || inputMode === "preset") {
          payload.presetId = targetPreset;
        } else if (inputMode === "base64") {
          payload.base64Transaction = customBase64;
        } else {
          payload.blinkUrl = customBlinkUrl;
        }

        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Audit failed");
        }
        setSimulation(data.simulation);
        setVeniceAudit(data.veniceAudit);
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to audit transaction."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      selectedPresetId,
      veniceApiKey,
      emergencyLocked,
      maxAllowedRiskScore,
      maxDailySol,
      blockUnknownHooks,
      inputMode,
      customBase64,
      customBlinkUrl,
    ]
  );

  useEffect(() => {
    runAudit("safe-jupiter-swap");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectPreset = (presetId: string) => {
    const found = SIMULATION_PRESETS.find((p) => p.id === presetId);
    setSelectedPresetId(presetId);
    setInputMode("preset");
    if (found) {
      setCustomBase64(found.base64Transaction);
      setCustomBlinkUrl(found.blinkActionUrl);
    }
    runAudit(presetId);
  };

  const handleRunIntent = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: intentPrompt,
          walletAddress,
          veniceApiKey,
          maxAllowedRiskScore: emergencyLocked ? 0 : maxAllowedRiskScore,
          maxDailySol,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Intent execution failed");
      }
      setIntentExplanation(data.intent.explanation);
      setSimulation(data.simulation);
      setVeniceAudit(data.veniceAudit);
      setCustomBase64(data.base64Transaction);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to parse DeFi intent."
      );
    } finally {
      setLoading(false);
    }
  };

  const derivedPda = (() => {
    try {
      return deriveSecurityPolicyPda(walletAddress);
    } catch {
      return {
        pda: "Invalid Solana PublicKey format",
        bump: 254,
      };
    }
  })();

  const copyBlinkEndpoint = () => {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://solshield.app";
    navigator.clipboard.writeText(
      `${origin}/api/actions/audit-swap?amount=1.5&outputMint=USDC`
    );
    setCopiedBlink(true);
    setTimeout(() => setCopiedBlink(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Non-Custodial & Venice Privacy Banner */}
      <div className="bg-gradient-to-r from-[#14F195]/10 via-[#9945FF]/15 to-[#14F195]/10 border-b border-slate-800 px-4 py-2 text-xs text-slate-300">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <EyeOff className="w-3.5 h-3.5 text-[#14F195]" />
            <span>
              <strong>Zero-Data-Retention Privacy:</strong> Powered by{" "}
              <a
                href="https://venice.ai"
                target="_blank"
                rel="noreferrer"
                className="text-[#14F195] underline hover:opacity-80"
              >
                Venice AI
              </a>{" "}
              &mdash; wallet addresses, balance simulations, and trading intent
              are analyzed privately without model training retention.
            </span>
          </div>
          <div className="flex items-center gap-3 text-slate-400">
            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
              <Lock className="w-3 h-3" /> 100% Non-Custodial (Read-Only Pre-Sign Simulation)
            </span>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header className="border-b border-slate-800/80 bg-[#0B0E14]/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#14F195]/20 to-[#9945FF]/20 border border-[#14F195]/40 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#14F195]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  SolShield
                </h1>
                <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#9945FF]/20 text-[#c49bff] border border-[#9945FF]/40">
                  Solana + Venice AI
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Transaction Firewall, Blinks Inspector &amp; Anchor Policy Vault
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowKeyModal(!showKeyModal)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                veniceApiKey
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                  : "bg-slate-800/70 border-slate-700 text-slate-300 hover:border-slate-500"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {veniceApiKey
                ? "Venice API Key Active (Live LLM)"
                : "Configure Venice API Key (BYOK)"}
            </button>

            <a
              href="/api/actions/audit-swap"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#14F195]/10 text-[#14F195] border border-[#14F195]/30 hover:bg-[#14F195]/20 transition"
            >
              <span>Blink JSON API</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Collapsible BYOK Bar */}
        {showKeyModal && (
          <div className="border-t border-slate-800 bg-[#101520] px-4 py-3">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-300">
                <span className="font-semibold text-white">
                  Bring Your Own Venice Key (BYOK):
                </span>{" "}
                Stored strictly in your browser&apos;s{" "}
                <code className="text-[#14F195]">sessionStorage</code>. Leave
                blank to use the built-in Deterministic Bytecode Inspector.
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="password"
                  value={veniceApiKey}
                  onChange={(e) => saveApiKey(e.target.value)}
                  placeholder="Enter Venice.ai API Key (vn-...)"
                  className="w-full sm:w-72 px-3 py-1.5 rounded-lg bg-[#080b11] border border-slate-700 text-xs text-white focus:outline-none focus:border-[#14F195]"
                />
                <button
                  onClick={() => {
                    setShowKeyModal(false);
                    runAudit();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#14F195] text-slate-950 font-semibold text-xs hover:opacity-90"
                >
                  Apply &amp; Re-Audit
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("firewall")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "firewall"
                  ? "bg-[#14F195] text-slate-950 shadow-lg shadow-[#14F195]/10"
                  : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              <Shield className="w-4 h-4" />
              1. Transaction &amp; Blink Firewall
            </button>
            <button
              onClick={() => setActiveTab("intent")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "intent"
                  ? "bg-[#14F195] text-slate-950 shadow-lg shadow-[#14F195]/10"
                  : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              2. Private DeFi Intent Agent
            </button>
            <button
              onClick={() => setActiveTab("policy")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "policy"
                  ? "bg-[#14F195] text-slate-950 shadow-lg shadow-[#14F195]/10"
                  : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              <Code2 className="w-4 h-4" />
              3. Anchor Policy Vault (Rust PDA)
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Policy PDA:</span>
            <code className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[#14F195] font-mono">
              {derivedPda.pda.slice(0, 10)}...{derivedPda.pda.slice(-6)} (bump{" "}
              {derivedPda.bump})
            </code>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* TAB 1 & TAB 2 Top Input Section */}
        {activeTab === "firewall" && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Scenarios & Payload Input */}
            <div className="lg:col-span-5 space-y-4">
              <div className="p-4 rounded-2xl bg-[#121722] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#14F195]" />
                    Select Live Solana Attack / Safe Preset
                  </h2>
                  <span className="text-[11px] text-slate-400">
                    Real Wire-Format Tx
                  </span>
                </div>

                <div className="space-y-2">
                  {SIMULATION_PRESETS.map((preset) => {
                    const isSelected =
                      inputMode === "preset" && selectedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => handleSelectPreset(preset.id)}
                        className={`w-full text-left p-3 rounded-xl border transition flex flex-col gap-1 ${
                          isSelected
                            ? "bg-slate-800/90 border-[#14F195] shadow-sm"
                            : "bg-[#0B0E14]/80 border-slate-800/90 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-white">
                            {preset.name}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              preset.badge === "SAFE"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : preset.badge === "WARNING"
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                : "bg-red-500/15 text-red-400 border border-red-500/30"
                            }`}
                          >
                            {preset.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {preset.subtitle}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Custom Base64 or Blink URL Inspector */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setInputMode("base64")}
                      className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${
                        inputMode === "base64"
                          ? "bg-[#9945FF]/20 text-[#c49bff] border border-[#9945FF]/40"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Raw Base64 Transaction
                    </button>
                    <button
                      onClick={() => setInputMode("blink")}
                      className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${
                        inputMode === "blink"
                          ? "bg-[#9945FF]/20 text-[#c49bff] border border-[#9945FF]/40"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Solana Blink URL
                    </button>
                  </div>

                  {inputMode === "blink" ? (
                    <input
                      type="text"
                      value={customBlinkUrl}
                      onChange={(e) => setCustomBlinkUrl(e.target.value)}
                      placeholder="solana-action:https://..."
                      className="w-full px-3 py-2 rounded-lg bg-[#080b11] border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-[#14F195]"
                    />
                  ) : (
                    <textarea
                      rows={3}
                      value={customBase64}
                      onChange={(e) => {
                        setInputMode("base64");
                        setCustomBase64(e.target.value);
                      }}
                      placeholder="Paste serialized Solana Transaction Base64..."
                      className="w-full px-3 py-2 rounded-lg bg-[#080b11] border border-slate-800 text-[11px] font-mono text-slate-300 focus:outline-none focus:border-[#14F195]"
                    />
                  )}

                  <button
                    onClick={() => runAudit()}
                    disabled={loading}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#14F195] to-[#10b981] text-slate-950 font-bold text-xs flex items-center justify-center gap-2 hover:opacity-95 transition disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {loading
                      ? "Simulating & Auditing via Venice AI..."
                      : "Simulate & Audit Transaction Privately"}
                  </button>
                </div>
              </div>

              {/* Shareable Solana Blink Card */}
              <div className="p-4 rounded-2xl bg-[#121722] border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    Solana Action / Blink Endpoint (`actions.json`)
                  </span>
                  <button
                    onClick={copyBlinkEndpoint}
                    className="inline-flex items-center gap-1 text-[11px] text-[#14F195] hover:underline"
                  >
                    {copiedBlink ? (
                      <>
                        <Check className="w-3 h-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Copy Blink URL
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Any Solana Blink client (Phantom, Backpack, Dialect) can query{" "}
                  <code className="text-slate-200">
                    /api/actions/audit-swap
                  </code>{" "}
                  to execute Venice-audited swaps directly from social feeds.
                </p>
              </div>
            </div>

            {/* Right Column: Venice AI Security Verdict & AST Breakdown */}
            <div className="lg:col-span-7 space-y-4">
              {veniceAudit && simulation && (
                <>
                  {/* Risk Score Banner */}
                  <div
                    className={`p-5 rounded-2xl border ${
                      veniceAudit.classification === "SAFE"
                        ? "bg-emerald-950/20 border-emerald-500/40"
                        : veniceAudit.classification === "WARNING"
                        ? "bg-amber-950/20 border-amber-500/40"
                        : "bg-red-950/25 border-red-500/50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-3.5">
                        {veniceAudit.classification === "SAFE" ? (
                          <ShieldCheck className="w-9 h-9 text-emerald-400 shrink-0 mt-0.5" />
                        ) : veniceAudit.classification === "WARNING" ? (
                          <AlertTriangle className="w-9 h-9 text-amber-400 shrink-0 mt-0.5" />
                        ) : (
                          <ShieldAlert className="w-9 h-9 text-red-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-md font-bold bg-black/40 border border-white/10">
                              Verdict: {veniceAudit.recommendedAction}
                            </span>
                            <span className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Cpu className="w-3.5 h-3.5 text-[#14F195]" />
                              {veniceAudit.modelUsed}
                            </span>
                          </div>
                          <h3 className="text-sm sm:text-base font-bold text-white mt-2">
                            {veniceAudit.executiveSummary}
                          </h3>
                        </div>
                      </div>

                      <div className="text-right bg-black/30 px-4 py-2.5 rounded-xl border border-white/10">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Venice Risk Score
                        </div>
                        <div
                          className={`text-2xl font-extrabold font-mono ${
                            veniceAudit.classification === "SAFE"
                              ? "text-emerald-400"
                              : veniceAudit.classification === "WARNING"
                              ? "text-amber-400"
                              : "text-red-400"
                          }`}
                        >
                          {veniceAudit.riskScore}
                          <span className="text-xs text-slate-500">/100</span>
                        </div>
                      </div>
                    </div>

                    {/* Anchor On-Chain Policy Guardrail Status */}
                    <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        {veniceAudit.policyGuardVerdict.passesPolicy ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        )}
                        <span className="text-slate-200 font-medium">
                          {veniceAudit.policyGuardVerdict.reason}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Simulated Balance Deltas & Findings Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Balance Deltas */}
                    <div className="p-4 rounded-2xl bg-[#121722] border border-slate-800 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Simulated Wallet Balance Impact
                      </h4>
                      <div className="space-y-2">
                        {simulation.balanceDeltas.map((delta, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-[#0B0E14] border border-slate-800/80 text-xs"
                          >
                            <div>
                              <span className="font-semibold text-white">
                                {delta.asset}
                              </span>
                              {delta.isToken2022 && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                                  Token-2022
                                </span>
                              )}
                              <div className="text-[10px] font-mono text-slate-500">
                                {delta.mint.slice(0, 12)}...
                              </div>
                            </div>
                            <span
                              className={`font-mono font-bold ${
                                delta.direction === "IN"
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {delta.direction === "IN" ? "+" : ""}
                              {delta.deltaUiAmount} {delta.asset.split(" ")[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Technical Findings */}
                    <div className="p-4 rounded-2xl bg-[#121722] border border-slate-800 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Venice AI &amp; Bytecode Findings
                      </h4>
                      <ul className="space-y-2 text-xs text-slate-300">
                        {veniceAudit.technicalFindings.map((finding, idx) => (
                          <li
                            key={idx}
                            className="p-2 rounded-lg bg-[#0B0E14] border border-slate-800/80 leading-relaxed"
                          >
                            {finding}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Decoded Solana Instruction AST Table */}
                  <div className="p-4 rounded-2xl bg-[#121722] border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Decompiled Solana Instruction AST (
                        {simulation.instructions.length} Instructions)
                      </h4>
                      <span className="text-[11px] font-mono text-slate-500">
                        FeePayer: {simulation.feePayer.slice(0, 8)}...
                      </span>
                    </div>

                    <div className="space-y-2">
                      {simulation.instructions.map((ix) => (
                        <div
                          key={ix.index}
                          className="p-3 rounded-xl bg-[#0B0E14] border border-slate-800/90 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-[#14F195]">
                                IX #{ix.index + 1}
                              </span>
                              <span className="text-xs font-bold text-white">
                                {ix.instructionName}
                              </span>
                              <span className="text-xs text-slate-400">
                                ({ix.programName})
                              </span>
                            </div>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                                ix.isVerifiedProgram
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                              }`}
                            >
                              {ix.isVerifiedProgram
                                ? "Verified Program"
                                : "Unverified Program"}
                            </span>
                          </div>

                          <div className="text-[11px] font-mono text-slate-500 flex flex-wrap gap-4">
                            <span>Program ID: {ix.programId}</span>
                            <span>Accounts: {ix.accounts.length}</span>
                            <span>Data Hex: 0x{ix.dataHex || "00"}</span>
                          </div>

                          {ix.warnings.length > 0 && (
                            <div className="pt-1 space-y-1">
                              {ix.warnings.map((w, wIdx) => (
                                <div
                                  key={wIdx}
                                  className="text-[11px] text-red-400 font-medium flex items-center gap-1.5"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  <span>{w}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* TAB 2: Private DeFi Intent Agent */}
        {activeTab === "intent" && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 p-5 rounded-2xl bg-[#121722] border border-slate-800 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#14F195]" />
                <h2 className="text-base font-bold text-white">
                  Venice AI Private DeFi Intent Copilot
                </h2>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Describe the Solana transaction you want to execute in plain
                language. Venice AI parses your intent privately, constructs a
                Jupiter v6 route guarded by your{" "}
                <code className="text-[#14F195]">SolShieldPolicy</code> PDA, and
                runs the Transaction Firewall before signing.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-300">
                  Natural-Language Solana Intent
                </label>
                <textarea
                  rows={3}
                  value={intentPrompt}
                  onChange={(e) => setIntentPrompt(e.target.value)}
                  className="w-full p-3 rounded-xl bg-[#080b11] border border-slate-700 text-xs text-white focus:outline-none focus:border-[#14F195]"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  "Swap 1.5 SOL to USDC via Jupiter with max 0.5% slippage",
                  "Swap 4.0 SOL to USDC with 0.3% slippage and block unknown hooks",
                  "Swap 12.0 SOL to USDC (Test Daily Policy Limit Rejection)",
                ].map((sample, idx) => (
                  <button
                    key={idx}
                    onClick={() => setIntentPrompt(sample)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-[#080b11] border border-slate-800 text-slate-300 hover:border-[#14F195]/50"
                  >
                    {sample}
                  </button>
                ))}
              </div>

              <button
                onClick={handleRunIntent}
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#14F195] to-[#9945FF] text-slate-950 font-bold text-xs flex items-center justify-center gap-2 hover:opacity-95 transition"
              >
                <ArrowRightLeft className="w-4 h-4" />
                {loading
                  ? "Building & Auditing Intent via Venice AI..."
                  : "Build Guarded Transaction & Run Firewall"}
              </button>

              {intentExplanation && (
                <div className="p-3.5 rounded-xl bg-[#080b11] border border-[#14F195]/40 text-xs text-slate-200 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-[#14F195] font-bold">
                    Venice Intent Compilation Result
                  </div>
                  <p>{intentExplanation}</p>
                </div>
              )}
            </div>

            <div className="lg:col-span-7 space-y-4">
              {veniceAudit && simulation && (
                <div className="p-5 rounded-2xl bg-[#121722] border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">
                      Compiled Transaction Firewall Audit
                    </h3>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        veniceAudit.policyGuardVerdict.passesPolicy
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-red-500/15 text-red-400"
                      }`}
                    >
                      {veniceAudit.policyGuardVerdict.passesPolicy
                        ? "APPROVED BY ANCHOR POLICY PDA"
                        : "BLOCKED BY ANCHOR POLICY PDA"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    {veniceAudit.policyGuardVerdict.reason}
                  </p>
                  <div className="p-3 rounded-xl bg-[#080b11] border border-slate-800 font-mono text-[11px] text-slate-400 break-all">
                    <div className="text-slate-200 font-semibold mb-1">
                      Compiled Base64 Wire Transaction:
                    </div>
                    {customBase64}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 3: Anchor Policy Vault (Rust Smart Contract Configurator) */}
        {activeTab === "policy" && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 p-5 rounded-2xl bg-[#121722] border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#14F195]" />
                  On-Chain SecurityPolicy PDA Configuration
                </h2>
                <span className="text-[11px] font-mono text-[#14F195]">
                  Anchor v0.30.1 (Rust)
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Wallet Owner Authority PublicKey
                  </label>
                  <input
                    type="text"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#080b11] border border-slate-700 font-mono text-white"
                  />
                </div>

                <div className="p-3 rounded-xl bg-[#080b11] border border-slate-800 space-y-1 font-mono text-[11px]">
                  <div className="text-slate-400">
                    Derived PDA (`seeds = [b&quot;solshield_policy&quot;,
                    owner]`):
                  </div>
                  <div className="text-[#14F195] break-all">
                    {derivedPda.pda} (Canonical Bump: {derivedPda.bump})
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-300">
                      Max Daily Rolling Spend Limit (24h Window)
                    </span>
                    <span className="font-mono font-bold text-[#14F195]">
                      {maxDailySol.toFixed(1)} SOL (
                      {(maxDailySol * 1e9).toLocaleString()} lamports)
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={25}
                    step={0.5}
                    value={maxDailySol}
                    onChange={(e) => setMaxDailySol(parseFloat(e.target.value))}
                    className="w-full accent-[#14F195]"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-300">
                      Max Allowed Venice AI Risk Score Threshold
                    </span>
                    <span className="font-mono font-bold text-[#14F195]">
                      {maxAllowedRiskScore} / 100
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    step={5}
                    value={maxAllowedRiskScore}
                    onChange={(e) =>
                      setMaxAllowedRiskScore(parseInt(e.target.value, 10))
                    }
                    className="w-full accent-[#14F195]"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span>Block Unverified Token-2022 TransferHooks</span>
                  <input
                    type="checkbox"
                    checked={blockUnknownHooks}
                    onChange={(e) => setBlockUnknownHooks(e.target.checked)}
                    className="w-4 h-4 accent-[#14F195]"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-red-300 font-medium">
                    Emergency Circuit-Breaker Kill Switch (`emergency_locked`)
                  </span>
                  <input
                    type="checkbox"
                    checked={emergencyLocked}
                    onChange={(e) => setEmergencyLocked(e.target.checked)}
                    className="w-4 h-4 accent-red-500"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 p-5 rounded-2xl bg-[#121722] border border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-white">
                Anchor Program Instructions (`programs/solshield-policy/src/lib.rs`)
              </h3>
              <p className="text-xs text-slate-400">
                Program ID:{" "}
                <code className="text-slate-200 font-mono">
                  {SOLSHIELD_IDL_SUMMARY.programId}
                </code>
              </p>
              <div className="space-y-2">
                {SOLSHIELD_IDL_SUMMARY.instructions.map((inst, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-[#080b11] border border-slate-800 text-xs space-y-1"
                  >
                    <div className="font-mono font-bold text-[#14F195]">
                      pub fn {inst.name}(...)
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      Args: {inst.args.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer with explicit Safety & Non-Endorsement Disclosures per Built in Venice guidelines */}
      <footer className="border-t border-slate-800/80 py-5 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <strong>SolShield</strong> &mdash; Open-Source Solana Security
            Firewall &amp; Blinks Agent powered by Venice AI.
          </div>
          <div>
            Independent community project built for{" "}
            <a
              href="https://builtinvenice.ai"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 underline hover:text-white"
            >
              Built in Venice
            </a>
            . Not an official Venice AI product.
          </div>
        </div>
      </footer>
    </div>
  );
}
