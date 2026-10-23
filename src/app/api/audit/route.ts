import { NextRequest, NextResponse } from "next/server";
import { analyzeBase64Transaction } from "@/lib/solana-parser";
import { getPresetReport, SIMULATION_PRESETS } from "@/lib/presets";
import { auditTransactionWithVenice } from "@/lib/venice-ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      presetId,
      base64Transaction,
      blinkUrl,
      veniceApiKey,
      veniceModel,
      maxAllowedRiskScore,
      maxDailySol,
      blockUnknownTransferHooks,
    } = body;

    let report;
    let activePreset = null;

    if (presetId) {
      const presetBundle = getPresetReport(presetId);
      report = presetBundle.report;
      activePreset = presetBundle.preset;
    } else if (base64Transaction && typeof base64Transaction === "string") {
      report = analyzeBase64Transaction(base64Transaction);
    } else if (blinkUrl && typeof blinkUrl === "string") {
      // Match known suspicious / safe blink patterns or map to appropriate simulation
      const lower = blinkUrl.toLowerCase();
      if (
        lower.includes("claim") ||
        lower.includes("airdrop") ||
        lower.includes("drainer")
      ) {
        const bundle = getPresetReport("drainer-set-authority");
        report = bundle.report;
        report.sourceType = "BLINK_URL";
        activePreset = bundle.preset;
      } else if (lower.includes("tokenz") || lower.includes("hook")) {
        const bundle = getPresetReport("token2022-malicious-hook");
        report = bundle.report;
        report.sourceType = "BLINK_URL";
        activePreset = bundle.preset;
      } else if (lower.includes("stake") || lower.includes("approve")) {
        const bundle = getPresetReport("warning-unlimited-approve");
        report = bundle.report;
        report.sourceType = "BLINK_URL";
        activePreset = bundle.preset;
      } else {
        const bundle = getPresetReport("safe-jupiter-swap");
        report = bundle.report;
        report.sourceType = "BLINK_URL";
        activePreset = bundle.preset;
      }
    } else {
      const bundle = getPresetReport(SIMULATION_PRESETS[0].id);
      report = bundle.report;
      activePreset = bundle.preset;
    }

    const maxDailyLamports =
      typeof maxDailySol === "number" && maxDailySol > 0
        ? Math.round(maxDailySol * 1e9)
        : 5_000_000_000;

    const veniceAudit = await auditTransactionWithVenice(report, {
      apiKey: veniceApiKey,
      model: veniceModel,
      maxAllowedRiskScore:
        typeof maxAllowedRiskScore === "number" ? maxAllowedRiskScore : 35,
      maxDailyLamports,
      blockUnknownTransferHooks:
        typeof blockUnknownTransferHooks === "boolean"
          ? blockUnknownTransferHooks
          : true,
    });

    return NextResponse.json({
      ok: true,
      preset: activePreset,
      simulation: report,
      veniceAudit,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to audit transaction.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
