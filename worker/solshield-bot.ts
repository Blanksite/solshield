import path from "node:path";
import { runBuildCheckInvestigation } from "../src/lib/buildcheck/orchestrator";
import {
  isAuthorRateLimited,
  isTweetProcessed,
  loadBotState,
  recordProcessedMention,
  saveBotState,
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
  type XBotAuthConfig,
} from "./x-client";

loadLocalEnvFiles();

function getAuthConfig(): XBotAuthConfig {
  return {
    botHandle: process.env.BOT_X_HANDLE?.trim() || "SolShieldCheck",
    bearerToken: process.env.X_BEARER_TOKEN?.trim() || undefined,
    apiKey: process.env.X_API_KEY?.trim() || undefined,
    apiSecret: process.env.X_API_SECRET?.trim() || undefined,
    accessToken: process.env.X_ACCESS_TOKEN?.trim() || undefined,
    accessSecret: process.env.X_ACCESS_SECRET?.trim() || undefined,
    appPublicUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sol-shield.xyz",
  };
}

async function runSingleCheckCli(rawTarget: string): Promise<void> {
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

  const { filePath } = await renderEvidenceCardPng(report);
  const replyText = formatBuildCheckReplyTweet(
    report,
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sol-shield.xyz"
  );

  console.log("\n=== RESULT ===");
  console.log(`Verdict     : ${report.verdict} (${report.authenticityScore}/100)`);
  console.log(`Inference   : ${report.inferenceMode}`);
  console.log(`PNG Card    : ${filePath}`);
  console.log("X Reply Copy:\n" + "-".repeat(50) + `\n${replyText}\n` + "-".repeat(50));
}

async function runDaemonLoop(): Promise<void> {
  const config = getAuthConfig();
  const isDryRun = process.env.BOT_DRY_RUN !== "false";
  const pollMs = Math.max(
    15_000,
    Number(process.env.BOT_POLL_INTERVAL_MS || "60000") || 60_000
  );
  const stateFile = path.resolve(
    process.cwd(),
    process.env.BOT_STATE_FILE?.trim() || "worker/data/bot-state.json"
  );

  const hasReadCreds = Boolean(
    config.bearerToken ||
      (config.apiKey && config.apiSecret && config.accessToken && config.accessSecret)
  );
  const hasWriteCreds = Boolean(
    config.apiKey && config.apiSecret && config.accessToken && config.accessSecret
  );

  console.log(`[SolShieldCheck Daemon] Handle: @${config.botHandle}`);
  console.log(`[SolShieldCheck Daemon] Mode: ${isDryRun ? "DRY_RUN (no live X posts)" : "LIVE X REPLY"}`);
  console.log(`[SolShieldCheck Daemon] Poll interval: ${pollMs / 1000}s`);
  console.log(`[SolShieldCheck Daemon] State file: ${stateFile}`);

  if (!hasReadCreds) {
    console.error(
      "[SolShieldCheck Daemon] Missing X API read credentials.\n" +
        "Set X_BEARER_TOKEN (and X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET for posting) in .env.\n" +
        "Tip: Test local auditing anytime without X credentials via:\n" +
        '  npm run bot:check -- "https://github.com/Blanksite/solshield"'
    );
    process.exit(1);
  }

  if (!isDryRun && !hasWriteCreds) {
    console.error(
      "[SolShieldCheck Daemon] BOT_DRY_RUN=false requires X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET."
    );
    process.exit(1);
  }

  const state = loadBotState(stateFile);
  if (!state.botUserId) {
    state.botUserId = await fetchBotUserId(config);
    saveBotState(stateFile, state);
  }
  console.log(`[SolShieldCheck Daemon] Authenticated @${config.botHandle} (userId=${state.botUserId})`);

  let stopping = false;
  const shutdown = () => {
    stopping = true;
    console.log("\n[SolShieldCheck Daemon] Gracefully shutting down...");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    try {
      const mentions = await fetchBotMentions(config, state.botUserId, state.lastMentionId);
      if (mentions.length > 0) {
        console.log(`[Poll] Found ${mentions.length} new mention(s).`);
      }

      for (const mention of mentions) {
        if (stopping) break;
        if (isTweetProcessed(state, mention.id)) continue;

        if (isAuthorRateLimited(state, mention.authorId, 90_000)) {
          console.log(`[Skip] Rate-limited author ${mention.authorId} on tweet ${mention.id}`);
          recordProcessedMention(state, mention.id, mention.authorId);
          saveBotState(stateFile, state);
          continue;
        }

        const target = resolveMentionTarget(mention, config.botHandle);
        if (!target) {
          console.log(`[Skip] No resolvable CA/link/parent target on tweet ${mention.id}`);
          recordProcessedMention(state, mention.id, mention.authorId);
          saveBotState(stateFile, state);
          continue;
        }

        console.log(`[Audit] Mention ${mention.id} (@${mention.authorUsername || "user"}) -> ${target}`);
        const report = await runBuildCheckInvestigation(target, {
          apiKey: process.env.VENICE_API_KEY?.trim() || undefined,
          enableBrowser: true,
        });

        const { pngBuffer, filePath } = await renderEvidenceCardPng(report);
        const replyText = formatBuildCheckReplyTweet(report, config.appPublicUrl);

        if (isDryRun) {
          console.log(`[DRY RUN] Card saved at ${filePath}\nReply draft:\n${replyText}`);
        } else {
          const mediaId = await uploadEvidencePngToX(config, pngBuffer);
          const posted = await postReplyTweetOnX(config, {
            text: replyText,
            replyToTweetId: mention.id,
            mediaId,
          });
          console.log(`[POSTED] Reply tweet ${posted.tweetId} (mediaId=${mediaId})`);
        }

        recordProcessedMention(state, mention.id, mention.authorId);
        saveBotState(stateFile, state);
      }
    } catch (err) {
      console.error("[Poll Error]", err instanceof Error ? err.message : err);
    }

    if (!stopping) {
      await new Promise((r) => setTimeout(r, pollMs));
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
