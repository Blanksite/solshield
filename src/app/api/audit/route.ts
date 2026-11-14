import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  runGuardedCachedOperation,
} from "@/lib/api-guard";
import { analyzeBase64Transaction } from "@/lib/solana-parser";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { getPresetReport, SIMULATION_PRESETS } from "@/lib/presets";
import { createCacheKeyHash } from "@/lib/scan-cache";
import {
  RpcTxSimulationReport,
  simulateSolanaTransactionRpc,
} from "@/lib/tx-simulator";
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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "extension");
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
      simulateRpc,
      network,
      rpcUrl,
      inspectTokens,
      forceRefresh,
    } = body;

    const shouldSimulateRpc =
      Boolean(simulateRpc) &&
      typeof base64Transaction === "string" &&
      base64Transaction.trim().length > 0;

    const cacheKey = createCacheKeyHash(
      JSON.stringify({
        presetId: presetId || null,
        base64Transaction:
          typeof base64Transaction === "string" ? base64Transaction.trim() : null,
        blinkUrl: typeof blinkUrl === "string" ? blinkUrl.trim() : null,
        walletAddress: typeof walletAddress === "string" ? walletAddress.trim() : null,
        veniceModel: veniceModel || null,
        maxAllowedRiskScore:
          typeof maxAllowedRiskScore === "number" ? maxAllowedRiskScore : 35,
        maxDailySol: typeof maxDailySol === "number" ? maxDailySol : 5,
        blockUnknownTransferHooks:
          typeof blockUnknownTransferHooks === "boolean"
            ? blockUnknownTransferHooks
            : true,
        emergencyLocked: Boolean(emergencyLocked),
        shouldSimulateRpc,
        network: network === "devnet" ? "devnet" : "mainnet",
        inspectTokens: typeof inspectTokens === "boolean" ? inspectTokens : true,
      })
    );

    const guarded = await runGuardedCachedOperation(
      req,
      {
        profile: "extension-hybrid",
        byokKey: typeof veniceApiKey === "string" ? veniceApiKey : undefined,
        namespace: "tx-audit",
        cacheKey,
        ttlMs: shouldSimulateRpc ? 3 * 60_000 : 15 * 60_000,
        forceRefresh: forceRefresh === true,
      },
      async () => {
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

        const [veniceAudit, liveSolana, rpcSimulation] = await Promise.all([
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
          shouldSimulateRpc
            ? simulateSolanaTransactionRpc(base64Transaction, {
                network: network === "devnet" ? "devnet" : "mainnet",
                rpcUrl: typeof rpcUrl === "string" ? rpcUrl : undefined,
                veniceApiKey:
                  typeof veniceApiKey === "string" ? veniceApiKey : undefined,
                inspectTokens:
                  typeof inspectTokens === "boolean" ? inspectTokens : true,
                timeoutMs: 2800,
              })
            : Promise.resolve<RpcTxSimulationReport | null>(null),
        ]);

        return {
          preset: activePreset,
          blinkMeta,
          simulation: report,
          rpcSimulation,
          veniceAudit,
          liveSolana,
        };
      }
    );

    if (!guarded.ok) {
      return buildGuardErrorResponse(guarded);
    }

    return corsJson(
      {
        ok: true,
        cached: guarded.cached,
        cachedAt: guarded.cachedAt,
        ...guarded.value,
      },
      { req, policy: "extension", headers: guarded.headers }
    );
  } catch (err: unknown) {
    const status = err instanceof BlinkInspectionError ? err.status : 400;
    const message =
      err instanceof Error ? err.message : "Failed to audit transaction.";
    return corsJson(
      { ok: false, error: message },
      { status, req, policy: "extension" }
    );
  }
}
