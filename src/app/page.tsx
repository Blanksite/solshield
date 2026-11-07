"use client";

import React, { useState, useEffect } from "react";
import { SIMULATION_PRESETS, SimulationPreset } from "@/lib/presets";
import { VeniceSecurityAuditResult } from "@/lib/venice-ai";
import { DeterministicSimulationReport } from "@/lib/solana-parser";
import {
  DecryptedText,
  BlurText,
  Magnet,
  TiltedCard,
  SpotlightCard,
  ClickSpark,
  CobaltSphere3D,
  DitherVeil,
} from "@/components/reactbits";
import {
  Search,
  Menu,
  ArrowUpRight,
  Sun,
  Moon,
  Key,
  Check,
  Copy,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
  Lock,
  Unlock,
  Download,
  Wallet,
  Sparkles,
  RotateCcw,
  Share2,
} from "lucide-react";

interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  telemetry?: {
    slot?: number;
    inspectedAddress?: string;
    accountFound?: boolean;
    lamports?: number;
    solBalance?: string;
    ownerProgram?: string;
    executable?: boolean;
    dataSize?: number;
  } | null;
  privacyProof?: {
    provider: string;
    model: string;
    zeroDataRetention: boolean;
  };
}

interface GuardStage {
  id: string;
  label: string;
  tagTop: string;
  tagBottom: string;
  statement: string;
  presetIndex: number;
}

interface ParsedIntentResponse {
  ok: boolean;
  intent: {
    action: string;
    inputToken: string;
    outputToken: string;
    amount: number;
    maxSlippageBps: number;
    explanation: string;
  };
  policyPda: {
    pda: string;
    bump: number;
  };
  veniceAudit: VeniceSecurityAuditResult;
}

const GUARD_STAGES: GuardStage[] = [
  {
    id: "identify",
    label: "Identify",
    tagTop: "identify",
    tagBottom: "raw payload",
    statement: "Real-time instruction decoding across Solana programs",
    presetIndex: 0,
  },
  {
    id: "block",
    label: "Block",
    tagTop: "intercept",
    tagBottom: "token drain",
    statement: "Pre-sign blocking of malicious SPL authority hijacks",
    presetIndex: 1,
  },
  {
    id: "predict",
    label: "Predict",
    tagTop: "security",
    tagBottom: "at the core",
    statement: "Continuous code and behavior by adaptive AI",
    presetIndex: 1,
  },
  {
    id: "adapt",
    label: "Adapt",
    tagTop: "zero-log",
    tagBottom: "venice ai",
    statement: "Zero-retention private LLM inference for Token-2022 hooks",
    presetIndex: 2,
  },
  {
    id: "recover",
    label: "Recover",
    tagTop: "authority",
    tagBottom: "protection",
    statement: "Autonomous wallet owner and delegate allowance defense",
    presetIndex: 3,
  },
];

const INTENT_SAMPLES = [
  "Swap 1.5 SOL to USDC on Jupiter with max 0.5% slippage",
  "Swap 12 SOL to BONK (Test Daily Spend Cap)",
  "Convert 0.5 SOL to JitoSOL safely",
];

function VeniceAiLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-label="Venice AI"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.295 16.074a4.239 4.239 0 00-1.37-.685 4.255 4.255 0 00-1.636-.138 4.27 4.27 0 00-1.566.499c-.472.26-.875.602-1.19.973-.315.37-.59.824-.773 1.336a4.432 4.432 0 00-.257 1.644c.02.564.155 1.125.375 1.621s.528.93.87 1.275c.34.346.766.657 1.256.881.49.224 1.041.36 1.598.381a4.258 4.258 0 001.62-.26 4.25 4.25 0 001.318-.786c.365-.319.703-.728.959-1.206.256-.479.43-1.027.492-1.589a4.436 4.436 0 00-.137-1.659 4.346 4.346 0 00-.675-1.39l.95-.964.691.702h.393l.475-.481v-.399l-.692-.702L12 14.11l1.004 1.018-.691.702v.399l.474.48h.393l.691-.701.95.964a4.346 4.346 0 00-.675 1.39 4.435 4.435 0 00-.137 1.66c.062.56.236 1.11.492 1.588s.594.887.96 1.206c.364.32.812.599 1.316.785a4.258 4.258 0 001.621.261 4.262 4.262 0 001.598-.38c.49-.225.916-.536 1.257-.882.341-.346.648-.779.869-1.275.22-.496.355-1.057.375-1.62a4.433 4.433 0 00-.257-1.645 4.338 4.338 0 00-.774-1.336 4.272 4.272 0 00-1.189-.973 4.27 4.27 0 00-1.566-.5 4.255 4.255 0 00-1.635.14 4.239 4.239 0 00-1.37.684l-.933-.947.69-.702v-.398l-.49-.498h-.393l-.692.701-1.004-1.018L18.15 7.87l2.132 2.163v-2.25H22.5L20.368 5.62 22.5 3.457V3.06l-.491-.498h-.393L12 12.316 2.384 2.56H1.99l-.491.498v.398L3.632 5.62 1.5 7.782h2.218v2.25L5.85 7.87l5.266 5.342-1.004 1.018-.692-.701h-.393l-.49.498v.399l.69.7-.932.948zm8.546 4.95a1.59 1.59 0 00.107 1.49c.256.43.799.73 1.294.716.494.014 1.037-.287 1.293-.716a1.59 1.59 0 00.108-1.49l.054-.06a1.53 1.53 0 001.471-.107c.424-.26.72-.81.707-1.313.014-.502-.283-1.053-.707-1.313a1.53 1.53 0 00-1.471-.107l-.054-.059a1.59 1.59 0 00-.108-1.49c-.256-.43-.799-.73-1.293-.717-.495-.013-1.038.287-1.294.716a1.59 1.59 0 00-.107 1.491l-.054.059a1.53 1.53 0 00-1.472.107c-.424.26-.72.81-.707 1.313-.013.502.283 1.053.707 1.313a1.53 1.53 0 001.472.107l.054.06zm-9.79 1.49a1.59 1.59 0 00.108-1.49l.054-.06a1.53 1.53 0 001.471-.107c.424-.26.72-.81.707-1.313.014-.502-.283-1.053-.707-1.313a1.53 1.53 0 00-1.47-.107l-.055-.059a1.59 1.59 0 00-.107-1.49c-.257-.43-.8-.73-1.294-.717-.495-.013-1.037.287-1.294.716a1.59 1.59 0 00-.107 1.491l-.054.059a1.53 1.53 0 00-1.471.107c-.424.26-.72.81-.707 1.313-.014.502.283 1.053.707 1.313a1.53 1.53 0 001.471.107l.054.06a1.59 1.59 0 00.107 1.49c.257.43.8.73 1.294.716.495.014 1.037-.287 1.294-.716z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.274 2.56L14.8 0l1.25 1.268v4.274l-3.462 3.512h-.625L8.5 5.542V1.268L9.75 0l2.524 2.56zM9.75.898l2.212 2.243v4.12L9.75 5.018V.897zm2.837 2.243L14.799.897v4.12l-2.212 2.244V3.14z"
      />
    </svg>
  );
}

function HexaCoreLogoMark() {
  return (
    <div className="relative group">
      <img
        src="/logo.jpg"
        alt="SolShield Logo"
        className="w-9 h-9 rounded-xl object-cover shrink-0 border border-white/20 shadow-md group-hover:scale-105 transition-transform"
      />
      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-[#0A0A0C] animate-pulse" />
    </div>
  );
}

function BuiltInVeniceBadge({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://github.com/veniceai/builtinvenice/pull/194"
      target="_blank"
      rel="noreferrer"
      title="Official Built in Venice Directory"
      className={`inline-flex items-center gap-2.5 bg-[#0A0E18] hover:bg-[#0F172A] border border-[#1E293B] hover:border-[#E05A2D]/70 rounded-full px-3.5 py-1.5 transition-all select-none shadow-[0_2px_12px_rgba(0,0,0,0.5)] group ${className}`}
    >
      <VeniceAiLogo className="w-4 h-4 text-[#E05A2D] group-hover:scale-110 transition-transform" />
      <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-white/90 group-hover:text-white transition-colors">
        BUILT IN <span className="text-[#E05A2D] font-semibold">VENICE</span>
      </span>
    </a>
  );
}

function CobaltPixelCluster() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="w-5 h-5 mx-auto text-[#2934FF]"
    >
      <rect x="6" y="10" width="5.5" height="5.5" fill="currentColor" />
      <rect x="11.5" y="4.5" width="5.5" height="5.5" fill="currentColor" />
      <rect x="11.5" y="15.5" width="4.5" height="4.5" fill="currentColor" />
    </svg>
  );
}

export default function SolShieldHexaCorePage() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [lang, setLang] = useState<"en" | "id">("en");
  const [activeStageIdx, setActiveStageIdx] = useState<number>(2);

  const [selectedPreset, setSelectedPreset] = useState<SimulationPreset>(
    SIMULATION_PRESETS[1]
  );
  const [simulationReport, setSimulationReport] =
    useState<DeterministicSimulationReport | null>(null);
  const [auditResult, setAuditResult] =
    useState<VeniceSecurityAuditResult | null>(null);
  const [liveSlot, setLiveSlot] = useState<number>(328491024);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [walletStatus, setWalletStatus] = useState<
    "PENDING" | "BLOCKED" | "SIGNED" | "REVOKED"
  >("PENDING");

  const [veniceApiKey, setVeniceApiKey] = useState<string>("");
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  // Connected Wallet & Anchor Policy PDA Vault State
  const [connectedWallet, setConnectedWallet] = useState<string>(
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
  );
  const [isRealWalletConnected, setIsRealWalletConnected] =
    useState<boolean>(false);
  const [maxDailySol, setMaxDailySol] = useState<number>(5.0);
  const [maxAllowedRisk, setMaxAllowedRisk] = useState<number>(30);
  const [emergencyLocked, setEmergencyLocked] = useState<boolean>(false);
  const [derivedPdaAddress, setDerivedPdaAddress] = useState<string>(
    "7mK9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZPolicy"
  );

  // DeFi Intent Copilot State (/api/intent)
  const [intentPrompt, setIntentPrompt] = useState<string>(INTENT_SAMPLES[0]);
  const [intentLoading, setIntentLoading] = useState<boolean>(false);
  const [intentResponse, setIntentResponse] =
    useState<ParsedIntentResponse | null>(null);

  // Blinks & Revoke Studio State
  const [selectedBlinkSol, setSelectedBlinkSol] = useState<string>("0.5");
  const [copiedBlinkUrl, setCopiedBlinkUrl] = useState<boolean>(false);
  const [revokeStatus, setRevokeStatus] = useState<"IDLE" | "BUILT">("IDLE");

  // Live Solana Mainnet RPC & Venice AI Agent state
  const [agentAddress, setAgentAddress] = useState<string>(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  );
  const [agentInput, setAgentInput] = useState<string>("");
  const [agentLoading, setAgentLoading] = useState<boolean>(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      content:
        "SolShield Adaptive AI Guard online. Paste any Solana Mainnet address (Token Mint, Program ID, Wallet) or an 88-char Transaction Signature (txHash) to execute a zero-retention Venice AI behavioral X-Ray.",
      telemetry: {
        slot: 328491024,
        inspectedAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        accountFound: true,
        solBalance: "194.281042",
        ownerProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        executable: false,
        dataSize: 82,
      },
      privacyProof: {
        provider: "Venice AI (Zero-Retention)",
        model: "llama-3.3-70b",
        zeroDataRetention: true,
      },
    },
  ]);

  useEffect(() => {
    const savedKey = localStorage.getItem("solshield_venice_key");
    if (savedKey) setVeniceApiKey(savedKey);

    const savedTheme = localStorage.getItem("solshield_theme_v3");
    if (savedTheme === "light") {
      setDarkMode(false);
      document.documentElement.classList.remove("dark");
    } else {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }

    runIntentCopilot(INTENT_SAMPLES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("solshield_theme_v3", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("solshield_theme_v3", "light");
    }
  };

  const connectBrowserWallet = async () => {
    try {
      const anyWin = window as unknown as {
        solana?: {
          isPhantom?: boolean;
          connect: () => Promise<{ publicKey: { toString: () => string } }>;
        };
      };
      if (anyWin.solana) {
        const resp = await anyWin.solana.connect();
        const pubkey = resp.publicKey.toString();
        setConnectedWallet(pubkey);
        setIsRealWalletConnected(true);
        setAgentAddress(pubkey);
        sendAgentQuery(
          `Inspect my connected Solana wallet ${pubkey} on Mainnet and verify its owner program and safety.`
        );
        return;
      }
    } catch {
      // Fallback to demo wallet if user cancels popup
    }
    setIsRealWalletConnected((prev) => !prev);
  };

  const runVeniceAudit = async (preset: SimulationPreset) => {
    setIsAuditing(true);
    setWalletStatus("PENDING");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: preset.id,
          veniceApiKey: veniceApiKey.trim() || undefined,
          maxAllowedRiskScore: maxAllowedRisk,
          maxDailySol,
        }),
      });
      const data = await response.json();
      if (data.ok) {
        setSimulationReport(data.simulation);
        setAuditResult(data.veniceAudit);
        if (data.liveSolana?.slot) {
          setLiveSlot(data.liveSolana.slot);
        }
      }
    } catch {
      // Fallback handled by API
    } finally {
      setIsAuditing(false);
    }
  };

  const runIntentCopilot = async (customPrompt?: string) => {
    const promptToUse = customPrompt || intentPrompt;
    if (!promptToUse.trim()) return;
    setIntentLoading(true);
    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToUse,
          walletAddress: connectedWallet,
          veniceApiKey: veniceApiKey.trim() || undefined,
          maxAllowedRiskScore: maxAllowedRisk,
          maxDailySol,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setIntentResponse(data);
        if (data.policyPda?.pda) {
          setDerivedPdaAddress(data.policyPda.pda);
        }
      }
    } catch {
      // Ignore error
    } finally {
      setIntentLoading(false);
    }
  };

  const handleExportAuditProof = () => {
    const proofPayload = {
      certificate: "SolShield Zero-Retention Security Attestation",
      timestamp: new Date().toISOString(),
      solanaMainnetSlot: liveSlot,
      walletInspected: connectedWallet,
      anchorPolicyPda: derivedPdaAddress,
      policyConfiguration: {
        maxDailySol,
        maxAllowedRiskScore: maxAllowedRisk,
        emergencyLocked,
      },
      scenario: {
        id: selectedPreset.id,
        name: selectedPreset.name,
        blinkActionUrl: selectedPreset.blinkActionUrl,
      },
      veniceAiVerdict: auditResult,
      decodedInstructionsCount: simulationReport?.instructions.length ?? 2,
      threatFlags: simulationReport?.threatFlags ?? [],
      privacyAttestation: {
        engine: "Venice AI (https://api.venice.ai/api/v1/chat/completions)",
        model: "llama-3.3-70b",
        include_venice_system_prompt: false,
        zeroDataRetention: true,
      },
    };
    const blob = new Blob([JSON.stringify(proofPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `solshield-audit-proof-${selectedPreset.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    runVeniceAudit(selectedPreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset]);

  const handleStageClick = (idx: number) => {
    setActiveStageIdx(idx);
    const stage = GUARD_STAGES[idx];
    if (SIMULATION_PRESETS[stage.presetIndex]) {
      setSelectedPreset(SIMULATION_PRESETS[stage.presetIndex]);
    }
  };

  const sendAgentQuery = async (customPrompt?: string) => {
    const questionText =
      customPrompt ||
      agentInput.trim() ||
      (lang === "en"
        ? `Inspect Solana address ${agentAddress.trim()} on Mainnet and explain if it is safe.`
        : `Periksa alamat Solana ${agentAddress.trim()} di Mainnet dan jelaskan apakah aman.`);

    setAgentLoading(true);
    const userMsg: AgentMessage = { role: "user", content: questionText };
    setAgentMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setAgentInput("");

    try {
      const res = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: questionText,
          presetId: selectedPreset.id,
          veniceApiKey: veniceApiKey.trim() || undefined,
          lang,
        }),
      });
      const data = await res.json();
      setAgentMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          telemetry: data.telemetry,
          privacyProof: data.privacyProof,
        },
      ]);
    } catch {
      setAgentMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Unable to reach Solana Mainnet / Venice AI endpoint. Please retry.",
        },
      ]);
    } finally {
      setAgentLoading(false);
    }
  };

  const scrollToTechnicalSide = () => {
    const el = document.getElementById("technical-side");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToVaultSide = () => {
    const el = document.getElementById("vault-side");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const activeStage = GUARD_STAGES[activeStageIdx];
  const isCritical =
    emergencyLocked ||
    auditResult?.classification === "CRITICAL" ||
    auditResult?.classification === "WARNING" ||
    selectedPreset.badge !== "SAFE";

  return (
    <ClickSpark sparkColor="#2934FF" sparkRadius={26} sparkCount={8}>
      <div className="hexacore-canvas min-h-screen font-sans">
        {/* ====================================================================
            SECTION 01 — HERO (1:1 HALO LAB "HEXACORE — ADAPTIVE AI GUARD" GRID)
            3 Full-Height Architectural Columns separated by crisp hairlines
            ==================================================================== */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_1.16fr_1fr] min-h-screen hexacore-hairline-b">
          {/* ------------------------------------------------------------------
              COLUMN 1 (LEFT) — Brand Mark + "Adaptive AI [●] Guard" + Social Proof
              ------------------------------------------------------------------ */}
          <div className="flex flex-col justify-between hexacore-hairline-r px-8 sm:px-12 xl:px-14 py-9">
            {/* Top Brand Header */}
            <div className="flex items-center justify-between gap-3">
              <a
                href="#"
                className="inline-flex items-center gap-2.5 group focus:outline-none"
              >
                <HexaCoreLogoMark />
                <span className="text-[19px] font-medium tracking-[-0.03em]">
                  SolShield
                  <sup className="text-[10px] font-normal ml-0.5 opacity-70">
                    ®
                  </sup>
                </span>
              </a>
              <BuiltInVeniceBadge />
            </div>

            {/* Center Editorial Headline: "Adaptive / AI [Orb] / Guard" */}
            <div className="my-auto py-14">
              <h1 className="text-[54px] sm:text-[64px] xl:text-[74px] font-normal leading-[1.03] tracking-[-0.04em] select-none">
                <span className="block">
                  <BlurText text="Adaptive" delay={60} />
                </span>
                <span className="flex items-center gap-4 my-1">
                  <BlurText text="AI" delay={140} />
                  <Magnet padding={50} magnetStrength={2.2}>
                    <CobaltSphere3D className="w-12 h-12 sm:w-14 sm:h-14 cursor-pointer" />
                  </Magnet>
                </span>
                <span className="block">
                  <BlurText text="Guard" delay={220} />
                </span>
              </h1>
            </div>

            {/* Horizontal Hairline Divider */}
            <div className="w-full hexacore-hairline-t my-2" />

            {/* Bottom Social Proof & Decrypted Telemetry Copy */}
            <div className="pt-8 pb-2 flex flex-col items-center justify-center text-center">
              <div className="flex items-center justify-center -space-x-2.5 mb-5">
                <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#0A0A0C] bg-neutral-900 shadow-md relative z-10">
                  <img
                    src="/logo.jpg"
                    alt="SolShield GitHub Logo"
                    className="w-full h-full object-cover"
                  />
                </div>
                <a
                  href="https://venice.ai"
                  target="_blank"
                  rel="noreferrer"
                  title="Powered by Venice AI Zero-Retention Inference"
                  className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#0A0A0C] bg-[#0E131F] flex items-center justify-center shadow-md hover:border-[#E05A2D] transition-colors group"
                >
                  <VeniceAiLogo className="w-6 h-6 text-[#E05A2D] group-hover:scale-110 transition-transform" />
                </a>
              </div>

              <p className="text-[10.5px] sm:text-[11px] font-normal uppercase tracking-[0.06em] leading-[1.48] max-w-[225px] opacity-80">
                <DecryptedText
                  text={
                    lang === "en"
                      ? "SMART AI CONTINUOUSLY MONITORS CODE AND BEHAVIOR TO STOP EVOLVING THREATS."
                      : "AI PINTAR MEMANTAU KODE DAN PERILAKU TRANSAKSI UNTUK MENGHENTIKAN ANCAMAN."
                  }
                  speed={22}
                  maxIterations={8}
                  animateOn="both"
                />
              </p>
            </div>
          </div>

          {/* ------------------------------------------------------------------
              COLUMN 2 (CENTER MONOLITH) — Top Nav + Dither Veil + Call To Action
              ------------------------------------------------------------------ */}
          <div className="flex flex-col justify-between hexacore-hairline-r hexacore-canvas text-current relative overflow-hidden">
            {/* Top Navigation Band */}
            <div className="px-8 pt-9 pb-5 z-20">
              <nav className="flex items-center justify-center gap-6 sm:gap-9 text-[13px] font-normal tracking-[-0.01em] opacity-80">
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={scrollToTechnicalSide}
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    {lang === "en" ? "Simulator" : "Simulator"}
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={scrollToVaultSide}
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    {lang === "en" ? "Intent & PDA Vault" : "Intent & Vault"}
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <a
                    href="https://github.com/Blanksite/solshield-protocol"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:opacity-100 transition-opacity"
                  >
                    GitHub
                  </a>
                </Magnet>
              </nav>
            </div>

            {/* Center Interactive Dither Veil */}
            <div className="relative w-full flex-1 flex flex-col items-center">
              <div className="relative w-full h-[64vh] sm:h-[68vh] xl:h-[72vh] min-h-[520px] overflow-hidden select-none bg-[#0A0A0C]">
                <DitherVeil
                  src="/cyber-portrait.jpg"
                  fit="cover"
                  pattern="bayer"
                  pixelSize={2}
                  levels={2}
                  palette="duotone"
                  inkColor="#0A0A0C"
                  paperColor="#E2E4E8"
                  revealRadius={180}
                  softness={0.65}
                  linger={1.2}
                  rimColor="#2934FF"
                  rim={0.14}
                  wander={false}
                  clickBurst={true}
                  className="w-full h-full"
                />

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#0A0A0C] via-[#0A0A0C]/80 to-transparent z-10" />

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  <div className="relative flex flex-col items-center translate-y-1">
                    <div className="bg-[#0A0A0C] text-white px-3.5 py-1 text-[21px] sm:text-[25px] font-normal tracking-[-0.03em] leading-[1.05] -translate-x-12 shadow-lg border border-white/10">
                      <DecryptedText
                        text={activeStage.tagTop}
                        speed={30}
                        maxIterations={10}
                        animateOn="view"
                      />
                    </div>
                    <div className="bg-[#0A0A0C] text-white px-3.5 py-1 text-[21px] sm:text-[25px] font-normal tracking-[-0.03em] leading-[1.05] translate-x-10 -mt-[1px] shadow-lg border border-white/10">
                      <DecryptedText
                        text={activeStage.tagBottom}
                        speed={30}
                        maxIterations={10}
                        animateOn="view"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Lower Monolith Section */}
            <div className="px-8 sm:px-12 pb-10 pt-1 flex flex-col items-center text-center mt-auto relative z-20">
              <div className="relative w-full flex items-center justify-center my-3">
                <div className="absolute inset-x-0 h-px bg-current/15" />
                <Magnet padding={48} magnetStrength={2.5}>
                  <button
                    onClick={scrollToTechnicalSide}
                    className="relative z-10 bg-[#2934FF] hover:bg-[#1E27E6] active:scale-[0.99] text-white px-11 py-4 text-[15px] font-medium tracking-[-0.01em] transition-all shadow-[0_12px_28px_rgba(41,52,255,0.35)] cursor-pointer"
                  >
                    {lang === "en" ? "Get started" : "Mulai Simulasi"}
                  </button>
                </Magnet>
              </div>

              <div className="mt-5">
                <span className="inline-block border border-current/30 rounded-full px-3.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] opacity-80">
                  {lang === "en" ? "ZERO-RETENTION AI" : "AI TANPA RETENSI"}
                </span>
              </div>

              <div className="mt-3.5">
                <CobaltPixelCluster />
              </div>

              <h2 className="mt-3 text-[25px] sm:text-[29px] xl:text-[32px] font-normal leading-[1.13] tracking-[-0.035em] max-w-[340px]">
                <DecryptedText
                  text={activeStage.statement}
                  speed={18}
                  maxIterations={7}
                  animateOn="view"
                />
              </h2>
            </div>
          </div>

          {/* ------------------------------------------------------------------
              COLUMN 3 (RIGHT) — Top Controls + 5-Stage Wheel + 3D Hardware Card
              ------------------------------------------------------------------ */}
          <div className="flex flex-col justify-between px-8 sm:px-12 xl:px-14 py-9">
            {/* Top Right Utility Controls */}
            <div className="flex items-center justify-end gap-3">
              {/* Connect Wallet Button */}
              <button
                onClick={connectBrowserWallet}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-current/20 hover:border-[#2934FF] text-[11px] font-mono uppercase tracking-[0.08em] transition-colors cursor-pointer"
                title="Connect Phantom / Solflare (Read-Only)"
              >
                <Wallet className="w-3.5 h-3.5 text-[#2934FF]" />
                <span>
                  {isRealWalletConnected
                    ? `${connectedWallet.slice(0, 4)}..${connectedWallet.slice(
                        -4
                      )}`
                    : "Connect"}
                </span>
              </button>

              {/* Language Switch */}
              <button
                onClick={() => setLang(lang === "en" ? "id" : "en")}
                className="text-[11px] font-mono uppercase tracking-[0.12em] opacity-65 hover:opacity-100 transition-opacity px-2 py-1 cursor-pointer"
                title="Switch Language (EN / ID)"
              >
                {lang.toUpperCase()}
              </button>

              {/* Light / Dark Mode Toggle */}
              <button
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-current/20 text-[11px] font-mono uppercase tracking-[0.08em] opacity-85 hover:opacity-100 transition-opacity cursor-pointer"
                title="Toggle Dark / Light Mode"
              >
                {darkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-[#2934FF]" />
                    <span>Dark</span>
                  </>
                )}
              </button>

              {/* Menu Icon -> Opens Venice AI Key Modal */}
              <button
                onClick={() => setShowKeyModal(true)}
                className="p-1.5 opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
                title="Configure Venice AI Key"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>

            {/* Center 5-Stage Vertical Typographic Wheel */}
            <div className="my-auto py-14 flex flex-col items-center justify-center select-none">
              <ul className="flex flex-col items-center space-y-1.5 sm:space-y-2">
                {GUARD_STAGES.map((stage, idx) => {
                  const distance = Math.abs(idx - activeStageIdx);
                  const opacityClass =
                    distance === 0
                      ? "opacity-100 scale-[1.03]"
                      : distance === 1
                      ? "opacity-40 hover:opacity-75"
                      : "opacity-20 hover:opacity-60";

                  return (
                    <li key={stage.id}>
                      <button
                        onClick={() => handleStageClick(idx)}
                        onMouseEnter={() => setActiveStageIdx(idx)}
                        className={`text-[30px] sm:text-[36px] xl:text-[40px] font-normal leading-[1.18] tracking-[-0.03em] transition-all duration-300 cursor-pointer focus:outline-none ${opacityClass}`}
                      >
                        {stage.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="w-full hexacore-hairline-t my-2" />

            {/* Bottom: Live Solana Security Radar Card */}
            <div className="pt-6 pb-2 flex flex-col items-center justify-center">
              <TiltedCard
                rotateAmplitude={8}
                scaleOnHover={1.02}
                showGlare={true}
                className="w-full max-w-[280px] cursor-pointer group"
              >
                <div
                  onClick={scrollToTechnicalSide}
                  className="w-full p-4 rounded-xl border border-white/10 bg-[#0A0E17]/95 hover:border-[#2934FF]/50 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(#2934FF_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

                  <div className="flex items-center justify-between mb-2.5 relative z-10">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-emerald-400 font-semibold">
                        MAINNET LIVE
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-white/50">
                      ~142ms
                    </span>
                  </div>

                  <div className="h-12 w-full my-1.5 relative z-10 flex items-center justify-center overflow-hidden">
                    <svg
                      viewBox="0 0 240 48"
                      fill="none"
                      className="w-full h-full text-[#2934FF]"
                    >
                      <line
                        x1="0"
                        y1="24"
                        x2="240"
                        y2="24"
                        stroke="currentColor"
                        strokeOpacity="0.15"
                        strokeDasharray="3 3"
                      />
                      <path
                        d="M0 24 L45 24 L55 12 L65 36 L75 18 L85 28 L95 24 L140 24 L150 8 L160 40 L170 14 L180 32 L190 24 L240 24"
                        stroke="url(#pulseGrad)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="animate-pulse"
                      />
                      <defs>
                        <linearGradient
                          id="pulseGrad"
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          <stop
                            offset="0%"
                            stopColor="#2934FF"
                            stopOpacity="0.4"
                          />
                          <stop offset="50%" stopColor="#10B981" />
                          <stop offset="100%" stopColor="#2934FF" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10 relative z-10">
                    <div>
                      <span className="text-[9px] font-mono text-white/50 block">
                        SLOT TELEMETRY
                      </span>
                      <span className="text-[12px] font-mono text-white font-medium">
                        #{liveSlot.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono text-white/50 block">
                        ZERO-LOG INFERENCE
                      </span>
                      <span className="text-[11px] font-mono text-[#E05A2D] font-medium flex items-center gap-1">
                        <VeniceAiLogo className="w-3 h-3 text-[#E05A2D]" />
                        VENICE AI
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-white/80 group-hover:text-white transition-colors relative z-10">
                    <span className="text-[10px] font-mono uppercase tracking-[0.1em]">
                      SECURITY RADAR
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform text-[#2934FF]" />
                  </div>
                </div>
              </TiltedCard>
            </div>
          </div>
        </section>

        {/* ====================================================================
            SECTION 02 — TECHNICAL SIDE (INTERACTIVE SOLANA FIREWALL & VENICE AI)
            ==================================================================== */}
        <section
          id="technical-side"
          className="grid grid-cols-1 lg:grid-cols-[1fr_1.16fr_1fr] min-h-screen hexacore-hairline-b"
        >
          {/* COLUMN 1 (LEFT) — 01 // PAYLOAD SCENARIOS & LIVE RPC ACCOUNT/TX SCANNER */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="hexacore-hairline-r px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-8">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#2934FF] font-semibold">
                  01 // INTERCEPT VECTORS
                </span>
                <span className="text-[11px] font-mono opacity-50">
                  SOLANA MAINNET
                </span>
              </div>

              <h3 className="text-[32px] sm:text-[38px] font-normal tracking-[-0.035em] leading-[1.08] mb-3">
                {lang === "en" ? "Select Payload" : "Pilih Payload"}
              </h3>
              <p className="text-[13px] opacity-65 leading-relaxed mb-8">
                {lang === "en"
                  ? "Test SolShield against real-world Solana instruction payloads before signing."
                  : "Uji SolShield terhadap payload instruksi Solana nyata sebelum tanda tangan."}
              </p>

              <div className="divide-y divide-current/10 border-y border-current/10">
                {SIMULATION_PRESETS.map((item, index) => {
                  const active = selectedPreset.id === item.id;
                  const isDanger = item.badge !== "SAFE";
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedPreset(item)}
                      className={`w-full py-4 px-3 text-left transition-all flex items-center justify-between group cursor-pointer ${
                        active
                          ? "bg-[#2934FF] text-white"
                          : "hover:bg-current/5"
                      }`}
                    >
                      <div className="pr-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`text-[11px] font-mono ${
                              active ? "text-white/80" : "opacity-45"
                            }`}
                          >
                            0{index + 1}
                          </span>
                          <span className="text-[14px] font-medium tracking-[-0.01em]">
                            {item.name}
                          </span>
                        </div>
                        <p
                          className={`text-[11px] font-mono mt-1 truncate max-w-[240px] ${
                            active ? "text-white/75" : "opacity-50"
                          }`}
                        >
                          {item.subtitle}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] font-mono uppercase px-2 py-0.5 border ${
                            active
                              ? "border-white/40 text-white"
                              : isDanger
                              ? "border-red-500/40 text-red-500"
                              : "border-emerald-500/40 text-emerald-500"
                          }`}
                        >
                          {item.badge}
                        </span>
                        <ArrowUpRight className="w-4 h-4 opacity-70" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom: Live Solana Mainnet RPC Address OR Transaction Signature X-Ray */}
            <div className="mt-12 pt-8 hexacore-hairline-t">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono uppercase tracking-[0.12em] opacity-70">
                  LIVE ADDRESS / TX SIGNATURE X-RAY
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  SLOT #{liveSlot.toLocaleString()}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                <input
                  type="text"
                  value={agentAddress}
                  onChange={(e) => setAgentAddress(e.target.value)}
                  placeholder="Paste Solana Address or 88-char Tx Signature..."
                  className="w-full px-3.5 py-2.5 text-[12px] font-mono bg-transparent border border-current/20 focus:border-[#2934FF] focus:outline-none"
                />
                <button
                  onClick={() =>
                    sendAgentQuery(
                      `Inspect ${agentAddress} on Solana Mainnet and verify its owner program, transaction status, and safety.`
                    )
                  }
                  disabled={agentLoading}
                  className="w-full bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white py-3 text-[12px] font-mono uppercase tracking-[0.1em] transition-colors cursor-pointer"
                >
                  {agentLoading
                    ? "QUERYING SOLANA RPC..."
                    : "SCAN MAINNET ADDRESS / TX ↗"}
                </button>
              </div>
            </div>
          </SpotlightCard>

          {/* COLUMN 2 (CENTER MONOLITH) — 02 // PRE-SIGN EXECUTION MATRIX & REVOKE */}
          <div className="hexacore-hairline-r bg-[#E2E4E8] text-[#0A0A0C] px-8 sm:px-12 py-12 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-6 border-b border-[#0A0A0C]/15">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#2934FF] font-semibold">
                    02 // PRE-SIGN SANDBOX
                  </span>
                  <h3 className="text-[24px] sm:text-[28px] font-normal tracking-[-0.03em] leading-tight mt-1">
                    {selectedPreset.name}
                  </h3>
                </div>
                <span
                  className={`px-3 py-1 text-[11px] font-mono uppercase tracking-[0.08em] font-semibold shrink-0 ${
                    isCritical
                      ? "bg-[#0A0A0C] text-red-400"
                      : "bg-[#0A0A0C] text-emerald-400"
                  }`}
                >
                  {emergencyLocked
                    ? "VAULT LOCKED"
                    : isCritical
                    ? "THREAT DETECTED"
                    : "VERIFIED ROUTE"}
                </span>
              </div>

              {/* Balance Changes Matrix */}
              <div className="mt-8">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-[#0A0A0C]/60">
                    ESTIMATED ASSET DELTAS
                  </span>
                  <button
                    onClick={handleExportAuditProof}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-[#2934FF] hover:underline cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>EXPORT PROOF (.JSON)</span>
                  </button>
                </div>

                <div className="divide-y divide-[#0A0A0C]/15 border-y border-[#0A0A0C]/15 bg-white/60">
                  {selectedPreset.simulatedBalanceDeltas.map((change, i) => (
                    <div
                      key={i}
                      className="p-4 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-[15px] font-medium text-[#0A0A0C]">
                          {change.asset}
                        </p>
                        <p className="text-[11px] font-mono text-[#0A0A0C]/60">
                          {change.mint.slice(0, 8)}...{change.mint.slice(-6)}
                        </p>
                      </div>
                      <span
                        className={`text-[16px] font-mono font-semibold ${
                          change.direction === "OUT"
                            ? "text-red-600"
                            : "text-emerald-700"
                        }`}
                      >
                        {change.direction === "IN" ? "+" : ""}
                        {change.deltaUiAmount} {change.asset.split(" ")[0]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Decoded Instruction & Threat Telemetry */}
              <div className="mt-8">
                <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-[#0A0A0C]/60 block mb-3">
                  DECODED INSTRUCTION AST & HOOKS
                </span>
                <div className="p-4 bg-[#0A0A0C] text-white font-mono text-[12px] space-y-2.5">
                  <div className="flex items-center justify-between text-white/60">
                    <span>ACTION_ENDPOINT</span>
                    <span className="text-white truncate max-w-[220px]">
                      {selectedPreset.blinkActionUrl.replace(
                        "solana-action:",
                        ""
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-white/60">
                    <span>INSTRUCTIONS_COUNT</span>
                    <span className="text-[#6B78FF] font-semibold">
                      {simulationReport?.instructions.length ?? 2} CPI CALLS
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-white/60">
                    <span>ANCHOR_PDA_GUARD</span>
                    <span
                      className={
                        auditResult?.policyGuardVerdict?.passesPolicy ===
                          false || emergencyLocked
                          ? "text-red-400 font-semibold"
                          : "text-emerald-400"
                      }
                    >
                      {emergencyLocked
                        ? "REVERT (EmergencyLocked)"
                        : auditResult?.policyGuardVerdict?.passesPolicy ===
                          false
                        ? `REVERT (${auditResult.policyGuardVerdict.reason?.slice(
                            0,
                            26
                          )}...)`
                        : "PASS (Within Policy)"}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-white/15 text-[11px] text-white/65 break-all">
                    {selectedPreset.contextNotes}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Action Bar in Center Monolith */}
            <div className="mt-10 pt-6 border-t border-[#0A0A0C]/15 space-y-3">
              {walletStatus === "PENDING" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setWalletStatus("BLOCKED")}
                    className="py-4 px-5 bg-[#0A0A0C] hover:bg-neutral-800 text-white text-[13px] font-mono uppercase tracking-[0.08em] transition-colors cursor-pointer"
                  >
                    {isCritical ? "BLOCK PAYLOAD" : "REJECT"}
                  </button>
                  <button
                    onClick={() =>
                      setWalletStatus(emergencyLocked ? "BLOCKED" : "SIGNED")
                    }
                    className={`py-4 px-5 text-white text-[13px] font-mono uppercase tracking-[0.08em] transition-colors cursor-pointer ${
                      isCritical
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-[#2934FF] hover:bg-[#1E28E6]"
                    }`}
                  >
                    {emergencyLocked
                      ? "LOCKED BY PDA"
                      : isCritical
                      ? "SIGN ANYWAY (UNSAFE)"
                      : "APPROVE & SIGN"}
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-[#0A0A0C] text-white flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-[13px] font-mono">
                    {walletStatus === "BLOCKED" ? (
                      <>
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>PAYLOAD INTERCEPTED & BLOCKED</span>
                      </>
                    ) : walletStatus === "REVOKED" ? (
                      <>
                        <RotateCcw className="w-4 h-4 text-emerald-400" />
                        <span>SPL DELEGATE AUTHORITY REVOKED (TAG 5)</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                        <span>TRANSACTION SIGNED IN SANDBOX</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setWalletStatus("PENDING")}
                    className="text-[11px] font-mono uppercase underline text-[#6B78FF] cursor-pointer"
                  >
                    RESET
                  </button>
                </div>
              )}

              {/* 1-Click SPL Token Delegate Revoke Button */}
              <button
                onClick={() => setWalletStatus("REVOKED")}
                className="w-full py-2.5 px-4 border border-[#0A0A0C]/25 hover:bg-[#0A0A0C] hover:text-white text-[#0A0A0C] text-[11px] font-mono uppercase tracking-[0.1em] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>
                  EMERGENCY REVOKE SPL TOKEN DELEGATE (INSTRUCTION TAG 5)
                </span>
              </button>
            </div>
          </div>

          {/* COLUMN 3 (RIGHT) — 03 // VENICE AI ZERO-RETENTION VERDICT & AGENT */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <VeniceAiLogo className="w-4 h-4 text-[#E05A2D]" />
                  <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#2934FF] font-semibold">
                    03 // VENICE AI VERDICT
                  </span>
                </div>
                <button
                  onClick={() => runVeniceAudit(selectedPreset)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase opacity-65 hover:opacity-100 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isAuditing ? "animate-spin" : ""
                    }`}
                  />
                  <span>RE-AUDIT</span>
                </button>
              </div>

              <div className="flex items-baseline justify-between pb-6 hexacore-hairline-b">
                <div>
                  <span className="text-[11px] font-mono uppercase opacity-55 block">
                    BEHAVIORAL RISK SCORE
                  </span>
                  <div className="text-[52px] sm:text-[60px] font-normal tracking-[-0.04em] leading-none mt-1">
                    {isAuditing ? (
                      <span className="opacity-40">··</span>
                    ) : (
                      auditResult?.riskScore ?? 96
                    )}
                    <span className="text-[20px] opacity-40 font-mono ml-1">
                      /100
                    </span>
                  </div>
                </div>

                <span
                  className={`px-3 py-1 text-[11px] font-mono uppercase border ${
                    isCritical
                      ? "border-red-500/50 text-red-500 bg-red-500/10"
                      : "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                  }`}
                >
                  {auditResult?.recommendedAction || "BLOCK_IMMEDIATELY"}
                </span>
              </div>

              <div className="py-6 hexacore-hairline-b space-y-3">
                <h4 className="text-[16px] font-medium tracking-[-0.01em] leading-snug">
                  {auditResult?.executiveSummary ||
                    "Auditing instruction graph via zero-retention Venice AI..."}
                </h4>
                {auditResult?.technicalFindings &&
                  auditResult.technicalFindings.length > 0 && (
                    <ul className="space-y-1.5 pt-1">
                      {auditResult.technicalFindings
                        .slice(0, 2)
                        .map((finding, idx) => (
                          <li
                            key={idx}
                            className="text-[12px] opacity-75 leading-relaxed font-mono"
                          >
                            → {finding}
                          </li>
                        ))}
                    </ul>
                  )}
              </div>

              {/* Interactive Venice AI × Solana Mainnet Chat Console */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-mono uppercase tracking-[0.1em] opacity-80 flex items-center gap-1.5">
                    <VeniceAiLogo className="w-3.5 h-3.5 text-[#E05A2D]" />
                    LIVE VENICE AI AGENT
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `curl -X POST https://api.venice.ai/api/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"llama-3.3-70b","venice_parameters":{"include_venice_system_prompt":false}}'`
                      );
                      setCopiedCurl(true);
                      setTimeout(() => setCopiedCurl(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-mono uppercase opacity-55 hover:opacity-100 cursor-pointer"
                  >
                    {copiedCurl ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedCurl ? "COPIED" : "ZERO-LOG PROOF"}</span>
                  </button>
                </div>

                <div className="max-h-[210px] overflow-y-auto space-y-2.5 pr-1 mb-3">
                  {agentMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`p-3 text-[12px] leading-relaxed border ${
                        msg.role === "user"
                          ? "bg-[#2934FF] text-white border-[#2934FF]"
                          : "border-current/15 bg-current/[0.03]"
                      }`}
                    >
                      {msg.telemetry && (
                        <div className="mb-1.5 pb-1.5 border-b border-current/10 flex flex-wrap gap-2 text-[10px] font-mono opacity-75">
                          <span>SLOT: {msg.telemetry.slot}</span>
                          {msg.telemetry.solBalance && (
                            <span>BAL: {msg.telemetry.solBalance} SOL</span>
                          )}
                        </div>
                      )}
                      <p className="whitespace-pre-line">{msg.content}</p>
                    </div>
                  ))}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendAgentQuery();
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    placeholder="Ask Venice AI or paste a txHash..."
                    className="flex-1 px-3 py-2.5 text-[12px] bg-transparent border border-current/20 focus:border-[#2934FF] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={agentLoading}
                    className="px-4 py-2.5 bg-[#2934FF] hover:bg-[#1E28E6] text-white transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </div>
          </SpotlightCard>
        </section>

        {/* ====================================================================
            SECTION 03 — AUTONOMOUS INTENT COPILOT, ANCHOR PDA VAULT & BLINKS
            Continues the 3-Column Hexacore Architectural Grid
            ==================================================================== */}
        <section
          id="vault-side"
          className="grid grid-cols-1 lg:grid-cols-[1fr_1.16fr_1fr] hexacore-hairline-b"
        >
          {/* COLUMN 1 (LEFT) — 04 // NATURAL-LANGUAGE DEFI INTENT COPILOT */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="hexacore-hairline-r px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#2934FF] font-semibold">
                  04 // DEFI INTENT COPILOT
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 border border-current/20">
                  /API/INTENT
                </span>
              </div>

              <h3 className="text-[28px] sm:text-[32px] font-normal tracking-[-0.035em] leading-[1.1] mb-3">
                Plain-English to Guarded Tx
              </h3>
              <p className="text-[13px] opacity-65 leading-relaxed mb-6">
                Express what you want to trade in plain language. Venice AI
                parses your intent and verifies it against your Anchor{" "}
                <code className="font-mono">SecurityPolicy</code> PDA before
                building the Jupiter route.
              </p>

              {/* Sample Intent Pills */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {INTENT_SAMPLES.map((sample, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setIntentPrompt(sample);
                      runIntentCopilot(sample);
                    }}
                    className="text-[11px] font-mono px-2.5 py-1 border border-current/20 hover:border-[#2934FF] text-left transition-colors cursor-pointer"
                  >
                    {sample.slice(0, 32)}...
                  </button>
                ))}
              </div>

              <textarea
                value={intentPrompt}
                onChange={(e) => setIntentPrompt(e.target.value)}
                rows={3}
                className="w-full p-3 text-[13px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
                placeholder="e.g., Swap 1.5 SOL to USDC on Jupiter with max 0.5% slippage..."
              />

              <button
                type="button"
                onClick={() => runIntentCopilot()}
                disabled={intentLoading}
                className="mt-3 w-full bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white py-3 text-[12px] font-mono uppercase tracking-[0.1em] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {intentLoading
                    ? "BUILDING GUARDED SWAP..."
                    : "COMPILE GUARDED INTENT ↗"}
                </span>
              </button>
            </div>

            {intentResponse && (
              <div className="mt-8 pt-6 hexacore-hairline-t font-mono text-[12px] space-y-2">
                <div className="flex justify-between">
                  <span className="opacity-60">PARSED_ACTION</span>
                  <span className="font-semibold">
                    {intentResponse.intent.action}{" "}
                    {intentResponse.intent.amount}{" "}
                    {intentResponse.intent.inputToken} →{" "}
                    {intentResponse.intent.outputToken}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">MAX_SLIPPAGE</span>
                  <span>{intentResponse.intent.maxSlippageBps} BPS</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">PDA_POLICY_CHECK</span>
                  <span
                    className={
                      intentResponse.intent.amount > maxDailySol ||
                      emergencyLocked
                        ? "text-red-500 font-semibold"
                        : "text-emerald-500 font-semibold"
                    }
                  >
                    {emergencyLocked
                      ? "BLOCKED (EmergencyLock)"
                      : intentResponse.intent.amount > maxDailySol
                      ? `BLOCKED (Exceeds ${maxDailySol} SOL Cap)`
                      : "APPROVED BY PDA"}
                  </span>
                </div>
                <p className="text-[11px] opacity-70 pt-2 font-sans">
                  {intentResponse.intent.explanation}
                </p>
              </div>
            )}
          </SpotlightCard>

          {/* COLUMN 2 (CENTER MONOLITH) — 05 // ANCHOR SECURITYPOLICY PDA VAULT */}
          <div className="hexacore-hairline-r bg-[#E2E4E8] text-[#0A0A0C] px-8 sm:px-12 py-12 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-6 border-b border-[#0A0A0C]/15">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#2934FF] font-semibold">
                    05 // ANCHOR POLICY PDA VAULT
                  </span>
                  <h3 className="text-[24px] sm:text-[28px] font-normal tracking-[-0.03em] leading-tight mt-1">
                    On-Chain Spending Guardrails
                  </h3>
                </div>
                <span className="px-2.5 py-1 bg-[#0A0A0C] text-white text-[10px] font-mono uppercase">
                  Anchor v0.30.1
                </span>
              </div>

              {/* Derived PDA Box */}
              <div className="mt-6 p-4 bg-[#0A0A0C] text-white font-mono text-[11px] space-y-1.5">
                <div className="flex justify-between text-white/60">
                  <span>WALLET_OWNER</span>
                  <span className="text-white">
                    {connectedWallet.slice(0, 8)}...{connectedWallet.slice(-6)}
                  </span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>DERIVED_POLICY_PDA</span>
                  <span className="text-emerald-400">
                    {derivedPdaAddress.slice(0, 10)}...
                    {derivedPdaAddress.slice(-6)}
                  </span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>SEEDS</span>
                  <span>[&quot;solshield_policy&quot;, owner]</span>
                </div>
              </div>

              {/* Sliders for 24h Spend Cap & Risk Threshold */}
              <div className="mt-6 space-y-5">
                <div className="p-4 bg-white/70 border border-[#0A0A0C]/15">
                  <div className="flex justify-between text-[12px] font-mono mb-2">
                    <span>MAX DAILY SPEND (24H ROLLING)</span>
                    <span className="font-bold text-[#2934FF]">
                      {maxDailySol.toFixed(1)} SOL (
                      {(maxDailySol * 1e9).toLocaleString()} lamports)
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={20}
                    step={0.5}
                    value={maxDailySol}
                    onChange={(e) => setMaxDailySol(Number(e.target.value))}
                    className="w-full accent-[#2934FF] cursor-pointer"
                  />
                </div>

                <div className="p-4 bg-white/70 border border-[#0A0A0C]/15">
                  <div className="flex justify-between text-[12px] font-mono mb-2">
                    <span>MAX ALLOWED VENICE RISK SCORE</span>
                    <span className="font-bold text-[#2934FF]">
                      {maxAllowedRisk} / 100
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    step={5}
                    value={maxAllowedRisk}
                    onChange={(e) => setMaxAllowedRisk(Number(e.target.value))}
                    className="w-full accent-[#2934FF] cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Emergency Circuit Breaker Button */}
            <div className="mt-8 pt-6 border-t border-[#0A0A0C]/15">
              <button
                type="button"
                onClick={() => setEmergencyLocked(!emergencyLocked)}
                className={`w-full py-4 px-5 font-mono text-[12px] uppercase tracking-[0.1em] text-white transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  emergencyLocked
                    ? "bg-emerald-700 hover:bg-emerald-800"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {emergencyLocked ? (
                  <>
                    <Unlock className="w-4 h-4" />
                    <span>
                      UNLOCK ANCHOR POLICY VAULT (RESTORE SIGNING)
                    </span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>
                      ENGAGE EMERGENCY CIRCUIT BREAKER (FREEZE VAULT)
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* COLUMN 3 (RIGHT) — 06 // SOLANA ACTIONS & BLINKS STUDIO */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#2934FF] font-semibold">
                  06 // SOLANA BLINKS & ACTIONS
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 border border-emerald-500/40 text-emerald-500">
                  ACTIONS.JSON READY
                </span>
              </div>

              <h3 className="text-[28px] sm:text-[32px] font-normal tracking-[-0.035em] leading-[1.1] mb-3">
                Shareable Guarded Blink
              </h3>
              <p className="text-[13px] opacity-65 leading-relaxed mb-6">
                SolShield exposes a spec-compliant Solana Action endpoint at{" "}
                <code className="font-mono">/api/actions/audit-swap</code> that
                runs a Venice AI pre-flight check before returning the swap
                payload to X/Twitter Blinks.
              </p>

              {/* Visual Blink Card Preview */}
              <div className="p-5 border border-current/20 bg-current/[0.03] space-y-4">
                <div className="flex items-center gap-3">
                  <img
                    src="/logo.jpg"
                    alt="SolShield Blink"
                    className="w-10 h-10 rounded-lg object-cover border border-white/20"
                  />
                  <div>
                    <div className="text-[14px] font-medium">
                      SolShield — Venice AI Guarded Swap
                    </div>
                    <div className="text-[11px] font-mono opacity-60">
                      solshield-wine.vercel.app • Zero-Log Action
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {["0.1", "0.5", "1"].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setSelectedBlinkSol(amt);
                        setSelectedPreset(SIMULATION_PRESETS[0]);
                        scrollToTechnicalSide();
                      }}
                      className={`py-2.5 text-[12px] font-mono border transition-colors cursor-pointer ${
                        selectedBlinkSol === amt
                          ? "bg-[#2934FF] text-white border-[#2934FF]"
                          : "border-current/20 hover:border-[#2934FF]"
                      }`}
                    >
                      {amt} SOL
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const actionUrl = `solana-action:${window.location.origin}/api/actions/audit-swap?amount=${selectedBlinkSol}`;
                    navigator.clipboard.writeText(actionUrl);
                    setCopiedBlinkUrl(true);
                    setTimeout(() => setCopiedBlinkUrl(false), 2000);
                  }}
                  className="w-full py-2.5 border border-current/25 hover:border-[#2934FF] text-[11px] font-mono uppercase flex items-center justify-center gap-2 cursor-pointer"
                >
                  {copiedBlinkUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>COPIED SOLANA-ACTION: URL</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-3.5 h-3.5" />
                      <span>COPY BLINK ACTION URL</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="mt-8 pt-6 hexacore-hairline-t flex items-center justify-between text-[11px] font-mono opacity-70">
              <span>Built by @Blanksite</span>
              <a
                href="https://github.com/Blanksite/solshield-protocol"
                target="_blank"
                rel="noreferrer"
                className="underline hover:opacity-100"
              >
                Open-Source MIT Repository ↗
              </a>
            </div>
          </SpotlightCard>
        </section>

        {/* ====================================================================
            BYOK VENICE AI API KEY MODAL
            ==================================================================== */}
        {showKeyModal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="hexacore-canvas border border-current/20 max-w-md w-full p-7 shadow-2xl">
              <div className="flex items-center justify-between pb-4 hexacore-hairline-b">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[#2934FF]" />
                  <h3 className="text-[16px] font-medium">
                    Venice AI Zero-Retention Key
                  </h3>
                </div>
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="opacity-60 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[13px] opacity-75 leading-relaxed mt-4">
                SolShield runs out-of-the-box with our built-in zero-retention
                engine. Optionally supply your own{" "}
                <code className="font-mono text-[#2934FF]">
                  api.venice.ai
                </code>{" "}
                key (<code className="font-mono">llama-3.3-70b</code>):
              </p>

              <input
                type="password"
                value={veniceApiKey}
                onChange={(e) => setVeniceApiKey(e.target.value)}
                placeholder="vn-..."
                className="w-full mt-4 px-3.5 py-2.5 text-[13px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
              />

              <div className="flex justify-end gap-2.5 mt-6">
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2 text-[12px] font-mono uppercase border border-current/20 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("solshield_venice_key", veniceApiKey);
                    setShowKeyModal(false);
                    runVeniceAudit(selectedPreset);
                  }}
                  className="px-5 py-2 text-[12px] font-mono uppercase bg-[#2934FF] text-white cursor-pointer"
                >
                  Save & Audit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClickSpark>
  );
}
