import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  runGuardedCachedOperation,
} from "@/lib/api-guard";
import { analyzeBase64Transaction } from "@/lib/solana-parser";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import {
  inspectEvmContractSecurity,
  isValidEvmAddress,
} from "@/lib/evm-security";
import {
  inspectEvmRpcRequest,
  type EvmRpcInspectionInput,
} from "@/lib/evm-tx-parser";
import { createCacheKeyHash } from "@/lib/scan-cache";
import { recordScannedToken } from "@/lib/scanned-tokens";
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

export const maxDuration = 30;

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "extension");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      base64Transaction,
      blinkUrl,
      evmRequest,
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

    const cleanBase64 =
      typeof base64Transaction === "string" ? base64Transaction.trim() : "";
    const cleanBlinkUrl =
      typeof blinkUrl === "string" ? blinkUrl.trim() : "";
    const cleanEvmRequest =
      evmRequest &&
      typeof evmRequest === "object" &&
      typeof (evmRequest as { method?: unknown }).method === "string"
        ? (evmRequest as EvmRpcInspectionInput)
        : null;

    if (!cleanBase64 && !cleanBlinkUrl && !cleanEvmRequest) {
      return corsJson(
        {
          ok: false,
          error:
            "Provide a serialized base64Transaction, Solana Action blinkUrl, or evmRequest payload to inspect.",
        },
        { status: 400, req, policy: "extension" }
      );
    }

    if (cleanEvmRequest) {
      const evmCacheKey = createCacheKeyHash(JSON.stringify(cleanEvmRequest));
      const evmGuarded = await runGuardedCachedOperation(
        req,
        {
          profile: "extension-hybrid",
          byokKey: typeof veniceApiKey === "string" ? veniceApiKey : undefined,
          namespace: "evm-tx-audit",
          cacheKey: evmCacheKey,
          ttlMs: 3 * 60_000,
          forceRefresh: forceRefresh === true,
        },
        async () => {
          const evmAudit = inspectEvmRpcRequest(cleanEvmRequest);
          const contractCandidate =
            evmAudit.verifyingContract && isValidEvmAddress(evmAudit.verifyingContract)
              ? evmAudit.verifyingContract
              : null;

          const evmContractSecurity = contractCandidate
            ? await inspectEvmContractSecurity(
                contractCandidate,
                cleanEvmRequest.chainId ?? evmAudit.chainIdHex ?? "ethereum",
                { timeoutMs: 2800 }
              ).catch(() => null)
            : null;

          const evmContractRiskScore =
            evmContractSecurity && evmContractSecurity.honeypotStatus === "HONEYPOT"
              ? 96
              : evmContractSecurity && evmContractSecurity.riskScore >= 70
                ? evmContractSecurity.riskScore
                : null;
          const evmContractWarning =
            evmContractSecurity && evmContractSecurity.flags.length > 0
              ? `${evmContractSecurity.networkName}: ${evmContractSecurity.flags[0].title}`
              : null;

          return {
            evmAudit,
            evmContractSecurity,
            evmContractRiskScore,
            evmContractWarning,
          };
        }
      );

      if (!evmGuarded.ok) {
        return buildGuardErrorResponse(evmGuarded);
      }

      return corsJson(
        {
          ok: true,
          cached: evmGuarded.cached,
          cachedAt: evmGuarded.cachedAt,
          ...evmGuarded.value,
        },
        { req, policy: "extension", headers: evmGuarded.headers }
      );
    }

    const shouldSimulateRpc = Boolean(simulateRpc);

    const cacheKey = createCacheKeyHash(
      JSON.stringify({
        base64Transaction: cleanBase64 || null,
        blinkUrl: cleanBlinkUrl || null,
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

    const hasVeniceKey = Boolean(
      (typeof veniceApiKey === "string" && veniceApiKey.trim()) ||
        process.env.VENICE_API_KEY?.trim()
    );
    const baseTtlMs = shouldSimulateRpc ? 3 * 60_000 : 15 * 60_000;

    const guarded = await runGuardedCachedOperation(
      req,
      {
        profile: "extension-hybrid",
        byokKey: typeof veniceApiKey === "string" ? veniceApiKey : undefined,
        namespace: "tx-audit",
        cacheKey,
        ttlMs: baseTtlMs,
        resolveTtlMs: (value) => {
          if (
            hasVeniceKey &&
            value.veniceAudit.inferenceMode === "deterministic-fallback"
          ) {
            return 0;
          }
          if (
            value.blinkMeta &&
            value.blinkMeta.inspectionMode !== "live-action-tx-audited"
          ) {
            return 0;
          }
          return baseTtlMs;
        },
        forceRefresh: forceRefresh === true,
      },
      async () => {
        let report;
        let blinkMeta: BlinkActionInspectionMeta | null = null;
        let txToSimulate = cleanBase64;

        if (cleanBase64) {
          report = analyzeBase64Transaction(cleanBase64);
        } else {
          const inspected = await inspectLiveBlinkUrl({
            blinkUrl: cleanBlinkUrl,
            account: typeof walletAddress === "string" ? walletAddress : undefined,
          });
          report = inspected.report;
          blinkMeta = inspected.blinkMeta;
          if (!txToSimulate && inspected.txBase64) {
            txToSimulate = inspected.txBase64;
          }
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
          shouldSimulateRpc && txToSimulate
            ? simulateSolanaTransactionRpc(txToSimulate, {
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

    const tokenAudits = guarded.value.rpcSimulation?.tokenAudits ?? [];
    if (tokenAudits.length > 0) {
      await Promise.all(
        tokenAudits.map((audit) => recordScannedToken(audit, "tx-firewall"))
      );
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
