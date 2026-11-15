import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getReportHandler, POST as postReportHandler } from "../src/app/api/buildcheck/report/route";
import { resetApiGuardState } from "../src/lib/api-guard";
import {
  compactBuildCheckReportForPermalink,
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
});
