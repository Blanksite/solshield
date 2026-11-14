import { NextRequest, NextResponse } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import {
  BlinkValidationError,
  buildAuditedJupiterBlinkSwap,
} from "@/lib/jupiter-blink";

const ACTIONS_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.2.1",
  "X-Blockchain-Ids": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

export const maxDuration = 30;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: ACTIONS_CORS_HEADERS,
  });
}

/**
 * Solana Actions & Blinks GET endpoint.
 * Returns metadata and interactive parameters for Blink-compatible wallets (Phantom, Solflare, Backpack).
 */
export async function GET(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "solana-actions",
    kind: "read",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const rawRequestedAmount = url.searchParams.get("amount");
  const requestedAmount =
    rawRequestedAmount !== null ? Number(rawRequestedAmount) : NaN;
  const requestedOutputMint =
    url.searchParams.get("outputMint")?.trim() || "USDC";
  const hasExplicitAmount =
    Number.isFinite(requestedAmount) &&
    requestedAmount > 0 &&
    requestedAmount <= 1000;

  const actions = [
    ...(hasExplicitAmount
      ? [
          {
            label: `Audit & Swap ${requestedAmount} SOL -> ${requestedOutputMint}`,
            href: `${baseUrl}/api/actions/audit-swap?amount=${encodeURIComponent(
              String(requestedAmount)
            )}&outputMint=${encodeURIComponent(requestedOutputMint)}`,
          },
        ]
      : []),
    {
      label: "Audit & Swap 1 SOL -> USDC",
      href: `${baseUrl}/api/actions/audit-swap?amount=1&outputMint=USDC`,
    },
    {
      label: "Audit & Swap 5 SOL -> USDC",
      href: `${baseUrl}/api/actions/audit-swap?amount=5&outputMint=USDC`,
    },
    {
      label: "Custom Audited Swap",
      href: `${baseUrl}/api/actions/audit-swap?amount={amount}&outputMint=USDC`,
      parameters: [
        {
          name: "amount",
          label: "Amount in SOL to swap safely (max 10 SOL guardrail)",
          required: true,
        },
      ],
    },
  ];

  const payload = {
    type: "action",
    icon: `${baseUrl}/logo.jpg?v=2`,
    title: "SolShield — Venice AI Guarded Solana Swap",
    description:
      "Builds a live Jupiter v6 Mainnet swap, runs pre-sign bytecode inspection & zero-retention Venice AI risk checks, and enforces a 10 SOL default guardrail before returning the tx.",
    label: "Audit & Swap via SolShield",
    links: {
      actions,
    },
  };

  return NextResponse.json(payload, { headers: ACTIONS_CORS_HEADERS });
}

/**
 * Solana Actions & Blinks POST endpoint.
 * Builds a live Jupiter v6 Mainnet swap transaction with real blockhash,
 * runs SolShield pre-sign bytecode inspection + Venice AI risk checks,
 * and returns the audited base64 transaction ready to sign.
 */
export async function POST(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "solana-actions",
    kind: "fresh",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  try {
    const url = new URL(req.url);
    const rawAmount = url.searchParams.get("amount");
    const amountUi = rawAmount === null ? 1 : Number(rawAmount);
    const inputMintRaw = url.searchParams.get("inputMint");
    const outputMintRaw = url.searchParams.get("outputMint");
    const rawSlippage = url.searchParams.get("slippageBps");
    const slippageBps = rawSlippage !== null ? Number(rawSlippage) : 50;

    let body: { account?: unknown } = {};
    try {
      body = (await req.json()) as { account?: unknown };
    } catch {
      return NextResponse.json(
        { message: "Invalid JSON body in Blink POST request." },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    if (typeof body?.account !== "string" || !body.account.trim()) {
      return NextResponse.json(
        {
          message:
            "Missing required 'account' public key in Blink POST payload.",
        },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const result = await buildAuditedJupiterBlinkSwap({
      account: body.account.trim(),
      amountUi,
      inputMintRaw,
      outputMintRaw,
      slippageBps,
    });

    const outFormatted =
      result.outAmountUi !== null
        ? ` -> ~${result.outAmountUi.toFixed(
            result.outAmountUi >= 1 ? 2 : 4
          )} ${result.outputToken.symbol}`
        : ` -> ${result.outputToken.symbol}`;

    const routeSuffix =
      result.routeLabels.length > 0
        ? ` via Jupiter (${result.routeLabels.join(" -> ")})`
        : " via Jupiter v6";

    return NextResponse.json(
      {
        type: "transaction",
        transaction: result.transactionBase64,
        message: `SolShield + Venice AI Audit Passed (${result.audit.riskScore}/100 ${result.audit.classification}): ${result.inAmountUi} ${result.inputToken.symbol}${outFormatted}${routeSuffix}. Policy PDA ${result.policyPda.slice(0, 8)}...`,
      },
      { headers: ACTIONS_CORS_HEADERS }
    );
  } catch (err: unknown) {
    if (err instanceof BlinkValidationError) {
      return NextResponse.json(
        { message: err.message },
        { status: err.status, headers: ACTIONS_CORS_HEADERS }
      );
    }
    const message =
      err instanceof Error
        ? err.message
        : "Failed to construct audited Jupiter Blink transaction.";
    return NextResponse.json(
      { message },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    );
  }
}
