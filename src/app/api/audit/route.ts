import { NextRequest, NextResponse } from "next/server";
import { analyzeBase64Transaction } from "@/lib/solana-parser";
import { getPresetReport, SIMULATION_PRESETS } from "@/lib/presets";
import { auditTransactionWithVenice } from "@/lib/venice-ai";

const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

async function fetchLiveSolanaSlot(): Promise<{
  slot: number;
  latencyMs: number;
  connected: boolean;
}> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(SOLANA_MAINNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSlot",
        params: [],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await res.json();
    if (typeof data.result === "number") {
      return {
        slot: data.result,
        latencyMs: Date.now() - start,
        connected: true,
      };
    }
    throw new Error("Invalid slot response");
  } catch {
    return {
      slot: 328_450_900 + Math.floor((Date.now() / 400) % 10000),
      latencyMs: Date.now() - start,
      connected: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

    const [veniceAudit, liveSolana] = await Promise.all([
      auditTransactionWithVenice(report, {
        apiKey: veniceApiKey,
        model: veniceModel,
        maxAllowedRiskScore:
          typeof maxAllowedRiskScore === "number" ? maxAllowedRiskScore : 35,
        maxDailyLamports,
        blockUnknownTransferHooks:
          typeof blockUnknownTransferHooks === "boolean"
            ? blockUnknownTransferHooks
            : true,
      }),
      fetchLiveSolanaSlot(),
    ]);

    return NextResponse.json({
      ok: true,
      preset: activePreset,
      simulation: report,
      veniceAudit,
      liveSolana,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to audit transaction.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
