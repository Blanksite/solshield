import path from "node:path";
import { runBuildCheckInvestigation } from "../src/lib/buildcheck/orchestrator";
import {
  parseBooleanEnv,
  parsePositiveIntEnv,
  sleepInterruptible,
  startBotHealthServer,
  syncScannedTokenToWeb,
} from "./bot-shared";
import {
  evaluateMentionGuard,
  getRepliesTodayCount,
  loadBotState,
  recordProcessedMention,
  recordReplySent,
  saveBotState,
  type BotPersistedState,
} from "./bot-state";
import { renderEvidenceCardPng } from "./card-renderer";
import { loadLocalEnvFiles } from "./env-loader";
import {
  fetchBotMentions,
  fetchBotUserId,
  formatBuildCheckReplyTweet,
  postReplyTweetOnX,
  resolveMentionTarget,
  uploadEvidencePngToX,
  XApiError,
  type XBotAuthConfig,
} from "./x-client";

loadLocalEnvFiles();

function getAuthConfig(): XBotAuthConfig {
  return {
    botHandle: (process.env.BOT_X_HANDLE?.trim() || "usesolshield").replace(/^@/, ""),
    bearerToken: process.env.X_BEARER_TOKEN?.trim() || undefined,
    oauth2UserToken: process.env.X_OAUTH2_ACCESS_TOKEN?.trim() || undefined,
    apiKey: process.env.X_API_KEY?.trim() || undefined,
    apiSecret: process.env.X_API_SECRET?.trim() || undefined,
    accessToken: process.env.X_ACCESS_TOKEN?.trim() || undefined,
    accessSecret: process.env.X_ACCESS_SECRET?.trim() || undefined,
    appPublicUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sol-shield.xyz",
    includeReplyUrl: parseBooleanEnv(process.env.BOT_INCLUDE_REPLY_URL, true),
  };
}

function startHealthServer(
  port: number,
  readStatus: () => {
    botHandle: string;
    dryRun: boolean;
    state: BotPersistedState;
    maxRepliesPerDay: number;
  }
) {
  return startBotHealthServer({
    port,
    logPrefix: "[SolShield X Bot]",
    getStatusPayload: () => {
      const snap = readStatus();
      return {
        ok: true,
        service: "solshield-x-bot",
        botHandle: `@${snap.botHandle}`,
        dryRun: snap.dryRun,
        repliesTodayCount: getRepliesTodayCount(snap.state),
        maxRepliesPerDay: snap.maxRepliesPerDay,
        lastPollAt: snap.state.lastPollAt || null,
        lastReplyAt: snap.state.lastReplyAt || null,
        lastError: snap.state.lastError || null,
      };
    },
  });
}

async function runSingleCheckCli(rawTarget: string): Promise<void> {
  const config = getAuthConfig();
  const syncEnabled = parseBooleanEnv(process.env.BOT_SYNC_TO_WEB, false);
  console.log(`[BuildCheck Bot CLI] Auditing target: ${rawTarget}`);
  const report = await runBuildCheckInvestigation(rawTarget, {
    apiKey: process.env.VENICE_API_KEY?.trim() || undefined,
    enableBrowser: true,
    onEvent: (ev) => {
      if (ev.type === "step") {
        console.log(`  [+${(ev.elapsedMs / 1000).toFixed(1)}s] ${ev.title} — ${ev.detail}`);
      } else if (ev.type === "collector") {
        console.log(`  [Collector:${ev.collector}] (${ev.status}) ${ev.summary}`);
      }
    },
  });

  await syncScannedTokenToWeb(report, config.appPublicUrl, syncEnabled);

  const { filePath } = await renderEvidenceCardPng(report, undefined, {
    botHandle: config.botHandle,
    appPublicUrl: config.appPublicUrl,
  });
  const replyText = formatBuildCheckReplyTweet(report, config.appPublicUrl, {
    includeUrl: config.includeReplyUrl,
  });

  console.log("\n=== RESULT ===");
  console.log(`Handle      : @${config.botHandle}`);
  console.log(`Verdict     : ${report.verdict} (${report.authenticityScore}/100)`);
  console.log(`Inference   : ${report.inferenceMode}`);
  console.log(`URL in text : ${config.includeReplyUrl !== false}`);
  console.log(`PNG Card    : ${filePath}`);
  console.log("X Reply Copy:\n" + "-".repeat(50) + `\n${replyText}\n` + "-".repeat(50));
}

async function runDaemonLoop(): Promise<void> {
  const config = getAuthConfig();
  const isDryRun = parseBooleanEnv(process.env.BOT_DRY_RUN, true);
  const pollMs = Math.max(
    15_000,
    parsePositiveIntEnv(process.env.BOT_POLL_INTERVAL_MS, 60_000, 15_000)
  );
  const maxMentionAgeMinutes = parsePositiveIntEnv(
    process.env.BOT_MAX_MENTION_AGE_MINUTES,
    30,
    0
  );
  const authorCooldownMs = parsePositiveIntEnv(
    process.env.BOT_AUTHOR_COOLDOWN_MS,
    90_000,
    0
  );
  const maxRepliesPerDay = parsePositiveIntEnv(
    process.env.BOT_MAX_REPLIES_PER_DAY,
    40,
    0
  );
  const healthPort = parsePositiveIntEnv(
    process.env.BOT_HEALTH_PORT || process.env.PORT,
    0,
    0
  );
  const stateFile = path.resolve(
    process.cwd(),
    process.env.BOT_STATE_FILE?.trim() || "worker/data/bot-state.json"
  );

  const hasOAuth1 = Boolean(
    config.apiKey && config.apiSecret && config.accessToken && config.accessSecret
  );
  const hasReadCreds = Boolean(
    config.bearerToken || config.oauth2UserToken || hasOAuth1
  );
  const hasWriteCreds = Boolean(hasOAuth1 || config.oauth2UserToken);

  console.log(`[SolShield X Bot] Handle: @${config.botHandle}`);
  console.log(`[SolShield X Bot] Mode: ${isDryRun ? "DRY_RUN (no live X posts)" : "LIVE X REPLY"}`);
  console.log(`[SolShield X Bot] Poll interval: ${pollMs / 1000}s`);
  console.log(
    `[SolShield X Bot] Guards: maxAge=${maxMentionAgeMinutes}m · cooldown=${authorCooldownMs / 1000}s · dailyCap=${maxRepliesPerDay || "unlimited"} · urlInText=${config.includeReplyUrl !== false}`
  );
  console.log(`[SolShield X Bot] State file: ${stateFile}`);

  if (!hasReadCreds) {
    console.error(
      "[SolShield X Bot] Missing X API read credentials.\n" +
        "Set X_BEARER_TOKEN (or X_OAUTH2_ACCESS_TOKEN / X OAuth 1.0a keys) in .env.\n" +
        "Tip: Test local auditing anytime without X credentials via:\n" +
        '  npm run bot:check -- "https://github.com/Blanksite/solshield"'
    );
    process.exit(1);
  }

  if (!isDryRun && !hasWriteCreds) {
    console.error(
      "[SolShield X Bot] BOT_DRY_RUN=false requires X OAuth 1.0a keys or X_OAUTH2_ACCESS_TOKEN (with tweet.write + media.write)."
    );
    process.exit(1);
  }

  const state = loadBotState(stateFile);
  if (!state.botUserId) {
    state.botUserId = await fetchBotUserId(config);
    saveBotState(stateFile, state);
  }
  console.log(`[SolShield X Bot] Authenticated @${config.botHandle} (userId=${state.botUserId})`);

  const healthServer =
    healthPort > 0
      ? startHealthServer(healthPort, () => ({
          botHandle: config.botHandle,
          dryRun: isDryRun,
          state,
          maxRepliesPerDay,
        }))
      : null;

  let stopping = false;
  const shutdownController = new AbortController();
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    shutdownController.abort();
    console.log("\n[SolShield X Bot] Gracefully shutting down...");
    healthServer?.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    let nextSleepMs = pollMs;

    try {
      state.lastPollAt = new Date().toISOString();
      const mentions = await fetchBotMentions(config, state.botUserId, state.lastMentionId);
      state.lastError = null;
      saveBotState(stateFile, state);

      if (mentions.length > 0) {
        console.log(`[Poll] Found ${mentions.length} new mention(s).`);
      }

      for (const mention of mentions) {
        if (stopping) break;

        const guard = evaluateMentionGuard({
          mentionId: mention.id,
          authorId: mention.authorId,
          createdAt: mention.createdAt,
          state,
          maxMentionAgeMinutes,
          authorCooldownMs,
          maxRepliesPerDay,
        });

        if (!guard.allow) {
          if (guard.reason !== "already_processed") {
            console.log(`[Skip:${guard.reason}] tweet ${mention.id} (author=${mention.authorId || "unknown"})`);
          }
          if (guard.recordProcessed) {
            recordProcessedMention(state, mention.id);
            saveBotState(stateFile, state);
          }
          continue;
        }

        const target = resolveMentionTarget(mention, config.botHandle, state.botUserId);
        if (!target) {
          console.log(`[Skip:no_target] No resolvable CA/link/parent target on tweet ${mention.id}`);
          recordProcessedMention(state, mention.id);
          saveBotState(stateFile, state);
          continue;
        }

        console.log(`[Audit] Mention ${mention.id} (@${mention.authorUsername || "user"}) -> ${target}`);
        const report = await runBuildCheckInvestigation(target, {
          apiKey: process.env.VENICE_API_KEY?.trim() || undefined,
          enableBrowser: true,
        });

        const { pngBuffer, filePath } = await renderEvidenceCardPng(report, undefined, {
          botHandle: config.botHandle,
          appPublicUrl: config.appPublicUrl,
        });
        const replyText = formatBuildCheckReplyTweet(report, config.appPublicUrl, {
          includeUrl: config.includeReplyUrl,
        });
        const syncEnabled = parseBooleanEnv(process.env.BOT_SYNC_TO_WEB, !isDryRun);

        await syncScannedTokenToWeb(report, config.appPublicUrl, syncEnabled);

        if (isDryRun) {
          console.log(`[DRY RUN] Card saved at ${filePath}\nReply draft:\n${replyText}`);
        } else {
          let mediaId: string | undefined;
          try {
            mediaId = await uploadEvidencePngToX(config, pngBuffer);
          } catch (mediaErr) {
            console.warn(
              `[Media Warn] Falling back to text-only reply on tweet ${mention.id}:`,
              mediaErr instanceof Error ? mediaErr.message : mediaErr
            );
          }

          const posted = await postReplyTweetOnX(config, {
            text: replyText,
            replyToTweetId: mention.id,
            mediaId,
          });
          recordReplySent(state);
          console.log(
            `[POSTED] Reply tweet ${posted.tweetId} (${mediaId ? `mediaId=${mediaId}` : "text-only"})`
          );
        }

        recordProcessedMention(state, mention.id, mention.authorId);
        saveBotState(stateFile, state);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.lastError = msg.slice(0, 200);
      saveBotState(stateFile, state);

      if (err instanceof XApiError) {
        if (err.isCreditsExhausted) {
          nextSleepMs = Math.max(pollMs, 15 * 60_000);
          console.error(
            `[Poll Error] X API prepaid credits exhausted (HTTP 402). Pausing ${Math.round(
              nextSleepMs / 60_000
            )}m: ${msg}`
          );
        } else if (err.isRateLimit) {
          const resetMs = err.retryAfterSec ? err.retryAfterSec * 1000 : pollMs * 2;
          nextSleepMs = Math.min(15 * 60_000, Math.max(pollMs, resetMs));
          console.warn(
            `[Poll Rate-Limit] HTTP 429 — sleeping ${Math.round(nextSleepMs / 1000)}s before next poll.`
          );
        } else {
          console.error("[Poll X API Error]", msg);
        }
      } else {
        console.error("[Poll Error]", msg);
      }
    }

    if (!stopping) {
      await sleepInterruptible(nextSleepMs, shutdownController.signal);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkIdx = args.indexOf("--check");
  if (checkIdx !== -1) {
    const target = args.slice(checkIdx + 1).join(" ").trim();
    if (!target) {
      console.error('Usage: npm run bot:check -- "<Mint CA | X URL | GitHub repo | website>"');
      process.exit(1);
    }
    await runSingleCheckCli(target);
    return;
  }

  await runDaemonLoop();
}

main().catch((err) => {
  console.error("[SolShield Bot Fatal]", err);
  process.exit(1);
});
