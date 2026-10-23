import { NextRequest, NextResponse } from "next/server";
import {
  auditTransactionWithVenice,
  parseDeFiIntentWithVenice,
} from "@/lib/venice-ai";
import { getPresetReport } from "@/lib/presets";
import { deriveSecurityPolicyPda } from "@/lib/anchor-idl";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      walletAddress,
      veniceApiKey,
      maxAllowedRiskScore,
      maxDailySol,
    } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { ok: false, error: "Please provide a natural-language DeFi intent." },
        { status: 400 }
      );
    }

    const parsedIntent = await parseDeFiIntentWithVenice(prompt, veniceApiKey);
    const { preset, report } = getPresetReport("safe-jupiter-swap");

    report.sourceType = "INTENT_BUILD";
    report.estimatedSpendLamports = Math.round(parsedIntent.amount * 1e9);
    report.balanceDeltas = [
      {
        asset: parsedIntent.inputToken,
        mint: "So11111111111111111111111111111111111111112",
        deltaUiAmount: -parsedIntent.amount,
        direction: "OUT",
      },
      {
        asset: parsedIntent.outputToken,
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        deltaUiAmount: Number((parsedIntent.amount * 186.3).toFixed(2)),
        direction: "IN",
      },
    ];

    const ownerKey =
      walletAddress || "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const policyPda = deriveSecurityPolicyPda(ownerKey);

    const veniceAudit = await auditTransactionWithVenice(report, {
      apiKey: veniceApiKey,
      maxAllowedRiskScore:
        typeof maxAllowedRiskScore === "number" ? maxAllowedRiskScore : 35,
      maxDailyLamports:
        typeof maxDailySol === "number"
          ? Math.round(maxDailySol * 1e9)
          : 5_000_000_000,
      blockUnknownTransferHooks: true,
    });

    return NextResponse.json({
      ok: true,
      intent: parsedIntent,
      policyPda,
      base64Transaction: preset.base64Transaction,
      simulation: report,
      veniceAudit,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to process DeFi intent.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
