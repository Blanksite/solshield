import { NextRequest, NextResponse } from "next/server";
import { analyzeBase64Transaction } from "@/lib/solana-parser";
import { getPresetReport, SIMULATION_PRESETS } from "@/lib/presets";
import { auditTransactionWithVenice } from "@/lib/venice-ai";
import {
  BlinkInspectionError,
  BlinkActionInspectionMeta,
  inspectLiveBlinkUrl,
} from "@/lib/blink-inspector";

const SOLANA_MAINNET_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

async function fetchLiveSolanaSlot(): Promise<{
  slot: number | null;
  latencyMs: number;
  connected: boolean;
}> {
  const start = Date.now();
  for (const rpcUrl of SOLANA_MAINNET_RPCS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(rpcUrl, {
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
    } catch {
      // Try next RPC endpoint
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    slot: null,
    latencyMs: Date.now() - start,
    connected: false,
  };
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
      emergencyLocked,
      walletAddress,
    } = body;

    let report;
    let activePreset = null;
    let blinkMeta: BlinkActionInspectionMeta | null = null;

    if (presetId) {
      const presetBundle = getPresetReport(presetId);
      report = presetBundle.report;
      activePreset = presetBundle.preset;
    } else if (base64Transaction && typeof base64Transaction === "string") {
      report = analyzeBase64Transaction(base64Transaction);
    } else if (blinkUrl && typeof blinkUrl === "string") {
      const inspected = await inspectLiveBlinkUrl({
        blinkUrl,
        account: typeof walletAddress === "string" ? walletAddress : undefined,
      });
      report = inspected.report;
      blinkMeta = inspected.blinkMeta;
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
        emergencyLocked: Boolean(emergencyLocked),
      }),
      fetchLiveSolanaSlot(),
    ]);

    return NextResponse.json({
      ok: true,
      preset: activePreset,
      blinkMeta,
      simulation: report,
      veniceAudit,
      liveSolana,
    });
  } catch (err: unknown) {
    const status = err instanceof BlinkInspectionError ? err.status : 400;
    const message =
      err instanceof Error ? err.message : "Failed to audit transaction.";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
