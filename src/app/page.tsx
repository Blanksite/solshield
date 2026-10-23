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
  Terminal,
  X,
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
  const [activeStageIdx, setActiveStageIdx] = useState<number>(2); // Default: "Predict"

  const [selectedPreset, setSelectedPreset] = useState<SimulationPreset>(
    SIMULATION_PRESETS[1] // Default: Phishing Blink SetAuthority Drainer
  );
  const [simulationReport, setSimulationReport] =
    useState<DeterministicSimulationReport | null>(null);
  const [auditResult, setAuditResult] =
    useState<VeniceSecurityAuditResult | null>(null);
  const [liveSlot, setLiveSlot] = useState<number>(328491024);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [walletStatus, setWalletStatus] = useState<
    "PENDING" | "BLOCKED" | "SIGNED"
  >("PENDING");

  const [veniceApiKey, setVeniceApiKey] = useState<string>("");
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

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
        "SolShield Adaptive AI Guard online. Paste any Solana Mainnet address (Token Mint, Program ID, or Wallet) or select a payload on the left to execute a zero-retention Venice AI behavioral audit.",
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
          message: questionText,
          address: agentAddress.trim() || undefined,
          apiKey: veniceApiKey.trim() || undefined,
          language: lang,
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

  const activeStage = GUARD_STAGES[activeStageIdx];
  const isCritical =
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
              {/* Dual overlapping circular portraits: GitHub SolShield Logo + Real Venice AI Logo */}
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
              COLUMN 2 (CENTER MONOLITH) — Top Nav + Halftone Guardian + Silver Monolith
              ------------------------------------------------------------------ */}
          <div className="flex flex-col justify-between hexacore-hairline-r bg-[#E6E7EB] text-[#0A0A0C] relative overflow-hidden">
            {/* Top Pitch-Black Band that merges seamlessly with the top of halftone-guardian.jpg */}
            <div className="bg-[#020203] text-white px-8 pt-9 pb-5 z-20">
              <nav className="flex items-center justify-center gap-8 sm:gap-11 text-[13px] font-normal tracking-[-0.01em] text-white/85">
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={scrollToTechnicalSide}
                    className="hover:text-white transition-colors"
                  >
                    {lang === "en" ? "Features" : "Fitur"}
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={scrollToTechnicalSide}
                    className="hover:text-white transition-colors"
                  >
                    {lang === "en" ? "Simulator" : "Simulator"}
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <a
                    href="https://github.com/veniceai/builtinvenice/pull/194"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-white transition-colors"
                  >
                    {lang === "en" ? "Resources" : "Referensi"}
                  </a>
                </Magnet>
              </nav>
            </div>

            {/* Center Interactive Dither Veil (React Bits: https://reactbits.dev/animations/dither-veil) */}
            <div className="relative w-full bg-[#E6E7EB] flex-1 flex flex-col items-center">
              <div className="relative w-full h-[64vh] sm:h-[68vh] xl:h-[72vh] min-h-[520px] overflow-hidden select-none bg-[#E6E7EB]">
                <DitherVeil
                  src="/cyber-portrait.jpg"
                  fit="cover"
                  pattern="bayer"
                  pixelSize={2}
                  levels={2}
                  palette="duotone"
                  inkColor="#0A0A0C"
                  paperColor="#E6E7EB"
                  revealRadius={180}
                  softness={0.65}
                  linger={1.2}
                  rimColor="#2934FF"
                  rim={0.14}
                  wander={false}
                  clickBurst={true}
                  className="w-full h-full"
                />

                {/* Diagonal Corner-Touching Black Overlay Tags: "security" / "at the core" */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <div className="relative flex flex-col items-center translate-y-1">
                    {/* Top-left black tag */}
                    <div className="bg-[#0A0A0C] text-white px-3.5 py-1 text-[21px] sm:text-[25px] font-normal tracking-[-0.03em] leading-[1.05] -translate-x-12 shadow-lg">
                      <DecryptedText
                        text={activeStage.tagTop}
                        speed={30}
                        maxIterations={10}
                        animateOn="view"
                      />
                    </div>
                    {/* Bottom-right black tag touching corner */}
                    <div className="bg-[#0A0A0C] text-white px-3.5 py-1 text-[21px] sm:text-[25px] font-normal tracking-[-0.03em] leading-[1.05] translate-x-10 -mt-[1px] shadow-lg">
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

            {/* Lower Silver-Alabaster Monolith Section (#E6E7EB) */}
            <div className="bg-[#E6E7EB] text-[#0A0A0C] px-8 sm:px-12 pb-10 pt-2 flex flex-col items-center text-center mt-auto">
              {/* Full-width horizontal hairline bisected by the sharp Electric Cobalt CTA */}
              <div className="relative w-full flex items-center justify-center my-3">
                <div className="absolute inset-x-0 h-px bg-[#0A0A0C]/20" />
                <Magnet padding={48} magnetStrength={2.5}>
                  <button
                    onClick={scrollToTechnicalSide}
                    className="relative z-10 bg-[#2934FF] hover:bg-[#1E27E6] active:scale-[0.99] text-white px-11 py-4 text-[15px] font-medium tracking-[-0.01em] transition-all shadow-[0_12px_28px_rgba(41,52,255,0.28)]"
                  >
                    {lang === "en" ? "Get started" : "Mulai Simulasi"}
                  </button>
                </Magnet>
              </div>

              {/* Oval Pill Outline Badge ("ABOUT US") */}
              <div className="mt-5">
                <span className="inline-block border border-[#0A0A0C]/75 rounded-full px-3.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0A0A0C]">
                  {lang === "en" ? "ABOUT US" : "TENTANG KAMI"}
                </span>
              </div>

              {/* 3-Square Electric Cobalt Pixel Cluster */}
              <div className="mt-3.5">
                <CobaltPixelCluster />
              </div>

              {/* Large Clean Regular-Weight Centered Statement */}
              <h2 className="mt-3 text-[25px] sm:text-[29px] xl:text-[32px] font-normal leading-[1.13] tracking-[-0.035em] text-[#0A0A0C] max-w-[330px]">
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
            <div className="flex items-center justify-end gap-4">
              {/* Language Switch */}
              <button
                onClick={() => setLang(lang === "en" ? "id" : "en")}
                className="text-[11px] font-mono uppercase tracking-[0.12em] opacity-65 hover:opacity-100 transition-opacity px-2 py-1"
                title="Switch Language (EN / ID)"
              >
                {lang.toUpperCase()}
              </button>

              {/* Search Icon -> Scrolls to Live RPC Scanner */}
              <button
                onClick={scrollToTechnicalSide}
                className="p-1.5 opacity-80 hover:opacity-100 transition-opacity"
                title="Search Solana Mainnet Address"
              >
                <Search className="w-[18px] h-[18px]" />
              </button>

              {/* Explicit Light / Dark Mode Toggle */}
              <button
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-current/20 text-[11px] font-mono uppercase tracking-[0.08em] opacity-85 hover:opacity-100 transition-opacity"
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
                className="p-1.5 opacity-80 hover:opacity-100 transition-opacity"
                title="Configure Venice AI Key"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>

            {/* Center 5-Stage Vertical Typographic Wheel (Identify / Block / Predict / Adapt / Recover) */}
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

            {/* Horizontal Hairline Divider */}
            <div className="w-full hexacore-hairline-t my-2" />

            {/* Bottom 3D Exploded Hardware Card ("TECHNICAL SIDE ↗") */}
            <div className="pt-8 pb-2 flex flex-col items-center justify-center">
              <TiltedCard
                rotateAmplitude={9}
                scaleOnHover={1.02}
                showGlare={true}
                className="w-full max-w-[270px] cursor-pointer group"
              >
                <div onClick={scrollToTechnicalSide} className="w-full">
                  <div className="w-full aspect-[16/10] overflow-hidden bg-[#CBD5F5]">
                    <img
                      src="/hardware-exploded.jpg"
                      alt="Cryptographic Hardware Architecture"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="mt-3.5 flex items-start justify-between w-full">
                    <span className="text-[10.5px] font-normal uppercase tracking-[0.06em] leading-[1.32] opacity-80 group-hover:opacity-100">
                      TECHNICAL
                      <br />
                      SIDE
                    </span>
                    <ArrowUpRight className="w-4 h-4 opacity-80 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </div>
                </div>
              </TiltedCard>
            </div>
          </div>
        </section>

        {/* ====================================================================
            SECTION 02 — TECHNICAL SIDE (INTERACTIVE SOLANA FIREWALL & VENICE AI)
            Continues the exact 3-Column Architectural Grid below the fold
            ==================================================================== */}
        <section
          id="technical-side"
          className="grid grid-cols-1 lg:grid-cols-[1fr_1.16fr_1fr] min-h-screen hexacore-hairline-b"
        >
          {/* ------------------------------------------------------------------
              COLUMN 1 (LEFT) — 01 // PAYLOAD SCENARIOS & LIVE RPC SCANNER
              ------------------------------------------------------------------ */}
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

              {/* Architectural Scenario List */}
              <div className="divide-y divide-current/10 border-y border-current/10">
                {SIMULATION_PRESETS.map((item, index) => {
                  const active = selectedPreset.id === item.id;
                  const isDanger = item.badge !== "SAFE";
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedPreset(item)}
                      className={`w-full py-4 px-3 text-left transition-all flex items-center justify-between group ${
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

            {/* Bottom: Live Solana Mainnet RPC Address Input */}
            <div className="mt-12 pt-8 hexacore-hairline-t">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono uppercase tracking-[0.12em] opacity-70">
                  LIVE RPC ACCOUNT SCANNER
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
                  placeholder="Paste Solana Mainnet address..."
                  className="w-full px-3.5 py-2.5 text-[12px] font-mono bg-transparent border border-current/20 focus:border-[#2934FF] focus:outline-none"
                />
                <button
                  onClick={() =>
                    sendAgentQuery(
                      `Inspect Solana address ${agentAddress} on Mainnet and verify its owner program and safety.`
                    )
                  }
                  disabled={agentLoading}
                  className="w-full bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white py-3 text-[12px] font-mono uppercase tracking-[0.1em] transition-colors"
                >
                  {agentLoading
                    ? "QUERYING SOLANA RPC..."
                    : "SCAN MAINNET ADDRESS ↗"}
                </button>
              </div>
            </div>
          </SpotlightCard>

          {/* ------------------------------------------------------------------
              COLUMN 2 (CENTER MONOLITH) — 02 // PRE-SIGN EXECUTION MATRIX
              ------------------------------------------------------------------ */}
          <div className="hexacore-hairline-r bg-[#E2E4E8] text-[#0A0A0C] px-8 sm:px-12 py-12 flex flex-col justify-between">
            <div>
              {/* Top Monolith Header */}
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
                  {isCritical ? "THREAT DETECTED" : "VERIFIED ROUTE"}
                </span>
              </div>

              {/* Balance Changes Matrix */}
              <div className="mt-8">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-[#0A0A0C]/60">
                    ESTIMATED ASSET DELTAS
                  </span>
                  <span className="text-[11px] font-mono text-[#0A0A0C]/60">
                    SLOT #{liveSlot.toLocaleString()}
                  </span>
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
                    <span>THREAT_FLAGS</span>
                    <span
                      className={
                        (simulationReport?.threatFlags.length ?? 0) > 0
                          ? "text-red-400 font-semibold"
                          : "text-emerald-400"
                      }
                    >
                      {(simulationReport?.threatFlags.length ?? 0) > 0
                        ? `${simulationReport?.threatFlags.length} CRITICAL FLAGS`
                        : "0 FLAGS (CLEAN)"}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-white/15 text-[11px] text-white/65 break-all">
                    {selectedPreset.contextNotes}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Action Bar in Center Monolith */}
            <div className="mt-10 pt-6 border-t border-[#0A0A0C]/15">
              {walletStatus === "PENDING" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setWalletStatus("BLOCKED")}
                    className="py-4 px-5 bg-[#0A0A0C] hover:bg-neutral-800 text-white text-[13px] font-mono uppercase tracking-[0.08em] transition-colors"
                  >
                    {isCritical ? "BLOCK PAYLOAD" : "REJECT"}
                  </button>
                  <button
                    onClick={() => setWalletStatus("SIGNED")}
                    className={`py-4 px-5 text-white text-[13px] font-mono uppercase tracking-[0.08em] transition-colors ${
                      isCritical
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-[#2934FF] hover:bg-[#1E28E6]"
                    }`}
                  >
                    {isCritical ? "SIGN ANYWAY (UNSAFE)" : "APPROVE & SIGN"}
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
                    ) : (
                      <>
                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                        <span>TRANSACTION SIGNED IN SANDBOX</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setWalletStatus("PENDING")}
                    className="text-[11px] font-mono uppercase underline text-[#6B78FF]"
                  >
                    RESET
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ------------------------------------------------------------------
              COLUMN 3 (RIGHT) — 03 // VENICE AI ZERO-RETENTION VERDICT & AGENT
              ------------------------------------------------------------------ */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <VeniceAiLogo className="w-4 h-4 text-[#E05A2D]" />
                  <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[#2934FF] font-semibold">
                    03 // VENICE AI VERDICT
                  </span>
                </div>
                <button
                  onClick={() => runVeniceAudit(selectedPreset)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase opacity-65 hover:opacity-100"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isAuditing ? "animate-spin" : ""
                    }`}
                  />
                  <span>RE-AUDIT</span>
                </button>
              </div>

              {/* Giant Risk Score Display */}
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

              {/* Plain-Language Explanation */}
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
                    className="inline-flex items-center gap-1 text-[10px] font-mono uppercase opacity-55 hover:opacity-100"
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
                    placeholder="Ask Venice AI about this payload..."
                    className="flex-1 px-3 py-2.5 text-[12px] bg-transparent border border-current/20 focus:border-[#2934FF] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={agentLoading}
                    className="px-4 py-2.5 bg-[#2934FF] hover:bg-[#1E28E6] text-white transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
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
                  className="opacity-60 hover:opacity-100"
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
                  className="px-4 py-2 text-[12px] font-mono uppercase border border-current/20"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("solshield_venice_key", veniceApiKey);
                    setShowKeyModal(false);
                    runVeniceAudit(selectedPreset);
                  }}
                  className="px-5 py-2 text-[12px] font-mono uppercase bg-[#2934FF] text-white"
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
