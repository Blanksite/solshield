import {
  buildCorsHeaders,
  CorsPolicy,
  isAllowedWebOrigin,
  isExtensionOrigin,
} from "./cors";
import {
  GUARD_COOKIE_NAME,
  verifyApiSecretHeader,
  verifyGuardToken,
} from "./guard-token";
import {
  getCachedEntry,
  recordCoalescedHit,
  setCachedEntry,
} from "./scan-cache";
import { NextResponse } from "next/server";

export type ApiGuardProfile =
  | "buildcheck"
  | "extension-hybrid"
  | "web-ai"
  | "web-tool"
  | "solana-actions";

export type ApiAuthMode =
  | "api-key"
  | "web-session"
  | "extension"
  | "byok"
  | "public-blink";

export interface GuardCheckFailure {
  ok: false;
  status: 401 | 403 | 429 | 503;
  error: string;
  headers: Record<string, string>;
}

export interface GuardAuthSuccess {
  ok: true;
  authMode: ApiAuthMode;
  clientIp: string;
  corsPolicy: CorsPolicy;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSec: number;
  headers: Record<string, string>;
}

interface RateLimitSpec {
  limit: number;
  windowMs: number;
}

interface GlobalApiGuardStore {
  windows: Map<string, number[]>;
  dailyUsage: { dateUtc: string; freshServerScans: number };
  activeBrowsers: number;
}

const RATE_POLICY_TABLE: Record<string, RateLimitSpec> = {
  "buildcheck:fresh": { limit: 6, windowMs: 15 * 60_000 },
  "buildcheck:read": { limit: 45, windowMs: 60_000 },
  "extension-hybrid:fresh": { limit: 20, windowMs: 5 * 60_000 },
  "extension-hybrid:read": { limit: 60, windowMs: 60_000 },
  "web-ai:fresh": { limit: 15, windowMs: 5 * 60_000 },
  "web-ai:read": { limit: 40, windowMs: 60_000 },
  "web-tool:fresh": { limit: 45, windowMs: 60_000 },
  "web-tool:read": { limit: 60, windowMs: 60_000 },
  "solana-actions:fresh": { limit: 15, windowMs: 5 * 60_000 },
  "solana-actions:read": { limit: 45, windowMs: 60_000 },
};

function getGuardStore(): GlobalApiGuardStore {
  const g = globalThis as unknown as {
    __solshieldApiGuardStore?: GlobalApiGuardStore;
  };
  if (!g.__solshieldApiGuardStore) {
    g.__solshieldApiGuardStore = {
      windows: new Map(),
      dailyUsage: {
        dateUtc: new Date().toISOString().slice(0, 10),
        freshServerScans: 0,
      },
      activeBrowsers: 0,
    };
  }
  return g.__solshieldApiGuardStore;
}

function profileToCorsPolicy(profile: ApiGuardProfile): CorsPolicy {
  if (profile === "extension-hybrid") return "extension";
  if (profile === "solana-actions") return "actions";
  return "web";
}

/**
 * Extracts normalized client IP behind Railway / reverse proxies.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  const realIp =
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim();
  if (realIp && realIp.length <= 64) return realIp;
  return "local";
}

function parseCookieHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const segments = cookieHeader.split(";");
  for (const seg of segments) {
    const eqIdx = seg.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = seg.slice(0, eqIdx).trim();
    if (key === name) {
      return decodeURIComponent(seg.slice(eqIdx + 1).trim());
    }
  }
  return null;
}

function extractRefererOrigin(req: Request): string | null {
  const ref = req.headers.get("referer")?.trim();
  if (!ref) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
}

/**
 * Enforces caller authorization + origin safety so third-party websites and
 * unauthorized automated scripts cannot invoke paid backend pipelines directly.
 */
export async function authorizeApiCaller(
  req: Request,
  options: {
    profile: ApiGuardProfile;
    byokKey?: string | null;
  }
): Promise<GuardAuthSuccess | GuardCheckFailure> {
  const corsPolicy = profileToCorsPolicy(options.profile);
  const corsHeaders = buildCorsHeaders(req, corsPolicy);
  const clientIp = getClientIp(req);

  // 1. Check trusted API secret header first (allows authorized CLI/worker automation)
  const apiKeyHeader =
    req.headers.get("x-solshield-api-key") || req.headers.get("authorization");
  if (await verifyApiSecretHeader(apiKeyHeader)) {
    return {
      ok: true,
      authMode: "api-key",
      clientIp,
      corsPolicy,
    };
  }

  // Optional strict lockdown toggle for private-only deployments
  if (
    process.env.SOLSHIELD_REQUIRE_API_KEY === "true" &&
    options.profile !== "solana-actions" &&
    !(options.byokKey && options.byokKey.trim().length >= 16)
  ) {
    return {
      ok: false,
      status: 401,
      error: "API key required. Pass x-solshield-api-key or supply your own Venice API key.",
      headers: corsHeaders,
    };
  }

  // 2. Enforce origin / cross-site browser boundary
  const origin = req.headers.get("origin")?.trim() || null;
  const refererOrigin = extractRefererOrigin(req);
  const secFetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase() || "";
  const allowsExt = options.profile === "extension-hybrid";

  if (options.profile !== "solana-actions") {
    if (origin) {
      const originAllowed =
        isAllowedWebOrigin(origin, req) || (allowsExt && isExtensionOrigin(origin));
      if (!originAllowed) {
        return {
          ok: false,
          status: 403,
          error: "Forbidden cross-origin API request.",
          headers: corsHeaders,
        };
      }
    } else if (refererOrigin) {
      const refAllowed =
        isAllowedWebOrigin(refererOrigin, req) ||
        (allowsExt && isExtensionOrigin(refererOrigin));
      if (!refAllowed) {
        return {
          ok: false,
          status: 403,
          error: "Forbidden cross-origin referer.",
          headers: corsHeaders,
        };
      }
    }

    if (secFetchSite === "cross-site" && !(allowsExt && isExtensionOrigin(origin))) {
      return {
        ok: false,
        status: 403,
        error: "Cross-site browser API requests are blocked.",
        headers: corsHeaders,
      };
    }
  }

  // 3. Public Solana Blinks Actions remain callable by external wallets (rate-limited below)
  if (options.profile === "solana-actions") {
    return {
      ok: true,
      authMode: "public-blink",
      clientIp,
      corsPolicy,
    };
  }

  // 4. Verify signed web-session HttpOnly cookie minted by middleware.ts
  const rawGuardCookie = parseCookieHeader(
    req.headers.get("cookie"),
    GUARD_COOKIE_NAME
  );
  if (await verifyGuardToken(rawGuardCookie)) {
    return {
      ok: true,
      authMode: "web-session",
      clientIp,
      corsPolicy,
    };
  }

  // 5. Chrome Extension MV3 caller on extension-supported endpoints
  if (allowsExt && isExtensionOrigin(origin)) {
    return {
      ok: true,
      authMode: "extension",
      clientIp,
      corsPolicy,
    };
  }

  // 6. Caller supplying their own Venice BYOK key
  if (options.byokKey && options.byokKey.trim().length >= 16) {
    return {
      ok: true,
      authMode: "byok",
      clientIp,
      corsPolicy,
    };
  }

  return {
    ok: false,
    status: 401,
    error:
      "Unauthorized API request. Open the SolShield web app, use the Chrome Extension, provide your own Venice API key, or pass x-solshield-api-key.",
    headers: corsHeaders,
  };
}

/**
 * Checks sliding-window rate limits per IP and route category.
 */
export function checkRouteRateLimit(
  profile: ApiGuardProfile,
  kind: "read" | "fresh",
  clientIp: string,
  authMode: ApiAuthMode,
  nowMs = Date.now()
): RateLimitResult {
  const store = getGuardStore();
  const policyKey = `${profile}:${kind}`;
  const spec = RATE_POLICY_TABLE[policyKey] ?? { limit: 30, windowMs: 60_000 };
  const effectiveLimit = authMode === "api-key" ? spec.limit * 20 : spec.limit;

  const bucketKey = `${policyKey}:${authMode}:${clientIp}`;
  const cutoff = nowMs - spec.windowMs;
  const timestamps = (store.windows.get(bucketKey) ?? []).filter((ts) => ts > cutoff);

  const resetAtMs =
    timestamps.length > 0 ? timestamps[0] + spec.windowMs : nowMs + spec.windowMs;

  if (timestamps.length >= effectiveLimit) {
    store.windows.set(bucketKey, timestamps);
    const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
    return {
      allowed: false,
      limit: effectiveLimit,
      remaining: 0,
      resetAtMs,
      retryAfterSec,
      headers: {
        "X-RateLimit-Limit": String(effectiveLimit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(resetAtMs / 1000)),
        "Retry-After": String(retryAfterSec),
      },
    };
  }

  timestamps.push(nowMs);
  store.windows.set(bucketKey, timestamps);

  // Opportunistic sweep when map grows large
  if (store.windows.size > 2000) {
    for (const [k, list] of store.windows.entries()) {
      if (list.length === 0 || list[list.length - 1] <= nowMs - 15 * 60_000) {
        store.windows.delete(k);
      }
    }
  }

  const remaining = Math.max(0, effectiveLimit - timestamps.length);
  return {
    allowed: true,
    limit: effectiveLimit,
    remaining,
    resetAtMs,
    retryAfterSec: 0,
    headers: {
      "X-RateLimit-Limit": String(effectiveLimit),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(Math.ceil(resetAtMs / 1000)),
    },
  };
}

/**
 * Checks rate limit without incrementing counters (for UI/status reporting).
 */
export function peekFreshBuildCheckQuota(
  clientIp: string,
  authMode: ApiAuthMode,
  nowMs = Date.now()
): { limit: number; remaining: number; resetAtIso: string } {
  const store = getGuardStore();
  const spec = RATE_POLICY_TABLE["buildcheck:fresh"];
  const effectiveLimit = authMode === "api-key" ? spec.limit * 20 : spec.limit;
  const bucketKey = `buildcheck:fresh:${authMode}:${clientIp}`;
  const cutoff = nowMs - spec.windowMs;
  const timestamps = (store.windows.get(bucketKey) ?? []).filter((ts) => ts > cutoff);
  const resetAtMs =
    timestamps.length > 0 ? timestamps[0] + spec.windowMs : nowMs + spec.windowMs;
  return {
    limit: effectiveLimit,
    remaining: Math.max(0, effectiveLimit - timestamps.length),
    resetAtIso: new Date(resetAtMs).toISOString(),
  };
}

/**
 * Protects shared server Venice & Helius budgets across distributed callers.
 * Callers with an API secret key or BYOK Venice key bypass this shared cap.
 */
export function tryConsumeDailyServerBudget(authMode: ApiAuthMode): boolean {
  if (authMode === "api-key" || authMode === "byok") return true;

  const rawMax = process.env.SOLSHIELD_DAILY_SERVER_SCANS?.trim();
  const maxDaily = rawMax ? Number(rawMax) : 250;
  if (!Number.isFinite(maxDaily) || maxDaily <= 0) return true;

  const store = getGuardStore();
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (store.dailyUsage.dateUtc !== todayUtc) {
    store.dailyUsage = { dateUtc: todayUtc, freshServerScans: 0 };
  }
  if (store.dailyUsage.freshServerScans >= maxDaily) {
    return false;
  }
  store.dailyUsage.freshServerScans += 1;
  return true;
}

export function getMaxConcurrentBrowsers(): number {
  const parsed = Number(process.env.BUILDCHECK_MAX_CONCURRENT_BROWSERS || 2);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2;
}

/**
 * Bounds simultaneous headless Chromium launches to protect container RAM (e.g. 512MB Railway).
 */
export function tryAcquireBrowserConcurrencySlot(): (() => void) | null {
  const store = getGuardStore();
  const maxConcurrent = getMaxConcurrentBrowsers();
  if (store.activeBrowsers >= maxConcurrent) {
    return null;
  }
  store.activeBrowsers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    store.activeBrowsers = Math.max(0, store.activeBrowsers - 1);
  };
}

export function getApiGuardSnapshot(): {
  activeBrowsers: number;
  maxConcurrentBrowsers: number;
  dailyFreshServerScans: number;
  dailyBudgetDateUtc: string;
  dailyBudgetLimit: number;
} {
  const store = getGuardStore();
  const todayUtc = new Date().toISOString().slice(0, 10);
  const dailyScans =
    store.dailyUsage.dateUtc === todayUtc ? store.dailyUsage.freshServerScans : 0;
  const rawMax = process.env.SOLSHIELD_DAILY_SERVER_SCANS?.trim();
  const maxDaily = rawMax ? Number(rawMax) : 250;

  return {
    activeBrowsers: store.activeBrowsers,
    maxConcurrentBrowsers: getMaxConcurrentBrowsers(),
    dailyFreshServerScans: dailyScans,
    dailyBudgetDateUtc: todayUtc,
    dailyBudgetLimit: Number.isFinite(maxDaily) ? maxDaily : 250,
  };
}

/**
 * Helper to turn guard failure into consistent JSON NextResponse with CORS & Retry headers.
 */
export function buildGuardErrorResponse(failure: GuardCheckFailure): NextResponse {
  return NextResponse.json(
    { ok: false, error: failure.error },
    {
      status: failure.status,
      headers: failure.headers,
    }
  );
}

/**
 * Enforces caller authorization AND read rate limit in one step for standard JSON endpoints.
 */
export async function guardApiRoute(
  req: Request,
  options: {
    profile: ApiGuardProfile;
    kind?: "read" | "fresh";
    byokKey?: string | null;
  }
): Promise<
  | (GuardAuthSuccess & { rateHeaders: Record<string, string> })
  | GuardCheckFailure
> {
  const auth = await authorizeApiCaller(req, {
    profile: options.profile,
    byokKey: options.byokKey,
  });
  if (!auth.ok) return auth;

  const rate = checkRouteRateLimit(
    options.profile,
    options.kind ?? "read",
    auth.clientIp,
    auth.authMode
  );
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded. Please retry in ${rate.retryAfterSec}s.`,
      headers: {
        ...buildCorsHeaders(req, auth.corsPolicy),
        ...rate.headers,
      },
    };
  }

  return {
    ...auth,
    rateHeaders: rate.headers,
  };
}

function getOperationInFlightMap(): Map<string, Promise<unknown>> {
  const g = globalThis as unknown as {
    __solshieldOpInFlight?: Map<string, Promise<unknown>>;
  };
  if (!g.__solshieldOpInFlight) {
    g.__solshieldOpInFlight = new Map();
  }
  return g.__solshieldOpInFlight;
}

/**
 * Shared guard + cache + singleflight executor for standard JSON scan/audit routes.
 * Reuses stored results without charging fresh rate limits or daily server budgets.
 */
export async function runGuardedCachedOperation<T>(
  req: Request,
  options: {
    profile: ApiGuardProfile;
    byokKey?: string | null;
    namespace: string;
    cacheKey: string;
    ttlMs: number;
    forceRefresh?: boolean;
  },
  compute: () => Promise<T>
): Promise<
  | {
      ok: true;
      value: T;
      cached: boolean;
      cachedAt: string;
      corsPolicy: CorsPolicy;
      headers: Record<string, string>;
    }
  | GuardCheckFailure
> {
  const auth = await authorizeApiCaller(req, {
    profile: options.profile,
    byokKey: options.byokKey,
  });
  if (!auth.ok) return auth;

  const corsHeaders = buildCorsHeaders(req, auth.corsPolicy);
  const readRate = checkRouteRateLimit(
    options.profile,
    "read",
    auth.clientIp,
    auth.authMode
  );
  if (!readRate.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded. Please retry in ${readRate.retryAfterSec}s.`,
      headers: {
        ...corsHeaders,
        ...readRate.headers,
      },
    };
  }

  const allowForceRefresh =
    Boolean(options.forceRefresh) && auth.authMode === "api-key";

  if (!allowForceRefresh) {
    const hit = await getCachedEntry<T>(options.namespace, options.cacheKey);
    if (hit) {
      return {
        ok: true,
        value: hit.value,
        cached: true,
        cachedAt: hit.cachedAt,
        corsPolicy: auth.corsPolicy,
        headers: {
          ...corsHeaders,
          ...readRate.headers,
          "X-SolShield-Cache": "HIT",
        },
      };
    }

    const opMap = getOperationInFlightMap();
    const compositeOp = `${options.namespace}:${options.cacheKey}`;
    const existing = opMap.get(compositeOp) as Promise<T> | undefined;
    if (existing) {
      recordCoalescedHit();
      const value = await existing;
      return {
        ok: true,
        value,
        cached: true,
        cachedAt: new Date().toISOString(),
        corsPolicy: auth.corsPolicy,
        headers: {
          ...corsHeaders,
          ...readRate.headers,
          "X-SolShield-Cache": "COALESCED",
        },
      };
    }
  }

  const freshRate = checkRouteRateLimit(
    options.profile,
    "fresh",
    auth.clientIp,
    auth.authMode
  );
  if (!freshRate.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Fresh scan rate limit reached (${freshRate.limit}). Please retry in ${freshRate.retryAfterSec}s.`,
      headers: {
        ...corsHeaders,
        ...freshRate.headers,
      },
    };
  }

  if (!tryConsumeDailyServerBudget(auth.authMode)) {
    return {
      ok: false,
      status: 429,
      error:
        "Daily shared SolShield server scan capacity reached. Supply your own Venice API key (BYOK) or retry after 00:00 UTC.",
      headers: {
        ...corsHeaders,
        ...freshRate.headers,
      },
    };
  }

  const opMap = getOperationInFlightMap();
  const compositeOp = `${options.namespace}:${options.cacheKey}`;
  const execPromise = (async () => {
    const value = await compute();
    await setCachedEntry(options.namespace, options.cacheKey, value, options.ttlMs);
    return value;
  })();
  opMap.set(compositeOp, execPromise);

  try {
    const value = await execPromise;
    return {
      ok: true,
      value,
      cached: false,
      cachedAt: new Date().toISOString(),
      corsPolicy: auth.corsPolicy,
      headers: {
        ...corsHeaders,
        ...freshRate.headers,
        "X-SolShield-Cache": "MISS",
      },
    };
  } finally {
    opMap.delete(compositeOp);
  }
}

/**
 * Resets rate limit, daily budget, and concurrency counters (for unit tests).
 */
export function resetApiGuardState(): void {
  const store = getGuardStore();
  store.windows.clear();
  store.dailyUsage = {
    dateUtc: new Date().toISOString().slice(0, 10),
    freshServerScans: 0,
  };
  store.activeBrowsers = 0;
  getOperationInFlightMap().clear();
}
