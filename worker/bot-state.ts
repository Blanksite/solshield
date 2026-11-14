import fs from "node:fs";
import path from "node:path";

export interface BotPersistedState {
  botUserId: string | null;
  lastMentionId: string | null;
  processedTweetIds: string[];
  authorLastRunAt: Record<string, number>;
}

const DEFAULT_STATE: BotPersistedState = {
  botUserId: null,
  lastMentionId: null,
  processedTweetIds: [],
  authorLastRunAt: {},
};

const MAX_TRACKED_TWEETS = 500;

export function loadBotState(stateFilePath: string): BotPersistedState {
  try {
    if (!fs.existsSync(stateFilePath)) {
      return { ...DEFAULT_STATE, processedTweetIds: [], authorLastRunAt: {} };
    }
    const raw = fs.readFileSync(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BotPersistedState>;
    return {
      botUserId: typeof parsed.botUserId === "string" ? parsed.botUserId : null,
      lastMentionId:
        typeof parsed.lastMentionId === "string" ? parsed.lastMentionId : null,
      processedTweetIds: Array.isArray(parsed.processedTweetIds)
        ? parsed.processedTweetIds.slice(-MAX_TRACKED_TWEETS)
        : [],
      authorLastRunAt:
        parsed.authorLastRunAt && typeof parsed.authorLastRunAt === "object"
          ? parsed.authorLastRunAt
          : {},
    };
  } catch {
    return { ...DEFAULT_STATE, processedTweetIds: [], authorLastRunAt: {} };
  }
}

export function saveBotState(
  stateFilePath: string,
  state: BotPersistedState
): void {
  const dir = path.dirname(stateFilePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${stateFilePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpPath, stateFilePath);
}

export function isTweetProcessed(
  state: BotPersistedState,
  tweetId: string
): boolean {
  return state.processedTweetIds.includes(tweetId);
}

export function isAuthorRateLimited(
  state: BotPersistedState,
  authorId: string | undefined,
  cooldownMs = 90_000,
  nowMs = Date.now()
): boolean {
  if (!authorId) return false;
  const last = state.authorLastRunAt[authorId];
  return typeof last === "number" && nowMs - last < cooldownMs;
}

export function recordProcessedMention(
  state: BotPersistedState,
  tweetId: string,
  authorId?: string,
  nowMs = Date.now()
): void {
  if (!state.processedTweetIds.includes(tweetId)) {
    state.processedTweetIds.push(tweetId);
    if (state.processedTweetIds.length > MAX_TRACKED_TWEETS) {
      state.processedTweetIds = state.processedTweetIds.slice(-MAX_TRACKED_TWEETS);
    }
  }
  if (!state.lastMentionId || compareSnowflake(tweetId, state.lastMentionId) > 0) {
    state.lastMentionId = tweetId;
  }
  if (authorId) {
    state.authorLastRunAt[authorId] = nowMs;
  }
}

function compareSnowflake(a: string, b: string): number {
  try {
    const ba = BigInt(a);
    const bb = BigInt(b);
    return ba > bb ? 1 : ba < bb ? -1 : 0;
  } catch {
    return a.localeCompare(b);
  }
}
