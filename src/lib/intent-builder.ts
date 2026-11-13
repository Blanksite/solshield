import { PublicKey } from "@solana/web3.js";
import { deriveSecurityPolicyPda } from "./anchor-idl";
import {
  buildAuditedJupiterBlinkSwap,
  resolveTokenSpec,
  SOL_MINT,
} from "./jupiter-blink";
import { DeterministicSimulationReport } from "./solana-parser";
import {
  auditTransactionWithVenice,
  ParsedDeFiIntent,
  parseDeFiIntentWithVenice,
  VeniceSecurityAuditResult,
} from "./venice-ai";

const INTENT_PREVIEW_FEE_PAYER =
  "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";

export interface IntentQuoteSummary {
  quoteMode: "jupiter-v1-live" | "jupiter-unavailable";
  inputMint: string;
  outputMint: string;
  inAmountUi: number;
  outAmountUi: number | null;
  effectiveRate: number | null;
  priceImpactPct: string | null;
  routeLabels: string[];
  error?: string;
}

export interface CompiledIntentResult {
  ok: true;
  intent: ParsedDeFiIntent;
  policyPda: { pda: string; bump: number } | null;
  previewWalletUsed: boolean;
  recentBlockhash: string | null;
  base64Transaction: string | null;
  quote: IntentQuoteSummary;
  simulation: DeterministicSimulationReport;
  veniceAudit: VeniceSecurityAuditResult;
}

function resolveWalletAndPda(walletAddress?: string): {
  executionPayer: string;
  policyPda: { pda: string; bump: number } | null;
  previewWalletUsed: boolean;
} {
  const cleanedWallet =
    typeof walletAddress === "string" ? walletAddress.trim() : "";

  if (cleanedWallet) {
    try {
      const pk = new PublicKey(cleanedWallet);
      return {
        executionPayer: pk.toBase58(),
        policyPda: deriveSecurityPolicyPda(pk),
        previewWalletUsed: false,
      };
    } catch {
      // Invalid wallet string falls back cleanly to non-signing preview payer.
    }
  }

  return {
    executionPayer: INTENT_PREVIEW_FEE_PAYER,
    policyPda: null,
    previewWalletUsed: true,
  };
}

/**
 * Parses a natural-language DeFi swap prompt via Venice AI (or deterministic NLP),
 * builds a real Jupiter Swap v1 quote + Versioned V0 transaction with a live
 * Mainnet blockhash, and runs SolShield + Venice pre-sign policy guardrails.
 */
export async function compileDeFiIntentWithJupiter(params: {
  prompt: string;
  walletAddress?: string;
  veniceApiKey?: string;
  maxAllowedRiskScore?: number;
  maxDailySol?: number;
  emergencyLocked?: boolean;
  jupiterApiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<CompiledIntentResult> {
  const parsedIntent = await parseDeFiIntentWithVenice(
    params.prompt,
    params.veniceApiKey
  );

  const maxDailyLamports =
    typeof params.maxDailySol === "number" && params.maxDailySol > 0
      ? Math.round(params.maxDailySol * 1e9)
      : 5_000_000_000;
  const maxAllowedRisk =
    typeof params.maxAllowedRiskScore === "number"
      ? params.maxAllowedRiskScore
      : 35;
  const emergencyLocked = Boolean(params.emergencyLocked);

  const { executionPayer, policyPda, previewWalletUsed } = resolveWalletAndPda(
    params.walletAddress
  );

  try {
    const built = await buildAuditedJupiterBlinkSwap({
      account: executionPayer,
      amountUi: parsedIntent.amount,
      inputMintRaw: parsedIntent.inputToken,
      outputMintRaw: parsedIntent.outputToken,
      slippageBps: parsedIntent.maxSlippageBps,
      jupiterApiBase: params.jupiterApiBase,
      fetchImpl: params.fetchImpl,
      veniceApiKey: params.veniceApiKey,
      maxDailyLamports,
      maxAllowedRiskScore: maxAllowedRisk,
      blockUnknownTransferHooks: true,
      emergencyLocked,
      enforcePolicyGate: false,
      sourceType: "INTENT_BUILD",
    });

    return {
      ok: true,
      intent: {
        ...parsedIntent,
        inputToken: built.inputToken.symbol,
        outputToken: built.outputToken.symbol,
      },
      policyPda,
      previewWalletUsed,
      recentBlockhash: built.recentBlockhash,
      base64Transaction: built.transactionBase64,
      quote: {
        quoteMode: built.quoteMode,
        inputMint: built.inputToken.mint,
        outputMint: built.outputToken.mint,
        inAmountUi: built.inAmountUi,
        outAmountUi: built.outAmountUi,
        effectiveRate: built.effectiveRate,
        priceImpactPct: built.priceImpactPct,
        routeLabels: built.routeLabels,
      },
      simulation: built.simulationReport,
      veniceAudit: built.audit,
    };
  } catch (err: unknown) {
    const quoteError =
      err instanceof Error ? err.message : "Jupiter quote service unavailable.";

    const inputSpec = (() => {
      try {
        return resolveTokenSpec(parsedIntent.inputToken, "SOL");
      } catch {
        return { mint: parsedIntent.inputToken, symbol: parsedIntent.inputToken, decimals: null };
      }
    })();

    const outputSpec = (() => {
      try {
        return resolveTokenSpec(parsedIntent.outputToken, "USDC");
      } catch {
        return { mint: parsedIntent.outputToken, symbol: parsedIntent.outputToken, decimals: null };
      }
    })();

    const estimatedSpendLamports =
      inputSpec.mint === SOL_MINT ? Math.round(parsedIntent.amount * 1e9) : 0;

    const fallbackReport: DeterministicSimulationReport = {
      sourceType: "INTENT_BUILD",
      feePayer: executionPayer,
      recentBlockhash: "",
      instructions: [],
      balanceDeltas: [
        {
          asset: inputSpec.symbol,
          mint: inputSpec.mint,
          deltaUiAmount: -parsedIntent.amount,
          direction: "OUT",
        },
      ],
      threatFlags: [],
      deterministicRiskScore: 15,
      deterministicClassification: "SAFE",
      hasUnverifiedTransferHook: false,
      estimatedSpendLamports,
    };

    const veniceAudit = await auditTransactionWithVenice(fallbackReport, {
      apiKey: params.veniceApiKey,
      maxAllowedRiskScore: maxAllowedRisk,
      maxDailyLamports,
      blockUnknownTransferHooks: true,
      emergencyLocked,
    });

    return {
      ok: true,
      intent: parsedIntent,
      policyPda,
      previewWalletUsed,
      recentBlockhash: null,
      base64Transaction: null,
      quote: {
        quoteMode: "jupiter-unavailable",
        inputMint: inputSpec.mint,
        outputMint: outputSpec.mint,
        inAmountUi: parsedIntent.amount,
        outAmountUi: null,
        effectiveRate: null,
        priceImpactPct: null,
        routeLabels: [],
        error: quoteError,
      },
      simulation: fallbackReport,
      veniceAudit,
    };
  }
}
