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
  emergencyLocked?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const VENICE_API_BASE_URL = "https://api.venice.ai/api/v1";
export const DEFAULT_VENICE_MODEL = "llama-3.3-70b";
export const DEFAULT_VENICE_TIMEOUT_MS = 12_000;

async function fetchVeniceWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_VENICE_TIMEOUT_MS
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

const SOLANA_AUDITOR_SYSTEM_PROMPT = `You are SolShield Auditor, an elite Solana smart contract & transaction security engine running on Venice AI private inference.
Analyze the provided Solana transaction simulation AST, instruction list, balance deltas, and deterministic threat flags.
Rules:
- Base EVERY finding strictly on fields explicitly present in the JSON telemetry ("instructions", "balanceDeltas", "threatFlags", "hasUnverifiedTransferHook").
- Do NOT claim or speculate about Token-2022 TransferHook extensions, SPL SetAuthority hijacks, or unmentioned program IDs unless explicitly shown in the telemetry ("hasUnverifiedTransferHook": true or matching "threatFlags").
- If "instructions" is empty (diagnostic or unreachable endpoint report), summarize the "threatFlags" honestly without inventing program calls.
Respond ONLY with a valid JSON object matching this exact structure (no markdown code fences, no extra prose):
{
  "riskScore": <integer 0-100>,
  "classification": "SAFE" | "WARNING" | "CRITICAL",
  "recommendedAction": "ALLOW_SIGNING" | "PROCEED_WITH_CAUTION" | "BLOCK_IMMEDIATELY",
  "executiveSummary": "<1-2 concise plain-English sentences explaining the exact impact on the user's wallet>",
  "technicalFindings": [
    "<specific finding #1 grounded strictly in the observed instruction, balanceDelta, or threatFlag telemetry>",
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
  const emergencyLocked = options.emergencyLocked ?? false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VENICE_TIMEOUT_MS;

  const fallbackResult = buildDeterministicVeniceAudit(report, {
    maxAllowedRiskScore,
    maxDailyLamports,
    blockUnknownHooks,
    emergencyLocked,
  });

  if (!apiKey) {
    return fallbackResult;
  }

  try {
    const response = await fetchVeniceWithTimeout(
      fetchImpl,
      `${VENICE_API_BASE_URL}/chat/completions`,
      {
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
      },
      timeoutMs
    );

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
      emergencyLocked,
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
    emergencyLocked?: boolean;
  }
): { passesPolicy: boolean; reason: string } {
  if (policy.emergencyLocked) {
    return {
      passesPolicy: false,
      reason:
        "Blocked by SolShield Anchor Policy (`PolicyEmergencyLocked`): Vault emergency circuit breaker is active.",
    };
  }

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
    emergencyLocked?: boolean;
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
const INTENT_TOKEN_CANONICAL: Record<string, string> = {
  SOL: "SOL",
  WSOL: "SOL",
  USDC: "USDC",
  USDT: "USDT",
  JUP: "JUP",
  BONK: "BONK",
  JITOSOL: "JitoSOL",
};

const BASE58_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Normalizes known Solana DeFi ticker casing (e.g. `jitosol` -> `JitoSOL`, `bonk` -> `BONK`)
 * or preserves valid Base58 SPL mint addresses verbatim.
 */
function canonicalizeIntentToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^[$@]+/, "");
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  if (INTENT_TOKEN_CANONICAL[upper]) {
    return INTENT_TOKEN_CANONICAL[upper];
  }
  if (BASE58_MINT_RE.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/**
 * Parses a natural-language Solana DeFi intent deterministically across all
 * supported SPL tokens (`SOL`, `USDC`, `USDT`, `JUP`, `BONK`, `JitoSOL`, or Base58 mints).
 */
function parseDeFiIntentDeterministic(prompt: string): ParsedDeFiIntent {
  const slippagePercentMatch = prompt.match(/(\d+(?:\.\d+)?)\s*%/);
  const slippageBpsMatch = prompt.match(/(\d+)\s*bps\b/i);
  const maxSlippageBps = slippagePercentMatch
    ? Math.max(1, Math.min(1000, Math.round(parseFloat(slippagePercentMatch[1]) * 100)))
    : slippageBpsMatch
      ? Math.max(1, Math.min(1000, parseInt(slippageBpsMatch[1], 10)))
      : 50;

  // Strip percentage / bps tokens before extracting swap amount so slippage doesn't shadow amount.
  const withoutSlippage = prompt
    .replace(/\d+(?:\.\d+)?\s*%/g, " ")
    .replace(/\d+\s*bps\b/gi, " ");
  const amountMatch = withoutSlippage.match(/(\d+(?:\.\d+)?)/);
  const amount =
    amountMatch && Number.isFinite(parseFloat(amountMatch[1])) && parseFloat(amountMatch[1]) > 0
      ? parseFloat(amountMatch[1])
      : 1.5;

  let inputToken: string | null = null;
  let outputToken: string | null = null;

  // 1. Directional pattern: "<INPUT> to|for|into|->|=> <OUTPUT>"
  const pairRegex =
    /\b([A-Za-z0-9]{2,44})\s+(?:to|for|into|->|=>|\/)\s+([A-Za-z0-9]{2,44})\b/gi;
  for (const match of prompt.matchAll(pairRegex)) {
    const left = canonicalizeIntentToken(match[1]);
    const right = canonicalizeIntentToken(match[2]);
    if (left && right && left !== right) {
      inputToken = left;
      outputToken = right;
      break;
    }
  }

  // 2. Reverse pattern: "Buy <OUTPUT> with|using <INPUT>"
  if (!inputToken || !outputToken) {
    const buyWithRegex =
      /\bbuy\s+(?:\d+(?:\.\d+)?\s+)?([A-Za-z0-9]{2,44})\s+(?:with|using)\s+(?:\d+(?:\.\d+)?\s+)?([A-Za-z0-9]{2,44})\b/i;
    const buyMatch = prompt.match(buyWithRegex);
    if (buyMatch) {
      const outTok = canonicalizeIntentToken(buyMatch[1]);
      const inTok = canonicalizeIntentToken(buyMatch[2]);
      if (inTok && outTok && inTok !== outTok) {
        inputToken = inTok;
        outputToken = outTok;
      }
    }
  }

  // 3. Fallback: collect distinct recognized tokens in prompt order.
  if (!inputToken || !outputToken) {
    const tokensFound: string[] = [];
    const wordMatches = prompt.match(/\$?[A-Za-z0-9]{2,44}/g) ?? [];
    for (const tokenCandidate of wordMatches) {
      const canonical = canonicalizeIntentToken(tokenCandidate);
      if (canonical && !tokensFound.includes(canonical)) {
        tokensFound.push(canonical);
      }
    }
    inputToken = tokensFound[0] ?? "SOL";
    outputToken =
      tokensFound[1] ?? (inputToken === "USDC" ? "SOL" : "USDC");
  }

  return {
    action: "SWAP",
    inputToken,
    outputToken,
    amount,
    maxSlippageBps,
    explanation: `Parsed private intent: Swap ${amount} ${inputToken} -> ${outputToken} via Jupiter v1/v6 with ${
      maxSlippageBps / 100
    }% max slippage, guarded by SolShield Policy PDA.`,
    inferenceMode: "deterministic-fallback",
  };
}

export async function parseDeFiIntentWithVenice(
  prompt: string,
  apiKey?: string,
  options?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<ParsedDeFiIntent> {
  const cleanKey = apiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
  const fallbackIntent = parseDeFiIntentDeterministic(prompt);

  if (!cleanKey) {
    return fallbackIntent;
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_VENICE_TIMEOUT_MS;

  try {
    const res = await fetchVeniceWithTimeout(
      fetchImpl,
      `${VENICE_API_BASE_URL}/chat/completions`,
      {
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
                'Extract Solana DeFi swap parameters from the user prompt and reply ONLY with JSON matching {"action":"SWAP","inputToken":"<SOL|USDC|USDT|JUP|BONK|JitoSOL or mint>","outputToken":"<SOL|USDC|USDT|JUP|BONK|JitoSOL or mint>","amount":<number>,"maxSlippageBps":<integer>,"explanation":"..."}. Preserve exact token requested by the user (do not default outputToken to USDC if user specified BONK, JitoSOL, JUP, etc.).',
            },
            { role: "user", content: prompt },
          ],
        }),
      },
      timeoutMs
    );

    if (!res.ok) return fallbackIntent;
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return fallbackIntent;
    const parsed = JSON.parse(match[0]);

    const resolvedInput =
      canonicalizeIntentToken(parsed.inputToken) ?? fallbackIntent.inputToken;
    const resolvedOutput =
      canonicalizeIntentToken(parsed.outputToken) ?? fallbackIntent.outputToken;

    return {
      action: "SWAP",
      inputToken: resolvedInput,
      outputToken:
        resolvedOutput === resolvedInput
          ? fallbackIntent.outputToken
          : resolvedOutput,
      amount:
        Number.isFinite(Number(parsed.amount)) && Number(parsed.amount) > 0
          ? Number(parsed.amount)
          : fallbackIntent.amount,
      maxSlippageBps:
        Number.isFinite(Number(parsed.maxSlippageBps)) &&
        Number(parsed.maxSlippageBps) > 0
          ? Math.round(Number(parsed.maxSlippageBps))
          : fallbackIntent.maxSlippageBps,
      explanation: String(parsed.explanation || fallbackIntent.explanation),
      inferenceMode: "venice-live-api",
    };
  } catch {
    return fallbackIntent;
  }
}
