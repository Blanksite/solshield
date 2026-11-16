import { describe, expect, it } from "vitest";
import {
  buildProofDispatch,
  formatSolShieldDispatchText,
  formatSolShieldThreadReplies,
  formatTelegramProofDispatchHtml,
} from "../src/lib/buildcheck/proof-dispatch";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";
import {
  XApiError,
  formatBuildCheckStoryThread,
  formatBuildCheckStoryTweet,
  isXLengthRestrictionError,
} from "../worker/x-client";

function makeSampleTokenReport(): BuildCheckReport {
  return {
    id: "bc_story_01",
    createdAt: "2026-11-15T18:00:00.000Z",
    elapsedMs: 6200,
    target: {
      rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      kind: "token_ca",
      mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    },
    authenticityScore: 68,
    verdict: "VERIFIED_BUILD",
    headline: "Open source codebase verified while treasury vault stays devnet-scoped.",
    executiveSummary:
      "Public GitHub commits match web deployment, supply spread across 141 wallets, while mainnet policy vault awaits migration.",
    inferenceMode: "venice-live-api",
    modelsUsed: ["qwen3-vl-235b-a22b", "llama-3.3-70b"],
    visionSummary: "Interactive BuildCheck and Firewall pages verified in Chromium.",
    privacyAttestation: "Venice Zero-Retention",
    componentScores: {
      codeProof: 78,
      chainProof: 84,
      holdersProof: 72,
      domainProof: 76,
      claimAlignment: 62,
    },
    claimsVsProof: [
      {
        claim: "Public GitHub repository exists",
        status: "VERIFIED",
        evidence: "Commits match deployed bundle.",
      },
      {
        claim: "Vault live on Solana Mainnet",
        status: "MIXED",
        evidence: "Vault program active on devnet; mainnet slot pending.",
      },
      {
        claim: "AI firewall stops active drainers",
        status: "UNVERIFIED",
        evidence: "Requires live malicious tx sample outside static scope.",
      },
    ],
    verifiedSignals: [
      "Public GitHub codebase verified with active commits",
      "Mint & freeze authorities revoked on CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    ],
    keyRedFlags: [
      "Policy vault program presently confirmed on Devnet only",
    ],
    browser: {
      mode: "local-chromium",
      executableLabel: "Chromium",
      stops: [],
      discoveredGithubRepos: ["Blanksite/solshield"],
      discoveredXUrls: ["https://x.com/usesolshield"],
      discoveredSolanaAddresses: ["CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx"],
      discoveredWebsiteUrls: ["https://sol-shield.xyz"],
      totalXhrObserved: 6,
      notes: [],
    },
    github: {
      queried: true,
      exists: true,
      fullName: "Blanksite/solshield",
      url: "https://github.com/Blanksite/solshield",
      description: "Solana BuildCheck & Tx Firewall",
      stars: 24,
      forks: 3,
      openIssues: 0,
      isFork: false,
      forkParent: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-11-15T12:00:00.000Z",
      ageDays: 120,
      ownerAccountAgeDays: 400,
      recentCommitCount: 30,
      uniqueAuthorCount: 2,
      burstCommitRatio: 0.2,
      topLanguages: ["TypeScript"],
      topLevelFiles: ["package.json", "src"],
      hasTestsOrCi: true,
      hasPackageManifest: true,
      signals: [],
    },
    chain: {
      mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      tokenReport: {
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        tokenProgram: "SPL Token",
        programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        isToken2022: false,
        isPumpFunSuffix: false,
        verifiedAsset: null,
        name: "SolShield",
        symbol: "SHIELD",
        decimals: 6,
        rawSupply: "1000000000000000",
        supplyUi: 1_000_000_000,
        mintAuthority: null,
        freezeAuthority: null,
        extensions: [],
        transferFeeBps: null,
        permanentDelegate: null,
        transferHookProgramId: null,
        defaultAccountState: null,
        topHolders: [],
        top5Pct: 12.4,
        top10Pct: 19.8,
        riskScore: 18,
        classification: "SAFE",
        recommendedAction: "VERIFIED_SAFE",
        executiveSummary: "Authorities revoked; spread healthy.",
        flags: [],
        slot: 300_000_000,
        latencyMs: 320,
        inferenceMode: "venice-live-api",
        privacyAttestation: "Venice Zero-Retention",
      },
      dexPair: {
        dexId: "raydium",
        pairAddress: "Pair1111111111111111111111111111111111111111",
        pairUrl: "https://dexscreener.com/solana/test",
        liquidityUsd: 24500,
        fdv: 140000,
        volume24hUsd: 18000,
        pairCreatedAt: "2026-11-10T00:00:00.000Z",
        pairAgeHours: 120,
        websites: ["https://sol-shield.xyz"],
        socials: [],
      },
      accountRecentTxCount: 80,
      deep: {
        metadata: {
          name: "SolShield",
          symbol: "SHIELD",
          description: "Forensic firewall",
          imageUrl: null,
          websites: ["https://sol-shield.xyz"],
          twitterUrl: "https://x.com/usesolshield",
          telegramUrl: null,
          launchpad: "pump.fun",
          createdAt: "2026-11-10T00:00:00.000Z",
        },
        market: {
          poolAddress: null,
          dexId: "raydium",
          priceUsd: 0.00014,
          marketCapUsd: 140000,
          fdvUsd: 140000,
          liquidityUsd: 24500,
          volume24hUsd: 18000,
          priceChange5m: 0.4,
          priceChange1h: 2.5,
          priceChange6h: 4.1,
          priceChange24h: 12.2,
          buys1h: 12,
          sells1h: 8,
          buys24h: 120,
          sells24h: 95,
          lpLockedPct: 100,
          lpLockedUsd: 24500,
        },
        holders: {
          score: 72,
          verdict: "OK",
          totalHolders: 141,
          distribution: {
            insidersPct: 2.0,
            snipersPct: 1.5,
            burnedOrLockedPct: 12.0,
            devPct: 0.2,
            retailPct: 84.3,
          },
          nodes: [],
          clusters: [
            {
              clusterId: "c1",
              kind: "co_funded",
              label: "Cluster A",
              funder: "FunderA1111111111111111111111111111111111111",
              slot: 300_000_001,
              combinedPct: 4.5,
              wallets: [],
            },
            {
              clusterId: "c2",
              kind: "same_slot",
              label: "Cluster B",
              funder: null,
              slot: 300_000_002,
              combinedPct: 2.5,
              wallets: [],
            },
          ],
          checks: [],
          flagsCount: 0,
          watchCount: 1,
          clearCount: 3,
          notes: [],
        },
        devHistory: {
          devAddress: "Dev1111111111111111111111111111111111111111",
          solBalance: 2.4,
          tokenHoldingPct: 0.2,
          coinsLaunchedCount: 1,
          flaggedCoinsCount: 0,
          launchedTokens: [],
          recentTxs: [],
        },
      },
    },
    domain: null,
    xPost: null,
  };
}

describe("SolShield Proof Dispatch Story Formatter & X Thread Fallback", () => {
  it("builds original SolShield Proof Dispatch sections without copied competitor branding", () => {
    const report = makeSampleTokenReport();
    const dispatch = buildProofDispatch(report, {
      appPublicUrl: "https://sol-shield.xyz",
      maskAddresses: true,
    });

    expect(dispatch.subjectLabel).toBe("$SHIELD");
    expect(dispatch.indexScore).toBe(68);
    expect(dispatch.confirmedPoints.length).toBeGreaterThanOrEqual(2);
    expect(dispatch.openGaps.length).toBeGreaterThanOrEqual(2);
    expect(dispatch.chainTraceLine).toContain("2 co-funded clusters (7.0%)");
    expect(dispatch.chainTraceLine).toContain("141 holders");
    expect(dispatch.chainTraceLine).toContain("Dev 0.2%");
    expect(dispatch.chainTraceLine).toContain("Liq $24.50K");

    const text = formatSolShieldDispatchText(report, {
      appPublicUrl: "https://sol-shield.xyz",
      maskAddresses: true,
      includeUrl: true,
    });

    expect(text).toContain("CONFIRMED EVIDENCE:");
    expect(text).toContain("OPEN GAPS & CAVEATS:");
    expect(text).toContain("ANALYST SYNTHESIS:");
    expect(text).toContain("CHAIN TRACE:");
    expect(text).toContain("https://sol-shield.xyz/buildcheck?report=bc_story_01");
    // Masks full raw Solana mint address in social mode
    expect(text).not.toContain("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");
    expect(text).toContain("CMYb1B...2Sqx");

    // Ensures zero copied terminology
    expect(text).not.toMatch(/\blarp(?:check)?\b/i);
    expect(text).not.toMatch(/\bdyor\b/i);
    expect(text).toContain("Read the receipts before you sign.");
    expect(text).not.toContain("What checks out");
    expect(text).not.toContain("Couldn't confirm yet");
    expect(text).not.toContain("PARTLY REAL");
    expect(text).not.toContain("SKETCHY");
    expect(text).not.toContain("RIGGED");
  });

  it("produces 2-tweet X thread chunks strictly within 280 chars and HTML Telegram dispatch", () => {
    const report = makeSampleTokenReport();
    const thread = formatBuildCheckStoryThread(report, "https://sol-shield.xyz", {
      includeUrl: true,
    });

    expect(thread.primary.length).toBeLessThanOrEqual(280);
    expect(thread.followup.length).toBeLessThanOrEqual(280);
    expect(thread.followup).toContain("PROOF DISPATCH");
    expect(thread.followup).not.toContain("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");

    const directThread = formatSolShieldThreadReplies(report, "https://sol-shield.xyz");
    expect(directThread.primary).toBe(thread.primary);

    const longStory = formatBuildCheckStoryTweet(report, "https://sol-shield.xyz", {
      includeUrl: true,
    });
    expect(longStory.length).toBeGreaterThan(280);
    expect(longStory).toContain("OPEN GAPS & CAVEATS:");

    const tgHtml = formatTelegramProofDispatchHtml(
      {
        ...report,
        executiveSummary: "Safe synthesis <script>alert(1)</script>",
      },
      "https://sol-shield.xyz"
    );
    expect(tgHtml.length).toBeLessThanOrEqual(3800);
    expect(tgHtml).toContain("<b>SOLSHIELD PROOF DISPATCH");
    expect(tgHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(tgHtml).not.toContain("<script>");
  });

  it("accurately classifies X length restriction errors without confusing crypto-address errors", () => {
    expect(
      isXLengthRestrictionError(
        new XApiError("You are not permitted to post more than 280 characters.", 403)
      )
    ).toBe(true);
    expect(
      isXLengthRestrictionError(
        new XApiError("Crypto addresses are prohibited for the first 7 days after authentication.", 403)
      )
    ).toBe(false);
    expect(isXLengthRestrictionError(new XApiError("Credits exhausted", 402))).toBe(false);
  });

  it("propagates masked Claim vs Proof Call-Out across dispatch, X thread, and Telegram HTML", () => {
    const report: BuildCheckReport = {
      ...makeSampleTokenReport(),
      verdict: "HIGH_FABRICATION_RISK",
      authenticityScore: 28,
      contradictionCallout:
        "Claims 100% open-source build, yet Mint CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx has no GitHub repo & active Mint authority.",
    };

    const dispatch = buildProofDispatch(report, {
      appPublicUrl: "https://sol-shield.xyz",
      maskAddresses: true,
    });
    expect(dispatch.contradictionCallout).toContain("CMYb1B...2Sqx");
    expect(dispatch.contradictionCallout).not.toContain(
      "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx"
    );

    const story = formatSolShieldDispatchText(report, {
      appPublicUrl: "https://sol-shield.xyz",
      maskAddresses: true,
    });
    expect(story).toContain("CLAIM VS PROOF CALL-OUT:");
    expect(story).not.toMatch(/\blarp(?:check)?\b/i);

    const thread = formatSolShieldThreadReplies(report, "https://sol-shield.xyz");
    expect(thread.primary.length).toBeLessThanOrEqual(280);
    expect(thread.followup.length).toBeLessThanOrEqual(280);
    expect(thread.primary).toContain("100% open-source");

    const tg = formatTelegramProofDispatchHtml(report, "https://sol-shield.xyz");
    expect(tg).toContain("Claim vs Proof Call-Out:");
  });
});
