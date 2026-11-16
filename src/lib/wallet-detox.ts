import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createRevokeInstruction,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  buildSplDelegateRevokeTransaction,
  PolicyVaultCluster,
  SOLANA_DEVNET_RPC_URL,
  SOLANA_MAINNET_RPC_URL,
} from "./anchor-vault";
import {
  getVerifiedCanonicalAsset,
  parseMetaplexMetadataNameSymbol,
} from "./token-scanner";
import { DEFAULT_VENICE_MODEL, VENICE_API_BASE_URL } from "./venice-ai";

const FALLBACK_MAINNET_RPC_URL = "https://solana-rpc.publicnode.com";
const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const U64_UNLIMITED_THRESHOLD = BigInt("9000000000000000000");

export type DetoxCluster = PolicyVaultCluster;
export type DetoxSeverity = "SAFE" | "CAUTION" | "CRITICAL";
export type DetoxFindingCode =
  | "ACTIVE_UNLIMITED_DELEGATE"
  | "ACTIVE_FULL_BALANCE_DELEGATE"
  | "ACTIVE_SPL_DELEGATE"
  | "TOKEN_2022_PERMANENT_DELEGATE"
  | "TOKEN_2022_UNVERIFIED_TRANSFER_HOOK"
  | "TOKEN_2022_TRANSFER_FEE"
  | "FROZEN_TOKEN_ACCOUNT";

export interface ParsedTokenAccountInput {
  tokenAccount: string;
  mint: string;
  programId: string;
  isToken2022: boolean;
  accountState: "initialized" | "frozen" | "uninitialized";
  balanceRaw: string;
  balanceUi: number;
  decimals: number;
  delegate: string | null;
  delegatedAmountRaw: string | null;
  delegatedAmountUi: number | null;
  permanentDelegate?: string | null;
  transferHookProgramId?: string | null;
  transferFeeBps?: number | null;
  symbol?: string | null;
  name?: string | null;
}

export interface WalletTokenAccountAudit {
  tokenAccount: string;
  mint: string;
  tokenProgram: "SPL Token" | "Token-2022";
  programId: string;
  isToken2022: boolean;
  symbol: string | null;
  name: string | null;
  isCanonicalAsset: boolean;
  canonicalIssuer: string | null;
  accountState: "initialized" | "frozen" | "uninitialized";
  balanceRaw: string;
  balanceUi: number;
  decimals: number;
  delegate: string | null;
  delegatedAmountRaw: string | null;
  delegatedAmountUi: number | null;
  isUnlimitedAllowance: boolean;
  permanentDelegate: string | null;
  transferHookProgramId: string | null;
  transferFeeBps: number | null;
  revocable: boolean;
  severity: DetoxSeverity;
  flags: DetoxFindingCode[];
  summary: string;
}

export interface WalletDetoxReport {
  walletAddress: string;
  cluster: DetoxCluster;
  solBalance: number;
  solLamports: number;
  totalTokenAccounts: number;
  splTokenCount: number;
  token2022Count: number;
  activeDelegateCount: number;
  unlimitedDelegateCount: number;
  permanentDelegateRiskCount: number;
  transferHookRiskCount: number;
  frozenAccountCount: number;
  revocableAccountCount: number;
  healthScore: number;
  riskScore: number;
  classification: DetoxSeverity;
  verdictLabel: string;
  findings: WalletTokenAccountAudit[];
  cleanAccounts: WalletTokenAccountAudit[];
  veniceSummary: string;
  veniceActionPlan: string[];
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  modelUsed: string;
  privacyAttestation: string;
  walletConnectionRequired: false;
  slot: number;
  latencyMs: number;
}

export interface WalletDetoxOptions {
  cluster?: string;
  rpcUrl?: string;
  veniceApiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Optional injected RPC loader for deterministic offline tests. */
  loadWalletSnapshot?: (
    owner: PublicKey,
    cluster: DetoxCluster
  ) => Promise<{
    slot: number;
    solLamports: number;
    accounts: ParsedTokenAccountInput[];
  }>;
}

export interface BatchRevokeSpec {
  tokenAccount: string;
  isToken2022?: boolean;
}

export interface BatchRevokeArtifact {
  owner: string;
  clusterTarget: DetoxCluster;
  instructionCount: number;
  tokenAccounts: string[];
  transactionBase64: string;
  recentBlockhashUsed: string;
}

export function normalizeDetoxCluster(raw?: string | null): DetoxCluster {
  const val = raw?.trim().toLowerCase();
  if (val === "devnet") return "devnet";
  return "mainnet";
}

export function resolveDetoxRpcCandidates(
  cluster: DetoxCluster,
  overrideRpc?: string
): string[] {
  if (overrideRpc?.trim()) return [overrideRpc.trim()];
  if (cluster === "devnet") {
    return [SOLANA_DEVNET_RPC_URL];
  }
  return Array.from(
    new Set([SOLANA_MAINNET_RPC_URL, FALLBACK_MAINNET_RPC_URL])
  );
}

/**
 * Evaluates a single parsed token account (SPL Token or Token-2022) and assigns
 * deterministic severity, actionable flags, and revocability status.
 */
export function evaluateTokenAccountRisk(
  input: ParsedTokenAccountInput
): WalletTokenAccountAudit {
  const canonical = getVerifiedCanonicalAsset(input.mint);
  const symbol = canonical?.symbol ?? input.symbol ?? null;
  const name = canonical?.name ?? input.name ?? null;
  const flags: DetoxFindingCode[] = [];

  let balanceBig = BigInt(0);
  try {
    balanceBig = BigInt(input.balanceRaw || "0");
  } catch {
    balanceBig = BigInt(0);
  }

  let delegatedBig = BigInt(0);
  try {
    if (input.delegatedAmountRaw) {
      delegatedBig = BigInt(input.delegatedAmountRaw);
    }
  } catch {
    delegatedBig = BigInt(0);
  }

  const hasDelegate = Boolean(input.delegate && input.delegate.trim().length > 0);
  const isUnlimitedAllowance =
    hasDelegate && delegatedBig >= U64_UNLIMITED_THRESHOLD;
  const coversFullBalance =
    hasDelegate &&
    !isUnlimitedAllowance &&
    balanceBig > BigInt(0) &&
    delegatedBig >= balanceBig;

  if (hasDelegate) {
    if (isUnlimitedAllowance) {
      flags.push("ACTIVE_UNLIMITED_DELEGATE");
    } else if (coversFullBalance) {
      flags.push("ACTIVE_FULL_BALANCE_DELEGATE");
    } else {
      flags.push("ACTIVE_SPL_DELEGATE");
    }
  }

  if (
    input.isToken2022 &&
    input.permanentDelegate &&
    !canonical?.custodialIssuerAuthorities
  ) {
    flags.push("TOKEN_2022_PERMANENT_DELEGATE");
  }

  if (
    input.isToken2022 &&
    input.transferHookProgramId &&
    !canonical?.custodialIssuerAuthorities
  ) {
    flags.push("TOKEN_2022_UNVERIFIED_TRANSFER_HOOK");
  }

  if (
    input.isToken2022 &&
    typeof input.transferFeeBps === "number" &&
    input.transferFeeBps > 500
  ) {
    flags.push("TOKEN_2022_TRANSFER_FEE");
  }

  if (input.accountState === "frozen") {
    flags.push("FROZEN_TOKEN_ACCOUNT");
  }

  let severity: DetoxSeverity = "SAFE";
  if (
    flags.includes("ACTIVE_UNLIMITED_DELEGATE") ||
    flags.includes("ACTIVE_FULL_BALANCE_DELEGATE") ||
    flags.includes("TOKEN_2022_PERMANENT_DELEGATE") ||
    flags.includes("TOKEN_2022_UNVERIFIED_TRANSFER_HOOK")
  ) {
    severity = "CRITICAL";
  } else if (
    flags.includes("ACTIVE_SPL_DELEGATE") ||
    flags.includes("TOKEN_2022_TRANSFER_FEE") ||
    flags.includes("FROZEN_TOKEN_ACCOUNT")
  ) {
    severity = "CAUTION";
  }

  const label = symbol ? `$${symbol}` : `${input.mint.slice(0, 6)}...`;
  const summaryParts: string[] = [];

  if (isUnlimitedAllowance && input.delegate) {
    summaryParts.push(
      `Unlimited delegate allowance granted to ${input.delegate.slice(0, 8)}... for ${label}.`
    );
  } else if (coversFullBalance && input.delegate) {
    summaryParts.push(
      `Full-balance delegate (${input.delegatedAmountUi ?? 0} ${label}) active for ${input.delegate.slice(0, 8)}...`
    );
  } else if (hasDelegate && input.delegate) {
    summaryParts.push(
      `Active spender delegate (${input.delegatedAmountUi ?? 0} ${label}) assigned to ${input.delegate.slice(0, 8)}...`
    );
  }

  if (flags.includes("TOKEN_2022_PERMANENT_DELEGATE") && input.permanentDelegate) {
    summaryParts.push(
      `Unverified Token-2022 PermanentDelegate (${input.permanentDelegate.slice(0, 8)}...) can seize/burn ${label} regardless of wallet revocation.`
    );
  }

  if (
    flags.includes("TOKEN_2022_UNVERIFIED_TRANSFER_HOOK") &&
    input.transferHookProgramId
  ) {
    summaryParts.push(
      `TransferHook CPI (${input.transferHookProgramId.slice(0, 8)}...) runs arbitrary code on every transfer.`
    );
  }

  if (flags.includes("TOKEN_2022_TRANSFER_FEE") && input.transferFeeBps != null) {
    summaryParts.push(
      `Token-2022 transfer tax of ${(input.transferFeeBps / 100).toFixed(2)}% enforced at mint level.`
    );
  }

  if (flags.includes("FROZEN_TOKEN_ACCOUNT")) {
    summaryParts.push("Token account state is currently FROZEN by mint authority.");
  }

  if (summaryParts.length === 0) {
    if (canonical?.custodialIssuerAuthorities) {
      summaryParts.push(
        `Canonical ${canonical.issuer} ${label} account with zero user-granted delegates.`
      );
    } else {
      summaryParts.push(`No active delegate or high-risk extensions on ${label}.`);
    }
  }

  const revocable = hasDelegate && input.accountState !== "frozen";

  return {
    tokenAccount: input.tokenAccount,
    mint: input.mint,
    tokenProgram: input.isToken2022 ? "Token-2022" : "SPL Token",
    programId: input.programId,
    isToken2022: input.isToken2022,
    symbol,
    name,
    isCanonicalAsset: Boolean(canonical),
    canonicalIssuer: canonical?.issuer ?? null,
    accountState: input.accountState,
    balanceRaw: input.balanceRaw,
    balanceUi: input.balanceUi,
    decimals: input.decimals,
    delegate: input.delegate,
    delegatedAmountRaw: input.delegatedAmountRaw,
    delegatedAmountUi: input.delegatedAmountUi,
    isUnlimitedAllowance,
    permanentDelegate: input.permanentDelegate ?? null,
    transferHookProgramId: input.transferHookProgramId ?? null,
    transferFeeBps: input.transferFeeBps ?? null,
    revocable,
    severity,
    flags,
    summary: summaryParts.join(" "),
  };
}

function severityOrder(s: DetoxSeverity): number {
  if (s === "CRITICAL") return 0;
  if (s === "CAUTION") return 1;
  return 2;
}

function extractParsedTokenAccountInputs(
  rawAccounts: Array<{
    pubkey: PublicKey;
    account: { data: unknown };
  }>,
  programId: PublicKey,
  isToken2022: boolean
): ParsedTokenAccountInput[] {
  const results: ParsedTokenAccountInput[] = [];

  for (const item of rawAccounts) {
    const parsedData = item.account?.data as
      | {
          parsed?: {
            info?: {
              mint?: string;
              state?: string;
              tokenAmount?: {
                amount?: string;
                decimals?: number;
                uiAmount?: number | null;
                uiAmountString?: string;
              };
              delegate?: string;
              delegatedAmount?: {
                amount?: string;
                decimals?: number;
                uiAmount?: number | null;
                uiAmountString?: string;
              };
            };
          };
        }
      | undefined;

    const info = parsedData?.parsed?.info;
    if (!info || typeof info.mint !== "string") continue;

    const rawState = (info.state || "initialized").toLowerCase();
    const accountState: "initialized" | "frozen" | "uninitialized" =
      rawState === "frozen"
        ? "frozen"
        : rawState === "uninitialized"
        ? "uninitialized"
        : "initialized";

    const balanceRaw = String(info.tokenAmount?.amount ?? "0");
    const decimals = Number(info.tokenAmount?.decimals ?? 0);
    const balanceUi =
      typeof info.tokenAmount?.uiAmount === "number"
        ? info.tokenAmount.uiAmount
        : Number(info.tokenAmount?.uiAmountString ?? 0) || 0;

    const delegate =
      typeof info.delegate === "string" && info.delegate.trim().length > 0
        ? info.delegate.trim()
        : null;

    const delegatedAmountRaw =
      delegate && info.delegatedAmount?.amount
        ? String(info.delegatedAmount.amount)
        : null;
    const delegatedAmountUi = delegate
      ? typeof info.delegatedAmount?.uiAmount === "number"
        ? info.delegatedAmount.uiAmount
        : Number(info.delegatedAmount?.uiAmountString ?? 0) || 0
      : null;

    results.push({
      tokenAccount: item.pubkey.toBase58(),
      mint: info.mint,
      programId: programId.toBase58(),
      isToken2022,
      accountState,
      balanceRaw,
      balanceUi,
      decimals,
      delegate,
      delegatedAmountRaw,
      delegatedAmountUi,
    });
  }

  return results;
}

async function enrichToken2022AndMetadata(
  connection: Connection,
  accounts: ParsedTokenAccountInput[]
): Promise<void> {
  if (accounts.length === 0) return;

  // 1. Batch-fetch Token-2022 Mint accounts to detect mint-level PermanentDelegate / TransferHook
  const token2022Mints = Array.from(
    new Set(accounts.filter((a) => a.isToken2022).map((a) => a.mint))
  ).slice(0, 50);

  if (token2022Mints.length > 0) {
    try {
      const mintPubkeys = token2022Mints.map((m) => new PublicKey(m));
      const mintInfos = await connection.getMultipleAccountsInfo(
        mintPubkeys,
        "confirmed"
      );
      const mintExtMap = new Map<
        string,
        {
          permanentDelegate: string | null;
          transferHookProgramId: string | null;
          transferFeeBps: number | null;
        }
      >();

      for (let i = 0; i < token2022Mints.length; i++) {
        const mintAddr = token2022Mints[i];
        const accInfo = mintInfos[i];
        if (!accInfo) continue;

        try {
          const unpacked = unpackMint(
            new PublicKey(mintAddr),
            accInfo,
            TOKEN_2022_PROGRAM_ID
          );
          const permDelegate = getPermanentDelegate(unpacked);
          const transferHook = getTransferHook(unpacked);
          const transferFee = getTransferFeeConfig(unpacked);

          mintExtMap.set(mintAddr, {
            permanentDelegate: permDelegate?.delegate
              ? permDelegate.delegate.toBase58()
              : null,
            transferHookProgramId: transferHook?.programId
              ? transferHook.programId.toBase58()
              : null,
            transferFeeBps: transferFee?.newerTransferFee?.transferFeeBasisPoints ?? null,
          });
        } catch {
          // Ignore malformed mint account buffers
        }
      }

      for (const acc of accounts) {
        if (!acc.isToken2022) continue;
        const ext = mintExtMap.get(acc.mint);
        if (ext) {
          acc.permanentDelegate = ext.permanentDelegate;
          acc.transferHookProgramId = ext.transferHookProgramId;
          acc.transferFeeBps = ext.transferFeeBps;
        }
      }
    } catch {
      // Non-fatal: continue with parsed token account data
    }
  }

  // 2. Resolve Metaplex name/symbol only for non-canonical mints that appear risky or active
  // (capped at 25 to avoid RPC pressure on large airdrop wallets)
  const mintsNeedingMeta = Array.from(
    new Set(
      accounts
        .filter(
          (a) =>
            !getVerifiedCanonicalAsset(a.mint) &&
            (Boolean(a.delegate) || a.isToken2022 || a.balanceUi > 0)
        )
        .map((a) => a.mint)
    )
  ).slice(0, 25);

  if (mintsNeedingMeta.length > 0) {
    try {
      const pdaKeys = mintsNeedingMeta.map((mintStr) => {
        const [pda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("metadata"),
            METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
            new PublicKey(mintStr).toBuffer(),
          ],
          METAPLEX_METADATA_PROGRAM_ID
        );
        return pda;
      });

      const metaInfos = await connection.getMultipleAccountsInfo(
        pdaKeys,
        "confirmed"
      );
      const metaMap = new Map<string, { name: string | null; symbol: string | null }>();

      for (let i = 0; i < mintsNeedingMeta.length; i++) {
        const info = metaInfos[i];
        if (!info?.data) continue;
        metaMap.set(
          mintsNeedingMeta[i],
          parseMetaplexMetadataNameSymbol(info.data)
        );
      }

      for (const acc of accounts) {
        const meta = metaMap.get(acc.mint);
        if (meta) {
          acc.name = acc.name ?? meta.name;
          acc.symbol = acc.symbol ?? meta.symbol;
        }
      }
    } catch {
      // Optional enrichment; safe to omit if RPC drops metadata lookup
    }
  }
}

async function fetchLiveWalletSnapshot(
  owner: PublicKey,
  cluster: DetoxCluster,
  overrideRpc?: string
): Promise<{
  slot: number;
  solLamports: number;
  accounts: ParsedTokenAccountInput[];
}> {
  const candidates = resolveDetoxRpcCandidates(cluster, overrideRpc);
  let lastError: Error | null = null;

  for (const rpcUrl of candidates) {
    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const [slot, solLamports, splResp, token2022Resp] = await Promise.all([
        connection.getSlot("confirmed"),
        connection.getBalance(owner, "confirmed"),
        connection.getParsedTokenAccountsByOwner(
          owner,
          { programId: TOKEN_PROGRAM_ID },
          "confirmed"
        ),
        connection.getParsedTokenAccountsByOwner(
          owner,
          { programId: TOKEN_2022_PROGRAM_ID },
          "confirmed"
        ),
      ]);

      const splInputs = extractParsedTokenAccountInputs(
        splResp.value,
        TOKEN_PROGRAM_ID,
        false
      );
      const token2022Inputs = extractParsedTokenAccountInputs(
        token2022Resp.value,
        TOKEN_2022_PROGRAM_ID,
        true
      );

      const allAccounts = [...splInputs, ...token2022Inputs];
      await enrichToken2022AndMetadata(connection, allAccounts);

      return {
        slot,
        solLamports,
        accounts: allAccounts,
      };
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error("Solana RPC wallet scan failed");
    }
  }

  throw lastError ?? new Error("All Solana RPC endpoints failed for wallet audit.");
}

function computeWalletHealthScore(findings: WalletTokenAccountAudit[]): {
  healthScore: number;
  riskScore: number;
  classification: DetoxSeverity;
  verdictLabel: string;
} {
  let deduction = 0;

  for (const item of findings) {
    if (item.flags.includes("ACTIVE_UNLIMITED_DELEGATE")) deduction += 30;
    else if (item.flags.includes("ACTIVE_FULL_BALANCE_DELEGATE")) deduction += 24;
    else if (item.flags.includes("ACTIVE_SPL_DELEGATE")) deduction += 14;

    if (item.flags.includes("TOKEN_2022_PERMANENT_DELEGATE")) deduction += 25;
    if (item.flags.includes("TOKEN_2022_UNVERIFIED_TRANSFER_HOOK")) deduction += 18;
    if (item.flags.includes("FROZEN_TOKEN_ACCOUNT")) deduction += 8;
  }

  const healthScore = Math.max(0, Math.min(100, 100 - deduction));
  const riskScore = 100 - healthScore;

  if (
    healthScore <= 55 ||
    findings.some((f) => f.severity === "CRITICAL")
  ) {
    return {
      healthScore,
      riskScore,
      classification: "CRITICAL",
      verdictLabel: "High Drain Exposure",
    };
  }

  if (healthScore < 90 || findings.length > 0) {
    return {
      healthScore,
      riskScore,
      classification: "CAUTION",
      verdictLabel: "Active Allowances Detected",
    };
  }

  return {
    healthScore: 100,
    riskScore: 0,
    classification: "SAFE",
    verdictLabel: "Clean Approval Surface",
  };
}

function buildDeterministicDetoxBriefing(params: {
  totalTokenAccounts: number;
  findings: WalletTokenAccountAudit[];
  activeDelegateCount: number;
  unlimitedDelegateCount: number;
  permanentDelegateRiskCount: number;
  transferHookRiskCount: number;
}): { summary: string; actionPlan: string[] } {
  const {
    totalTokenAccounts,
    findings,
    activeDelegateCount,
    unlimitedDelegateCount,
    permanentDelegateRiskCount,
    transferHookRiskCount,
  } = params;

  if (findings.length === 0) {
    return {
      summary: `Scanned ${totalTokenAccounts} SPL & Token-2022 accounts in read-only mode: 0 active delegates and 0 unverified Token-2022 clawback extensions detected.`,
      actionPlan: [
        "No spender revocations required — your token allowances are completely clean.",
        "Keep wallet approvals clean by verifying future dApp prompts with SolShield Pre-Flight before signing.",
      ],
    };
  }

  const parts: string[] = [];
  if (activeDelegateCount > 0) {
    parts.push(
      `${activeDelegateCount} token account${activeDelegateCount > 1 ? "s carry" : " carries"} an active delegate spender (${unlimitedDelegateCount} unlimited)`
    );
  }
  if (permanentDelegateRiskCount > 0) {
    parts.push(
      `${permanentDelegateRiskCount} unverified Token-2022 asset${permanentDelegateRiskCount > 1 ? "s enforce" : " enforces"} a mint-level PermanentDelegate clawback`
    );
  }
  if (transferHookRiskCount > 0) {
    parts.push(
      `${transferHookRiskCount} token${transferHookRiskCount > 1 ? "s include" : " includes"} an unverified TransferHook CPI program`
    );
  }

  const actionPlan: string[] = [];
  const revocable = findings.filter((f) => f.revocable);
  if (revocable.length > 0) {
    actionPlan.push(
      `Revoke ${revocable.length} active SPL/Token-2022 delegate approval${revocable.length > 1 ? "s" : ""} using the 1-Click Revoke controls below (Instruction Tag 5).`
    );
  }
  if (permanentDelegateRiskCount > 0) {
    actionPlan.push(
      "Do NOT rely on delegate revocation for unverified PermanentDelegate tokens — move legitimate balances or avoid signing prompts involving those scam/airdrop mints."
    );
  }
  if (transferHookRiskCount > 0) {
    actionPlan.push(
      "Inspect unverified TransferHook tokens in SolShield Token X-Ray before transferring so custom CPI hooks cannot drain SOL fees."
    );
  }
  if (actionPlan.length === 0) {
    actionPlan.push("Review frozen or flagged token accounts listed below.");
  }

  return {
    summary: `Exposed approval surface detected: ${parts.join("; ")}.`,
    actionPlan,
  };
}

const WALLET_DETOX_SYSTEM_PROMPT = `You are SolShield Wallet Detox AI running on Venice AI Zero Data Retention private inference.
Explain the audited wallet's on-chain SPL and Token-2022 exposure strictly from the anonymized structural JSON telemetry provided (never fabricate mint names, delegates, or balances).
Rules:
- Distinguish clearly between revocable SPL/Token-2022 delegate allowances (which the user can clear with Instruction Tag 5 Revoke) and non-revocable mint-level Token-2022 PermanentDelegate / TransferHook extensions.
- Keep output crisp, plain English, and actionable.
Respond ONLY with valid JSON matching:
{
  "veniceSummary": "<1-2 concise sentences summarizing exact exposure>",
  "veniceActionPlan": ["<step 1>", "<step 2>"]
}`;

async function synthesizeDetoxWithVenice(
  reportCore: {
    cluster: DetoxCluster;
    totalTokenAccounts: number;
    findings: WalletTokenAccountAudit[];
    activeDelegateCount: number;
    unlimitedDelegateCount: number;
    permanentDelegateRiskCount: number;
    transferHookRiskCount: number;
    healthScore: number;
  },
  options: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<{
  summary: string;
  actionPlan: string[];
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  modelUsed: string;
}> {
  const deterministic = buildDeterministicDetoxBriefing(reportCore);
  const apiKey =
    options.apiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
  const model = options.model?.trim() || DEFAULT_VENICE_MODEL;

  // Cost & latency guard: clean wallets require 0 AI tokens
  if (reportCore.findings.length === 0 || !apiKey) {
    return {
      summary: deterministic.summary,
      actionPlan: deterministic.actionPlan,
      inferenceMode: "deterministic-fallback",
      modelUsed: "solshield-detox-deterministic-v1",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000
  );

  try {
    // Strip wallet owner address before leaving server for defense-in-depth anonymity
    const anonymizedFindings = reportCore.findings.slice(0, 12).map((f) => ({
      tokenProgram: f.tokenProgram,
      symbol: f.symbol ?? f.mint.slice(0, 6),
      isCanonicalAsset: f.isCanonicalAsset,
      balanceUi: f.balanceUi,
      delegatedAmountUi: f.delegatedAmountUi,
      isUnlimitedAllowance: f.isUnlimitedAllowance,
      hasPermanentDelegate: Boolean(f.permanentDelegate),
      hasTransferHook: Boolean(f.transferHookProgramId),
      revocable: f.revocable,
      severity: f.severity,
      flags: f.flags,
    }));

    const res = await fetchImpl(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 450,
        venice_parameters: {
          include_venice_system_prompt: false,
        },
        messages: [
          { role: "system", content: WALLET_DETOX_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              cluster: reportCore.cluster,
              totalTokenAccounts: reportCore.totalTokenAccounts,
              healthScore: reportCore.healthScore,
              activeDelegateCount: reportCore.activeDelegateCount,
              unlimitedDelegateCount: reportCore.unlimitedDelegateCount,
              permanentDelegateRiskCount: reportCore.permanentDelegateRiskCount,
              transferHookRiskCount: reportCore.transferHookRiskCount,
              findings: anonymizedFindings,
            }),
          },
        ],
      }),
    });

    if (!res.ok) {
      return {
        summary: deterministic.summary,
        actionPlan: deterministic.actionPlan,
        inferenceMode: "deterministic-fallback",
        modelUsed: "solshield-detox-deterministic-v1",
      };
    }

    const data = await res.json();
    const rawContent: string =
      data?.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        summary: deterministic.summary,
        actionPlan: deterministic.actionPlan,
        inferenceMode: "deterministic-fallback",
        modelUsed: "solshield-detox-deterministic-v1",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const veniceSummary =
      typeof parsed.veniceSummary === "string" &&
      parsed.veniceSummary.trim().length > 0
        ? parsed.veniceSummary.trim()
        : deterministic.summary;
    const veniceActionPlan = Array.isArray(parsed.veniceActionPlan)
      ? parsed.veniceActionPlan
          .map((item: unknown) => String(item).trim())
          .filter(Boolean)
          .slice(0, 5)
      : deterministic.actionPlan;

    return {
      summary: veniceSummary,
      actionPlan:
        veniceActionPlan.length > 0 ? veniceActionPlan : deterministic.actionPlan,
      inferenceMode: "venice-live-api",
      modelUsed: data?.model || model,
    };
  } catch {
    return {
      summary: deterministic.summary,
      actionPlan: deterministic.actionPlan,
      inferenceMode: "deterministic-fallback",
      modelUsed: "solshield-detox-deterministic-v1",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Performs a read-only zero-retention audit of a Solana wallet's SOL, SPL Token,
 * and Token-2022 accounts to uncover lingering delegates and risky extensions.
 * No wallet connection or signature is required.
 */
export async function auditWalletApprovals(
  rawAddress: string,
  options: WalletDetoxOptions = {}
): Promise<WalletDetoxReport> {
  const startedAt = Date.now();
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    throw new Error("Please provide a Solana wallet address to inspect.");
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(trimmed);
  } catch {
    throw new Error("Invalid Solana Base58 wallet address.");
  }

  const cluster = normalizeDetoxCluster(options.cluster);
  const snapshot = options.loadWalletSnapshot
    ? await options.loadWalletSnapshot(owner, cluster)
    : await fetchLiveWalletSnapshot(owner, cluster, options.rpcUrl);

  const evaluated = snapshot.accounts.map(evaluateTokenAccountRisk);
  const findings = evaluated
    .filter((a) => a.flags.length > 0)
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  const cleanAccounts = evaluated.filter((a) => a.flags.length === 0);

  const splTokenCount = evaluated.filter((a) => !a.isToken2022).length;
  const token2022Count = evaluated.filter((a) => a.isToken2022).length;
  const activeDelegateCount = evaluated.filter((a) => Boolean(a.delegate)).length;
  const unlimitedDelegateCount = evaluated.filter(
    (a) => a.isUnlimitedAllowance
  ).length;
  const permanentDelegateRiskCount = evaluated.filter((a) =>
    a.flags.includes("TOKEN_2022_PERMANENT_DELEGATE")
  ).length;
  const transferHookRiskCount = evaluated.filter((a) =>
    a.flags.includes("TOKEN_2022_UNVERIFIED_TRANSFER_HOOK")
  ).length;
  const frozenAccountCount = evaluated.filter(
    (a) => a.accountState === "frozen"
  ).length;
  const revocableAccountCount = evaluated.filter((a) => a.revocable).length;

  const { healthScore, riskScore, classification, verdictLabel } =
    computeWalletHealthScore(findings);

  const briefing = await synthesizeDetoxWithVenice(
    {
      cluster,
      totalTokenAccounts: evaluated.length,
      findings,
      activeDelegateCount,
      unlimitedDelegateCount,
      permanentDelegateRiskCount,
      transferHookRiskCount,
      healthScore,
    },
    {
      apiKey: options.veniceApiKey,
      model: options.model,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    }
  );

  return {
    walletAddress: owner.toBase58(),
    cluster,
    solBalance: Number((snapshot.solLamports / 1e9).toFixed(6)),
    solLamports: snapshot.solLamports,
    totalTokenAccounts: evaluated.length,
    splTokenCount,
    token2022Count,
    activeDelegateCount,
    unlimitedDelegateCount,
    permanentDelegateRiskCount,
    transferHookRiskCount,
    frozenAccountCount,
    revocableAccountCount,
    healthScore,
    riskScore,
    classification,
    verdictLabel,
    findings,
    cleanAccounts,
    veniceSummary: briefing.summary,
    veniceActionPlan: briefing.actionPlan,
    inferenceMode: briefing.inferenceMode,
    modelUsed: briefing.modelUsed,
    privacyAttestation:
      "Zero Data Retention — read-only Solana RPC inspection; wallet addresses and holdings are never persisted in any SolShield database, Redis cache, or Venice prompt log.",
    walletConnectionRequired: false,
    slot: snapshot.slot,
    latencyMs: Math.max(1, Date.now() - startedAt),
  };
}

/**
 * Builds an unsigned single or atomic multi-instruction `Revoke` transaction
 * (Instruction Tag 5) across up to 8 SPL Token / Token-2022 accounts so users can
 * detox their wallet in a single wallet signature.
 */
export async function buildBatchSplDelegateRevokeTransaction(params: {
  owner: string;
  targets: BatchRevokeSpec[];
  cluster?: DetoxCluster;
  recentBlockhash?: string;
  rpcUrl?: string;
}): Promise<BatchRevokeArtifact> {
  const ownerKey = new PublicKey(params.owner.trim());
  const cluster = params.cluster ?? "mainnet";
  const targets = params.targets.slice(0, 8);
  if (targets.length === 0) {
    throw new Error("At least one revocable token account must be provided.");
  }

  let recentBlockhash = params.recentBlockhash?.trim() || "";
  if (!recentBlockhash) {
    const candidates = resolveDetoxRpcCandidates(cluster, params.rpcUrl);
    for (const rpcUrl of candidates) {
      try {
        const connection = new Connection(rpcUrl, "confirmed");
        const latest = await connection.getLatestBlockhash("confirmed");
        recentBlockhash = latest.blockhash;
        break;
      } catch {
        // Try next RPC candidate
      }
    }
  }

  if (targets.length === 1) {
    const single = buildSplDelegateRevokeTransaction({
      tokenAccount: targets[0].tokenAccount,
      owner: ownerKey,
      useToken2022: targets[0].isToken2022,
      recentBlockhash: recentBlockhash || undefined,
      clusterTarget: cluster,
    });
    return {
      owner: ownerKey.toBase58(),
      clusterTarget: cluster,
      instructionCount: 1,
      tokenAccounts: [new PublicKey(targets[0].tokenAccount).toBase58()],
      transactionBase64: single.transactionBase64,
      recentBlockhashUsed: single.recentBlockhashUsed,
    };
  }

  const blockhashUsed = recentBlockhash || "11111111111111111111111111111111";
  const tx = new Transaction({
    feePayer: ownerKey,
    recentBlockhash: blockhashUsed,
  });

  const normalizedAccounts: string[] = [];
  for (const target of targets) {
    const tokenAccountKey = new PublicKey(target.tokenAccount.trim());
    normalizedAccounts.push(tokenAccountKey.toBase58());
    const ix: TransactionInstruction = createRevokeInstruction(
      tokenAccountKey,
      ownerKey,
      [],
      target.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );
    tx.add(ix);
  }

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    owner: ownerKey.toBase58(),
    clusterTarget: cluster,
    instructionCount: targets.length,
    tokenAccounts: normalizedAccounts,
    transactionBase64: Buffer.from(serialized).toString("base64"),
    recentBlockhashUsed: blockhashUsed,
  };
}
