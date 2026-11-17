/**
 * Multi-Chain EVM Approval & Permit2 Detox Engine
 *
 * Read-only zero-retention scanner for ERC-20 `approve()` allowances and
 * Uniswap Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) permissions
 * across Robinhood Chain L2, Ethereum, Base, Arbitrum, Optimism, Polygon, and BSC.
 * Builds non-custodial `approve(spender, 0)` & Permit2 `lockdown()` revocation calldata.
 */

import {
  decodeAbiAddressSlot,
  decodeAbiString,
  decodeAbiUint256,
  encodeErc20ApproveZero,
  encodePermit2Lockdown,
  EVM_CHAINS,
  EvmChainKey,
  evmRpcCall,
  isValidEvmAddress,
  normalizeEvmAddress,
  padAddress32,
  PERMIT2_SINGLETON,
  resolveEvmChainConfig,
} from "./evm-security";
import { DEFAULT_VENICE_MODEL, VENICE_API_BASE_URL } from "./venice-ai";

const ERC20_APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const PERMIT2_APPROVAL_TOPIC =
  "0xc6a377bfc4eb120024a8ac08eef205be16b817020812c73223e81d1bdb9708ec";

const ERC20_UNLIMITED_THRESHOLD = BigInt(1) << BigInt(250);
const PERMIT2_UNLIMITED_THRESHOLD = BigInt(1) << BigInt(155);

export type EvmDetoxSeverity = "SAFE" | "CAUTION" | "CRITICAL";
export type EvmDetoxApprovalKind = "erc20" | "permit2";

export interface EvmParsedAllowanceInput {
  kind: EvmDetoxApprovalKind;
  tokenAddress: string;
  spenderAddress: string;
  allowanceRaw: string;
  decimals?: number;
  balanceRaw?: string;
  symbol?: string | null;
  name?: string | null;
  spenderLabel?: string | null;
  spenderTrusted?: boolean;
  spenderIsContract?: boolean | null;
  permit2Expiration?: number | null;
  permit2Nonce?: number | null;
}

export interface EvmDetoxAllowanceAudit {
  id: string;
  kind: EvmDetoxApprovalKind;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  decimals: number;
  balanceRaw: string;
  balanceUi: number;
  spenderAddress: string;
  spenderLabel: string | null;
  spenderTrusted: boolean;
  spenderIsContract: boolean | null;
  allowanceRaw: string;
  allowanceUi: number | null;
  isUnlimited: boolean;
  permit2Expiration: number | null;
  permit2Nonce: number | null;
  severity: EvmDetoxSeverity;
  flags: string[];
  summary: string;
}

export interface EvmDetoxReport {
  chainFamily: "evm";
  walletAddress: string;
  chainKey: EvmChainKey;
  chainId: number;
  chainIdHex: string;
  networkName: string;
  explorerUrl: string;
  nativeSymbol: string;
  nativeBalance: number;
  blockNumber: number;
  tokensScannedCount: number;
  spendersCheckedCount: number;
  activeApprovalCount: number;
  unlimitedApprovalCount: number;
  permit2ApprovalCount: number;
  eoaSpenderCount: number;
  healthScore: number;
  riskScore: number;
  classification: EvmDetoxSeverity;
  verdictLabel: string;
  findings: EvmDetoxAllowanceAudit[];
  scannedTokens: Array<{
    tokenAddress: string;
    symbol: string | null;
    name: string | null;
    decimals: number;
    balanceUi: number;
  }>;
  veniceSummary: string;
  veniceActionPlan: string[];
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  modelUsed: string;
  privacyAttestation: string;
  walletConnectionRequired: false;
  latencyMs: number;
}

export interface EvmRevokeTargetSpec {
  kind: EvmDetoxApprovalKind;
  tokenAddress: string;
  spenderAddress: string;
}

export interface EvmRevokeTxSpec {
  id: string;
  kind: EvmDetoxApprovalKind;
  label: string;
  to: string;
  data: string;
  value: "0x0";
  chainId: number;
  chainIdHex: string;
  networkName: string;
  tokenAddress: string;
  spenderAddress: string;
}

export interface EvmRevokeArtifact {
  chainFamily: "evm";
  owner: string;
  chainKey: EvmChainKey;
  chainId: number;
  chainIdHex: string;
  networkName: string;
  txCount: number;
  transactions: EvmRevokeTxSpec[];
}

export interface AuditEvmDetoxOptions {
  chain?: string | number | null;
  rpcUrl?: string;
  veniceApiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  additionalTokens?: string[];
  additionalSpenders?: string[];
  loadEvmSnapshot?: (
    owner: string,
    chainKey: EvmChainKey
  ) => Promise<{
    blockNumber: number;
    nativeBalanceWei: bigint;
    allowances: EvmParsedAllowanceInput[];
    scannedTokens?: EvmDetoxReport["scannedTokens"];
  }>;
}

function formatBigIntDecimalUi(raw: string, decimals: number): number {
  try {
    const val = BigInt(raw);
    if (val === 0n) return 0;
    const clampedDec = Math.max(0, Math.min(36, Math.trunc(decimals || 18)));
    const divisor = 10n ** BigInt(clampedDec);
    const whole = val / divisor;
    if (whole > 1_000_000_000_000n) return Number.POSITIVE_INFINITY;
    const rem = val % divisor;
    const frac = Number(rem) / Number(divisor);
    return Number((Number(whole) + frac).toFixed(6));
  } catch {
    return 0;
  }
}

export function evaluateEvmAllowanceRisk(
  input: EvmParsedAllowanceInput
): EvmDetoxAllowanceAudit {
  const tokenAddress = normalizeEvmAddress(input.tokenAddress);
  const spenderAddress = normalizeEvmAddress(input.spenderAddress);
  const decimals = Math.max(0, Math.min(36, input.decimals ?? 18));
  const rawAllowance = BigInt(input.allowanceRaw || "0");
  const balanceRaw = input.balanceRaw || "0";
  const balanceUi = formatBigIntDecimalUi(balanceRaw, decimals);

  const isUnlimited =
    input.kind === "permit2"
      ? rawAllowance >= PERMIT2_UNLIMITED_THRESHOLD
      : rawAllowance >= ERC20_UNLIMITED_THRESHOLD;

  const allowanceUi = isUnlimited
    ? null
    : formatBigIntDecimalUi(rawAllowance.toString(), decimals);

  const flags: string[] = [];
  let severity: EvmDetoxSeverity = "SAFE";

  if (input.spenderIsContract === false) {
    severity = "CRITICAL";
    flags.push("EOA_SPENDER_APPROVAL");
  }

  if (input.kind === "permit2") {
    flags.push("PERMIT2_ACTIVE_ALLOWANCE");
    if (isUnlimited) {
      severity = "CRITICAL";
      flags.push("UNLIMITED_PERMIT2_ALLOWANCE");
    } else if (!input.spenderTrusted && severity !== "CRITICAL") {
      severity = "CAUTION";
    }
  } else if (isUnlimited) {
    severity = !input.spenderTrusted || input.spenderIsContract === false
      ? "CRITICAL"
      : "CAUTION";
    flags.push("UNLIMITED_ERC20_ALLOWANCE");
  } else if (rawAllowance > 0n) {
    flags.push("ACTIVE_ERC20_ALLOWANCE");
    if (!input.spenderTrusted && severity !== "CRITICAL") {
      severity = "CAUTION";
    }
  }

  const label = input.symbol ? `$${input.symbol}` : tokenAddress.slice(0, 10);
  const spenderDesc = input.spenderLabel
    ? `${input.spenderLabel} (${spenderAddress.slice(0, 8)}...)`
    : `${spenderAddress.slice(0, 8)}...${spenderAddress.slice(-4)}`;

  const scopeWord = isUnlimited
    ? "UNLIMITED"
    : `${allowanceUi !== null ? allowanceUi.toLocaleString("en-US") : "Bounded"}`;

  let summary = "";
  if (input.spenderIsContract === false) {
    summary = `CRITICAL: ${label} grants ${scopeWord} ${input.kind.toUpperCase()} allowance to an externally owned wallet (EOA ${spenderDesc}) instead of a verified DEX contract.`;
  } else if (isUnlimited) {
    summary = `${
      severity === "CRITICAL" ? "CRITICAL" : "CAUTION"
    }: ${label} exposes UNLIMITED ${input.kind.toUpperCase()} spending power to ${spenderDesc}.`;
  } else {
    summary = `Active ${input.kind.toUpperCase()} allowance of ${scopeWord} on ${label} granted to ${spenderDesc}.`;
  }

  return {
    id: `${input.kind}:${tokenAddress}:${spenderAddress}`,
    kind: input.kind,
    tokenAddress,
    tokenSymbol: input.symbol ?? null,
    tokenName: input.name ?? null,
    decimals,
    balanceRaw,
    balanceUi: Number.isFinite(balanceUi) ? balanceUi : 0,
    spenderAddress,
    spenderLabel: input.spenderLabel ?? null,
    spenderTrusted: Boolean(input.spenderTrusted),
    spenderIsContract: input.spenderIsContract ?? null,
    allowanceRaw: rawAllowance.toString(),
    allowanceUi,
    isUnlimited,
    permit2Expiration: input.permit2Expiration ?? null,
    permit2Nonce: input.permit2Nonce ?? null,
    severity,
    flags,
    summary,
  };
}

function computeEvmHealthScore(findings: EvmDetoxAllowanceAudit[]): {
  healthScore: number;
  riskScore: number;
  classification: EvmDetoxSeverity;
  verdictLabel: string;
} {
  if (findings.length === 0) {
    return {
      healthScore: 100,
      riskScore: 0,
      classification: "SAFE",
      verdictLabel: "HYGIENE CLEAN",
    };
  }

  let penalty = 0;
  for (const f of findings) {
    if (f.spenderIsContract === false) penalty += 38;
    else if (f.severity === "CRITICAL") penalty += 26;
    else if (f.severity === "CAUTION") penalty += 14;
    else penalty += 6;
  }

  const riskScore = Math.min(99, Math.max(8, penalty));
  const healthScore = Math.max(1, 100 - riskScore);

  const hasCritical = findings.some((f) => f.severity === "CRITICAL");
  const classification: EvmDetoxSeverity =
    hasCritical || riskScore >= 65
      ? "CRITICAL"
      : riskScore >= 28
        ? "CAUTION"
        : "SAFE";

  const verdictLabel =
    classification === "CRITICAL"
      ? "IMMEDIATE REVOKE RECOMMENDED"
      : classification === "CAUTION"
        ? "ALLOWANCE CLEANUP ADVISED"
        : "MINOR ALLOWANCES PRESENT";

  return { healthScore, riskScore, classification, verdictLabel };
}

async function synthesizeEvmDetoxWithVenice(
  params: {
    networkName: string;
    tokensScannedCount: number;
    findings: EvmDetoxAllowanceAudit[];
    unlimitedCount: number;
    permit2Count: number;
    eoaCount: number;
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
  const deterministic = (() => {
    if (params.findings.length === 0) {
      return {
        summary: `Zero active ERC-20 or Permit2 spending allowances detected across ${params.tokensScannedCount} inspected token(s) on ${params.networkName}.`,
        actionPlan: [
          "No urgent ERC-20 approve(0) or Permit2 lockdown calls needed.",
          "Re-scan after bridging or trading on newly deployed DEX routers.",
        ],
      };
    }
    const plan: string[] = [];
    if (params.eoaCount > 0) {
      plan.push(
        `Revoke ${params.eoaCount} EOA spender approval(s) immediately — unverified wallets can pull approved tokens without further confirmation.`
      );
    }
    if (params.permit2Count > 0) {
      plan.push(
        `Execute Permit2 lockdown() across ${params.permit2Count} exposed Permit2 allowance(s) in a single transaction.`
      );
    }
    if (params.unlimitedCount > 0) {
      plan.push(
        `Reset ${params.unlimitedCount} unlimited ERC-20 approval(s) to zero via approve(spender, 0).`
      );
    }
    if (plan.length === 0) {
      plan.push("Review remaining bounded allowances and reset stale DEX approvals.");
    }
    return {
      summary: `${params.networkName} detox audit found ${params.findings.length} active spending approval(s) (${params.unlimitedCount} unlimited, ${params.permit2Count} Permit2, Health ${params.healthScore}/100).`,
      actionPlan: plan,
    };
  })();

  if (params.findings.length === 0) {
    return {
      ...deterministic,
      inferenceMode: "deterministic-fallback",
      modelUsed: "solshield-evm-detox-deterministic-v1",
    };
  }

  const resolvedApiKey =
    options.apiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
  if (!resolvedApiKey) {
    return {
      ...deterministic,
      inferenceMode: "deterministic-fallback",
      modelUsed: "solshield-evm-detox-deterministic-v1",
    };
  }

  const fetcher = options.fetchImpl ?? fetch;
  const model = options.model || DEFAULT_VENICE_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6500);

  try {
    const res = await fetcher(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 340,
        messages: [
          {
            role: "system",
            content:
              'You are SolShield EVM Security Analyst. Return strictly valid JSON {"summary": string, "actionPlan": string[]} prioritizing dangerous EOA, Permit2, and unlimited ERC-20 approvals without mentioning personal wallet addresses.',
          },
          {
            role: "user",
            content: JSON.stringify({
              networkName: params.networkName,
              healthScore: params.healthScore,
              findings: params.findings.slice(0, 8).map((f) => ({
                kind: f.kind,
                symbol: f.tokenSymbol,
                isUnlimited: f.isUnlimited,
                spenderTrusted: f.spenderTrusted,
                spenderIsContract: f.spenderIsContract,
                severity: f.severity,
              })),
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rawContent = data?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") throw new Error("Empty Venice response");
    const cleaned = rawContent
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const veniceSummary =
      typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : deterministic.summary;
    const veniceActionPlan = Array.isArray(parsed?.actionPlan)
      ? parsed.actionPlan
          .map((s: unknown) => (typeof s === "string" ? s.trim() : ""))
          .filter(Boolean)
          .slice(0, 4)
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
      ...deterministic,
      inferenceMode: "deterministic-fallback",
      modelUsed: "solshield-evm-detox-deterministic-v1",
    };
  } finally {
    clearTimeout(timer);
  }
}

interface RawRpcLog {
  address?: string;
  topics?: string[];
  data?: string;
}

async function fetchLiveEvmSnapshot(
  owner: string,
  chainKey: EvmChainKey,
  options: {
    rpcUrl?: string;
    additionalTokens?: string[];
    additionalSpenders?: string[];
    fetchImpl?: typeof fetch;
  }
): Promise<{
  blockNumber: number;
  nativeBalanceWei: bigint;
  allowances: EvmParsedAllowanceInput[];
  scannedTokens: EvmDetoxReport["scannedTokens"];
}> {
  const chain = EVM_CHAINS[chainKey];
  const rpcUrls = options.rpcUrl?.trim() ? [options.rpcUrl.trim(), ...chain.rpcUrls] : chain.rpcUrls;
  const fetcher = options.fetchImpl ?? fetch;
  const rpcOpts = { timeoutMs: 4200, fetchImpl: fetcher };
  const ownerTopic = `0x${padAddress32(owner)}`;

  const [blockHex, balHex, gtPoolsJson] = await Promise.all([
    evmRpcCall<string>(rpcUrls, "eth_blockNumber", [], rpcOpts),
    evmRpcCall<string>(rpcUrls, "eth_getBalance", [owner, "latest"], rpcOpts),
    (async () => {
      try {
        const res = await fetcher(
          `https://api.geckoterminal.com/api/v2/networks/${chain.geckoNetwork}/trending_pools`,
          { signal: AbortSignal.timeout(3200), cache: "no-store" }
        );
        if (!res.ok) return null;
        return (await res.json()) as {
          data?: Array<{
            relationships?: {
              base_token?: { data?: { id?: string } };
              quote_token?: { data?: { id?: string } };
            };
          }>;
        };
      } catch {
        return null;
      }
    })(),
  ]);

  const blockNumber = blockHex ? parseInt(blockHex, 16) : 0;
  const nativeBalanceWei = balHex ? BigInt(balHex) : 0n;

  const tokenSet = new Set<string>();
  const spenderSet = new Set<string>();
  const spenderMeta = new Map<string, { label: string; trusted: boolean }>();
  const tokenMetaMap = new Map<
    string,
    { symbol: string | null; name: string | null; decimals: number }
  >();

  for (const tok of chain.canonicalTokens) {
    const norm = normalizeEvmAddress(tok.address);
    tokenSet.add(norm);
    tokenMetaMap.set(norm, { symbol: tok.symbol, name: tok.name, decimals: 18 });
  }
  for (const t of options.additionalTokens || []) {
    if (isValidEvmAddress(t)) tokenSet.add(normalizeEvmAddress(t));
  }
  for (const sp of chain.popularSpenders) {
    const norm = normalizeEvmAddress(sp.address);
    spenderSet.add(norm);
    spenderMeta.set(norm, { label: sp.label, trusted: sp.trusted });
  }
  for (const s of options.additionalSpenders || []) {
    if (isValidEvmAddress(s)) spenderSet.add(normalizeEvmAddress(s));
  }

  for (const pool of gtPoolsJson?.data || []) {
    const baseId = pool.relationships?.base_token?.data?.id || "";
    const quoteId = pool.relationships?.quote_token?.data?.id || "";
    for (const rawId of [baseId, quoteId]) {
      const addr = rawId.split("_")[1];
      if (addr && isValidEvmAddress(addr)) {
        tokenSet.add(normalizeEvmAddress(addr));
      }
    }
  }

  // Broad bounded log queries (with safe fallback window if RPC limits span)
  const broadFrom =
    blockNumber > 0
      ? `0x${Math.max(0, blockNumber - 8_000_000).toString(16)}`
      : "0x0";
  const tightFrom =
    blockNumber > 0
      ? `0x${Math.max(0, blockNumber - 25_000).toString(16)}`
      : "0x0";

  const candidateTokenArr = Array.from(tokenSet).slice(0, 18);
  const [permit2Logs, tokenFilteredLogs, recentGlobalLogs] = await Promise.all([
    evmRpcCall<RawRpcLog[]>(
      rpcUrls,
      "eth_getLogs",
      [
        {
          address: PERMIT2_SINGLETON,
          fromBlock: broadFrom,
          toBlock: "latest",
          topics: [PERMIT2_APPROVAL_TOPIC, ownerTopic],
        },
      ],
      rpcOpts
    ),
    candidateTokenArr.length > 0
      ? evmRpcCall<RawRpcLog[]>(
          rpcUrls,
          "eth_getLogs",
          [
            {
              address: candidateTokenArr,
              fromBlock: broadFrom,
              toBlock: "latest",
              topics: [ERC20_APPROVAL_TOPIC, ownerTopic],
            },
          ],
          rpcOpts
        )
      : Promise.resolve([]),
    evmRpcCall<RawRpcLog[]>(
      rpcUrls,
      "eth_getLogs",
      [
        {
          fromBlock: tightFrom,
          toBlock: "latest",
          topics: [ERC20_APPROVAL_TOPIC, ownerTopic],
        },
      ],
      rpcOpts
    ),
  ]);

  const probePairs = new Map<
    string,
    { kind: EvmDetoxApprovalKind; tokenAddress: string; spenderAddress: string }
  >();

  for (const log of permit2Logs || []) {
    const tokAddr = decodeAbiAddressSlot(log.topics?.[2]);
    const spAddr = decodeAbiAddressSlot(log.topics?.[3]);
    if (tokAddr && spAddr) {
      tokenSet.add(tokAddr);
      spenderSet.add(spAddr);
      probePairs.set(`permit2:${tokAddr}:${spAddr}`, {
        kind: "permit2",
        tokenAddress: tokAddr,
        spenderAddress: spAddr,
      });
    }
  }

  for (const log of [...(tokenFilteredLogs || []), ...(recentGlobalLogs || [])]) {
    const tokAddr = log.address && isValidEvmAddress(log.address)
      ? normalizeEvmAddress(log.address)
      : null;
    const spAddr = decodeAbiAddressSlot(log.topics?.[2]);
    if (tokAddr && spAddr) {
      tokenSet.add(tokAddr);
      spenderSet.add(spAddr);
      probePairs.set(`erc20:${tokAddr}:${spAddr}`, {
        kind: "erc20",
        tokenAddress: tokAddr,
        spenderAddress: spAddr,
      });
    }
  }

  // Also cross-check top candidate tokens x popular spenders (including Permit2!)
  const cappedTokens = Array.from(tokenSet).slice(0, 12);
  const cappedSpenders = Array.from(spenderSet).slice(0, 6);
  for (const tok of cappedTokens) {
    for (const sp of cappedSpenders) {
      probePairs.set(`erc20:${tok}:${sp}`, {
        kind: "erc20",
        tokenAddress: tok,
        spenderAddress: sp,
      });
      if (sp !== normalizeEvmAddress(PERMIT2_SINGLETON)) {
        probePairs.set(`permit2:${tok}:${sp}`, {
          kind: "permit2",
          tokenAddress: tok,
          spenderAddress: sp,
        });
      }
    }
  }

  const pairList = Array.from(probePairs.values()).slice(0, 80);

  // Batch eth_call live allowance verification in parallel chunks
  const activeRaw: Array<{
    kind: EvmDetoxApprovalKind;
    tokenAddress: string;
    spenderAddress: string;
    allowanceRaw: bigint;
    permit2Expiration: number | null;
    permit2Nonce: number | null;
  }> = [];

  const CHUNK_SIZE = 20;
  for (let i = 0; i < pairList.length; i += CHUNK_SIZE) {
    const slice = pairList.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      slice.map(async (pair) => {
        if (pair.kind === "erc20") {
          const data = `0xdd62ed3e${padAddress32(owner)}${padAddress32(pair.spenderAddress)}`;
          const res = await evmRpcCall<string>(
            rpcUrls,
            "eth_call",
            [{ to: pair.tokenAddress, data }, "latest"],
            rpcOpts
          );
          const val = decodeAbiUint256(res);
          if (val !== null && val > 0n) {
            return {
              ...pair,
              allowanceRaw: val,
              permit2Expiration: null,
              permit2Nonce: null,
            };
          }
          return null;
        } else {
          const data = `0x927da105${padAddress32(owner)}${padAddress32(pair.tokenAddress)}${padAddress32(pair.spenderAddress)}`;
          const res = await evmRpcCall<string>(
            rpcUrls,
            "eth_call",
            [{ to: PERMIT2_SINGLETON, data }, "latest"],
            rpcOpts
          );
          if (!res || res === "0x") return null;
          const clean = res.slice(2);
          if (clean.length < 192) return null;
          const amount = decodeAbiUint256(`0x${clean.slice(0, 64)}`);
          const exp = decodeAbiUint256(`0x${clean.slice(64, 128)}`);
          const nonce = decodeAbiUint256(`0x${clean.slice(128, 192)}`);
          if (amount !== null && amount > 0n) {
            return {
              ...pair,
              allowanceRaw: amount,
              permit2Expiration: exp !== null ? Number(exp) : null,
              permit2Nonce: nonce !== null ? Number(nonce) : null,
            };
          }
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) activeRaw.push(r);
    }
  }

  // Enrich active tokens & spenders + canonical tokens metadata/balances
  const uniqueActiveTokens = Array.from(
    new Set([...cappedTokens.slice(0, 6), ...activeRaw.map((a) => a.tokenAddress)])
  ).slice(0, 16);
  const uniqueActiveSpenders = Array.from(
    new Set(activeRaw.map((a) => a.spenderAddress))
  );

  const tokenBalanceMap = new Map<string, string>();
  await Promise.all(
    uniqueActiveTokens.map(async (tok) => {
      const [symHex, nameHex, decHex, balTokenHex] = await Promise.all([
        evmRpcCall<string>(rpcUrls, "eth_call", [{ to: tok, data: "0x95d89b41" }, "latest"], rpcOpts),
        evmRpcCall<string>(rpcUrls, "eth_call", [{ to: tok, data: "0x06fdde03" }, "latest"], rpcOpts),
        evmRpcCall<string>(rpcUrls, "eth_call", [{ to: tok, data: "0x313ce567" }, "latest"], rpcOpts),
        evmRpcCall<string>(
          rpcUrls,
          "eth_call",
          [{ to: tok, data: `0x70a08231${padAddress32(owner)}` }, "latest"],
          rpcOpts
        ),
      ]);
      const existing = tokenMetaMap.get(tok);
      const decNum = decHex && decHex !== "0x" ? parseInt(decHex, 16) : existing?.decimals ?? 18;
      tokenMetaMap.set(tok, {
        symbol: decodeAbiString(symHex) || existing?.symbol || null,
        name: decodeAbiString(nameHex) || existing?.name || null,
        decimals: Number.isFinite(decNum) && decNum <= 36 ? decNum : 18,
      });
      const balVal = decodeAbiUint256(balTokenHex);
      if (balVal !== null) {
        tokenBalanceMap.set(tok, balVal.toString());
      }
    })
  );

  const spenderIsContractMap = new Map<string, boolean>();
  await Promise.all(
    uniqueActiveSpenders.map(async (sp) => {
      const code = await evmRpcCall<string>(rpcUrls, "eth_getCode", [sp, "latest"], rpcOpts);
      if (typeof code === "string") {
        spenderIsContractMap.set(sp, code.length > 2 && code !== "0x");
      }
    })
  );

  const allowances: EvmParsedAllowanceInput[] = activeRaw.map((item) => {
    const tMeta = tokenMetaMap.get(item.tokenAddress);
    const sMeta = spenderMeta.get(item.spenderAddress);
    return {
      kind: item.kind,
      tokenAddress: item.tokenAddress,
      spenderAddress: item.spenderAddress,
      allowanceRaw: item.allowanceRaw.toString(),
      decimals: tMeta?.decimals ?? 18,
      balanceRaw: tokenBalanceMap.get(item.tokenAddress) || "0",
      symbol: tMeta?.symbol ?? null,
      name: tMeta?.name ?? null,
      spenderLabel: sMeta?.label ?? null,
      spenderTrusted: sMeta?.trusted ?? false,
      spenderIsContract: spenderIsContractMap.get(item.spenderAddress) ?? null,
      permit2Expiration: item.permit2Expiration,
      permit2Nonce: item.permit2Nonce,
    };
  });

  const scannedTokens: EvmDetoxReport["scannedTokens"] = uniqueActiveTokens.map(
    (addr) => {
      const m = tokenMetaMap.get(addr);
      const dec = m?.decimals ?? 18;
      const bRaw = tokenBalanceMap.get(addr) || "0";
      return {
        tokenAddress: addr,
        symbol: m?.symbol ?? null,
        name: m?.name ?? null,
        decimals: dec,
        balanceUi: formatBigIntDecimalUi(bRaw, dec),
      };
    }
  );

  return {
    blockNumber,
    nativeBalanceWei,
    allowances,
    scannedTokens,
  };
}

/**
 * Performs a read-only zero-retention audit of an EVM wallet's live ERC-20 and Permit2 allowances.
 */
export async function auditEvmWalletApprovals(
  rawAddress: string,
  options: AuditEvmDetoxOptions = {}
): Promise<EvmDetoxReport> {
  const startedAt = Date.now();
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    throw new Error("Please provide an EVM wallet address (0x...) to inspect.");
  }
  if (!isValidEvmAddress(trimmed)) {
    throw new Error("Invalid EVM wallet address format (expected 0x + 40 hex chars).");
  }

  const walletAddress = normalizeEvmAddress(trimmed);
  const chain = resolveEvmChainConfig(options.chain);

  const snapshot = options.loadEvmSnapshot
    ? await options.loadEvmSnapshot(walletAddress, chain.key)
    : await fetchLiveEvmSnapshot(walletAddress, chain.key, {
        rpcUrl: options.rpcUrl,
        additionalTokens: options.additionalTokens,
        additionalSpenders: options.additionalSpenders,
        fetchImpl: options.fetchImpl,
      });

  const findings = snapshot.allowances
    .map(evaluateEvmAllowanceRisk)
    .filter((a) => BigInt(a.allowanceRaw) > 0n)
    .sort((a, b) => {
      const rank = { CRITICAL: 0, CAUTION: 1, SAFE: 2 };
      return rank[a.severity] - rank[b.severity];
    });

  const unlimitedApprovalCount = findings.filter((f) => f.isUnlimited).length;
  const permit2ApprovalCount = findings.filter((f) => f.kind === "permit2").length;
  const eoaSpenderCount = findings.filter((f) => f.spenderIsContract === false).length;
  const uniqueTokens = new Set([
    ...findings.map((f) => f.tokenAddress),
    ...(snapshot.scannedTokens || []).map((t) => t.tokenAddress),
  ]);
  const uniqueSpenders = new Set(findings.map((f) => f.spenderAddress));

  const { healthScore, riskScore, classification, verdictLabel } =
    computeEvmHealthScore(findings);

  const briefing = await synthesizeEvmDetoxWithVenice(
    {
      networkName: chain.name,
      tokensScannedCount: uniqueTokens.size,
      findings,
      unlimitedCount: unlimitedApprovalCount,
      permit2Count: permit2ApprovalCount,
      eoaCount: eoaSpenderCount,
      healthScore,
    },
    {
      apiKey: options.veniceApiKey,
      model: options.model,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    }
  );

  const nativeBalance = Number(
    (Number(snapshot.nativeBalanceWei) / 1e18).toFixed(6)
  );

  return {
    chainFamily: "evm",
    walletAddress,
    chainKey: chain.key,
    chainId: chain.chainId,
    chainIdHex: chain.chainIdHex,
    networkName: chain.name,
    explorerUrl: chain.explorerUrl,
    nativeSymbol: chain.nativeSymbol,
    nativeBalance: Number.isFinite(nativeBalance) ? nativeBalance : 0,
    blockNumber: snapshot.blockNumber,
    tokensScannedCount: uniqueTokens.size,
    spendersCheckedCount: Math.max(uniqueSpenders.size, chain.popularSpenders.length),
    activeApprovalCount: findings.length,
    unlimitedApprovalCount,
    permit2ApprovalCount,
    eoaSpenderCount,
    healthScore,
    riskScore,
    classification,
    verdictLabel,
    findings,
    scannedTokens: snapshot.scannedTokens || [],
    veniceSummary: briefing.summary,
    veniceActionPlan: briefing.actionPlan,
    inferenceMode: briefing.inferenceMode,
    modelUsed: briefing.modelUsed,
    privacyAttestation: `Zero Data Retention — read-only ${chain.name} RPC inspection; wallet addresses and allowances are never persisted.`,
    walletConnectionRequired: false,
    latencyMs: Math.max(1, Date.now() - startedAt),
  };
}

/**
 * Builds unsigned ERC-20 `approve(spender, 0)` and/or batched Permit2 `lockdown()` revocation transactions.
 */
export function buildEvmRevokeTransactions(params: {
  owner: string;
  chain?: string | number | null;
  targets: EvmRevokeTargetSpec[];
}): EvmRevokeArtifact {
  if (!isValidEvmAddress(params.owner)) {
    throw new Error("Invalid EVM owner address.");
  }
  const owner = normalizeEvmAddress(params.owner);
  const chain = resolveEvmChainConfig(params.chain);
  const validTargets = params.targets
    .filter(
      (t) =>
        isValidEvmAddress(t.tokenAddress) && isValidEvmAddress(t.spenderAddress)
    )
    .slice(0, 12);

  if (validTargets.length === 0) {
    throw new Error("At least one valid (tokenAddress, spenderAddress) target is required.");
  }

  const transactions: EvmRevokeTxSpec[] = [];
  const erc20Targets = validTargets.filter((t) => t.kind === "erc20");
  const permit2Targets = validTargets.filter((t) => t.kind === "permit2");

  for (const t of erc20Targets) {
    const token = normalizeEvmAddress(t.tokenAddress);
    const spender = normalizeEvmAddress(t.spenderAddress);
    transactions.push({
      id: `erc20:${token}:${spender}`,
      kind: "erc20",
      label: `ERC-20 approve(${spender.slice(0, 8)}..., 0)`,
      to: token,
      data: encodeErc20ApproveZero(spender),
      value: "0x0",
      chainId: chain.chainId,
      chainIdHex: chain.chainIdHex,
      networkName: chain.name,
      tokenAddress: token,
      spenderAddress: spender,
    });
  }

  if (permit2Targets.length > 0) {
    const tuples = permit2Targets.map((t) => ({
      token: normalizeEvmAddress(t.tokenAddress),
      spender: normalizeEvmAddress(t.spenderAddress),
    }));
    transactions.push({
      id: `permit2:lockdown:${tuples.length}`,
      kind: "permit2",
      label: `Permit2 lockdown(${tuples.length} approval${tuples.length > 1 ? "s" : ""})`,
      to: PERMIT2_SINGLETON,
      data: encodePermit2Lockdown(tuples),
      value: "0x0",
      chainId: chain.chainId,
      chainIdHex: chain.chainIdHex,
      networkName: chain.name,
      tokenAddress: tuples[0].token,
      spenderAddress: tuples[0].spender,
    });
  }

  return {
    chainFamily: "evm",
    owner,
    chainKey: chain.key,
    chainId: chain.chainId,
    chainIdHex: chain.chainIdHex,
    networkName: chain.name,
    txCount: transactions.length,
    transactions,
  };
}
