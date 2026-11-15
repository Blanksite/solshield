import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProofDispatch, formatSolShieldDispatchText } from "../src/lib/buildcheck/proof-dispatch";
import {
  MAX_REDIS_REPORT_BYTES,
  compactBuildCheckReportWithinBudget,
} from "../src/lib/buildcheck/report-store";
import type { BuildCheckReport, XMindsharePost } from "../src/lib/buildcheck/types";
import {
  buildXMindshareQueries,
  classifyKolTier,
  collectSocialMindshare,
  computeMindshareBuildAlignment,
  detectShillSignals,
  extractProjectSocialAnchors,
} from "../src/lib/buildcheck/x-mindshare";

const SAMPLE_CHAIN: BuildCheckReport["chain"] = {
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
    top5Pct: 12,
    top10Pct: 18,
    riskScore: 18,
    classification: "SAFE",
    recommendedAction: "VERIFIED_SAFE",
    executiveSummary: "Authorities revoked; spread healthy.",
    flags: [],
    slot: 300_000_000,
    latencyMs: 250,
    inferenceMode: "venice-live-api",
    privacyAttestation: "Venice Zero-Retention",
  },
  dexPair: {
    dexId: "pump",
    pairAddress: "pair1",
    pairUrl: "https://dexscreener.com/solana/pair1",
    liquidityUsd: 40_000,
    fdv: 200_000,
    volume24hUsd: 80_000,
    pairCreatedAt: null,
    pairAgeHours: 12,
    websites: ["https://sol-shield.xyz"],
    socials: [
      { type: "twitter", url: "https://x.com/pumpdotfun" },
      { type: "twitter", url: "https://x.com/usesolshield" },
    ],
  },
  accountRecentTxCount: 20,
};

function makeBaseReport(social: BuildCheckReport["social"] = null): BuildCheckReport {
  return {
    id: "bc_mind_01",
    createdAt: "2026-11-16T00:00:00.000Z",
    elapsedMs: 4100,
    target: {
      rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      kind: "token_ca",
      mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    },
    authenticityScore: 78,
    verdict: "VERIFIED_BUILD",
    headline: "Open-source build verified with revoked authorities.",
    executiveSummary: "Public repo and live XHR verified alongside clean supply distribution.",
    inferenceMode: "venice-live-api",
    modelsUsed: ["llama-3.3-70b"],
    visionSummary: null,
    privacyAttestation: "Venice Zero-Retention",
    componentScores: {
      codeProof: 82,
      chainProof: 84,
      holdersProof: 76,
      domainProof: 75,
      claimAlignment: 74,
    },
    claimsVsProof: [],
    verifiedSignals: ["Public codebase active"],
    keyRedFlags: [],
    browser: {
      mode: "local-chromium",
      executableLabel: "Chromium",
      stops: [],
      discoveredGithubRepos: ["Blanksite/solshield"],
      discoveredXUrls: ["https://x.com/usesolshield"],
      discoveredSolanaAddresses: [],
      discoveredWebsiteUrls: ["https://sol-shield.xyz"],
      totalXhrObserved: 4,
      notes: [],
    },
    github: null,
    chain: null,
    domain: null,
    xPost: null,
    social,
  };
}

describe("X Mindshare & KOL Discourse Pulse", () => {
  const originalXBearer = process.env.X_BEARER_TOKEN;
  const originalVeniceKey = process.env.VENICE_API_KEY;

  beforeEach(() => {
    delete process.env.X_BEARER_TOKEN;
    delete process.env.VENICE_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalXBearer === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = originalXBearer;
    if (originalVeniceKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalVeniceKey;
  });

  it("classifies KOL tiers accurately by follower thresholds", () => {
    expect(classifyKolTier(120_000)).toBe("MEGA");
    expect(classifyKolTier(50_000)).toBe("MEGA");
    expect(classifyKolTier(24_500)).toBe("ALPHA");
    expect(classifyKolTier(2_500)).toBe("MID");
    expect(classifyKolTier(1_999)).toBe("MICRO");
    expect(classifyKolTier(0)).toBe("MICRO");
  });

  it("flags promo farms, cashtag spam, and duplicates while leaving clean commentary unflagged", () => {
    expect(
      detectShillSignals("Claim your free airdrop now! $AAA $BBB $CCC $DDD next 100x gem")
    ).toEqual(
      expect.arrayContaining(["MULTI_CASHTAG_SPAM", "AIRDROP_BAIT", "SHILL_CLICHE"])
    );

    expect(detectShillSignals("DM for promo / listing", 3)).toEqual(
      expect.arrayContaining(["PROMO_SOLICITATION", "COORDINATED_DUPLICATE"])
    );

    expect(
      detectShillSignals(
        "Tested SolShield on CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx — GitHub commits and Chromium XHR actually work."
      )
    ).toEqual([]);
  });

  it("builds unambiguous and cashtag-scoped X queries without generic platform handles", () => {
    const anchors = extractProjectSocialAnchors({
      target: {
        rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        kind: "token_ca",
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      },
      chain: SAMPLE_CHAIN,
      github: {
        queried: true,
        exists: true,
        fullName: "Blanksite/solshield",
        url: "https://github.com/Blanksite/solshield",
        description: null,
        stars: 12,
        forks: 2,
        openIssues: 0,
        isFork: false,
        forkParent: null,
        createdAt: null,
        updatedAt: null,
        ageDays: 40,
        ownerAccountAgeDays: 400,
        recentCommitCount: 20,
        uniqueAuthorCount: 2,
        burstCommitRatio: 0.2,
        topLanguages: ["TypeScript"],
        topLevelFiles: ["package.json"],
        hasTestsOrCi: true,
        hasPackageManifest: true,
        signals: [],
      },
      domain: {
        hostname: "sol-shield.xyz",
        registrableDomain: "sol-shield.xyz",
        rdapCreatedAt: null,
        domainAgeDays: 30,
        pageTitle: "SolShield",
        generatorHints: [],
        domainEval: {
          hostname: "sol-shield.xyz",
          status: "VERIFIED",
          riskScore: 0,
          riskLevel: "LOW",
          isAllowlisted: true,
          isPunycode: false,
          closestVerifiedBrand: null,
          matchedVerifiedDomain: "sol-shield.xyz",
          reasons: [],
        },
      },
    });

    expect(anchors.officialHandle).toBe("usesolshield");

    const queries = buildXMindshareQueries(anchors);
    expect(queries.length).toBe(2);
    expect(queries[0]).toContain("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");
    expect(queries[0]).toContain("@usesolshield");
    expect(queries[0]).toContain('"Blanksite/solshield"');
    expect(queries[0]).toContain("-is:retweet");
    // Ambiguous $SHIELD ticker must be scoped with crypto/Solana context
    expect(queries[1]).toContain("$SHIELD (");
    expect(queries[1]).toContain("solana");
  });

  it("classifies all Hype-vs-Build divergence quadrants deterministically", () => {
    expect(
      computeMindshareBuildAlignment({
        mindshareScore: 72,
        organicSignalPct: 85,
        skepticalPct: 10,
        shillNoisePct: 5,
        totalPostsSampled: 14,
        buildIntegrityScore: 80,
      }).quadrant
    ).toBe("CONVICTION_RUNNER");

    expect(
      computeMindshareBuildAlignment({
        mindshareScore: 34,
        organicSignalPct: 90,
        skepticalPct: 0,
        shillNoisePct: 0,
        totalPostsSampled: 4,
        buildIntegrityScore: 76,
      }).quadrant
    ).toBe("UNDERVALUED_BUILDER");

    expect(
      computeMindshareBuildAlignment({
        mindshareScore: 75,
        organicSignalPct: 60,
        skepticalPct: 10,
        shillNoisePct: 30,
        totalPostsSampled: 18,
        buildIntegrityScore: 30,
      }).quadrant
    ).toBe("NARRATIVE_OVERHEAT");

    expect(
      computeMindshareBuildAlignment({
        mindshareScore: 55,
        organicSignalPct: 80,
        skepticalPct: 48,
        shillNoisePct: 10,
        totalPostsSampled: 10,
        buildIntegrityScore: 70,
      }).quadrant
    ).toBe("CONTESTED_DISCOURSE");

    expect(
      computeMindshareBuildAlignment({
        mindshareScore: 8,
        organicSignalPct: 0,
        skepticalPct: 0,
        shillNoisePct: 0,
        totalPostsSampled: 0,
        buildIntegrityScore: 82,
      }).quadrant
    ).toBe("PRE_DISCOVERY");
  });

  it("collects real X API v2 + Venice AI synthesis while rejecting unrelated EVM noise", async () => {
    process.env.X_BEARER_TOKEN = "test-x-bearer";
    process.env.VENICE_API_KEY = "test-venice-key";

    const nowIso = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/2/users/by/username/")) {
        return new Response(
          JSON.stringify({
            data: {
              id: "u_off",
              username: "usesolshield",
              name: "SolShield",
              verified: true,
              verified_type: "blue",
              created_at: "2025-01-01T00:00:00.000Z",
              description: "Solana firewall & BuildCheck",
              public_metrics: {
                followers_count: 4200,
                following_count: 110,
                tweet_count: 340,
                listed_count: 18,
              },
            },
          }),
          { status: 200 }
        );
      }

      if (url.includes("/2/tweets/search/recent")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "1001",
                author_id: "u_kol1",
                created_at: nowIso,
                text: "$SHIELD @usesolshield actually executes live headless Chromium checks against GitHub code. Clean solana tooling.",
                public_metrics: {
                  like_count: 85,
                  retweet_count: 22,
                  reply_count: 14,
                  quote_count: 6,
                  bookmark_count: 31,
                  impression_count: 9500,
                },
              },
              {
                id: "1002",
                author_id: "u_skep",
                created_at: nowIso,
                text: "$SHIELD solana vault is devnet-only so far, waiting to see mainnet verification before sizing.",
                public_metrics: {
                  like_count: 19,
                  retweet_count: 2,
                  reply_count: 5,
                  quote_count: 1,
                  bookmark_count: 4,
                  impression_count: 1400,
                },
              },
              {
                id: "1003",
                author_id: "u_spam",
                created_at: nowIso,
                text: "$SHIELD $PEPE $BONK $WIF Claim your free airdrop now! Next 100x gem DM for promo",
                public_metrics: {
                  like_count: 1,
                  retweet_count: 0,
                  reply_count: 0,
                  quote_count: 0,
                  bookmark_count: 0,
                  impression_count: 50,
                },
              },
              {
                // EVM-only unrelated token sharing $SHIELD cashtag must be discarded
                id: "1004",
                author_id: "u_evm",
                created_at: nowIso,
                text: "$SHIELD on Ethereum Base CA 0x1234567890abcdef1234567890abcdef12345678 pumping!",
                public_metrics: {
                  like_count: 40,
                  retweet_count: 10,
                  reply_count: 2,
                  quote_count: 0,
                  bookmark_count: 0,
                  impression_count: 2000,
                },
              },
            ],
            includes: {
              users: [
                {
                  id: "u_kol1",
                  username: "sol_researcher",
                  name: "Sol Researcher",
                  verified: true,
                  public_metrics: { followers_count: 28_400 },
                },
                {
                  id: "u_skep",
                  username: "chain_skeptic",
                  name: "Chain Skeptic",
                  verified: false,
                  public_metrics: { followers_count: 3_100 },
                },
                {
                  id: "u_spam",
                  username: "promo_bot_99",
                  name: "Gem Caller",
                  verified: false,
                  public_metrics: { followers_count: 210 },
                },
                {
                  id: "u_evm",
                  username: "eth_alpha",
                  name: "ETH Alpha",
                  verified: false,
                  public_metrics: { followers_count: 5_000 },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }

      if (url.includes("api.venice.ai")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    consensusSummary:
                      "KOLs praise SolShield's live browser XHR + GitHub auditing, while cautious traders note the policy vault remains devnet-scoped.",
                    bullThemes: ["Live Chromium XHR + GitHub commit verification works end-to-end"],
                    skepticQuestions: ["Policy vault still pending Solana Mainnet migration"],
                    postStances: [
                      { id: "1001", stance: "BULLISH", reason: "Validates live Chromium XHR architecture" },
                      { id: "1002", stance: "SKEPTICAL", reason: "Questions devnet-only vault scope" },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const social = await collectSocialMindshare({
      target: {
        rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        kind: "token_ca",
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      },
      chain: SAMPLE_CHAIN,
      xPost: {
        url: "https://x.com/usesolshield/status/999",
        handle: "usesolshield",
        tweetId: "999",
        authorName: "SolShield",
        textContent: "SolShield live",
        extractedUrls: [],
        extractedSolanaAddresses: [],
        extractedGithubRepos: [],
        methodUsed: "oembed",
      },
      buildIntegrityScore: 78,
    });

    expect(social.source).toBe("hybrid");
    expect(social.officialProfile?.username).toBe("usesolshield");
    expect(social.officialProfile?.followersCount).toBe(4200);
    // EVM tweet 1004 should be filtered out -> 3 relevant posts remain
    expect(social.totalPostsSampled).toBe(3);
    expect(social.kolCount).toBe(2); // sol_researcher (ALPHA) + chain_skeptic (MID)
    expect(social.bullThemes[0]).toContain("Chromium XHR");
    expect(social.skepticQuestions[0]).toContain("Mainnet migration");
    expect(social.posts.find((p) => p.id === "1003")?.stance).toBe("SHILL_NOISE");
    expect(
      social.sentimentBreakdown.bullishPct +
        social.sentimentBreakdown.neutralPct +
        social.sentimentBreakdown.skepticalPct +
        social.sentimentBreakdown.shillNoisePct
    ).toBe(100);
    expect(social.mindshareScore).toBeGreaterThan(20);
  });

  it("prevents brand self-tweets from spoofing community mindshare", async () => {
    process.env.X_BEARER_TOKEN = "test-x-bearer";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/2/users/by/username/")) {
        return new Response(
          JSON.stringify({
            data: {
              id: "u_self",
              username: "myproject",
              name: "MyProject",
              verified: true,
              public_metrics: { followers_count: 15_000, tweet_count: 50 },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/2/tweets/search/recent")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "2001",
                author_id: "u_self",
                created_at: new Date().toISOString(),
                text: "@myproject shipping huge bullish based updates daily!",
                public_metrics: {
                  like_count: 900,
                  retweet_count: 300,
                  reply_count: 50,
                  quote_count: 20,
                  bookmark_count: 100,
                  impression_count: 80_000,
                },
              },
            ],
            includes: {
              users: [
                {
                  id: "u_self",
                  username: "myproject",
                  name: "MyProject",
                  verified: true,
                  public_metrics: { followers_count: 15_000 },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const social = await collectSocialMindshare({
      target: {
        rawInput: "https://x.com/myproject",
        kind: "x_profile",
        normalizedUrl: "https://x.com/myproject",
      },
      buildIntegrityScore: 80,
    });

    expect(social.totalPostsSampled).toBe(1);
    expect(social.mindshareScore).toBeLessThanOrEqual(16);
    expect(social.quadrant).toBe("PRE_DISCOVERY");
    expect(social.consensusSummary).toContain("awaiting independent trader & KOL");
  });

  it("trims oversized social arrays safely within Redis budget and wires Proof Dispatch", () => {
    const bigPosts: XMindsharePost[] = Array.from({ length: 25 }, (_, i) => ({
      id: `p_${i}`,
      url: `https://x.com/user_${i}/status/${i}`,
      text: "x".repeat(550),
      createdAt: "2026-11-15T12:00:00.000Z",
      authorUsername: `user_${i}`,
      authorName: `User ${i}`,
      authorVerified: i < 5,
      authorVerifiedType: null,
      authorFollowers: 3000 + i * 100,
      authorTier: "MID",
      likeCount: 10,
      retweetCount: 2,
      replyCount: 1,
      quoteCount: 0,
      bookmarkCount: 1,
      impressionCount: 500,
      engagementScore: 50 - i,
      stance: "BULLISH",
      stanceReason: "Positive review",
      shillFlags: [],
      isKol: true,
    }));

    const hugeReport = makeBaseReport({
      source: "hybrid",
      fetchedAt: "2026-11-16T00:00:00.000Z",
      queriesUsed: ["@usesolshield -is:retweet"],
      officialProfile: null,
      mindshareScore: 68,
      momentum: "ACTIVE",
      quadrant: "CONVICTION_RUNNER",
      quadrantLabel: "CONVICTION ALIGNMENT",
      quadrantSummary: "High organic chatter aligned with code proof.",
      totalPostsSampled: 25,
      uniqueAuthors: 25,
      kolCount: 25,
      totalImpressions: 12500,
      totalEngagement: 350,
      organicSignalPct: 100,
      sentimentBreakdown: {
        bullishPct: 80,
        neutralPct: 15,
        skepticalPct: 5,
        shillNoisePct: 0,
      },
      consensusSummary: "Strong builder alignment.",
      bullThemes: ["Real Chromium execution"],
      skepticQuestions: [],
      topVoices: bigPosts.slice(0, 8),
      posts: bigPosts,
      dailyBuckets: [{ date: "2026-11-15", postCount: 25, uniqueAuthors: 25, kolCount: 25, engagementTotal: 350 }],
      errorNote: null,
    });

    // Force Pass 3 + Pass 4 budget cascade (claims survive Pass 2; massive xPost pushes Pass 3 over 450KB into Pass 4)
    hugeReport.executiveSummary = "E".repeat(200_000);
    hugeReport.claimsVsProof = Array.from({ length: 8 }, (_, idx) => ({
      claim: `Claim ${idx}`,
      status: "VERIFIED" as const,
      evidence: "V".repeat(48_000),
    }));
    hugeReport.xPost = {
      url: "https://x.com/usesolshield/status/999",
      handle: "usesolshield",
      tweetId: "999",
      authorName: "SolShield",
      textContent: "X".repeat(150_000),
      extractedUrls: [],
      extractedSolanaAddresses: [],
      extractedGithubRepos: [],
      methodUsed: "oembed",
    };

    const compacted = compactBuildCheckReportWithinBudget(hugeReport);
    expect(
      Buffer.byteLength(JSON.stringify(compacted), "utf8")
    ).toBeLessThanOrEqual(MAX_REDIS_REPORT_BYTES);
    expect(compacted.social?.mindshareScore).toBe(68);
    expect(compacted.social?.posts.length).toBeLessThanOrEqual(5);
    expect(compacted.social?.topVoices.length).toBeLessThanOrEqual(4);

    const dispatch = buildProofDispatch(hugeReport);
    expect(dispatch.mindshareLine).toContain("Mindshare 68/100");
    expect(dispatch.mindshareLine).toContain("25 KOLs");
    expect(formatSolShieldDispatchText(hugeReport)).toContain("X MINDSHARE: Mindshare 68/100");
  });
});
