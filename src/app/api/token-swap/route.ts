import { PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsOptionsResponse } from "@/lib/cors";
import {
  DEFAULT_JUPITER_API_BASE,
  type JupiterQuoteResponse,
  SOL_MINT,
} from "@/lib/jupiter-blink";
import { analyzeBase64Transaction } from "@/lib/solana-parser";

function parsePublicKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new PublicKey(raw.trim()).toBase58();
  } catch {
    return null;
  }
}

async function fetchJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  rawAmount: string;
  slippageBps: number;
}): Promise<JupiterQuoteResponse> {
  const url = `${DEFAULT_JUPITER_API_BASE}/quote?inputMint=${encodeURIComponent(
    params.inputMint
  )}&outputMint=${encodeURIComponent(params.outputMint)}&amount=${encodeURIComponent(
    params.rawAmount
  )}&slippageBps=${params.slippageBps}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "SolShield-BuildCheck/1.0" },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`Jupiter quote HTTP ${res.status}: ${errTxt.slice(0, 140)}`);
  }

  return (await res.json()) as JupiterQuoteResponse;
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function GET(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "read",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  const mint = parsePublicKey(req.nextUrl.searchParams.get("mint"));
  const side = req.nextUrl.searchParams.get("side") === "sell" ? "sell" : "buy";
  const decimals = Math.max(0, Math.min(12, Number(req.nextUrl.searchParams.get("decimals") ?? 6)));
  const amountUi = Number(req.nextUrl.searchParams.get("amountUi") ?? 0.25);
  const slippageBps = Math.max(
    10,
    Math.min(2500, Number(req.nextUrl.searchParams.get("slippageBps") ?? 150))
  );

  if (!mint) {
    return NextResponse.json({ ok: false, error: "Valid token mint required." }, { status: 400 });
  }
  if (!Number.isFinite(amountUi) || amountUi <= 0 || amountUi > 10_000_000_000) {
    return NextResponse.json({ ok: false, error: "Positive swap amount required." }, { status: 400 });
  }

  const inputMint = side === "buy" ? SOL_MINT : mint;
  const outputMint = side === "buy" ? mint : SOL_MINT;
  const inDecimals = side === "buy" ? 9 : decimals;
  const outDecimals = side === "buy" ? decimals : 9;
  const rawAmount = Math.max(1, Math.round(amountUi * Math.pow(10, inDecimals))).toString();

  try {
    const quote = await fetchJupiterQuote({
      inputMint,
      outputMint,
      rawAmount,
      slippageBps,
    });
    const outAmountUi = Number(quote.outAmount) / Math.pow(10, outDecimals);
    const routeLabels = (quote.routePlan || [])
      .map((r) => r.swapInfo?.label)
      .filter((x): x is string => Boolean(x));

    return NextResponse.json({
      ok: true,
      side,
      inAmountUi: amountUi,
      outAmountUi,
      priceImpactPct: quote.priceImpactPct ?? null,
      routeLabels,
      slippageBps,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to fetch live Jupiter quote.",
      },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  let body: {
    side?: "buy" | "sell";
    mint?: string;
    decimals?: number;
    amountUi?: number;
    slippageBps?: number;
    userPublicKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const mint = parsePublicKey(body.mint);
  const userPublicKey = parsePublicKey(body.userPublicKey);
  const side = body.side === "sell" ? "sell" : "buy";
  const decimals = Math.max(0, Math.min(12, Number(body.decimals ?? 6)));
  const amountUi = Number(body.amountUi ?? 0);
  const slippageBps = Math.max(10, Math.min(2500, Number(body.slippageBps ?? 150)));

  if (!mint || !userPublicKey) {
    return NextResponse.json(
      { ok: false, error: "Valid token mint and connected wallet public key required." },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amountUi) || amountUi <= 0 || amountUi > 10_000_000_000) {
    return NextResponse.json({ ok: false, error: "Valid positive amount required." }, { status: 400 });
  }

  const inputMint = side === "buy" ? SOL_MINT : mint;
  const outputMint = side === "buy" ? mint : SOL_MINT;
  const inDecimals = side === "buy" ? 9 : decimals;
  const outDecimals = side === "buy" ? decimals : 9;
  const rawAmount = Math.max(1, Math.round(amountUi * Math.pow(10, inDecimals))).toString();

  try {
    const quote = await fetchJupiterQuote({
      inputMint,
      outputMint,
      rawAmount,
      slippageBps,
    });

    const swapRes = await fetch(`${DEFAULT_JUPITER_API_BASE}/swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "SolShield-BuildCheck/1.0",
      },
      signal: AbortSignal.timeout(9000),
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });

    if (!swapRes.ok) {
      const errTxt = await swapRes.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Jupiter swap builder HTTP ${swapRes.status}: ${errTxt.slice(0, 140)}` },
        { status: 502 }
      );
    }

    const swapJson = (await swapRes.json()) as { swapTransaction?: string };
    if (!swapJson.swapTransaction) {
      return NextResponse.json(
        { ok: false, error: "Jupiter did not return an unsigned swap transaction." },
        { status: 502 }
      );
    }

    // Run SolShield pre-sign bytecode firewall inspection before sending tx to wallet
    const firewallAudit = analyzeBase64Transaction(swapJson.swapTransaction);
    const outAmountUi = Number(quote.outAmount) / Math.pow(10, outDecimals);
    const routeLabels = (quote.routePlan || [])
      .map((r) => r.swapInfo?.label)
      .filter((x): x is string => Boolean(x));

    return NextResponse.json({
      ok: true,
      swapTransaction: swapJson.swapTransaction,
      outAmountUi,
      priceImpactPct: quote.priceImpactPct ?? null,
      routeLabels,
      firewall: {
        riskScore: firewallAudit.deterministicRiskScore,
        classification: firewallAudit.deterministicClassification,
        recommendedAction:
          firewallAudit.deterministicClassification === "SAFE"
            ? "SAFE_TO_SIGN"
            : firewallAudit.deterministicClassification === "WARNING"
              ? "REVIEW_WARNINGS"
              : "BLOCK_TX",
        feePayer: firewallAudit.feePayer,
        flags: firewallAudit.threatFlags,
        programsCount: firewallAudit.instructions.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to build shielded swap." },
      { status: 502 }
    );
  }
}
