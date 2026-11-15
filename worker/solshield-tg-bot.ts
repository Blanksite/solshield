import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runBuildCheckInvestigation } from "../src/lib/buildcheck/orchestrator";
import { formatTelegramProofDispatchHtml } from "../src/lib/buildcheck/proof-dispatch";
import {
  parseBooleanEnv,
  parsePositiveIntEnv,
  sleepInterruptible,
  startBotHealthServer,
  syncBuildCheckReportToWeb,
  syncScannedTokenToWeb,
} from "./bot-shared";
import { renderEvidenceCardPng } from "./card-renderer";
import { loadLocalEnvFiles } from "./env-loader";
import {
  answerTgCallbackQuery,
  buildTelegramInlineKeyboard,
  deleteTgMessage,
  deleteTgWebhook,
  escapeTgHtml,
  fetchTgBotMe,
  fetchTgUpdates,
  formatTelegramAuditCaption,
  formatTelegramHelpText,
  resolveTelegramMessageAction,
  sanitizeTgErrorMessage,
  sendTgChatAction,
  sendTgEvidencePhoto,
  sendTgTextMessage,
  setTgCommands,
  TgApiError,
  type TgBotConfig,
  type TgMessage,
  type TgUpdate,
} from "./tg-client";
import {
  evaluateTgScanGuard,
  getTgScansTodayCount,
  loadTgBotState,
  recordTgScanCompleted,
  recordTgUpdateSeen,
  saveTgBotState,
  type TgBotPersistedState,
} from "./tg-state";

loadLocalEnvFiles();

const MAX_CALLBACK_HASH_CACHE = 500;
const callbackTargetByHash = new Map<string, string>();

function registerCallbackTarget(target: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(target)
    .digest("hex")
    .slice(0, 16);
  if (callbackTargetByHash.size >= MAX_CALLBACK_HASH_CACHE) {
    const oldestKey = callbackTargetByHash.keys().next().value;
    if (oldestKey) callbackTargetByHash.delete(oldestKey);
  }
  callbackTargetByHash.set(hash, target);
  return hash;
}

function resolveCallbackRescanTarget(data: string): string | null {
  if (data.startsWith("rescan:")) {
    const raw = data.slice("rescan:".length).trim();
    return raw.length >= 32 && raw.length <= 44 ? raw : null;
  }
  if (data.startsWith("rescan_h:")) {
    const hash = data.slice("rescan_h:".length).trim();
    return callbackTargetByHash.get(hash) ?? null;
  }
  return null;
}

function getTgRuntimeConfig(): {
  botToken: string;
  botHandleFallback: string;
  appPublicUrl: string;
} {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
    botHandleFallback: (
      process.env.TG_BOT_HANDLE?.trim() ||
      process.env.BOT_X_HANDLE?.trim() ||
      "usesolshield"
    ).replace(/^@/, ""),
    appPublicUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sol-shield.xyz",
  };
}

function parseAllowedChatIds(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runSingleCheckCli(rawTarget: string): Promise<void> {
  const { botHandleFallback, appPublicUrl } = getTgRuntimeConfig();
  const syncEnabled = parseBooleanEnv(process.env.BOT_SYNC_TO_WEB, false);
  console.log(`[SolShield TG Bot CLI] Auditing target: ${rawTarget}`);

  const report = await runBuildCheckInvestigation(rawTarget, {
    apiKey: process.env.VENICE_API_KEY?.trim() || undefined,
    enableBrowser: true,
    onEvent: (ev) => {
      if (ev.type === "step") {
        console.log(
          `  [+${(ev.elapsedMs / 1000).toFixed(1)}s] ${ev.title} — ${ev.detail}`
        );
      } else if (ev.type === "collector") {
        console.log(
          `  [Collector:${ev.collector}] (${ev.status}) ${ev.summary}`
        );
      }
    },
  });

  await Promise.all([
    syncScannedTokenToWeb(report, appPublicUrl, syncEnabled),
    syncBuildCheckReportToWeb(report, appPublicUrl, syncEnabled),
  ]);

  const { filePath } = await renderEvidenceCardPng(report, undefined, {
    botHandle: botHandleFallback,
    appPublicUrl,
  });
  const callbackHash = report.target.mintAddress
    ? undefined
    : registerCallbackTarget(report.target.normalizedUrl || rawTarget);
  const caption = formatTelegramAuditCaption(report, appPublicUrl);
  const dispatchHtml = formatTelegramProofDispatchHtml(report, appPublicUrl);
  const keyboard = buildTelegramInlineKeyboard(report, appPublicUrl, callbackHash);

  console.log("\n=== TELEGRAM RESULT ===");
  console.log(`Verdict        : ${report.verdict} (${report.authenticityScore}/100)`);
  console.log(`Inference      : ${report.inferenceMode}`);
  console.log(`PNG Card       : ${filePath}`);
  console.log(`Caption Length : ${caption.length}/1024 chars`);
  console.log("Telegram HTML Caption:\n" + "-".repeat(50) + `\n${caption}\n` + "-".repeat(50));
  console.log("Telegram Proof Dispatch Follow-up:\n" + "-".repeat(50) + `\n${dispatchHtml}\n` + "-".repeat(50));
  console.log("Inline Keyboard:\n" + JSON.stringify(keyboard, null, 2));
}

async function executeScanAndReply(params: {
  config: TgBotConfig;
  state: TgBotPersistedState;
  stateFile: string;
  chatId: number;
  userId?: number;
  replyToMessageId?: number;
  target: string;
  forceRefresh: boolean;
  syncEnabled: boolean;
  inFlightChats: Set<string>;
}): Promise<void> {
  const chatKey = String(params.chatId);
  if (params.inFlightChats.has(chatKey)) {
    await sendTgTextMessage(params.config, {
      chatId: params.chatId,
      replyToMessageId: params.replyToMessageId,
      text: "⏳ An audit is already running in this chat — please wait for it to finish.",
    }).catch(() => {});
    return;
  }

  params.inFlightChats.add(chatKey);
  let statusMsg: TgMessage | null = null;
  let renderedFilePath: string | null = null;

  try {
    await sendTgChatAction(params.config, params.chatId, "typing").catch(() => {});
    const safeTargetPreview = escapeTgHtml(
      params.target.length > 56 ? `${params.target.slice(0, 53)}...` : params.target
    );
    statusMsg = await sendTgTextMessage(params.config, {
      chatId: params.chatId,
      replyToMessageId: params.replyToMessageId,
      parseMode: "HTML",
      disableWebPagePreview: true,
      text: `🔍 <b>SolShield BuildCheck</b> auditing <code>${safeTargetPreview}</code>...\n<i>Running on-chain, DEX, GitHub &amp; live browser checks...</i>`,
    }).catch(() => null);

    const report = await runBuildCheckInvestigation(params.target, {
      apiKey: process.env.VENICE_API_KEY?.trim() || undefined,
      enableBrowser: true,
      forceRefresh: params.forceRefresh,
    });

    await Promise.all([
      syncScannedTokenToWeb(
        report,
        params.config.appPublicUrl,
        params.syncEnabled
      ),
      syncBuildCheckReportToWeb(
        report,
        params.config.appPublicUrl,
        params.syncEnabled
      ),
    ]);

    await sendTgChatAction(params.config, params.chatId, "upload_photo").catch(
      () => {}
    );

    const rendered = await renderEvidenceCardPng(report, undefined, {
      botHandle: params.config.botUsername || "usesolshield",
      appPublicUrl: params.config.appPublicUrl,
    });
    renderedFilePath = rendered.filePath;

    const callbackHash = report.target.mintAddress
      ? undefined
      : registerCallbackTarget(params.target);
    const caption = formatTelegramAuditCaption(report, params.config.appPublicUrl);
    const replyMarkup = buildTelegramInlineKeyboard(
      report,
      params.config.appPublicUrl,
      callbackHash
    );

    const sentPhoto = await sendTgEvidencePhoto(params.config, {
      chatId: params.chatId,
      pngBuffer: rendered.pngBuffer,
      caption,
      replyToMessageId: params.replyToMessageId,
      replyMarkup,
    });

    if (parseBooleanEnv(process.env.TG_SEND_DISPATCH_STORY, true)) {
      const dispatchHtml = formatTelegramProofDispatchHtml(
        report,
        params.config.appPublicUrl
      );
      await sendTgTextMessage(params.config, {
        chatId: params.chatId,
        replyToMessageId: sentPhoto?.message_id || params.replyToMessageId,
        parseMode: "HTML",
        disableWebPagePreview: true,
        text: dispatchHtml,
      }).catch((dispatchErr) => {
        console.warn(
          "[TG Dispatch Warn] Follow-up Proof Dispatch message skipped:",
          dispatchErr instanceof Error ? dispatchErr.message : dispatchErr
        );
      });
    }

    recordTgScanCompleted(params.state, params.chatId, params.userId);
    saveTgBotState(params.stateFile, params.state);
    console.log(
      `[TG POSTED] chat=${params.chatId} verdict=${report.verdict} (${report.authenticityScore}/100) target=${params.target}`
    );
  } catch (err) {
    const cleanErr = sanitizeTgErrorMessage(
      err instanceof Error ? err.message : String(err),
      params.config.botToken
    );
    console.error(`[TG Scan Error] chat=${params.chatId} target=${params.target}:`, cleanErr);
    await sendTgTextMessage(params.config, {
      chatId: params.chatId,
      replyToMessageId: params.replyToMessageId,
      parseMode: "HTML",
      disableWebPagePreview: true,
      text: `❌ Could not audit target:\n<code>${escapeTgHtml(cleanErr.slice(0, 260))}</code>`,
    }).catch(() => {});
  } finally {
    if (statusMsg) {
      await deleteTgMessage(params.config, params.chatId, statusMsg.message_id);
    }
    if (renderedFilePath) {
      try {
        fs.unlinkSync(renderedFilePath);
      } catch {
        // Ignore cleanup failure
      }
    }
    params.inFlightChats.delete(chatKey);
  }
}

async function runDaemonLoop(): Promise<void> {
  const { botToken, appPublicUrl } = getTgRuntimeConfig();
  if (!botToken) {
    console.error(
      "[SolShield TG Bot] Missing TELEGRAM_BOT_TOKEN.\n" +
        "1. Create a bot via @BotFather on Telegram and copy the token.\n" +
        "2. Set TELEGRAM_BOT_TOKEN=<token> in .env or Railway service variables.\n" +
        "Tip: Test local Telegram card + caption formatting without a token via:\n" +
        '  npm run bot:tg:check -- "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx"'
    );
    process.exit(1);
  }

  const pollTimeoutSec = Math.min(
    50,
    Math.max(5, parsePositiveIntEnv(process.env.TG_POLL_TIMEOUT_SEC, 25, 5))
  );
  const maxMessageAgeMinutes = parsePositiveIntEnv(
    process.env.TG_MAX_MESSAGE_AGE_MINUTES,
    15,
    0
  );
  const userCooldownMs = parsePositiveIntEnv(
    process.env.TG_USER_COOLDOWN_MS,
    20_000,
    0
  );
  const chatCooldownMs = parsePositiveIntEnv(
    process.env.TG_CHAT_COOLDOWN_MS,
    4_000,
    0
  );
  const maxScansPerDay = parsePositiveIntEnv(
    process.env.TG_MAX_SCANS_PER_DAY,
    200,
    0
  );
  const dropPendingOnStart = parseBooleanEnv(
    process.env.TG_DROP_PENDING_ON_START,
    false
  );
  const syncEnabled = parseBooleanEnv(process.env.BOT_SYNC_TO_WEB, true);
  const allowedChatIds = parseAllowedChatIds(process.env.TG_ALLOWED_CHAT_IDS);
  const healthPort = parsePositiveIntEnv(
    process.env.TG_HEALTH_PORT || process.env.PORT,
    0,
    0
  );
  const stateFile = path.resolve(
    process.cwd(),
    process.env.TG_BOT_STATE_FILE?.trim() || "worker/data/tg-bot-state.json"
  );

  const state = loadTgBotState(stateFile);
  const config: TgBotConfig = {
    botToken,
    botUsername: state.botUsername || undefined,
    appPublicUrl,
  };

  await deleteTgWebhook(config, dropPendingOnStart);
  const me = await fetchTgBotMe(config);
  config.botUsername = me.username || state.botUsername || "usesolshield_bot";
  state.botId = me.id;
  state.botUsername = config.botUsername;
  saveTgBotState(stateFile, state);

  await setTgCommands(config).catch((err) => {
    console.warn(
      "[SolShield TG Bot] Could not set Telegram command menu:",
      err instanceof Error ? err.message : err
    );
  });

  console.log(`[SolShield TG Bot] Authenticated @${config.botUsername} (id=${me.id})`);
  console.log(
    `[SolShield TG Bot] Polling timeout=${pollTimeoutSec}s · userCooldown=${userCooldownMs / 1000}s · chatCooldown=${chatCooldownMs / 1000}s · dailyCap=${maxScansPerDay || "unlimited"}`
  );
  console.log(`[SolShield TG Bot] State file: ${stateFile}`);
  if (allowedChatIds.length > 0) {
    console.log(
      `[SolShield TG Bot] Chat allowlist active (${allowedChatIds.length} chat ID(s))`
    );
  }

  const healthServer =
    healthPort > 0
      ? startBotHealthServer({
          port: healthPort,
          logPrefix: "[SolShield TG Bot]",
          getStatusPayload: () => ({
            ok: true,
            service: "solshield-telegram-bot",
            botUsername: `@${config.botUsername || "unknown"}`,
            scansTodayCount: getTgScansTodayCount(state),
            maxScansPerDay,
            lastUpdateId: state.lastUpdateId,
            lastPollAt: state.lastPollAt || null,
            lastReplyAt: state.lastReplyAt || null,
            lastError: state.lastError || null,
          }),
        })
      : null;

  let stopping = false;
  const shutdownController = new AbortController();
  const inFlightChats = new Set<string>();
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    shutdownController.abort();
    console.log("\n[SolShield TG Bot] Gracefully shutting down...");
    healthServer?.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    let errorSleepMs = 0;
    try {
      state.lastPollAt = new Date().toISOString();
      const offset =
        state.lastUpdateId !== null ? state.lastUpdateId + 1 : undefined;
      const updates: TgUpdate[] = await fetchTgUpdates(
        config,
        offset,
        pollTimeoutSec,
        { signal: shutdownController.signal }
      );
      state.lastError = null;
      saveTgBotState(stateFile, state);

      for (const update of updates) {
        if (stopping) break;
        if (state.processedUpdateIds.includes(update.update_id)) {
          continue;
        }

        recordTgUpdateSeen(state, update.update_id);
        saveTgBotState(stateFile, state);

        if (update.callback_query) {
          const cb = update.callback_query;
          const cbMsg = cb.message;
          const rescanTarget = cb.data
            ? resolveCallbackRescanTarget(cb.data)
            : null;
          if (!cbMsg || !rescanTarget) {
            await answerTgCallbackQuery(
              config,
              cb.id,
              "Target expired — please run /scan again."
            ).catch(() => {});
            continue;
          }

          const guard = evaluateTgScanGuard({
            updateId: -1, // Already tracked via recordTgUpdateSeen above
            chatId: cbMsg.chat.id,
            userId: cb.from.id,
            messageDateSec: Math.floor(Date.now() / 1000),
            state,
            allowedChatIds,
            maxMessageAgeMinutes: 0,
            userCooldownMs,
            chatCooldownMs,
            maxScansPerDay,
          });

          if (!guard.allow) {
            const msgText =
              guard.reason === "daily_limit_reached"
                ? "Daily scan cap reached. Try again after UTC midnight."
                : guard.reason === "chat_not_allowed"
                  ? "This chat is not allowlisted."
                  : `Please wait ${guard.retryAfterSec ?? 10}s before re-scanning.`;
            await answerTgCallbackQuery(config, cb.id, msgText, true).catch(
              () => {}
            );
            continue;
          }

          await answerTgCallbackQuery(config, cb.id, "🔄 Running live re-scan...").catch(
            () => {}
          );

          await executeScanAndReply({
            config,
            state,
            stateFile,
            chatId: cbMsg.chat.id,
            userId: cb.from.id,
            replyToMessageId: cbMsg.message_id,
            target: rescanTarget,
            forceRefresh: true,
            syncEnabled,
            inFlightChats,
          });
          continue;
        }

        const msg = update.message;
        if (!msg) continue;

        if (
          allowedChatIds.length > 0 &&
          !allowedChatIds.includes(String(msg.chat.id))
        ) {
          continue;
        }

        const action = resolveTelegramMessageAction(
          msg,
          config.botUsername,
          state.botId ?? undefined
        );

        if (action.kind === "ignore") continue;

        if (action.kind === "command") {
          const replyText =
            action.command === "status"
              ? [
                  `🛡 <b>SolShield BuildCheck Bot</b> (<code>@${escapeTgHtml(config.botUsername || "solshield")}</code>)`,
                  `• Status: <b>Online</b>`,
                  `• Venice AI: <b>${process.env.VENICE_API_KEY?.trim() ? "Zero-Retention Live" : "Deterministic Mode"}</b>`,
                  `• Scans Today: <b>${getTgScansTodayCount(state)}</b>${maxScansPerDay > 0 ? ` / ${maxScansPerDay}` : ""}`,
                  `• Web Auditor: ${escapeTgHtml(appPublicUrl)}/buildcheck`,
                ].join("\n")
              : formatTelegramHelpText(config.botUsername);
          await sendTgTextMessage(config, {
            chatId: msg.chat.id,
            replyToMessageId: msg.message_id,
            parseMode: "HTML",
            disableWebPagePreview: true,
            text: replyText,
          }).catch(() => {});
          continue;
        }

        if (action.kind === "prompt_for_target") {
          await sendTgTextMessage(config, {
            chatId: msg.chat.id,
            replyToMessageId: msg.message_id,
            parseMode: "HTML",
            disableWebPagePreview: true,
            text:
              "Paste a <b>Solana token CA</b>, <b>Pump.fun / DexScreener link</b>, <b>GitHub repo</b>, <b>website</b>, or <b>X post URL</b> to audit.\nExample: <code>/scan CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx</code>",
          }).catch(() => {});
          continue;
        }

        const guard = evaluateTgScanGuard({
          updateId: -1, // Already recorded above to avoid poison-pill retry loops
          chatId: msg.chat.id,
          userId: msg.from?.id,
          messageDateSec: msg.date,
          state,
          allowedChatIds,
          maxMessageAgeMinutes,
          userCooldownMs,
          chatCooldownMs,
          maxScansPerDay,
        });

        if (!guard.allow) {
          if (
            guard.reason === "user_cooldown" ||
            guard.reason === "chat_cooldown"
          ) {
            await sendTgTextMessage(config, {
              chatId: msg.chat.id,
              replyToMessageId: msg.message_id,
              text: `⏳ Cooldown active — please wait ${guard.retryAfterSec ?? 10}s before running another audit.`,
            }).catch(() => {});
          } else if (guard.reason === "daily_limit_reached") {
            await sendTgTextMessage(config, {
              chatId: msg.chat.id,
              replyToMessageId: msg.message_id,
              text: "⚠️ Daily scan budget reached. Audits reset at 00:00 UTC.",
            }).catch(() => {});
          } else {
            console.log(
              `[TG Skip:${guard.reason}] chat=${msg.chat.id} msg=${msg.message_id}`
            );
          }
          continue;
        }

        await executeScanAndReply({
          config,
          state,
          stateFile,
          chatId: msg.chat.id,
          userId: msg.from?.id,
          replyToMessageId: msg.message_id,
          target: action.target,
          forceRefresh: Boolean(action.forceRefresh),
          syncEnabled,
          inFlightChats,
        });
      }
    } catch (err) {
      if (stopping || shutdownController.signal.aborted) {
        break;
      }
      const msg = sanitizeTgErrorMessage(
        err instanceof Error ? err.message : String(err),
        botToken
      );
      state.lastError = msg.slice(0, 200);
      saveTgBotState(stateFile, state);

      if (err instanceof TgApiError && err.isConflict) {
        errorSleepMs = 15_000;
        console.error(
          "[TG Poll Conflict 409] Another poller or webhook is active for this token. Sleeping 15s..."
        );
      } else if (err instanceof TgApiError && err.isRateLimit) {
        errorSleepMs = Math.min(
          60_000,
          Math.max(5_000, (err.retryAfterSec ?? 10) * 1000)
        );
        console.warn(
          `[TG Rate Limit 429] Sleeping ${Math.round(errorSleepMs / 1000)}s...`
        );
      } else {
        errorSleepMs = 5_000;
        console.error("[TG Poll Error]", msg);
      }
    }

    if (!stopping && errorSleepMs > 0) {
      await sleepInterruptible(errorSleepMs, shutdownController.signal);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkIdx = args.indexOf("--check");
  if (checkIdx !== -1) {
    const target = args.slice(checkIdx + 1).join(" ").trim();
    if (!target) {
      console.error(
        'Usage: npm run bot:tg:check -- "<Mint CA | Pump.fun/DexScreener URL | GitHub repo | X URL | website>"'
      );
      process.exit(1);
    }
    await runSingleCheckCli(target);
    return;
  }

  await runDaemonLoop();
}

main().catch((err) => {
  console.error("[SolShield TG Bot Fatal]", sanitizeTgErrorMessage(String(err)));
  process.exit(1);
});
