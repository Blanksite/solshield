import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { buildDeterministicBuildCheck } from "../src/lib/buildcheck/venice-buildcheck";
import {
  canSendDailyReply,
  evaluateMentionGuard,
  getRepliesTodayCount,
  isAuthorRateLimited,
  isTweetProcessed,
  loadBotState,
  recordProcessedMention,
  recordReplySent,
  saveBotState,
} from "../worker/bot-state";
import {
  buildEvidenceCardHtml,
  escapeHtml,
  loadTokenLogoDataUri,
} from "../worker/card-renderer";
import {
  fetchBotMentions,
  fetchBotUserId,
  formatBuildCheckReplyTweet,
  maskCryptoAddresses,
  postReplyTweetOnX,
  resolveMentionTarget,
  signOAuth1Header,
  uploadEvidencePngToX,
  XApiError,
  type XBotAuthConfig,
} from "../worker/x-client";

const TEST_OAUTH_CONFIG: XBotAuthConfig = {
  botHandle: "usesolshield",
  apiKey: "ck_test",
  apiSecret: "cs_test",
  accessToken: "tk_test",
  accessSecret: "ts_test",
  appPublicUrl: "https://sol-shield.xyz",
};

describe("@usesolshield / @SolShieldCheck X Bot Mention Resolution & Safety", () => {
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

    const directEvmRobinhood = resolveMentionTarget({
      id: "2001b",
      text: "@usesolshield audit this Robinhood coin 0x6982508145454ce325ddbe47a25d4ec3d2311933",
      expandedUrls: [],
      referencedTweets: [],
    });
    expect(directEvmRobinhood).toBe("0x6982508145454ce325ddbe47a25d4ec3d2311933");

    const fromRobinhoodBlockscout = resolveMentionTarget({
      id: "2001c",
      text: "@usesolshield check https://robinhoodchain.blockscout.com/address/0x1234567890123456789012345678901234567890",
      expandedUrls: ["https://robinhoodchain.blockscout.com/address/0x1234567890123456789012345678901234567890"],
      referencedTweets: [],
    });
    expect(fromRobinhoodBlockscout).toBe("0x1234567890123456789012345678901234567890");

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

  it("ignores social chatter and bot self-thread banter while preserving deliberate audit summons", () => {
    const botId = "2120976003053023232";

    // Casual multi-account shoutout / thread banter
    expect(
      resolveMentionTarget(
        {
          id: "2005",
          text: "@usesolshield @AskVenice @DegenCapitalLLC",
          expandedUrls: [],
          referencedTweets: [
            { type: "replied_to", id: "1990", authorId: "999", text: "https://example.xyz" },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Replying to @usesolshield's own promo tweet with banter must NOT audit SolShield's own post
    expect(
      resolveMentionTarget(
        {
          id: "2006",
          text: "@usesolshield @AskVenice @solana look sir",
          inReplyToUserId: botId,
          expandedUrls: [],
          referencedTweets: [
            {
              type: "replied_to",
              id: "1991",
              authorId: botId,
              text: "Introducing SolShield https://sol-shield.xyz",
              expandedUrls: ["https://sol-shield.xyz"],
            },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Auto-inherited thread @mentions with non-audit reaction ("scam", "good tek")
    expect(
      resolveMentionTarget(
        {
          id: "2007",
          text: "@Nuev9999 @usesolshield @AskVenice scam",
          inReplyToUserId: "777",
          expandedUrls: [],
          referencedTweets: [
            {
              type: "replied_to",
              id: "1992",
              authorId: "777",
              text: "WTF. @usesolshield Only $16K MC",
            },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    expect(
      resolveMentionTarget(
        {
          id: "2008",
          text: "@Nuev9999 @usesolshield @AskVenice good tek",
          inReplyToUserId: "777",
          expandedUrls: [],
          referencedTweets: [
            {
              type: "replied_to",
              id: "1992",
              authorId: "777",
              text: "WTF. @usesolshield Only $16K MC",
            },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Quote-tweet reaction without audit intent should NOT auto-resolve quoted attachment URL
    expect(
      resolveMentionTarget(
        {
          id: "2009",
          text: "WTF. @usesolshield Only $16K MC and it has not migrated yet.",
          expandedUrls: ["https://x.com/someone/status/1899123456789012333"],
          referencedTweets: [
            { type: "quoted", id: "1899123456789012333", authorId: "888", text: "Launch live!" },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Even bare "@usesolshield" replying directly to @usesolshield's own tweet is ignored
    expect(
      resolveMentionTarget(
        {
          id: "2010",
          text: "@usesolshield",
          inReplyToUserId: botId,
          expandedUrls: [],
          referencedTweets: [{ type: "replied_to", id: "1994", authorId: botId, text: "GM" }],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Deliberate bare summon replying to another project's tweet SHOULD audit the parent tweet
    expect(
      resolveMentionTarget(
        {
          id: "2011",
          text: "@FounderDev @usesolshield pls",
          inReplyToUserId: "555",
          expandedUrls: [],
          referencedTweets: [
            {
              type: "replied_to",
              id: "1995",
              authorId: "555",
              text: "Check our new Rust DEX",
              expandedUrls: ["https://github.com/founder/dex"],
            },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBe("https://github.com/founder/dex");

    // Deliberate bare quote-tweet "@usesolshield" SHOULD audit the quoted tweet
    expect(
      resolveMentionTarget(
        {
          id: "2012",
          text: "@usesolshield",
          expandedUrls: ["https://x.com/someone/status/1899123456789012999"],
          referencedTweets: [
            {
              type: "quoted",
              id: "1899123456789012999",
              authorId: "888",
              text: "Built in 48 hours",
            },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBe("https://x.com/i/status/1899123456789012999");

    // Explicit Solana CA pasted under @usesolshield's own thread STILL triggers audit
    expect(
      resolveMentionTarget(
        {
          id: "2013",
          text: "@usesolshield CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
          inReplyToUserId: botId,
          expandedUrls: [],
          referencedTweets: [{ type: "replied_to", id: "1994", authorId: botId, text: "Try me" }],
        },
        "usesolshield",
        botId
      )
    ).toBe("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");
  });

  it("ignores media/photo self-links, SolShield own domains, self-thread banter, and casual URL chatter", () => {
    const botId = "2120976003053023232";
    const founderId = "881776365497753600";

    // Mention with attached image (/photo/1 auto-expanded by X API v2) and NO CA must NOT self-scan
    expect(
      resolveMentionTarget(
        {
          id: "2121764669945962877",
          authorId: founderId,
          text: "Cooking something with BotFather @usesolshield https://t.co/uToUTBKTbn",
          expandedUrls: [
            "https://x.com/Rawonbening_/status/2121764669945962877/photo/1",
          ],
          referencedTweets: [],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Self-reply thread update mentioning @usesolshield with screenshot + non-audit prose must NOT scan
    expect(
      resolveMentionTarget(
        {
          id: "2121819083801014723",
          authorId: founderId,
          inReplyToUserId: founderId,
          text: "@usesolshield Looks like @usesolshield x bot is staying free forever. https://t.co/QNSXi6lfUV",
          expandedUrls: [
            "https://x.com/Rawonbening_/status/2121819083801014723/photo/1",
            "https://pic.x.com/QNSXi6lfUV",
          ],
          referencedTweets: [
            {
              type: "replied_to",
              id: "2121818000000000000",
              authorId: founderId,
              text: "SolShield announcement",
            },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Self-reply narration mentioning "scan" without a target must NOT scan own parent tweet
    expect(
      resolveMentionTarget(
        {
          id: "2121819511221526769",
          authorId: founderId,
          inReplyToUserId: founderId,
          text: "@usesolshield scan cost is $0.16 per audit now",
          expandedUrls: [],
          referencedTweets: [
            {
              type: "replied_to",
              id: "2121818000000000000",
              authorId: founderId,
              text: "SolShield announcement",
            },
          ],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Sharing SolShield's own URL alongside @usesolshield must NOT audit sol-shield.xyz
    expect(
      resolveMentionTarget(
        {
          id: "2121900000000000001",
          authorId: founderId,
          text: "Try @usesolshield check https://sol-shield.xyz/buildcheck today!",
          expandedUrls: ["https://sol-shield.xyz/buildcheck"],
          referencedTweets: [],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Casual discussion or partner shoutout linking an external website/X post without audit intent must NOT scan
    expect(
      resolveMentionTarget(
        {
          id: "2121900000000000002",
          authorId: founderId,
          text: "@AskVenice @usesolshield https://builtonvenice.ai",
          expandedUrls: ["https://builtonvenice.ai"],
          referencedTweets: [],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    expect(
      resolveMentionTarget(
        {
          id: "2121900000000000003",
          authorId: founderId,
          text: "Proud to ship with @usesolshield and read https://x.com/AskVenice/status/1900000000000000001",
          expandedUrls: ["https://x.com/AskVenice/status/1900000000000000001"],
          referencedTweets: [],
        },
        "usesolshield",
        botId
      )
    ).toBeNull();

    // Casual sentence WITH an explicit Solana CA STILL triggers CA audit
    expect(
      resolveMentionTarget(
        {
          id: "2121900000000000004",
          authorId: founderId,
          text: "Thoughts on CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx @usesolshield?",
          expandedUrls: ["https://x.com/Rawonbening_/status/2121900000000000004/photo/1"],
          referencedTweets: [],
        },
        "usesolshield",
        botId
      )
    ).toBe("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");

    // Clean command "@usesolshield <url>" or explicit audit keyword + URL STILL triggers audit
    expect(
      resolveMentionTarget(
        {
          id: "2121900000000000005",
          text: "@usesolshield https://github.com/founder/real-protocol",
          expandedUrls: ["https://github.com/founder/real-protocol"],
          referencedTweets: [],
        },
        "usesolshield",
        botId
      )
    ).toBe("https://github.com/founder/real-protocol");

    expect(
      resolveMentionTarget(
        {
          id: "2121900000000000006",
          text: "@usesolshield audit https://real-protocol.example",
          expandedUrls: ["https://real-protocol.example"],
          referencedTweets: [],
        },
        "usesolshield",
        botId
      )
    ).toBe("https://real-protocol.example");
  });

  it("strips self-photo/video links in fetchBotMentions, masks raw CAs in reply text, and classifies permanent X rejections", async () => {
    const mentions = await fetchBotMentions(TEST_OAUTH_CONFIG, "2120976003053023232", undefined, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "9010",
                text: "Cooking @usesolshield https://t.co/abc",
                author_id: "881776365497753600",
                entities: {
                  urls: [
                    { expanded_url: "https://x.com/Rawonbening_/status/9010/photo/1" },
                    { expanded_url: "https://pic.x.com/abc" },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });
    expect(mentions).toHaveLength(1);
    expect(mentions[0].expandedUrls).toEqual([]);
    expect(resolveMentionTarget(mentions[0], "usesolshield", "2120976003053023232")).toBeNull();

    expect(
      maskCryptoAddresses(
        "Mint 7TdyYXZFQ5d3QUCi9pGWMdZMhJSoedQMejVaLUsTwxf9 and 0x1234567890abcdef1234567890abcdef12345678 lack locks"
      )
    ).toBe("Mint 7TdyYX...wxf9 and 0x1234...5678 lack locks");

    expect(new XApiError("forbidden", 403).isPermanentRejection).toBe(true);
    expect(new XApiError("bad request", 400).isPermanentRejection).toBe(true);
    expect(new XApiError("not found", 404).isPermanentRejection).toBe(true);
    expect(new XApiError("credits", 402).isPermanentRejection).toBe(false);
    expect(new XApiError("rate limit", 429).isPermanentRejection).toBe(false);
    expect(new XApiError("unavailable", 503).isPermanentRejection).toBe(false);
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

  it("supports @usesolshield handle resolution and URL-free low-cost X reply mode", () => {
    const target = resolveMentionTarget(
      {
        id: "3001",
        text: "@usesolshield check https://x.com/usesolshield vs https://github.com/Blanksite/solshield",
        expandedUrls: [
          "https://x.com/usesolshield",
          "https://github.com/Blanksite/solshield",
        ],
        referencedTweets: [],
      },
      "usesolshield"
    );
    expect(target).toBe("https://github.com/Blanksite/solshield");

    const det = buildDeterministicBuildCheck({
      id: "bc_nolink_1",
      createdAt: new Date().toISOString(),
      elapsedMs: 1400,
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
      github: null,
      chain: null,
      domain: null,
      xPost: null,
    });

    const lowCostTweet = formatBuildCheckReplyTweet(
      {
        ...det,
        inferenceMode: "venice-live-api",
        modelsUsed: ["llama-3.3-70b"],
        visionSummary: null,
        privacyAttestation: "Zero Data Retention",
      },
      "https://sol-shield.xyz",
      { includeUrl: false }
    );
    expect(lowCostTweet.length).toBeLessThanOrEqual(280);
    expect(lowCostTweet).not.toContain("https://");
    expect(lowCostTweet).toContain("SolShield x Venice AI");

    const html = buildEvidenceCardHtml(
      {
        ...det,
        inferenceMode: "venice-live-api",
        modelsUsed: ["qwen3-vl-235b-a22b", "llama-3.3-70b"],
        visionSummary: null,
        privacyAttestation: "Zero Data Retention",
      },
      { botHandle: "usesolshield" }
    );
    expect(html).toContain("@usesolshield");
    expect(html).toContain("VENICE AI");
  });

  it("blocks self-mentions, stale historical mentions, cooldown spam, and daily cap overruns", () => {
    const nowMs = Date.parse("2026-11-14T12:00:00.000Z");
    const state = loadBotState(path.join(os.tmpdir(), "nonexistent-solshield-state.json"));
    state.botUserId = "bot_999";

    const selfDecision = evaluateMentionGuard({
      mentionId: "4001",
      authorId: "bot_999",
      createdAt: "2026-11-14T11:59:00.000Z",
      state,
      maxMentionAgeMinutes: 30,
      authorCooldownMs: 90_000,
      maxRepliesPerDay: 5,
      nowMs,
    });
    expect(selfDecision).toEqual({
      allow: false,
      reason: "self_mention",
      recordProcessed: true,
    });

    const staleDecision = evaluateMentionGuard({
      mentionId: "4002",
      authorId: "user_1",
      createdAt: "2026-11-14T10:00:00.000Z",
      state,
      maxMentionAgeMinutes: 30,
      authorCooldownMs: 90_000,
      maxRepliesPerDay: 5,
      nowMs,
    });
    expect(staleDecision).toEqual({
      allow: false,
      reason: "stale_mention",
      recordProcessed: true,
    });

    const validDecision = evaluateMentionGuard({
      mentionId: "4003",
      authorId: "user_2",
      createdAt: "2026-11-14T11:55:00.000Z",
      state,
      maxMentionAgeMinutes: 30,
      authorCooldownMs: 90_000,
      maxRepliesPerDay: 2,
      nowMs,
    });
    expect(validDecision).toEqual({ allow: true });

    recordReplySent(state, nowMs);
    recordReplySent(state, nowMs + 1000);
    expect(getRepliesTodayCount(state, nowMs + 2000)).toBe(2);
    expect(canSendDailyReply(state, 2, nowMs + 2000)).toBe(false);

    const cappedDecision = evaluateMentionGuard({
      mentionId: "4004",
      authorId: "user_3",
      createdAt: "2026-11-14T11:59:30.000Z",
      state,
      maxMentionAgeMinutes: 30,
      authorCooldownMs: 90_000,
      maxRepliesPerDay: 2,
      nowMs: nowMs + 2000,
    });
    expect(cappedDecision).toEqual({
      allow: false,
      reason: "daily_limit_reached",
      recordProcessed: true,
    });

    // Rolls over automatically on the next UTC day
    const nextDayMs = Date.parse("2026-11-15T00:05:00.000Z");
    expect(getRepliesTodayCount(state, nextDayMs)).toBe(0);
    expect(canSendDailyReply(state, 2, nextDayMs)).toBe(true);
  });

  it("uploads PNG evidence via X API v2 /2/media/upload and falls back to v2 chunked upload", async () => {
    const seenUrls: string[] = [];
    const oneShotFetch: typeof fetch = async (input) => {
      seenUrls.push(String(input));
      return new Response(JSON.stringify({ data: { id: "9988776655" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const mediaId = await uploadEvidencePngToX(
      TEST_OAUTH_CONFIG,
      Buffer.from("png-bytes"),
      { fetchImpl: oneShotFetch }
    );
    expect(mediaId).toBe("9988776655");
    expect(seenUrls[0]).toBe("https://api.x.com/2/media/upload");

    const chunkedUrls: string[] = [];
    const chunkedFallbackFetch: typeof fetch = async (input) => {
      const url = String(input);
      chunkedUrls.push(url);
      if (url === "https://api.x.com/2/media/upload") {
        return new Response("unsupported multipart", { status: 415 });
      }
      if (url === "https://api.x.com/2/media/upload/initialize") {
        return new Response(JSON.stringify({ data: { id: "77665544" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "https://api.x.com/2/media/upload/77665544/append") {
        return new Response(null, { status: 204 });
      }
      if (url === "https://api.x.com/2/media/upload/77665544/finalize") {
        return new Response(JSON.stringify({ data: { id: "77665544" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("unexpected", { status: 500 });
    };

    const chunkedId = await uploadEvidencePngToX(
      TEST_OAUTH_CONFIG,
      Buffer.from("png-bytes-chunked"),
      { fetchImpl: chunkedFallbackFetch }
    );
    expect(chunkedId).toBe("77665544");
    expect(chunkedUrls).toEqual([
      "https://api.x.com/2/media/upload",
      "https://api.x.com/2/media/upload/initialize",
      "https://api.x.com/2/media/upload/77665544/append",
      "https://api.x.com/2/media/upload/77665544/finalize",
    ]);
  });

  it("retries transient HTTP 429 rate limits with Retry-After and flags HTTP 402 credit exhaustion", async () => {
    const sleeps: number[] = [];
    let attempt = 0;
    const retry429Fetch: typeof fetch = async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }
      return new Response(JSON.stringify({ data: [{ id: "5001", text: "@usesolshield check" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const mentions = await fetchBotMentions(TEST_OAUTH_CONFIG, "bot_1", null, {
      fetchImpl: retry429Fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(attempt).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(mentions).toHaveLength(1);

    const creditExhaustedFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ title: "CreditsDepleted" }), { status: 402 });

    await expect(
      postReplyTweetOnX(
        TEST_OAUTH_CONFIG,
        { text: "hello", replyToTweetId: "5001" },
        { fetchImpl: creditExhaustedFetch }
      )
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof XApiError &&
        err.isCreditsExhausted === true &&
        err.status === 402
    );
  });

  it("prefers zero-cost OAuth /2/users/me lookup when matching botHandle and falls back cleanly", async () => {
    const meCalls: string[] = [];
    const uid = await fetchBotUserId(TEST_OAUTH_CONFIG, {
      fetchImpl: async (input) => {
        meCalls.push(String(input));
        return new Response(
          JSON.stringify({ data: { id: "2120976003053023232", username: "usesolshield" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });
    expect(uid).toBe("2120976003053023232");
    expect(meCalls).toEqual(["https://api.x.com/2/users/me"]);
  });

  it("maps inReplyToUserId and referencedTweets authorId from fetchBotMentions", async () => {
    let requestedUrl = "";
    const mentions = await fetchBotMentions(TEST_OAUTH_CONFIG, "2120976003053023232", undefined, {
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "9001",
                text: "@usesolshield look sir",
                author_id: "333",
                in_reply_to_user_id: "2120976003053023232",
                referenced_tweets: [{ type: "replied_to", id: "8001" }],
              },
            ],
            includes: {
              tweets: [
                {
                  id: "8001",
                  author_id: "2120976003053023232",
                  text: "SolShield announcement https://sol-shield.xyz",
                },
              ],
              users: [{ id: "333", username: "Encrypt186" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    const parsed = new URL(requestedUrl);
    expect(parsed.searchParams.get("tweet.fields")).toContain("in_reply_to_user_id");
    expect(parsed.searchParams.get("tweet.fields")).toContain("author_id");
    expect(mentions).toHaveLength(1);
    expect(mentions[0].inReplyToUserId).toBe("2120976003053023232");
    expect(mentions[0].referencedTweets[0].authorId).toBe("2120976003053023232");
    expect(
      resolveMentionTarget(mentions[0], "usesolshield", "2120976003053023232")
    ).toBeNull();
  });

  it("includes token name and ticker symbol on both X reply tweets and Evidence Cards", () => {
    const det = buildDeterministicBuildCheck({
      id: "bc_token_meta_1",
      createdAt: new Date().toISOString(),
      elapsedMs: 1800,
      target: {
        rawInput: "F3K9mo611vPLWM19QztPU94w23tU5m6D3hw9h41YYbM2",
        kind: "token_ca",
        mintAddress: "F3K9mo611vPLWM19QztPU94w23tU5m6D3hw9h41YYbM2",
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
        mintAddress: "F3K9mo611vPLWM19QztPU94w23tU5m6D3hw9h41YYbM2",
        tokenReport: {
          mintAddress: "F3K9mo611vPLWM19QztPU94w23tU5m6D3hw9h41YYbM2",
          tokenProgram: "SPL Token",
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          isToken2022: false,
          isPumpFunSuffix: false,
          name: "GTA INU",
          symbol: "GI",
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
          top5Pct: 14.5,
          top10Pct: 21.0,
          riskScore: 10,
          classification: "SAFE",
          recommendedAction: "VERIFIED_SAFE",
          executiveSummary: "Authorities revoked.",
          flags: [],
          slot: 1,
          latencyMs: 120,
          inferenceMode: "deterministic-fallback",
          privacyAttestation: "Zero Data Retention",
        },
        dexPair: null,
        accountRecentTxCount: 10,
      },
      domain: null,
      xPost: null,
    });

    const report = {
      ...det,
      inferenceMode: "venice-live-api" as const,
      modelsUsed: ["llama-3.3-70b"],
      visionSummary: null,
      privacyAttestation: "Zero Data Retention",
    };

    const tweet = formatBuildCheckReplyTweet(report, "https://sol-shield.xyz");
    expect(tweet.length).toBeLessThanOrEqual(280);
    expect(tweet).toContain("GTA INU ($GI)");
    expect(tweet).toContain("F3K9mo...YbM2");

    const html = buildEvidenceCardHtml(report, { botHandle: "usesolshield" });
    expect(html).toContain("GTA INU ($GI)");
    expect(html).toContain("F3K9mo611vPLWM19QztPU94w23tU5m6D3hw9h41YYbM2");
    expect(html).toContain("GREEN FLAGS");
    expect(html).toContain("RED FLAGS &amp; GAPS");
    expect(html).toContain("token-avatar-fallback\">GI</div>");
  });

  it("renders tokenLogoDataUri, sanitizes unsafe URIs, and escapes green/red flags on Evidence Card", () => {
    const det = buildDeterministicBuildCheck({
      id: "bc_token_meta_2",
      createdAt: new Date().toISOString(),
      elapsedMs: 1200,
      target: {
        rawInput: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        kind: "token_ca",
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
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
          name: "TestShield",
          symbol: "SHLD",
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
          top10Pct: 19,
          riskScore: 15,
          classification: "SAFE",
          recommendedAction: "VERIFIED_SAFE",
          executiveSummary: "Authorities revoked.",
          flags: [],
          slot: 1,
          latencyMs: 90,
          inferenceMode: "deterministic-fallback",
          privacyAttestation: "Zero Data Retention",
        },
        dexPair: null,
        accountRecentTxCount: 5,
      },
      domain: null,
      xPost: null,
    });

    const report = {
      ...det,
      inferenceMode: "venice-live-api" as const,
      modelsUsed: ["llama-3.3-70b"],
      visionSummary: null,
      privacyAttestation: "Zero Data Retention",
      verifiedSignals: [
        "Mint & freeze authorities revoked",
        "Liquidity locked > 12 months <script>alert(1)</script>",
      ],
      keyRedFlags: [
        "Dev wallet still holds 8% supply",
        "Unverified marketing claim \"soon\"",
      ],
    };

    const validPngUri = "data:image/png;base64,iVBORw0KGgo=";
    const htmlWithLogo = buildEvidenceCardHtml(report, {
      botHandle: "usesolshield",
      tokenLogoDataUri: validPngUri,
    });
    expect(htmlWithLogo).toContain(`class="token-avatar-img" src="${validPngUri}"`);
    expect(htmlWithLogo).toContain("Mint &amp; freeze authorities revoked");
    expect(htmlWithLogo).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(htmlWithLogo).not.toContain("<script>alert(1)");
    expect(htmlWithLogo).toContain("Dev wallet still holds 8% supply");
    expect(htmlWithLogo).toContain("Unverified marketing claim &quot;soon&quot;");

    const svgUri = "data:image/svg+xml;base64,PHN2Zz4=";
    const htmlRejectedSvg = buildEvidenceCardHtml(report, {
      botHandle: "usesolshield",
      tokenLogoDataUri: svgUri,
    });
    expect(htmlRejectedSvg).not.toContain("image/svg+xml");
    expect(htmlRejectedSvg).toContain("token-avatar-fallback\">SH</div>");

    const htmlEmptyFlags = buildEvidenceCardHtml(
      { ...report, verifiedSignals: [], keyRedFlags: [] },
      { botHandle: "usesolshield" }
    );
    expect(htmlEmptyFlags).toContain("No strong green flags recorded yet");
    expect(htmlEmptyFlags).toContain("No critical red flags detected");
  });

  it("loadTokenLogoDataUri blocks loopback/metadata URLs, rejects SVGs, and encodes safe raster PNGs", async () => {
    expect(await loadTokenLogoDataUri(null)).toBeNull();
    expect(await loadTokenLogoDataUri("http://127.0.0.1/logo.png")).toBeNull();
    expect(await loadTokenLogoDataUri("http://169.254.169.254/latest/meta-data")).toBeNull();

    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<svg></svg>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        })
      )
      .mockResolvedValueOnce(
        new Response(pngHeader, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      );

    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await loadTokenLogoDataUri("https://1.1.1.1/bad.svg")).toBeNull();
      const validDataUri = await loadTokenLogoDataUri("https://1.1.1.1/good.png");
      expect(validDataUri).toBe(`data:image/png;base64,${Buffer.from(pngHeader).toString("base64")}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
