import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildDeterministicBuildCheck } from "../src/lib/buildcheck/venice-buildcheck";
import {
  buildTelegramInlineKeyboard,
  escapeTgHtml,
  extractSolanaMintFromTokenUrl,
  fetchTgBotMe,
  fetchTgUpdates,
  formatTelegramAuditCaption,
  resolveTelegramMessageAction,
  sanitizeTgErrorMessage,
  sendTgEvidencePhoto,
  TgApiError,
  type TgBotConfig,
  type TgMessage,
} from "../worker/tg-client";
import {
  evaluateTgScanGuard,
  getTgScansTodayCount,
  loadTgBotState,
  recordTgScanCompleted,
  recordTgUpdateSeen,
  saveTgBotState,
} from "../worker/tg-state";

const TEST_TG_CONFIG: TgBotConfig = {
  botToken: "123456:ABC-FAKE-SECRET-TOKEN-XYZ",
  botUsername: "SolShieldTgBot",
  appPublicUrl: "https://sol-shield.xyz",
};

function makeSampleTokenReport(overrides?: {
  name?: string;
  symbol?: string;
  headline?: string;
  verifiedSignals?: string[];
  keyRedFlags?: string[];
}) {
  const mint = "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx";
  const det = buildDeterministicBuildCheck({
    id: "bc_tg_test_1",
    createdAt: new Date().toISOString(),
    elapsedMs: 1100,
    target: {
      rawInput: mint,
      kind: "token_ca",
      mintAddress: mint,
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
      mintAddress: mint,
      tokenReport: {
        mintAddress: mint,
        tokenProgram: "SPL Token",
        programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        isToken2022: false,
        isPumpFunSuffix: false,
        name: overrides?.name ?? "SolShield",
        symbol: overrides?.symbol ?? "SHIELD",
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
        top10Pct: 22.8,
        riskScore: 12,
        classification: "SAFE",
        recommendedAction: "VERIFIED_SAFE",
        executiveSummary: "Authorities revoked cleanly.",
        flags: [],
        slot: 1,
        latencyMs: 100,
        inferenceMode: "deterministic-fallback",
        privacyAttestation: "Zero Data Retention",
      },
      dexPair: {
        dexId: "raydium",
        pairAddress: "Pair111111111111111111111111111111111111111",
        pairUrl: `https://dexscreener.com/solana/${mint}`,
        liquidityUsd: 84_500,
        fdv: 420_000,
        volume24hUsd: 190_000,
        pairCreatedAt: null,
        pairAgeHours: null,
        websites: [],
        socials: [],
      },
      accountRecentTxCount: 18,
    },
    domain: null,
    xPost: null,
  });

  return {
    ...det,
    inferenceMode: "venice-live-api" as const,
    modelsUsed: ["llama-3.3-70b"],
    visionSummary: null,
    privacyAttestation: "Zero Data Retention",
    ...(overrides?.headline ? { headline: overrides.headline } : {}),
    ...(overrides?.verifiedSignals ? { verifiedSignals: overrides.verifiedSignals } : {}),
    ...(overrides?.keyRedFlags ? { keyRedFlags: overrides.keyRedFlags } : {}),
  };
}

describe("SolShield Telegram Bot Target Extraction & Routing", () => {
  it("extracts Solana mint addresses from Pump.fun, DexScreener, Solscan, Birdeye, and GMGN links", () => {
    const mint = "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx";
    expect(extractSolanaMintFromTokenUrl(`https://pump.fun/coin/${mint}?tab=trades`)).toBe(mint);
    expect(extractSolanaMintFromTokenUrl(`https://dexscreener.com/solana/${mint}`)).toBe(mint);
    expect(extractSolanaMintFromTokenUrl(`https://solscan.io/token/${mint}`)).toBe(mint);
    expect(extractSolanaMintFromTokenUrl(`https://birdeye.so/token/${mint}?chain=solana`)).toBe(mint);
    expect(extractSolanaMintFromTokenUrl(`https://gmgn.ai/sol/token/${mint}`)).toBe(mint);
    expect(extractSolanaMintFromTokenUrl("https://sol-shield.xyz/buildcheck")).toBeNull();
  });

  it("handles private DM commands, deep links, bare domains, hidden text_links, and prompts on chatter", () => {
    const baseDm: Omit<TgMessage, "message_id" | "date"> = {
      chat: { id: 1001, type: "private" },
      from: { id: 5001, is_bot: false, username: "trader1" },
    };

    expect(
      resolveTelegramMessageAction({ ...baseDm, message_id: 1, date: 1700000000, text: "/start" }, "SolShieldTgBot")
    ).toEqual({ kind: "command", command: "help" });

    expect(
      resolveTelegramMessageAction(
        {
          ...baseDm,
          message_id: 2,
          date: 1700000001,
          text: "/start CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        },
        "SolShieldTgBot"
      )
    ).toEqual({
      kind: "scan",
      target: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    });

    expect(
      resolveTelegramMessageAction({ ...baseDm, message_id: 3, date: 1700000002, text: "/status" }, "SolShieldTgBot")
    ).toEqual({ kind: "command", command: "status" });

    expect(
      resolveTelegramMessageAction(
        { ...baseDm, message_id: 4, date: 1700000003, text: "sol-shield.xyz" },
        "SolShieldTgBot"
      )
    ).toEqual({ kind: "scan", target: "https://sol-shield.xyz/" });

    expect(
      resolveTelegramMessageAction(
        {
          ...baseDm,
          message_id: 5,
          date: 1700000004,
          text: "Inspect this repo please",
          entities: [{ type: "text_link", offset: 13, length: 4, url: "https://github.com/Blanksite/solshield" }],
        },
        "SolShieldTgBot"
      )
    ).toEqual({ kind: "scan", target: "https://github.com/Blanksite/solshield" });

    expect(
      resolveTelegramMessageAction({ ...baseDm, message_id: 6, date: 1700000005, text: "gm ser" }, "SolShieldTgBot")
    ).toEqual({ kind: "prompt_for_target" });
  });

  it("ignores casual group chatter & other bots while supporting @mentions and reply_to_message scans", () => {
    const botId = 999000;
    const baseGroup: Omit<TgMessage, "message_id" | "date"> = {
      chat: { id: -100777, type: "supergroup", title: "Solana Alpha" },
      from: { id: 4242, is_bot: false, username: "alice" },
    };

    // Casual group chat containing a repo link without mentioning or commanding bot -> ignore
    expect(
      resolveTelegramMessageAction(
        {
          ...baseGroup,
          message_id: 10,
          date: 1700000010,
          text: "nice shipping https://github.com/Blanksite/solshield",
        },
        "SolShieldTgBot",
        botId
      )
    ).toEqual({ kind: "ignore", reason: "group_chatter" });

    // Command addressed to another bot -> ignore
    expect(
      resolveTelegramMessageAction(
        {
          ...baseGroup,
          message_id: 11,
          date: 1700000011,
          text: "/scan@OtherBot CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        },
        "SolShieldTgBot",
        botId
      )
    ).toEqual({ kind: "ignore", reason: "other_bot_command" });

    // Explicit /scan reply pointing to a message containing a pump.fun link
    expect(
      resolveTelegramMessageAction(
        {
          ...baseGroup,
          message_id: 12,
          date: 1700000012,
          text: "/scan@SolShieldTgBot",
          reply_to_message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: 888, is_bot: false, username: "caller" },
            message_id: 9,
            date: 1700000009,
            text: "Aped https://pump.fun/coin/CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
          },
        },
        "SolShieldTgBot",
        botId
      )
    ).toEqual({
      kind: "scan",
      target: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
    });

    // Replying under the bot's own previous audit report with banter must NOT re-scan the bot's caption
    expect(
      resolveTelegramMessageAction(
        {
          ...baseGroup,
          message_id: 13,
          date: 1700000013,
          text: "thanks @SolShieldTgBot!",
          reply_to_message: {
            chat: { id: -100777, type: "supergroup" },
            from: { id: botId, is_bot: true, username: "SolShieldTgBot" },
            message_id: 12,
            date: 1700000012,
            caption: "VERIFIED BUILD CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
          },
        },
        "SolShieldTgBot",
        botId
      )
    ).toEqual({ kind: "prompt_for_target" });

    // Direct message from another bot -> ignore
    expect(
      resolveTelegramMessageAction(
        {
          chat: { id: -100777, type: "supergroup" },
          from: { id: 777, is_bot: true, username: "spam_bot" },
          message_id: 14,
          date: 1700000014,
          text: "/scan CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        },
        "SolShieldTgBot",
        botId
      )
    ).toEqual({ kind: "ignore", reason: "from_bot" });
  });
});

describe("SolShield Telegram Caption, Inline Keyboard & Safety Guards", () => {
  it("escapes HTML safely, formats identity + on-chain telemetry + flags, and stays <= 1024 chars", () => {
    const report = makeSampleTokenReport({
      name: "Evil<Tag>&Co",
      symbol: "EVIL",
      headline: "Token audited with <script>alert(1)</script> & long explanation ".repeat(8),
      verifiedSignals: [
        "Mint & freeze authorities revoked",
        "Liquidity > $80K verified on Raydium <tag>".repeat(5),
      ],
      keyRedFlags: [
        "No GitHub repository linked on-chain",
        "Holder concentration watch & short history".repeat(5),
      ],
    });

    const caption = formatTelegramAuditCaption(report, "https://sol-shield.xyz");
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain("Evil&lt;Tag&gt;&amp;Co ($EVIL)");
    expect(caption).toContain("<code>CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx</code>");
    expect(caption).toContain("MC $420.0K");
    expect(caption).toContain("Liq $84.5K");
    expect(caption).toContain("Mint Revoked");
    expect(caption).not.toContain("<script>");
    expect(escapeTgHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");

    const markup = buildTelegramInlineKeyboard(report, "https://sol-shield.xyz");
    expect(markup.inline_keyboard[0].map((b) => b.text)).toEqual([
      "Solscan",
      "DexScreener",
      "🔍 Web Auditor",
    ]);
    const rescanBtn = markup.inline_keyboard[1]?.[0];
    expect(rescanBtn?.callback_data).toBe("rescan:CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");
    expect(Buffer.byteLength(rescanBtn?.callback_data || "", "utf8")).toBeLessThanOrEqual(64);
  });

  it("persists state atomically and enforces allowlist, stale message age, cooldowns, and daily cap", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solshield-tg-state-"));
    const stateFile = path.join(tmpDir, "tg-state.json");

    try {
      const state = loadTgBotState(stateFile);
      const baseNow = Date.UTC(2026, 10, 15, 12, 0, 0);
      const nowSec = Math.floor(baseNow / 1000);

      recordTgUpdateSeen(state, 5001);
      recordTgScanCompleted(state, -1001, 42, baseNow);
      saveTgBotState(stateFile, state);

      const reloaded = loadTgBotState(stateFile);
      expect(reloaded.lastUpdateId).toBe(5001);
      expect(getTgScansTodayCount(reloaded, baseNow)).toBe(1);

      expect(
        evaluateTgScanGuard({
          updateId: 5001,
          chatId: -1001,
          userId: 42,
          messageDateSec: nowSec,
          state: reloaded,
          maxMessageAgeMinutes: 15,
          userCooldownMs: 20_000,
          chatCooldownMs: 4_000,
          maxScansPerDay: 200,
          nowMs: baseNow + 30_000,
        })
      ).toEqual({ allow: false, reason: "already_processed" });

      expect(
        evaluateTgScanGuard({
          updateId: 5002,
          chatId: -9999,
          userId: 43,
          messageDateSec: nowSec,
          state: reloaded,
          allowedChatIds: ["-1001"],
          maxMessageAgeMinutes: 15,
          userCooldownMs: 20_000,
          chatCooldownMs: 4_000,
          maxScansPerDay: 200,
          nowMs: baseNow + 30_000,
        })
      ).toEqual({ allow: false, reason: "chat_not_allowed" });

      expect(
        evaluateTgScanGuard({
          updateId: 5003,
          chatId: -1001,
          userId: 43,
          messageDateSec: nowSec - 40 * 60,
          state: reloaded,
          maxMessageAgeMinutes: 15,
          userCooldownMs: 20_000,
          chatCooldownMs: 4_000,
          maxScansPerDay: 200,
          nowMs: baseNow + 30_000,
        })
      ).toEqual({ allow: false, reason: "stale_message" });

      const userCool = evaluateTgScanGuard({
        updateId: 5004,
        chatId: -2002,
        userId: 42,
        messageDateSec: nowSec,
        state: reloaded,
        maxMessageAgeMinutes: 15,
        userCooldownMs: 20_000,
        chatCooldownMs: 4_000,
        maxScansPerDay: 200,
        nowMs: baseNow + 5_000,
      });
      expect(userCool.allow).toBe(false);
      if (!userCool.allow) {
        expect(userCool.reason).toBe("user_cooldown");
        expect(userCool.retryAfterSec).toBe(15);
      }

      expect(
        evaluateTgScanGuard({
          updateId: 5005,
          chatId: -1001,
          userId: 43,
          messageDateSec: nowSec,
          state: reloaded,
          maxMessageAgeMinutes: 15,
          userCooldownMs: 20_000,
          chatCooldownMs: 4_000,
          maxScansPerDay: 1,
          nowMs: baseNow + 30_000,
        })
      ).toEqual({ allow: false, reason: "daily_limit_reached" });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("redacts bot tokens from errors, retries on 429, and falls back to plain caption on HTML entity errors", async () => {
    expect(
      sanitizeTgErrorMessage(
        "request to https://api.telegram.org/bot123456:ABC-FAKE-SECRET-TOKEN-XYZ/getMe failed",
        TEST_TG_CONFIG.botToken
      )
    ).toBe("request to https://api.telegram.org/bot[REDACTED_TOKEN]/getMe failed");

    const fetchMock = vi
      .fn()
      // getMe -> 429 then 200
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: "Too Many Requests",
            parameters: { retry_after: 1 },
          }),
          { status: 429, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: { id: 999000, is_bot: true, username: "SolShieldTgBot" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      // getUpdates -> 200
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: [{ update_id: 101 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      // sendPhoto -> 400 entity parse error, fallback plain -> 200
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: can't parse entities: Unclosed tag",
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 55, date: 1700000100, chat: { id: 1001, type: "private" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    const transport = {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: sleepSpy,
    };

    const me = await fetchTgBotMe(TEST_TG_CONFIG, transport);
    expect(me.username).toBe("SolShieldTgBot");
    expect(sleepSpy).toHaveBeenCalledWith(1000);

    const updates = await fetchTgUpdates(TEST_TG_CONFIG, 100, 25, transport);
    expect(updates).toEqual([{ update_id: 101 }]);

    const sent = await sendTgEvidencePhoto(
      TEST_TG_CONFIG,
      {
        chatId: 1001,
        pngBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        caption: "<b>Broken <tag</b>",
        replyToMessageId: 1,
      },
      transport
    );
    expect(sent.message_id).toBe(55);

    // Ensure 409 conflicts surface cleanly with token redacted
    const conflictFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 409,
          description: `Conflict for bot ${TEST_TG_CONFIG.botToken}`,
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      )
    );
    await expect(
      fetchTgUpdates(TEST_TG_CONFIG, 102, 25, {
        fetchImpl: conflictFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({
      name: TgApiError.name,
      isConflict: true,
    });
  });
});
