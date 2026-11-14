import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  authorizeApiCaller,
  checkRouteRateLimit,
  resetApiGuardState,
  runGuardedCachedOperation,
  tryAcquireBrowserConcurrencySlot,
  tryConsumeDailyServerBudget,
} from "../src/lib/api-guard";
import { buildCorsHeaders } from "../src/lib/cors";
import {
  GUARD_COOKIE_NAME,
  signGuardToken,
  verifyApiSecretHeader,
  verifyGuardToken,
} from "../src/lib/guard-token";
import { parseBuildCheckInput } from "../src/lib/buildcheck/input-parser";
import { buildBuildCheckCacheKeys } from "../src/lib/buildcheck/orchestrator";
import {
  clearScanCache,
  getCachedEntry,
  getScanCacheStats,
  setCachedEntry,
} from "../src/lib/scan-cache";

const TEST_MINT = "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx";

describe("SolShield API Guard & Anti-Abuse Protections", () => {
  const prevEnv = { ...process.env };

  beforeEach(async () => {
    process.env.SOLSHIELD_API_SECRET = "test-super-secret-token-value-12345";
    process.env.SOLSHIELD_CACHE_DIR = path.join(
      os.tmpdir(),
      "solshield-vitest-cache"
    );
    delete process.env.SOLSHIELD_DISABLE_DISK_CACHE;
    delete process.env.SOLSHIELD_REQUIRE_API_KEY;
    delete process.env.SOLSHIELD_DAILY_SERVER_SCANS;
    delete process.env.BUILDCHECK_MAX_CONCURRENT_BROWSERS;
    resetApiGuardState();
    await clearScanCache();
  });

  afterEach(async () => {
    process.env = { ...prevEnv };
    resetApiGuardState();
    await clearScanCache();
  });

  it("signs, verifies, and expires HMAC web session cookies cleanly", async () => {
    const now = 1_760_000_000;
    const token = await signGuardToken(now);
    expect(await verifyGuardToken(token, now + 60)).toBe(true);

    // Tampered token fails
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}00`;
    expect(await verifyGuardToken(tampered, now + 60)).toBe(false);

    // Expired token (>12h) fails
    expect(await verifyGuardToken(token, now + 13 * 60 * 60)).toBe(false);

    // API secret verification
    expect(await verifyApiSecretHeader("test-super-secret-token-value-12345")).toBe(true);
    expect(await verifyApiSecretHeader("Bearer test-super-secret-token-value-12345")).toBe(true);
    expect(await verifyApiSecretHeader("wrong-secret")).toBe(false);
  });

  it("blocks unauthorized raw API requests (401) and foreign cross-site requests (403)", async () => {
    const anonReq = new Request("https://solshield-web-production.up.railway.app/api/buildcheck", {
      method: "POST",
    });
    const anonRes = await authorizeApiCaller(anonReq, { profile: "buildcheck" });
    expect(anonRes.ok).toBe(false);
    if (!anonRes.ok) expect(anonRes.status).toBe(401);

    const foreignReq = new Request(
      "https://solshield-web-production.up.railway.app/api/buildcheck",
      {
        method: "POST",
        headers: {
          Origin: "https://evil-phish-clone.xyz",
          "Sec-Fetch-Site": "cross-site",
        },
      }
    );
    const foreignRes = await authorizeApiCaller(foreignReq, { profile: "buildcheck" });
    expect(foreignRes.ok).toBe(false);
    if (!foreignRes.ok) {
      expect(foreignRes.status).toBe(403);
      expect(foreignRes.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    }

    // Never leaks wildcard CORS on web or extension policies
    expect(buildCorsHeaders(foreignReq, "web")["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(buildCorsHeaders(foreignReq, "extension")["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows valid web-session cookie, API secret, BYOK key, and Chrome Extension on extension routes", async () => {
    const token = await signGuardToken();
    const webReq = new Request("https://solshield-web-production.up.railway.app/api/buildcheck", {
      method: "POST",
      headers: {
        Host: "solshield-web-production.up.railway.app",
        Origin: "https://solshield-web-production.up.railway.app",
        Cookie: `${GUARD_COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const webAuth = await authorizeApiCaller(webReq, { profile: "buildcheck" });
    expect(webAuth.ok).toBe(true);
    if (webAuth.ok) expect(webAuth.authMode).toBe("web-session");

    const cliReq = new Request("https://solshield-web-production.up.railway.app/api/buildcheck", {
      method: "POST",
      headers: { "x-solshield-api-key": "test-super-secret-token-value-12345" },
    });
    const cliAuth = await authorizeApiCaller(cliReq, { profile: "buildcheck" });
    expect(cliAuth.ok).toBe(true);
    if (cliAuth.ok) expect(cliAuth.authMode).toBe("api-key");

    const byokReq = new Request("https://solshield-web-production.up.railway.app/api/buildcheck", {
      method: "POST",
    });
    const byokAuth = await authorizeApiCaller(byokReq, {
      profile: "buildcheck",
      byokKey: "byok_user_owned_test_placeholder_1234",
    });
    expect(byokAuth.ok).toBe(true);
    if (byokAuth.ok) expect(byokAuth.authMode).toBe("byok");

    // Chrome Extension allowed on extension-hybrid, denied on web-only buildcheck
    const extHeaders = { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" };
    const extAuditReq = new Request(
      "https://solshield-web-production.up.railway.app/api/audit",
      { method: "POST", headers: extHeaders }
    );
    const extAuditAuth = await authorizeApiCaller(extAuditReq, {
      profile: "extension-hybrid",
    });
    expect(extAuditAuth.ok).toBe(true);
    expect(buildCorsHeaders(extAuditReq, "extension")["Access-Control-Allow-Origin"]).toBe(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    );

    const extBcReq = new Request(
      "https://solshield-web-production.up.railway.app/api/buildcheck",
      { method: "POST", headers: extHeaders }
    );
    const extBcAuth = await authorizeApiCaller(extBcReq, { profile: "buildcheck" });
    expect(extBcAuth.ok).toBe(false);
    if (!extBcAuth.ok) expect(extBcAuth.status).toBe(403);
  });

  it("enforces per-IP fresh rate limits, daily budget caps, and concurrent Chromium slots", () => {
    const ip = "203.0.113.42";
    for (let i = 0; i < 6; i += 1) {
      const r = checkRouteRateLimit("buildcheck", "fresh", ip, "web-session", 1_000_000);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkRouteRateLimit("buildcheck", "fresh", ip, "web-session", 1_000_001);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    // Concurrent browser slots capped at 2 by default
    const slot1 = tryAcquireBrowserConcurrencySlot();
    const slot2 = tryAcquireBrowserConcurrencySlot();
    const slot3 = tryAcquireBrowserConcurrencySlot();
    expect(slot1).not.toBeNull();
    expect(slot2).not.toBeNull();
    expect(slot3).toBeNull();
    slot1?.();
    const slotAfterRelease = tryAcquireBrowserConcurrencySlot();
    expect(slotAfterRelease).not.toBeNull();
    slot2?.();
    slotAfterRelease?.();

    // Daily shared server budget blocks distributed IPs once exceeded while exempting BYOK & api-key
    process.env.SOLSHIELD_DAILY_SERVER_SCANS = "2";
    expect(tryConsumeDailyServerBudget("web-session")).toBe(true);
    expect(tryConsumeDailyServerBudget("web-session")).toBe(true);
    expect(tryConsumeDailyServerBudget("web-session")).toBe(false);
    expect(tryConsumeDailyServerBudget("byok")).toBe(true);
    expect(tryConsumeDailyServerBudget("api-key")).toBe(true);
  });
});

describe("SolShield Shared Scan Cache & Singleflight Deduplication", () => {
  const prevEnv = { ...process.env };

  beforeEach(async () => {
    process.env.SOLSHIELD_API_SECRET = "test-super-secret-token-value-12345";
    process.env.SOLSHIELD_CACHE_DIR = path.join(
      os.tmpdir(),
      "solshield-vitest-cache-2"
    );
    delete process.env.SOLSHIELD_DISABLE_DISK_CACHE;
    resetApiGuardState();
    await clearScanCache();
  });

  afterEach(async () => {
    process.env = { ...prevEnv };
    resetApiGuardState();
    await clearScanCache();
  });

  it("canonicalizes equivalent Solana token inputs and falls back from b0 to b1 cache", () => {
    const bareMint = parseBuildCheckInput(TEST_MINT);
    const dexUrl = parseBuildCheckInput(`https://dexscreener.com/solana/${TEST_MINT}`);
    const pumpUrl = parseBuildCheckInput(`https://pump.fun/coin/${TEST_MINT}`);

    const bareKeys = buildBuildCheckCacheKeys(bareMint, true);
    const dexKeys = buildBuildCheckCacheKeys(dexUrl, true);
    const pumpKeys = buildBuildCheckCacheKeys(pumpUrl, false);

    expect(bareKeys.primaryKey).toBe(`mint:${TEST_MINT}:b1`);
    expect(dexKeys.primaryKey).toBe(`mint:${TEST_MINT}:b1`);
    expect(pumpKeys.primaryKey).toBe(`mint:${TEST_MINT}:b0`);
    expect(pumpKeys.fallbackKeys).toContain(`mint:${TEST_MINT}:b1`);
  });

  it("reuses stored scan across callers without re-running compute and persists across memory clear", async () => {
    const token = await signGuardToken();
    const makeWebReq = (ip: string, bodyExtra?: Record<string, unknown>) =>
      new Request("https://solshield-web-production.up.railway.app/api/scan-token", {
        method: "POST",
        headers: {
          Host: "solshield-web-production.up.railway.app",
          Origin: "https://solshield-web-production.up.railway.app",
          "x-forwarded-for": ip,
          Cookie: `${GUARD_COOKIE_NAME}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify(bodyExtra ?? {}),
      });

    let computeCount = 0;
    const first = await runGuardedCachedOperation(
      makeWebReq("198.51.100.1"),
      {
        profile: "extension-hybrid",
        namespace: "scan-token",
        cacheKey: TEST_MINT,
        ttlMs: 60_000,
      },
      async () => {
        computeCount += 1;
        return { mint: TEST_MINT, score: 0, run: computeCount };
      }
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.cached).toBe(false);
      expect(first.headers["X-SolShield-Cache"]).toBe("MISS");
    }

    // Second different user gets stored result without re-scanning
    const second = await runGuardedCachedOperation(
      makeWebReq("198.51.100.99"),
      {
        profile: "extension-hybrid",
        namespace: "scan-token",
        cacheKey: TEST_MINT,
        ttlMs: 60_000,
        // Even if normal user passes forceRefresh, cache MUST still be reused
        forceRefresh: true,
      },
      async () => {
        computeCount += 1;
        return { mint: TEST_MINT, score: 99, run: computeCount };
      }
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.cached).toBe(true);
      expect(second.headers["X-SolShield-Cache"]).toBe("HIT");
      expect(second.value.run).toBe(1);
    }
    expect(computeCount).toBe(1);

    // Concurrent parallel calls coalesce into a single execution
    let concurrentRuns = 0;
    const parallelResults = await Promise.all(
      [1, 2, 3, 4, 5].map((idx) =>
        runGuardedCachedOperation(
          makeWebReq(`198.51.100.${idx}`),
          {
            profile: "extension-hybrid",
            namespace: "scan-token",
            cacheKey: "AnotherMintParallelTest11111111111111111",
            ttlMs: 60_000,
          },
          async () => {
            concurrentRuns += 1;
            await new Promise((r) => setTimeout(r, 25));
            return { ok: true, id: concurrentRuns };
          }
        )
      )
    );
    expect(concurrentRuns).toBe(1);
    expect(parallelResults.every((r) => r.ok && r.value.id === 1)).toBe(true);

    // Disk persistence fallback works even if memory LRU map is empty
    await setCachedEntry("disk-test", "sample-key", { saved: 42 }, 60_000);
    // Clear memory only while keeping disk files untouched by using raw cache store reset pattern:
    const g = globalThis as unknown as {
      __solshieldScanCacheStore?: { memory: Map<string, unknown> };
    };
    g.__solshieldScanCacheStore?.memory.clear();
    const diskHit = await getCachedEntry<{ saved: number }>("disk-test", "sample-key");
    expect(diskHit?.value.saved).toBe(42);
    expect(getScanCacheStats().diskHits).toBeGreaterThanOrEqual(1);
  });

  it("skips cache persistence when resolveTtlMs returns <= 0 so transient fallbacks never poison cache", async () => {
    const token = await signGuardToken();
    const makeWebReq = (ip: string) =>
      new Request("https://solshield-web-production.up.railway.app/api/intent", {
        method: "POST",
        headers: {
          Host: "solshield-web-production.up.railway.app",
          Origin: "https://solshield-web-production.up.railway.app",
          "x-forwarded-for": ip,
          Cookie: `${GUARD_COOKIE_NAME}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({ prompt: "Swap 1 SOL to USDC" }),
      });

    let attempt = 0;
    const first = await runGuardedCachedOperation(
      makeWebReq("198.51.100.77"),
      {
        profile: "web-ai",
        namespace: "defi-intent",
        cacheKey: "transient-fallback-test",
        ttlMs: 300_000,
        resolveTtlMs: (v) => (v.degraded ? 0 : 300_000),
      },
      async () => {
        attempt += 1;
        return { degraded: attempt === 1, inferenceMode: attempt === 1 ? "deterministic-fallback" : "venice-live-api" };
      }
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.degraded).toBe(true);

    const second = await runGuardedCachedOperation(
      makeWebReq("198.51.100.78"),
      {
        profile: "web-ai",
        namespace: "defi-intent",
        cacheKey: "transient-fallback-test",
        ttlMs: 300_000,
        resolveTtlMs: (v) => (v.degraded ? 0 : 300_000),
      },
      async () => {
        attempt += 1;
        return { degraded: false, inferenceMode: "venice-live-api" };
      }
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.cached).toBe(false);
      expect(second.value.inferenceMode).toBe("venice-live-api");
    }
    expect(attempt).toBe(2);
  });
});
