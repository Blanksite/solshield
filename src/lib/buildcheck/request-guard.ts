import { NextRequest, NextResponse } from "next/server";
import {
  authorizeApiCaller,
  buildGuardErrorResponse,
  checkDistributedFreshRateLimit,
  checkRouteRateLimit,
  tryAcquireBrowserConcurrencySlot,
  tryConsumeDailyServerBudgetAsync,
} from "../api-guard";
import { buildCorsHeaders } from "../cors";
import { peekBuildCheckReuseState } from "./orchestrator";

const MAX_BUILDCHECK_INPUT_LENGTH = 600;

export interface PreparedBuildCheckRequest {
  ok: true;
  input: string;
  veniceApiKey?: string;
  veniceModel?: string;
  enableBrowser: boolean;
  forceRefresh: boolean;
  cacheHit: boolean;
  inFlight: boolean;
  responseHeaders: Record<string, string>;
  releaseConcurrency?: () => void;
}

export interface RejectedBuildCheckRequest {
  ok: false;
  response: NextResponse;
}

/**
 * Shared guard + cache-awareness orchestrator for `/api/buildcheck` and `/api/buildcheck/stream`.
 * Validates caller credentials/origin, checks shared scan cache before charging
 * fresh scan quotas, and acquires concurrency locks only for net-new browser runs.
 */
export async function prepareBuildCheckRequest(
  req: NextRequest
): Promise<PreparedBuildCheckRequest | RejectedBuildCheckRequest> {
  let body: {
    input?: unknown;
    veniceApiKey?: unknown;
    veniceModel?: unknown;
    enableBrowser?: unknown;
    forceRefresh?: unknown;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Invalid JSON request body." },
        { status: 400, headers: buildCorsHeaders(req, "web") }
      ),
    };
  }

  const byokKey =
    typeof body.veniceApiKey === "string" ? body.veniceApiKey.trim() : undefined;

  const auth = await authorizeApiCaller(req, {
    profile: "buildcheck",
    byokKey,
  });
  if (!auth.ok) {
    return { ok: false, response: buildGuardErrorResponse(auth) };
  }

  const corsHeaders = buildCorsHeaders(req, auth.corsPolicy);
  const rawInput = typeof body.input === "string" ? body.input.trim() : "";

  if (!rawInput) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "Paste a token CA (Solana or EVM/Robinhood), X link, GitHub repo, or website URL.",
        },
        { status: 400, headers: corsHeaders }
      ),
    };
  }

  if (rawInput.length > MAX_BUILDCHECK_INPUT_LENGTH) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: `Input too long (max ${MAX_BUILDCHECK_INPUT_LENGTH} characters).`,
        },
        { status: 400, headers: corsHeaders }
      ),
    };
  }

  const readRate = checkRouteRateLimit(
    "buildcheck",
    "read",
    auth.clientIp,
    auth.authMode
  );
  if (!readRate.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: `Too many requests. Please retry in ${readRate.retryAfterSec}s.`,
        },
        { status: 429, headers: { ...corsHeaders, ...readRate.headers } }
      ),
    };
  }

  const enableBrowser =
    typeof body.enableBrowser === "boolean" ? body.enableBrowser : true;
  const forceRefresh =
    body.forceRefresh === true &&
    (auth.authMode === "api-key" || auth.authMode === "byok");

  let reuseState;
  try {
    reuseState = await peekBuildCheckReuseState(rawInput, enableBrowser);
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Invalid BuildCheck target.",
        },
        { status: 400, headers: corsHeaders }
      ),
    };
  }

  const isCacheReuse = reuseState.cacheHit && !forceRefresh;
  const isInFlightJoin = reuseState.inFlight && !forceRefresh;

  if (isCacheReuse || isInFlightJoin) {
    return {
      ok: true,
      input: rawInput,
      veniceApiKey: byokKey,
      veniceModel:
        typeof body.veniceModel === "string" ? body.veniceModel.trim() : undefined,
      enableBrowser,
      forceRefresh: false,
      cacheHit: isCacheReuse,
      inFlight: isInFlightJoin,
      responseHeaders: {
        ...corsHeaders,
        ...readRate.headers,
        "X-SolShield-Cache": isCacheReuse ? "HIT" : "COALESCED",
      },
    };
  }

  const freshRate = await checkDistributedFreshRateLimit(
    "buildcheck",
    auth.clientIp,
    auth.authMode
  );
  if (!freshRate.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: `Fresh scan rate limit reached (${freshRate.limit} per 15 min). Retry in ${freshRate.retryAfterSec}s or scan a previously checked target from cache.`,
        },
        { status: 429, headers: { ...corsHeaders, ...freshRate.headers } }
      ),
    };
  }

  if (!(await tryConsumeDailyServerBudgetAsync(auth.authMode))) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error:
            "Daily shared SolShield server scan capacity reached. Supply your own Venice API key (BYOK) in Settings or retry after 00:00 UTC.",
        },
        { status: 429, headers: { ...corsHeaders, ...freshRate.headers } }
      ),
    };
  }

  let releaseConcurrency: (() => void) | undefined;
  if (enableBrowser) {
    const slot = tryAcquireBrowserConcurrencySlot();
    if (!slot) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            error:
              "Headless audit workers are currently busy. Please retry in a few seconds.",
          },
          {
            status: 503,
            headers: {
              ...corsHeaders,
              ...freshRate.headers,
              "Retry-After": "8",
            },
          }
        ),
      };
    }
    releaseConcurrency = slot;
  }

  return {
    ok: true,
    input: rawInput,
    veniceApiKey: byokKey,
    veniceModel:
      typeof body.veniceModel === "string" ? body.veniceModel.trim() : undefined,
    enableBrowser,
    forceRefresh,
    cacheHit: false,
    inFlight: false,
    releaseConcurrency,
    responseHeaders: {
      ...corsHeaders,
      ...freshRate.headers,
      "X-SolShield-Cache": "MISS",
    },
  };
}
