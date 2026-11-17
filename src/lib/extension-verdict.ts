import {
  analyzeBase64Transaction,
  calculateDeterministicScore,
  DeterministicSimulationReport,
  ThreatFlag,
} from "./solana-parser";
import { DomainEvaluation, evaluateDomainSafety, normalizeHostname } from "./domain-guard";
import {
  inspectEvmRpcRequest,
  type EvmDeterministicInspection,
  type EvmInterceptMethod,
  type EvmRpcInspectionInput,
} from "./evm-tx-parser";
import type { RpcTxSimulationReport, SimulatedBalanceDiff } from "./tx-simulator";
import type { VeniceSecurityAuditResult } from "./venice-ai";
import type { TokenScanReport } from "./token-scanner";

export type ExtensionRequestKind =
  | "signTransaction"
  | "signAndSendTransaction"
  | "signAllTransactions"
  | "signMessage"
  | "signIn"
  | "connect"
  | EvmInterceptMethod;

export interface SignInInspectionInput {
  domain?: string;
  statement?: string;
  uri?: string;
}

export interface LocalOffchainMessageInspection {
  isSuspicious: boolean;
  riskScore: number;
  reasons: string[];
  looksLikeRawTransaction: boolean;
}

export interface RemoteAuditSnapshot {
  attempted: boolean;
  verified: boolean;
  timedOutOrError: string | null;
  veniceAudit: VeniceSecurityAuditResult | null;
  rpcSimulation: RpcTxSimulationReport | null;
  domainReputation: {
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    riskScore: number;
    summary: string;
    sources: string[];
    inferenceMode: "venice-live-api" | "deterministic-fallback";
  } | null;
  evmContractWarning?: string | null;
  evmContractRiskScore?: number | null;
}

export interface ExtensionVerdict {
  decision: "SAFE" | "WARNING" | "BLOCK";
  chainFamily?: "solana" | "evm";
  riskScore: number;
  headline: string;
  requiresTypedConfirmation: boolean;
  apiVerified: boolean;
  timeoutUnverified: boolean;
  walletMethod: ExtensionRequestKind;
  txCount: number;
  domainEvaluation: DomainEvaluation;
  localReports: DeterministicSimulationReport[];
  evmReport?: EvmDeterministicInspection | null;
  balanceDiffs: SimulatedBalanceDiff[];
  tokenAudits: TokenScanReport[];
  reasons: string[];
  veniceSummary: string | null;
  privacyAttestation: string;
}

const SUSPICIOUS_SIGN_MESSAGE_PATTERNS = [
  /setauthority/i,
  /approve\s+all/i,
  /transfer\s+ownership/i,
  /unlimited\s+allowance/i,
  /blind\s*sign/i,
  /claim\s+(airdrop|reward|allocation)/i,
  /authorize\s+drain/i,
];

/**
 * Inspects off-chain `signMessage` bytes locally (catches raw tx masquerading as messages
 * or phishing approval prompts).
 */
export function inspectOffchainSignMessage(
  messageBytes: Uint8Array,
  decodedText?: string
): LocalOffchainMessageInspection {
  const reasons: string[] = [];
  let riskScore = 10;
  let looksLikeRawTransaction = false;

  const text =
    decodedText ??
    (typeof TextDecoder !== "undefined"
      ? new TextDecoder("utf-8", { fatal: false }).decode(messageBytes)
      : "");

  // Heuristic: binary blobs >= 64 bytes with many non-printable chars often hide raw tx bytes
  if (messageBytes.length >= 64) {
    let nonPrintable = 0;
    for (let i = 0; i < messageBytes.length; i++) {
      const b = messageBytes[i];
      if (b < 9 || (b > 13 && b < 32) || b === 127) {
        nonPrintable++;
      }
    }
    if (nonPrintable / messageBytes.length > 0.2) {
      looksLikeRawTransaction = true;
      riskScore += 55;
      reasons.push(
        "Off-chain signMessage contains opaque binary bytes (>=64B) instead of human-readable text."
      );
    }
  }

  for (const pat of SUSPICIOUS_SIGN_MESSAGE_PATTERNS) {
    if (pat.test(text)) {
      riskScore += 45;
      reasons.push(
        `Off-chain signMessage matches phishing / authority-transfer wording ("${pat.source}").`
      );
      break;
    }
  }

  return {
    isSuspicious: riskScore >= 40,
    riskScore: Math.min(99, riskScore),
    reasons,
    looksLikeRawTransaction,
  };
}

/**
 * Inspects Sign-In With Solana (SIWS) payloads for cross-domain spoofing or phishing wording.
 */
export function inspectOffchainSignIn(
  signInInput: SignInInspectionInput | null | undefined,
  activeHostname: string
): LocalOffchainMessageInspection {
  if (!signInInput) {
    return {
      isSuspicious: false,
      riskScore: 10,
      reasons: [],
      looksLikeRawTransaction: false,
    };
  }

  const reasons: string[] = [];
  let riskScore = 10;

  const claimedHost = signInInput.domain ? normalizeHostname(signInInput.domain) : null;
  const pageHost = normalizeHostname(activeHostname);
  if (claimedHost && pageHost && claimedHost !== pageHost) {
    riskScore = Math.max(riskScore, 92);
    reasons.push(
      `[CRITICAL] Cross-domain SIWS spoofing: payload claims "${claimedHost}" on tab "${pageHost}".`
    );
  }

  const combinedText = [signInInput.statement || "", signInInput.uri || ""]
    .filter(Boolean)
    .join(" ");
  if (combinedText) {
    const textInspection = inspectOffchainSignMessage(
      new TextEncoder().encode(combinedText),
      combinedText
    );
    riskScore = Math.max(riskScore, textInspection.riskScore);
    reasons.push(...textInspection.reasons);
  }

  return {
    isSuspicious: riskScore >= 40,
    riskScore: Math.min(99, riskScore),
    reasons,
    looksLikeRawTransaction: false,
  };
}

/**
 * Builds the merged M1 + M2 + M3 verdict cleanly and non-silently.
 */
export function buildExtensionVerdict(params: {
  walletMethod: ExtensionRequestKind;
  hostname: string;
  base64Transactions?: string[];
  evmRequest?: EvmRpcInspectionInput | null;
  messageInspection?: LocalOffchainMessageInspection | null;
  signInInput?: SignInInspectionInput | null;
  trustedDomains?: string[];
  blockedDomains?: string[];
  strictMode?: boolean;
  remote?: RemoteAuditSnapshot;
}): ExtensionVerdict {
  const isEvmMethod =
    Boolean(params.evmRequest) ||
    params.walletMethod.startsWith("eth_") ||
    params.walletMethod.startsWith("wallet_") ||
    params.walletMethod === "personal_sign";

  const txs = params.base64Transactions ?? [];
  const domainEval = evaluateDomainSafety(params.hostname, {
    trustedDomains: params.trustedDomains,
    blockedDomains: params.blockedDomains,
  });

  const localReports: DeterministicSimulationReport[] = [];
  const combinedFlags: ThreatFlag[] = [];
  const reasons: string[] = [];
  let parseFailureError: string | null = null;
  let evmReport: EvmDeterministicInspection | null = null;

  if (params.evmRequest) {
    evmReport = inspectEvmRpcRequest(params.evmRequest);
    reasons.push(...evmReport.reasons);
    if (evmReport.reasons.length === 0 && evmReport.summary) {
      reasons.push(evmReport.summary);
    }
  } else {
    for (let i = 0; i < txs.length; i++) {
      try {
        const rep = analyzeBase64Transaction(txs[i]);
        localReports.push(rep);
        combinedFlags.push(...rep.threatFlags);
      } catch (err) {
        parseFailureError =
          err instanceof Error ? err.message : "Failed to parse Solana transaction payload.";
        reasons.push(`Transaction #${i + 1} decode error: ${parseFailureError}`);
      }
    }
  }

  // Flag suspiciously large signAllTransactions batch requests
  if (params.walletMethod === "signAllTransactions" && txs.length >= 4) {
    combinedFlags.push({
      code: "UNKNOWN_EXTERNAL_PROGRAM",
      severity: "HIGH",
      title: `Large Batch Sign Request (${txs.length} transactions)`,
      description: `dApp requested signing ${txs.length} transactions at once. Inspect carefully for hidden drain instructions inside the batch.`,
    });
    reasons.push(
      `Batch request attempts to sign ${txs.length} transactions simultaneously.`
    );
  }

  const combinedFlagScore = calculateDeterministicScore(combinedFlags).score;
  const maxReportScore =
    localReports.length > 0
      ? Math.max(...localReports.map((r) => r.deterministicRiskScore))
      : 0;
  const localBaseScore = Math.max(
    maxReportScore,
    combinedFlagScore,
    evmReport?.riskScore ?? 0
  );

  let riskScore = Math.max(localBaseScore, domainEval.riskScore);

  if (params.messageInspection) {
    riskScore = Math.max(riskScore, params.messageInspection.riskScore);
    reasons.push(...params.messageInspection.reasons);
  }

  if (params.walletMethod === "signIn" && params.signInInput) {
    const siwsCheck = inspectOffchainSignIn(params.signInInput, params.hostname);
    riskScore = Math.max(riskScore, siwsCheck.riskScore);
    reasons.push(...siwsCheck.reasons);
  }

  if (parseFailureError) {
    riskScore = Math.max(riskScore, 60);
  }

  for (const flag of combinedFlags) {
    reasons.push(`[${flag.severity}] ${flag.title}: ${flag.description}`);
  }
  for (const domReason of domainEval.reasons) {
    if (!domainEval.isAllowlisted) {
      reasons.push(domReason);
    }
  }

  const remote = params.remote;
  const apiAttempted = Boolean(remote?.attempted);
  const apiVerified = Boolean(remote?.verified);
  const timeoutUnverified = apiAttempted && !apiVerified;

  if (remote?.veniceAudit) {
    riskScore = Math.max(riskScore, remote.veniceAudit.riskScore);
  }

  if (remote?.domainReputation) {
    riskScore = Math.max(riskScore, remote.domainReputation.riskScore);
    if (
      remote.domainReputation.riskLevel === "HIGH" ||
      remote.domainReputation.riskLevel === "CRITICAL"
    ) {
      reasons.push(
        `Venice Privacy Search Domain Alert: ${remote.domainReputation.summary}`
      );
    }
  }

  const rpcSim = remote?.rpcSimulation ?? null;
  let balanceDiffs: SimulatedBalanceDiff[] = rpcSim?.balanceDiffs ?? [];

  if (balanceDiffs.length === 0 && localReports.length > 0) {
    balanceDiffs = localReports.flatMap((rep) =>
      rep.balanceDeltas.map((d) => ({
        address: rep.feePayer,
        asset: d.asset,
        mint: d.mint,
        deltaUiAmount: d.deltaUiAmount,
        direction: d.direction,
        isToken2022: Boolean(d.isToken2022),
      }))
    );
  }

  if (rpcSim) {
    if (rpcSim.authorityChanges.length > 0) {
      riskScore = Math.max(riskScore, 92);
      for (const ch of rpcSim.authorityChanges) {
        reasons.push(
          `[CRITICAL] Live Simulation detected ${ch.changeType} on ${ch.account.slice(0, 6)}..${ch.account.slice(-4)} -> ${ch.after.slice(0, 8)}...`
        );
      }
    }
    if (rpcSim.hiddenCpiPrograms.length > 0) {
      riskScore = Math.max(riskScore, 65);
      reasons.push(
        `Simulation uncovered ${rpcSim.hiddenCpiPrograms.length} nested unverified CPI call(s): ${rpcSim.hiddenCpiPrograms
          .map((c) => `${c.programId.slice(0, 8)}..[depth=${c.depth}]`)
          .join(", ")}.`
      );
    }
    if (rpcSim.status === "SIMULATED_ERROR") {
      riskScore = Math.max(riskScore, 50);
      reasons.push(
        `RPC pre-sign simulation failed on-chain: ${rpcSim.rpcError ?? "Unknown error"}`
      );
    }
    for (const tok of rpcSim.tokenAudits) {
      if (tok.classification === "CRITICAL") {
        riskScore = Math.max(riskScore, 85);
        reasons.push(
          `[CRITICAL TOKEN] ${tok.symbol || tok.mintAddress.slice(0, 8)}: ${tok.executiveSummary}`
        );
      } else if (tok.classification === "CAUTION") {
        riskScore = Math.max(riskScore, 48);
        reasons.push(
          `[TOKEN CAUTION] ${tok.symbol || tok.mintAddress.slice(0, 8)}: ${tok.executiveSummary}`
        );
      }
    }
  }

  if (remote?.evmContractRiskScore) {
    riskScore = Math.max(riskScore, remote.evmContractRiskScore);
  }
  if (remote?.evmContractWarning) {
    reasons.push(remote.evmContractWarning);
  }

  const hasCriticalDeterministic =
    combinedFlags.some((f) => f.severity === "CRITICAL") ||
    (evmReport?.flags.some((f) => f.severity === "CRITICAL") ?? false) ||
    domainEval.status === "TYPOSQUAT_CRITICAL" ||
    (rpcSim?.authorityChanges.length ?? 0) > 0 ||
    (rpcSim?.tokenAudits.some((t) => t.classification === "CRITICAL") ?? false);

  if (timeoutUnverified) {
    reasons.push(
      `Belum terverifikasi server SolShield (${remote?.timedOutOrError || "timeout/offline"}) — keputusan berdasarkan pemeriksaan lokal saja.`
    );
  }

  let decision: ExtensionVerdict["decision"];
  if (hasCriticalDeterministic || riskScore >= 70 || (params.strictMode && timeoutUnverified)) {
    decision = "BLOCK";
  } else if (
    riskScore >= 35 ||
    parseFailureError !== null ||
    domainEval.status === "SUSPICIOUS" ||
    domainEval.status === "UNVERIFIED" ||
    (timeoutUnverified && !domainEval.isAllowlisted)
  ) {
    decision = "WARNING";
  } else {
    decision = "SAFE";
  }

  const headline =
    decision === "BLOCK"
      ? "CRITICAL RISK — TRANSACTION BLOCKED BY SOLSHIELD GUARD"
      : decision === "WARNING"
      ? timeoutUnverified
        ? "CAUTION — UNVERIFIED BY SERVER (LOCAL CHECKS ONLY)"
        : "CAUTION — REVIEW PERMISSIONS BEFORE SIGNING"
      : "VERIFIED SAFE — NO DRAINER SIGNATURES DETECTED";

  return {
    decision,
    chainFamily: isEvmMethod ? "evm" : "solana",
    riskScore: Math.min(99, Math.round(riskScore)),
    headline,
    requiresTypedConfirmation: decision === "BLOCK",
    apiVerified,
    timeoutUnverified,
    walletMethod: params.walletMethod,
    txCount: isEvmMethod ? Math.max(1, evmReport?.decodedCalls.length ?? 1) : txs.length,
    domainEvaluation: domainEval,
    localReports,
    evmReport,
    balanceDiffs,
    tokenAudits: rpcSim?.tokenAudits ?? [],
    reasons: Array.from(new Set(reasons)),
    veniceSummary: remote?.veniceAudit?.executiveSummary ?? null,
    privacyAttestation:
      remote?.veniceAudit?.privacyAttestation ||
      "Dual-Lane Privacy Active: Only ASCII hostname checked for domain reputation; zero browsing history collected.",
  };
}
