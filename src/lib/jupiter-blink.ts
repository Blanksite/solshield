import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { deriveSecurityPolicyPda } from "./anchor-idl";
import {
  analyzeBase64Transaction,
  DeterministicSimulationReport,
} from "./solana-parser";
import {
  auditTransactionWithVenice,
  VeniceSecurityAuditResult,
} from "./venice-ai";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPITER_V6_PROGRAM_ID =
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

export const DEFAULT_JUPITER_API_BASE = "https://lite-api.jup.ag/swap/v1";
export const DEFAULT_MAX_DAILY_LAMPORTS = 10_000_000_000; // 10 SOL
export const DEFAULT_MAX_RISK_SCORE = 35;

export interface TokenMintSpec {
  mint: string;
  symbol: string;
  decimals: number | null;
}

export const KNOWN_BLINK_TOKENS: Record<string, TokenMintSpec> = {
  SOL: { mint: SOL_MINT, symbol: "SOL", decimals: 9 },
  WSOL: { mint: SOL_MINT, symbol: "SOL", decimals: 9 },
  USDC: { mint: USDC_MINT, symbol: "USDC", decimals: 6 },
  USDT: {
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    symbol: "USDT",
    decimals: 6,
  },
  JUP: {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    decimals: 6,
  },
  BONK: {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    decimals: 5,
  },
  JITOSOL: {
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    symbol: "JitoSOL",
    decimals: 9,
  },
};

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  slippageBps?: number;
  priceImpactPct?: string;
  routePlan?: Array<{
    swapInfo?: {
      label?: string;
      ammKey?: string;
    };
    percent?: number;
  }>;
}

export interface AuditedBlinkSwapResult {
  transactionBase64: string;
  recentBlockhash: string;
  inputToken: TokenMintSpec;
  outputToken: TokenMintSpec;
  inAmountUi: number;
  outAmountUi: number | null;
  routeLabels: string[];
  policyPda: string;
  simulationReport: DeterministicSimulationReport;
  audit: VeniceSecurityAuditResult;
}

export class BlinkValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BlinkValidationError";
    this.status = status;
  }
}

/**
 * Resolves a token symbol (`SOL`, `USDC`, `JUP`, etc.) or Base58 mint address
 * into a canonical mint specification.
 */
export function resolveTokenSpec(
  rawValue: string | null | undefined,
  fallbackSymbol: "SOL" | "USDC"
): TokenMintSpec {
  const cleaned = rawValue?.trim();
  if (!cleaned) {
    return KNOWN_BLINK_TOKENS[fallbackSymbol];
  }

  const bySymbol = KNOWN_BLINK_TOKENS[cleaned.toUpperCase()];
  if (bySymbol) {
    return bySymbol;
  }

  const byMint = Object.values(KNOWN_BLINK_TOKENS).find(
    (entry) => entry.mint === cleaned
  );
  if (byMint) {
    return byMint;
  }

  let parsedKey: PublicKey;
  try {
    parsedKey = new PublicKey(cleaned);
  } catch {
    throw new BlinkValidationError(
      `Invalid token symbol or mint address: '${cleaned}'.`,
      400
    );
  }

  const mintStr = parsedKey.toBase58();
  return {
    mint: mintStr,
    symbol: `${mintStr.slice(0, 4)}...${mintStr.slice(-4)}`,
    decimals: null,
  };
}

/**
 * Extracts and verifies the blockhash and top-level static program IDs
 * from a serialized Solana Legacy or Versioned V0 transaction.
 */
export function inspectSerializedTransactionHeader(base64Tx: string): {
  recentBlockhash: string;
  programIds: string[];
} {
  const buffer = Buffer.from(base64Tx.trim(), "base64");
  if (buffer.length < 32) {
    throw new BlinkValidationError(
      "Jupiter returned an empty or truncated swap transaction.",
      502
    );
  }

  try {
    const legacy = Transaction.from(buffer);
    return {
      recentBlockhash: legacy.recentBlockhash ?? PLACEHOLDER_BLOCKHASH,
      programIds: legacy.instructions.map((ix) => ix.programId.toBase58()),
    };
  } catch {
    const versioned = VersionedTransaction.deserialize(buffer);
    return {
      recentBlockhash: versioned.message.recentBlockhash,
      programIds: versioned.message.compiledInstructions.map(
        (ix) => versioned.message.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? ""
      ),
    };
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quotes and builds a live Jupiter v6 swap transaction for a Blink action request,
 * verifies a non-placeholder Mainnet blockhash & Jupiter route instruction,
 * and audits the compiled bytecode through SolShield + Venice AI before returning.
 */
export async function buildAuditedJupiterBlinkSwap(params: {
  account: string;
  amountUi: number;
  inputMintRaw?: string | null;
  outputMintRaw?: string | null;
  slippageBps?: number;
  jupiterApiBase?: string;
  fetchImpl?: typeof fetch;
  veniceApiKey?: string;
  maxDailyLamports?: number;
  maxAllowedRiskScore?: number;
}): Promise<AuditedBlinkSwapResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const jupiterApiBase =
    params.jupiterApiBase ??
    process.env.JUPITER_API_URL?.trim() ??
    DEFAULT_JUPITER_API_BASE;

  let userPubkey: PublicKey;
  try {
    userPubkey = new PublicKey(params.account);
  } catch {
    throw new BlinkValidationError(
      "Invalid Solana public key provided in 'account'.",
      400
    );
  }

  if (
    !Number.isFinite(params.amountUi) ||
    params.amountUi <= 0 ||
    params.amountUi > 1000
  ) {
    throw new BlinkValidationError(
      "Swap 'amount' must be a positive number between 0 and 1000.",
      400
    );
  }

  const inputToken = resolveTokenSpec(params.inputMintRaw, "SOL");
  const outputToken = resolveTokenSpec(params.outputMintRaw, "USDC");

  if (inputToken.decimals === null) {
    throw new BlinkValidationError(
      `Unsupported input token mint decimals for '${inputToken.mint}'. Supported input tokens: SOL, USDC, USDT, JUP, BONK, JitoSOL.`,
      400
    );
  }

  if (inputToken.mint === outputToken.mint) {
    throw new BlinkValidationError(
      "Input mint and output mint must be different tokens.",
      400
    );
  }

  const slippageBps =
    typeof params.slippageBps === "number" &&
    Number.isFinite(params.slippageBps) &&
    params.slippageBps >= 1 &&
    params.slippageBps <= 1000
      ? Math.round(params.slippageBps)
      : 50;

  const amountBaseUnits = Math.round(
    params.amountUi * Math.pow(10, inputToken.decimals)
  );
  if (!Number.isSafeInteger(amountBaseUnits) || amountBaseUnits <= 0) {
    throw new BlinkValidationError("Swap amount is too small to route.", 400);
  }

  const quoteUrl = new URL(`${jupiterApiBase}/quote`);
  quoteUrl.searchParams.set("inputMint", inputToken.mint);
  quoteUrl.searchParams.set("outputMint", outputToken.mint);
  quoteUrl.searchParams.set("amount", String(amountBaseUnits));
  quoteUrl.searchParams.set("slippageBps", String(slippageBps));
  quoteUrl.searchParams.set("restrictIntermediateTokens", "true");

  const quoteRes = await fetchWithTimeout(
    fetchImpl,
    quoteUrl.toString(),
    { method: "GET" },
    6500
  );

  if (!quoteRes.ok) {
    const errText = await quoteRes.text().catch(() => "");
    throw new BlinkValidationError(
      `Jupiter quote unavailable (${quoteRes.status})${
        errText ? `: ${errText.slice(0, 140)}` : "."
      }`,
      502
    );
  }

  const quote = (await quoteRes.json()) as JupiterQuoteResponse;
  if (!quote?.outAmount || !Array.isArray(quote.routePlan) || quote.routePlan.length === 0) {
    throw new BlinkValidationError(
      "No valid Jupiter swap route found for the requested token pair.",
      502
    );
  }

  const swapRes = await fetchWithTimeout(
    fetchImpl,
    `${jupiterApiBase}/swap`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userPubkey.toBase58(),
        wrapAndUnwrapSol: true,
        skipUserAccountsRpcCalls: true,
        dynamicComputeUnitLimit: true,
      }),
    },
    7500
  );

  if (!swapRes.ok) {
    const errText = await swapRes.text().catch(() => "");
    throw new BlinkValidationError(
      `Jupiter swap builder unavailable (${swapRes.status})${
        errText ? `: ${errText.slice(0, 140)}` : "."
      }`,
      502
    );
  }

  const swapData = (await swapRes.json()) as { swapTransaction?: string };
  if (!swapData?.swapTransaction || typeof swapData.swapTransaction !== "string") {
    throw new BlinkValidationError(
      "Jupiter swap response omitted 'swapTransaction'.",
      502
    );
  }

  const { recentBlockhash, programIds } = inspectSerializedTransactionHeader(
    swapData.swapTransaction
  );

  if (!recentBlockhash || recentBlockhash === PLACEHOLDER_BLOCKHASH) {
    throw new BlinkValidationError(
      "Built transaction did not receive a valid live Mainnet blockhash.",
      502
    );
  }

  if (!programIds.includes(JUPITER_V6_PROGRAM_ID)) {
    throw new BlinkValidationError(
      "Constructed transaction failed verification: Jupiter v6 program missing.",
      502
    );
  }

  const report = analyzeBase64Transaction(swapData.swapTransaction);
  report.sourceType = "BLINK_URL";
  if (inputToken.mint === SOL_MINT) {
    report.estimatedSpendLamports = amountBaseUnits;
  }

  const maxDailyLamports = params.maxDailyLamports ?? DEFAULT_MAX_DAILY_LAMPORTS;
  const maxAllowedRiskScore = params.maxAllowedRiskScore ?? DEFAULT_MAX_RISK_SCORE;

  const audit = await auditTransactionWithVenice(report, {
    apiKey: params.veniceApiKey,
    maxAllowedRiskScore,
    maxDailyLamports,
    blockUnknownTransferHooks: true,
  });

  if (audit.classification === "CRITICAL" || !audit.policyGuardVerdict.passesPolicy) {
    throw new BlinkValidationError(
      `Blocked by SolShield + Venice AI Firewall: ${
        !audit.policyGuardVerdict.passesPolicy
          ? audit.policyGuardVerdict.reason
          : audit.executiveSummary
      }`,
      403
    );
  }

  const routeLabels = Array.from(
    new Set(
      (quote.routePlan ?? [])
        .map((step) => step.swapInfo?.label)
        .filter((label): label is string => Boolean(label))
    )
  );

  const outAmountUi =
    outputToken.decimals !== null
      ? Number(quote.outAmount) / Math.pow(10, outputToken.decimals)
      : null;
  const { pda } = deriveSecurityPolicyPda(userPubkey);

  return {
    transactionBase64: swapData.swapTransaction,
    recentBlockhash,
    inputToken,
    outputToken,
    inAmountUi: params.amountUi,
    outAmountUi,
    routeLabels,
    policyPda: pda,
    simulationReport: report,
    audit,
  };
}
