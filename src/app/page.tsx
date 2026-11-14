"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { VeniceSecurityAuditResult } from "@/lib/venice-ai";
import { DeterministicSimulationReport } from "@/lib/solana-parser";
import type { TokenScanReport } from "@/lib/token-scanner";
import type { RpcTxSimulationReport } from "@/lib/tx-simulator";
import type { BlinkActionInspectionMeta } from "@/lib/blink-inspector";
import {
  clearLocalScannedTokens,
  mergeScannedTokenLists,
  readLocalScannedTokens,
  saveLocalScannedToken,
  type ScannedTokenSummary,
} from "@/lib/scanned-token-types";
import { getSolShieldTokenConfig } from "@/lib/token-config";
import { deriveSecurityPolicyPda } from "@/lib/anchor-idl";
import {
  buildInitializePolicyTransaction,
  buildSetEmergencyLockTransaction,
  buildSplDelegateRevokeTransaction,
  buildUpdatePolicyTransaction,
  deriveAssociatedTokenAccountForMint,
  deriveUsdcAssociatedTokenAccount,
  PolicyVaultStatus,
  SerializedInstructionArtifact,
  submitPolicyArtifactWithWallet,
} from "@/lib/anchor-vault";
import FooterWordmark from "@/components/FooterWordmark";
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
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ArrowUp,
  Shield,
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
  targetMode: "payload" | "token" | "vault" | "blinks";
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
    inferenceMode?: "venice-live-api" | "deterministic-fallback";
  };
  policyOwner?: string;
  policyScope?: "wallet" | "protocol-default";
  policyPda: {
    pda: string;
    bump: number;
  } | null;
  previewWalletUsed?: boolean;
  recentBlockhash?: string | null;
  base64Transaction?: string | null;
  quote?: {
    quoteMode: "jupiter-v1-live" | "jupiter-unavailable";
    inputMint: string;
    outputMint: string;
    inAmountUi: number;
    outAmountUi: number | null;
    effectiveRate: number | null;
    priceImpactPct: string | null;
    routeLabels: string[];
    error?: string;
  };
  veniceAudit: VeniceSecurityAuditResult;
}

const GUARD_STAGES: GuardStage[] = [
  {
    id: "identify",
    label: "Identify",
    tagTop: "decompile",
    tagBottom: "tx bytecode",
    statement: "Pre-sign decoding of Legacy & V0 Solana instructions",
    targetMode: "payload",
  },
  {
    id: "block",
    label: "Block",
    tagTop: "intercept",
    tagBottom: "wallet drain",
    statement: "Pre-sign blocking of SPL SetAuthority & hook exploits",
    targetMode: "payload",
  },
  {
    id: "verify",
    label: "Verify",
    tagTop: "zero-log",
    tagBottom: "venice ai",
    statement: "Private llama-3.3-70b inference with zero data retention",
    targetMode: "token",
  },
  {
    id: "enforce",
    label: "Enforce",
    tagTop: "anchor pda",
    tagBottom: "policy vault",
    statement: "On-chain 24h spend guardrails & emergency circuit breaker",
    targetMode: "vault",
  },
  {
    id: "revoke",
    label: "Revoke",
    tagTop: "blinks &",
    tagBottom: "tag 5 revoke",
    statement: "Solana Actions Blinks pre-flight & SPL delegate revoker",
    targetMode: "blinks",
  },
];

const TOKEN_CONFIG = getSolShieldTokenConfig();

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
      className={`inline-flex items-center gap-2 bg-[#0A0E18] hover:bg-[#0F172A] border border-[#1E293B] hover:border-[#E05A2D]/70 rounded-full px-3 sm:px-3.5 py-1.5 transition-all select-none shadow-[0_2px_12px_rgba(0,0,0,0.5)] group shrink-0 whitespace-nowrap ${className}`}
    >
      <VeniceAiLogo className="w-4 h-4 text-[#E05A2D] group-hover:scale-110 transition-transform shrink-0" />
      <span className="text-[11.5px] sm:text-[12px] font-mono uppercase tracking-[0.08em] text-white/90 group-hover:text-white transition-colors">
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

  // Pre-Sign Tx Firewall state (user-supplied Base64 Tx or Blink URL — no preset dummy payloads)
  const [payloadInputMode, setPayloadInputMode] = useState<"base64" | "blink">(
    "base64"
  );
  const [txPayloadInput, setTxPayloadInput] = useState<string>("");
  const [txSignerInput, setTxSignerInput] = useState<string>("");
  const [simulateRpc, setSimulateRpc] = useState<boolean>(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [lastAuditedTarget, setLastAuditedTarget] = useState<string>("");
  const [simulationReport, setSimulationReport] =
    useState<DeterministicSimulationReport | null>(null);
  const [rpcSimulationReport, setRpcSimulationReport] =
    useState<RpcTxSimulationReport | null>(null);
  const [blinkInspectionMeta, setBlinkInspectionMeta] =
    useState<BlinkActionInspectionMeta | null>(null);
  const [auditResult, setAuditResult] =
    useState<VeniceSecurityAuditResult | null>(null);
  const [liveSlot, setLiveSlot] = useState<number | null>(null);
  const [rpcLatencyMs, setRpcLatencyMs] = useState<number | null>(null);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [walletStatus, setWalletStatus] = useState<
    "PENDING" | "BLOCKED" | "SIGNED" | "REVOKED"
  >("PENDING");

  const [veniceApiKey, setVeniceApiKey] = useState<string>("");
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  // Connected Wallet & Anchor Policy PDA Vault State (No dummy wallet)
  const [connectedWallet, setConnectedWallet] = useState<string>("");
  const [manualVaultOwner, setManualVaultOwner] = useState<string>("");
  const [revokeMintInput, setRevokeMintInput] = useState<string>("");
  const [isRealWalletConnected, setIsRealWalletConnected] =
    useState<boolean>(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [maxDailySol, setMaxDailySol] = useState<number>(5.0);
  const [maxAllowedRisk, setMaxAllowedRisk] = useState<number>(30);
  const [emergencyLocked, setEmergencyLocked] = useState<boolean>(false);
  const [derivedPdaAddress, setDerivedPdaAddress] = useState<string>("");
  const [vaultStatus, setVaultStatus] = useState<PolicyVaultStatus | null>(null);
  const [policyTxArtifact, setPolicyTxArtifact] =
    useState<SerializedInstructionArtifact | null>(null);
  const [policyActionNotice, setPolicyActionNotice] = useState<string | null>(
    null
  );
  const [revokeArtifact, setRevokeArtifact] =
    useState<SerializedInstructionArtifact | null>(null);

  // DeFi Intent Copilot State (/api/intent)
  const [intentPrompt, setIntentPrompt] = useState<string>("");
  const [intentLoading, setIntentLoading] = useState<boolean>(false);
  const [intentResponse, setIntentResponse] =
    useState<ParsedIntentResponse | null>(null);

  // Blinks & Revoke Studio State
  const [selectedBlinkSol, setSelectedBlinkSol] = useState<string>("");
  const [copiedBlinkUrl, setCopiedBlinkUrl] = useState<boolean>(false);
  const [revokeStatus, setRevokeStatus] = useState<"IDLE" | "BUILT">("IDLE");

  // Workbench Mode: Tx Firewall & Token Auditor
  const [technicalMode, setTechnicalMode] = useState<"payload" | "token">(
    "payload"
  );
  const [tokenMintInput, setTokenMintInput] = useState<string>("");
  const [tokenScanLoading, setTokenScanLoading] = useState<boolean>(false);
  const [tokenScanError, setTokenScanError] = useState<string | null>(null);
  const [tokenScanReport, setTokenScanReport] =
    useState<TokenScanReport | null>(null);
  const [copiedMint, setCopiedMint] = useState<boolean>(false);
  const [copiedLaunchCa, setCopiedLaunchCa] = useState<boolean>(false);

  // Previously Scanned Tokens History (real audits persisted locally & on server)
  const [scannedTokens, setScannedTokens] = useState<ScannedTokenSummary[]>([]);
  const [scannedTokensLoading, setScannedTokensLoading] = useState<boolean>(false);

  // Live Solana Mainnet RPC & Venice AI Agent state
  const [agentAddress, setAgentAddress] = useState<string>("");
  const [agentInput, setAgentInput] = useState<string>("");
  const [agentLoading, setAgentLoading] = useState<boolean>(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      content:
        "SolShield Adaptive AI Guard online. Paste any Solana Mainnet address (Token Mint, Program ID, Wallet) or an 88-char Transaction Signature (txHash) below for a live Mainnet RPC & zero-retention Venice AI inspection.",
      privacyProof: {
        provider: "Venice AI (Zero-Retention)",
        model: "llama-3.3-70b",
        zeroDataRetention: true,
      },
    },
  ]);

  const effectiveVaultOwner = (connectedWallet || manualVaultOwner).trim();

  const refreshScannedTokens = async () => {
    const local = readLocalScannedTokens();
    if (local.length > 0) {
      setScannedTokens(local);
    }
    setScannedTokensLoading(true);
    try {
      const res = await fetch("/api/scanned-tokens?limit=24", {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.tokens)) {
        setScannedTokens(mergeScannedTokenLists(local, data.tokens, 24));
      }
    } catch {
      // Keep local browser history if server endpoint is temporarily unreachable
    } finally {
      setScannedTokensLoading(false);
    }
  };

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

    refreshScannedTokens();
    refreshVaultStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!effectiveVaultOwner) {
      setDerivedPdaAddress("");
      refreshVaultStatus(undefined);
      return;
    }

    try {
      const { pda } = deriveSecurityPolicyPda(effectiveVaultOwner);
      setDerivedPdaAddress(pda);
      refreshVaultStatus(effectiveVaultOwner);
    } catch {
      setDerivedPdaAddress("");
    }
  }, [effectiveVaultOwner]);

  const refreshVaultStatus = async (owner?: string) => {
    try {
      const qs = owner ? `?owner=${encodeURIComponent(owner)}` : "";
      const res = await fetch(`/api/policy-status${qs}`);
      const data = await res.json();
      if (data.ok) {
        setVaultStatus(data);
      }
    } catch {
      // Non-fatal RPC probe error
    }
  };

  const handleBuildPolicyVaultTx = async (
    mode: "sync" | "emergency-lock",
    nextLockState?: boolean
  ) => {
    const owner = effectiveVaultOwner;
    if (!owner) {
      setPolicyActionNotice(
        lang === "id"
          ? "Hubungkan wallet atau masukkan alamat Owner Wallet terlebih dahulu."
          : "Connect a browser wallet or paste an Owner Wallet address first."
      );
      return;
    }
    const activeCluster = vaultStatus?.cluster ?? "devnet";
    const isDeployedOnCluster = Boolean(
      vaultStatus?.programDeployedOnMainnet || vaultStatus?.programDeployedOnDevnet
    );
    const clusterLabel = activeCluster === "mainnet" ? "Mainnet" : "Devnet";
    const latestBh =
      vaultStatus?.latestBlockhash ||
      vaultStatus?.latestDevnetBlockhash ||
      undefined;
    try {
      deriveSecurityPolicyPda(owner);
      const lamportsCap = Math.round(maxDailySol * 1e9);
      const artifact =
        mode === "emergency-lock"
          ? await buildSetEmergencyLockTransaction({
              owner,
              locked: Boolean(nextLockState),
              recentBlockhash: latestBh,
              clusterTarget: activeCluster,
            })
          : vaultStatus?.policyInitialized || vaultStatus?.policyInitializedOnDevnet
            ? await buildUpdatePolicyTransaction({
                owner,
                maxDailySpendLamports: lamportsCap,
                maxAllowedRiskScore: maxAllowedRisk,
                blockUnknownTransferHooks: true,
                recentBlockhash: latestBh,
                clusterTarget: activeCluster,
              })
            : await buildInitializePolicyTransaction({
                owner,
                maxDailySpendLamports: lamportsCap,
                maxAllowedRiskScore: maxAllowedRisk,
                blockUnknownTransferHooks: true,
                recentBlockhash: latestBh,
                clusterTarget: activeCluster,
              });

      setPolicyTxArtifact(artifact);

      if (isDeployedOnCluster && isRealWalletConnected) {
        const anyWin = window as unknown as {
          solana?: {
            signAndSendTransaction?: (
              tx: import("@solana/web3.js").Transaction
            ) => Promise<{ signature: string }>;
          };
        };
        if (anyWin.solana?.signAndSendTransaction) {
          const sig = await submitPolicyArtifactWithWallet(artifact, {
            signAndSendTransaction: anyWin.solana.signAndSendTransaction,
          });
          setPolicyActionNotice(`${clusterLabel} Tx Submitted: ${sig}`);
          setTimeout(() => {
            void refreshVaultStatus(owner);
          }, 3500);
          return;
        }
      }

      setPolicyActionNotice(
        vaultStatus?.isPlaceholderTemplateId || !isDeployedOnCluster
          ? lang === "id"
            ? `Instruksi Anchor v0.30.1 ter-serialisasi (disc 0x${artifact.discriminatorHex}). Deploy on-chain menunggu Anchor CLI build.`
            : `Anchor v0.30.1 instruction serialized (disc 0x${artifact.discriminatorHex}). On-chain submit awaits Anchor program deployment.`
          : lang === "id"
            ? `Tx ${clusterLabel} siap (${artifact.transactionBase64.length} b64 chars). Hubungkan wallet ${clusterLabel} untuk menandatangani.`
            : `${clusterLabel} tx serialized (${artifact.transactionBase64.length} b64 chars). Connect browser wallet to sign.`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Invalid Solana Owner address or failed to build Anchor Policy instruction.";
      setPolicyActionNotice(
        activeCluster === "devnet" && isRealWalletConnected
          ? `${msg} (Pastikan jaringan wallet berada di Devnet Testnet untuk sinkronisasi PDA Beta.)`
          : msg
      );
    }
  };

  const handleRevokeSplDelegate = () => {
    const owner = effectiveVaultOwner;
    if (!owner) {
      setPolicyActionNotice(
        lang === "id"
          ? "Hubungkan wallet atau masukkan alamat Owner Wallet sebelum membuat Tx Revoke."
          : "Connect a browser wallet or paste an Owner Wallet before building a Revoke transaction."
      );
      return;
    }

    try {
      const targetMint = revokeMintInput.trim();
      const useToken2022 =
        Boolean(targetMint) &&
        tokenScanReport?.mintAddress === targetMint &&
        tokenScanReport.isToken2022;
      const tokenAccount = targetMint
        ? deriveAssociatedTokenAccountForMint(targetMint, owner, useToken2022)
        : deriveUsdcAssociatedTokenAccount(owner);
      const artifact = buildSplDelegateRevokeTransaction({
        tokenAccount,
        owner,
        recentBlockhash:
          vaultStatus?.latestBlockhash ||
          vaultStatus?.latestDevnetBlockhash ||
          undefined,
        clusterTarget: vaultStatus?.cluster ?? "devnet",
      });
      setRevokeArtifact(artifact);
      setRevokeStatus("BUILT");
      setWalletStatus("REVOKED");
      setPolicyActionNotice(null);
    } catch (err: unknown) {
      setPolicyActionNotice(
        err instanceof Error
          ? err.message
          : "Unable to derive Associated Token Account for revoke transaction."
      );
    }
  };

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
    setWalletNotice(null);
    if (isRealWalletConnected) {
      setConnectedWallet("");
      setDerivedPdaAddress("");
      setIsRealWalletConnected(false);
      return;
    }

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
        try {
          const { pda } = deriveSecurityPolicyPda(pubkey);
          setDerivedPdaAddress(pda);
        } catch {
          setDerivedPdaAddress("");
        }
        setAgentAddress(pubkey);
        sendAgentQuery(
          `Inspect my connected Solana wallet ${pubkey} on Mainnet and verify its owner program and safety.`
        );
        return;
      }
      setWalletNotice(
        lang === "id"
          ? "Extension wallet Solana (Phantom / Solflare) belum terdeteksi di browser."
          : "No Solana browser wallet detected (install Phantom or Solflare to connect)."
      );
    } catch {
      setWalletNotice(
        lang === "id"
          ? "Koneksi wallet dibatalkan."
          : "Wallet connection was cancelled."
      );
    }
  };

  const runPayloadAudit = async (options?: {
    mode?: "base64" | "blink";
    payload?: string;
  }) => {
    const modeToUse = options?.mode ?? payloadInputMode;
    const rawPayload = (options?.payload ?? txPayloadInput).trim();
    if (!rawPayload) {
      setAuditError(
        lang === "id"
          ? "Tempel transaksi Base64 atau URL Solana Blink terlebih dahulu."
          : "Paste a serialized Base64 transaction or Solana Blink URL to audit."
      );
      return;
    }

    if (options?.mode) setPayloadInputMode(options.mode);
    if (options?.payload !== undefined) setTxPayloadInput(options.payload);

    setIsAuditing(true);
    setAuditError(null);
    setWalletStatus("PENDING");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Transaction: modeToUse === "base64" ? rawPayload : undefined,
          blinkUrl: modeToUse === "blink" ? rawPayload : undefined,
          walletAddress:
            txSignerInput.trim() || effectiveVaultOwner || undefined,
          simulateRpc,
          veniceApiKey: veniceApiKey.trim() || undefined,
          maxAllowedRiskScore: maxAllowedRisk,
          maxDailySol,
          emergencyLocked,
        }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        setSimulationReport(data.simulation);
        setRpcSimulationReport(data.rpcSimulation ?? null);
        setBlinkInspectionMeta(data.blinkMeta ?? null);
        setAuditResult(data.veniceAudit);
        setLastAuditedTarget(rawPayload);
        if (
          data.liveSolana?.connected &&
          typeof data.liveSolana.slot === "number"
        ) {
          setLiveSlot(data.liveSolana.slot);
          if (typeof data.liveSolana.latencyMs === "number") {
            setRpcLatencyMs(data.liveSolana.latencyMs);
          }
        }
        const discoveredAudits: TokenScanReport[] = Array.isArray(
          data.rpcSimulation?.tokenAudits
        )
          ? data.rpcSimulation.tokenAudits
          : [];
        if (discoveredAudits.length > 0) {
          let latestLocal: ScannedTokenSummary[] = [];
          for (const tokenAudit of discoveredAudits) {
            latestLocal = saveLocalScannedToken(tokenAudit, "tx-firewall");
          }
          setScannedTokens((prev) =>
            mergeScannedTokenLists(latestLocal, prev, 24)
          );
        }
      } else {
        setAuditError(
          data.error ||
            "Unable to decode transaction or inspect Solana Blink URL."
        );
      }
    } catch {
      setAuditError(
        "SolShield Firewall request failed or timed out. Please check input and retry."
      );
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
          walletAddress: effectiveVaultOwner || undefined,
          veniceApiKey: veniceApiKey.trim() || undefined,
          maxAllowedRiskScore: maxAllowedRisk,
          maxDailySol,
          emergencyLocked,
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

  const runTokenScan = async (customMint?: string) => {
    const mintToScan = (customMint ?? tokenMintInput).trim();
    if (!mintToScan) return;
    if (customMint) setTokenMintInput(mintToScan);
    setTokenScanLoading(true);
    setTokenScanError(null);
    try {
      const res = await fetch("/api/scan-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: mintToScan,
          veniceApiKey: veniceApiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok && data.report) {
        setTokenScanReport(data.report);
        const updatedLocal = saveLocalScannedToken(data.report, "token-xray");
        setScannedTokens((prev) =>
          mergeScannedTokenLists(updatedLocal, prev, 24)
        );
        if (typeof data.report.slot === "number" && data.report.slot > 0) {
          setLiveSlot(data.report.slot);
        }
        if (typeof data.report.latencyMs === "number") {
          setRpcLatencyMs(data.report.latencyMs);
        }
      } else {
        setTokenScanError(
          data.error || "Unable to inspect that Solana Token Mint address."
        );
      }
    } catch {
      setTokenScanError(
        "Solana Mainnet RPC request timed out. Please retry in a moment."
      );
    } finally {
      setTokenScanLoading(false);
    }
  };

  const handleClearLocalScannedTokens = async () => {
    clearLocalScannedTokens();
    setScannedTokens([]);
    try {
      const res = await fetch("/api/scanned-tokens?limit=24", {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.tokens)) {
        setScannedTokens(data.tokens);
      }
    } catch {
      // Ignore network error
    }
  };

  const handleExportTokenProof = () => {
    if (!tokenScanReport) return;
    const blob = new Blob([JSON.stringify(tokenScanReport, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `solshield-token-audit-${tokenScanReport.mintAddress.slice(
      0,
      8
    )}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAuditProof = () => {
    if (!simulationReport && !auditResult) return;
    const proofPayload = {
      certificate: "SolShield Zero-Retention Security Attestation",
      timestamp: new Date().toISOString(),
      solanaMainnetSlot: liveSlot,
      walletInspected: effectiveVaultOwner || null,
      anchorPolicyPda: derivedPdaAddress || null,
      policyConfiguration: {
        maxDailySol,
        maxAllowedRiskScore: maxAllowedRisk,
        emergencyLocked,
      },
      target: {
        mode: payloadInputMode,
        input: lastAuditedTarget || null,
        blinkMeta: blinkInspectionMeta,
      },
      veniceAiVerdict: auditResult,
      rpcSimulation: rpcSimulationReport,
      decodedInstructionsCount: simulationReport?.instructions.length ?? 0,
      threatFlags: simulationReport?.threatFlags ?? [],
      privacyAttestation: {
        engine: "Venice AI (https://api.venice.ai/api/v1/chat/completions)",
        model: auditResult?.modelUsed ?? "llama-3.3-70b (Deterministic Pre-Filter)",
        inferenceMode: auditResult?.inferenceMode ?? "deterministic-fallback",
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
    a.download = `solshield-audit-proof-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStageClick = (idx: number) => {
    setActiveStageIdx(idx);
    const stage = GUARD_STAGES[idx];
    if (stage.targetMode === "token") {
      setTechnicalMode("token");
      scrollToTechnicalSide();
    } else if (stage.targetMode === "payload") {
      setTechnicalMode("payload");
      scrollToTechnicalSide();
    } else if (stage.targetMode === "vault") {
      scrollToVaultSide();
    } else if (stage.targetMode === "blinks") {
      scrollToBlinksSide();
    }
  };

  const sendAgentQuery = async (customPrompt?: string) => {
    const trimmedInput = agentInput.trim();
    const trimmedAddress = agentAddress.trim();
    const questionText =
      customPrompt ||
      trimmedInput ||
      (trimmedAddress
        ? lang === "en"
          ? `Inspect Solana address ${trimmedAddress} on Mainnet and explain if it is safe.`
          : `Periksa alamat Solana ${trimmedAddress} di Mainnet dan jelaskan apakah aman.`
        : "");

    if (!questionText) return;

    setAgentLoading(true);
    const userMsg: AgentMessage = { role: "user", content: questionText };
    setAgentMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setAgentInput("");

    const activeScanSummary = tokenScanReport
      ? `Active Token Audit: ${tokenScanReport.symbol ?? tokenScanReport.mintAddress} | Risk ${tokenScanReport.riskScore}/100 (${tokenScanReport.classification}) | Program: ${tokenScanReport.tokenProgram}${tokenScanReport.verifiedAsset ? ` | Verified Issuer: ${tokenScanReport.verifiedAsset.issuer}` : ""}`
      : auditResult
        ? `Active Tx Audit: Risk ${auditResult.riskScore}/100 (${auditResult.classification}) | Action: ${auditResult.recommendedAction} | Summary: ${auditResult.executiveSummary}`
        : undefined;

    try {
      const res = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: questionText,
          activeScanSummary,
          veniceApiKey: veniceApiKey.trim() || undefined,
          lang,
        }),
      });
      const data = await res.json();
      if (typeof data.liveSlot === "number" && data.liveSlot > 0) {
        setLiveSlot(data.liveSlot);
      }
      if (typeof data.latencyMs === "number" && data.latencyMs > 0) {
        setRpcLatencyMs(data.latencyMs);
      }
      setAgentMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.reply ||
            data.error ||
            "Rate limit or security guard triggered. Please retry shortly.",
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
    const el = document.getElementById("policy-vault") || document.getElementById("vault-side");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToBlinksSide = () => {
    const el = document.getElementById("blinks-studio") || document.getElementById("vault-side");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToIntentSide = () => {
    const el = document.getElementById("intent-copilot") || document.getElementById("vault-side");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const activeStage = GUARD_STAGES[activeStageIdx];
  const hasActiveTxAudit = Boolean(auditResult || simulationReport);
  const isCritical =
    emergencyLocked ||
    auditResult?.classification === "CRITICAL" ||
    auditResult?.classification === "WARNING" ||
    Boolean(simulationReport && simulationReport.deterministicRiskScore >= 50);

  return (
    <ClickSpark sparkColor="#2934FF" sparkRadius={26} sparkCount={8}>
      <div className="hexacore-canvas min-h-screen font-sans">
        {/* ====================================================================
            PROTOCOL LAUNCH STRIP — Official CA & Verified Ecosystem Links
            ==================================================================== */}
        <div className="border-b border-current/15 px-6 sm:px-10 xl:px-14 py-2.5 text-[12px] font-mono">
          {TOKEN_CONFIG.isLive ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="inline-flex items-center gap-2 font-semibold tracking-[0.08em] uppercase">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  {TOKEN_CONFIG.symbol} OFFICIAL CA:
                </span>
                <span
                  title={TOKEN_CONFIG.ca}
                  className="px-2 py-0.5 border border-current/20 bg-current/[0.04] tracking-[0.04em]"
                >
                  {TOKEN_CONFIG.shortCa ?? TOKEN_CONFIG.ca}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(TOKEN_CONFIG.ca);
                    setCopiedLaunchCa(true);
                    window.setTimeout(() => setCopiedLaunchCa(false), 2000);
                  }}
                  className="px-2 py-0.5 border border-current/20 hover:border-[#2934FF] hover:text-[#2934FF] transition-colors uppercase tracking-[0.06em]"
                >
                  {copiedLaunchCa ? "Copied ✓" : "Copy CA"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 opacity-85">
                {TOKEN_CONFIG.links.pumpfun && (
                  <a
                    href={TOKEN_CONFIG.links.pumpfun}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[#2934FF] transition-colors"
                  >
                    Pump.fun ↗
                  </a>
                )}
                {TOKEN_CONFIG.links.dexscreener && (
                  <a
                    href={TOKEN_CONFIG.links.dexscreener}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[#2934FF] transition-colors"
                  >
                    DexScreener ↗
                  </a>
                )}
                {TOKEN_CONFIG.links.solscan && (
                  <a
                    href={TOKEN_CONFIG.links.solscan}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[#2934FF] transition-colors"
                  >
                    Solscan ↗
                  </a>
                )}
                <a
                  href="/downloads/solshield-browser-guard-v0.3.0.zip"
                  download
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Extension ZIP
                </a>
                <a
                  href="/privacy"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Privacy Policy
                </a>
                <a
                  href={TOKEN_CONFIG.links.x}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  {TOKEN_CONFIG.xHandle} ↗
                </a>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-2 font-semibold tracking-[0.08em] uppercase">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2934FF] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2934FF]" />
                  </span>
                  {TOKEN_CONFIG.symbol}
                </span>
                <span className="opacity-75 tracking-[0.05em]">
                  PRE-LAUNCH // OFFICIAL CA PUBLISHED HERE UPON RELEASE · PRA-RILIS // CA RESMI AKAN DIPASANG DI SINI
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 opacity-85">
                <a
                  href="#technical-side"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Mainnet Firewall Live ↗
                </a>
                <a
                  href="/downloads/solshield-browser-guard-v0.3.0.zip"
                  download
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Extension ZIP
                </a>
                <a
                  href="/privacy"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Privacy Policy
                </a>
                <a
                  href={TOKEN_CONFIG.links.x}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  {TOKEN_CONFIG.xHandle} ↗
                </a>
                <a
                  href={TOKEN_CONFIG.links.github}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  GitHub ↗
                </a>
              </div>
            </div>
          )}
        </div>

        {/* ====================================================================
            SECTION 01 — HERO (1:1 HALO LAB "HEXACORE — ADAPTIVE AI GUARD" GRID)
            3 Full-Height Architectural Columns separated by crisp hairlines
            ==================================================================== */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.16fr)_minmax(0,1fr)] min-h-screen hexacore-hairline-b">
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
                <span className="text-[21px] font-medium tracking-[-0.03em]">
                  SolShield
                  <sup className="text-[11px] font-normal ml-0.5 opacity-75">
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
                <a
                  href="https://github.com/Blanksite/solshield"
                  target="_blank"
                  rel="noreferrer"
                  title="SolShield Official GitHub Repository"
                  className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#0A0A0C] bg-neutral-900 shadow-md relative z-10 hover:border-[#2934FF] transition-colors"
                >
                  <img
                    src="/logo.jpg"
                    alt="SolShield GitHub Logo"
                    className="w-full h-full object-cover"
                  />
                </a>
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

              <p className="text-[12.5px] sm:text-[13.5px] font-medium uppercase tracking-[0.04em] leading-[1.55] max-w-[330px] opacity-85">
                <DecryptedText
                  text={
                    lang === "en"
                      ? "NON-CUSTODIAL SOLANA TX FIREWALL, BLINKS INSPECTOR & ANCHOR POLICY VAULT ON VENICE AI."
                      : "FIREWALL TRANSAKSI SOLANA, INSPEKTOR BLINKS & POLICY VAULT ANCHOR DI VENICE AI."
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
            <div className="px-6 sm:px-8 pt-9 pb-5 z-20">
              <nav className="flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-6 gap-y-2 text-[15px] font-medium tracking-[-0.01em] opacity-85">
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={() => {
                      setTechnicalMode("payload");
                      scrollToTechnicalSide();
                    }}
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    {lang === "en" ? "Tx Firewall" : "Firewall Tx"}
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={scrollToVaultSide}
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    Vault
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={scrollToBlinksSide}
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    Blinks
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <button
                    onClick={() => {
                      setTechnicalMode("token");
                      scrollToTechnicalSide();
                    }}
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    {lang === "en" ? "Token Audit" : "Cek Token"}
                  </button>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <a
                    href="#browser-guard"
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    Extension
                  </a>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <Link
                    href="/buildcheck"
                    className="hover:opacity-100 transition-opacity cursor-pointer text-[#60a5fa]"
                  >
                    BuildCheck
                  </Link>
                </Magnet>
                <Magnet padding={28} magnetStrength={3.2}>
                  <a
                    href="https://github.com/Blanksite/solshield"
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
                    onClick={() => {
                      setTechnicalMode("payload");
                      scrollToTechnicalSide();
                    }}
                    className="relative z-10 bg-[#2934FF] hover:bg-[#1E27E6] active:scale-[0.99] text-white px-10 py-4 text-[16px] font-semibold tracking-[-0.01em] transition-all shadow-[0_12px_28px_rgba(41,52,255,0.35)] cursor-pointer"
                  >
                    {lang === "en" ? "Launch Tx Firewall" : "Buka Tx Firewall"}
                  </button>
                </Magnet>
              </div>

              <div className="mt-5">
                <span className="inline-block border border-current/30 rounded-full px-4 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] opacity-85">
                  {lang === "en" ? "BUILT IN VENICE · ZERO-LOG AI" : "BUILT IN VENICE · AI TANPA RETENSI"}
                </span>
              </div>

              <div className="mt-3.5">
                <CobaltPixelCluster />
              </div>

              <h2 className="mt-3 text-[26px] sm:text-[30px] xl:text-[34px] font-normal leading-[1.15] tracking-[-0.03em] max-w-[380px]">
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
            <div>
              <div className="flex items-center justify-end gap-3">
                {/* Connect Wallet Button */}
                <button
                  onClick={connectBrowserWallet}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-current/20 hover:border-[#2934FF] text-[12.5px] font-medium uppercase tracking-[0.06em] transition-colors cursor-pointer"
                  title="Connect Phantom / Solflare (Read-Only)"
                >
                  <Wallet className="w-4 h-4 text-[#2934FF]" />
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
                  className="text-[12.5px] font-mono uppercase tracking-[0.1em] opacity-80 hover:opacity-100 transition-opacity px-2.5 py-1.5 cursor-pointer"
                  title="Switch Language (EN / ID)"
                >
                  {lang.toUpperCase()}
                </button>

                {/* Light / Dark Mode Toggle */}
                <button
                  onClick={toggleTheme}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-current/20 text-[12.5px] font-medium uppercase tracking-[0.06em] opacity-90 hover:opacity-100 transition-opacity cursor-pointer"
                  title="Toggle Dark / Light Mode"
                >
                  {darkMode ? (
                    <>
                      <Sun className="w-4 h-4 text-amber-400" />
                      <span>Light</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-[#2934FF]" />
                      <span>Dark</span>
                    </>
                  )}
                </button>

                {/* Menu Icon -> Opens Venice AI Key Modal */}
                <button
                  onClick={() => setShowKeyModal(true)}
                  className="p-1.5 opacity-85 hover:opacity-100 transition-opacity cursor-pointer"
                  title="Configure Venice AI Key"
                >
                  <Menu className="w-5 h-5" />
                </button>
              </div>
              {walletNotice && (
                <p className="mt-2 text-right text-[13px] font-sans text-amber-400">
                  {walletNotice}
                </p>
              )}
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
                className="w-full max-w-[310px] cursor-pointer group"
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
                      <span className="text-[12px] font-mono uppercase tracking-[0.08em] text-emerald-400 font-semibold">
                        MAINNET LIVE
                      </span>
                    </div>
                    <span className="text-[12px] font-mono text-white/70">
                      {rpcLatencyMs !== null ? `${rpcLatencyMs}ms` : "LIVE"}
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

                  <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-white/10 relative z-10">
                    <div>
                      <span className="text-[11px] font-mono text-white/65 block">
                        SLOT TELEMETRY
                      </span>
                      <span className="text-[13.5px] font-mono text-white font-medium">
                        {liveSlot !== null
                          ? `#${liveSlot.toLocaleString("en-US")}`
                          : "SYNCING..."}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-mono text-white/65 block">
                        ZERO-LOG INFERENCE
                      </span>
                      <span className="text-[12.5px] font-mono text-[#E05A2D] font-medium flex items-center gap-1">
                        <VeniceAiLogo className="w-3.5 h-3.5 text-[#E05A2D]" />
                        VENICE AI
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-white/85 group-hover:text-white transition-colors relative z-10">
                    <span className="text-[12px] font-mono uppercase tracking-[0.08em]">
                      SECURITY RADAR
                    </span>
                    <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform text-[#2934FF]" />
                  </div>
                </div>
              </TiltedCard>
            </div>
          </div>
        </section>

        {/* ====================================================================
            BUILT IN VENICE REGISTERED CAPABILITIES STRIP
            Spotlights the exact 4 pillars registered at veniceai/builtinvenice
            ==================================================================== */}
        <section
          aria-label="Built in Venice Registered Architecture"
          className="hexacore-hairline-b"
        >
          <div className="px-8 sm:px-12 xl:px-14 py-4 border-b border-current/10 flex flex-wrap items-center justify-between gap-3 text-[12.5px] font-mono uppercase tracking-[0.1em]">
            <div className="flex items-center gap-2">
              <VeniceAiLogo className="w-4 h-4 text-[#E05A2D]" />
              <span className="opacity-85">
                {lang === "en"
                  ? "BUILT IN VENICE // REGISTERED PROTOCOL ARCHITECTURE"
                  : "BUILT IN VENICE // ARSITEKTUR PROTOKOL TERDAFTAR"}
              </span>
            </div>
            <a
              href="https://github.com/veniceai/builtinvenice/pull/194"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[#2934FF] hover:underline font-semibold"
            >
              <span>veniceai/builtinvenice #194</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-current/10">
            <button
              type="button"
              onClick={() => {
                setTechnicalMode("payload");
                scrollToTechnicalSide();
              }}
              className="text-left px-8 sm:px-10 py-8 hover:bg-current/[0.03] transition-colors group cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                    01 // TX FIREWALL
                  </span>
                  <ArrowUpRight className="w-4 h-4 opacity-55 group-hover:opacity-100 group-hover:text-[#2934FF] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>
                <h3 className="text-[20px] font-medium tracking-[-0.02em] mb-2">
                  Pre-Sign Bytecode Decompiler
                </h3>
                <p className="text-[14.5px] opacity-80 leading-[1.6]">
                  Decodes Legacy &amp; V0 Solana payloads to catch{" "}
                  <code className="font-mono text-[13.5px]">SetAuthority</code> hijacks,
                  unlimited approvals &amp; Token-2022 hooks.
                </p>
              </div>
              <span className="mt-5 text-[12px] font-sans font-semibold uppercase tracking-[0.06em] opacity-75 group-hover:text-[#2934FF] group-hover:opacity-100">
                OPEN FIREWALL SANDBOX →
              </span>
            </button>

            <button
              type="button"
              onClick={scrollToIntentSide}
              className="text-left px-8 sm:px-10 py-8 hover:bg-current/[0.03] transition-colors group cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                    02 // VENICE ZERO-LOG AI
                  </span>
                  <ArrowUpRight className="w-4 h-4 opacity-55 group-hover:opacity-100 group-hover:text-[#2934FF] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>
                <h3 className="text-[20px] font-medium tracking-[-0.02em] mb-2">
                  Private Reasoning &amp; Intent Copilot
                </h3>
                <p className="text-[14.5px] opacity-80 leading-[1.6]">
                  Zero-data-retention <code className="font-mono text-[13.5px]">llama-3.3-70b</code>{" "}
                  audits, BYOK privacy &amp; plain-English DeFi swap compiler.
                </p>
              </div>
              <span className="mt-5 text-[12px] font-sans font-semibold uppercase tracking-[0.06em] opacity-75 group-hover:text-[#2934FF] group-hover:opacity-100">
                TRY INTENT COPILOT →
              </span>
            </button>

            <button
              type="button"
              onClick={scrollToVaultSide}
              className="text-left px-8 sm:px-10 py-8 hover:bg-current/[0.03] transition-colors group cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                    03 // POLICY VAULT (DEVNET BETA)
                  </span>
                  <ArrowUpRight className="w-4 h-4 opacity-55 group-hover:opacity-100 group-hover:text-[#2934FF] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>
                <h3 className="text-[20px] font-medium tracking-[-0.02em] mb-2">
                  On-Chain SecurityPolicy PDA
                </h3>
                <p className="text-[14.5px] opacity-80 leading-[1.6]">
                  Optional Devnet Beta Anchor module paired with our Mainnet Tx
                  Firewall — enforces 24h spend caps &amp; 1-click Emergency Freeze.
                </p>
              </div>
              <span className="mt-5 text-[12px] font-sans font-semibold uppercase tracking-[0.06em] opacity-75 group-hover:text-[#2934FF] group-hover:opacity-100">
                CONFIGURE PDA VAULT →
              </span>
            </button>

            <button
              type="button"
              onClick={scrollToBlinksSide}
              className="text-left px-8 sm:px-10 py-8 hover:bg-current/[0.03] transition-colors group cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                    04 // BLINKS &amp; REVOKER
                  </span>
                  <ArrowUpRight className="w-4 h-4 opacity-55 group-hover:opacity-100 group-hover:text-[#2934FF] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>
                <h3 className="text-[20px] font-medium tracking-[-0.02em] mb-2">
                  Blinks Inspector &amp; Tag 5 Revoke
                </h3>
                <p className="text-[14.5px] opacity-80 leading-[1.6]">
                  Spec-compliant <code className="font-mono text-[13.5px]">/api/actions/audit-swap</code>{" "}
                  pre-flight check &amp; 1-click SPL Delegate Authority revoker.
                </p>
              </div>
              <span className="mt-5 text-[12px] font-sans font-semibold uppercase tracking-[0.06em] opacity-75 group-hover:text-[#2934FF] group-hover:opacity-100">
                OPEN BLINKS STUDIO →
              </span>
            </button>
          </div>
        </section>

        {/* ====================================================================
            SECTION 02 — TECHNICAL SIDE (INTERACTIVE SOLANA FIREWALL & VENICE AI)
            ==================================================================== */}
        <section
          id="technical-side"
          className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.16fr)_minmax(0,1fr)] min-h-screen hexacore-hairline-b"
        >
          {/* COLUMN 1 (LEFT) — 01 // PAYLOAD SCENARIOS & LIVE RPC ACCOUNT/TX SCANNER */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="hexacore-hairline-r px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-6">
                <span className="text-[12.5px] font-mono uppercase tracking-[0.09em] text-[#2934FF] font-semibold">
                  {technicalMode === "token"
                    ? "01 // SPL & TOKEN-2022"
                    : "01 // PRE-SIGN TX FIREWALL"}
                </span>
                <span className="text-[12px] font-mono opacity-70 whitespace-nowrap shrink-0">
                  SOLANA MAINNET
                </span>
              </div>

              {/* Clean Segmented Mode Switcher (Tx Firewall Primary, Token Audit Secondary) */}
              <div className="grid grid-cols-2 border border-current/20 mb-7 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setTechnicalMode("payload")}
                  className={`py-2.5 px-3 text-[13px] font-sans font-semibold uppercase tracking-[0.04em] transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    technicalMode === "payload"
                      ? "bg-[#2934FF] text-white"
                      : "opacity-75 hover:opacity-100"
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>Tx Firewall</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTechnicalMode("token")}
                  className={`py-2.5 px-3 text-[13px] font-sans font-semibold uppercase tracking-[0.04em] transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    technicalMode === "token"
                      ? "bg-[#2934FF] text-white"
                      : "opacity-75 hover:opacity-100"
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Token Audit</span>
                </button>
              </div>

              {technicalMode === "token" ? (
                <>
                  <h3 className="text-[32px] sm:text-[38px] font-normal tracking-[-0.035em] leading-[1.08] mb-3">
                    {lang === "en" ? "Scan Token CA" : "Cek CA Token"}
                  </h3>
                  <p className="text-[15px] opacity-80 leading-[1.6] mb-6">
                    {lang === "en"
                      ? "Paste any Solana Token Mint CA to verify Mint/Freeze authorities, Token-2022 hooks, and top holder concentration live on Mainnet."
                      : "Tempel CA token Solana mana pun untuk memeriksa otoritas Mint/Freeze, hook Token-2022, dan konsentrasi top holder langsung dari Mainnet."}
                  </p>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      runTokenScan();
                    }}
                    className="space-y-3 mb-6"
                  >
                    <input
                      type="text"
                      value={tokenMintInput}
                      onChange={(e) => setTokenMintInput(e.target.value)}
                      placeholder="Paste Solana Token Mint CA (SPL / Token-2022)"
                      className="w-full px-3.5 py-3 text-[14px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={tokenScanLoading}
                      className="w-full bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white py-3.5 text-[13.5px] font-sans font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Search className="w-4 h-4" />
                      <span>
                        {tokenScanLoading
                          ? "QUERYING MAINNET MINT..."
                          : "SCAN TOKEN CA ↗"}
                      </span>
                    </button>
                  </form>

                  {tokenScanError && (
                    <div className="mb-6 p-3.5 border border-red-500/40 bg-red-500/10 text-red-400 text-[13.5px] leading-relaxed">
                      {tokenScanError}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span className="text-[12px] font-mono uppercase tracking-[0.1em] opacity-75">
                        {lang === "en"
                          ? `RECENTLY SCANNED TOKENS (${scannedTokens.length})`
                          : `TOKEN BARU DI-SCAN (${scannedTokens.length})`}
                      </span>
                      {scannedTokens.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearLocalScannedTokens}
                          className="text-[11px] font-mono uppercase text-[#6B78FF] hover:underline cursor-pointer"
                        >
                          CLEAR LOCAL
                        </button>
                      )}
                    </div>

                    {scannedTokens.length > 0 ? (
                      <div className="max-h-[300px] overflow-y-auto divide-y divide-current/15 border border-current/15">
                        {scannedTokens.slice(0, 12).map((tok) => {
                          const isSelected =
                            tokenScanReport?.mintAddress === tok.mintAddress ||
                            tokenMintInput.trim() === tok.mintAddress;
                          const badgeClass = isSelected
                            ? "border-white/50 text-white"
                            : tok.classification === "CRITICAL"
                              ? "border-red-500/50 text-red-400"
                              : tok.classification === "CAUTION"
                                ? "border-amber-500/50 text-amber-300"
                                : "border-emerald-500/50 text-emerald-400";
                          return (
                            <button
                              key={tok.mintAddress}
                              type="button"
                              onClick={() => runTokenScan(tok.mintAddress)}
                              className={`w-full p-3 text-left transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                                isSelected
                                  ? "bg-[#2934FF] text-white"
                                  : "hover:bg-current/5"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[14.5px] font-mono font-semibold truncate">
                                    {tok.symbol
                                      ? `$${tok.symbol}`
                                      : `${tok.mintAddress.slice(0, 5)}...${tok.mintAddress.slice(-4)}`}
                                  </span>
                                  {tok.verifiedIssuer && (
                                    <span
                                      className={`text-[10.5px] font-mono uppercase px-1.5 py-0.5 border ${
                                        isSelected
                                          ? "border-white/40 text-white"
                                          : "border-emerald-500/40 text-emerald-400"
                                      }`}
                                    >
                                      {tok.verifiedIssuer}
                                    </span>
                                  )}
                                  {tok.scanCount > 1 && (
                                    <span
                                      className={`text-[10.5px] font-mono ${
                                        isSelected ? "text-white/80" : "opacity-65"
                                      }`}
                                    >
                                      ×{tok.scanCount}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={`text-[11.5px] font-mono mt-1 truncate ${
                                    isSelected ? "text-white/80" : "opacity-70"
                                  }`}
                                >
                                  {tok.mintAddress.slice(0, 6)}...
                                  {tok.mintAddress.slice(-4)} · {tok.tokenProgram} ·{" "}
                                  {tok.source}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={`text-[11px] font-mono font-semibold uppercase px-2 py-0.5 border ${badgeClass}`}
                                >
                                  {tok.classification} {tok.riskScore}/100
                                </span>
                                <ArrowUpRight className="w-3.5 h-3.5 opacity-75" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 border border-dashed border-current/25 text-[13px] font-sans leading-relaxed opacity-80 space-y-2.5">
                        <p>
                          {scannedTokensLoading
                            ? lang === "id"
                              ? "Memuat riwayat token yang sudah pernah diaudit..."
                              : "Loading previously audited tokens..."
                            : lang === "id"
                              ? "Belum ada token yang di-scan. Tempel Mint CA di atas untuk menjalankan audit Mainnet pertama Anda."
                              : "No tokens scanned yet. Paste a Solana Token Mint CA above to run your first live Mainnet audit."}
                        </p>
                        <Link
                          href="/buildcheck"
                          className="inline-flex items-center gap-1 text-[12px] font-mono text-[#6B78FF] hover:underline"
                        >
                          <span>
                            {lang === "id"
                              ? "Atau buka BuildCheck AI Forensics ↗"
                              : "Or open BuildCheck AI Forensics ↗"}
                          </span>
                        </Link>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-[32px] sm:text-[38px] font-normal tracking-[-0.035em] leading-[1.08] mb-3">
                    {lang === "en" ? "Inspect Tx or Blink" : "Periksa Tx atau Blink"}
                  </h3>
                  <p className="text-[15px] opacity-80 leading-[1.6] mb-5">
                    {lang === "en"
                      ? "Paste any Base64 serialized Solana transaction or Solana Action (Blink) URL to decode instructions, simulate Mainnet RPC balance deltas, and run zero-retention Venice AI risk scoring."
                      : "Tempel transaksi Solana Base64 atau URL Solana Action (Blink) untuk mendecode instruksi, simulasi saldo di Mainnet RPC, dan skor risiko Venice AI."}
                  </p>

                  {/* Input Type Selector: Base64 Tx vs Blink URL */}
                  <div className="grid grid-cols-2 border border-current/20 mb-4 p-1 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPayloadInputMode("base64");
                        setAuditError(null);
                      }}
                      className={`py-2 px-2.5 text-[12px] font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer ${
                        payloadInputMode === "base64"
                          ? "bg-[#2934FF] text-white font-semibold"
                          : "opacity-75 hover:opacity-100"
                      }`}
                    >
                      Base64 Tx
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPayloadInputMode("blink");
                        setAuditError(null);
                      }}
                      className={`py-2 px-2.5 text-[12px] font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer ${
                        payloadInputMode === "blink"
                          ? "bg-[#2934FF] text-white font-semibold"
                          : "opacity-75 hover:opacity-100"
                      }`}
                    >
                      Blink Action URL
                    </button>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      runPayloadAudit();
                    }}
                    className="space-y-3"
                  >
                    {payloadInputMode === "base64" ? (
                      <textarea
                        rows={4}
                        value={txPayloadInput}
                        onChange={(e) => setTxPayloadInput(e.target.value)}
                        placeholder={
                          lang === "en"
                            ? "Paste serialized Legacy or Versioned (V0) Base64 transaction..."
                            : "Tempel transaksi Base64 Legacy atau Versioned (V0)..."
                        }
                        className="w-full p-3.5 text-[13.5px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none leading-relaxed"
                      />
                    ) : (
                      <input
                        type="url"
                        value={txPayloadInput}
                        onChange={(e) => setTxPayloadInput(e.target.value)}
                        placeholder="https://... or solana-action:https://..."
                        className="w-full px-3.5 py-3 text-[14px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
                      />
                    )}

                    <input
                      type="text"
                      value={txSignerInput}
                      onChange={(e) => setTxSignerInput(e.target.value)}
                      placeholder={
                        lang === "en"
                          ? "Optional Signer / Account Pubkey (uses connected wallet if blank)"
                          : "Opsional: Pubkey Penanda Tangan (pakai wallet terhubung jika kosong)"
                      }
                      className="w-full px-3.5 py-2.5 text-[13px] font-mono bg-transparent border border-current/20 focus:border-[#2934FF] focus:outline-none"
                    />

                    <label className="flex items-center gap-2.5 text-[12.5px] font-mono opacity-85 cursor-pointer select-none pt-0.5">
                      <input
                        type="checkbox"
                        checked={simulateRpc}
                        onChange={(e) => setSimulateRpc(e.target.checked)}
                        className="accent-[#2934FF] w-4 h-4 cursor-pointer"
                      />
                      <span>
                        {lang === "en"
                          ? "Simulate on Solana Mainnet RPC (balance deltas & token audit)"
                          : "Simulasi di Solana Mainnet RPC (perubahan saldo & audit token)"}
                      </span>
                    </label>

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={isAuditing || !txPayloadInput.trim()}
                        className="flex-1 bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white py-3.5 px-4 text-[13.5px] font-sans font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer flex items-center justify-center gap-2"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>
                          {isAuditing
                            ? "AUDITING PAYLOAD..."
                            : lang === "en"
                              ? "INSPECT & AUDIT TX ↗"
                              : "PERIKSA & AUDIT TX ↗"}
                        </span>
                      </button>
                      {(txPayloadInput || hasActiveTxAudit || auditError) && (
                        <button
                          type="button"
                          onClick={() => {
                            setTxPayloadInput("");
                            setAuditError(null);
                            setSimulationReport(null);
                            setRpcSimulationReport(null);
                            setBlinkInspectionMeta(null);
                            setAuditResult(null);
                            setLastAuditedTarget("");
                            setWalletStatus("PENDING");
                          }}
                          className="px-4 py-3.5 border border-current/25 hover:border-[#2934FF] text-[12.5px] font-mono uppercase cursor-pointer"
                        >
                          CLEAR
                        </button>
                      )}
                    </div>
                  </form>

                  {auditError && (
                    <div className="mt-4 p-3.5 border border-red-500/40 bg-red-500/10 text-red-400 text-[13.5px] leading-relaxed">
                      {auditError}
                    </div>
                  )}

                  {scannedTokens.length > 0 && (
                    <div className="mt-6 pt-5 border-t border-current/15">
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="text-[11.5px] font-mono uppercase tracking-[0.08em] opacity-75">
                          RECENTLY SCANNED TOKENS ({scannedTokens.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => setTechnicalMode("token")}
                          className="text-[11.5px] font-mono text-[#6B78FF] hover:underline cursor-pointer"
                        >
                          VIEW ALL ↗
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {scannedTokens.slice(0, 4).map((tok) => (
                          <button
                            key={tok.mintAddress}
                            type="button"
                            onClick={() => {
                              setTechnicalMode("token");
                              runTokenScan(tok.mintAddress);
                            }}
                            className="px-2.5 py-1.5 border border-current/20 hover:border-[#2934FF] text-[11.5px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            <span className="font-semibold">
                              {tok.symbol
                                ? `$${tok.symbol}`
                                : `${tok.mintAddress.slice(0, 4)}..${tok.mintAddress.slice(-3)}`}
                            </span>
                            <span
                              className={
                                tok.classification === "CRITICAL"
                                  ? "text-red-400"
                                  : tok.classification === "CAUTION"
                                    ? "text-amber-300"
                                    : "text-emerald-400"
                              }
                            >
                              {tok.riskScore}/100
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Bottom: Live Solana Mainnet RPC Address OR Transaction Signature X-Ray */}
            <div className="mt-12 pt-8 hexacore-hairline-t">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[12.5px] font-mono uppercase tracking-[0.07em] opacity-80 font-medium">
                  ADDRESS / TX X-RAY
                </span>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-mono text-emerald-500 whitespace-nowrap shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  {liveSlot !== null
                    ? `SLOT #${liveSlot.toLocaleString("en-US")}`
                    : "SYNCING RPC..."}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                <input
                  type="text"
                  value={agentAddress}
                  onChange={(e) => setAgentAddress(e.target.value)}
                  placeholder="Paste Solana Address or 88-char Tx Signature..."
                  className="w-full px-3.5 py-3 text-[14px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
                />
                <button
                  onClick={() =>
                    sendAgentQuery(
                      `Inspect ${agentAddress.trim()} on Solana Mainnet and verify its owner program, transaction status, and safety.`
                    )
                  }
                  disabled={agentLoading || !agentAddress.trim()}
                  className="w-full bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white py-3.5 text-[13.5px] font-sans font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer"
                >
                  {agentLoading
                    ? "QUERYING SOLANA RPC..."
                    : "SCAN MAINNET ADDRESS / TX ↗"}
                </button>
              </div>
            </div>
          </SpotlightCard>

          {/* COLUMN 2 (CENTER MONOLITH) — 02 // TOKEN X-RAY OR PRE-SIGN SANDBOX */}
          {technicalMode === "token" ? (
            <div className="hexacore-hairline-r bg-[#E2E4E8] text-[#0A0A0C] px-8 sm:px-12 py-12 flex flex-col justify-between min-w-0">
              <div>
                <div className="flex items-center justify-between gap-3 pb-6 border-b border-[#0A0A0C]/15">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                        02 // ON-CHAIN TOKEN X-RAY
                      </span>
                    </div>
                    <h3 className="text-[26px] sm:text-[30px] font-normal tracking-[-0.03em] leading-tight mt-1 truncate">
                      {tokenScanLoading && !tokenScanReport
                        ? "Inspecting Mint..."
                        : tokenScanReport?.symbol
                        ? `$${tokenScanReport.symbol}${
                            tokenScanReport.name
                              ? ` · ${tokenScanReport.name}`
                              : ""
                          }`
                        : tokenScanReport
                        ? `${tokenScanReport.mintAddress.slice(
                            0,
                            6
                          )}...${tokenScanReport.mintAddress.slice(-6)}`
                        : "Awaiting Token CA"}
                    </h3>
                  </div>

                  <span
                    className={`px-3 py-1.5 text-[12px] font-mono uppercase tracking-[0.06em] font-semibold shrink-0 ${
                      tokenScanLoading
                        ? "bg-[#0A0A0C] text-[#6B78FF]"
                        : !tokenScanReport
                        ? "bg-[#0A0A0C] text-white/75"
                        : tokenScanReport.classification === "CRITICAL"
                        ? "bg-[#0A0A0C] text-red-400"
                        : tokenScanReport.classification === "CAUTION"
                        ? "bg-[#0A0A0C] text-amber-300"
                        : "bg-[#0A0A0C] text-emerald-400"
                    }`}
                  >
                    {tokenScanLoading
                      ? "SCANNING..."
                      : !tokenScanReport
                      ? "STANDBY"
                      : tokenScanReport.classification === "CRITICAL"
                      ? "HIGH RUG RISK"
                      : tokenScanReport.classification === "CAUTION"
                      ? "DYOR CAUTION"
                      : "VERIFIED SAFE"}
                  </span>
                </div>

                {!tokenScanReport ? (
                  <div className="mt-8 space-y-5">
                    <div className="p-5 bg-white/75 border border-[#0A0A0C]/15 space-y-3">
                      <span className="text-[11.5px] font-mono uppercase tracking-[0.08em] text-[#2934FF] font-semibold block">
                        {tokenScanLoading
                          ? "QUERYING SOLANA MAINNET RPC..."
                          : "LIVE ON-CHAIN TELEMETRY STANDBY"}
                      </span>
                      <p className="text-[14.5px] font-sans text-[#0A0A0C]/85 leading-relaxed">
                        {tokenScanLoading
                          ? "Fetching live Mint Account state, Token-2022 TLV extensions, top holder distribution, and Venice AI risk scoring..."
                          : "No token audited in this panel yet. Enter any Solana SPL or Token-2022 Mint address on the left (or select a recently scanned token) to inspect real on-chain telemetry."}
                      </p>
                    </div>

                    <div className="divide-y divide-[#0A0A0C]/15 border-y border-[#0A0A0C]/15 bg-white/50 text-[13.5px] font-sans text-[#0A0A0C]/80">
                      <div className="p-3.5 flex items-center justify-between">
                        <span>Mint &amp; Freeze Authority Check</span>
                        <span className="font-mono text-[11.5px] opacity-65">ON SUBMIT</span>
                      </div>
                      <div className="p-3.5 flex items-center justify-between">
                        <span>Token-2022 PermanentDelegate &amp; Hooks</span>
                        <span className="font-mono text-[11.5px] opacity-65">ON SUBMIT</span>
                      </div>
                      <div className="p-3.5 flex items-center justify-between">
                        <span>Top Holder Supply Concentration</span>
                        <span className="font-mono text-[11.5px] opacity-65">ON SUBMIT</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Mint Metadata Strip */}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[12.5px] font-mono text-[#0A0A0C]/80">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 border border-[#0A0A0C]/20 bg-white/60">
                          {tokenScanReport.tokenProgram}
                        </span>
                        {tokenScanReport.verifiedAsset && (
                          <span className="px-2 py-0.5 border border-emerald-700/30 bg-emerald-50 text-emerald-800 font-semibold">
                            VERIFIED · {tokenScanReport.verifiedAsset.issuer}
                          </span>
                        )}
                        <span>DECIMALS: {tokenScanReport.decimals}</span>
                        <span>
                          SUPPLY:{" "}
                          {Intl.NumberFormat("en-US", {
                            notation: "compact",
                            maximumFractionDigits: 2,
                          }).format(tokenScanReport.supplyUi)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            tokenScanReport.mintAddress
                          );
                          setCopiedMint(true);
                          setTimeout(() => setCopiedMint(false), 1800);
                        }}
                        className="inline-flex items-center gap-1 text-[#2934FF] hover:underline cursor-pointer"
                      >
                        {copiedMint ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {copiedMint
                            ? "COPIED CA"
                            : `${tokenScanReport.mintAddress.slice(
                                0,
                                6
                              )}...${tokenScanReport.mintAddress.slice(-4)}`}
                        </span>
                      </button>
                    </div>

                    {/* Authority & Token-2022 Extensions Matrix */}
                    <div className="mt-6">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[12px] font-mono uppercase tracking-[0.08em] text-[#0A0A0C]/75 font-medium">
                          ON-CHAIN AUTHORITY &amp; HOOK CHECKS
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleExportTokenProof}
                            className="inline-flex items-center gap-1 text-[12px] font-mono font-medium text-[#2934FF] hover:underline cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>EXPORT PROOF (.JSON)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTokenScanReport(null);
                              setTokenScanError(null);
                            }}
                            className="text-[12px] font-mono text-[#0A0A0C]/65 hover:text-[#0A0A0C] cursor-pointer"
                          >
                            CLEAR
                          </button>
                        </div>
                      </div>

                      <div className="divide-y divide-[#0A0A0C]/15 border-y border-[#0A0A0C]/15 bg-white/60">
                        {[
                          {
                            label: "Mint Authority",
                            authority: tokenScanReport.mintAuthority,
                            revokedDesc: "Fixed supply — cannot mint new tokens",
                            custodialTag: "ISSUER",
                          },
                          {
                            label: "Freeze Authority",
                            authority: tokenScanReport.freezeAuthority,
                            revokedDesc: "Holders cannot be blacklisted or frozen",
                            custodialTag: "COMPLIANCE",
                          },
                        ].map((row) => {
                          const verifiedIssuer = tokenScanReport.verifiedAsset?.custodialIssuerAuthorities
                            ? tokenScanReport.verifiedAsset.issuer
                            : null;
                          const desc = row.authority
                            ? `${verifiedIssuer ? `${verifiedIssuer} custody` : "Active"}: ${row.authority.slice(
                                0,
                                8
                              )}...${row.authority.slice(-6)}`
                            : row.revokedDesc;
                          const badgeClass = !row.authority
                            ? "text-emerald-700"
                            : verifiedIssuer
                              ? "text-amber-700"
                              : "text-red-600";
                          return (
                            <div key={row.label} className="p-3.5 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[16px] font-medium text-[#0A0A0C]">{row.label}</p>
                                <p className="text-[13px] font-sans text-[#0A0A0C]/75">{desc}</p>
                              </div>
                              <span
                                className={`inline-flex items-center gap-1.5 text-[12.5px] font-mono font-semibold shrink-0 ${badgeClass}`}
                              >
                                {!row.authority ? (
                                  <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>REVOKED</span>
                                  </>
                                ) : verifiedIssuer ? (
                                  <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>{row.custodialTag}</span>
                                  </>
                                ) : (
                                  <>
                                    <ShieldAlert className="w-4 h-4" />
                                    <span>ACTIVE</span>
                                  </>
                                )}
                              </span>
                            </div>
                          );
                        })}

                        <div className="p-3.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[16px] font-medium text-[#0A0A0C]">
                              Token-2022 Extensions
                            </p>
                            <p className="text-[13px] font-sans text-[#0A0A0C]/75 break-words leading-snug">
                              {!tokenScanReport.isToken2022
                                ? "Standard SPL Token (no custom transfer hooks)"
                                : tokenScanReport.extensions.length > 0
                                ? tokenScanReport.extensions.join(", ")
                                : "Token-2022 base mint"}
                            </p>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 text-[12.5px] font-mono font-semibold shrink-0 ${
                              tokenScanReport.permanentDelegate ||
                              tokenScanReport.transferHookProgramId
                                ? "text-red-600"
                                : tokenScanReport.transferFeeBps
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }`}
                          >
                            {tokenScanReport.permanentDelegate ? (
                              <>
                                <AlertTriangle className="w-4 h-4" />
                                <span>PERM DELEGATE</span>
                              </>
                            ) : tokenScanReport.transferFeeBps ? (
                              <span>
                                FEE{" "}
                                {(tokenScanReport.transferFeeBps / 100).toFixed(2)}%
                              </span>
                            ) : (
                              <span>
                                {tokenScanReport.isToken2022
                                  ? "EXT CHECKED"
                                  : "CLEAN SPL"}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Top Holders Distribution */}
                    <div className="mt-6">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-[12px] font-mono uppercase tracking-[0.08em] text-[#0A0A0C]/75 font-medium">
                          TOP HOLDERS CONCENTRATION
                        </span>
                        {tokenScanReport.topHolders.length > 0 && (
                          <span className="text-[12px] font-mono font-semibold text-[#0A0A0C]">
                            TOP 5: {tokenScanReport.top5Pct}% · TOP 10:{" "}
                            {tokenScanReport.top10Pct}%
                          </span>
                        )}
                      </div>

                      <div className="p-4 bg-[#0A0A0C] text-white font-mono text-[13px] space-y-2.5">
                        {tokenScanReport.topHolders.length > 0 ? (
                          <>
                            <div className="w-full h-1.5 bg-white/15 overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  tokenScanReport.top5Pct >= 80
                                    ? "bg-red-500"
                                    : tokenScanReport.top5Pct >= 55
                                    ? "bg-amber-400"
                                    : "bg-emerald-400"
                                }`}
                                style={{
                                  width: `${Math.min(100, tokenScanReport.top5Pct)}%`,
                                }}
                              />
                            </div>
                            <div className="divide-y divide-white/10">
                              {tokenScanReport.topHolders.slice(0, 5).map((h, i) => (
                                <div
                                  key={h.address}
                                  className="py-1.5 flex items-center justify-between gap-2"
                                >
                                  <a
                                    href={`https://solscan.io/account/${h.address}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-white/85 hover:text-[#6B78FF] truncate"
                                  >
                                    #{i + 1} {h.address.slice(0, 6)}...
                                    {h.address.slice(-4)}
                                  </a>
                                  <span className="text-white/75 shrink-0">
                                    {Intl.NumberFormat("en-US", {
                                      notation: "compact",
                                      maximumFractionDigits: 1,
                                    }).format(h.uiAmount)}{" "}
                                    ·{" "}
                                    <strong className="text-white">
                                      {h.pctOfSupply}%
                                    </strong>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="space-y-2 text-white/80 leading-relaxed font-sans text-[13.5px]">
                            <p>
                              {tokenScanLoading
                                ? "Querying live Mint telemetry from Solana Mainnet RPC..."
                                : `Authority, supply, and Token-2022 extension checks verified${
                                    tokenScanReport.slot || liveSlot
                                      ? ` at Slot #${(
                                          tokenScanReport.slot ??
                                          liveSlot ??
                                          0
                                        ).toLocaleString("en-US")}`
                                      : " via Mainnet RPC"
                                  }. Largest-account queries are throttled on free shared RPC; inspect live holder distribution on Solscan:`}
                            </p>
                            {!tokenScanLoading && (
                              <a
                                href={`https://solscan.io/token/${tokenScanReport.mintAddress}#holders`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[#6B78FF] font-mono text-[12.5px] hover:underline"
                              >
                                <span>OPEN LIVE HOLDER DISTRIBUTION ON SOLSCAN</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Bottom Explorer Links */}
              {tokenScanReport && (
                <div className="mt-8 pt-6 border-t border-[#0A0A0C]/15 grid grid-cols-3 gap-2">
                  <a
                    href={`https://solscan.io/token/${tokenScanReport.mintAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="py-3 px-2 bg-[#0A0A0C] hover:bg-neutral-800 text-white text-[12.5px] font-sans font-semibold uppercase text-center transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>Solscan</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={`https://jup.ag/tokens/${tokenScanReport.mintAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="py-3 px-2 bg-[#2934FF] hover:bg-[#1E28E6] text-white text-[12.5px] font-sans font-semibold uppercase text-center transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>Jupiter</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={`https://dexscreener.com/solana/${tokenScanReport.mintAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="py-3 px-2 border border-[#0A0A0C]/25 hover:bg-[#0A0A0C] hover:text-white text-[#0A0A0C] text-[12.5px] font-sans font-semibold uppercase text-center transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>DexScreener</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="hexacore-hairline-r bg-[#E2E4E8] text-[#0A0A0C] px-8 sm:px-12 py-12 flex flex-col justify-between min-w-0">
              <div>
                <div className="flex items-center justify-between gap-3 pb-6 border-b border-[#0A0A0C]/15">
                  <div className="min-w-0">
                    <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                      02 // PRE-SIGN SANDBOX
                    </span>
                    <h3 className="text-[26px] sm:text-[30px] font-normal tracking-[-0.03em] leading-tight mt-1 truncate">
                      {isAuditing && !hasActiveTxAudit
                        ? "Inspecting Payload..."
                        : hasActiveTxAudit
                        ? blinkInspectionMeta?.title ||
                          (payloadInputMode === "blink"
                            ? "Solana Blink Inspection"
                            : "Decoded Transaction Payload")
                        : "Awaiting Tx / Blink"}
                    </h3>
                  </div>
                  <span
                    className={`px-3 py-1.5 text-[12px] font-mono uppercase tracking-[0.06em] font-semibold shrink-0 ${
                      emergencyLocked
                        ? "bg-[#0A0A0C] text-red-400"
                        : isAuditing
                        ? "bg-[#0A0A0C] text-[#6B78FF]"
                        : !hasActiveTxAudit
                        ? "bg-[#0A0A0C] text-white/75"
                        : isCritical
                        ? "bg-[#0A0A0C] text-red-400"
                        : "bg-[#0A0A0C] text-emerald-400"
                    }`}
                  >
                    {emergencyLocked
                      ? "VAULT LOCKED"
                      : isAuditing
                      ? "AUDITING..."
                      : !hasActiveTxAudit
                      ? "STANDBY"
                      : isCritical
                      ? "THREAT DETECTED"
                      : "VERIFIED ROUTE"}
                  </span>
                </div>

                {!hasActiveTxAudit ? (
                  <div className="mt-8 space-y-5">
                    <div className="p-5 bg-white/75 border border-[#0A0A0C]/15 space-y-3">
                      <span className="text-[11.5px] font-mono uppercase tracking-[0.08em] text-[#2934FF] font-semibold block">
                        {isAuditing
                          ? "RUNNING PRE-SIGN FIREWALL..."
                          : "PRE-SIGN BYTECODE FIREWALL STANDBY"}
                      </span>
                      <p className="text-[14.5px] font-sans text-[#0A0A0C]/85 leading-relaxed">
                        {isAuditing
                          ? "Decompiling instructions, simulating Solana Mainnet RPC balance deltas, and running Venice AI zero-retention inspection..."
                          : "No transaction or Blink payload loaded. Paste a Base64 serialized Solana transaction or a Solana Action URL in Column 01 to inspect instructions, token authorities, and Anchor PDA rules before signing."}
                      </p>
                    </div>

                    <div className="divide-y divide-[#0A0A0C]/15 border-y border-[#0A0A0C]/15 bg-white/50 text-[13.5px] font-sans text-[#0A0A0C]/80">
                      <div className="p-3.5 flex items-center justify-between">
                        <span>Legacy / Versioned (V0) Instruction Decoder</span>
                        <span className="font-mono text-[11.5px] opacity-65">ON SUBMIT</span>
                      </div>
                      <div className="p-3.5 flex items-center justify-between">
                        <span>Live Mainnet Balance Diffs &amp; Token Discovery</span>
                        <span className="font-mono text-[11.5px] opacity-65">ON SUBMIT</span>
                      </div>
                      <div className="p-3.5 flex items-center justify-between">
                        <span>Zero-Retention Venice AI Threat Classification</span>
                        <span className="font-mono text-[11.5px] opacity-65">ON SUBMIT</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Real Simulated Balance Deltas */}
                    <div className="mt-7">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[12px] font-mono uppercase tracking-[0.08em] text-[#0A0A0C]/75 font-medium">
                          SIMULATED BALANCE DELTAS
                        </span>
                        <button
                          type="button"
                          onClick={handleExportAuditProof}
                          className="inline-flex items-center gap-1 text-[12px] font-mono font-medium text-[#2934FF] hover:underline cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>EXPORT PROOF (.JSON)</span>
                        </button>
                      </div>

                      {rpcSimulationReport?.status === "SIMULATED_OK" &&
                      rpcSimulationReport.balanceDiffs.length > 0 ? (
                        <div className="divide-y divide-[#0A0A0C]/15 border-y border-[#0A0A0C]/15 bg-white/60">
                          {rpcSimulationReport.balanceDiffs.map((change, i) => (
                            <div
                              key={`${change.address}-${i}`}
                              className="p-3.5 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <p className="text-[15.5px] font-medium text-[#0A0A0C] truncate">
                                  {change.asset}
                                  {change.isToken2022 ? " (Token-2022)" : ""}
                                </p>
                                <p className="text-[12.5px] font-mono text-[#0A0A0C]/75">
                                  {change.mint.slice(0, 8)}...{change.mint.slice(-6)}
                                </p>
                              </div>
                              <span
                                className={`text-[16px] font-mono font-semibold shrink-0 ${
                                  change.direction === "OUT"
                                    ? "text-red-600"
                                    : "text-emerald-700"
                                }`}
                              >
                                {change.direction === "IN" ? "+" : ""}
                                {change.deltaUiAmount}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 border border-[#0A0A0C]/15 bg-white/60 text-[13px] font-sans text-[#0A0A0C]/80 leading-relaxed">
                          {rpcSimulationReport?.status === "SIMULATED_ERROR"
                            ? `RPC Simulation Reverted: ${rpcSimulationReport.rpcError ?? "Unknown execution error"}`
                            : rpcSimulationReport?.status === "RPC_UNAVAILABLE"
                            ? `Mainnet RPC simulation unavailable: ${rpcSimulationReport.rpcError ?? "Node timeout"}`
                            : rpcSimulationReport?.status === "SIMULATED_OK"
                            ? "RPC simulation succeeded with zero pre/post token or SOL balance deltas on inspected accounts."
                            : "Mainnet RPC simulation disabled — showing static instruction & Blink inspection below."}
                        </div>
                      )}
                    </div>

                    {/* Discovered Token Mints in Tx */}
                    {rpcSimulationReport?.tokenAudits &&
                      rpcSimulationReport.tokenAudits.length > 0 && (
                        <div className="mt-5">
                          <span className="text-[11.5px] font-mono uppercase tracking-[0.08em] text-[#0A0A0C]/75 font-medium block mb-2">
                            TOKENS DETECTED IN PAYLOAD ({rpcSimulationReport.tokenAudits.length})
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {rpcSimulationReport.tokenAudits.map((ta) => (
                              <button
                                key={ta.mintAddress}
                                type="button"
                                onClick={() => {
                                  setTokenScanReport(ta);
                                  setTokenMintInput(ta.mintAddress);
                                  setTechnicalMode("token");
                                }}
                                className="px-2.5 py-1.5 bg-white/80 border border-[#0A0A0C]/20 hover:border-[#2934FF] text-[12px] font-mono flex items-center gap-1.5 cursor-pointer"
                              >
                                <span className="font-semibold">
                                  {ta.symbol
                                    ? `$${ta.symbol}`
                                    : `${ta.mintAddress.slice(0, 5)}..${ta.mintAddress.slice(-4)}`}
                                </span>
                                <span
                                  className={
                                    ta.classification === "CRITICAL"
                                      ? "text-red-600 font-semibold"
                                      : ta.classification === "CAUTION"
                                        ? "text-amber-700 font-semibold"
                                        : "text-emerald-700 font-semibold"
                                  }
                                >
                                  {ta.riskScore}/100
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* Decoded Instruction & Threat Telemetry */}
                    <div className="mt-6">
                      <span className="text-[12px] font-mono uppercase tracking-[0.08em] text-[#0A0A0C]/75 font-medium block mb-2.5">
                        DECODED INSTRUCTION AST &amp; HOOKS
                      </span>
                      <div className="p-4 bg-[#0A0A0C] text-white font-mono text-[13px] space-y-2.5">
                        <div className="flex items-center justify-between gap-2 text-white/75">
                          <span>PAYLOAD_SOURCE</span>
                          <span className="text-white truncate max-w-[220px]">
                            {blinkInspectionMeta?.actionUrl ||
                              (lastAuditedTarget.length > 28
                                ? `${lastAuditedTarget.slice(0, 14)}...${lastAuditedTarget.slice(-8)}`
                                : lastAuditedTarget)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-white/75">
                          <span>INSTRUCTIONS_COUNT</span>
                          <span className="text-[#6B78FF] font-semibold">
                            {simulationReport?.instructions.length ?? 0} IX CALLS
                          </span>
                        </div>
                        {simulationReport && simulationReport.instructions.length > 0 && (
                          <div className="flex items-center justify-between gap-2 text-white/75">
                            <span className="shrink-0">PROGRAMS</span>
                            <span className="text-white/90 truncate text-right">
                              {Array.from(
                                new Set(
                                  simulationReport.instructions.map(
                                    (ix) => ix.programName || ix.programId.slice(0, 8)
                                  )
                                )
                              ).join(", ")}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3 text-white/75">
                          <span className="shrink-0">ANCHOR_PDA_GUARD</span>
                          <span
                            className={`truncate max-w-[230px] text-right ${
                              auditResult?.policyGuardVerdict?.passesPolicy ===
                                false || emergencyLocked
                                ? "text-red-400 font-semibold"
                                : "text-emerald-400"
                            }`}
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
                        <div className="pt-2.5 border-t border-white/15 font-sans text-[13px] text-white/80 leading-relaxed break-words">
                          {blinkInspectionMeta?.failureReason
                            ? `Blink Inspection Note: ${blinkInspectionMeta.failureReason}`
                            : simulationReport?.threatFlags?.length
                              ? `Detected Flags: ${simulationReport.threatFlags.map((f) => f.title).join(" · ")}`
                              : "Zero deterministic exploit flags matched in instruction bytecode."}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Bottom Action Bar in Center Monolith */}
              <div className="mt-8 pt-6 border-t border-[#0A0A0C]/15 space-y-3">
                {hasActiveTxAudit &&
                  (walletStatus === "PENDING" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setWalletStatus("BLOCKED")}
                        className="py-4 px-5 bg-[#0A0A0C] hover:bg-neutral-800 text-white text-[14px] font-sans font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer"
                      >
                        {isCritical ? "BLOCK PAYLOAD" : "REJECT"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setWalletStatus(emergencyLocked ? "BLOCKED" : "SIGNED")
                        }
                        className={`py-4 px-5 text-white text-[14px] font-sans font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer ${
                          isCritical
                            ? "bg-red-600 hover:bg-red-700"
                            : "bg-[#2934FF] hover:bg-[#1E28E6]"
                        }`}
                      >
                        {emergencyLocked
                          ? "LOCKED BY PDA"
                          : isCritical
                          ? "SIMULATE OVERRIDE"
                          : "APPROVE PAYLOAD"}
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 bg-[#0A0A0C] text-white flex items-center justify-between">
                      <div className="flex items-center gap-2.5 text-[14px] font-mono">
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
                            <span>SANDBOX DECISION LOGGED</span>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setWalletStatus("PENDING")}
                        className="text-[12.5px] font-mono uppercase underline text-[#6B78FF] cursor-pointer"
                      >
                        RESET
                      </button>
                    </div>
                  ))}

                {/* 1-Click SPL Token Delegate Revoke Button */}
                <button
                  type="button"
                  onClick={handleRevokeSplDelegate}
                  className="w-full py-3 px-4 border border-[#0A0A0C]/25 hover:bg-[#0A0A0C] hover:text-white text-[#0A0A0C] text-[12.5px] font-sans font-semibold uppercase tracking-[0.05em] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>
                    BUILD SPL TOKEN DELEGATE REVOKE TX (TAG 5)
                  </span>
                </button>
                {policyActionNotice && !hasActiveTxAudit && (
                  <p className="text-[12.5px] font-sans text-amber-900">
                    {policyActionNotice}
                  </p>
                )}
                {walletStatus === "REVOKED" && revokeArtifact && (
                  <div className="p-3 bg-[#0A0A0C] text-emerald-300 font-mono text-[11.5px] leading-relaxed break-all border border-emerald-500/30">
                    <div>
                      TAG_5_REVOKE_IX (0x{revokeArtifact.discriminatorHex}) ·{" "}
                      {revokeArtifact.accountCount} accounts
                    </div>
                    <div className="text-white/75 mt-1">
                      TX_B64: {revokeArtifact.transactionBase64.slice(0, 72)}...
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COLUMN 3 (RIGHT) — 03 // VENICE AI ZERO-RETENTION VERDICT & AGENT */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <VeniceAiLogo className="w-4 h-4 text-[#E05A2D]" />
                  <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                    {technicalMode === "token"
                      ? "03 // TOKEN AUDIT VERDICT"
                      : "03 // VENICE AI VERDICT"}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={
                    technicalMode === "token"
                      ? tokenScanLoading || !tokenMintInput.trim()
                      : isAuditing || !txPayloadInput.trim()
                  }
                  onClick={() =>
                    technicalMode === "token"
                      ? runTokenScan()
                      : runPayloadAudit()
                  }
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-mono uppercase opacity-80 hover:opacity-100 disabled:opacity-35 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      (technicalMode === "token" ? tokenScanLoading : isAuditing)
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                  <span>{technicalMode === "token" ? "RE-SCAN" : "RE-AUDIT"}</span>
                </button>
              </div>

              {technicalMode === "token" ? (
                <>
                  <div className="flex items-baseline justify-between pb-6 hexacore-hairline-b">
                    <div>
                      <span className="text-[12px] font-mono uppercase opacity-75 block">
                        TOKEN AUDIT RISK SCORE
                      </span>
                      <div className="text-[52px] sm:text-[60px] font-normal tracking-[-0.04em] leading-none mt-1">
                        {tokenScanLoading ? (
                          <span className="opacity-40">··</span>
                        ) : tokenScanReport ? (
                          tokenScanReport.riskScore
                        ) : (
                          <span className="opacity-35">—</span>
                        )}
                        <span className="text-[20px] opacity-50 font-mono ml-1">
                          /100
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-3 py-1.5 text-[12px] font-mono uppercase border ${
                        tokenScanLoading
                          ? "border-[#2934FF]/50 text-[#6B78FF] bg-[#2934FF]/10"
                          : !tokenScanReport
                          ? "border-current/25 opacity-75"
                          : tokenScanReport.classification === "CRITICAL"
                          ? "border-red-500/50 text-red-500 bg-red-500/10"
                          : tokenScanReport.classification === "CAUTION"
                          ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
                          : "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                      }`}
                    >
                      {tokenScanLoading
                        ? "AUDITING..."
                        : tokenScanReport?.recommendedAction || "AWAITING_INPUT"}
                    </span>
                  </div>

                  <div className="py-6 hexacore-hairline-b space-y-3">
                    <h4 className="text-[18px] font-medium tracking-[-0.01em] leading-[1.45]">
                      {tokenScanLoading
                        ? "Querying Solana Mainnet Mint state & authority flags..."
                        : tokenScanReport?.executiveSummary ||
                          "Paste any Solana SPL or Token-2022 Mint CA in Column 01 (or pick a recently scanned token) to evaluate on-chain risk."}
                    </h4>
                    {tokenScanReport?.flags &&
                    tokenScanReport.flags.length > 0 ? (
                      <ul className="space-y-2 pt-1">
                        {tokenScanReport.flags.slice(0, 3).map((flag, idx) => (
                          <li
                            key={idx}
                            className={`text-[14px] leading-relaxed font-sans ${
                              flag.severity === "CRITICAL"
                                ? "text-red-400"
                                : flag.severity === "HIGH"
                                ? "text-amber-300"
                                : "opacity-85"
                            }`}
                          >
                            → <span className="font-mono font-semibold text-[12.5px]">[{flag.severity}]</span>{" "}
                            <strong className="font-medium">{flag.title}:</strong>{" "}
                            {flag.description}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      tokenScanReport && (
                        <p className="text-[14px] font-sans text-emerald-400 pt-1 leading-relaxed">
                          → Zero active mint/freeze authority or malicious hook flags found at Slot #{tokenScanReport.slot.toLocaleString("en-US")}.
                        </p>
                      )
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between pb-6 hexacore-hairline-b">
                    <div>
                      <span className="text-[12px] font-mono uppercase opacity-75 block">
                        BEHAVIORAL RISK SCORE
                      </span>
                      <div className="text-[52px] sm:text-[60px] font-normal tracking-[-0.04em] leading-none mt-1">
                        {isAuditing ? (
                          <span className="opacity-40">··</span>
                        ) : auditResult ? (
                          auditResult.riskScore
                        ) : (
                          <span className="opacity-35">—</span>
                        )}
                        <span className="text-[20px] opacity-50 font-mono ml-1">
                          /100
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-3 py-1.5 text-[12px] font-mono uppercase border ${
                        isAuditing
                          ? "border-[#2934FF]/50 text-[#6B78FF] bg-[#2934FF]/10"
                          : !auditResult
                          ? "border-current/25 opacity-75"
                          : isCritical
                          ? "border-red-500/50 text-red-500 bg-red-500/10"
                          : "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                      }`}
                    >
                      {isAuditing
                        ? "AUDITING..."
                        : auditResult?.recommendedAction || "AWAITING_PAYLOAD"}
                    </span>
                  </div>

                  <div className="py-6 hexacore-hairline-b space-y-3">
                    <h4 className="text-[18px] font-medium tracking-[-0.01em] leading-[1.45]">
                      {isAuditing
                        ? "Auditing instruction graph via zero-retention Venice AI..."
                        : auditResult?.executiveSummary ||
                          "Submit a serialized Base64 transaction or Solana Blink URL in Column 01 to run pre-sign bytecode & Venice AI risk analysis."}
                    </h4>
                    {auditResult?.technicalFindings &&
                      auditResult.technicalFindings.length > 0 && (
                        <ul className="space-y-2 pt-1">
                          {auditResult.technicalFindings
                            .slice(0, 2)
                            .map((finding, idx) => (
                              <li
                                key={idx}
                                className="text-[14px] opacity-85 leading-relaxed font-sans"
                              >
                                → {finding}
                              </li>
                            ))}
                        </ul>
                      )}
                  </div>
                </>
              )}

              {/* Venice AI Inference Mode & Zero-Retention Telemetry */}
              {(() => {
                const activeMode =
                  technicalMode === "token"
                    ? tokenScanReport?.inferenceMode
                    : auditResult?.inferenceMode;
                const activeModel =
                  technicalMode === "token"
                    ? activeMode === "venice-live-api"
                      ? "llama-3.3-70b (Live Zero-Retention)"
                      : "llama-3.3-70b (Deterministic Pre-Filter)"
                    : auditResult?.modelUsed ?? "llama-3.3-70b (Deterministic Pre-Filter)";
                const activeAttestation =
                  technicalMode === "token"
                    ? tokenScanReport?.privacyAttestation
                    : auditResult?.privacyAttestation;
                const isLiveVenice = activeMode === "venice-live-api";

                return (
                  <div className="mt-5 p-3.5 border border-current/15 bg-current/[0.03] space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-mono uppercase tracking-[0.08em] opacity-75">
                        VENICE_INFERENCE_STATUS
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-[10.5px] font-mono uppercase border ${
                            isLiveVenice
                              ? "border-emerald-500/45 text-emerald-400 bg-emerald-500/10"
                              : "border-amber-500/45 text-amber-400 bg-amber-500/10"
                          }`}
                        >
                          {isLiveVenice
                            ? "VENICE LIVE LLM"
                            : "PRE-FILTER · KEY READY"}
                        </span>
                        {!isLiveVenice && (
                          <button
                            type="button"
                            onClick={() => setShowKeyModal(true)}
                            className="text-[11px] font-mono text-[#6B78FF] hover:underline cursor-pointer"
                          >
                            {veniceApiKey ? "Key Active ↗" : "Add Key ↗"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-[11.5px] font-mono opacity-80 break-all">
                      MODEL: {activeModel} · API: api.venice.ai/v1 · NO_SYSTEM_PROMPT
                    </div>
                    {activeAttestation && (
                      <p className="text-[12px] font-sans opacity-75 leading-snug">
                        {activeAttestation}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Interactive Venice AI × Solana Mainnet Chat Console */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12.5px] font-mono uppercase tracking-[0.08em] opacity-90 flex items-center gap-1.5">
                    <VeniceAiLogo className="w-4 h-4 text-[#E05A2D]" />
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
                    className="inline-flex items-center gap-1 text-[12px] font-mono uppercase opacity-75 hover:opacity-100 cursor-pointer"
                  >
                    {copiedCurl ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedCurl ? "COPIED" : "ZERO-LOG PROOF"}</span>
                  </button>
                </div>

                <div className="max-h-[240px] overflow-y-auto space-y-2.5 pr-1 mb-3">
                  {agentMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`p-3.5 text-[14px] leading-relaxed border ${
                        msg.role === "user"
                          ? "bg-[#2934FF] text-white border-[#2934FF]"
                          : "border-current/15 bg-current/[0.03]"
                      }`}
                    >
                      {msg.telemetry &&
                        (msg.telemetry.slot || msg.telemetry.solBalance) && (
                          <div className="mb-1.5 pb-1.5 border-b border-current/10 flex flex-wrap gap-2 text-[12px] font-mono opacity-85">
                            {msg.telemetry.slot && (
                              <span>
                                SLOT: {msg.telemetry.slot.toLocaleString("en-US")}
                              </span>
                            )}
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
                    className="flex-1 px-3.5 py-3 text-[14px] bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={agentLoading}
                    className="px-4 py-3 bg-[#2934FF] hover:bg-[#1E28E6] text-white transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
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
          className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.16fr)_minmax(0,1fr)] hexacore-hairline-b"
        >
          {/* COLUMN 1 (LEFT) — 04 // NATURAL-LANGUAGE DEFI INTENT COPILOT */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="hexacore-hairline-r px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div id="intent-copilot">
              <div className="flex items-center justify-between mb-6">
                <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                  04 // DEFI INTENT COPILOT
                </span>
                <span className="text-[12px] font-mono uppercase px-2.5 py-0.5 border border-current/25">
                  /API/INTENT
                </span>
              </div>

              <h3 className="text-[28px] sm:text-[32px] font-normal tracking-[-0.035em] leading-[1.1] mb-3">
                Plain-English to Guarded Tx
              </h3>
              <p className="text-[15px] opacity-80 leading-[1.6] mb-6">
                Express what you want to trade in plain language. Venice AI
                parses your intent and verifies it against your Anchor{" "}
                <code className="font-mono text-[13.5px]">SecurityPolicy</code> PDA before
                building the Jupiter route.
              </p>

              <textarea
                value={intentPrompt}
                onChange={(e) => setIntentPrompt(e.target.value)}
                rows={3}
                className="w-full p-3.5 text-[15px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none leading-relaxed"
                placeholder="Describe what you want to trade on Solana (amount, input/output tokens, max slippage)..."
              />

              {!connectedWallet && (
                <input
                  type="text"
                  value={manualVaultOwner}
                  onChange={(e) => setManualVaultOwner(e.target.value)}
                  placeholder="Optional Wallet Pubkey (read-only unsigned tx preview)"
                  className="mt-2.5 w-full px-3.5 py-2.5 text-[13px] font-mono bg-transparent border border-current/20 focus:border-[#2934FF] focus:outline-none"
                />
              )}

              <button
                type="button"
                onClick={() => runIntentCopilot()}
                disabled={intentLoading || !intentPrompt.trim()}
                className="mt-3 w-full bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white py-3.5 text-[13.5px] font-sans font-semibold uppercase tracking-[0.06em] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {intentLoading
                    ? "BUILDING GUARDED SWAP..."
                    : "COMPILE GUARDED INTENT ↗"}
                </span>
              </button>
            </div>

            {intentResponse && (
              <div className="mt-8 pt-6 hexacore-hairline-t font-mono text-[13px] space-y-2.5">
                <div className="flex justify-between gap-2">
                  <span className="opacity-75">PARSED_ACTION</span>
                  <span className="font-semibold text-right">
                    {intentResponse.intent.action}{" "}
                    {intentResponse.intent.amount}{" "}
                    {intentResponse.intent.inputToken} →{" "}
                    {intentResponse.intent.outputToken}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="opacity-75">VENICE_INFERENCE</span>
                  <span
                    className={`text-right ${
                      intentResponse.intent.inferenceMode === "venice-live-api"
                        ? "text-emerald-400 font-semibold"
                        : "opacity-85"
                    }`}
                  >
                    {intentResponse.intent.inferenceMode === "venice-live-api"
                      ? "Live LLM (llama-3.3-70b · Zero-Retention)"
                      : "Deterministic Parser · Add Venice Key for Live LLM"}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="opacity-75">QUOTED_OUTPUT</span>
                  {intentResponse.quote?.quoteMode === "jupiter-v1-live" &&
                  intentResponse.quote.outAmountUi !== null ? (
                    <span className="text-emerald-400 font-semibold text-right">
                      {intentResponse.quote.outAmountUi.toLocaleString(
                        "en-US",
                        { maximumFractionDigits: 4 }
                      )}{" "}
                      {intentResponse.intent.outputToken}
                      {intentResponse.quote.routeLabels.length > 0
                        ? ` (${intentResponse.quote.routeLabels[0]})`
                        : " (Jupiter v1)"}
                    </span>
                  ) : (
                    <span className="text-amber-400 text-right">
                      Quote unavailable ({intentResponse.quote?.error ?? "offline"})
                    </span>
                  )}
                </div>
                <div className="flex justify-between gap-2">
                  <span className="opacity-75">MAX_SLIPPAGE</span>
                  <span>{intentResponse.intent.maxSlippageBps} BPS</span>
                </div>
                {intentResponse.recentBlockhash && (
                  <div className="flex justify-between gap-2">
                    <span className="opacity-75">LIVE_TX_V0</span>
                    <span className="opacity-90">
                      BH {intentResponse.recentBlockhash.slice(0, 8)}... ·{" "}
                      {intentResponse.base64Transaction?.length ?? 0}b64
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="opacity-75">PDA_POLICY_CHECK</span>
                  <span
                    className={
                      (intentResponse.intent.inputToken === "SOL" &&
                        intentResponse.intent.amount > maxDailySol) ||
                      emergencyLocked ||
                      !intentResponse.veniceAudit.policyGuardVerdict
                        .passesPolicy
                        ? "text-red-500 font-semibold text-right"
                        : "text-emerald-500 font-semibold text-right"
                    }
                  >
                    {emergencyLocked
                      ? "BLOCKED (EmergencyLock)"
                      : intentResponse.intent.inputToken === "SOL" &&
                          intentResponse.intent.amount > maxDailySol
                        ? `BLOCKED (Exceeds ${maxDailySol} SOL Cap)`
                        : !intentResponse.veniceAudit.policyGuardVerdict
                              .passesPolicy
                          ? "BLOCKED BY POLICY"
                          : "APPROVED BY PDA"}
                  </span>
                </div>
                <p className="text-[13.5px] opacity-85 pt-2 font-sans leading-relaxed">
                  {intentResponse.intent.explanation}
                </p>
              </div>
            )}
          </SpotlightCard>

          {/* COLUMN 2 (CENTER MONOLITH) — 05 // ANCHOR SECURITYPOLICY PDA VAULT */}
          <div
            id="policy-vault"
            className="hexacore-hairline-r bg-[#E2E4E8] text-[#0A0A0C] px-8 sm:px-12 py-12 flex flex-col justify-between min-w-0"
          >
            <div>
              <div className="flex items-center justify-between pb-6 border-b border-[#0A0A0C]/15">
                <div>
                  <span className="text-[12.5px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                    {vaultStatus?.programDeployedOnMainnet
                      ? "05 // POLICY VAULT (SOLANA MAINNET)"
                      : "05 // DEVNET POLICY VAULT (BETA)"}
                  </span>
                  <h3 className="text-[26px] sm:text-[30px] font-normal tracking-[-0.03em] leading-tight mt-1">
                    On-Chain Spending Guardrails
                  </h3>
                </div>
                <span className="px-2.5 py-1 bg-[#0A0A0C] text-white text-[12px] font-mono uppercase shrink-0">
                  {vaultStatus?.programDeployedOnMainnet
                    ? "Mainnet · Anchor v0.30.1"
                    : vaultStatus?.programDeployedOnDevnet
                      ? "Devnet Beta · Anchor v0.30.1"
                      : "Anchor v0.30.1 · Deploy Pending"}
                </span>
              </div>

              <div className="mt-4 p-3.5 bg-white/80 border border-[#0A0A0C]/15 text-[13px] font-sans text-[#0A0A0C]/85 leading-relaxed">
                <strong className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-[#2934FF] block mb-1">
                  {vaultStatus?.programDeployedOnMainnet
                    ? "MAINNET FIREWALL · LIVE MAINNET ANCHOR VAULT"
                    : "MAINNET FIREWALL · DEVNET BETA SMART CONTRACT"}
                </strong>
                Pre-Sign Tx Firewall, Token Mint Auditor, Live Tx/Address X-Ray &amp; Blinks execute live on{" "}
                <strong>Solana Mainnet RPC</strong>.{" "}
                {vaultStatus?.programDeployedOnMainnet ? (
                  <>
                    The Anchor PDA Policy Vault is deployed and executable on{" "}
                    <strong>Solana Mainnet</strong>.
                  </>
                ) : (
                  <>
                    This optional Anchor PDA Vault currently runs on{" "}
                    <strong>Devnet Beta</strong> until Mainnet program deployment completes.
                  </>
                )}
              </div>

              {/* Derived PDA Box */}
              <div className="mt-6 p-4 bg-[#0A0A0C] text-white font-mono text-[13px] space-y-2">
                <div className="flex justify-between items-center text-white/75">
                  <span>WALLET_OWNER</span>
                  {effectiveVaultOwner ? (
                    <span className="text-white">
                      {effectiveVaultOwner.slice(0, 8)}...
                      {effectiveVaultOwner.slice(-6)}
                      {!connectedWallet && " (Manual)"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={connectBrowserWallet}
                      className="text-[#6B78FF] hover:underline cursor-pointer"
                    >
                      Connect Wallet ↗
                    </button>
                  )}
                </div>
                <div className="flex justify-between items-center gap-2 text-white/75">
                  <span>
                    {derivedPdaAddress
                      ? "DERIVED_POLICY_PDA"
                      : "PROTOCOL_REFERENCE_PDA"}
                  </span>
                  {derivedPdaAddress || vaultStatus?.policyPda ? (
                    <a
                      href={`https://explorer.solana.com/address/${
                        derivedPdaAddress || vaultStatus?.policyPda
                      }${vaultStatus?.cluster === "mainnet" ? "" : "?cluster=devnet"}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline inline-flex items-center gap-1"
                    >
                      {(derivedPdaAddress || vaultStatus?.policyPda || "").slice(0, 10)}
                      ...
                      {(derivedPdaAddress || vaultStatus?.policyPda || "").slice(-6)}
                      {!derivedPdaAddress && " (Protocol Default)"} ↗
                    </a>
                  ) : (
                    <span className="text-white/60">
                      {lang === "en"
                        ? "Checking Solana RPC..."
                        : "Memeriksa Solana RPC..."}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center gap-2 text-white/75">
                  <span>PDA_STATE</span>
                  {vaultStatus?.policyState ? (
                    <span className="text-emerald-400 text-right">
                      Active ·{" "}
                      {(
                        vaultStatus.policyState.maxDailySpendLamports / 1e9
                      ).toFixed(1)}{" "}
                      SOL/24h · Risk &lt;={" "}
                      {vaultStatus.policyState.maxAllowedRiskScore} ·{" "}
                      {vaultStatus.policyState.auditedTxCount} tx
                      {vaultStatus.policyState.emergencyLocked ? " · LOCKED" : ""}
                    </span>
                  ) : vaultStatus?.policyInitialized ||
                    vaultStatus?.policyInitializedOnDevnet ? (
                    <span className="text-emerald-400">
                      Initialized ({vaultStatus.cluster === "mainnet" ? "Mainnet" : "Devnet Beta"})
                    </span>
                  ) : (
                    <span className="text-amber-300">
                      {lang === "en"
                        ? `Ready to initialize (${
                            vaultStatus?.cluster === "mainnet"
                              ? "Mainnet"
                              : "Devnet Beta"
                          })`
                        : `Siap diinisialisasi (${
                            vaultStatus?.cluster === "mainnet"
                              ? "Mainnet"
                              : "Devnet Beta"
                          })`}
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-white/75">
                  <span>SEEDS</span>
                  <span>[&quot;solshield_policy&quot;, owner]</span>
                </div>
                <div className="flex justify-between items-center text-white/75 pt-1 border-t border-white/10">
                  <span>
                    {vaultStatus?.programDeployedOnMainnet
                      ? "VAULT_PROGRAM (MAINNET)"
                      : "VAULT_PROGRAM (DEVNET BETA)"}
                  </span>
                  <a
                    href={
                      vaultStatus?.programDeployedOnMainnet
                        ? TOKEN_CONFIG.links.mainnetProgram
                        : TOKEN_CONFIG.links.devnetProgram
                    }
                    target="_blank"
                    rel="noreferrer"
                    className={`${
                      vaultStatus?.programDeployedOnMainnet ||
                      vaultStatus?.programDeployedOnDevnet
                        ? "text-emerald-400"
                        : "text-amber-300"
                    } hover:underline inline-flex items-center gap-1`}
                  >
                    {vaultStatus
                      ? `${vaultStatus.programId.slice(0, 6)}..${vaultStatus.programId.slice(-4)} (${
                          vaultStatus.programDeployedOnMainnet
                            ? "Deployed Mainnet"
                            : vaultStatus.programDeployedOnDevnet
                              ? "Deployed Devnet"
                              : "Template ID"
                        }) ↗`
                      : "Checking Solana RPC..."}
                  </a>
                </div>
              </div>
              {walletNotice && (
                <div className="mt-3 px-3.5 py-2.5 border border-amber-600/35 bg-amber-500/10 text-amber-950 font-sans text-[13px]">
                  {walletNotice}
                </div>
              )}

              {/* Optional Manual Owner & Revoke Mint Inputs */}
              <div className="mt-4 space-y-2.5">
                {!connectedWallet && (
                  <input
                    type="text"
                    value={manualVaultOwner}
                    onChange={(e) => setManualVaultOwner(e.target.value)}
                    placeholder="Optional Owner Pubkey (if browser wallet not connected)"
                    className="w-full px-3.5 py-2.5 text-[12.5px] font-mono bg-white/80 text-[#0A0A0C] border border-[#0A0A0C]/20 focus:border-[#2934FF] focus:outline-none"
                  />
                )}
                <input
                  type="text"
                  value={revokeMintInput}
                  onChange={(e) => setRevokeMintInput(e.target.value)}
                  placeholder="Optional Token Mint CA for Tag-5 Delegate Revoke (defaults to USDC)"
                  className="w-full px-3.5 py-2.5 text-[12.5px] font-mono bg-white/80 text-[#0A0A0C] border border-[#0A0A0C]/20 focus:border-[#2934FF] focus:outline-none"
                />
              </div>

              {/* Sliders for 24h Spend Cap & Risk Threshold */}
              <div className="mt-6 space-y-5">
                <div className="p-4 bg-white/70 border border-[#0A0A0C]/15">
                  <div className="flex justify-between gap-2 text-[13px] font-mono mb-2.5">
                    <span>MAX DAILY SPEND (24H ROLLING)</span>
                    <span className="font-bold text-[#2934FF] text-right">
                      {maxDailySol.toFixed(1)} SOL (
                      {(maxDailySol * 1e9).toLocaleString("en-US")} lamports)
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
                  <div className="flex justify-between gap-2 text-[13px] font-mono mb-2.5">
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

            {/* Emergency Circuit Breaker & Policy Sync Controls */}
            <div className="mt-8 pt-6 border-t border-[#0A0A0C]/15 space-y-3">
              <button
                type="button"
                onClick={() => handleBuildPolicyVaultTx("sync")}
                className="w-full py-3 px-4 border border-[#0A0A0C]/25 bg-white/70 hover:bg-[#0A0A0C] hover:text-white text-[#0A0A0C] font-mono text-[12.5px] uppercase tracking-[0.05em] transition-colors cursor-pointer"
              >
                {vaultStatus?.programDeployedOnMainnet
                  ? "SYNC POLICY GUARDRAILS TO MAINNET PDA ↗"
                  : vaultStatus?.programDeployedOnDevnet
                    ? "SYNC POLICY GUARDRAILS TO DEVNET BETA PDA ↗"
                    : "SERIALIZE ANCHOR POLICY INSTRUCTION (DEVNET BETA)"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextLocked = !emergencyLocked;
                  setEmergencyLocked(nextLocked);
                  handleBuildPolicyVaultTx("emergency-lock", nextLocked);
                }}
                className={`w-full py-4 px-5 font-sans font-semibold text-[13.5px] uppercase tracking-[0.06em] text-white transition-colors flex items-center justify-center gap-2 cursor-pointer ${
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
              {policyActionNotice && (
                <div className="p-3 bg-[#0A0A0C] text-white font-mono text-[11.5px] leading-relaxed break-all">
                  <div>{policyActionNotice}</div>
                  {policyTxArtifact && (
                    <div className="text-emerald-300/90 mt-1">
                      DATA_HEX: {policyTxArtifact.instructionDataHex}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* COLUMN 3 (RIGHT) — 06 // SOLANA ACTIONS & BLINKS STUDIO */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.14)"
            className="px-8 sm:px-12 xl:px-14 py-12 flex flex-col justify-between"
          >
            <div id="blinks-studio">
              <div className="flex items-center justify-between gap-2 mb-6">
                <span className="text-[12.5px] font-mono uppercase tracking-[0.09em] text-[#2934FF] font-semibold">
                  06 // SOLANA BLINKS
                </span>
                <span className="text-[12px] font-mono uppercase px-2.5 py-0.5 border border-emerald-500/45 text-emerald-500 whitespace-nowrap shrink-0">
                  ACTIONS.JSON READY
                </span>
              </div>

              <h3 className="text-[28px] sm:text-[32px] font-normal tracking-[-0.035em] leading-[1.1] mb-3">
                Shareable Guarded Blink
              </h3>
              <p className="text-[15px] opacity-80 leading-[1.6] mb-6">
                SolShield exposes a spec-compliant Solana Action endpoint at{" "}
                <code className="font-mono text-[13.5px]">/api/actions/audit-swap</code> that
                runs a Venice AI pre-flight check before returning the swap
                payload to X/Twitter Blinks.
              </p>

              {/* Visual Blink Card Preview */}
              <div className="p-5 border border-current/20 bg-current/[0.03] space-y-4">
                <div className="flex items-center gap-3">
                  <img
                    src="/logo.jpg"
                    alt="SolShield Blink"
                    className="w-11 h-11 rounded-lg object-cover border border-white/20"
                  />
                  <div>
                    <div className="text-[16px] font-medium">
                      SolShield — Venice AI Guarded Swap
                    </div>
                    <div className="text-[13px] font-mono opacity-75">
                      sol-shield.xyz • Zero-Log Action
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[11.5px] font-mono uppercase tracking-[0.06em] opacity-75 block mb-2">
                    CUSTOM SWAP AMOUNT (SOL)
                  </label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.1"
                    value={selectedBlinkSol}
                    onChange={(e) => setSelectedBlinkSol(e.target.value)}
                    placeholder="Enter SOL amount (e.g. 0.5)"
                    className="w-full px-3.5 py-2.5 text-[14px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={!selectedBlinkSol.trim()}
                    onClick={() => {
                      const amt = encodeURIComponent(selectedBlinkSol.trim());
                      const actionUrl = `${window.location.origin}/api/actions/audit-swap?amount=${amt}`;
                      setTechnicalMode("payload");
                      runPayloadAudit({ mode: "blink", payload: actionUrl });
                      scrollToTechnicalSide();
                    }}
                    className="w-full py-3 bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white text-[12.5px] font-sans font-semibold uppercase tracking-[0.05em] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>INSPECT BLINK IN FIREWALL ↗</span>
                  </button>

                  <button
                    type="button"
                    disabled={!selectedBlinkSol.trim()}
                    onClick={() => {
                      const amt = encodeURIComponent(selectedBlinkSol.trim());
                      const actionUrl = `solana-action:${window.location.origin}/api/actions/audit-swap?amount=${amt}`;
                      navigator.clipboard.writeText(actionUrl);
                      setCopiedBlinkUrl(true);
                      setTimeout(() => setCopiedBlinkUrl(false), 2000);
                    }}
                    className="w-full py-3 border border-current/25 hover:border-[#2934FF] disabled:opacity-50 text-[12.5px] font-sans font-semibold uppercase tracking-[0.05em] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {copiedBlinkUrl ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-500" />
                        <span>COPIED SOLANA-ACTION: URL</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="w-4 h-4" />
                        <span>COPY BLINK ACTION URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 hexacore-hairline-t flex flex-wrap items-center justify-between gap-2 text-[13px] font-mono opacity-80">
              <span className="whitespace-nowrap">Built by @Blanksite</span>
              <a
                href="https://github.com/Blanksite/solshield"
                target="_blank"
                rel="noreferrer"
                className="underline hover:opacity-100 whitespace-nowrap"
              >
                Open-Source MIT Repo ↗
              </a>
            </div>
          </SpotlightCard>
        </section>

        {/* ====================================================================
            BROWSER GUARD CHROME MV3 EXTENSION RELEASE STRIP
            ==================================================================== */}
        <section
          id="browser-guard"
          className="w-full hexacore-canvas border-t border-white/12 text-current px-6 sm:px-10 xl:px-14 py-12"
        >
          <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-3">
              <div className="inline-flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.12em] text-[#2934FF] font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  {lang === "en"
                    ? "CHROME MV3 EXTENSION BETA · v0.3.0"
                    : "EKSTENSI CHROME MV3 BETA · v0.3.0"}
                </span>
              </div>
              <h2 className="text-[28px] sm:text-[34px] font-medium tracking-[-0.03em] leading-[1.12]">
                {lang === "en"
                  ? "SolShield Browser Guard — Pre-Sign Firewall Before Phantom Pops Up."
                  : "SolShield Browser Guard — Firewall Pra-Sign Sebelum Popup Phantom."}
              </h2>
              <p className="text-[15.5px] opacity-80 leading-relaxed max-w-2xl">
                {lang === "en"
                  ? "Intercepts Legacy (Phantom, Solflare, Backpack, Glow) and Wallet Standard requests including signTransaction, signAllTransactions, signMessage, and cross-domain SIWS signIn via isolated MessageChannel + Shadow DOM modal with zero transaction mutation."
                  : "Mencegat permintaan Legacy & Wallet Standard (signTransaction, signAllTransactions, signMessage, hingga SIWS signIn lintas domain) lewat MessageChannel terisolasi + overlay Shadow DOM tanpa memodifikasi objek transaksi."}
              </p>
              <div className="pt-1 flex flex-wrap gap-2 text-[12px] font-mono opacity-80">
                <span className="px-2.5 py-1 border border-current/20">1. Download &amp; unzip ZIP</span>
                <span className="px-2.5 py-1 border border-current/20">2. chrome://extensions → Developer mode</span>
                <span className="px-2.5 py-1 border border-current/20">3. Load unpacked dist/</span>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col xl:flex-row lg:items-end justify-end gap-3">
              <a
                href="/downloads/solshield-browser-guard-v0.3.0.zip"
                download
                className="inline-flex items-center justify-center gap-2.5 px-5 py-3.5 bg-[#2934FF] hover:opacity-95 text-white text-[13px] font-mono font-semibold uppercase tracking-[0.06em] transition-opacity whitespace-nowrap"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>
                  {lang === "en"
                    ? "Download MV3 Guard (.ZIP)"
                    : "Unduh Ekstensi MV3 (.ZIP)"}
                </span>
              </a>
              <a
                href="/privacy"
                className="inline-flex items-center justify-center gap-2 px-4 py-3.5 border border-current/25 hover:border-[#2934FF] text-[13px] font-mono uppercase tracking-[0.06em] transition-colors whitespace-nowrap"
              >
                <Shield className="w-4 h-4 text-[#2934FF] shrink-0" />
                <span>{lang === "en" ? "Privacy Policy" : "Kebijakan Privasi"}</span>
              </a>
            </div>
          </div>
        </section>

        {/* ====================================================================
            FOOTER — SLEEK HEADER-MATCHED PROTOCOL BAR (OUTSIDE 3-COL BODY GRID)
            ==================================================================== */}
        <footer
          className={`w-full border-t transition-colors ${
            darkMode
              ? "bg-[#050507] text-[#F8F8FA] border-white/15"
              : "bg-[#E7E9EF] text-[#0A0A0C] border-black/15"
          }`}
        >
          <div className="max-w-[1440px] mx-auto px-6 sm:px-10 xl:px-14">
            {/* Primary Footer Bar — Mirrors Top Header Navigation & Controls */}
            <div className="py-7 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              {/* Left: Brand Identity + Venice Pill */}
              <div className="flex flex-wrap items-center gap-3.5">
                <a
                  href="#"
                  className="inline-flex items-center gap-2.5 group focus:outline-none"
                >
                  <HexaCoreLogoMark />
                  <span className="text-[21px] font-medium tracking-[-0.03em]">
                    SolShield
                    <sup className="text-[11px] font-normal ml-0.5 opacity-75">
                      ®
                    </sup>
                  </span>
                </a>
                <BuiltInVeniceBadge />
              </div>

              {/* Center: Horizontal Navigation Links (Matches Hero Built in Venice Pillars) */}
              <nav
                aria-label="Footer navigation"
                className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px] font-medium tracking-[-0.01em] opacity-85"
              >
                <button
                  type="button"
                  onClick={() => {
                    setTechnicalMode("payload");
                    scrollToTechnicalSide();
                  }}
                  className="hover:opacity-100 hover:text-[#2934FF] transition-colors cursor-pointer"
                >
                  {lang === "en" ? "Tx Firewall" : "Firewall Tx"}
                </button>
                <button
                  type="button"
                  onClick={scrollToIntentSide}
                  className="hover:opacity-100 hover:text-[#2934FF] transition-colors cursor-pointer"
                >
                  Intent Copilot
                </button>
                <button
                  type="button"
                  onClick={scrollToVaultSide}
                  className="hover:opacity-100 hover:text-[#2934FF] transition-colors cursor-pointer"
                >
                  Vault
                </button>
                <a
                  href="/actions.json"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:opacity-100 hover:text-[#2934FF] transition-colors"
                >
                  Blinks
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setTechnicalMode("token");
                    scrollToTechnicalSide();
                  }}
                  className="hover:opacity-100 hover:text-[#2934FF] transition-colors cursor-pointer"
                >
                  {lang === "en" ? "Token Audit" : "Cek Token"}
                </button>
                <Link
                  href="/buildcheck"
                  className="hover:opacity-100 hover:text-[#2934FF] transition-colors"
                >
                  BuildCheck
                </Link>
                <a
                  href="https://github.com/Blanksite/solshield"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:opacity-100 hover:text-[#2934FF] transition-colors inline-flex items-center gap-1"
                >
                  <span>GitHub</span>
                  <ArrowUpRight className="w-4 h-4 opacity-70" />
                </a>
              </nav>

              {/* Right: Utility Pills (Mirrors Top-Right Header Controls) */}
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  title="Live Solana Mainnet Telemetry"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-500/40 text-emerald-500 text-[12px] font-mono uppercase tracking-[0.06em]"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>
                    {liveSlot !== null
                      ? `SLOT #${liveSlot.toLocaleString("en-US")}`
                      : "MAINNET SYNC"}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => setShowKeyModal(true)}
                  title="Configure Venice AI Zero-Retention Key"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-current/25 hover:border-[#2934FF] text-[12px] font-sans font-medium uppercase tracking-[0.06em] transition-colors cursor-pointer"
                >
                  <Key className="w-4 h-4 text-[#2934FF]" />
                  <span>BYOK Key</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  title="Back to Top"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-current/25 hover:border-[#2934FF] hover:bg-[#2934FF] hover:text-white text-[12px] font-sans font-medium uppercase tracking-[0.06em] transition-colors cursor-pointer"
                >
                  <span>Top</span>
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sub-Footer Bar: Copyright, Verified Specs & Non-Custodial Guarantee */}
            <div
              className={`py-4 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[12.5px] font-mono opacity-80 ${
                darkMode ? "border-white/10" : "border-black/10"
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  © 2026 SolShield® Protocol · MIT License · Built by{" "}
                  <a
                    href="https://github.com/Blanksite"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:opacity-100"
                  >
                    @Blanksite
                  </a>
                </span>
                <a
                  href="https://sol-shield.xyz"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  sol-shield.xyz
                </a>
                <a
                  href="https://github.com/Blanksite/solshield/blob/main/programs/solshield-policy/src/lib.rs"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Anchor Policy PDA
                </a>
                <a
                  href={TOKEN_CONFIG.links.solscan || "https://solscan.io"}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Mainnet Solscan
                </a>
                <a
                  href="/downloads/solshield-browser-guard-v0.3.0.zip"
                  download
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Extension ZIP
                </a>
                <a
                  href="/privacy"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  Privacy Policy
                </a>
                <a
                  href={TOKEN_CONFIG.links.x}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#2934FF] transition-colors"
                >
                  {TOKEN_CONFIG.xHandle}
                </a>
              </div>

              <div className="inline-flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-[#2934FF] shrink-0" />
                <span>
                  {lang === "en"
                    ? "100% NON-CUSTODIAL · ZERO-RETENTION VENICE AI · VERIFY BEFORE SIGNING"
                    : "100% NON-KUSTODIAN · VENICE AI ZERO-RETENTION · SELALU VERIFIKASI SEBELUM SIGN"}
                </span>
              </div>
            </div>

            {/* Editorial Giant Bayer-Dithered Wordmark (hover to heal the dither) */}
            <div
              className={`pt-9 sm:pt-12 pb-8 sm:pb-10 border-t ${
                darkMode ? "border-white/10" : "border-black/10"
              }`}
            >
              <div className="flex items-end justify-between gap-4 mb-4 sm:mb-5 text-[12px] font-mono uppercase tracking-[0.12em] opacity-75">
                <span>
                  <span className="text-[#2934FF]">●</span> Solana Security
                  Protocol — Est. 2026
                </span>
                <span className="hidden sm:inline">
                  {lang === "en" ? "Verify before you sign ↘" : "Verifikasi sebelum sign ↘"}
                </span>
              </div>
              <FooterWordmark
                inkColor={darkMode ? "#E2E4E8" : "#0A0A0C"}
                rimColor="#2934FF"
                cellSize={2}
                className="cursor-crosshair"
              />
            </div>
          </div>
        </footer>

        {/* ====================================================================
            BYOK VENICE AI API KEY MODAL
            ==================================================================== */}
        {showKeyModal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="hexacore-canvas border border-current/20 max-w-md w-full p-7 shadow-2xl">
              <div className="flex items-center justify-between pb-4 hexacore-hairline-b">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[#2934FF]" />
                  <h3 className="text-[18px] font-medium">
                    Venice AI Zero-Retention Key
                  </h3>
                </div>
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[15px] opacity-85 leading-relaxed mt-4">
                SolShield runs out-of-the-box with our built-in zero-retention
                engine. Optionally supply your own{" "}
                <code className="font-mono text-[#2934FF] text-[13.5px]">
                  api.venice.ai
                </code>{" "}
                key (<code className="font-mono text-[13.5px]">llama-3.3-70b</code>):
              </p>

              <input
                type="password"
                value={veniceApiKey}
                onChange={(e) => setVeniceApiKey(e.target.value)}
                placeholder="vn-..."
                className="w-full mt-4 px-3.5 py-3 text-[14px] font-mono bg-transparent border border-current/25 focus:border-[#2934FF] focus:outline-none"
              />

              <div className="flex justify-end gap-2.5 mt-6">
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2.5 text-[13px] font-sans font-semibold uppercase border border-current/25 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("solshield_venice_key", veniceApiKey);
                    setShowKeyModal(false);
                    if (technicalMode === "token" && tokenMintInput.trim()) {
                      runTokenScan();
                    } else if (
                      technicalMode === "payload" &&
                      txPayloadInput.trim()
                    ) {
                      runPayloadAudit();
                    }
                  }}
                  className="px-5 py-2.5 text-[13px] font-sans font-semibold uppercase bg-[#2934FF] text-white cursor-pointer"
                >
                  Save Key
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClickSpark>
  );
}
