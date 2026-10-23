"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Sparkles,
  KeyRound,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Cpu,
  Code2,
  ArrowRightLeft,
  Play,
  Copy,
  Check,
  Sun,
  Moon,
  ArrowUpRight,
  ArrowDownLeft,
  Layers,
  SlidersHorizontal,
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
  const [isDark, setIsDark] = useState<boolean>(false);

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
        : "https://solshield-wine.vercel.app";
    navigator.clipboard.writeText(
      `${origin}/api/actions/audit-swap?amount=1.5&outputMint=USDC`
    );
    setCopiedBlink(true);
    setTimeout(() => setCopiedBlink(false), 2000);
  };

  // Clean theme surface tokens
  const bgMain = isDark
    ? "bg-zinc-950 text-zinc-100"
    : "bg-[#F8FAFC] text-zinc-900";
  const bgCard = isDark
    ? "bg-zinc-900/90 border-zinc-800/90 shadow-none"
    : "bg-white border-zinc-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03),0_4px_12px_rgba(15,23,42,0.02)]";
  const bgSubtle = isDark
    ? "bg-zinc-950/70 border-zinc-800"
    : "bg-zinc-50/80 border-zinc-200/70";
  const textMuted = isDark ? "text-zinc-400" : "text-zinc-500";
  const borderHairline = isDark ? "border-zinc-800" : "border-zinc-200";

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-200 ${bgMain}`}
    >
      {/* Unified Minimalist Top Navigation Bar */}
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur-md ${
          isDark
            ? "bg-zinc-950/85 border-zinc-800/80"
            : "bg-white/85 border-zinc-200/80"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <img
              src="/logo.svg"
              alt="SolShield Logo"
              className="w-9 h-9 object-contain border border-zinc-300 dark:border-zinc-700 shadow-sm"
            />
            <div className="flex items-center gap-2.5">
              <span className="font-semibold tracking-tight text-base">
                SolShield
              </span>
              <span
                className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                  isDark
                    ? "bg-zinc-900 border-zinc-800 text-zinc-400"
                    : "bg-zinc-100 border-zinc-200 text-zinc-600"
                }`}
              >
                <Lock className="w-2.5 h-2.5 text-emerald-500" />
                Non-Custodial
              </span>
            </div>
          </div>

          {/* Center Segmented Navigation */}
          <nav
            className={`hidden md:flex items-center p-1 rounded-xl border ${
              isDark
                ? "bg-zinc-900/90 border-zinc-800"
                : "bg-zinc-100/90 border-zinc-200/80"
            }`}
          >
            {[
              {
                id: "firewall",
                label: "Firewall Inspector",
                icon: Shield,
              },
              {
                id: "intent",
                label: "DeFi Intent Copilot",
                icon: Sparkles,
              },
              {
                id: "policy",
                label: "Anchor Policy Vault",
                icon: SlidersHorizontal,
              },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() =>
                    setActiveTab(item.id as "firewall" | "intent" | "policy")
                  }
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? isDark
                        ? "bg-zinc-800 text-white shadow-sm"
                        : "bg-white text-zinc-900 shadow-sm"
                      : `${textMuted} hover:text-current`
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowKeyModal(!showKeyModal)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                veniceApiKey
                  ? isDark
                    ? "bg-emerald-950/50 border-emerald-800 text-emerald-300"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : isDark
                  ? "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
                  : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {veniceApiKey ? "Venice Live Connected" : "Venice API Key"}
              </span>
            </button>

            <a
              href="/api/actions/audit-swap"
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                isDark
                  ? "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
                  : "bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span>Blink JSON</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>

            <button
              onClick={() => setIsDark(!isDark)}
              aria-label="Toggle theme"
              className={`p-2 rounded-lg border transition ${
                isDark
                  ? "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
                  : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {isDark ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Tab Switcher */}
        <div
          className={`flex md:hidden border-t px-4 py-2 gap-1.5 overflow-x-auto ${borderHairline}`}
        >
          {[
            { id: "firewall", label: "Firewall" },
            { id: "intent", label: "DeFi Copilot" },
            { id: "policy", label: "Anchor PDA" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() =>
                setActiveTab(t.id as "firewall" | "intent" | "policy")
              }
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                activeTab === t.id
                  ? "bg-zinc-900 text-white"
                  : `${textMuted}`
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Clean Collapsible BYOK Drawer */}
        {showKeyModal && (
          <div
            className={`border-t px-4 sm:px-8 py-3.5 ${
              isDark
                ? "bg-zinc-900/95 border-zinc-800"
                : "bg-zinc-50 border-zinc-200"
            }`}
          >
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="text-xs leading-relaxed">
                <span className="font-semibold">
                  Bring Your Own Venice AI Key (Optional):
                </span>{" "}
                <span className={textMuted}>
                  Stored only in browser{" "}
                  <code className="font-mono">sessionStorage</code> for
                  zero-retention private inference. Works out-of-the-box without
                  a key via the built-in deterministic bytecode engine.
                </span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="password"
                  value={veniceApiKey}
                  onChange={(e) => saveApiKey(e.target.value)}
                  placeholder="Enter Venice API key..."
                  className={`w-full sm:w-64 px-3 py-1.5 rounded-lg border text-xs font-mono focus:outline-none ${
                    isDark
                      ? "bg-zinc-950 border-zinc-700 text-white"
                      : "bg-white border-zinc-300 text-zinc-900"
                  }`}
                />
                <button
                  onClick={() => {
                    setShowKeyModal(false);
                    runAudit();
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 shrink-0"
                >
                  Save &amp; Audit
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 space-y-6">
        {/* Clean Context Subheader */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Zero-Data-Retention Solana Security Engine
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
              {activeTab === "firewall" &&
                "Transaction & Solana Blinks Firewall"}
              {activeTab === "intent" &&
                "Private Natural-Language DeFi Copilot"}
              {activeTab === "policy" &&
                "On-Chain Anchor SecurityPolicy PDA Vault"}
            </h1>
          </div>

          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${bgCard}`}
          >
            <span className={textMuted}>Active Policy PDA:</span>
            <code className="font-mono font-medium">
              {derivedPda.pda.slice(0, 8)}...{derivedPda.pda.slice(-6)}
            </code>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                isDark
                  ? "bg-zinc-800 text-zinc-300"
                  : "bg-zinc-100 text-zinc-600"
              }`}
            >
              bump {derivedPda.bump}
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* TAB 1: FIREWALL INSPECTOR */}
        {activeTab === "firewall" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (5 Cols): Scenario Selector & Input */}
            <div className="lg:col-span-5 space-y-4">
              <div className={`p-5 rounded-2xl border ${bgCard} space-y-4`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    1. Select Simulation Scenario
                  </h2>
                  <span className={`text-[11px] font-mono ${textMuted}`}>
                    Wire-Format Tx
                  </span>
                </div>

                {/* Clean Scenario Cards */}
                <div className="space-y-2">
                  {SIMULATION_PRESETS.map((preset) => {
                    const isSelected =
                      inputMode === "preset" && selectedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => handleSelectPreset(preset.id)}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                          isSelected
                            ? isDark
                              ? "bg-zinc-800/90 border-zinc-600 ring-1 ring-zinc-600"
                              : "bg-zinc-900/[0.025] border-zinc-900 ring-1 ring-zinc-900/10"
                            : `${bgSubtle} hover:border-zinc-400/60`
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold">
                            {preset.name}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md ${
                              preset.badge === "SAFE"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                : preset.badge === "WARNING"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {preset.badge}
                          </span>
                        </div>
                        <p className={`text-xs leading-relaxed ${textMuted}`}>
                          {preset.subtitle}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Custom Payload Switcher */}
                <div className={`pt-4 border-t ${borderHairline} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      Inspect Custom Payload
                    </span>
                    <div
                      className={`inline-flex p-0.5 rounded-lg border ${bgSubtle}`}
                    >
                      <button
                        onClick={() => setInputMode("base64")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                          inputMode === "base64"
                            ? isDark
                              ? "bg-zinc-800 text-white"
                              : "bg-white text-zinc-900 shadow-sm"
                            : textMuted
                        }`}
                      >
                        Base64 Tx
                      </button>
                      <button
                        onClick={() => setInputMode("blink")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                          inputMode === "blink"
                            ? isDark
                              ? "bg-zinc-800 text-white"
                              : "bg-white text-zinc-900 shadow-sm"
                            : textMuted
                        }`}
                      >
                        Blink URL
                      </button>
                    </div>
                  </div>

                  {inputMode === "blink" ? (
                    <input
                      type="text"
                      value={customBlinkUrl}
                      onChange={(e) => setCustomBlinkUrl(e.target.value)}
                      placeholder="solana-action:https://..."
                      className={`w-full px-3 py-2 rounded-xl border text-xs font-mono focus:outline-none ${bgSubtle}`}
                    />
                  ) : (
                    <textarea
                      rows={3}
                      value={customBase64}
                      onChange={(e) => {
                        setInputMode("base64");
                        setCustomBase64(e.target.value);
                      }}
                      placeholder="Paste serialized Solana transaction in Base64..."
                      className={`w-full px-3 py-2 rounded-xl border text-[11px] font-mono leading-relaxed focus:outline-none ${bgSubtle}`}
                    />
                  )}

                  <button
                    onClick={() => runAudit()}
                    disabled={loading}
                    className={`w-full py-2.5 px-4 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition shadow-sm disabled:opacity-50 ${
                      isDark
                        ? "bg-white text-zinc-950 hover:bg-zinc-200"
                        : "bg-zinc-900 text-white hover:bg-zinc-800"
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {loading
                      ? "Simulating & Auditing via Venice AI..."
                      : "Run Private Security Audit"}
                  </button>
                </div>
              </div>

              {/* Clean Solana Blink Discovery Card */}
              <div className={`p-4 rounded-2xl border ${bgCard} space-y-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">
                    Solana Action / Blink Endpoint
                  </span>
                  <button
                    onClick={copyBlinkEndpoint}
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    {copiedBlink ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Copied URL
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy Action URL
                      </>
                    )}
                  </button>
                </div>
                <p className={`text-xs leading-relaxed ${textMuted}`}>
                  Compatible with Phantom, Backpack, and Dialect via{" "}
                  <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-500/10">
                    /api/actions/audit-swap
                  </code>
                  .
                </p>
              </div>
            </div>

            {/* Right Column (7 Cols): Clean Security Audit Certificate & AST */}
            <div className="lg:col-span-7 space-y-4">
              {veniceAudit && simulation && (
                <>
                  {/* Main Verdict Certificate Card */}
                  <div className={`p-6 rounded-2xl border ${bgCard} space-y-5`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-200/70 dark:border-zinc-800">
                      <div className="flex items-start gap-3.5">
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                            veniceAudit.classification === "SAFE"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : veniceAudit.classification === "WARNING"
                              ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                              : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {veniceAudit.classification === "SAFE" ? (
                            <ShieldCheck className="w-6 h-6" />
                          ) : veniceAudit.classification === "WARNING" ? (
                            <AlertTriangle className="w-6 h-6" />
                          ) : (
                            <ShieldAlert className="w-6 h-6" />
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`text-[11px] font-mono font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-md ${
                                veniceAudit.classification === "SAFE"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : veniceAudit.classification === "WARNING"
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                              }`}
                            >
                              {veniceAudit.recommendedAction.replace(/_/g, " ")}
                            </span>
                            <span
                              className={`text-xs flex items-center gap-1 ${textMuted}`}
                            >
                              <Cpu className="w-3.5 h-3.5" />
                              {veniceAudit.modelUsed}
                            </span>
                          </div>
                          <p className="text-sm sm:text-base font-medium leading-snug pt-1">
                            {veniceAudit.executiveSummary}
                          </p>
                        </div>
                      </div>

                      {/* Clean Risk Score Meter */}
                      <div
                        className={`sm:text-right px-4 py-3 rounded-xl border shrink-0 ${bgSubtle}`}
                      >
                        <div
                          className={`text-[10px] font-mono uppercase tracking-wider ${textMuted}`}
                        >
                          Risk Score
                        </div>
                        <div className="flex items-baseline sm:justify-end gap-1 mt-0.5">
                          <span
                            className={`text-2xl font-bold font-mono ${
                              veniceAudit.classification === "SAFE"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : veniceAudit.classification === "WARNING"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {veniceAudit.riskScore}
                          </span>
                          <span className={`text-xs font-mono ${textMuted}`}>
                            / 100
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* On-Chain Policy Guardrail Status Pill */}
                    <div
                      className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                        veniceAudit.policyGuardVerdict.passesPolicy
                          ? isDark
                            ? "bg-emerald-950/20 border-emerald-900/50 text-emerald-300"
                            : "bg-emerald-50/70 border-emerald-200/80 text-emerald-900"
                          : isDark
                          ? "bg-rose-950/20 border-rose-900/50 text-rose-300"
                          : "bg-rose-50/70 border-rose-200/80 text-rose-900"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {veniceAudit.policyGuardVerdict.passesPolicy ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                        )}
                        <span className="font-medium">
                          {veniceAudit.policyGuardVerdict.reason}
                        </span>
                      </div>
                    </div>

                    {/* Two-Column Breakdown: Balance Impact & Audit Findings */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      {/* Simulated Balance Changes */}
                      <div className="space-y-2.5">
                        <h3
                          className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                        >
                          Simulated Balance Impact
                        </h3>
                        <div className="space-y-2">
                          {simulation.balanceDeltas.map((delta, i) => (
                            <div
                              key={i}
                              className={`flex items-center justify-between p-3 rounded-xl border ${bgSubtle}`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                                    delta.direction === "IN"
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                  }`}
                                >
                                  {delta.direction === "IN" ? (
                                    <ArrowDownLeft className="w-4 h-4" />
                                  ) : (
                                    <ArrowUpRight className="w-4 h-4" />
                                  )}
                                </div>
                                <div>
                                  <div className="text-xs font-semibold flex items-center gap-1.5">
                                    <span>{delta.asset}</span>
                                    {delta.isToken2022 && (
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-300">
                                        Token-2022
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className={`text-[11px] font-mono ${textMuted}`}
                                  >
                                    {delta.mint.slice(0, 8)}...
                                    {delta.mint.slice(-4)}
                                  </div>
                                </div>
                              </div>

                              <span
                                className={`text-xs font-mono font-semibold ${
                                  delta.direction === "IN"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                {delta.direction === "IN" ? "+" : ""}
                                {delta.deltaUiAmount} {delta.asset.split(" ")[0]}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Security Findings */}
                      <div className="space-y-2.5">
                        <h3
                          className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}
                        >
                          Bytecode &amp; Venice Findings
                        </h3>
                        <ul className="space-y-2">
                          {veniceAudit.technicalFindings.map((finding, idx) => (
                            <li
                              key={idx}
                              className={`p-3 rounded-xl border text-xs leading-relaxed ${bgSubtle}`}
                            >
                              {finding}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Clean Instruction Execution Pipeline (AST) */}
                  <div className={`p-6 rounded-2xl border ${bgCard} space-y-4`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-zinc-500" />
                        <h3 className="text-sm font-semibold">
                          Decompiled Instruction Pipeline (
                          {simulation.instructions.length} Steps)
                        </h3>
                      </div>
                      <span className={`text-xs font-mono ${textMuted}`}>
                        FeePayer: {simulation.feePayer.slice(0, 6)}...
                        {simulation.feePayer.slice(-4)}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {simulation.instructions.map((ix) => (
                        <div
                          key={ix.index}
                          className={`p-3.5 rounded-xl border transition ${bgSubtle}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border ${
                                  isDark
                                    ? "bg-zinc-900 border-zinc-700 text-zinc-300"
                                    : "bg-white border-zinc-200 text-zinc-700"
                                }`}
                              >
                                0{ix.index + 1}
                              </span>
                              <span className="text-xs font-semibold font-mono">
                                {ix.instructionName}
                              </span>
                              <span className={`text-xs ${textMuted}`}>
                                {ix.programName}
                              </span>
                            </div>

                            <span
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                                ix.isVerifiedProgram
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              }`}
                            >
                              {ix.isVerifiedProgram
                                ? "Verified Program"
                                : "Unverified"}
                            </span>
                          </div>

                          <div
                            className={`mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono ${textMuted}`}
                          >
                            <span>
                              Program: {ix.programId.slice(0, 10)}...
                              {ix.programId.slice(-6)}
                            </span>
                            <span>Accounts: {ix.accounts.length}</span>
                            <span>Data: 0x{ix.dataHex || "00"}</span>
                          </div>

                          {ix.warnings.length > 0 && (
                            <div className="mt-2.5 pt-2.5 border-t border-rose-500/20 space-y-1">
                              {ix.warnings.map((w, wIdx) => (
                                <div
                                  key={wIdx}
                                  className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5"
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
          </div>
        )}

        {/* TAB 2: PRIVATE DEFI INTENT COPILOT */}
        {activeTab === "intent" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className={`lg:col-span-5 p-6 rounded-2xl border ${bgCard} space-y-4`}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-semibold">
                  Natural-Language Solana Intent
                </h2>
              </div>
              <p className={`text-xs leading-relaxed ${textMuted}`}>
                Write your swap or transfer request in plain English. Venice AI
                parses the parameters privately, attaches your{" "}
                <code className="font-mono">SolShieldPolicy</code> PDA guard,
                and pre-audits the resulting transaction.
              </p>

              <textarea
                rows={3}
                value={intentPrompt}
                onChange={(e) => setIntentPrompt(e.target.value)}
                className={`w-full p-3.5 rounded-xl border text-xs leading-relaxed focus:outline-none ${bgSubtle}`}
              />

              <div className="space-y-1.5">
                <div className={`text-[11px] font-medium ${textMuted}`}>
                  Try sample prompts:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Swap 1.5 SOL to USDC via Jupiter with max 0.5% slippage",
                    "Swap 4.0 SOL to USDC with 0.3% slippage",
                    "Swap 12.0 SOL to USDC (Test Daily Policy Limit Rejection)",
                  ].map((sample, idx) => (
                    <button
                      key={idx}
                      onClick={() => setIntentPrompt(sample)}
                      className={`text-left text-[11px] px-2.5 py-1.5 rounded-lg border transition ${bgSubtle} hover:border-zinc-400`}
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleRunIntent}
                disabled={loading}
                className={`w-full py-2.5 px-4 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition ${
                  isDark
                    ? "bg-white text-zinc-950 hover:bg-zinc-200"
                    : "bg-zinc-900 text-white hover:bg-zinc-800"
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {loading
                  ? "Compiling & Auditing Intent..."
                  : "Compile Guarded Transaction"}
              </button>

              {intentExplanation && (
                <div className={`p-3.5 rounded-xl border text-xs space-y-1 ${bgSubtle}`}>
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                    Compiled Intent Plan
                  </div>
                  <p className={textMuted}>{intentExplanation}</p>
                </div>
              )}
            </div>

            <div className={`lg:col-span-7 p-6 rounded-2xl border ${bgCard} space-y-4`}>
              {veniceAudit && simulation && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      Pre-Sign Firewall Verification
                    </h3>
                    <span
                      className={`text-xs font-mono font-semibold px-2.5 py-1 rounded-md ${
                        veniceAudit.policyGuardVerdict.passesPolicy
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {veniceAudit.policyGuardVerdict.passesPolicy
                        ? "APPROVED BY POLICY PDA"
                        : "BLOCKED BY POLICY PDA"}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed">
                    {veniceAudit.policyGuardVerdict.reason}
                  </p>
                  <div
                    className={`p-3.5 rounded-xl border font-mono text-[11px] break-all ${bgSubtle}`}
                  >
                    <div className={`font-sans font-semibold text-xs mb-1`}>
                      Serialized Wire Transaction (Base64)
                    </div>
                    <span className={textMuted}>{customBase64}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ANCHOR POLICY VAULT */}
        {activeTab === "policy" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className={`lg:col-span-6 p-6 rounded-2xl border ${bgCard} space-y-5`}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  On-Chain SecurityPolicy PDA Guardrails
                </h2>
                <span className={`text-xs font-mono ${textMuted}`}>
                  Anchor v0.30.1 (Rust)
                </span>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className={`block mb-1.5 font-medium ${textMuted}`}>
                    Wallet Owner Authority PublicKey
                  </label>
                  <input
                    type="text"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    className={`w-full px-3.5 py-2 rounded-xl border font-mono ${bgSubtle}`}
                  />
                </div>

                <div className={`p-3.5 rounded-xl border font-mono text-[11px] space-y-1 ${bgSubtle}`}>
                  <div className={textMuted}>
                    Deterministic PDA (`seeds = [b&quot;solshield_policy&quot;,
                    owner]`):
                  </div>
                  <div className="font-semibold break-all">
                    {derivedPda.pda} (Bump: {derivedPda.bump})
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      24h Rolling Spend Limit
                    </span>
                    <span className="font-mono font-semibold">
                      {maxDailySol.toFixed(1)} SOL
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={25}
                    step={0.5}
                    value={maxDailySol}
                    onChange={(e) => setMaxDailySol(parseFloat(e.target.value))}
                    className="w-full accent-zinc-900 dark:accent-emerald-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      Max Allowed Venice Risk Score
                    </span>
                    <span className="font-mono font-semibold">
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
                    className="w-full accent-zinc-900 dark:accent-emerald-400"
                  />
                </div>

                <div className={`pt-3 border-t ${borderHairline} space-y-3`}>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="font-medium">
                      Block Unverified Token-2022 TransferHooks
                    </span>
                    <input
                      type="checkbox"
                      checked={blockUnknownHooks}
                      onChange={(e) => setBlockUnknownHooks(e.target.checked)}
                      className="w-4 h-4 accent-zinc-900 dark:accent-emerald-400 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="font-medium text-rose-600 dark:text-rose-400">
                      Emergency Circuit-Breaker Kill Switch (`emergency_locked`)
                    </span>
                    <input
                      type="checkbox"
                      checked={emergencyLocked}
                      onChange={(e) => setEmergencyLocked(e.target.checked)}
                      className="w-4 h-4 accent-rose-600 rounded"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className={`lg:col-span-6 p-6 rounded-2xl border ${bgCard} space-y-4`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-zinc-500" />
                  Rust Smart Contract Interface (`lib.rs`)
                </h3>
                <span className={`text-[11px] font-mono ${textMuted}`}>
                  {SOLSHIELD_IDL_SUMMARY.programId.slice(0, 10)}...
                </span>
              </div>

              <div className="space-y-2.5">
                {SOLSHIELD_IDL_SUMMARY.instructions.map((inst, i) => (
                  <div
                    key={i}
                    className={`p-3.5 rounded-xl border text-xs space-y-1 ${bgSubtle}`}
                  >
                    <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      pub fn {inst.name}(...)
                    </div>
                    <div className={`text-[11px] font-mono ${textMuted}`}>
                      Args: {inst.args.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className={`border-t py-6 px-4 sm:px-8 text-xs ${borderHairline} ${textMuted}`}>
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <strong className="font-medium text-current">SolShield</strong>{" "}
            &mdash; Non-custodial Solana transaction firewall &amp; Blinks
            inspector powered by Venice AI.
          </div>
          <div>
            Independent open-source community project built for{" "}
            <a
              href="https://builtinvenice.ai"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-current"
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
