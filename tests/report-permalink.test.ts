import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getReportHandler, POST as postReportHandler } from "../src/app/api/buildcheck/report/route";
import { resetApiGuardState } from "../src/lib/api-guard";
import {
  LOCAL_REPORT_TTL_MS,
  findMintByReportIdInTokens,
  readLocalBuildCheckReport,
  saveLocalBuildCheckReport,
} from "../src/lib/buildcheck/local-report-cache";
import {
  MAX_REDIS_REPORT_BYTES,
  compactBuildCheckReportForPermalink,
  compactBuildCheckReportWithinBudget,
  getBuildCheckReportPermalink,
  isValidBuildCheckReportId,
  saveBuildCheckReportPermalink,
} from "../src/lib/buildcheck/report-store";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";
import {
  extractSolanaMintFromFirewallInput,
  getLiveAuditSwapBlinkUrl,
} from "../src/lib/firewall-input";
import { GUARD_COOKIE_NAME, signGuardToken } from "../src/lib/guard-token";
import { clearScanCache } from "../src/lib/scan-cache";
import { formatBuildCheckReplyTweet } from "../worker/x-client";

function makeSampleReport(id = "bc_a1b2c3d4e5"): BuildCheckReport {
  return {
    id,
    createdAt: "2026-11-15T12:00:00.000Z",
    elapsedMs: 4200,
    target: {
      rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      kind: "token_ca",
      mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    },
    authenticityScore: 76,
    verdict: "VERIFIED_BUILD",
    headline: "Verified on-chain build telemetry with open source commits.",
    executiveSummary:
      "Mint and freeze authorities are revoked and active commits align with domain.",
    inferenceMode: "venice-live-api",
    modelsUsed: ["llama-3.3-70b"],
    visionSummary: "Live app UI observed.",
    privacyAttestation: "Venice Zero-Retention",
    componentScores: {
      codeProof: 82,
      chainProof: 88,
      domainProof: 72,
      holdersProof: 74,
      claimAlignment: 79,
    },
    claimsVsProof: [
      {
        claim: "Open source GitHub repository",
        status: "VERIFIED",
        evidence: "Active commits match deployed web bundle.",
      },
    ],
    verifiedSignals: ["Mint authority revoked on Solana Mainnet"],
    keyRedFlags: [],
    browser: {
      mode: "local-chromium",
      executableLabel: "Chromium",
      stops: [
        {
          url: "https://sol-shield.xyz",
          title: "SolShield",
          stepLabel: "Primary Landing",
          screenshotBase64: "A".repeat(25_000),
          textExcerpt: "X".repeat(3000),
          outboundGithub: ["https://github.com/Blanksite/solshield"],
          outboundX: ["https://x.com/usesolshield"],
          outboundSolanaAddresses: ["CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx"],
          networkHosts: ["sol-shield.xyz"],
          xhrCount: 4,
          loadTimeMs: 920,
          hasPlaceholderCopy: false,
          apiPayloads: [
            {
              url: "https://sol-shield.xyz/api/scanned-tokens",
              status: 200,
              jsonExcerpt: "Y".repeat(1600),
            },
          ],
        },
      ],
      discoveredGithubRepos: ["Blanksite/solshield"],
      discoveredXUrls: [],
      discoveredSolanaAddresses: [],
      discoveredWebsiteUrls: ["https://sol-shield.xyz"],
      totalXhrObserved: 4,
      notes: [],
    },
    github: null,
    chain: null,
    domain: null,
    xPost: null,
  };
}

describe("BuildCheck Permalink Store, API & X Reply Links", () => {
  const prevEnv = { ...process.env };

  beforeEach(async () => {
    process.env.SOLSHIELD_API_SECRET = "test-permalink-secret-987654321";
    process.env.SOLSHIELD_CACHE_DIR = path.join(
      os.tmpdir(),
      "solshield-vitest-permalink"
    );
    delete process.env.SOLSHIELD_DISABLE_DISK_CACHE;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetApiGuardState();
    await clearScanCache();
  });

  afterEach(async () => {
    process.env = { ...prevEnv };
    resetApiGuardState();
    await clearScanCache();
  });

  it("validates report IDs strictly", () => {
    expect(isValidBuildCheckReportId("bc_a1b2c3d4e5")).toBe(true);
    expect(isValidBuildCheckReportId("bc_tweet_1")).toBe(true);
    expect(isValidBuildCheckReportId("")).toBe(false);
    expect(isValidBuildCheckReportId("../bc_hack")).toBe(false);
    expect(isValidBuildCheckReportId("not_a_report")).toBe(false);
  });

  it("compacts heavy browser screenshots while preserving forensic proof", () => {
    const raw = makeSampleReport("bc_compact_01");
    const compact = compactBuildCheckReportForPermalink(raw);

    expect(compact.id).toBe("bc_compact_01");
    expect(compact.authenticityScore).toBe(76);
    expect(compact.claimsVsProof).toHaveLength(1);
    expect(compact.browser.stops[0].screenshotBase64).toBe("");
    expect(compact.browser.stops[0].textExcerpt.length).toBeLessThanOrEqual(1800);
    expect(
      compact.browser.stops[0].apiPayloads?.[0]?.jsonExcerpt.length
    ).toBeLessThanOrEqual(900);
  });

  it("saves and retrieves compacted permalink reports by ID", async () => {
    const sample = makeSampleReport("bc_deadbeef01");
    const saved = await saveBuildCheckReportPermalink(sample);
    expect(saved.id).toBe("bc_deadbeef01");

    const loaded = await getBuildCheckReportPermalink("BC_DEADBEEF01");
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("bc_deadbeef01");
    expect(loaded?.browser.stops[0].screenshotBase64).toBe("");
    expect(loaded?.headline).toBe(sample.headline);

    expect(await getBuildCheckReportPermalink("bc_does_not_exist")).toBeNull();
    expect(await getBuildCheckReportPermalink("bad_id")).toBeNull();
  });

  it("enforces api-key auth on POST /api/buildcheck/report and serves GET with web-session cookie", async () => {
    const sample = makeSampleReport("bc_route_9911");
    const unauthPost = new NextRequest(
      "http://localhost:3000/api/buildcheck/report",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "user-agent": "Vitest",
          [GUARD_COOKIE_NAME]: "",
        },
        body: JSON.stringify({ report: sample }),
      }
    );
    const unauthRes = await postReportHandler(unauthPost);
    expect(unauthRes.status).toBe(401);

    const authPost = new NextRequest(
      "http://localhost:3000/api/buildcheck/report",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-solshield-api-key": "test-permalink-secret-987654321",
        },
        body: JSON.stringify({ report: sample }),
      }
    );
    const authRes = await postReportHandler(authPost);
    expect(authRes.status).toBe(201);
    const postJson = (await authRes.json()) as {
      ok: boolean;
      id: string;
      path: string;
    };
    expect(postJson.ok).toBe(true);
    expect(postJson.path).toBe("/buildcheck?report=bc_route_9911");

    const guardCookie = await signGuardToken(
      Math.floor(Date.now() / 1000),
      "VitestBrowser/1.0"
    );
    const getReq = new NextRequest(
      "http://localhost:3000/api/buildcheck/report?id=bc_route_9911",
      {
        method: "GET",
        headers: {
          origin: "http://localhost:3000",
          "user-agent": "VitestBrowser/1.0",
          cookie: `${GUARD_COOKIE_NAME}=${guardCookie}`,
        },
      }
    );
    const getRes = await getReportHandler(getReq);
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as {
      ok: boolean;
      report: BuildCheckReport;
    };
    expect(getJson.ok).toBe(true);
    expect(getJson.report.id).toBe("bc_route_9911");
    expect(getJson.report.browser.stops[0].screenshotBase64).toBe("");
  });

  it("includes direct ?report=<id> permalink in X reply tweet within 280 chars", () => {
    const sample = makeSampleReport("bc_9988776655");
    const tweet = formatBuildCheckReplyTweet(sample, "https://sol-shield.xyz", {
      includeUrl: true,
    });
    expect(tweet).toContain("https://sol-shield.xyz/buildcheck?report=bc_9988776655");
    expect(tweet.length).toBeLessThanOrEqual(280);
  });

  it("detects Solana mint CAs & explorer links in Tx Firewall while ignoring real Base64 transactions", () => {
    const mint = "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx";
    expect(extractSolanaMintFromFirewallInput(mint)).toBe(mint);
    expect(
      extractSolanaMintFromFirewallInput(`https://pump.fun/coin/${mint}?ref=x`)
    ).toBe(mint);
    expect(
      extractSolanaMintFromFirewallInput(
        `https://dexscreener.com/solana/${mint}`
      )
    ).toBe(mint);

    // Base64 serialized transaction (>44 chars and/or with +, /, =) must NOT match as mint CA
    expect(
      extractSolanaMintFromFirewallInput(
        "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
      )
    ).toBeNull();
    expect(
      extractSolanaMintFromFirewallInput(
        "https://sol-shield.xyz/api/actions/audit-swap?amount=0.5"
      )
    ).toBeNull();

    expect(getLiveAuditSwapBlinkUrl("0.5", "http://localhost:3000")).toBe(
      "https://sol-shield.xyz/api/actions/audit-swap?amount=0.5"
    );
    expect(getLiveAuditSwapBlinkUrl("1", "https://sol-shield.xyz")).toBe(
      "https://sol-shield.xyz/api/actions/audit-swap?amount=1"
    );
  });

  it("enforces strict 450KB Redis budget even on oversized cluster/node reports and persists to mocked Upstash", async () => {
    const oversized = makeSampleReport("bc_oversize_01");
    oversized.executiveSummary = "E".repeat(4000);
    oversized.visionSummary = "V".repeat(4000);
    oversized.browser.stops = Array.from({ length: 6 }, (_, i) => ({
      ...oversized.browser.stops[0],
      url: `https://example.test/${i}`,
      textExcerpt: "T".repeat(120_000),
      screenshotBase64: "S".repeat(60_000),
    }));
    const mkNode = (idx: number) => ({
      address: `Addr${String(idx).padStart(36, "0")}xxxx`,
      tokenAccount: `Tok${String(idx).padStart(37, "0")}xxxx`,
      pct: 1.5,
      uiAmount: 1_000_000,
      role: "cabal" as const,
      funder: "Funder11111111111111111111111111111111111111",
      firstSlot: 300_000_000 + idx,
      isFresh: true,
      txCount: 4,
    });
    oversized.chain = {
      mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      tokenReport: null,
      dexPair: null,
      accountRecentTxCount: 120,
      deep: {
        metadata: {
          name: "Oversize",
          symbol: "OVR",
          description: "D".repeat(2000),
          imageUrl: null,
          websites: ["https://sol-shield.xyz"],
          twitterUrl: null,
          telegramUrl: null,
          launchpad: "pump.fun",
          createdAt: "2026-11-15T00:00:00.000Z",
        },
        market: {
          poolAddress: null,
          dexId: "raydium",
          priceUsd: 0.01,
          marketCapUsd: 100_000,
          fdvUsd: 100_000,
          liquidityUsd: 25_000,
          volume24hUsd: 80_000,
          priceChange5m: 1,
          priceChange1h: 5,
          priceChange6h: 10,
          priceChange24h: 20,
          buys1h: 10,
          sells1h: 4,
          buys24h: 100,
          sells24h: 40,
          lpLockedPct: 100,
          lpLockedUsd: 25_000,
        },
        holders: {
          score: 80,
          verdict: "OK",
          totalHolders: 1200,
          distribution: {
            insidersPct: 2,
            snipersPct: 3,
            burnedOrLockedPct: 90,
            devPct: 1,
            retailPct: 94,
          },
          nodes: Array.from({ length: 120 }, (_, i) => mkNode(i)),
          clusters: Array.from({ length: 12 }, (_, c) => ({
            clusterId: `cluster_${c}`,
            kind: "co_funded" as const,
            label: `Cluster ${c} ` + "L".repeat(250),
            funder: `Funder${c}`.padEnd(44, "1"),
            slot: 300_000_000 + c,
            combinedPct: 5,
            wallets: Array.from({ length: 60 }, (_, w) => mkNode(c * 100 + w)),
          })),
          checks: [],
          flagsCount: 0,
          watchCount: 0,
          clearCount: 1,
          notes: [],
        },
        devHistory: {
          devAddress: "Dev1111111111111111111111111111111111111111",
          solBalance: 4.2,
          tokenHoldingPct: 1,
          coinsLaunchedCount: 2,
          flaggedCoinsCount: 0,
          launchedTokens: Array.from({ length: 20 }, (_, i) => ({
            mint: `Mint${i}`.padEnd(44, "1"),
            name: `Launched ${i}`,
            symbol: `L${i}`,
            createdAt: "2026-11-15T00:00:00.000Z",
          })),
          recentTxs: Array.from({ length: 30 }, (_, i) => ({
            signature: `Sig${i}`.padEnd(88, "a"),
            slot: 300_000_000 + i,
            blockTime: 1794000000 + i,
            action: "burn" as const,
            summary: "Burn verified " + "B".repeat(200),
            err: false,
          })),
        },
      },
    };

    const rawBefore = Buffer.byteLength(JSON.stringify(oversized), "utf8");
    expect(rawBefore).toBeGreaterThan(MAX_REDIS_REPORT_BYTES);

    const compacted = compactBuildCheckReportWithinBudget(oversized);
    const compactedBytes = Buffer.byteLength(JSON.stringify(compacted), "utf8");
    expect(compactedBytes).toBeLessThanOrEqual(MAX_REDIS_REPORT_BYTES);

    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token-test-123";

    const origFetch = globalThis.fetch;
    let postedCmd: unknown = null;
    globalThis.fetch = vi.fn(async (_input, init) => {
      postedCmd = JSON.parse(String(init?.body || "[]"));
      return new Response(JSON.stringify({ result: "OK" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await saveBuildCheckReportPermalink(oversized);
      expect(Array.isArray(postedCmd)).toBe(true);
      const args = postedCmd as unknown[];
      expect(args[0]).toBe("SET");
      expect(args[1]).toBe("solshield:buildcheck:report:bc_oversize_01");
      expect(Buffer.byteLength(String(args[2]), "utf8")).toBeLessThanOrEqual(
        MAX_REDIS_REPORT_BYTES
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("caches compact reports in browser localStorage and resolves fallback mint from ledger checkpoints", () => {
    const store = new Map<string, string>();
    const origWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    };

    try {
      const sample = makeSampleReport("bc_LocalCache_77");
      const now = 1_794_764_000_000;
      saveLocalBuildCheckReport(sample, now);

      const hit = readLocalBuildCheckReport("BC_LOCALCACHE_77", now + 1000);
      expect(hit).not.toBeNull();
      expect(hit?.id).toBe("bc_localcache_77");
      expect(hit?.browser.stops[0].screenshotBase64).toBe("");

      const expired = readLocalBuildCheckReport(
        "bc_localcache_77",
        now + LOCAL_REPORT_TTL_MS + 10
      );
      expect(expired).toBeNull();

      const mint = findMintByReportIdInTokens(
        [
          {
            mintAddress: "AoQGnPGXWHo9FfSVhPTmhJGvGXisEDwfaRPnDHHRpump",
            symbol: "TEST",
            name: "Test Token",
            tokenProgram: "SPL Token",
            riskScore: 22,
            classification: "SAFE",
            recommendedAction: "VERIFIED_SAFE",
            verifiedIssuer: null,
            slot: 1,
            scannedAt: "2026-11-15T17:39:00.000Z",
            source: "buildcheck",
            scanCount: 2,
            buildCheckId: "bc_latest999",
            scoreHistory: [
              {
                scannedAt: "2026-11-15T16:00:00.000Z",
                riskScore: 24,
                reportId: "bc_bf7cef71b6",
              },
            ],
          },
        ],
        "bc_bf7cef71b6"
      );
      expect(mint).toBe("AoQGnPGXWHo9FfSVhPTmhJGvGXisEDwfaRPnDHHRpump");
    } finally {
      (globalThis as { window?: unknown }).window = origWindow;
    }
  });
});
