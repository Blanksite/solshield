import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  runGuardedCachedOperation,
} from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { compileDeFiIntentWithJupiter } from "@/lib/intent-builder";
import { createCacheKeyHash } from "@/lib/scan-cache";

export const maxDuration = 30;

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      walletAddress,
      veniceApiKey,
      maxAllowedRiskScore,
      maxDailySol,
      emergencyLocked,
      forceRefresh,
    } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return corsJson(
        { ok: false, error: "Please provide a natural-language DeFi intent." },
        { status: 400, req, policy: "web" }
      );
    }

    if (prompt.trim().length > 1000) {
      return corsJson(
        { ok: false, error: "Intent prompt too long (max 1000 characters)." },
        { status: 400, req, policy: "web" }
      );
    }

    const cacheKey = createCacheKeyHash(
      JSON.stringify({
        prompt: prompt.trim().toLowerCase(),
        walletAddress: typeof walletAddress === "string" ? walletAddress.trim() : null,
        maxAllowedRiskScore: maxAllowedRiskScore ?? null,
        maxDailySol: maxDailySol ?? null,
        emergencyLocked: Boolean(emergencyLocked),
      })
    );

    const hasVeniceKey = Boolean(
      (typeof veniceApiKey === "string" && veniceApiKey.trim()) ||
        process.env.VENICE_API_KEY?.trim()
    );

    const guarded = await runGuardedCachedOperation(
      req,
      {
        profile: "web-ai",
        byokKey: typeof veniceApiKey === "string" ? veniceApiKey : undefined,
        namespace: "defi-intent",
        cacheKey,
        ttlMs: 5 * 60_000,
        resolveTtlMs: (value) => {
          if (
            hasVeniceKey &&
            (value.intent.inferenceMode === "deterministic-fallback" ||
              value.veniceAudit.inferenceMode === "deterministic-fallback")
          ) {
            return 0;
          }
          if (value.quote.quoteMode === "jupiter-unavailable") {
            return 15_000;
          }
          return 5 * 60_000;
        },
        forceRefresh: forceRefresh === true,
      },
      () =>
        compileDeFiIntentWithJupiter({
          prompt,
          walletAddress,
          veniceApiKey,
          maxAllowedRiskScore,
          maxDailySol,
          emergencyLocked,
        })
    );

    if (!guarded.ok) {
      return buildGuardErrorResponse(guarded);
    }

    return corsJson(
      {
        ...guarded.value,
        cached: guarded.cached,
      },
      { req, policy: "web", headers: guarded.headers }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to compile DeFi intent.";
    return corsJson({ ok: false, error: message }, { status: 400, req, policy: "web" });
  }
}
