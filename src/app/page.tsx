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
import {
  extractSolanaMintFromFirewallInput,
  getLiveAuditSwapBlinkUrl,
} from "@/lib/firewall-input";
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
import SolShieldNavbar from "@/components/landing/SolShieldNavbar";
import UltraModernBento from "@/components/landing/UltraModernBento";
import ArchitecturalProofStrip from "@/components/landing/ArchitecturalProofStrip";
import SiteFooter from "@/components/landing/SiteFooter";
import {
  DecryptedText,
  BlurText,
  Magnet,
  TiltedCard,
  ClickSpark,
  CobaltSphere3D,
  DitherVeil,
} from "@/components/reactbits";
import {
  Search,
  ArrowRight,
  ArrowUpRight,
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

async function fetchWithGuardRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401 || typeof window === "undefined") {
    return res;
  }
  await fetch(window.location.pathname || "/", {
    method: "HEAD",
    credentials: "same-origin",
  }).catch(() => undefined);
  return fetch(url, init);
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
  const [selectedBlinkSol, setSelectedBlinkSol] = useState<string>("0.5");
  const [copiedBlinkUrl, setCopiedBlinkUrl] = useState<boolean>(false);
  const [revokeStatus, setRevokeStatus] = useState<"IDLE" | "BUILT">("IDLE");

  // Unified Command Studio Mode: Tx Firewall, Token Audit, Intent, Vault & Blinks
  const [technicalMode, setTechnicalMode] = useState<
    "payload" | "token" | "intent" | "vault" | "blinks"
  >("payload");
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
        "SolShield Adaptive AI Guard online. Paste any Solana address (Token Mint, Program ID, Wallet) or an 88-char Transaction Signature (txHash) below for live RPC & zero-retention Venice AI inspection.",
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
      const res = await fetch(`/api/policy-status${qs}`, {
        credentials: "same-origin",
      });
      const data = await res.json();
      if (data.ok) {
        setVaultStatus(data);
        if (typeof data.mainnetSlot === "number" && data.mainnetSlot > 0) {
          setLiveSlot((prev) => prev ?? data.mainnetSlot);
        }
        if (typeof data.rpcLatencyMs === "number" && data.rpcLatencyMs > 0) {
          setRpcLatencyMs((prev) => prev ?? data.rpcLatencyMs);
        }
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
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    localStorage.setItem("solshield_theme_v3", nextDark ? "dark" : "light");
    window.dispatchEvent(
      new CustomEvent("solshield-theme-change", { detail: { darkMode: nextDark } })
    );
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
      const detectedMint =
        !options?.payload && !rawPayload.toLowerCase().startsWith("solana-action:")
          ? extractSolanaMintFromFirewallInput(rawPayload)
          : null;
      if (detectedMint) {
        setIsAuditing(false);
        setAuditError(null);
        setTechnicalMode("token");
        setTokenMintInput(detectedMint);
        await runTokenScan(detectedMint);
        return;
      }

      const response = await fetchWithGuardRetry("/api/audit", {
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
      const res = await fetchWithGuardRetry("/api/scan-token", {
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
    setTechnicalMode("vault");
    const el = document.getElementById("technical-side");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToBlinksSide = () => {
    setTechnicalMode("blinks");
    const el = document.getElementById("technical-side");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToIntentSide = () => {
    setTechnicalMode("intent");
    const el = document.getElementById("technical-side");
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
    <ClickSpark sparkColor="#2934FF" sparkRadius={26} sparkCount={8} className="min-h-screen">
      <div id="top" className="hexacore-canvas min-h-screen font-sans">
        {/* ====================================================================
            PROTOCOL LAUNCH STRIP — Official CA & Verified On-Chain Links
            ==================================================================== */}
        <div
          className={`w-full border-b transition-colors ${
            darkMode
              ? "bg-[#06080E] border-white/10 text-[#D7DCE8]"
              : "bg-[#FAF9F6] border-black/10 text-[#262624]"
          }`}
        >
          <div className="max-w-[1440px] mx-auto px-5 sm:px-8 xl:px-12 py-2 text-[11.5px] font-mono">
            {TOKEN_CONFIG.isLive ? (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="inline-flex items-center gap-2 font-semibold tracking-[0.08em] uppercase">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    {TOKEN_CONFIG.symbol} OFFICIAL CA
                  </span>
                  <span
                    title={TOKEN_CONFIG.ca}
                    className={`px-2 py-0.5 rounded-md border tracking-[0.04em] ${
                      darkMode
                        ? "border-white/15 bg-white/[0.04] text-white/90"
                        : "border-black/15 bg-white text-[#141413]"
                    }`}
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
                    className={`px-2 py-0.5 rounded-md border transition-colors uppercase tracking-[0.06em] cursor-pointer ${
                      darkMode
                        ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF] hover:text-white"
                        : "border-black/15 bg-white hover:border-[#2934FF] hover:text-[#2934FF]"
                    }`}
                  >
                    {copiedLaunchCa ? "Copied ✓" : "Copy CA"}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 opacity-85">
                  <a
                    href="https://www.geckoterminal.com/solana/pools/GNGFarHeFPxxmtACQxF52YGWV5z6qC5eyG7p6LEoFx6W"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[#2934FF] transition-colors"
                  >
                    GeckoTerminal ↗
                  </a>
                  <a
                    href="https://rugcheck.xyz/tokens/CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[#2934FF] transition-colors"
                  >
                    RugCheck ↗
                  </a>
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
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-2 font-semibold tracking-[0.08em] uppercase">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2934FF] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2934FF]" />
                    </span>
                    {TOKEN_CONFIG.symbol}
                  </span>
                  <span className="opacity-75 tracking-[0.05em]">
                    PRE-LAUNCH // OFFICIAL CA PUBLISHED HERE UPON RELEASE
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 opacity-85">
                  <a
                    href="#technical-side"
                    className="hover:text-[#2934FF] transition-colors"
                  >
                    Firewall Live ↗
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
        </div>

        {/* ====================================================================
            GLOBAL STICKY HEADER — Single-Row 4-Item Nav + Products Mega-Menu
            ==================================================================== */}
        <SolShieldNavbar
          lang={lang}
          onToggleLang={() => setLang(lang === "en" ? "id" : "en")}
          darkMode={darkMode}
          onToggleTheme={toggleTheme}
          connectedWallet={connectedWallet}
          isRealWalletConnected={isRealWalletConnected}
          onConnectWallet={connectBrowserWallet}
          walletNotice={walletNotice}
          onOpenKeyModal={() => setShowKeyModal(true)}
          onOpenTxFirewall={() => {
            setTechnicalMode("payload");
            scrollToTechnicalSide();
          }}
          onOpenTokenAudit={() => {
            setTechnicalMode("token");
            scrollToTechnicalSide();
          }}
          onOpenVault={scrollToVaultSide}
          onOpenBlinks={scrollToBlinksSide}
        />

        {/* ====================================================================
            SECTION 01 — HERO (1:1 HALO LAB "HEXACORE — ADAPTIVE AI GUARD" GRID)
            3 Full-Height Architectural Columns separated by crisp hairlines
            ==================================================================== */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.16fr)_minmax(0,1fr)] min-h-[calc(100vh-4rem)] hexacore-hairline-b">
          {/* ------------------------------------------------------------------
              COLUMN 1 (LEFT) — "Adaptive AI [●] Guard" + Social Proof
              ------------------------------------------------------------------ */}
          <div className="flex flex-col justify-between hexacore-hairline-r px-8 sm:px-12 xl:px-14 py-9">
            {/* Center Editorial Headline: "Adaptive / AI [Orb] / Guard" */}
            <div className="my-auto py-10">
              <h1 className="text-[54px] sm:text-[64px] xl:text-[74px] font-normal leading-[1.03] tracking-[-0.04em] select-none">
                <span className="block">
                  <BlurText text="Adaptive" delay={60} />
                </span>
                <span className="sr-only"> </span>
                <span className="flex items-center gap-4 my-1">
                  <BlurText text="AI" delay={140} />
                  <Magnet padding={50} magnetStrength={2.2}>
                    <CobaltSphere3D className="w-12 h-12 sm:w-14 sm:h-14 cursor-pointer" />
                  </Magnet>
                </span>
                <span className="sr-only"> </span>
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
              COLUMN 2 (CENTER MONOLITH) — Interactive Dither Veil + Call To Action
              ------------------------------------------------------------------ */}
          <div className="flex flex-col justify-between hexacore-hairline-r hexacore-canvas text-current relative overflow-hidden">
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
            <div className="px-6 sm:px-10 pb-8 pt-3 flex flex-col items-center text-center mt-auto relative z-20">
              <div className="relative w-full flex flex-wrap items-center justify-center gap-2.5 my-1">
                <Magnet padding={36} magnetStrength={2.2}>
                  <button
                    type="button"
                    onClick={() => {
                      setTechnicalMode("payload");
                      scrollToTechnicalSide();
                    }}
                    className="relative z-10 rounded-xl bg-[#2934FF] hover:bg-[#1E27E6] active:scale-[0.99] text-white px-7 py-3.5 text-[14.5px] font-semibold tracking-[-0.01em] transition-all shadow-[0_10px_26px_rgba(41,52,255,0.34)] cursor-pointer whitespace-nowrap"
                  >
                    {lang === "en" ? "Launch Tx Firewall" : "Buka Tx Firewall"}
                  </button>
                </Magnet>
                <Link
                  href="/buildcheck"
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-5 py-3.5 text-[14px] font-medium transition-colors whitespace-nowrap ${
                    darkMode
                      ? "border-white/15 bg-white/[0.03] text-[#E4E7EE] hover:border-[#2934FF] hover:text-white"
                      : "border-black/15 bg-white text-[#141413] hover:border-[#2934FF] hover:text-[#2934FF]"
                  }`}
                >
                  <span>BuildCheck</span>
                  <ArrowUpRight className="w-4 h-4 opacity-70" />
                </Link>
              </div>

              <div className="mt-4">
                <span
                  className={`inline-block border rounded-full px-3.5 py-1 text-[11px] font-mono font-semibold uppercase tracking-[0.08em] ${
                    darkMode
                      ? "border-white/15 bg-white/[0.03] text-[#A8B0BC]"
                      : "border-black/15 bg-white text-[#4D4C49]"
                  }`}
                >
                  {lang === "en"
                    ? "BUILT IN VENICE · ZERO-LOG AI"
                    : "BUILT IN VENICE · AI TANPA RETENSI"}
                </span>
              </div>

              <div className="mt-3">
                <CobaltPixelCluster />
              </div>

              <h2 className="mt-2.5 text-[22px] sm:text-[25px] xl:text-[28px] font-medium leading-[1.18] tracking-[-0.025em] max-w-[390px]">
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
              COLUMN 3 (RIGHT) — 5-Stage Wheel + Live Security Radar Card
              ------------------------------------------------------------------ */}
          <div className="flex flex-col justify-between px-8 sm:px-12 xl:px-14 py-9">
            {/* Center 5-Stage Vertical Typographic Wheel */}
            <div className="my-auto py-10 flex flex-col items-center justify-center select-none">
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
                        FIREWALL ACTIVE
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
                        RPC TELEMETRY
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
            ACT I — ASYMMETRIC SMOKED-GLASS SECURITY SUITE BENTO
            ==================================================================== */}
        <UltraModernBento
          lang={lang}
          darkMode={darkMode}
          onOpenTxFirewall={() => {
            setTechnicalMode("payload");
            scrollToTechnicalSide();
          }}
          onOpenIntent={scrollToIntentSide}
          onOpenVault={scrollToVaultSide}
        />

        {/* ====================================================================
            ACT II — FLOATING SMOKED-GLASS COMMAND STUDIO WORKBENCH
            Unified 5-Tab Cohesive Dark/Light 2-Pane Pro Security Terminal
            ==================================================================== */}
        <section
          id="technical-side"
          aria-label="SolShield Live Security Command Studio"
          className={`relative w-full transition-colors overflow-x-clip ${
            darkMode
              ? "bg-[#06080E] text-[#F4F6FA]"
              : "bg-[#FAF9F6] text-[#141413]"
          }`}
        >
          {/* Subtle Electric Cobalt studio backlight behind floating frame */}
          {darkMode && (
            <div
              className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 w-[780px] max-w-[92vw] h-[320px] rounded-full opacity-[0.14] blur-[110px]"
              style={{ background: "#2934FF" }}
            />
          )}

          <div className="relative z-10 max-w-[1440px] mx-auto px-5 sm:px-8 xl:px-12 py-10 sm:py-12">
            {/* Section Eyebrow */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
              <div>
                <div className="inline-flex items-center gap-2 text-[11.5px] font-mono uppercase tracking-[0.12em] text-[#2934FF] font-semibold mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>
                    {lang === "en"
                      ? "INTERACTIVE COMMAND STUDIO · LIVE RPC ENGINE"
                      : "STUDIO KOMANDO INTERAKTIF · MESIN RPC LIVE"}
                  </span>
                </div>
                <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-[-0.03em] leading-tight">
                  {lang === "en"
                    ? "Simulate, decode, and verify before signing."
                    : "Simulasi, decode, dan verifikasi sebelum sign."}
                </h2>
              </div>
              <p
                className={`text-[13.5px] max-w-md ${
                  darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                }`}
              >
                {lang === "en"
                  ? "Every pre-sign tool in one cohesive workspace — zero data retention powered by Venice AI."
                  : "Seluruh alat keamanan pra-sign dalam satu ruang kerja terpadu — zero data retention oleh Venice AI."}
              </p>
            </div>

            {/* Floating Smoked-Glass Application Window */}
            <div
              className={`relative rounded-2xl border overflow-hidden ${
                darkMode
                  ? "bg-[#0B0E17] border-white/15 shadow-[0_28px_80px_rgba(0,0,0,0.68)]"
                  : "bg-[#FFFFFF] border-black/15 shadow-[0_20px_56px_rgba(10,10,12,0.08)]"
              }`}
            >
              {/* Luminous 1px top specular highlight */}
              {darkMode && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2934FF]/75 to-transparent" />
              )}

              {/* Studio Top Bar: Frosted Segmented Pill Switcher + Live Slot + BYOK */}
              <div
                className={`px-5 sm:px-7 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 ${
                  darkMode
                    ? "border-white/10 bg-[#080B13]"
                    : "border-black/10 bg-[#F4F3EF]"
                }`}
              >
                {/* 5 Frosted Workspace Tabs */}
                <div
                  role="tablist"
                  aria-label="Security Workbench Modes"
                  className={`inline-flex flex-wrap items-center gap-1 p-1 rounded-xl border ${
                    darkMode
                      ? "bg-white/[0.03] border-white/10"
                      : "bg-black/[0.03] border-black/10"
                  }`}
                >
                  {(
                    [
                      { id: "payload", label: "Tx Firewall", icon: Layers },
                      { id: "token", label: "Token Audit", icon: ShieldCheck },
                      { id: "intent", label: "Intent Copilot", icon: Sparkles },
                      { id: "vault", label: "Policy Vault", icon: Lock },
                      { id: "blinks", label: "Blinks", icon: Share2 },
                    ] as const
                  ).map((tab) => {
                    const Icon = tab.icon;
                    const active = technicalMode === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setTechnicalMode(tab.id)}
                        className={`inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                          active
                            ? darkMode
                              ? "bg-[#182038] text-white border border-white/15 shadow-[0_2px_10px_rgba(41,52,255,0.22)]"
                              : "bg-[#2934FF] text-white shadow-sm"
                            : darkMode
                              ? "text-[#8E98AD] hover:text-white border border-transparent"
                              : "text-[#575653] hover:text-[#141413] border border-transparent"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Live Telemetry & BYOK Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11.5px] font-mono whitespace-nowrap ${
                      darkMode
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-emerald-600/30 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>
                      {liveSlot !== null
                        ? `SLOT #${liveSlot.toLocaleString("en-US")}`
                        : "RPC SYNC"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowKeyModal(true)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11.5px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                      darkMode
                        ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF] text-[#E4E7EE]"
                        : "border-black/15 bg-white hover:border-[#2934FF] text-[#141413]"
                    }`}
                  >
                    <Key className="w-3.5 h-3.5 text-[#2934FF]" />
                    <span>{veniceApiKey ? "Key Active" : "BYOK Key"}</span>
                  </button>
                </div>
              </div>

              {/* ==============================================================
                  UNIFIED 2-PANE WORKSPACE INTERIOR (COHESIVE OBSIDIAN / PAPER)
                  ============================================================== */}
              <div
                className={`grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x ${
                  darkMode ? "divide-white/10" : "divide-black/10"
                }`}
              >
                {/* ------------------------------------------------------------
                    LEFT PANE (5 COLS) — INPUTS, CONTROLS & PRESETS
                    ------------------------------------------------------------ */}
                <div
                  className={`lg:col-span-5 p-5 sm:p-6 flex flex-col justify-between gap-5 ${
                    darkMode ? "bg-[#0A0D16]" : "bg-[#FFFFFF]"
                  }`}
                >
                  {/* TAB 1: TX FIREWALL INPUTS */}
                  {technicalMode === "payload" && (
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.025em]">
                          {lang === "en"
                            ? "Pre-Sign Sandbox"
                            : "Sandbox Pra-Sign"}
                        </h3>
                        <p
                          className={`text-[13.5px] mt-1 leading-relaxed ${
                            darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                          }`}
                        >
                          {lang === "en"
                            ? "Decode Legacy or V0 Solana transactions, inspect Blink URLs, and simulate real on-chain balance deltas before signing."
                            : "Decode transaksi Legacy/V0 Solana, cek URL Blink, dan simulasi perubahan saldo on-chain sebelum sign."}
                        </p>
                      </div>

                      {/* Segmented Input Mode Pill */}
                      <div
                        className={`inline-grid grid-cols-2 w-full p-1 rounded-xl border gap-1 ${
                          darkMode
                            ? "bg-white/[0.03] border-white/10"
                            : "bg-black/[0.03] border-black/10"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setPayloadInputMode("base64");
                            setAuditError(null);
                          }}
                          className={`py-2 px-3 rounded-lg text-[12px] font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer ${
                            payloadInputMode === "base64"
                              ? "bg-[#2934FF] text-white font-semibold"
                              : darkMode
                                ? "text-[#8E98AD] hover:text-white"
                                : "text-[#575653] hover:text-black"
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
                          className={`py-2 px-3 rounded-lg text-[12px] font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer ${
                            payloadInputMode === "blink"
                              ? "bg-[#2934FF] text-white font-semibold"
                              : darkMode
                                ? "text-[#8E98AD] hover:text-white"
                                : "text-[#575653] hover:text-black"
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
                            rows={3}
                            value={txPayloadInput}
                            onChange={(e) => setTxPayloadInput(e.target.value)}
                            placeholder={
                              lang === "en"
                                ? "Paste serialized Legacy or Versioned (V0) Base64 transaction, or a Solana Mint CA..."
                                : "Tempel transaksi Base64 Legacy/V0, atau Mint CA Solana..."
                            }
                            className={`w-full rounded-xl p-3.5 text-[13px] font-mono border focus:border-[#2934FF] focus:outline-none leading-relaxed ${
                              darkMode
                                ? "bg-[#06080E] border-white/15 text-white placeholder:text-white/35"
                                : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                            }`}
                          />
                        ) : (
                          <input
                            type="url"
                            value={txPayloadInput}
                            onChange={(e) => setTxPayloadInput(e.target.value)}
                            placeholder="https://... or solana-action:https://..."
                            className={`w-full rounded-xl px-3.5 py-3 text-[13px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                              darkMode
                                ? "bg-[#06080E] border-white/15 text-white placeholder:text-white/35"
                                : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                            }`}
                          />
                        )}

                        <input
                          type="text"
                          value={txSignerInput}
                          onChange={(e) => setTxSignerInput(e.target.value)}
                          placeholder={
                            lang === "en"
                              ? "Optional Signer Pubkey (defaults to connected wallet)"
                              : "Opsional: Pubkey Signer (pakai wallet terhubung)"
                          }
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[12.5px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                            darkMode
                              ? "bg-[#06080E] border-white/10 text-white placeholder:text-white/35"
                              : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                          }`}
                        />

                        <label
                          className={`flex items-center gap-2.5 text-[12.5px] cursor-pointer select-none ${
                            darkMode ? "text-[#9EA8BA]" : "text-[#575653]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={simulateRpc}
                            onChange={(e) => setSimulateRpc(e.target.checked)}
                            className="accent-[#2934FF] w-4 h-4 rounded cursor-pointer"
                          />
                          <span>
                            {lang === "en"
                              ? "Simulate live via Solana RPC"
                              : "Simulasi langsung via Solana RPC"}
                          </span>
                        </label>

                        {/* Quick-Test Preset Chips */}
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isAuditing}
                            onClick={() => {
                              const actionUrl = getLiveAuditSwapBlinkUrl("0.5");
                              setPayloadInputMode("blink");
                              setTxPayloadInput(actionUrl);
                              void runPayloadAudit({
                                mode: "blink",
                                payload: actionUrl,
                              });
                            }}
                            className={`px-3 py-1.5 rounded-lg border text-[11.5px] font-mono transition-colors cursor-pointer disabled:opacity-50 ${
                              darkMode
                                ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF] text-[#CBD5E1]"
                                : "border-black/15 bg-black/[0.02] hover:border-[#2934FF] text-[#141413]"
                            }`}
                          >
                            Live 0.5 SOL Jupiter Blink ↗
                          </button>
                          <button
                            type="button"
                            onClick={() => setTechnicalMode("token")}
                            className={`px-3 py-1.5 rounded-lg border text-[11.5px] font-mono transition-colors cursor-pointer ${
                              darkMode
                                ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF] text-[#CBD5E1]"
                                : "border-black/15 bg-black/[0.02] hover:border-[#2934FF] text-[#141413]"
                            }`}
                          >
                            Switch to Token CA
                          </button>
                        </div>

                        <div className="flex gap-2 pt-0.5">
                          <button
                            type="submit"
                            disabled={isAuditing || !txPayloadInput.trim()}
                            className={`flex-1 rounded-xl py-2.5 px-4 text-[13.5px] font-semibold tracking-[-0.01em] transition-colors flex items-center justify-center gap-2 ${
                              isAuditing || !txPayloadInput.trim()
                                ? darkMode
                                  ? "bg-white/10 text-white/50 border border-white/10 cursor-not-allowed"
                                  : "bg-[#EAE8E2] text-[#4D4C49] border border-black/10 cursor-not-allowed"
                                : "bg-[#2934FF] hover:bg-[#1E27E6] text-white cursor-pointer shadow-[0_8px_24px_rgba(41,52,255,0.28)]"
                            }`}
                          >
                            <ShieldCheck className="w-4 h-4" />
                            <span>
                              {isAuditing
                                ? "Auditing Payload..."
                                : lang === "en"
                                  ? "Run Pre-Sign Audit"
                                  : "Jalankan Audit Pra-Sign"}
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
                              className={`px-3.5 py-3 rounded-xl border text-[12px] font-mono uppercase cursor-pointer ${
                                darkMode
                                  ? "border-white/15 hover:border-[#2934FF]"
                                  : "border-black/15 hover:border-[#2934FF]"
                              }`}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </form>

                      {auditError && (
                        <div className="rounded-xl p-3.5 border border-red-500/40 bg-red-500/10 text-red-400 text-[13px] leading-relaxed">
                          {auditError}
                        </div>
                      )}

                      {/* Recently Scanned Strip */}
                      {scannedTokens.length > 0 && (
                        <div
                          className={`pt-4 border-t ${
                            darkMode ? "border-white/10" : "border-black/10"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span
                              className={`text-[11px] font-mono uppercase tracking-[0.08em] ${
                                darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                              }`}
                            >
                              Recently Scanned ({scannedTokens.length})
                            </span>
                            <button
                              type="button"
                              onClick={() => setTechnicalMode("token")}
                              className="text-[11px] font-mono text-[#2934FF] hover:underline cursor-pointer"
                            >
                              View All ↗
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
                                className={`px-2.5 py-1 rounded-lg border text-[11.5px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors ${
                                  darkMode
                                    ? "border-white/10 bg-white/[0.03] hover:border-[#2934FF]"
                                    : "border-black/10 bg-black/[0.02] hover:border-[#2934FF]"
                                }`}
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
                                        ? "text-amber-400"
                                        : "text-emerald-500"
                                  }
                                >
                                  {tok.riskScore}/100
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Compact Address / Tx Signature X-Ray */}
                      <div
                        className={`pt-4 border-t ${
                          darkMode ? "border-white/10" : "border-black/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span
                            className={`text-[11px] font-mono uppercase tracking-[0.08em] ${
                              darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                            }`}
                          >
                            On-Chain Address / Tx X-Ray
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={agentAddress}
                            onChange={(e) => setAgentAddress(e.target.value)}
                            placeholder="Solana Address or 88-char txHash..."
                            className={`flex-1 min-w-0 rounded-xl px-3 py-2 text-[12.5px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                              darkMode
                                ? "bg-[#06080E] border-white/10 text-white placeholder:text-white/35"
                                : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              sendAgentQuery(
                                `Inspect ${agentAddress.trim()} on Solana Mainnet and verify its owner program, transaction status, and safety.`
                              )
                            }
                            disabled={agentLoading || !agentAddress.trim()}
                            className={`px-3.5 py-2 rounded-xl border text-[12px] font-mono font-semibold transition-colors cursor-pointer disabled:opacity-45 shrink-0 ${
                              darkMode
                                ? "border-white/15 bg-white/[0.04] hover:border-[#2934FF] hover:text-white"
                                : "border-black/15 bg-black/[0.03] hover:border-[#2934FF]"
                            }`}
                          >
                            {agentLoading ? "..." : "Scan ↗"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: TOKEN AUDIT INPUTS */}
                  {technicalMode === "token" && (
                    <div className="space-y-5">
                      <div>
                        <h3 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.025em]">
                          {lang === "en" ? "Scan Token CA" : "Cek CA Token"}
                        </h3>
                        <p
                          className={`text-[13.5px] mt-1 leading-relaxed ${
                            darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                          }`}
                        >
                          {lang === "en"
                            ? "Verify Mint & Freeze authorities, Token-2022 transfer hooks, and top holder concentration live on-chain."
                            : "Verifikasi otoritas Mint & Freeze, hook Token-2022, dan konsentrasi top holder langsung on-chain."}
                        </p>
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          runTokenScan();
                        }}
                        className="space-y-3"
                      >
                        <input
                          type="text"
                          value={tokenMintInput}
                          onChange={(e) => setTokenMintInput(e.target.value)}
                          placeholder="Paste Solana Token Mint CA (SPL / Token-2022)"
                          className={`w-full rounded-xl px-3.5 py-3 text-[13px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                            darkMode
                              ? "bg-[#06080E] border-white/15 text-white placeholder:text-white/35"
                              : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                          }`}
                        />
                        <button
                          type="submit"
                          disabled={tokenScanLoading}
                          className="w-full rounded-xl bg-[#2934FF] hover:bg-[#1E27E6] disabled:opacity-50 text-white py-3 px-4 text-[13.5px] font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(41,52,255,0.28)]"
                        >
                          <Search className="w-4 h-4" />
                          <span>
                            {tokenScanLoading
                              ? "Querying On-Chain Mint..."
                              : "Scan Token CA"}
                          </span>
                        </button>
                      </form>

                      {tokenScanError && (
                        <div className="rounded-xl p-3.5 border border-red-500/40 bg-red-500/10 text-red-400 text-[13px] leading-relaxed">
                          {tokenScanError}
                        </div>
                      )}

                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          <span
                            className={`text-[11px] font-mono uppercase tracking-[0.08em] ${
                              darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                            }`}
                          >
                            {lang === "en"
                              ? `Recently Scanned (${scannedTokens.length})`
                              : `Baru Di-Scan (${scannedTokens.length})`}
                          </span>
                          {scannedTokens.length > 0 && (
                            <button
                              type="button"
                              onClick={handleClearLocalScannedTokens}
                              className="text-[11px] font-mono text-[#2934FF] hover:underline cursor-pointer"
                            >
                              Clear Local
                            </button>
                          )}
                        </div>

                        {scannedTokens.length > 0 ? (
                          <div
                            className={`max-h-[300px] overflow-y-auto divide-y rounded-xl border ${
                              darkMode
                                ? "border-white/10 divide-white/10 bg-[#070910]"
                                : "border-black/10 divide-black/10 bg-[#FAF9F6]"
                            }`}
                          >
                            {scannedTokens.slice(0, 12).map((tok) => {
                              const isSelected =
                                tokenScanReport?.mintAddress ===
                                  tok.mintAddress ||
                                tokenMintInput.trim() === tok.mintAddress;
                              return (
                                <button
                                  key={tok.mintAddress}
                                  type="button"
                                  onClick={() => runTokenScan(tok.mintAddress)}
                                  className={`w-full px-3.5 py-2.5 text-left transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                                    isSelected
                                      ? "bg-[#2934FF] text-white"
                                      : darkMode
                                        ? "hover:bg-white/[0.04]"
                                        : "hover:bg-black/[0.04]"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[13.5px] font-mono font-semibold truncate">
                                        {tok.symbol
                                          ? `$${tok.symbol}`
                                          : `${tok.mintAddress.slice(0, 5)}...${tok.mintAddress.slice(-4)}`}
                                      </span>
                                      {tok.verifiedIssuer && (
                                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-400">
                                          {tok.verifiedIssuer}
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      className={`text-[11px] font-mono truncate ${
                                        isSelected ? "text-white/80" : "opacity-60"
                                      }`}
                                    >
                                      {tok.mintAddress.slice(0, 6)}...
                                      {tok.mintAddress.slice(-4)} ·{" "}
                                      {tok.tokenProgram}
                                    </div>
                                  </div>
                                  <span
                                    className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border shrink-0 ${
                                      isSelected
                                        ? "border-white/40 text-white"
                                        : tok.classification === "CRITICAL"
                                          ? "border-red-500/40 text-red-400"
                                          : tok.classification === "CAUTION"
                                            ? "border-amber-500/40 text-amber-400"
                                            : "border-emerald-500/40 text-emerald-500"
                                    }`}
                                  >
                                    {tok.riskScore}/100
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            className={`rounded-xl p-4 border border-dashed text-[13px] space-y-2 ${
                              darkMode
                                ? "border-white/15 text-[#8E98AD]"
                                : "border-black/15 text-[#575653]"
                            }`}
                          >
                            <p>
                              {scannedTokensLoading
                                ? "Loading audited tokens..."
                                : "Paste any Solana Token Mint CA above to run a live on-chain audit."}
                            </p>
                            <Link
                              href="/buildcheck"
                              className="inline-flex items-center gap-1 text-[12px] font-mono text-[#2934FF] hover:underline"
                            >
                              <span>Open Full BuildCheck AI Forensics ↗</span>
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 3: INTENT COPILOT INPUTS */}
                  {technicalMode === "intent" && (
                    <div id="intent-copilot" className="space-y-5">
                      <div>
                        <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold mb-1.5">
                          <span>/API/INTENT · VENICE AI + JUPITER V1</span>
                        </div>
                        <h3 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.025em]">
                          Plain-English to Guarded Tx
                        </h3>
                        <p
                          className={`text-[13.5px] mt-1 leading-relaxed ${
                            darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                          }`}
                        >
                          Describe your swap in plain English. Venice AI parses
                          your intent and validates it against your Anchor{" "}
                          <code className="font-mono text-[12.5px]">
                            SecurityPolicy
                          </code>{" "}
                          PDA before routing via Jupiter.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <textarea
                          value={intentPrompt}
                          onChange={(e) => setIntentPrompt(e.target.value)}
                          rows={4}
                          className={`w-full rounded-xl p-3.5 text-[13.5px] font-mono border focus:border-[#2934FF] focus:outline-none leading-relaxed ${
                            darkMode
                              ? "bg-[#06080E] border-white/15 text-white placeholder:text-white/35"
                              : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                          }`}
                          placeholder="e.g. Swap 0.5 SOL to USDC on Jupiter with max 0.5% slippage..."
                        />

                        {!connectedWallet && (
                          <input
                            type="text"
                            value={manualVaultOwner}
                            onChange={(e) => setManualVaultOwner(e.target.value)}
                            placeholder="Optional Wallet Pubkey (read-only unsigned preview)"
                            className={`w-full rounded-xl px-3.5 py-2.5 text-[12.5px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                              darkMode
                                ? "bg-[#06080E] border-white/10 text-white placeholder:text-white/35"
                                : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                            }`}
                          />
                        )}

                        <button
                          type="button"
                          onClick={() => runIntentCopilot()}
                          disabled={intentLoading || !intentPrompt.trim()}
                          className="w-full rounded-xl bg-[#2934FF] hover:bg-[#1E27E6] disabled:opacity-50 text-white py-3 px-4 text-[13.5px] font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-[0_8px_24px_rgba(41,52,255,0.28)]"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>
                            {intentLoading
                              ? "Building Guarded Swap..."
                              : "Compile Guarded Intent"}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* TAB 4: ANCHOR POLICY VAULT CONTROLS */}
                  {technicalMode === "vault" && (
                    <div id="policy-vault" className="space-y-5">
                      <div>
                        <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold mb-1.5">
                          <span>
                            {vaultStatus?.programDeployedOnMainnet
                              ? "SOLANA MAINNET · ANCHOR V0.30.1"
                              : "DEVNET BETA · ANCHOR V0.30.1"}
                          </span>
                        </div>
                        <h3 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.025em]">
                          On-Chain Spending Guardrails
                        </h3>
                        <p
                          className={`text-[13.5px] mt-1 leading-relaxed ${
                            darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                          }`}
                        >
                          Configure rolling 24h spend caps, maximum Venice risk
                          thresholds, and a 1-click Emergency Circuit Breaker on
                          your per-wallet{" "}
                          <code className="font-mono text-[12.5px]">
                            SecurityPolicy
                          </code>{" "}
                          PDA.
                        </p>
                      </div>

                      <div className="space-y-3">
                        {!connectedWallet && (
                          <input
                            type="text"
                            value={manualVaultOwner}
                            onChange={(e) => setManualVaultOwner(e.target.value)}
                            placeholder="Optional Owner Pubkey (if wallet not connected)"
                            className={`w-full rounded-xl px-3.5 py-2.5 text-[12.5px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                              darkMode
                                ? "bg-[#06080E] border-white/15 text-white placeholder:text-white/35"
                                : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                            }`}
                          />
                        )}
                        <input
                          type="text"
                          value={revokeMintInput}
                          onChange={(e) => setRevokeMintInput(e.target.value)}
                          placeholder="Optional Token Mint CA for Tag-5 Delegate Revoke (defaults to USDC)"
                          className={`w-full rounded-xl px-3.5 py-2.5 text-[12.5px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                            darkMode
                              ? "bg-[#06080E] border-white/15 text-white placeholder:text-white/35"
                              : "bg-[#FAF9F6] border-black/15 text-[#141413] placeholder:text-black/40"
                          }`}
                        />

                        {/* Max Daily Spend Slider */}
                        <div
                          className={`rounded-xl p-4 border ${
                            darkMode
                              ? "bg-[#070910] border-white/10"
                              : "bg-[#FAF9F6] border-black/10"
                          }`}
                        >
                          <div className="flex justify-between gap-2 text-[12px] font-mono mb-2.5">
                            <span className="opacity-75">
                              MAX DAILY SPEND (24H)
                            </span>
                            <span className="font-semibold text-[#2934FF]">
                              {maxDailySol.toFixed(1)} SOL
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.5}
                            max={20}
                            step={0.5}
                            value={maxDailySol}
                            onChange={(e) =>
                              setMaxDailySol(Number(e.target.value))
                            }
                            className="w-full accent-[#2934FF] cursor-pointer"
                          />
                        </div>

                        {/* Max Risk Score Slider */}
                        <div
                          className={`rounded-xl p-4 border ${
                            darkMode
                              ? "bg-[#070910] border-white/10"
                              : "bg-[#FAF9F6] border-black/10"
                          }`}
                        >
                          <div className="flex justify-between gap-2 text-[12px] font-mono mb-2.5">
                            <span className="opacity-75">
                              MAX VENICE RISK SCORE
                            </span>
                            <span className="font-semibold text-[#2934FF]">
                              {maxAllowedRisk} / 100
                            </span>
                          </div>
                          <input
                            type="range"
                            min={10}
                            max={80}
                            step={5}
                            value={maxAllowedRisk}
                            onChange={(e) =>
                              setMaxAllowedRisk(Number(e.target.value))
                            }
                            className="w-full accent-[#2934FF] cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 5: BLINKS STUDIO INPUTS */}
                  {technicalMode === "blinks" && (
                    <div id="blinks-studio" className="space-y-5">
                      <div>
                        <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.1em] text-emerald-500 font-semibold mb-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>ACTIONS.JSON READY · /API/ACTIONS/AUDIT-SWAP</span>
                        </div>
                        <h3 className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.025em]">
                          Shareable Guarded Blink
                        </h3>
                        <p
                          className={`text-[13.5px] mt-1 leading-relaxed ${
                            darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                          }`}
                        >
                          Generate a spec-compliant Solana Action URL that runs
                          a Venice AI pre-flight security check before returning
                          a swap payload to X/Twitter Blinks.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label
                            className={`text-[11px] font-mono uppercase tracking-[0.08em] block mb-1.5 ${
                              darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                            }`}
                          >
                            Custom Swap Amount (SOL)
                          </label>
                          <input
                            type="number"
                            min="0.001"
                            step="0.1"
                            value={selectedBlinkSol}
                            onChange={(e) =>
                              setSelectedBlinkSol(e.target.value)
                            }
                            placeholder="0.5"
                            className={`w-full rounded-xl px-3.5 py-3 text-[14px] font-mono border focus:border-[#2934FF] focus:outline-none ${
                              darkMode
                                ? "bg-[#06080E] border-white/15 text-white"
                                : "bg-[#FAF9F6] border-black/15 text-[#141413]"
                            }`}
                          />
                        </div>

                        <button
                          type="button"
                          disabled={!selectedBlinkSol.trim()}
                          onClick={() => {
                            const actionUrl =
                              getLiveAuditSwapBlinkUrl(selectedBlinkSol);
                            setTechnicalMode("payload");
                            setPayloadInputMode("blink");
                            setTxPayloadInput(actionUrl);
                            runPayloadAudit({
                              mode: "blink",
                              payload: actionUrl,
                            });
                          }}
                          className="w-full rounded-xl py-3 px-4 bg-[#2934FF] hover:bg-[#1E27E6] disabled:opacity-50 text-white text-[13.5px] font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-[0_8px_24px_rgba(41,52,255,0.28)]"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>Inspect Blink in Firewall ↗</span>
                        </button>

                        <button
                          type="button"
                          disabled={!selectedBlinkSol.trim()}
                          onClick={() => {
                            const amt = encodeURIComponent(
                              selectedBlinkSol.trim()
                            );
                            const actionUrl = `solana-action:${window.location.origin}/api/actions/audit-swap?amount=${amt}`;
                            navigator.clipboard.writeText(actionUrl);
                            setCopiedBlinkUrl(true);
                            setTimeout(() => setCopiedBlinkUrl(false), 2000);
                          }}
                          className={`w-full rounded-xl py-3 px-4 border text-[13px] font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                            darkMode
                              ? "border-white/15 hover:border-[#2934FF] text-[#E4E7EE]"
                              : "border-black/15 hover:border-[#2934FF] text-[#141413]"
                          }`}
                        >
                          {copiedBlinkUrl ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-500" />
                              <span>Copied solana-action: URL</span>
                            </>
                          ) : (
                            <>
                              <Share2 className="w-4 h-4" />
                              <span>Copy Blink Action URL</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ------------------------------------------------------------
                    RIGHT PANE (7 COLS) — COHESIVE LIVE VERDICT & AI BAR
                    ------------------------------------------------------------ */}
                <div
                  className={`lg:col-span-7 p-5 sm:p-6 flex flex-col justify-between gap-4 ${
                    darkMode ? "bg-[#0D111C]" : "bg-[#F7F6F2]"
                  }`}
                >
                  {/* RIGHT PANE: TX FIREWALL VERDICT */}
                  {technicalMode === "payload" && (
                    <div className="space-y-4">
                      {/* Sculptural Verdict Header + Actions (Zero Overlap) */}
                      <div
                        className={`pb-4 border-b flex flex-wrap items-center justify-between gap-3 ${
                          darkMode ? "border-white/10" : "border-black/10"
                        }`}
                      >
                        <div className="flex items-baseline gap-4 flex-wrap">
                          <div>
                            <div
                              className={`text-[11px] font-mono uppercase tracking-[0.1em] ${
                                darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                              }`}
                            >
                              Pre-Sign Risk Score
                            </div>
                            <div className="text-[44px] sm:text-[52px] font-semibold tracking-[-0.04em] leading-none mt-1 font-mono">
                              {isAuditing ? (
                                <span className="opacity-40">··</span>
                              ) : auditResult ? (
                                auditResult.riskScore
                              ) : (
                                <span className="opacity-30">—</span>
                              )}
                              <span
                                className={`text-[18px] font-normal ml-1 ${
                                  darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                                }`}
                              >
                                /100
                              </span>
                            </div>
                          </div>

                          <span
                            className={`px-3 py-1.5 rounded-full border text-[11.5px] font-mono font-semibold uppercase tracking-[0.06em] ${
                              emergencyLocked
                                ? "border-red-500/50 bg-red-500/15 text-red-400"
                                : isAuditing
                                  ? "border-[#2934FF]/50 bg-[#2934FF]/15 text-[#6B78FF]"
                                  : !hasActiveTxAudit
                                    ? darkMode
                                      ? "border-white/15 bg-white/[0.04] text-[#9EA8BA]"
                                      : "border-black/15 bg-black/[0.04] text-[#575653]"
                                    : isCritical
                                      ? "border-red-500/50 bg-red-500/15 text-red-400"
                                      : "border-emerald-500/45 bg-emerald-500/15 text-emerald-500"
                            }`}
                          >
                            {emergencyLocked
                              ? "Vault Locked"
                              : isAuditing
                                ? "Auditing..."
                                : !hasActiveTxAudit
                                  ? "Standby"
                                  : isCritical
                                    ? "Threat Detected"
                                    : "Safe to Sign"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {hasActiveTxAudit && (
                            <button
                              type="button"
                              onClick={handleExportAuditProof}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11.5px] font-mono transition-colors cursor-pointer ${
                                darkMode
                                  ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF]"
                                  : "border-black/15 bg-white hover:border-[#2934FF]"
                              }`}
                            >
                              <Download className="w-3.5 h-3.5 text-[#2934FF]" />
                              <span>Export JSON</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isAuditing || !txPayloadInput.trim()}
                            onClick={() => runPayloadAudit()}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11.5px] font-mono transition-colors cursor-pointer disabled:opacity-40 ${
                              darkMode
                                ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF]"
                                : "border-black/15 bg-white hover:border-[#2934FF]"
                            }`}
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                isAuditing ? "animate-spin" : ""
                              }`}
                            />
                            <span>Re-Audit</span>
                          </button>
                        </div>
                      </div>

                      {/* Visual Asset Flow Graphic (Leaving -> SolShield -> Entering) */}
                      <div
                        className={`rounded-xl border p-4 sm:p-5 ${
                          darkMode
                            ? "bg-[#080B13] border-white/10"
                            : "bg-white border-black/10"
                        }`}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
                          <div
                            className={`rounded-xl border px-3.5 py-3 ${
                              darkMode
                                ? "bg-white/[0.02] border-white/10"
                                : "bg-[#FAF9F6] border-black/10"
                            }`}
                          >
                            <div
                              className={`text-[10.5px] font-mono uppercase tracking-[0.1em] ${
                                darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                              }`}
                            >
                              Leaving Wallet
                            </div>
                            <div className="font-mono text-[14px] font-semibold mt-1 text-rose-400 truncate">
                              {rpcSimulationReport?.status === "SIMULATED_OK" &&
                              rpcSimulationReport.balanceDiffs.some(
                                (d) => d.direction === "OUT"
                              )
                                ? rpcSimulationReport.balanceDiffs
                                    .filter((d) => d.direction === "OUT")
                                    .slice(0, 2)
                                    .map((d) => `${d.deltaUiAmount} ${d.asset}`)
                                    .join(" · ")
                                : hasActiveTxAudit
                                  ? "0 Direct Outflows"
                                  : "Awaiting Simulation"}
                            </div>
                          </div>

                          <div className="flex items-center justify-center gap-2 py-1">
                            <ArrowRight className="w-4 h-4 opacity-40 hidden sm:block" />
                            <div
                              className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                                isCritical
                                  ? "border-red-500/50 bg-red-500/15 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.28)]"
                                  : "border-[#2934FF]/50 bg-[#2934FF]/15 text-[#6B78FF] shadow-[0_0_20px_rgba(41,52,255,0.28)]"
                              }`}
                            >
                              <Shield className="w-5 h-5" />
                            </div>
                            <ArrowRight className="w-4 h-4 opacity-40 hidden sm:block" />
                          </div>

                          <div
                            className={`rounded-xl border px-3.5 py-3 ${
                              darkMode
                                ? "bg-white/[0.02] border-white/10"
                                : "bg-[#FAF9F6] border-black/10"
                            }`}
                          >
                            <div
                              className={`text-[10.5px] font-mono uppercase tracking-[0.1em] ${
                                darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                              }`}
                            >
                              Entering Wallet
                            </div>
                            <div className="font-mono text-[14px] font-semibold mt-1 text-emerald-500 truncate">
                              {rpcSimulationReport?.status === "SIMULATED_OK" &&
                              rpcSimulationReport.balanceDiffs.some(
                                (d) => d.direction === "IN"
                              )
                                ? rpcSimulationReport.balanceDiffs
                                    .filter((d) => d.direction === "IN")
                                    .slice(0, 2)
                                    .map((d) => `+${d.deltaUiAmount} ${d.asset}`)
                                    .join(" · ")
                                : hasActiveTxAudit
                                  ? "Verified Route Checked"
                                  : "Verified Output Preview"}
                            </div>
                          </div>
                        </div>

                        {/* Executive Summary */}
                        <p className="mt-3.5 text-[13.5px] leading-relaxed">
                          {isAuditing
                            ? "Decompiling instructions, simulating on-chain RPC balance deltas, and running zero-retention Venice AI scoring..."
                            : auditResult?.executiveSummary ||
                              "Submit a Base64 Solana transaction or click 'Live 0.5 SOL Jupiter Blink' on the left to run live bytecode & Venice AI risk inspection."}
                        </p>

                        {/* 3-Stage Readiness Pipeline (Standby State — Fills Void Cleanly) */}
                        {!hasActiveTxAudit && !isAuditing && (
                          <div
                            className={`mt-3.5 pt-3 border-t grid grid-cols-1 sm:grid-cols-3 gap-2 ${
                              darkMode ? "border-white/10" : "border-black/10"
                            }`}
                          >
                            {[
                              {
                                step: "01",
                                title: "Bytecode Decoder",
                                sub: "Legacy & V0 + Hooks",
                              },
                              {
                                step: "02",
                                title: "RPC Balance Diff",
                                sub: "Pre-Sign Outflow Sim",
                              },
                              {
                                step: "03",
                                title: "Venice Zero-Log",
                                sub: "llama-3.3-70b Score",
                              },
                            ].map((item) => (
                              <div
                                key={item.step}
                                className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 ${
                                  darkMode
                                    ? "bg-white/[0.02] border-white/10"
                                    : "bg-[#FAF9F6] border-black/10"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="text-[11.5px] font-semibold truncate">
                                    <span className="font-mono text-[#2934FF] mr-1">
                                      {item.step}
                                    </span>
                                    {item.title}
                                  </div>
                                  <div
                                    className={`text-[10.5px] font-mono truncate ${
                                      darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                                    }`}
                                  >
                                    {item.sub}
                                  </div>
                                </div>
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Clean Hairline Diagnostics (When Active) */}
                        {hasActiveTxAudit && (
                          <div
                            className={`mt-4 pt-3.5 border-t grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[12px] font-mono ${
                              darkMode ? "border-white/10" : "border-black/10"
                            }`}
                          >
                            <div>
                              <span className="opacity-55 block text-[10.5px]">
                                INSTRUCTIONS
                              </span>
                              <span className="font-semibold text-[#6B78FF]">
                                {simulationReport?.instructions.length ?? 0} IX
                                Calls
                              </span>
                            </div>
                            <div>
                              <span className="opacity-55 block text-[10.5px]">
                                ANCHOR PDA GUARD
                              </span>
                              <span
                                className={
                                  auditResult?.policyGuardVerdict
                                    ?.passesPolicy === false || emergencyLocked
                                    ? "text-red-400 font-semibold"
                                    : "text-emerald-500 font-semibold"
                                }
                              >
                                {emergencyLocked
                                  ? "LOCKED"
                                  : auditResult?.policyGuardVerdict
                                        ?.passesPolicy === false
                                    ? "BLOCKED"
                                    : "PASS (Within Policy)"}
                              </span>
                            </div>
                            <div>
                              <span className="opacity-55 block text-[10.5px]">
                                VENICE ENGINE
                              </span>
                              <span className="text-emerald-500">
                                {auditResult?.inferenceMode ===
                                "venice-live-api"
                                  ? "Live Zero-Log LLM"
                                  : "Pre-Filter Ready"}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Detected Token Mints inside Payload */}
                        {rpcSimulationReport?.tokenAudits &&
                          rpcSimulationReport.tokenAudits.length > 0 && (
                            <div
                              className={`mt-3.5 pt-3 border-t flex flex-wrap items-center gap-2 ${
                                darkMode ? "border-white/10" : "border-black/10"
                              }`}
                            >
                              <span className="text-[11px] font-mono opacity-60">
                                Detected Tokens:
                              </span>
                              {rpcSimulationReport.tokenAudits.map((ta) => (
                                <button
                                  key={ta.mintAddress}
                                  type="button"
                                  onClick={() => {
                                    setTokenScanReport(ta);
                                    setTokenMintInput(ta.mintAddress);
                                    setTechnicalMode("token");
                                  }}
                                  className={`px-2.5 py-1 rounded-lg border text-[11.5px] font-mono flex items-center gap-1.5 cursor-pointer ${
                                    darkMode
                                      ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF]"
                                      : "border-black/15 bg-[#FAF9F6] hover:border-[#2934FF]"
                                  }`}
                                >
                                  <span className="font-semibold">
                                    {ta.symbol
                                      ? `$${ta.symbol}`
                                      : `${ta.mintAddress.slice(0, 5)}..${ta.mintAddress.slice(-4)}`}
                                  </span>
                                  <span className="text-emerald-500">
                                    {ta.riskScore}/100
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                      </div>

                      {/* Approve / Block / Tag-5 Revoke Controls */}
                      <div className="space-y-2.5">
                        {hasActiveTxAudit &&
                          (walletStatus === "PENDING" ? (
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                type="button"
                                onClick={() => setWalletStatus("BLOCKED")}
                                className={`py-2.5 px-4 rounded-xl border text-[13px] font-semibold transition-colors cursor-pointer ${
                                  darkMode
                                    ? "border-white/15 bg-white/[0.04] hover:bg-white/10 text-white"
                                    : "border-black/15 bg-black text-white hover:bg-neutral-800"
                                }`}
                              >
                                {isCritical ? "Block Payload" : "Reject"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setWalletStatus(
                                    emergencyLocked ? "BLOCKED" : "SIGNED"
                                  )
                                }
                                className={`py-2.5 px-4 rounded-xl text-white text-[13px] font-semibold transition-colors cursor-pointer ${
                                  isCritical
                                    ? "bg-red-600 hover:bg-red-700"
                                    : "bg-[#2934FF] hover:bg-[#1E27E6]"
                                }`}
                              >
                                {emergencyLocked
                                  ? "Locked by PDA"
                                  : isCritical
                                    ? "Simulate Override"
                                    : "Approve Payload"}
                              </button>
                            </div>
                          ) : (
                            <div
                              className={`p-3.5 rounded-xl border flex items-center justify-between text-[12.5px] font-mono ${
                                darkMode
                                  ? "bg-[#080B13] border-white/15"
                                  : "bg-white border-black/15"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                <span>
                                  {walletStatus === "BLOCKED"
                                    ? "PAYLOAD INTERCEPTED & BLOCKED"
                                    : walletStatus === "REVOKED"
                                      ? "SPL DELEGATE REVOKED (TAG 5)"
                                      : "SANDBOX DECISION LOGGED"}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setWalletStatus("PENDING")}
                                className="text-[#2934FF] hover:underline cursor-pointer"
                              >
                                Reset
                              </button>
                            </div>
                          ))}

                        <button
                          type="button"
                          onClick={handleRevokeSplDelegate}
                          className={`w-full py-2.5 px-4 rounded-xl border text-[12.5px] font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                            darkMode
                              ? "border-white/15 hover:border-[#2934FF] text-[#CBD5E1]"
                              : "border-black/15 hover:border-[#2934FF] text-[#141413]"
                          }`}
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-[#2934FF]" />
                          <span>Build SPL Token Delegate Revoke Tx (Tag 5)</span>
                        </button>

                        {walletStatus === "REVOKED" && revokeArtifact && (
                          <div
                            className={`p-3 rounded-xl border text-[11.5px] font-mono break-all ${
                              darkMode
                                ? "bg-[#070910] border-emerald-500/35 text-emerald-400"
                                : "bg-emerald-50 border-emerald-300 text-emerald-900"
                            }`}
                          >
                            TAG_5_REVOKE_IX (0x{revokeArtifact.discriminatorHex}
                            ) · {revokeArtifact.accountCount} accounts ·{" "}
                            {revokeArtifact.transactionBase64.slice(0, 56)}...
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* RIGHT PANE: TOKEN AUDIT REPORT */}
                  {technicalMode === "token" && (
                    <div className="space-y-5">
                      <div
                        className={`pb-5 border-b flex flex-wrap items-center justify-between gap-4 ${
                          darkMode ? "border-white/10" : "border-black/10"
                        }`}
                      >
                        <div className="flex items-baseline gap-4 flex-wrap">
                          <div>
                            <div
                              className={`text-[11px] font-mono uppercase tracking-[0.1em] ${
                                darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                              }`}
                            >
                              {tokenScanReport?.symbol
                                ? `$${tokenScanReport.symbol} Risk Score`
                                : "Token Audit Risk Score"}
                            </div>
                            <div className="text-[44px] sm:text-[52px] font-semibold tracking-[-0.04em] leading-none mt-1 font-mono">
                              {tokenScanLoading ? (
                                <span className="opacity-40">··</span>
                              ) : tokenScanReport ? (
                                tokenScanReport.riskScore
                              ) : (
                                <span className="opacity-30">—</span>
                              )}
                              <span
                                className={`text-[18px] font-normal ml-1 ${
                                  darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                                }`}
                              >
                                /100
                              </span>
                            </div>
                          </div>

                          <span
                            className={`px-3 py-1.5 rounded-full border text-[11.5px] font-mono font-semibold uppercase tracking-[0.06em] ${
                              tokenScanLoading
                                ? "border-[#2934FF]/50 bg-[#2934FF]/15 text-[#6B78FF]"
                                : !tokenScanReport
                                  ? darkMode
                                    ? "border-white/15 bg-white/[0.04] text-[#9EA8BA]"
                                    : "border-black/15 bg-black/[0.04] text-[#575653]"
                                  : tokenScanReport.classification ===
                                      "CRITICAL"
                                    ? "border-red-500/50 bg-red-500/15 text-red-400"
                                    : tokenScanReport.classification ===
                                        "CAUTION"
                                      ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
                                      : "border-emerald-500/45 bg-emerald-500/15 text-emerald-500"
                            }`}
                          >
                            {tokenScanLoading
                              ? "Scanning..."
                              : !tokenScanReport
                                ? "Standby"
                                : tokenScanReport.classification === "CRITICAL"
                                  ? "High Rug Risk"
                                  : tokenScanReport.classification === "CAUTION"
                                    ? "DYOR Caution"
                                    : "Verified Safe"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {tokenScanReport && (
                            <button
                              type="button"
                              onClick={handleExportTokenProof}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11.5px] font-mono cursor-pointer ${
                                darkMode
                                  ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF]"
                                  : "border-black/15 bg-white hover:border-[#2934FF]"
                              }`}
                            >
                              <Download className="w-3.5 h-3.5 text-[#2934FF]" />
                              <span>Export JSON</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={tokenScanLoading || !tokenMintInput.trim()}
                            onClick={() => runTokenScan()}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11.5px] font-mono cursor-pointer disabled:opacity-40 ${
                              darkMode
                                ? "border-white/15 bg-white/[0.03] hover:border-[#2934FF]"
                                : "border-black/15 bg-white hover:border-[#2934FF]"
                            }`}
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                tokenScanLoading ? "animate-spin" : ""
                              }`}
                            />
                            <span>Re-Scan</span>
                          </button>
                        </div>
                      </div>

                      {!tokenScanReport ? (
                        <div
                          className={`rounded-xl border divide-y text-[13.5px] ${
                            darkMode
                              ? "bg-[#080B13] border-white/10 divide-white/10"
                              : "bg-white border-black/10 divide-black/10"
                          }`}
                        >
                          {[
                            "Mint & Freeze Authority Revocation Check",
                            "Token-2022 PermanentDelegate & Transfer Hooks",
                            "Top 5 / Top 10 Holder Concentration Analysis",
                          ].map((item) => (
                            <div
                              key={item}
                              className="px-4 py-3.5 flex items-center justify-between gap-3"
                            >
                              <span>{item}</span>
                              <span className="font-mono text-[11px] opacity-55">
                                READY
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div
                            className={`rounded-xl border divide-y text-[13.5px] ${
                              darkMode
                                ? "bg-[#080B13] border-white/10 divide-white/10"
                                : "bg-white border-black/10 divide-black/10"
                            }`}
                          >
                            {[
                              {
                                label: "Mint Authority",
                                value: tokenScanReport.mintAuthority
                                  ? `${tokenScanReport.mintAuthority.slice(0, 6)}...${tokenScanReport.mintAuthority.slice(-4)}`
                                  : "Revoked (Fixed Supply)",
                                ok: !tokenScanReport.mintAuthority,
                              },
                              {
                                label: "Freeze Authority",
                                value: tokenScanReport.freezeAuthority
                                  ? `${tokenScanReport.freezeAuthority.slice(0, 6)}...${tokenScanReport.freezeAuthority.slice(-4)}`
                                  : "Revoked (Cannot Blacklist)",
                                ok: !tokenScanReport.freezeAuthority,
                              },
                              {
                                label: "Token-2022 Extensions",
                                value: !tokenScanReport.isToken2022
                                  ? "Clean Standard SPL"
                                  : tokenScanReport.extensions.join(", ") ||
                                    "Token-2022 Base Mint",
                                ok:
                                  !tokenScanReport.permanentDelegate &&
                                  !tokenScanReport.transferHookProgramId,
                              },
                              {
                                label: "Top Holder Concentration",
                                value:
                                  tokenScanReport.topHolders.length > 0
                                    ? `Top 5: ${tokenScanReport.top5Pct}% · Top 10: ${tokenScanReport.top10Pct}%`
                                    : "Inspect on Solscan",
                                ok: tokenScanReport.top5Pct < 55,
                              },
                            ].map((row) => (
                              <div
                                key={row.label}
                                className="px-4 py-3 flex items-center justify-between gap-3"
                              >
                                <span className="opacity-75">{row.label}</span>
                                <span
                                  className={`font-mono text-[12.5px] font-medium flex items-center gap-1.5 ${
                                    row.ok ? "text-emerald-500" : "text-amber-400"
                                  }`}
                                >
                                  {row.ok ? (
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  )}
                                  <span>{row.value}</span>
                                </span>
                              </div>
                            ))}
                          </div>

                          <p className="text-[13.5px] leading-relaxed opacity-90">
                            {tokenScanReport.executiveSummary}
                          </p>

                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/buildcheck?target=${encodeURIComponent(tokenScanReport.mintAddress)}`}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2934FF] hover:bg-[#1E27E6] text-white text-[12px] font-semibold transition-colors"
                            >
                              <span>Deep BuildCheck AI Audit</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </Link>
                            <a
                              href={`https://solscan.io/token/${tokenScanReport.mintAddress}`}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-[12px] font-mono ${
                                darkMode
                                  ? "border-white/15 hover:border-[#2934FF]"
                                  : "border-black/15 hover:border-[#2934FF]"
                              }`}
                            >
                              <span>Solscan</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <a
                              href={`https://jup.ag/tokens/${tokenScanReport.mintAddress}`}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-[12px] font-mono ${
                                darkMode
                                  ? "border-white/15 hover:border-[#2934FF]"
                                  : "border-black/15 hover:border-[#2934FF]"
                              }`}
                            >
                              <span>Jupiter</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  tokenScanReport.mintAddress
                                );
                                setCopiedMint(true);
                                setTimeout(() => setCopiedMint(false), 1800);
                              }}
                              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-[12px] font-mono cursor-pointer ${
                                darkMode
                                  ? "border-white/15 hover:border-[#2934FF]"
                                  : "border-black/15 hover:border-[#2934FF]"
                              }`}
                            >
                              {copiedMint ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>{copiedMint ? "Copied" : "Copy CA"}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* RIGHT PANE: INTENT COPILOT OUTPUT */}
                  {technicalMode === "intent" && (
                    <div className="space-y-4">
                      <div
                        className={`pb-4 border-b flex items-center justify-between gap-3 ${
                          darkMode ? "border-white/10" : "border-black/10"
                        }`}
                      >
                        <div>
                          <div className="text-[11px] font-mono uppercase tracking-[0.1em] text-[#2934FF] font-semibold">
                            Compiled Intent &amp; Jupiter Quote
                          </div>
                          <h4 className="text-[20px] font-semibold tracking-[-0.02em] mt-0.5">
                            {intentResponse
                              ? `${intentResponse.intent.action.toUpperCase()} ${intentResponse.intent.amount} ${intentResponse.intent.inputToken} → ${intentResponse.intent.outputToken}`
                              : "Awaiting Natural-Language Intent"}
                          </h4>
                        </div>
                      </div>

                      {intentResponse ? (
                        <div
                          className={`rounded-xl border divide-y text-[13px] font-mono ${
                            darkMode
                              ? "bg-[#080B13] border-white/10 divide-white/10"
                              : "bg-white border-black/10 divide-black/10"
                          }`}
                        >
                          <div className="px-4 py-3 flex justify-between gap-3">
                            <span className="opacity-65">QUOTED OUTPUT</span>
                            <span className="text-emerald-500 font-semibold text-right">
                              {intentResponse.quote?.quoteMode ===
                                "jupiter-v1-live" &&
                              intentResponse.quote.outAmountUi !== null
                                ? `${intentResponse.quote.outAmountUi.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${intentResponse.intent.outputToken}`
                                : `Unavailable (${intentResponse.quote?.error ?? "offline"})`}
                            </span>
                          </div>
                          <div className="px-4 py-3 flex justify-between gap-3">
                            <span className="opacity-65">MAX SLIPPAGE</span>
                            <span>{intentResponse.intent.maxSlippageBps} BPS</span>
                          </div>
                          <div className="px-4 py-3 flex justify-between gap-3">
                            <span className="opacity-65">PDA POLICY CHECK</span>
                            <span
                              className={
                                (intentResponse.intent.inputToken === "SOL" &&
                                  intentResponse.intent.amount > maxDailySol) ||
                                emergencyLocked ||
                                !intentResponse.veniceAudit.policyGuardVerdict
                                  .passesPolicy
                                  ? "text-red-400 font-semibold"
                                  : "text-emerald-500 font-semibold"
                              }
                            >
                              {emergencyLocked
                                ? "BLOCKED (EmergencyLock)"
                                : intentResponse.intent.inputToken === "SOL" &&
                                    intentResponse.intent.amount > maxDailySol
                                  ? `BLOCKED (> ${maxDailySol} SOL Cap)`
                                  : !intentResponse.veniceAudit
                                        .policyGuardVerdict.passesPolicy
                                    ? "BLOCKED BY POLICY"
                                    : "APPROVED BY PDA"}
                            </span>
                          </div>
                          <div className="px-4 py-3 font-sans text-[13.5px] leading-relaxed opacity-85">
                            {intentResponse.intent.explanation}
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`rounded-xl border p-5 text-[13.5px] leading-relaxed ${
                            darkMode
                              ? "bg-[#080B13] border-white/10 text-[#8E98AD]"
                              : "bg-white border-black/10 text-[#575653]"
                          }`}
                        >
                          Enter any Solana DeFi swap instruction on the left and
                          click <strong>Compile Guarded Intent</strong> to fetch
                          a live Jupiter v1 quote checked against your on-chain
                          spending limits.
                        </div>
                      )}
                    </div>
                  )}

                  {/* RIGHT PANE: ANCHOR POLICY VAULT STATE & EMERGENCY FREEZE */}
                  {technicalMode === "vault" && (
                    <div className="space-y-4">
                      <div
                        className={`rounded-xl border p-4 sm:p-5 font-mono text-[12.5px] space-y-2.5 ${
                          darkMode
                            ? "bg-[#080B13] border-white/10"
                            : "bg-white border-black/10"
                        }`}
                      >
                        <div className="flex justify-between items-center gap-2">
                          <span className="opacity-60">WALLET_OWNER</span>
                          {effectiveVaultOwner ? (
                            <span>
                              {effectiveVaultOwner.slice(0, 8)}...
                              {effectiveVaultOwner.slice(-6)}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={connectBrowserWallet}
                              className="text-[#2934FF] hover:underline cursor-pointer"
                            >
                              Connect Wallet ↗
                            </button>
                          )}
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="opacity-60">POLICY_PDA</span>
                          {derivedPdaAddress || vaultStatus?.policyPda ? (
                            <a
                              href={`https://explorer.solana.com/address/${
                                derivedPdaAddress || vaultStatus?.policyPda
                              }${vaultStatus?.cluster === "mainnet" ? "" : "?cluster=devnet"}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-500 hover:underline"
                            >
                              {(
                                derivedPdaAddress ||
                                vaultStatus?.policyPda ||
                                ""
                              ).slice(0, 10)}
                              ...
                              {(
                                derivedPdaAddress ||
                                vaultStatus?.policyPda ||
                                ""
                              ).slice(-6)}{" "}
                              ↗
                            </a>
                          ) : (
                            <span className="opacity-60">Checking RPC...</span>
                          )}
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <span className="opacity-60">PDA_STATE</span>
                          <span className="text-emerald-500 text-right">
                            {vaultStatus?.policyState
                              ? `Active · ${(vaultStatus.policyState.maxDailySpendLamports / 1e9).toFixed(1)} SOL/24h`
                              : `Ready (${vaultStatus?.cluster === "mainnet" ? "Mainnet" : "Devnet Beta"})`}
                          </span>
                        </div>
                        <div
                          className={`flex justify-between items-center gap-2 pt-2 border-t ${
                            darkMode ? "border-white/10" : "border-black/10"
                          }`}
                        >
                          <span className="opacity-60">VAULT_PROGRAM</span>
                          <a
                            href={
                              vaultStatus?.programDeployedOnMainnet
                                ? TOKEN_CONFIG.links.mainnetProgram
                                : TOKEN_CONFIG.links.devnetProgram
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#2934FF] hover:underline"
                          >
                            {vaultStatus
                              ? `${vaultStatus.programId.slice(0, 6)}..${vaultStatus.programId.slice(-4)} ↗`
                              : "Checking..."}
                          </a>
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <button
                          type="button"
                          onClick={() => handleBuildPolicyVaultTx("sync")}
                          className={`w-full py-3 px-4 rounded-xl border text-[13px] font-semibold transition-colors cursor-pointer ${
                            darkMode
                              ? "border-white/15 bg-white/[0.04] hover:border-[#2934FF] text-white"
                              : "border-black/15 bg-white hover:border-[#2934FF] text-[#141413]"
                          }`}
                        >
                          Sync Policy Guardrails to PDA ↗
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const nextLocked = !emergencyLocked;
                            setEmergencyLocked(nextLocked);
                            handleBuildPolicyVaultTx(
                              "emergency-lock",
                              nextLocked
                            );
                          }}
                          className={`w-full py-3.5 px-5 rounded-xl font-semibold text-[13.5px] text-white transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                            emergencyLocked
                              ? "bg-emerald-600 hover:bg-emerald-700"
                              : "bg-red-600 hover:bg-red-700"
                          }`}
                        >
                          {emergencyLocked ? (
                            <>
                              <Unlock className="w-4 h-4" />
                              <span>Unlock Anchor Policy Vault</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-4 h-4" />
                              <span>Engage Emergency Circuit Breaker</span>
                            </>
                          )}
                        </button>

                        {policyActionNotice && (
                          <div
                            className={`p-3 rounded-xl border font-mono text-[11.5px] leading-relaxed break-all ${
                              darkMode
                                ? "bg-[#080B13] border-white/15 text-emerald-400"
                                : "bg-white border-black/15 text-[#141413]"
                            }`}
                          >
                            <div>{policyActionNotice}</div>
                            {policyTxArtifact && (
                              <div className="opacity-75 mt-1">
                                DATA_HEX: {policyTxArtifact.instructionDataHex}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* RIGHT PANE: BLINKS PREVIEW CARD */}
                  {technicalMode === "blinks" && (
                    <div className="space-y-4">
                      <div
                        className={`rounded-2xl border p-5 sm:p-6 space-y-4 ${
                          darkMode
                            ? "bg-[#080B13] border-white/10"
                            : "bg-white border-black/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <img
                              src="/logo.jpg"
                              alt="SolShield Blink"
                              className="w-11 h-11 rounded-xl object-cover border border-white/15"
                            />
                            <div>
                              <div className="text-[15.5px] font-semibold">
                                SolShield — Venice AI Guarded Swap
                              </div>
                              <div className="text-[12px] font-mono opacity-65">
                                sol-shield.xyz · Zero-Log Action
                              </div>
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-[11px] font-mono font-semibold">
                            LIVE
                          </span>
                        </div>

                        <p
                          className={`text-[13.5px] leading-relaxed ${
                            darkMode ? "text-[#8E98AD]" : "text-[#575653]"
                          }`}
                        >
                          Every click on this Blink audits the Jupiter swap
                          route, balance deltas, and token authorities before
                          delivering the unsigned transaction to the user&apos;s
                          wallet.
                        </p>

                        <div
                          className={`rounded-xl border px-3.5 py-2.5 font-mono text-[12px] break-all ${
                            darkMode
                              ? "bg-[#05070C] border-white/10 text-[#9EA8BA]"
                              : "bg-[#FAF9F6] border-black/10 text-[#575653]"
                          }`}
                        >
                          solana-action:https://sol-shield.xyz/api/actions/audit-swap?amount=
                          {encodeURIComponent(selectedBlinkSol || "0.5")}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* DOCKED RAYCAST-STYLE VENICE AI SECURITY COPILOT BAR */}
                  <div
                    className={`pt-4 border-t space-y-3 ${
                      darkMode ? "border-white/10" : "border-black/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-mono uppercase tracking-[0.08em] opacity-80">
                        <VeniceAiLogo className="w-3.5 h-3.5 text-[#E05A2D]" />
                        <span>Live Venice AI Copilot</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `curl -X POST https://api.venice.ai/api/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"llama-3.3-70b","venice_parameters":{"include_venice_system_prompt":false}}'`
                          );
                          setCopiedCurl(true);
                          setTimeout(() => setCopiedCurl(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-mono uppercase opacity-70 hover:opacity-100 cursor-pointer"
                      >
                        {copiedCurl ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedCurl ? "Copied" : "Zero-Log Proof"}</span>
                      </button>
                    </div>

                    {agentMessages.length > 0 && (
                      <div className="max-h-[135px] overflow-y-auto space-y-2 pr-1">
                        {agentMessages.slice(-4).map((msg, i) => (
                          <div
                            key={i}
                            className={`rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed border ${
                              msg.role === "user"
                                ? "bg-[#2934FF] text-white border-[#2934FF]"
                                : darkMode
                                  ? "bg-[#080B13] border-white/10 text-[#CBD5E1]"
                                  : "bg-white border-black/10 text-[#141413]"
                            }`}
                          >
                            {msg.telemetry &&
                              (msg.telemetry.slot ||
                                msg.telemetry.solBalance) && (
                                <div className="mb-1 pb-1 border-b border-current/10 flex flex-wrap gap-2 text-[11px] font-mono opacity-80">
                                  {msg.telemetry.slot && (
                                    <span>
                                      SLOT:{" "}
                                      {msg.telemetry.slot.toLocaleString(
                                        "en-US"
                                      )}
                                    </span>
                                  )}
                                  {msg.telemetry.solBalance && (
                                    <span>
                                      BAL: {msg.telemetry.solBalance} SOL
                                    </span>
                                  )}
                                </div>
                              )}
                            <p className="whitespace-pre-line">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

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
                        placeholder="Ask Venice AI or paste a Solana txHash / address..."
                        className={`flex-1 min-w-0 rounded-xl px-3.5 py-2.5 text-[13.5px] border focus:border-[#2934FF] focus:outline-none ${
                          darkMode
                            ? "bg-[#06080E] border-white/15 text-white placeholder:text-white/35"
                            : "bg-white border-black/15 text-[#141413] placeholder:text-black/40"
                        }`}
                      />
                      <button
                        type="submit"
                        disabled={agentLoading || !agentInput.trim()}
                        className="px-4 py-2.5 rounded-xl bg-[#2934FF] hover:bg-[#1E27E6] disabled:opacity-45 text-white transition-colors cursor-pointer shrink-0"
                        aria-label="Send query to Venice AI"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====================================================================
            ACT III — SCULPTURAL PROOF METRIC STRIP & BROWSER GUARD EXTENSION
            ==================================================================== */}
        <ArchitecturalProofStrip lang={lang} darkMode={darkMode} />

        {/* ====================================================================
            FOOTER — MINIMAL EDITORIAL PROTOCOL BAR + BAYER-DITHERED WORDMARK
            ==================================================================== */}
        <SiteFooter
          lang={lang}
          darkMode={darkMode}
          liveSlot={liveSlot}
          onOpenKeyModal={() => setShowKeyModal(true)}
          solscanUrl={TOKEN_CONFIG.links.solscan || "https://solscan.io"}
          xUrl={TOKEN_CONFIG.links.x}
          xHandle={TOKEN_CONFIG.xHandle}
        />

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
