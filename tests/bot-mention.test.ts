import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildDeterministicBuildCheck } from "../src/lib/buildcheck/venice-buildcheck";
import {
  isAuthorRateLimited,
  isTweetProcessed,
  loadBotState,
  recordProcessedMention,
  saveBotState,
} from "../worker/bot-state";
import { buildEvidenceCardHtml, escapeHtml } from "../worker/card-renderer";
import {
  formatBuildCheckReplyTweet,
  resolveMentionTarget,
  signOAuth1Header,
} from "../worker/x-client";

describe("@SolShieldCheck X Bot Mention Resolution & Safety", () => {
  it("extracts direct mint CA or GitHub link from mention before falling back to parent", () => {
    const directCa = resolveMentionTarget({
      id: "2001",
      text: "@SolShieldCheck pls audit CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
      expandedUrls: [],
      referencedTweets: [
        { type: "replied_to", id: "1999", text: "Check https://example-other.xyz" },
      ],
    });
    expect(directCa).toBe("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");

    const fromParentRepo = resolveMentionTarget({
      id: "2002",
      text: "@SolShieldCheck cek repo ini beneran build ga",
      expandedUrls: [],
      referencedTweets: [
        {
          type: "replied_to",
          id: "1998",
          text: "Shipping v2 today!",
          expandedUrls: ["https://github.com/Blanksite/solshield"],
        },
      ],
    });
    expect(fromParentRepo).toBe("https://github.com/Blanksite/solshield");

    const fallbackParentPost = resolveMentionTarget({
      id: "2003",
      text: "@SolShieldCheck check this post",
      expandedUrls: [],
      referencedTweets: [
        {
          type: "quoted",
          id: "1899123456789012345",
          text: "No URLs inside this quoted claim.",
          expandedUrls: [],
        },
      ],
    });
    expect(fallbackParentPost).toBe("https://x.com/i/status/1899123456789012345");
  });

  it("ignores bare mentions with no links and no parent tweet", () => {
    const nothing = resolveMentionTarget({
      id: "2004",
      text: "@SolShieldCheck gm",
      expandedUrls: [],
      referencedTweets: [],
    });
    expect(nothing).toBeNull();
  });

  it("formats concise X replies within 280 characters with score and buildcheck link", () => {
    const det = buildDeterministicBuildCheck({
      id: "bc_tweet_1",
      createdAt: new Date().toISOString(),
      elapsedMs: 3100,
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
        stops: [],
        discoveredGithubRepos: [],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: [],
        totalXhrObserved: 0,
        notes: [],
      },
      github: {
        queried: true,
        exists: true,
        fullName: "Blanksite/solshield",
        url: "https://github.com/Blanksite/solshield",
        description: null,
        stars: 20,
        forks: 2,
        openIssues: 0,
        isFork: false,
        forkParent: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: new Date().toISOString(),
        ageDays: 90,
        ownerAccountAgeDays: 365,
        recentCommitCount: 25,
        uniqueAuthorCount: 2,
        burstCommitRatio: 0.2,
        topLanguages: ["TypeScript"],
        topLevelFiles: ["package.json", "tests"],
        hasTestsOrCi: true,
        hasPackageManifest: true,
        signals: [
          {
            code: "ACTIVE_TESTS",
            severity: "INFO",
            message: "Repository contains automated test suites and CI configuration with consistent multi-month commit history.",
          },
        ],
      },
      chain: null,
      domain: null,
      xPost: null,
    });

    const tweet = formatBuildCheckReplyTweet(
      {
        ...det,
        inferenceMode: "deterministic-fallback",
        modelsUsed: ["deterministic-forensic-v1"],
        visionSummary: null,
        privacyAttestation: "Zero Data Retention",
      },
      "https://sol-shield.xyz"
    );

    expect(tweet.length).toBeLessThanOrEqual(280);
    expect(tweet).toContain("[VERIFIED BUILD]");
    expect(tweet).toContain("Blanksite/solshield");
    expect(tweet).toContain("https://sol-shield.xyz/buildcheck");
  });

  it("signs valid OAuth 1.0a Authorization headers", () => {
    const header = signOAuth1Header({
      method: "POST",
      url: "https://api.x.com/2/tweets",
      apiKey: "ck_test",
      apiSecret: "cs_test",
      accessToken: "tk_test",
      accessSecret: "ts_test",
      timestampSec: "1700000000",
      nonce: "nonce123",
    });

    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="ck_test"');
    expect(header).toContain('oauth_token="tk_test"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_signature="');
  });

  it("escapes attacker HTML/JS strings when generating Evidence Card HTML", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );

    const det = buildDeterministicBuildCheck({
      id: "bc_xss_1",
      createdAt: new Date().toISOString(),
      elapsedMs: 1200,
      target: {
        rawInput: "https://evil.example",
        kind: "website",
        normalizedUrl: "https://evil.example",
        hostname: "evil.example",
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
      chain: null,
      domain: null,
      xPost: null,
    });

    const html = buildEvidenceCardHtml({
      ...det,
      headline: '<img src=x onerror=alert(1)> Scam',
      inferenceMode: "deterministic-fallback",
      modelsUsed: ["deterministic-forensic-v1"],
      visionSummary: null,
      privacyAttestation: "Zero retention",
    });

    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("persists processed tweet IDs and enforces author rate limits cleanly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solshield-bot-"));
    const stateFile = path.join(tmpDir, "state.json");

    try {
      const state = loadBotState(stateFile);
      expect(state.processedTweetIds).toEqual([]);

      recordProcessedMention(state, "1005", "user_42", 1_000_000);
      saveBotState(stateFile, state);

      const reloaded = loadBotState(stateFile);
      expect(isTweetProcessed(reloaded, "1005")).toBe(true);
      expect(reloaded.lastMentionId).toBe("1005");
      expect(isAuthorRateLimited(reloaded, "user_42", 90_000, 1_030_000)).toBe(true);
      expect(isAuthorRateLimited(reloaded, "user_42", 90_000, 1_120_000)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
