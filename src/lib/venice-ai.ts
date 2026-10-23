import { DeterministicSimulationReport } from "./solana-parser";

export interface VeniceSecurityAuditResult {
  riskScore: number;
  classification: "SAFE" | "WARNING" | "CRITICAL";
  recommendedAction:
    | "ALLOW_SIGNING"
    | "PROCEED_WITH_CAUTION"
    | "BLOCK_IMMEDIATELY";
  executiveSummary: string;
  technicalFindings: string[];
  policyGuardVerdict: {
    passesPolicy: boolean;
    reason: string;
  };
  privacyAttestation: string;
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  modelUsed: string;
}

export interface VeniceAuditOptions {
  apiKey?: string;
  model?: string;
  maxAllowedRiskScore?: number;
  maxDailyLamports?: number;
  blockUnknownTransferHooks?: boolean;
}

export const VENICE_API_BASE_URL = "https://api.venice.ai/api/v1";
export const DEFAULT_VENICE_MODEL = "llama-3.3-70b";

const SOLANA_AUDITOR_SYSTEM_PROMPT = `You are SolShield Auditor, an elite Solana smart contract & transaction security engine running on Venice AI private inference.
Analyze the provided Solana transaction simulation AST, instruction list, balance deltas, and deterministic threat flags.
Respond ONLY with a valid JSON object matching this exact structure (no markdown code fences, no extra prose):
{
  "riskScore": <integer 0-100>,
  "classification": "SAFE" | "WARNING" | "CRITICAL",
  "recommendedAction": "ALLOW_SIGNING" | "PROCEED_WITH_CAUTION" | "BLOCK_IMMEDIATELY",
  "executiveSummary": "<1-2 concise plain-English sentences explaining the exact impact on the user's wallet>",
  "technicalFindings": [
    "<specific finding #1 referencing program IDs, SPL authority changes, PDA validation, or Token-2022 hooks>",
    "<specific finding #2>"
  ]
}`;

/**
 * Calls the Venice AI Chat Completions endpoint (`https://api.venice.ai/api/v1/chat/completions`)
 * with zero-data-retention privacy parameters to audit a Solana transaction report.
 * Falls back gracefully to the deterministic heuristic engine if no API key is configured.
 */
export async function auditTransactionWithVenice(
  report: DeterministicSimulationReport,
  options: VeniceAuditOptions = {}
): Promise<VeniceSecurityAuditResult> {
  const apiKey =
    options.apiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
  const model = options.model?.trim() || DEFAULT_VENICE_MODEL;
  const maxAllowedRiskScore = options.maxAllowedRiskScore ?? 35;
  const maxDailyLamports = options.maxDailyLamports ?? 5_000_000_000; // 5 SOL default
  const blockUnknownHooks = options.blockUnknownTransferHooks ?? true;

  const fallbackResult = buildDeterministicVeniceAudit(report, {
    maxAllowedRiskScore,
    maxDailyLamports,
    blockUnknownHooks,
  });

  if (!apiKey) {
    return fallbackResult;
  }

  try {
    const response = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 600,
        venice_parameters: {
          include_venice_system_prompt: false,
        },
        messages: [
          {
            role: "system",
            content: SOLANA_AUDITOR_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              feePayer: report.feePayer,
              estimatedSpendLamports: report.estimatedSpendLamports,
              hasUnverifiedTransferHook: report.hasUnverifiedTransferHook,
              deterministicRiskScore: report.deterministicRiskScore,
              threatFlags: report.threatFlags,
              balanceDeltas: report.balanceDeltas,
              instructions: report.instructions.map((ix) => ({
                index: ix.index,
                programId: ix.programId,
                programName: ix.programName,
                isVerifiedProgram: ix.isVerifiedProgram,
                instructionName: ix.instructionName,
                warnings: ix.warnings,
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return {
        ...fallbackResult,
        technicalFindings: [
          ...fallbackResult.technicalFindings,
          `Note: Venice API returned HTTP ${response.status}; served via deterministic security engine.`,
        ],
      };
    }

    const data = await response.json();
    const rawContent: string =
      data?.choices?.[0]?.message?.content?.trim() ?? "";

    // Extract JSON block safely even if model wraps it in ```json ... ```
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackResult;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const finalRiskScore = Math.max(
      report.deterministicRiskScore,
      typeof parsed.riskScore === "number"
        ? Math.min(100, Math.max(0, Math.round(parsed.riskScore)))
        : report.deterministicRiskScore
    );

    const classification: "SAFE" | "WARNING" | "CRITICAL" =
      finalRiskScore >= 70
        ? "CRITICAL"
        : finalRiskScore >= 35
        ? "WARNING"
        : "SAFE";

    const recommendedAction =
      classification === "CRITICAL"
        ? "BLOCK_IMMEDIATELY"
        : classification === "WARNING"
        ? "PROCEED_WITH_CAUTION"
        : "ALLOW_SIGNING";

    const policyVerdict = evaluateOnChainPolicy(report, finalRiskScore, {
      maxAllowedRiskScore,
      maxDailyLamports,
      blockUnknownHooks,
    });

    return {
      riskScore: finalRiskScore,
      classification,
      recommendedAction,
      executiveSummary:
        typeof parsed.executiveSummary === "string" &&
        parsed.executiveSummary.length > 0
          ? parsed.executiveSummary
          : fallbackResult.executiveSummary,
      technicalFindings: Array.isArray(parsed.technicalFindings)
        ? parsed.technicalFindings.map(String)
        : fallbackResult.technicalFindings,
      policyGuardVerdict: policyVerdict,
      privacyAttestation:
        "Audited via Venice AI Private Inference (Zero Data Retention — wallet pubkeys & transaction intent are never logged or used for model training).",
      inferenceMode: "venice-live-api",
      modelUsed: data?.model || model,
    };
  } catch {
    return fallbackResult;
  }
}

function evaluateOnChainPolicy(
  report: DeterministicSimulationReport,
  riskScore: number,
  policy: {
    maxAllowedRiskScore: number;
    maxDailyLamports: number;
    blockUnknownHooks: boolean;
  }
): { passesPolicy: boolean; reason: string } {
  if (policy.blockUnknownHooks && report.hasUnverifiedTransferHook) {
    return {
      passesPolicy: false,
      reason:
        "Blocked by SolShield Anchor Policy (`UnverifiedTransferHookBlocked`): Transaction invokes an unverified Token-2022 TransferHook program.",
    };
  }

  if (riskScore > policy.maxAllowedRiskScore) {
    return {
      passesPolicy: false,
      reason: `Blocked by SolShield Anchor Policy (\`RiskScoreExceedsPolicy\`): Risk score (${riskScore}/100) exceeds your configured maximum threshold (${policy.maxAllowedRiskScore}/100).`,
    };
  }

  if (report.estimatedSpendLamports > policy.maxDailyLamports) {
    return {
      passesPolicy: false,
      reason: `Blocked by SolShield Anchor Policy (\`DailySpendLimitExceeded\`): Estimated spend (${(
        report.estimatedSpendLamports / 1e9
      ).toFixed(2)} SOL) exceeds your 24h rolling limit (${(
        policy.maxDailyLamports / 1e9
      ).toFixed(2)} SOL).`,
    };
  }

  return {
    passesPolicy: true,
    reason: `Passes all SolShield Anchor PDA guardrails (Risk ${riskScore} <= ${policy.maxAllowedRiskScore}, Spend ${(
      report.estimatedSpendLamports / 1e9
    ).toFixed(4)} SOL <= ${(policy.maxDailyLamports / 1e9).toFixed(2)} SOL).`,
  };
}

function buildDeterministicVeniceAudit(
  report: DeterministicSimulationReport,
  policy: {
    maxAllowedRiskScore: number;
    maxDailyLamports: number;
    blockUnknownHooks: boolean;
  }
): VeniceSecurityAuditResult {
  const score = report.deterministicRiskScore;
  const classification = report.deterministicClassification;

  let executiveSummary =
    "All instructions invoke verified Solana programs within normal parameters. No unauthorized authority changes or malicious Token-2022 hooks detected.";

  if (
    report.threatFlags.some((t) => t.code === "OWNER_AUTHORITY_HIJACK")
  ) {
    executiveSummary =
      "CRITICAL WALLET DRAINER DETECTED: This transaction uses SPL SetAuthority to permanently transfer ownership of your token account to an attacker and drains native SOL.";
  } else if (
    report.threatFlags.some(
      (t) =>
        t.code === "TOKEN_2022_UNVERIFIED_TRANSFER_HOOK" ||
        t.code === "TOKEN_2022_PERMANENT_DELEGATE"
    )
  ) {
    executiveSummary =
      "CRITICAL TOKEN-2022 HONEYPOT RISK: This token uses an unverified TransferHook CPI program and enables PermanentDelegate clawback authority.";
  } else if (
    report.threatFlags.some((t) => t.code === "UNLIMITED_DELEGATE_APPROVAL")
  ) {
    executiveSummary =
      "HIGH RISK DELEGATE APPROVAL: This transaction grants persistent token spending allowance (ApproveChecked) to an external address.";
  } else if (classification === "WARNING") {
    executiveSummary =
      "Caution advised: This transaction interacts with unverified external instructions or transfers significant native SOL.";
  }

  const technicalFindings =
    report.threatFlags.length > 0
      ? report.threatFlags.map(
          (f) => `[${f.severity}] ${f.title}: ${f.description}`
        )
      : report.instructions.map(
          (ix) =>
            `Instruction #${ix.index + 1}: Verified call to ${ix.programName} (${ix.instructionName}) with ${ix.accounts.length} account(s).`
        );

  const policyGuardVerdict = evaluateOnChainPolicy(report, score, policy);

  return {
    riskScore: score,
    classification,
    recommendedAction:
      classification === "CRITICAL"
        ? "BLOCK_IMMEDIATELY"
        : classification === "WARNING"
        ? "PROCEED_WITH_CAUTION"
        : "ALLOW_SIGNING",
    executiveSummary,
    technicalFindings,
    policyGuardVerdict,
    privacyAttestation:
      "Local Deterministic Engine + Venice AI Zero-Retention Ready (Add your Venice API Key in the header to enable live LLM deep reasoning).",
    inferenceMode: "deterministic-fallback",
    modelUsed: `${DEFAULT_VENICE_MODEL} (Deterministic Pre-Filter)`,
  };
}

export interface ParsedDeFiIntent {
  action: "SWAP" | "TRANSFER" | "AUDIT_ONLY";
  inputToken: string;
  outputToken: string;
  amount: number;
  maxSlippageBps: number;
  explanation: string;
  inferenceMode: "venice-live-api" | "deterministic-fallback";
}

/**
 * Parses a user's natural language Solana DeFi intent into structured swap parameters
 * using Venice AI private inference (with deterministic regex fallback).
 */
export async function parseDeFiIntentWithVenice(
  prompt: string,
  apiKey?: string
): Promise<ParsedDeFiIntent> {
  const cleanKey = apiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";

  // Deterministic parser fallback
  const amountMatch = prompt.match(/(\d+(\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : 1.5;
  const upper = prompt.toUpperCase();
  const inputToken = upper.includes("USDC TO SOL") ? "USDC" : "SOL";
  const outputToken = inputToken === "SOL" ? "USDC" : "SOL";
  const slippageMatch = prompt.match(/(\d+(\.\d+)?)\s*%/);
  const maxSlippageBps = slippageMatch
    ? Math.round(parseFloat(slippageMatch[1]) * 100)
    : 50;

  const fallbackIntent: ParsedDeFiIntent = {
    action: "SWAP",
    inputToken,
    outputToken,
    amount,
    maxSlippageBps,
    explanation: `Parsed private intent: Swap ${amount} ${inputToken} -> ${outputToken} via Jupiter v6 with ${
      maxSlippageBps / 100
    }% max slippage, guarded by SolShield Policy PDA.`,
    inferenceMode: "deterministic-fallback",
  };

  if (!cleanKey) {
    return fallbackIntent;
  }

  try {
    const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_VENICE_MODEL,
        temperature: 0.1,
        max_tokens: 300,
        venice_parameters: { include_venice_system_prompt: false },
        messages: [
          {
            role: "system",
            content:
              'Extract Solana DeFi swap parameters from the user prompt and reply ONLY with JSON: {"action":"SWAP","inputToken":"SOL","outputToken":"USDC","amount":1.5,"maxSlippageBps":50,"explanation":"..."}',
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) return fallbackIntent;
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return fallbackIntent;
    const parsed = JSON.parse(match[0]);

    return {
      action: "SWAP",
      inputToken: String(parsed.inputToken || inputToken),
      outputToken: String(parsed.outputToken || outputToken),
      amount: Number(parsed.amount) || amount,
      maxSlippageBps: Number(parsed.maxSlippageBps) || maxSlippageBps,
      explanation: String(parsed.explanation || fallbackIntent.explanation),
      inferenceMode: "venice-live-api",
    };
  } catch {
    return fallbackIntent;
  }
}
