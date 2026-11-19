"use client";

import React, { useState } from "react";
import Link from "next/link";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import { Transaction } from "@solana/web3.js";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  ClickSpark,
  CobaltSphere3D,
  CountUp,
  DecryptedText,
  InteractiveDotGrid,
  Magnet,
  SpotlightCard,
} from "@/components/reactbits";
import type { EvmChainKey } from "@/lib/evm-security";
import type {
  EvmDetoxAllowanceAudit,
  EvmDetoxReport,
  EvmRevokeArtifact,
} from "@/lib/evm-detox";
import { base64ToUint8Array } from "@/lib/solana-parser";
import type {
  BatchRevokeArtifact,
  DetoxCluster,
  WalletDetoxReport,
  WalletTokenAccountAudit,
} from "@/lib/wallet-detox";

interface SolanaBrowserWallet {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction?: (
    tx: Transaction
  ) => Promise<{ signature: string } | string>;
}

interface EvmBrowserProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

type NetworkTargetOption =
  | `sol:${DetoxCluster}`
  | `evm:${EvmChainKey}`;

const NETWORK_OPTIONS: Array<{
  value: NetworkTargetOption;
  label: string;
  family: "solana" | "evm";
}> = [
  { value: "sol:mainnet", label: "Solana Mainnet-Beta", family: "solana" },
  { value: "sol:devnet", label: "Solana Devnet", family: "solana" },
  { value: "evm:robinhood", label: "Robinhood Chain L2 (4663)", family: "evm" },
  { value: "evm:base", label: "Base Mainnet (8453)", family: "evm" },
  { value: "evm:ethereum", label: "Ethereum Mainnet (1)", family: "evm" },
  { value: "evm:arbitrum", label: "Arbitrum One (42161)", family: "evm" },
  { value: "evm:optimism", label: "Optimism (10)", family: "evm" },
  { value: "evm:polygon", label: "Polygon PoS (137)", family: "evm" },
  { value: "evm:bsc", label: "BNB Smart Chain (56)", family: "evm" },
];

const SAMPLE_PUBLIC_WALLETS: Array<{
  label: string;
  address: string;
  target: NetworkTargetOption;
}> = [
  {
    label: "Solana Mainnet Sample",
    address: "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg",
    target: "sol:mainnet",
  },
  {
    label: "ETH Permit2 / Vitalik Sample",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    target: "evm:ethereum",
  },
];

function isEvmDetoxReport(
  r: WalletDetoxReport | EvmDetoxReport | null
): r is EvmDetoxReport {
  return Boolean(r && "chainFamily" in r && r.chainFamily === "evm");
}

function shortAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

function formatAmount(val: number | null | undefined): string {
  if (val == null || Number.isNaN(val)) return "0";
  if (val === 0) return "0";
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  if (val < 0.0001) return val.toExponential(2);
  return val.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

interface WalletDetoxPanelProps {
  initialAddress?: string;
}

export default function WalletDetoxPanel({
  initialAddress = "",
}: WalletDetoxPanelProps) {
  const [addressInput, setAddressInput] = useState<string>(initialAddress);
  const [networkTarget, setNetworkTarget] = useState<NetworkTargetOption>(
    initialAddress.trim().startsWith("0x") ? "evm:robinhood" : "sol:mainnet"
  );
  const [extraEvmToken, setExtraEvmToken] = useState<string>("");
  const [veniceApiKey, setVeniceApiKey] = useState<string>("");
  const [showKeyInput, setShowKeyInput] = useState<boolean>(false);

  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [report, setReport] = useState<WalletDetoxReport | EvmDetoxReport | null>(
    null
  );

  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  const [revokingKey, setRevokingKey] = useState<string | null>(null);
  const [revokeArtifact, setRevokeArtifact] =
    useState<BatchRevokeArtifact | null>(null);
  const [evmRevokeArtifact, setEvmRevokeArtifact] =
    useState<EvmRevokeArtifact | null>(null);
  const [revokeTxSignature, setRevokeTxSignature] = useState<string | null>(
    null
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCleanAccounts, setShowCleanAccounts] = useState<boolean>(false);

  const activeFamily: "solana" | "evm" = networkTarget.startsWith("evm:")
    ? "evm"
    : "solana";

  const copyValue = (key: string, text: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId((cur) => (cur === key ? null : cur)), 1600);
  };

  const getBrowserWallet = (): SolanaBrowserWallet | null => {
    if (typeof window === "undefined") return null;
    const win = window as unknown as {
      solana?: SolanaBrowserWallet;
      solflare?: SolanaBrowserWallet;
    };
    return win.solana || win.solflare || null;
  };

  const getEvmProvider = (): EvmBrowserProvider | null => {
    if (typeof window === "undefined") return null;
    const win = window as unknown as {
      ethereum?: EvmBrowserProvider;
      phantom?: { ethereum?: EvmBrowserProvider };
      rabby?: EvmBrowserProvider;
    };
    return win.ethereum || win.rabby || win.phantom?.ethereum || null;
  };

  const runAudit = async (
    targetAddress?: string,
    overrideTarget?: NetworkTargetOption
  ) => {
    const queryAddress = (targetAddress ?? addressInput).trim();
    if (!queryAddress) {
      setErrorMsg("Paste any Solana or EVM (0x...) wallet address to scan.");
      return;
    }

    let chosenTarget = overrideTarget ?? networkTarget;
    if (queryAddress.startsWith("0x") && chosenTarget.startsWith("sol:")) {
      chosenTarget = "evm:robinhood";
      setNetworkTarget(chosenTarget);
    } else if (!queryAddress.startsWith("0x") && chosenTarget.startsWith("evm:")) {
      chosenTarget = "sol:mainnet";
      setNetworkTarget(chosenTarget);
    }

    const isEvmReq = chosenTarget.startsWith("evm:");
    const networkValue = chosenTarget.split(":")[1];

    setErrorMsg(null);
    setRevokeArtifact(null);
    setEvmRevokeArtifact(null);
    setRevokeTxSignature(null);
    setIsScanning(true);

    try {
      const res = await fetch("/api/wallet-detox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          address: queryAddress,
          cluster: isEvmReq ? undefined : networkValue,
          chain: isEvmReq ? networkValue : undefined,
          additionalTokens:
            isEvmReq && extraEvmToken.trim().startsWith("0x")
              ? [extraEvmToken.trim()]
              : undefined,
          veniceApiKey: veniceApiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.report) {
        setErrorMsg(
          data?.error || `Wallet detox audit failed (HTTP ${res.status}).`
        );
        return;
      }
      setReport(data.report as WalletDetoxReport | EvmDetoxReport);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Network failure while inspecting RPC."
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnectWallet = async (autoScan = true) => {
    setWalletNotice(null);

    if (activeFamily === "evm") {
      const evm = getEvmProvider();
      if (!evm) {
        setWalletNotice(
          "No EVM browser wallet detected (MetaMask / Rabby / Phantom EVM). You can still paste any 0x address above for read-only scanning."
        );
        return;
      }
      try {
        const accounts = (await evm.request({
          method: "eth_requestAccounts",
        })) as string[];
        const addr = accounts?.[0];
        if (addr) {
          setConnectedWallet(addr);
          setAddressInput(addr);
          if (autoScan) {
            await runAudit(addr, networkTarget);
          }
        }
      } catch {
        setWalletNotice("EVM wallet connection request was cancelled.");
      }
      return;
    }

    const provider = getBrowserWallet();
    if (!provider) {
      setWalletNotice(
        "No Solana browser wallet detected (Phantom / Solflare). You can still paste any address above for a 100% read-only audit."
      );
      return;
    }

    try {
      const resp = await provider.connect();
      const pubkey = resp?.publicKey?.toString() || provider.publicKey?.toString();
      if (pubkey) {
        setConnectedWallet(pubkey);
        setAddressInput(pubkey);
        if (autoScan) {
          await runAudit(pubkey, networkTarget);
        }
      }
    } catch {
      setWalletNotice("Wallet connection request was cancelled.");
    }
  };

  const handleBuildOrSignRevoke = async (targets: WalletTokenAccountAudit[]) => {
    if (!report || isEvmDetoxReport(report) || targets.length === 0) return;
    const revocable = targets.filter((t) => t.revocable);
    if (revocable.length === 0) return;

    const actionId =
      revocable.length === 1 ? revocable[0].tokenAccount : "BATCH_ALL";
    setRevokingKey(actionId);
    setErrorMsg(null);
    setWalletNotice(null);
    setRevokeTxSignature(null);

    try {
      const res = await fetch("/api/wallet-detox/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          owner: report.walletAddress,
          cluster: report.cluster,
          targets: revocable.slice(0, 8).map((item) => ({
            tokenAccount: item.tokenAccount,
            isToken2022: item.isToken2022,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.artifact) {
        setErrorMsg(
          data?.error || "Unable to construct SPL Revoke transaction."
        );
        return;
      }

      const artifact = data.artifact as BatchRevokeArtifact;
      setRevokeArtifact(artifact);

      // If browser wallet is connected and matches the audited owner, prompt signature directly
      const provider = getBrowserWallet();
      if (
        provider?.signAndSendTransaction &&
        connectedWallet === report.walletAddress
      ) {
        try {
          const txBytes = base64ToUint8Array(artifact.transactionBase64);
          const tx = Transaction.from(txBytes);
          const sent = await provider.signAndSendTransaction(tx);
          const sig = typeof sent === "string" ? sent : sent?.signature;
          if (sig) {
            setRevokeTxSignature(sig);
            setWalletNotice(
              `Revoke transaction submitted on ${report.cluster}. Re-scanning wallet in 2s...`
            );
            setTimeout(() => {
              void runAudit(report.walletAddress, `sol:${report.cluster}`);
            }, 2200);
          }
        } catch (signErr) {
          setWalletNotice(
            signErr instanceof Error
              ? `Signing cancelled or rejected: ${signErr.message}. Unsigned Base64 transaction is ready below.`
              : "Signing cancelled. You can inspect or copy the unsigned Base64 transaction below."
          );
        }
      } else {
        setWalletNotice(
          connectedWallet && connectedWallet !== report.walletAddress
            ? `Audited address (${shortAddress(report.walletAddress)}) differs from your connected wallet (${shortAddress(connectedWallet)}). Connect the owner wallet to sign, or copy the unsigned Base64 Revoke payload below.`
            : "Unsigned Revoke transaction constructed. Connect your owner wallet to sign directly, or copy the Base64 transaction below."
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Revoke builder request failed."
      );
    } finally {
      setRevokingKey(null);
    }
  };

  const handleBuildOrSignEvmRevoke = async (
    targets: EvmDetoxAllowanceAudit[]
  ) => {
    if (!report || !isEvmDetoxReport(report) || targets.length === 0) return;
    const actionId = targets.length === 1 ? targets[0].id : "EVM_BATCH_ALL";
    setRevokingKey(actionId);
    setErrorMsg(null);
    setWalletNotice(null);
    setRevokeTxSignature(null);

    try {
      const res = await fetch("/api/wallet-detox/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          owner: report.walletAddress,
          chain: report.chainKey,
          targets: targets.map((t) => ({
            kind: t.kind,
            tokenAddress: t.tokenAddress,
            spenderAddress: t.spenderAddress,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.artifact) {
        setErrorMsg(data?.error || "Unable to construct EVM revoke calldata.");
        return;
      }

      const artifact = data.artifact as EvmRevokeArtifact;
      setEvmRevokeArtifact(artifact);

      const evm = getEvmProvider();
      const ownerMatch =
        connectedWallet &&
        connectedWallet.toLowerCase() === report.walletAddress.toLowerCase();

      if (evm && ownerMatch) {
        try {
          try {
            await evm.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: artifact.chainIdHex }],
            });
          } catch (switchErr: unknown) {
            const code = (switchErr as { code?: number })?.code;
            if (code === 4902 && artifact.chainKey === "robinhood") {
              await evm.request({
                method: "wallet_addEthereumChain",
                params: [
                  {
                    chainId: "0x1237",
                    chainName: "Robinhood Chain Mainnet",
                    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
                    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
                  },
                ],
              });
            }
          }

          let lastHash: string | null = null;
          for (const txSpec of artifact.transactions) {
            const hash = (await evm.request({
              method: "eth_sendTransaction",
              params: [
                {
                  from: connectedWallet,
                  to: txSpec.to,
                  data: txSpec.data,
                  value: txSpec.value,
                },
              ],
            })) as string;
            if (hash) lastHash = hash;
          }

          if (lastHash) {
            setRevokeTxSignature(lastHash);
            setWalletNotice(
              `Submitted ${artifact.txCount} revoke tx(s) on ${report.networkName}. Re-scanning allowances in 3s...`
            );
            setTimeout(() => {
              void runAudit(report.walletAddress, `evm:${report.chainKey}`);
            }, 3000);
          }
        } catch (signErr) {
          setWalletNotice(
            signErr instanceof Error
              ? `EVM revoke signing cancelled: ${signErr.message}. Raw calldata is ready below.`
              : "EVM revoke cancelled. Copy the raw calldata below to revoke manually."
          );
        }
      } else {
        setWalletNotice(
          "Unsigned EVM approve(0) / Permit2 lockdown calldata ready below. Connect your matching EVM wallet to sign in 1 click."
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "EVM revoke builder request failed."
      );
    } finally {
      setRevokingKey(null);
    }
  };

  const solanaReport = !isEvmDetoxReport(report) ? report : null;
  const evmReport = isEvmDetoxReport(report) ? report : null;

  const statusTone =
    report?.classification === "SAFE"
      ? {
          badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
          scoreText: "text-emerald-400",
          barColor: "bg-emerald-400",
          Icon: ShieldCheck,
        }
      : report?.classification === "CAUTION"
        ? {
            badge: "bg-amber-500/15 text-amber-300 border-amber-500/40",
            scoreText: "text-amber-300",
            barColor: "bg-amber-400",
            Icon: AlertTriangle,
          }
        : {
            badge: "bg-red-500/15 text-red-300 border-red-500/45",
            scoreText: "text-red-400",
            barColor: "bg-red-400",
            Icon: ShieldAlert,
          };

  const revocableFindings = solanaReport?.findings.filter((f) => f.revocable) ?? [];

  return (
    <ClickSpark sparkColor="#2934FF" sparkSize={10} sparkRadius={18} sparkCount={8}>
      <div className="solshield-subpage min-h-screen bg-[#0A0A0C] text-[#F4F6FB] selection:bg-[#2934FF] selection:text-white relative overflow-x-clip">
        <InteractiveDotGrid
          className="opacity-35"
          baseColor="rgba(148, 163, 184, 0.28)"
          activeColor="rgba(41, 52, 255, 0.72)"
        />

        {/* Top Navigation Bar */}
        <header className="border-b border-white/[0.08] bg-[#0A0C12]/92 backdrop-blur-xl sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Magnet padding={20} magnetStrength={4}>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">SolShield</span>
                </Link>
              </Magnet>
              <span className="text-white/20 hidden sm:inline">/</span>
              <div className="flex items-center gap-2">
                <img
                  src="/logo.png?v=2"
                  alt="SolShield Logo"
                  className="w-7 h-7 rounded-md border border-white/15"
                />
                <span className="font-semibold tracking-tight text-sm sm:text-base">
                  Wallet Detox
                </span>
              </div>
              <Link
                href="/buildcheck"
                className="hidden md:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-white border border-white/[0.08] hover:border-white/20 transition-colors"
              >
                BuildCheck AI
              </Link>
              <Link
                href="/dev-lineage"
                className="hidden lg:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-purple-300/90 hover:text-white border border-purple-500/25 hover:border-purple-400/50 bg-purple-500/[0.06] transition-colors"
              >
                Dev Lineage
              </Link>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleConnectWallet(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  connectedWallet
                    ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-300"
                    : "border-white/12 bg-white/5 text-slate-200 hover:border-white/25"
                }`}
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>
                  {connectedWallet
                    ? shortAddress(connectedWallet)
                    : "Optional: Connect Wallet"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowKeyInput((prev) => !prev)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  veniceApiKey.trim()
                    ? "border-[#2934FF]/60 bg-[#2934FF]/20 text-white"
                    : "border-white/12 bg-white/5 text-slate-300 hover:border-white/25"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {veniceApiKey.trim() ? "Venice Active" : "Venice BYOK"}
                </span>
              </button>

              <ThemeToggleButton />
            </div>
          </div>

          {showKeyInput && (
            <div className="border-t border-white/[0.06] bg-[#0D1017] px-4 sm:px-6 py-3">
              <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2.5">
                <span className="text-xs text-slate-400 shrink-0">
                  Venice API Key (optional BYOK, zero retention, never stored):
                </span>
                <input
                  type="password"
                  value={veniceApiKey}
                  onChange={(e) => setVeniceApiKey(e.target.value)}
                  placeholder="vn_..."
                  className="flex-1 bg-[#07080D] border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#2934FF]"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyInput(false)}
                  className="px-3 py-1.5 rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-xs font-medium text-white cursor-pointer"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-7 relative z-10">
          {/* Hero & Search Section */}
          <SpotlightCard
            spotlightColor="rgba(41, 52, 255, 0.16)"
            className="rounded-2xl border border-white/[0.08] bg-[#0D1017] p-6 sm:p-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="space-y-3 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/12 border border-emerald-500/35 text-emerald-300 inline-flex items-center gap-1.5">
                    <EyeOff className="w-3.5 h-3.5" />
                    No Wallet Connect Required · Read-Only RPC
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-[#2934FF]/15 border border-[#2934FF]/40 text-[#93C5FD] inline-flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    Zero-Retention Venice AI
                  </span>
                </div>

                <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-white">
                  <DecryptedText
                    text="Wallet Health & Approval Detox"
                    speed={26}
                  />
                </h1>
                <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                  Paste any Solana or EVM (0x...) address to uncover hidden SPL Token delegates,
                  Token-2022 PermanentDelegate/TransferHook traps, or active ERC-20 &amp; Permit2
                  allowances on Robinhood Chain L2, Base, Ethereum, and Arbitrum.
                </p>
              </div>

              <div className="hidden lg:flex shrink-0 items-center justify-center w-28 h-28">
                <CobaltSphere3D className="w-24 h-24" />
              </div>
            </div>

            {/* Address Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runAudit();
              }}
              className="mt-6 flex flex-col sm:flex-row gap-2.5"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="Paste Solana Base58 or EVM 0x... wallet address..."
                  className="w-full bg-[#07080D] border border-white/15 focus:border-[#2934FF] rounded-xl pl-10 pr-4 py-3 text-sm font-mono text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>

              <select
                value={networkTarget}
                onChange={(e) =>
                  setNetworkTarget(e.target.value as NetworkTargetOption)
                }
                aria-label="Network Cluster"
                className="bg-[#07080D] border border-white/15 rounded-xl px-3 py-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-[#2934FF]"
              >
                {NETWORK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={isScanning}
                className="px-6 py-3 rounded-xl bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors shrink-0"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      {activeFamily === "evm"
                        ? "Scanning ERC-20 & Permit2..."
                        : "Scanning SPL & T-2022..."}
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Audit Approvals</span>
                  </>
                )}
              </button>
            </form>

            {activeFamily === "evm" && (
              <div className="mt-2.5">
                <input
                  type="text"
                  value={extraEvmToken}
                  onChange={(e) => setExtraEvmToken(e.target.value)}
                  placeholder="Optional EVM Token CA (0x...) to probe allowance directly alongside Permit2 & trending pools..."
                  className="w-full bg-[#07080D]/80 border border-white/10 focus:border-[#2934FF] rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            )}

            {/* Quick actions / sample pills */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Quick test (read-only):</span>
              {SAMPLE_PUBLIC_WALLETS.map((sample) => (
                <button
                  key={sample.address}
                  type="button"
                  onClick={() => {
                    setAddressInput(sample.address);
                    setNetworkTarget(sample.target);
                    void runAudit(sample.address, sample.target);
                  }}
                  className="px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:text-white font-mono transition-colors cursor-pointer"
                >
                  {sample.label}
                </button>
              ))}
              {connectedWallet && (
                <button
                  type="button"
                  onClick={() => {
                    setAddressInput(connectedWallet);
                    void runAudit(connectedWallet, networkTarget);
                  }}
                  className="px-2.5 py-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 font-mono transition-colors cursor-pointer"
                >
                  Scan Connected ({shortAddress(connectedWallet)})
                </button>
              )}
            </div>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {walletNotice && (
              <div className="mt-4 rounded-xl border border-[#2934FF]/40 bg-[#2934FF]/12 px-4 py-3 text-xs text-slate-200 flex items-center justify-between gap-3">
                <span>{walletNotice}</span>
                {!connectedWallet && (
                  <button
                    type="button"
                    onClick={() => handleConnectWallet(false)}
                    className="px-3 py-1 rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white font-semibold shrink-0 cursor-pointer"
                  >
                    Connect Wallet
                  </button>
                )}
              </div>
            )}

            {revokeTxSignature && report && (
              <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/12 px-4 py-3 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Revoke TX Confirmed: <code className="font-mono">{shortAddress(revokeTxSignature, 8, 8)}</code>
                </span>
                <a
                  href={
                    evmReport
                      ? `${evmReport.explorerUrl}/tx/${revokeTxSignature}`
                      : `https://solscan.io/tx/${revokeTxSignature}${
                          solanaReport?.cluster === "devnet" ? "?cluster=devnet" : ""
                        }`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-300 underline hover:text-white"
                >
                  <span>{evmReport ? "View on Explorer" : "View on Solscan"}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </SpotlightCard>

          {/* EVM Report Output */}
          {evmReport && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-5 rounded-2xl border border-white/[0.08] bg-[#0D1017] p-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        EVM Allowance Health Score
                      </p>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span
                          className={`text-4xl font-bold font-mono tabular-nums ${statusTone.scoreText}`}
                        >
                          <CountUp to={evmReport.healthScore} durationMs={700} />
                        </span>
                        <span className="text-sm text-slate-400 font-mono">
                          / 100
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-3 py-1 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 ${statusTone.badge}`}
                    >
                      <statusTone.Icon className="w-3.5 h-3.5" />
                      <span>{evmReport.verdictLabel}</span>
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${statusTone.barColor}`}
                      style={{ width: `${evmReport.healthScore}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
                    <div className="rounded-xl bg-[#07080D] border border-white/[0.06] p-3">
                      <p className="text-[10px] font-mono text-slate-400">
                        NATIVE BALANCE
                      </p>
                      <p className="text-sm font-mono font-semibold text-white mt-0.5">
                        {evmReport.nativeBalance.toFixed(4)} {evmReport.nativeSymbol}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#07080D] border border-white/[0.06] p-3">
                      <p className="text-[10px] font-mono text-slate-400">
                        TOKENS PROBED
                      </p>
                      <p className="text-sm font-mono font-semibold text-white mt-0.5">
                        {evmReport.tokensScannedCount}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#07080D] border border-white/[0.06] p-3 col-span-2 sm:col-span-1">
                      <p className="text-[10px] font-mono text-slate-400">
                        ACTIVE ALLOWANCES
                      </p>
                      <p
                        className={`text-sm font-mono font-semibold mt-0.5 ${
                          evmReport.activeApprovalCount > 0
                            ? "text-red-400"
                            : "text-emerald-400"
                        }`}
                      >
                        {evmReport.activeApprovalCount}
                        {evmReport.permit2ApprovalCount > 0 && (
                          <span className="text-[10px] text-amber-300 font-normal ml-1">
                            ({evmReport.permit2ApprovalCount} P2)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono text-slate-400">
                    <span>
                      {shortAddress(evmReport.walletAddress, 6, 4)} · {evmReport.networkName}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void runAudit(evmReport.walletAddress, `evm:${evmReport.chainKey}`)
                      }
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Re-scan</span>
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-7 rounded-2xl border border-white/[0.08] bg-[#0D1017] p-6 flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#93C5FD]">
                        <Sparkles className="w-4 h-4 text-[#2934FF]" />
                        <span>Venice AI Zero-Retention EVM Briefing</span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.1] text-[10px] font-mono text-slate-300">
                        {evmReport.inferenceMode === "venice-live-api"
                          ? `Venice Live · ${evmReport.modelUsed}`
                          : "Deterministic Zero-Cost Engine"}
                      </span>
                    </div>

                    <p className="text-sm text-slate-200 leading-relaxed">
                      {evmReport.veniceSummary}
                    </p>

                    <div className="space-y-1.5 pt-1">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Recommended Action Plan
                      </p>
                      <ul className="space-y-1.5">
                        {evmReport.veniceActionPlan.map((step, i) => (
                          <li
                            key={i}
                            className="text-xs text-slate-300 flex items-start gap-2"
                          >
                            <span className="text-[#60a5fa] font-mono shrink-0">
                              0{i + 1}.
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3.5 py-2.5 text-[11px] text-emerald-200/90 flex items-start gap-2">
                    <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                    <span>{evmReport.privacyAttestation}</span>
                  </div>
                </div>
              </div>

              {/* EVM Findings & 1-Click Revoke */}
              <div className="rounded-2xl border border-white/[0.08] bg-[#0D1017] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.07] bg-[#090B10] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Active ERC-20 &amp; Permit2 Approvals ({evmReport.findings.length})
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Revoke with standard ERC-20 approve(0) or batched Permit2 lockdown().
                    </p>
                  </div>

                  {evmReport.findings.length > 1 && (
                    <button
                      type="button"
                      disabled={revokingKey !== null}
                      onClick={() => void handleBuildOrSignEvmRevoke(evmReport.findings)}
                      className="px-4 py-2 rounded-xl bg-red-500/90 hover:bg-red-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {revokingKey === "EVM_BATCH_ALL" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>Revoke All ({evmReport.findings.length})</span>
                    </button>
                  )}
                </div>

                {evmReport.findings.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto" />
                    <p className="text-sm font-semibold text-white">
                      Clean EVM Surface — Zero Active Allowances Detected
                    </p>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      Inspected {evmReport.tokensScannedCount} token(s) across {evmReport.networkName} including Permit2 singleton permissions.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {evmReport.findings.map((item) => {
                      const isCritical = item.severity === "CRITICAL";
                      return (
                        <div
                          key={item.id}
                          className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.015]"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                                  isCritical
                                    ? "bg-red-500/15 text-red-300 border-red-500/40"
                                    : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                                }`}
                              >
                                {item.severity}
                              </span>
                              <span className="text-sm font-semibold text-white">
                                {item.tokenSymbol ? `$${item.tokenSymbol}` : shortAddress(item.tokenAddress)}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-white/[0.05] text-[10px] font-mono text-sky-300">
                                {item.kind === "permit2" ? "Permit2" : "ERC-20"}
                              </span>
                              {item.isUnlimited && (
                                <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-mono font-semibold">
                                  UNLIMITED
                                </span>
                              )}
                              {item.spenderIsContract === false && (
                                <span className="px-2 py-0.5 rounded bg-red-500/25 text-red-200 text-[10px] font-mono font-semibold">
                                  EOA SPENDER
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-300">{item.summary}</p>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400">
                              <span>Token: {shortAddress(item.tokenAddress)}</span>
                              <span className="text-red-300">
                                Spender: {item.spenderLabel ? `${item.spenderLabel} · ` : ""}
                                {shortAddress(item.spenderAddress)}
                              </span>
                              <span>Balance: {formatAmount(item.balanceUi)}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={revokingKey !== null}
                            onClick={() => void handleBuildOrSignEvmRevoke([item])}
                            className="px-3.5 py-2 rounded-xl bg-red-500/18 hover:bg-red-500/30 border border-red-500/45 text-red-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                          >
                            {revokingKey === item.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {connectedWallet?.toLowerCase() ===
                              evmReport.walletAddress.toLowerCase()
                                ? "Revoke Now"
                                : "Build Revoke Calldata"}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {evmRevokeArtifact && (
                  <div className="border-t border-white/[0.08] bg-[#07090F] p-5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-mono text-[#93C5FD]">
                        {evmRevokeArtifact.networkName} (Chain {evmRevokeArtifact.chainId}) ·{" "}
                        {evmRevokeArtifact.txCount} Revoke Calldata Ready
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyValue(
                            "evm-revoke-json",
                            JSON.stringify(evmRevokeArtifact.transactions, null, 2)
                          )
                        }
                        className="px-2.5 py-1 rounded-md border border-white/15 bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-white inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedId === "evm-revoke-json" ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied Calldata</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Calldata JSON</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-slate-400 bg-[#040508] border border-white/[0.06] rounded-lg p-3 overflow-x-auto break-all whitespace-pre-wrap">
                      {JSON.stringify(evmRevokeArtifact.transactions, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Solana Report Output */}
          {solanaReport && (() => {
            const report = solanaReport;
            return (
            <div className="space-y-6">
              {/* Summary & Health Dial */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-5 rounded-2xl border border-white/[0.08] bg-[#0D1017] p-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Approval Health Score
                      </p>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span
                          className={`text-4xl font-bold font-mono tabular-nums ${statusTone.scoreText}`}
                        >
                          <CountUp to={report.healthScore} durationMs={700} />
                        </span>
                        <span className="text-sm text-slate-400 font-mono">
                          / 100
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-3 py-1 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 ${statusTone.badge}`}
                    >
                      <statusTone.Icon className="w-3.5 h-3.5" />
                      <span>{report.verdictLabel}</span>
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${statusTone.barColor}`}
                      style={{ width: `${report.healthScore}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
                    <div className="rounded-xl bg-[#07080D] border border-white/[0.06] p-3">
                      <p className="text-[10px] font-mono text-slate-400">
                        SOL BALANCE
                      </p>
                      <p className="text-sm font-mono font-semibold text-white mt-0.5">
                        {report.solBalance.toFixed(4)} SOL
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#07080D] border border-white/[0.06] p-3">
                      <p className="text-[10px] font-mono text-slate-400">
                        ACCOUNTS SCANNED
                      </p>
                      <p className="text-sm font-mono font-semibold text-white mt-0.5">
                        {report.totalTokenAccounts}
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          ({report.token2022Count} T22)
                        </span>
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#07080D] border border-white/[0.06] p-3 col-span-2 sm:col-span-1">
                      <p className="text-[10px] font-mono text-slate-400">
                        ACTIVE DELEGATES
                      </p>
                      <p
                        className={`text-sm font-mono font-semibold mt-0.5 ${
                          report.activeDelegateCount > 0
                            ? "text-red-400"
                            : "text-emerald-400"
                        }`}
                      >
                        {report.activeDelegateCount}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono text-slate-400">
                    <span>
                      Target: {shortAddress(report.walletAddress, 6, 6)} ({report.cluster})
                    </span>
                    <button
                      type="button"
                      onClick={() => void runAudit(report.walletAddress, `sol:${report.cluster}`)}
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Re-scan</span>
                    </button>
                  </div>
                </div>

                {/* Venice Zero-Retention Explanation */}
                <div className="lg:col-span-7 rounded-2xl border border-white/[0.08] bg-[#0D1017] p-6 flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#93C5FD]">
                        <Sparkles className="w-4 h-4 text-[#2934FF]" />
                        <span>Venice AI Zero-Retention Detox Briefing</span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.1] text-[10px] font-mono text-slate-300">
                        {report.inferenceMode === "venice-live-api"
                          ? `Venice Live · ${report.modelUsed}`
                          : "Deterministic Zero-Cost Engine"}
                      </span>
                    </div>

                    <p className="text-sm text-slate-200 leading-relaxed">
                      {report.veniceSummary}
                    </p>

                    <div className="space-y-1.5 pt-1">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Recommended Action Plan
                      </p>
                      <ul className="space-y-1.5">
                        {report.veniceActionPlan.map((step, i) => (
                          <li
                            key={i}
                            className="text-xs text-slate-300 flex items-start gap-2"
                          >
                            <span className="text-[#60a5fa] font-mono shrink-0">
                              0{i + 1}.
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3.5 py-2.5 text-[11px] text-emerald-200/90 flex items-start gap-2">
                    <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                    <span>{report.privacyAttestation}</span>
                  </div>
                </div>
              </div>

              {/* Risk Findings & 1-Click Revoke */}
              <div className="rounded-2xl border border-white/[0.08] bg-[#0D1017] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.07] bg-[#090B10] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Flagged Allowances &amp; Token-2022 Extensions (
                      {report.findings.length})
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Spender approvals allow third-party contracts to move tokens
                      without another prompt until revoked.
                    </p>
                  </div>

                  {revocableFindings.length > 1 && (
                    <button
                      type="button"
                      disabled={revokingKey !== null}
                      onClick={() => void handleBuildOrSignRevoke(revocableFindings)}
                      className="px-4 py-2 rounded-xl bg-red-500/90 hover:bg-red-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {revokingKey === "BATCH_ALL" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>
                        Batch Revoke All ({Math.min(revocableFindings.length, 8)})
                      </span>
                    </button>
                  )}
                </div>

                {report.findings.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto" />
                    <p className="text-sm font-semibold text-white">
                      Clean Approval Surface — Zero Exposed Delegates
                    </p>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      All {report.totalTokenAccounts} SPL Token and Token-2022 accounts
                      under this address have no active delegated spenders or unverified
                      mint-level clawback extensions.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {report.findings.map((item) => {
                      const isCritical = item.severity === "CRITICAL";
                      return (
                        <div
                          key={item.tokenAccount}
                          className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.015] transition-colors"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                                  isCritical
                                    ? "bg-red-500/15 text-red-300 border-red-500/40"
                                    : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                                }`}
                              >
                                {item.severity}
                              </span>
                              <span className="text-sm font-semibold text-white">
                                {item.symbol ? `$${item.symbol}` : shortAddress(item.mint)}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-white/[0.05] text-[10px] font-mono text-slate-300">
                                {item.tokenProgram}
                              </span>
                              {item.isUnlimitedAllowance && (
                                <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-mono font-semibold">
                                  UNLIMITED ALLOWANCE
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-300">{item.summary}</p>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400 pt-0.5">
                              <span>
                                Balance: {formatAmount(item.balanceUi)}
                              </span>
                              {item.delegate && (
                                <span className="inline-flex items-center gap-1 text-red-300">
                                  Delegate: {shortAddress(item.delegate, 6, 4)}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      copyValue(`del-${item.tokenAccount}`, item.delegate!)
                                    }
                                    className="text-slate-400 hover:text-white cursor-pointer"
                                    title="Copy Delegate Address"
                                  >
                                    {copiedId === `del-${item.tokenAccount}` ? (
                                      <Check className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </span>
                              )}
                              {item.permanentDelegate && (
                                <span className="text-amber-300">
                                  PermDelegate: {shortAddress(item.permanentDelegate)}
                                </span>
                              )}
                              <span>
                                Account: {shortAddress(item.tokenAccount)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {item.revocable ? (
                              <button
                                type="button"
                                disabled={revokingKey !== null}
                                onClick={() => void handleBuildOrSignRevoke([item])}
                                className="px-3.5 py-2 rounded-xl bg-red-500/18 hover:bg-red-500/30 border border-red-500/45 text-red-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                              >
                                {revokingKey === item.tokenAccount ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {connectedWallet === report.walletAddress
                                    ? "Revoke Now"
                                    : "Build Revoke Tx"}
                                </span>
                              </button>
                            ) : (
                              <span className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.03] text-[11px] font-mono text-slate-400">
                                Mint-Enforced (Non-Revocable)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Unsigned Revoke Transaction Preview (great for watch-only / hardware review) */}
                {revokeArtifact && (
                  <div className="border-t border-white/[0.08] bg-[#07090F] p-5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-mono text-[#93C5FD]">
                        Instruction Tag 5 (Revoke) · {revokeArtifact.instructionCount}{" "}
                        instruction{revokeArtifact.instructionCount > 1 ? "s" : ""} ·
                        Blockhash {shortAddress(revokeArtifact.recentBlockhashUsed, 6, 4)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyValue("revoke-b64", revokeArtifact.transactionBase64)
                        }
                        className="px-2.5 py-1 rounded-md border border-white/15 bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-white inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedId === "revoke-b64" ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied Base64</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Unsigned Base64 Tx</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-slate-400 bg-[#040508] border border-white/[0.06] rounded-lg p-3 overflow-x-auto break-all whitespace-pre-wrap">
                      {revokeArtifact.transactionBase64}
                    </pre>
                  </div>
                )}
              </div>

              {/* Clean Token Accounts Drawer */}
              {report.cleanAccounts.length > 0 && (
                <div className="rounded-2xl border border-white/[0.08] bg-[#0D1017] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowCleanAccounts((prev) => !prev)}
                    className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>
                        Verified Clean Token Accounts ({report.cleanAccounts.length})
                      </span>
                    </div>
                    {showCleanAccounts ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {showCleanAccounts && (
                    <div className="border-t border-white/[0.06] overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#090B10] text-[10px] font-mono uppercase text-slate-400">
                          <tr>
                            <th className="px-4 py-2.5">Asset</th>
                            <th className="px-4 py-2.5">Program</th>
                            <th className="px-4 py-2.5">Balance</th>
                            <th className="px-4 py-2.5">Mint</th>
                            <th className="px-4 py-2.5">Delegate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {report.cleanAccounts.map((acc) => (
                            <tr key={acc.tokenAccount} className="hover:bg-white/[0.015]">
                              <td className="px-4 py-2.5 font-medium text-white">
                                {acc.symbol ? `$${acc.symbol}` : shortAddress(acc.mint)}
                                {acc.isCanonicalAsset && (
                                  <span className="ml-1.5 text-[10px] font-mono text-emerald-400">
                                    ✓ {acc.canonicalIssuer}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-300">
                                {acc.tokenProgram}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-200">
                                {formatAmount(acc.balanceUi)}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-400">
                                {shortAddress(acc.mint)}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-emerald-400">
                                None (Clean)
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
          })()}
        </main>
      </div>
    </ClickSpark>
  );
}
