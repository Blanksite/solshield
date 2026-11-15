import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GET as getScannedTokensHandler,
  POST as postScannedTokensHandler,
} from "../src/app/api/scanned-tokens/route";
import { resetApiGuardState } from "../src/lib/api-guard";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";
import {
  classifyLedgerTier,
  computeDualAxisSummary,
  computeMarketPulse,
  extractMarketSnapshotFromReport,
  filterAndSortScannedTokens,
  formatRelativeTime,
  toScannedTokenExtraFromReport,
} from "../src/lib/buildcheck/war-room-metrics";
import { GUARD_COOKIE_NAME, signGuardToken } from "../src/lib/guard-token";
import {
  mergeScannedTokenLists,
  tokenReportToSummary,
} from "../src/lib/scanned-token-types";
import {
  clearScannedTokens,
  recordScannedTokenSummary,
} from "../src/lib/scanned-tokens";
import type { TokenScanReport } from "../src/lib/token-scanner";

function makeTokenReport(
  overrides: Partial<TokenScanReport> = {}
): TokenScanReport {
  return {
    mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    tokenProgram: "Token-2022",
    programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    isToken2022: true,
    isPumpFunSuffix: false,
    verifiedAsset: null,
    name: "SolShield",
    symbol: "SHIELD",
    decimals: 6,
    rawSupply: "1000000000000",
    supplyUi: 1_000_000,
    mintAuthority: null,
    freezeAuthority: null,
    extensions: [],
    transferFeeBps: null,
    permanentDelegate: null,
    transferHookProgramId: null,
    defaultAccountState: null,
    topHolders: [],
    top5Pct: 12,
    top10Pct: 19,
    riskScore: 8,
    classification: "SAFE",
    recommendedAction: "VERIFIED_SAFE",
    executiveSummary: "Authorities revoked.",
    flags: [],
    slot: 340000000,
    latencyMs: 30,
    inferenceMode: "deterministic-fallback",
    privacyAttestation: "Zero-retention",
    ...overrides,
  };
}

function makeBuildCheckReport(
  overrides: Partial<BuildCheckReport> = {}
): BuildCheckReport {
  return {
    id: "bc_warroom01",
    createdAt: "2026-11-16T00:00:00.000Z",
    elapsedMs: 3200,
    target: {
      rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      kind: "token_ca",
      mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    },
    authenticityScore: 81,
    verdict: "VERIFIED_BUILD",
    headline: "Verified GitHub build aligned with domain and clean holder posture.",
    executiveSummary: "Active repo and safe authorities.",
    inferenceMode: "venice-live-api",
    modelsUsed: ["llama-3.3-70b"],
    visionSummary: "Live app observed.",
    privacyAttestation: "Venice Zero-Retention",
    componentScores: {
      codeProof: 85,
      domainProof: 75,
      claimAlignment: 80,
      chainProof: 88,
      holdersProof: 76,
    },
    claimsVsProof: [],
    verifiedSignals: [],
    keyRedFlags: [],
    browser: {
      mode: "http-fallback",
      executableLabel: "HTTP Fallback",
      stops: [],
      discoveredGithubRepos: [],
      discoveredXUrls: [],
      discoveredSolanaAddresses: [],
      discoveredWebsiteUrls: [],
      totalXhrObserved: 0,
      notes: [],
    },
    github: null,
    domain: null,
    xPost: null,
    chain: {
      mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      tokenReport: makeTokenReport(),
      dexPair: {
        dexId: "raydium",
        pairAddress: "Pair111111111111111111111111111111111111111",
        pairUrl: "https://dexscreener.com/solana/pair",
        liquidityUsd: 48_000,
        fdv: 250_000,
        volume24hUsd: 120_000,
        pairCreatedAt: "2026-11-14T00:00:00.000Z",
        pairAgeHours: 48,
        websites: ["https://sol-shield.xyz"],
        socials: [],
      },
      accountRecentTxCount: 15,
      deep: {
        metadata: {
          name: "SolShield",
          symbol: "SHIELD",
          description: "Zero-retention Solana audit agent",
          imageUrl: null,
          websites: ["https://sol-shield.xyz"],
          twitterUrl: "https://x.com/usesolshield",
          telegramUrl: null,
          launchpad: null,
          createdAt: null,
        },
        market: {
          poolAddress: "Pair111111111111111111111111111111111111111",
          dexId: "raydium",
          priceUsd: 0.00025,
          marketCapUsd: 250_000,
          fdvUsd: 250_000,
          liquidityUsd: 48_000,
          volume24hUsd: 120_000,
          priceChange5m: 3.5,
          priceChange1h: 12.4,
          priceChange6h: 18.2,
          priceChange24h: 42.0,
          buys1h: 68,
          sells1h: 32,
          buys24h: 420,
          sells24h: 210,
          lpLockedPct: 100,
          lpLockedUsd: 48_000,
        },
        holders: {
          score: 76,
          verdict: "OK",
          totalHolders: 1450,
          distribution: {
            insidersPct: 2,
            snipersPct: 3,
            burnedOrLockedPct: 45,
            devPct: 1,
            retailPct: 49,
          },
          clusters: [],
          nodes: [],
          checks: [],
          flagsCount: 0,
          watchCount: 1,
          clearCount: 6,
          notes: [],
        },
        devHistory: {
          devAddress: "Dev1111111111111111111111111111111111111111",
          solBalance: 4.5,
          tokenHoldingPct: 1.0,
          coinsLaunchedCount: 2,
          flaggedCoinsCount: 0,
          launchedTokens: [],
          recentTxs: [
            {
              signature: "sigBurn1",
              slot: 340000100,
              blockTime: 1794700000,
              action: "burn",
              summary: "Burned LP supply",
              err: false,
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

describe("Fase 2 War-Room Metrics, Baselines, Telemetry & Audit Ledger", () => {
  let tempDir: string;
  let prevCacheDir: string | undefined;
  let prevSecret: string | undefined;

  beforeEach(async () => {
    prevCacheDir = process.env.SOLSHIELD_CACHE_DIR;
    prevSecret = process.env.SOLSHIELD_API_SECRET;
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "solshield-fase2-test-")
    );
    process.env.SOLSHIELD_CACHE_DIR = tempDir;
    process.env.SOLSHIELD_API_SECRET = "test-api-secret-fase2";
    resetApiGuardState();
    await clearScannedTokens();
  });

  afterEach(async () => {
    await clearScannedTokens();
    resetApiGuardState();
    if (prevCacheDir === undefined) delete process.env.SOLSHIELD_CACHE_DIR;
    else process.env.SOLSHIELD_CACHE_DIR = prevCacheDir;
    if (prevSecret === undefined) delete process.env.SOLSHIELD_API_SECRET;
    else process.env.SOLSHIELD_API_SECRET = prevSecret;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("computes Dual-Axis Forensic Profile & Deployer Track Record using original SolShield labels", () => {
    const tokenReport = makeBuildCheckReport();
    const summary = computeDualAxisSummary(tokenReport);

    expect(summary.buildIntegrity.score).toBe(81);
    expect(summary.buildIntegrity.label).toBe("VERIFIED BUILD");
    expect(summary.buildIntegrity.tone).toBe("emerald");

    expect(summary.holderPosture.score).toBe(81);
    expect(summary.holderPosture.label).toBe("CLEAN POSTURE");
    expect(summary.holderPosture.tone).toBe("emerald");

    expect(summary.deployerRecord).not.toBeNull();
    expect(summary.deployerRecord?.label).toBe("CLEAN HISTORY");
    expect(summary.deployerRecord?.priorMintsCount).toBe(2);
    expect(summary.deployerRecord?.alertCount).toBe(0);
    expect(summary.deployerRecord?.burnsCount).toBe(1);

    // Low-score target & deployer alerts
    const riskReport = makeBuildCheckReport({
      authenticityScore: 22,
      verdict: "HIGH_FABRICATION_RISK",
      componentScores: {
        codeProof: 10,
        domainProof: 25,
        claimAlignment: 15,
        chainProof: 20,
        holdersProof: 28,
      },
      chain: {
        ...tokenReport.chain!,
        deep: {
          ...tokenReport.chain!.deep!,
          devHistory: {
            ...tokenReport.chain!.deep!.devHistory,
            coinsLaunchedCount: 7,
            flaggedCoinsCount: 4,
            recentTxs: [],
          },
        },
      },
    });
    const riskSummary = computeDualAxisSummary(riskReport);
    expect(riskSummary.buildIntegrity.label).toBe("VAPORWARE RISK");
    expect(riskSummary.buildIntegrity.tone).toBe("rose");
    expect(riskSummary.holderPosture.label).toBe("ELEVATED EXPOSURE");
    expect(riskSummary.deployerRecord?.label).toBe("PRIOR ALERTS");
    expect(riskSummary.deployerRecord?.tone).toBe("rose");

    // Non-token off-chain target
    const repoOnly = makeBuildCheckReport({
      chain: null,
      componentScores: {
        codeProof: 78,
        domainProof: 70,
        claimAlignment: 74,
        chainProof: null,
        holdersProof: null,
      },
    });
    const repoSummary = computeDualAxisSummary(repoOnly);
    expect(repoSummary.holderPosture.score).toBeNull();
    expect(repoSummary.holderPosture.label).toBe("OFF-CHAIN TARGET");
    expect(repoSummary.deployerRecord).toBeNull();
  });

  it("computes Market Telemetry momentum and Delta vs First Audit honestly", () => {
    const report = makeBuildCheckReport();
    const market = report.chain!.deep!.market;

    const bullish = computeMarketPulse({
      market,
      dexPair: report.chain!.dexPair,
      firstPriceUsd: 0.0001,
      firstMarketCapUsd: 100_000,
      firstSeenAt: "2026-11-15T12:00:00.000Z",
    });
    expect(bullish.flowState).toBe("BULLISH FLOW");
    expect(bullish.pctSinceFirstAudit).toBe(150);
    expect(bullish.buyRatioPct).toBe(68);
    expect(bullish.buyRatioWindow).toBe("1h");

    const bearish = computeMarketPulse({
      market: {
        ...market,
        priceUsd: 0.00008,
        priceChange5m: -6.2,
        priceChange1h: -14.5,
        buys1h: 25,
        sells1h: 75,
      },
      firstPriceUsd: 0.0001,
    });
    expect(bearish.flowState).toBe("SELL PRESSURE");
    expect(bearish.pctSinceFirstAudit).toBe(-20);
    expect(bearish.buyRatioPct).toBe(25);

    const flat = computeMarketPulse({
      market: {
        ...market,
        priceChange5m: 0.4,
        priceChange1h: 1.2,
        buys1h: 51,
        sells1h: 49,
      },
    });
    expect(flat.flowState).toBe("CONSOLIDATING");

    const empty = computeMarketPulse({});
    expect(empty.flowState).toBe("NO MARKET DATA");
  });

  it("preserves initial price/MC baselines and checkpoint history across repeat scans", async () => {
    const firstReport = makeBuildCheckReport({
      id: "bc_first01",
      authenticityScore: 52,
      verdict: "UNPROVEN_HYPE",
    });
    firstReport.chain!.deep!.market.priceUsd = 0.0001;
    firstReport.chain!.deep!.market.marketCapUsd = 100_000;

    const entry1 = tokenReportToSummary(
      makeTokenReport({ riskScore: 34, classification: "CAUTION" }),
      "buildcheck",
      "2026-11-15T10:00:00.000Z",
      toScannedTokenExtraFromReport(firstReport)
    );
    await recordScannedTokenSummary(entry1);

    const secondReport = makeBuildCheckReport({
      id: "bc_second02",
      authenticityScore: 81,
      verdict: "VERIFIED_BUILD",
    });
    secondReport.chain!.deep!.market.priceUsd = 0.00025;
    secondReport.chain!.deep!.market.marketCapUsd = 250_000;

    const entry2 = tokenReportToSummary(
      makeTokenReport({ riskScore: 8, classification: "SAFE" }),
      "buildcheck",
      "2026-11-15T14:00:00.000Z",
      toScannedTokenExtraFromReport(secondReport)
    );
    const mergedSaved = await recordScannedTokenSummary(entry2);

    expect(mergedSaved.scanCount).toBe(2);
    expect(mergedSaved.firstSeenAt).toBe("2026-11-15T10:00:00.000Z");
    expect(mergedSaved.firstPriceUsd).toBe(0.0001);
    expect(mergedSaved.firstMarketCapUsd).toBe(100_000);
    expect(mergedSaved.priceUsd).toBe(0.00025);
    expect(mergedSaved.marketCapUsd).toBe(250_000);
    expect(mergedSaved.buildCheckId).toBe("bc_second02");
    expect(mergedSaved.buildScore).toBe(81);
    expect(mergedSaved.scoreHistory).toHaveLength(2);
    expect(mergedSaved.scoreHistory?.[0].reportId).toBe("bc_second02");
    expect(mergedSaved.scoreHistory?.[1].reportId).toBe("bc_first01");

    // Subsequent lighter scan (`token-xray` without buildCheckId) should NOT erase latest BuildCheck permalink
    const xrayFollowUp = tokenReportToSummary(
      makeTokenReport({ riskScore: 10, classification: "SAFE" }),
      "token-xray",
      "2026-11-15T15:00:00.000Z",
      { priceUsd: 0.0003, marketCapUsd: 300_000 }
    );
    const mergedList = mergeScannedTokenLists([xrayFollowUp], [mergedSaved], 20);
    expect(mergedList[0].firstPriceUsd).toBe(0.0001);
    expect(mergedList[0].priceUsd).toBe(0.0003);
    expect(mergedList[0].buildCheckId).toBe("bc_second02");
    expect(mergedList[0].buildScore).toBe(81);
    expect(mergedList[0].scoreHistory).toHaveLength(3);
  });

  it("filters Verified Audit Ledger accurately and formats relative timestamps", () => {
    const safeItem = tokenReportToSummary(
      makeTokenReport({
        mintAddress: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Wrapped SOL",
        riskScore: 0,
        classification: "SAFE",
      }),
      "buildcheck",
      "2026-11-16T00:00:00.000Z",
      { buildScore: 86, buildVerdict: "VERIFIED_BUILD" }
    );
    const watchItem = tokenReportToSummary(
      makeTokenReport({
        mintAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        symbol: "JUP",
        name: "Jupiter",
        riskScore: 30,
        classification: "CAUTION",
      }),
      "buildcheck",
      "2026-11-15T22:00:00.000Z",
      { buildScore: 55, buildVerdict: "UNPROVEN_HYPE" }
    );
    const critItem = tokenReportToSummary(
      makeTokenReport({
        mintAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        symbol: "FAKE",
        name: "Fake Hype",
        riskScore: 78,
        classification: "CRITICAL",
      }),
      "buildcheck",
      "2026-11-15T18:00:00.000Z",
      { buildScore: 21, buildVerdict: "HIGH_FABRICATION_RISK" }
    );

    const all = [watchItem, critItem, safeItem];
    expect(classifyLedgerTier(safeItem)).toBe("verified");
    expect(classifyLedgerTier(watchItem)).toBe("watchlist");
    expect(classifyLedgerTier(critItem)).toBe("critical");

    expect(
      filterAndSortScannedTokens(all, { filter: "verified" }).map((i) => i.symbol)
    ).toEqual(["SOL"]);
    expect(
      filterAndSortScannedTokens(all, { filter: "watchlist" }).map((i) => i.symbol)
    ).toEqual(["JUP"]);
    expect(
      filterAndSortScannedTokens(all, { filter: "critical" }).map((i) => i.symbol)
    ).toEqual(["FAKE"]);
    expect(
      filterAndSortScannedTokens(all, { query: "jupyiwry" }).map((i) => i.symbol)
    ).toEqual(["JUP"]);

    const now = Date.parse("2026-11-16T00:10:00.000Z");
    expect(formatRelativeTime("2026-11-16T00:09:40.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-16T00:05:00.000Z", now)).toBe("5m ago");
    expect(formatRelativeTime("2026-11-15T21:10:00.000Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-11-13T00:10:00.000Z", now)).toBe("3d ago");

    const snap = extractMarketSnapshotFromReport(makeBuildCheckReport());
    expect(snap).toEqual({
      priceUsd: 0.00025,
      marketCapUsd: 250_000,
      liquidityUsd: 48_000,
    });
  });

  it("validates and merges enriched BuildCheck & market summaries on POST/GET /api/scanned-tokens", async () => {
    const firstSummary = tokenReportToSummary(
      makeTokenReport({ riskScore: 22, classification: "CAUTION" }),
      "buildcheck",
      "2026-11-16T00:01:00.000Z",
      {
        buildCheckId: "bc_sync01",
        buildScore: 60,
        buildVerdict: "UNPROVEN_HYPE",
        priceUsd: 0.0002,
        marketCapUsd: 200_000,
        liquidityUsd: 40_000,
      }
    );

    const post1 = await postScannedTokensHandler(
      new NextRequest("http://localhost:3000/api/scanned-tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-solshield-api-key": "test-api-secret-fase2",
        },
        body: JSON.stringify({ summary: firstSummary }),
      })
    );
    expect(post1.status).toBe(200);

    const secondSummary = tokenReportToSummary(
      makeTokenReport({ riskScore: 8, classification: "SAFE" }),
      "buildcheck",
      "2026-11-16T00:08:00.000Z",
      {
        buildCheckId: "bc_sync02",
        buildScore: 84,
        buildVerdict: "VERIFIED_BUILD",
        priceUsd: 0.0003,
        marketCapUsd: 300_000,
        liquidityUsd: 55_000,
      }
    );

    const post2 = await postScannedTokensHandler(
      new NextRequest("http://localhost:3000/api/scanned-tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-solshield-api-key": "test-api-secret-fase2",
        },
        body: JSON.stringify({ summary: secondSummary }),
      })
    );
    expect(post2.status).toBe(200);
    const post2Body = (await post2.json()) as {
      ok: boolean;
      token: ReturnType<typeof tokenReportToSummary>;
    };
    expect(post2Body.token.firstPriceUsd).toBe(0.0002);
    expect(post2Body.token.priceUsd).toBe(0.0003);
    expect(post2Body.token.buildCheckId).toBe("bc_sync02");
    expect(post2Body.token.scoreHistory).toHaveLength(2);

    const guardCookie = await signGuardToken(
      Math.floor(Date.now() / 1000),
      "VitestBrowser/1.0"
    );
    const getRes = await getScannedTokensHandler(
      new NextRequest("http://localhost:3000/api/scanned-tokens?limit=10", {
        headers: {
          origin: "http://localhost:3000",
          "user-agent": "VitestBrowser/1.0",
          cookie: `${GUARD_COOKIE_NAME}=${guardCookie}`,
          "x-forwarded-for": "203.0.113.55",
        },
      })
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      ok: boolean;
      tokens: Array<ReturnType<typeof tokenReportToSummary>>;
    };
    expect(getBody.ok).toBe(true);
    expect(getBody.tokens[0].firstMarketCapUsd).toBe(200_000);
    expect(getBody.tokens[0].marketCapUsd).toBe(300_000);
  });
});
