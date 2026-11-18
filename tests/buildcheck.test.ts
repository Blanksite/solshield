import dns from "node:dns/promises";
import { describe, it, expect, vi } from "vitest";
import {
  assertSafePublicHttpUrl,
  isBlockedHostname,
  isPrivateOrReservedIp,
} from "../src/lib/buildcheck/url-safety";
import {
  extractBareWebDomainsFromText,
  extractEntitiesFromText,
  extractNpmPackagesFromText,
  parseBuildCheckInput,
  parseGitHubOwnerRepo,
  parseXUrl,
} from "../src/lib/buildcheck/input-parser";
import {
  extractHtmlStopSignals,
  runHttpFallbackObservation,
} from "../src/lib/buildcheck/browser-agent";
import {
  collectChainTokenIntel,
  collectGitHubForensics,
  collectXPostIntel,
  discoverGithubRepoFromNpmPackages,
} from "../src/lib/buildcheck/collectors";
import {
  buildDeterministicBuildCheck,
  synthesizeWithVeniceBuildCheck,
} from "../src/lib/buildcheck/venice-buildcheck";
import { classifyDevTx } from "../src/lib/buildcheck/token-forensics";

describe("BuildCheck URL & SSRF Safety Guards", () => {
  it("detects private, loopback, metadata, CGNAT, and mapped IPv6 addresses", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.4.12")).toBe(true);
    expect(isPrivateOrReservedIp("172.31.255.254")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.5")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("100.64.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);

    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("172.32.0.1")).toBe(false);
  });

  it("blocks internal hostnames and reserved suffixes", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("redis.internal")).toBe(true);
    expect(isBlockedHostname("printer.local")).toBe(true);
    expect(isBlockedHostname("192.168.0.10")).toBe(true);

    expect(isBlockedHostname("sol-shield.xyz")).toBe(false);
    expect(isBlockedHostname("github.com")).toBe(false);
  });

  it("rejects non-HTTP protocols, localhost, RFC1918, and cloud metadata SSRF targets", async () => {
    const blockedUrls = [
      "file:///etc/passwd",
      "ftp://example.com/resource",
      "http://127.0.0.1:3000/api/audit",
      "http://localhost:3000",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/secret",
      "http://192.168.1.1/",
      "https://metadata.google.internal/computeMetadata/v1/",
    ];

    for (const url of blockedUrls) {
      await expect(assertSafePublicHttpUrl(url)).rejects.toThrow();
    }
  });
});

describe("BuildCheck Universal Input & Entity Parsing", () => {
  it("classifies Solana CA, X post, X profile, GitHub repo, and bare website", () => {
    const token = parseBuildCheckInput("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(token.kind).toBe("token_ca");
    expect(token.mintAddress).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    const xPost = parseBuildCheckInput("https://x.com/solshield_sec/status/1899123456789012345?s=20");
    expect(xPost.kind).toBe("x_post");
    expect(xPost.xHandle).toBe("solshield_sec");
    expect(xPost.xTweetId).toBe("1899123456789012345");
    expect(xPost.normalizedUrl).toBe("https://x.com/solshield_sec/status/1899123456789012345");

    const xWebPost = parseBuildCheckInput("https://twitter.com/i/web/status/1899123456789012345");
    expect(xWebPost.kind).toBe("x_post");
    expect(xWebPost.xTweetId).toBe("1899123456789012345");

    const xProfile = parseBuildCheckInput("https://x.com/solshield_sec");
    expect(xProfile.kind).toBe("x_profile");
    expect(xProfile.xHandle).toBe("solshield_sec");

    const gh = parseBuildCheckInput("https://github.com/Blanksite/solshield.git");
    expect(gh.kind).toBe("github_repo");
    expect(gh.githubOwnerRepo).toBe("Blanksite/solshield");
    expect(gh.normalizedUrl).toBe("https://github.com/Blanksite/solshield");

    const site = parseBuildCheckInput("sol-shield.xyz");
    expect(site.kind).toBe("website");
    expect(site.hostname).toBe("sol-shield.xyz");
    expect(site.normalizedUrl).toMatch(/^https:\/\/sol-shield\.xyz/);
  });

  it("ignores reserved GitHub paths and invalid targets", () => {
    expect(parseGitHubOwnerRepo("https://github.com/explore")).toBeNull();
    expect(parseGitHubOwnerRepo("https://github.com/marketplace/actions")).toBeNull();
    expect(parseGitHubOwnerRepo("https://github.com/security/advanced-security")).toBeNull();
    expect(parseGitHubOwnerRepo("https://github.com/features/copilot")).toBeNull();
    expect(parseXUrl("https://sol-shield.xyz/buildcheck")).toBeNull();
    expect(() => parseBuildCheckInput("   ")).toThrow();
    expect(() => parseBuildCheckInput("notadomain")).toThrow();
  });

  it("extracts GitHub repos, X links, public websites, and Solana mints from page copy", () => {
    const sampleText = `
      Check out our launch! Repo: https://github.com/Blanksite/solshield
      App live at https://sol-shield.xyz and shortlink https://t.co/abc123
      Follow https://x.com/solshield_sec/status/1899123456789012345
      CA: DPt4y8w4Z6w6iJ8v5fP7qR3uM2xK9nL4bV1cW8eHpump
    `;
    const extracted = extractEntitiesFromText(sampleText);
    expect(extracted.githubRepos).toContain("Blanksite/solshield");
    expect(extracted.xUrls).toContain("https://x.com/solshield_sec/status/1899123456789012345");
    expect(extracted.websiteUrls).toContain("https://sol-shield.xyz");
    expect(extracted.websiteUrls.some((u) => u.includes("t.co"))).toBe(false);
    expect(extracted.solanaAddresses).toContain("DPt4y8w4Z6w6iJ8v5fP7qR3uM2xK9nL4bV1cW8eHpump");
  });
});

describe("BuildCheck Deterministic Scoring Engine", () => {
  it("awards VERIFIED_BUILD when mature code, revoked SPL token, and verified domain align", () => {
    const result = buildDeterministicBuildCheck({
      id: "bc_verified_1",
      createdAt: new Date().toISOString(),
      elapsedMs: 4200,
      target: {
        rawInput: "https://github.com/Blanksite/solshield",
        kind: "github_repo",
        githubOwnerRepo: "Blanksite/solshield",
        normalizedUrl: "https://github.com/Blanksite/solshield",
        hostname: "github.com",
      },
      browser: {
        mode: "local-chromium",
        executableLabel: "Chromium",
        stops: [
          {
            url: "https://sol-shield.xyz",
            title: "SolShield",
            stepLabel: "Live Site",
            screenshotBase64: "",
            textExcerpt: "SolShield Transaction Firewall & Vault",
            outboundGithub: ["Blanksite/solshield"],
            outboundX: [],
            outboundSolanaAddresses: [],
            networkHosts: ["sol-shield.xyz"],
            xhrCount: 4,
            loadTimeMs: 420,
            hasPlaceholderCopy: false,
          },
        ],
        discoveredGithubRepos: ["Blanksite/solshield"],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: ["https://sol-shield.xyz"],
        totalXhrObserved: 4,
        notes: [],
      },
      github: {
        queried: true,
        exists: true,
        fullName: "Blanksite/solshield",
        url: "https://github.com/Blanksite/solshield",
        description: "Solana Security Firewall",
        stars: 95,
        forks: 12,
        openIssues: 2,
        isFork: false,
        forkParent: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: new Date().toISOString(),
        ageDays: 140,
        ownerAccountAgeDays: 400,
        recentCommitCount: 30,
        uniqueAuthorCount: 3,
        burstCommitRatio: 0.2,
        topLanguages: ["TypeScript", "Rust"],
        topLevelFiles: ["package.json", "Anchor.toml", "src", "tests"],
        hasTestsOrCi: true,
        hasPackageManifest: true,
        signals: [{ code: "MATURE_REPO", severity: "INFO", message: "Repository active >140 days with tests." }],
      },
      chain: {
        mintAddress: "DPt4y8w4Z6w6iJ8v5fP7qR3uM2xK9nL4bV1cW8eHpump",
        tokenReport: {
          mintAddress: "DPt4y8w4Z6w6iJ8v5fP7qR3uM2xK9nL4bV1cW8eHpump",
          tokenProgram: "SPL Token",
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          isToken2022: false,
          isPumpFunSuffix: true,
          name: "SolShield",
          symbol: "SHIELD",
          decimals: 6,
          rawSupply: "1000000000000000",
          supplyUi: 1000000000,
          mintAuthority: null,
          freezeAuthority: null,
          extensions: [],
          transferFeeBps: null,
          permanentDelegate: null,
          transferHookProgramId: null,
          defaultAccountState: null,
          topHolders: [],
          top5Pct: 14.2,
          top10Pct: 21.5,
          riskScore: 8,
          classification: "SAFE",
          recommendedAction: "VERIFIED_SAFE",
          executiveSummary: "Revoked mint & freeze authorities.",
          flags: [],
          slot: 300000000,
          latencyMs: 120,
          inferenceMode: "deterministic-fallback",
          privacyAttestation: "Zero retention",
        },
        dexPair: {
          dexId: "raydium",
          pairAddress: "Pair11111111111111111111111111111111111111",
          pairUrl: "https://dexscreener.com/solana/pair",
          liquidityUsd: 85000,
          fdv: 420000,
          volume24hUsd: 55000,
          pairCreatedAt: "2026-03-01T00:00:00.000Z",
          pairAgeHours: 1200,
          websites: ["https://sol-shield.xyz"],
          socials: [],
        },
        accountRecentTxCount: 20,
      },
      domain: {
        hostname: "sol-shield.xyz",
        domainEval: {
          hostname: "sol-shield.xyz",
          status: "VERIFIED",
          riskScore: 0,
          riskLevel: "LOW",
          isAllowlisted: true,
          isPunycode: false,
          closestVerifiedBrand: "SolShield",
          matchedVerifiedDomain: "sol-shield.xyz",
          reasons: [],
        },
        rdapCreatedAt: "2026-02-01T00:00:00.000Z",
        domainAgeDays: 160,
        registrableDomain: "sol-shield.xyz",
        pageTitle: "SolShield",
        generatorHints: ["Next.js"],
      },
      xPost: null,
    });

    expect(result.verdict).toBe("VERIFIED_BUILD");
    expect(result.authenticityScore).toBeGreaterThanOrEqual(80);
    expect(result.componentScores.codeProof).toBeGreaterThanOrEqual(80);
    expect(result.componentScores.chainProof).toBeGreaterThanOrEqual(85);
    expect(result.componentScores.domainProof).toBeGreaterThanOrEqual(90);
    expect(result.keyRedFlags.length).toBe(0);
  });

  it("flags HIGH_FABRICATION_RISK on single-burst fork repo, active mint authority, and placeholder fresh domain", () => {
    const result = buildDeterministicBuildCheck({
      id: "bc_larp_1",
      createdAt: new Date().toISOString(),
      elapsedMs: 3900,
      target: {
        rawInput: "https://fake-ai-protocol.xyz",
        kind: "website",
        normalizedUrl: "https://fake-ai-protocol.xyz",
        hostname: "fake-ai-protocol.xyz",
      },
      browser: {
        mode: "local-chromium",
        executableLabel: "Chromium",
        stops: [
          {
            url: "https://fake-ai-protocol.xyz",
            title: "Coming Soon",
            stepLabel: "Live Site",
            screenshotBase64: "",
            textExcerpt: "Lorem ipsum AI super protocol coming soon",
            outboundGithub: ["anon/forked-stub"],
            outboundX: [],
            outboundSolanaAddresses: ["11111111111111111111111111111111"],
            networkHosts: ["fake-ai-protocol.xyz"],
            xhrCount: 0,
            loadTimeMs: 310,
            hasPlaceholderCopy: true,
          },
        ],
        discoveredGithubRepos: ["anon/forked-stub"],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: [],
        totalXhrObserved: 0,
        notes: [],
      },
      github: {
        queried: true,
        exists: true,
        fullName: "anon/forked-stub",
        url: "https://github.com/anon/forked-stub",
        description: null,
        stars: 1,
        forks: 0,
        openIssues: 0,
        isFork: true,
        forkParent: "solana-labs/example",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ageDays: 1,
        ownerAccountAgeDays: 5,
        recentCommitCount: 15,
        uniqueAuthorCount: 1,
        burstCommitRatio: 1.0,
        topLanguages: [],
        topLevelFiles: ["README.md"],
        hasTestsOrCi: false,
        hasPackageManifest: false,
        signals: [
          {
            code: "SINGLE_BURST",
            severity: "CRITICAL",
            message: "100% of commits pushed in a single 24h window.",
          },
        ],
      },
      chain: {
        mintAddress: "11111111111111111111111111111111",
        tokenReport: {
          mintAddress: "11111111111111111111111111111111",
          tokenProgram: "SPL Token",
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          isToken2022: false,
          isPumpFunSuffix: false,
          name: "FakeAI",
          symbol: "FAKE",
          decimals: 6,
          rawSupply: "1000000000",
          supplyUi: 1000,
          mintAuthority: "AttackerMintAuth1111111111111111111111111",
          freezeAuthority: "AttackerFreezeAuth1111111111111111111111",
          extensions: [],
          transferFeeBps: null,
          permanentDelegate: null,
          transferHookProgramId: null,
          defaultAccountState: null,
          topHolders: [],
          top5Pct: 75,
          top10Pct: 88,
          riskScore: 78,
          classification: "CRITICAL",
          recommendedAction: "HIGH_RUG_RISK",
          executiveSummary: "Active mint & freeze authority.",
          flags: [
            {
              code: "MINT_AUTHORITY_ACTIVE",
              severity: "HIGH",
              title: "Active Mint Authority",
              description: "Supply can be inflated.",
            },
          ],
          slot: 300000000,
          latencyMs: 90,
          inferenceMode: "deterministic-fallback",
          privacyAttestation: "Zero retention",
        },
        dexPair: {
          dexId: "pumpfun",
          pairAddress: "Pair22222222222222222222222222222222222222",
          pairUrl: "https://dexscreener.com/solana/pair2",
          liquidityUsd: 450,
          fdv: 15000,
          volume24hUsd: 200,
          pairCreatedAt: new Date().toISOString(),
          pairAgeHours: 2,
          websites: [],
          socials: [],
        },
        accountRecentTxCount: 3,
      },
      domain: {
        hostname: "fake-ai-protocol.xyz",
        domainEval: {
          hostname: "fake-ai-protocol.xyz",
          status: "SUSPICIOUS",
          riskScore: 55,
          riskLevel: "HIGH",
          isAllowlisted: false,
          isPunycode: false,
          closestVerifiedBrand: null,
          matchedVerifiedDomain: null,
          reasons: ["Suspicious AI claim keywords on unverified .xyz domain"],
        },
        rdapCreatedAt: new Date().toISOString(),
        domainAgeDays: 2,
        registrableDomain: "fake-ai-protocol.xyz",
        pageTitle: "Coming Soon",
        generatorHints: ["Framer"],
      },
      xPost: null,
    });

    expect(result.verdict).toBe("HIGH_FABRICATION_RISK");
    expect(result.authenticityScore).toBeLessThan(42);
    expect(result.keyRedFlags.length).toBeGreaterThanOrEqual(3);
  });

  it("caps bare token CA without verified code or website below VERIFIED_BUILD", () => {
    const result = buildDeterministicBuildCheck({
      id: "bc_ca_only",
      createdAt: new Date().toISOString(),
      elapsedMs: 1200,
      target: {
        rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        kind: "token_ca",
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        normalizedUrl: "https://dexscreener.com/solana/CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      },
      browser: {
        mode: "local-chromium",
        executableLabel: "Chromium",
        stops: [],
        discoveredGithubRepos: [],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: [],
        totalXhrObserved: 0,
        notes: [],
      },
      github: null,
      chain: {
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        tokenReport: {
          mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
          tokenProgram: "SPL Token",
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          isToken2022: false,
          isPumpFunSuffix: false,
          name: "BareToken",
          symbol: "BARE",
          decimals: 6,
          rawSupply: "1000000000000000",
          supplyUi: 1000000000,
          mintAuthority: null,
          freezeAuthority: null,
          extensions: [],
          transferFeeBps: null,
          permanentDelegate: null,
          transferHookProgramId: null,
          defaultAccountState: null,
          topHolders: [],
          top5Pct: 12,
          top10Pct: 20,
          riskScore: 0,
          classification: "SAFE",
          recommendedAction: "VERIFIED_SAFE",
          executiveSummary: "Mint and freeze revoked.",
          flags: [],
          slot: 469000000,
          latencyMs: 50,
          inferenceMode: "deterministic-fallback",
          privacyAttestation: "Zero retention",
        },
        dexPair: null,
        accountRecentTxCount: 15,
      },
      domain: null,
      xPost: null,
    });

    expect(result.verdict).toBe("UNPROVEN_HYPE");
    expect(result.authenticityScore).toBeLessThanOrEqual(64);
  });

  it("flags XHR API cluster devnet contradictions and deep holder cabal clusters", () => {
    const result = buildDeterministicBuildCheck({
      id: "bc_api_cabal",
      createdAt: new Date().toISOString(),
      elapsedMs: 2500,
      target: {
        rawInput: "https://example-shield.xyz",
        kind: "website",
        normalizedUrl: "https://example-shield.xyz",
        hostname: "example-shield.xyz",
      },
      browser: {
        mode: "local-chromium",
        executableLabel: "Chromium",
        stops: [
          {
            url: "https://example-shield.xyz",
            title: "Example Shield",
            stepLabel: "Live Site",
            screenshotBase64: "",
            textExcerpt: "Try our live on Solana Mainnet firewall powered by Venice AI.",
            outboundGithub: [],
            outboundX: [],
            outboundSolanaAddresses: [],
            networkHosts: ["example-shield.xyz"],
            xhrCount: 2,
            loadTimeMs: 400,
            hasPlaceholderCopy: false,
            consoleErrors: ["TypeError: undefined is not a function"],
            apiPayloads: [
              {
                url: "https://example-shield.xyz/api/policy-status",
                status: 200,
                jsonExcerpt: '{"ok":true,"cluster":"devnet","initialized":false}',
              },
              {
                url: "https://example-shield.xyz/api/intent",
                status: 200,
                jsonExcerpt: '{"inferenceMode":"deterministic-fallback"}',
              },
            ],
          },
        ],
        discoveredGithubRepos: [],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: ["https://example-shield.xyz"],
        totalXhrObserved: 2,
        pageErrorsCount: 1,
        inspectedApiPayloads: [
          {
            url: "https://example-shield.xyz/api/policy-status",
            status: 200,
            jsonExcerpt: '{"ok":true,"cluster":"devnet","initialized":false}',
          },
          {
            url: "https://example-shield.xyz/api/intent",
            status: 200,
            jsonExcerpt: '{"inferenceMode":"deterministic-fallback"}',
          },
        ],
        notes: [],
      },
      github: null,
      chain: {
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        tokenReport: null,
        dexPair: null,
        accountRecentTxCount: 10,
        deep: {
          metadata: {
            name: "Example",
            symbol: "EX",
            description: null,
            imageUrl: null,
            websites: ["https://example-shield.xyz"],
            twitterUrl: null,
            telegramUrl: null,
            launchpad: "raydium-launchlab",
            createdAt: null,
          },
          market: {
            poolAddress: null,
            dexId: "raydium-launchlab",
            priceUsd: 0.00001,
            marketCapUsd: 10000,
            fdvUsd: 10000,
            liquidityUsd: 3500,
            volume24hUsd: 50000,
            priceChange5m: null,
            priceChange1h: null,
            priceChange6h: null,
            priceChange24h: null,
            buys1h: null,
            sells1h: null,
            buys24h: null,
            sells24h: null,
            lpLockedPct: 100,
            lpLockedUsd: 3500,
          },
          holders: {
            score: 40,
            verdict: "SKETCHY",
            totalHolders: 120,
            distribution: {
              insidersPct: 13.5,
              snipersPct: 21.0,
              burnedOrLockedPct: 40.0,
              devPct: 0,
              retailPct: 25.5,
            },
            clusters: [
              {
                clusterId: "funder_abc",
                kind: "co_funded",
                label: "Co-funded cluster (5 wallets from Fnd111...)",
                funder: "Fnd1111111111111111111111111111111111111111",
                slot: 468588274,
                combinedPct: 13.5,
                wallets: [],
              },
            ],
            nodes: [],
            checks: [],
            flagsCount: 2,
            watchCount: 1,
            clearCount: 3,
            notes: ["5 co-funded wallets detected"],
          },
          devHistory: {
            devAddress: "Edwc4wHn1bfPHLfMu5SeydhwDKeuJwVSAuFfbgZ7aLqJ",
            solBalance: 0.51,
            tokenHoldingPct: 0,
            coinsLaunchedCount: 1,
            flaggedCoinsCount: 0,
            launchedTokens: [],
            recentTxs: [],
          },
        },
      },
      domain: {
        hostname: "example-shield.xyz",
        domainEval: {
          hostname: "example-shield.xyz",
          status: "UNVERIFIED",
          riskScore: 15,
          riskLevel: "MEDIUM",
          isAllowlisted: false,
          isPunycode: false,
          closestVerifiedBrand: null,
          matchedVerifiedDomain: null,
          reasons: [],
        },
        rdapCreatedAt: null,
        domainAgeDays: 5,
        registrableDomain: "example-shield.xyz",
        pageTitle: "Example Shield",
        generatorHints: [],
      },
      xPost: null,
    });

    expect(result.componentScores.holdersProof).toBe(40);
    expect(result.claimsVsProof.some((c) => c.status === "CONTRADICTED")).toBe(true);
    expect(result.keyRedFlags.some((f) => f.includes("devnet"))).toBe(true);
    expect(result.keyRedFlags.some((f) => f.includes("Co-funded cluster"))).toBe(true);
    expect(result.authenticityScore).toBeLessThan(55);
  });

  it("accurately classifies burnChecked, creator fee claims, genuine InitializeV2 deploys, and stake withdrawals", () => {
    const dev = "Edwc4wHn1bfPHLfMu5SeydhwDKeuJwVSAuFfbgZ7aLqJ";

    const burnRes = classifyDevTx(
      {
        transaction: {
          message: {
            instructions: [
              {
                parsed: {
                  type: "burnChecked",
                  info: { tokenAmount: { uiAmountString: "1652987.054344" } },
                },
              },
            ],
          },
        },
        meta: { logMessages: [] },
      },
      dev
    );
    expect(burnRes.action).toBe("burn");
    expect(burnRes.summary).toContain("1.65M");

    const claimRes = classifyDevTx(
      {
        transaction: {
          message: { instructions: [] },
        },
        meta: {
          logMessages: ["Program log: Instruction: ClaimCurveFees"],
          innerInstructions: [
            { instructions: [{ parsed: { type: "transfer", info: { source: dev, lamports: 0 } } }] },
          ],
        },
      },
      dev
    );
    expect(claimRes.action).toBe("claim");

    const withdrawRes = classifyDevTx(
      {
        transaction: { message: { instructions: [] } },
        meta: {
          logMessages: [
            "Program log: Instruction: Initialize",
            "Program log: Instruction: Withdraw",
          ],
        },
      },
      dev
    );
    expect(withdrawRes.action).toBe("transfer");

    const deployRes = classifyDevTx(
      {
        transaction: {
          message: {
            instructions: [{ parsed: { type: "initializeMint2", info: {} } }],
          },
        },
        meta: { logMessages: ["Program log: Instruction: InitializeV2"] },
      },
      dev
    );
    expect(deployRes.action).toBe("deploy");
  });

  it("extracts SSR title, copy, and outbound GitHub/X links while stripping script payloads", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>SolShield &amp; Firewall</title>
          <meta name="description" content="Non-custodial Solana transaction firewall &amp; Devnet Policy Vault." />
        </head>
        <body>
          <script>self.__next_f.push([1,"coming soon dummy https://github.com/evil/fake"]);</script>
          <main>
            <h1>Adaptive AI Guard</h1>
            <p>Live bytecode simulator and Devnet Beta Policy Vault.</p>
            <a href="https://x.com/usesolshield">X</a>
            <a href="https://github.com/Blanksite/solshield">Repo</a>
          </main>
        </body>
      </html>
    `;

    const extracted = extractHtmlStopSignals(html, "https://sol-shield.xyz/");
    expect(extracted.title).toBe("SolShield & Firewall");
    expect(extracted.hasPlaceholderCopy).toBe(false);
    expect(extracted.textExcerpt).toContain("Non-custodial Solana transaction firewall");
    expect(extracted.textExcerpt).toContain("Adaptive AI Guard");
    expect(extracted.outboundGithub).toEqual(["Blanksite/solshield"]);
    expect(extracted.outboundX).toEqual(["https://x.com/usesolshield"]);
  });

  it("fetches public SSR HTML in http-fallback mode and blocks SSRF redirects", async () => {
    const dnsSpy = vi
      .spyOn(dns, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://sol-shield.xyz/") {
        return new Response(
          `<html><head><title>SolShield</title></head><body><main>05 // DEVNET POLICY VAULT (BETA)</main><a href="https://github.com/Blanksite/solshield">Code</a></body></html>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
      if (url === "https://github.com/Blanksite/solshield") {
        return new Response(
          `<html><head><title>GitHub - Blanksite/solshield</title></head><body><main>Solana firewall repo</main></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } }
        );
      }
      if (url === "https://redirect-trap.test/") {
        return new Response("", {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    const frames: unknown[] = [];
    const notes: string[] = [];
    try {
      const summary = await runHttpFallbackObservation({
        initialUrls: [
          { url: "https://sol-shield.xyz/", label: "Project Site · sol-shield.xyz" },
          { url: "https://redirect-trap.test/", label: "Redirect Trap" },
        ],
        maxStops: 3,
        onFrame: (f) => frames.push(f),
        onNote: (n) => notes.push(n),
      });

      expect(summary.mode).toBe("http-fallback");
      expect(summary.discoveredGithubRepos).toContain("Blanksite/solshield");
      expect(summary.stops.length).toBe(2);
      expect(summary.stops[0].title).toBe("SolShield");
      expect(summary.stops[1].url).toBe("https://github.com/Blanksite/solshield");
      expect(frames.length).toBe(0);
      expect(notes.some((n) => n.includes("HTTP inspected"))).toBe(true);
      expect(
        summary.notes.some(
          (n) => n.includes("redirect-trap.test") && n.includes("Blocked internal/private host")
        )
      ).toBe(true);
    } finally {
      fetchSpy.mockRestore();
      dnsSpy.mockRestore();
    }
  });

  it("falls back to public GitHub HTML/Atom when REST API returns 403 rate limit, but respects 404", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://api.github.com/repos/Blanksite/solshield")) {
        return new Response("rate limit exceeded", { status: 403 });
      }
      if (url.startsWith("https://api.github.com/users/Blanksite")) {
        return new Response("rate limit exceeded", { status: 403 });
      }
      if (url === "https://github.com/Blanksite/solshield") {
        return new Response(
          `<html><head><meta property="og:description" content="SolShield Protocol" /></head>
          <body>
            <a href="/Blanksite/solshield/blob/main/package.json">package.json</a>
            <a href="/Blanksite/solshield/tree/main/tests">tests</a>
            <span class="color-fg-default text-bold mr-1">TypeScript</span>
          </body></html>`,
          { status: 200, headers: { "content-type": "text/html" } }
        );
      }
      if (url === "https://github.com/Blanksite/solshield/commits.atom") {
        return new Response(
          `<feed>
            <entry><updated>2026-11-10T10:00:00Z</updated><author><name>alice</name></author></entry>
            <entry><updated>2026-11-11T10:00:00Z</updated><author><name>bob</name></author></entry>
          </feed>`,
          { status: 200, headers: { "content-type": "application/atom+xml" } }
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    try {
      const rateLimitedFallback = await collectGitHubForensics("Blanksite/solshield");
      expect(rateLimitedFallback.exists).toBe(true);
      expect(rateLimitedFallback.hasPackageManifest).toBe(true);
      expect(rateLimitedFallback.hasTestsOrCi).toBe(true);
      expect(rateLimitedFallback.recentCommitCount).toBe(2);
      expect(rateLimitedFallback.uniqueAuthorCount).toBe(2);
      expect(rateLimitedFallback.topLanguages).toContain("TypeScript");
      expect(
        rateLimitedFallback.signals.some((s) => s.code === "GITHUB_PUBLIC_WEB_FALLBACK")
      ).toBe(true);

      const missingRepo = await collectGitHubForensics("missing/does-not-exist");
      expect(missingRepo.exists).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("prevents Venice LLM subjectivity from slashing an authentic verified open-source build below VERIFIED_BUILD", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  authenticityScore: 42,
                  headline: "Overly skeptical landing summary",
                  executiveSummary: "Suspicious young domain.",
                  claimsVsProof: [],
                  verifiedSignals: [],
                  keyRedFlags: ["Recently registered domain (2 days old)"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      const report = await synthesizeWithVeniceBuildCheck(
        {
          id: "bc_floor_guard",
          createdAt: "2026-11-14T13:00:00.000Z",
          elapsedMs: 1200,
          target: {
            rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
            kind: "token_ca",
            mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
            normalizedUrl: "https://dexscreener.com/solana/CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
            hostname: "dexscreener.com",
          },
          browser: {
            mode: "local-chromium",
            executableLabel: "Chrome",
            stops: [
              {
                url: "https://sol-shield.xyz/",
                title: "SolShield",
                stepLabel: "Home",
                screenshotBase64: "",
                textExcerpt: "Non-custodial Solana firewall powered by Venice AI",
                outboundGithub: ["Blanksite/solshield"],
                outboundX: [],
                outboundSolanaAddresses: [],
                networkHosts: ["sol-shield.xyz"],
                xhrCount: 4,
                loadTimeMs: 420,
                hasPlaceholderCopy: false,
                consoleErrors: [],
              },
            ],
            discoveredGithubRepos: ["Blanksite/solshield"],
            discoveredXUrls: [],
            discoveredSolanaAddresses: [],
            discoveredWebsiteUrls: ["https://sol-shield.xyz"],
            totalXhrObserved: 4,
            notes: [],
          },
          github: {
            queried: true,
            exists: true,
            fullName: "Blanksite/solshield",
            url: "https://github.com/Blanksite/solshield",
            description: "SolShield Firewall & BuildCheck",
            stars: 1,
            forks: 0,
            openIssues: 0,
            isFork: false,
            forkParent: null,
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-11-14T12:00:00Z",
            ageDays: 44,
            ownerAccountAgeDays: 400,
            recentCommitCount: 30,
            uniqueAuthorCount: 1,
            burstCommitRatio: 0.35,
            topLanguages: ["TypeScript", "Rust"],
            topLevelFiles: ["package.json", "src", "tests", "worker", "Anchor.toml"],
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
              rawSupply: "1000000000000",
              supplyUi: 1000000,
              mintAuthority: null,
              freezeAuthority: null,
              extensions: [],
              transferFeeBps: null,
              permanentDelegate: null,
              transferHookProgramId: null,
              defaultAccountState: null,
              topHolders: [],
              top5Pct: 14.9,
              top10Pct: 22,
              riskScore: 0,
              classification: "SAFE",
              recommendedAction: "VERIFIED_SAFE",
              executiveSummary: "Safe authorities",
              flags: [],
              slot: 400000000,
              latencyMs: 50,
              inferenceMode: "deterministic-fallback",
              privacyAttestation: "Zero retention",
            },
            dexPair: {
              dexId: "pumpswap",
              pairAddress: "pair123",
              pairUrl: "https://dexscreener.com/solana/pair123",
              liquidityUsd: 4566,
              fdv: 16000,
              volume24hUsd: 25000,
              pairCreatedAt: "2026-11-12T00:00:00Z",
              pairAgeHours: 48,
              websites: ["https://sol-shield.xyz"],
              socials: [],
            },
            accountRecentTxCount: 12,
          },
          domain: {
            hostname: "sol-shield.xyz",
            registrableDomain: "sol-shield.xyz",
            domainAgeDays: 2,
            rdapCreatedAt: "2026-11-12T00:00:00Z",
            pageTitle: "SolShield",
            generatorHints: [],
            domainEval: {
              hostname: "sol-shield.xyz",
              status: "VERIFIED",
              riskScore: 5,
              riskLevel: "LOW",
              isAllowlisted: true,
              isPunycode: false,
              closestVerifiedBrand: null,
              matchedVerifiedDomain: "sol-shield.xyz",
              reasons: [],
            },
          },
          xPost: null,
        },
        { apiKey: "VENICE_INFERENCE_KEY_test_only", enableVision: false }
      );

      expect(report.inferenceMode).toBe("venice-live-api");
      expect(report.authenticityScore).toBeGreaterThanOrEqual(70);
      expect(report.verdict).toBe("VERIFIED_BUILD");
      expect(report.contradictionCallout).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("flags cross-claim marketing contradictions in deterministic mode and surfaces single-call Venice contradictionCallout", async () => {
    const contradictoryInput = {
      id: "bc_contradict_01",
      createdAt: "2026-11-16T09:00:00Z",
      elapsedMs: 1200,
      target: {
        rawInput: "https://hyperai-demo.example",
        kind: "website" as const,
        normalizedUrl: "https://hyperai-demo.example",
        hostname: "hyperai-demo.example",
      },
      browser: {
        mode: "http-fallback" as const,
        executableLabel: "HTTP Fallback",
        stops: [
          {
            url: "https://hyperai-demo.example",
            title: "HyperAI Infra",
            stepLabel: "Landing",
            screenshotBase64: "",
            textExcerpt:
              "100% open-source live AI agent protocol audited by CertiK — Coming Soon",
            outboundGithub: [],
            outboundX: [],
            outboundSolanaAddresses: [],
            networkHosts: [],
            xhrCount: 0,
            loadTimeMs: 300,
            hasPlaceholderCopy: true,
            consoleErrors: [],
          },
        ],
        discoveredGithubRepos: [],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: ["https://hyperai-demo.example"],
        totalXhrObserved: 0,
        notes: [],
      },
      github: null,
      chain: {
        mintAddress: "7xK9mN2pQrStUvWxYz1234567890AbCdEfGhIjKlMnOp",
        tokenReport: {
          mintAddress: "7xK9mN2pQrStUvWxYz1234567890AbCdEfGhIjKlMnOp",
          tokenProgram: "SPL Token" as const,
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          isToken2022: false,
          isPumpFunSuffix: false,
          verifiedAsset: null,
          name: "HyperAI",
          symbol: "HAI",
          decimals: 6,
          rawSupply: "1000000000000",
          supplyUi: 1000000,
          mintAuthority: "Auth111111111111111111111111111111111111111",
          freezeAuthority: null,
          extensions: [],
          transferFeeBps: null,
          permanentDelegate: null,
          transferHookProgramId: null,
          defaultAccountState: null,
          topHolders: [],
          top5Pct: 68.4,
          top10Pct: 81.2,
          riskScore: 72,
          classification: "CRITICAL" as const,
          recommendedAction: "HIGH_RUG_RISK" as const,
          executiveSummary: "Active mint authority",
          flags: [],
          slot: 400000000,
          latencyMs: 40,
          inferenceMode: "deterministic-fallback" as const,
          privacyAttestation: "Zero retention",
        },
        dexPair: null,
        accountRecentTxCount: 5,
      },
      domain: {
        hostname: "hyperai-demo.example",
        registrableDomain: "hyperai-demo.example",
        domainAgeDays: 1,
        rdapCreatedAt: "2026-11-15T00:00:00Z",
        pageTitle: "HyperAI",
        generatorHints: [],
        domainEval: {
          hostname: "hyperai-demo.example",
          status: "UNVERIFIED" as const,
          riskScore: 48,
          riskLevel: "HIGH" as const,
          isAllowlisted: false,
          isPunycode: false,
          closestVerifiedBrand: null,
          matchedVerifiedDomain: null,
          reasons: ["Newly registered domain"],
        },
      },
      xPost: {
        url: "https://x.com/hyperai/status/1",
        handle: "hyperai",
        tweetId: "1",
        authorName: "HyperAI",
        textContent: "Fair launch with 0% dev and live autonomous AI live now!",
        extractedUrls: [],
        extractedSolanaAddresses: [],
        extractedGithubRepos: [],
        methodUsed: "syndication" as const,
      },
    };

    const deterministic = buildDeterministicBuildCheck(contradictoryInput);
    expect(deterministic.contradictionCallout).toBeTruthy();
    expect(
      deterministic.claimsVsProof.some((c) => c.status === "CONTRADICTED")
    ).toBe(true);
    expect(deterministic.authenticityScore).toBeLessThan(45);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    authenticityScore: 22,
                    headline: "Open-source and live AI claims directly contradict observed evidence.",
                    contradictionCallout:
                      "Pitches a 100% open-source CertiK-audited live AI stack, yet ships a 1-day Coming Soon site with no GitHub repo and active Mint authority.",
                    executiveSummary:
                      "No public repository exists, rendered copy contains placeholders, and Mint authority remains active.",
                    claimsVsProof: deterministic.claimsVsProof,
                    verifiedSignals: [],
                    keyRedFlags: deterministic.keyRedFlags,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    try {
      const report = await synthesizeWithVeniceBuildCheck(contradictoryInput, {
        apiKey: "VENICE_INFERENCE_KEY_test_only",
        enableVision: false,
      });
      // Ensures zero additional external Venice API calls beyond the existing synthesis call
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(report.contradictionCallout).toContain("100% open-source CertiK-audited");
      expect(report.verdict).toBe("HIGH_FABRICATION_RISK");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not penalize transparent Policy Vault (Devnet Beta) disclosures alongside Mainnet RPC firewall", () => {
    const result = buildDeterministicBuildCheck({
      id: "bc_shield_devnet_beta",
      createdAt: new Date().toISOString(),
      elapsedMs: 1200,
      target: {
        rawInput: "https://sol-shield.xyz",
        kind: "website",
        normalizedUrl: "https://sol-shield.xyz",
        hostname: "sol-shield.xyz",
      },
      browser: {
        mode: "local-chromium",
        executableLabel: "Chromium",
        stops: [
          {
            url: "https://sol-shield.xyz",
            title: "SolShield",
            stepLabel: "Live Site",
            screenshotBase64: "",
            textExcerpt:
              "Mainnet Firewall live on Solana Mainnet RPC. 03 // POLICY VAULT (DEVNET BETA) Optional Devnet Beta Anchor module paired with our Mainnet Tx Firewall.",
            outboundGithub: ["Blanksite/solshield"],
            outboundX: [],
            outboundSolanaAddresses: [],
            networkHosts: ["sol-shield.xyz"],
            xhrCount: 2,
            loadTimeMs: 350,
            hasPlaceholderCopy: false,
            consoleErrors: [],
            apiPayloads: [
              {
                url: "https://sol-shield.xyz/api/policy-status",
                status: 200,
                jsonExcerpt: '{"ok":true,"cluster":"devnet","programDeployedOnDevnet":true}',
              },
            ],
          },
        ],
        discoveredGithubRepos: ["Blanksite/solshield"],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: ["https://sol-shield.xyz"],
        totalXhrObserved: 2,
        pageErrorsCount: 0,
        inspectedApiPayloads: [
          {
            url: "https://sol-shield.xyz/api/policy-status",
            status: 200,
            jsonExcerpt: '{"ok":true,"cluster":"devnet","programDeployedOnDevnet":true}',
          },
        ],
        notes: [],
      },
      github: null,
      chain: null,
      domain: null,
      xPost: null,
    });

    expect(
      result.claimsVsProof.some(
        (c) => c.claim.includes("/api/policy-status") && c.status === "CONTRADICTED"
      )
    ).toBe(false);
    expect(result.keyRedFlags.some((f) => f.includes('cluster "devnet"'))).toBe(false);
  });

  it("extracts bare domains, scheme-less github repos, and npm CLI packages while ignoring filenames", () => {
    const sample =
      "Check `npx archivums init` or `npm i @archivum/sdk@latest`, visit tryarchivum.com/try or github.com/tryarchivum/archivum. Ignore README.md, index.ts, e.g., v1.0, and x.com/foo.";
    expect(extractBareWebDomainsFromText(sample)).toEqual(["https://tryarchivum.com/try"]);
    expect(extractNpmPackagesFromText(sample)).toEqual(["archivums", "@archivum/sdk"]);

    const entities = extractEntitiesFromText(sample);
    expect(entities.githubRepos).toContain("tryarchivum/archivum");
    expect(entities.websiteUrls).toEqual(["https://tryarchivum.com/try"]);
  });

  it("filters X video links in collectXPostIntel, upgrades truncated Note Tweets via X_BEARER_TOKEN, and resolves npm + GeckoTerminal L2 pools", async () => {
    const prevBearer = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = "test-bearer-token";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("cdn.syndication.twimg.com")) {
        return new Response(
          JSON.stringify({
            text: "Most AI agents forget... https://t.co/vid",
            note_tweet: { id: "Tm90ZVR3ZWV0" },
            user: { name: "Archivum", screen_name: "Use_Archivum" },
            entities: {
              urls: [{ expanded_url: "https://x.com/Use_Archivum/status/2123032889386496247/video/1" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("api.x.com/2/tweets/2123032889386496247")) {
        return new Response(
          JSON.stringify({
            data: {
              text: "Short preview",
              author_id: "8001",
              note_tweet: {
                text: "Get started: `npx archivums init` or tryarchivum.com/try",
                entities: {
                  urls: [{ expanded_url: "https://tryarchivum.com/try" }],
                },
              },
            },
            includes: {
              users: [
                {
                  id: "8001",
                  name: "Archivum",
                  username: "Use_Archivum",
                  description: "Memory for AI agents. 0xda4283f14b487034b90d865aac489994f2c680c4",
                  entities: {
                    url: { urls: [{ expanded_url: "https://tryarchivum.com" }] },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("registry.npmjs.org/archivums")) {
        return new Response(
          JSON.stringify({
            name: "archivums",
            repository: { type: "git", url: "git+https://github.com/tryarchivum/archivum.git" },
            homepage: "https://github.com/tryarchivum/archivum#readme",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("api.dexscreener.com")) {
        return new Response(JSON.stringify({ pairs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("api.geckoterminal.com/api/v2/search/pools")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "robinhood_0x9db7a7d4a7a2e737fc18d2c4eb7f7a61602bc68f",
                attributes: {
                  address: "0x9db7a7d4a7a2e737fc18d2c4eb7f7a61602bc68f",
                  name: "ARCH / WETH",
                  pool_created_at: "2026-11-18T12:07:26Z",
                  fdv_usd: "14751.89",
                  reserve_in_usd: "10322.64",
                  volume_usd: { h24: "20249.96" },
                },
                relationships: {
                  base_token: {
                    data: { id: "robinhood_0xda4283f14b487034b90d865aac489994f2c680c4" },
                  },
                  dex: { data: { id: "pons-v2" } },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const xPost = await collectXPostIntel("https://x.com/Use_Archivum/status/2123032889386496247");
      expect(xPost.methodUsed).toBe("x-api-v2");
      expect(xPost.extractedUrls).not.toContain(
        "https://x.com/Use_Archivum/status/2123032889386496247/video/1"
      );
      expect(xPost.extractedUrls).toContain("https://tryarchivum.com/try");
      expect(xPost.extractedEvmAddresses).toContain("0xda4283f14b487034b90d865aac489994f2c680c4");
      expect(xPost.extractedNpmPackages).toEqual(["archivums"]);

      const npm = await discoverGithubRepoFromNpmPackages(xPost.extractedNpmPackages || []);
      expect(npm.githubRepos).toEqual(["tryarchivum/archivum"]);

      const evmChain = await collectChainTokenIntel("0xda4283f14b487034b90d865aac489994f2c680c4");
      expect(evmChain.dexPair?.dexId).toBe("pons-v2");
      expect(evmChain.dexPair?.baseSymbol).toBe("ARCH");
      expect(evmChain.dexPair?.liquidityUsd).toBe(10323);
      expect(evmChain.networkName || evmChain.robinhood?.networkName).toMatch(/robinhood/i);
    } finally {
      vi.unstubAllGlobals();
      if (prevBearer === undefined) delete process.env.X_BEARER_TOKEN;
      else process.env.X_BEARER_TOKEN = prevBearer;
    }
  });
});
