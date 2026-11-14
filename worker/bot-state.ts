import fs from "node:fs";
import { getUtcDateKey, saveJsonAtomic } from "./bot-shared";

export { getUtcDateKey };

export interface BotPersistedState {
  botUserId: string | null;
  lastMentionId: string | null;
  processedTweetIds: string[];
  authorLastRunAt: Record<string, number>;
  repliesTodayDate?: string;
  repliesTodayCount?: number;
  lastPollAt?: string | null;
  lastReplyAt?: string | null;
  lastError?: string | null;
}

const DEFAULT_STATE: BotPersistedState = {
  botUserId: null,
  lastMentionId: null,
  processedTweetIds: [],
  authorLastRunAt: {},
  repliesTodayDate: undefined,
  repliesTodayCount: 0,
  lastPollAt: null,
  lastReplyAt: null,
  lastError: null,
};

const MAX_TRACKED_TWEETS = 500;
const MAX_TRACKED_AUTHORS = 1000;

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
      repliesTodayDate:
        typeof parsed.repliesTodayDate === "string" ? parsed.repliesTodayDate : undefined,
      repliesTodayCount:
        typeof parsed.repliesTodayCount === "number" &&
        Number.isFinite(parsed.repliesTodayCount) &&
        parsed.repliesTodayCount >= 0
          ? parsed.repliesTodayCount
          : 0,
      lastPollAt: typeof parsed.lastPollAt === "string" ? parsed.lastPollAt : null,
      lastReplyAt: typeof parsed.lastReplyAt === "string" ? parsed.lastReplyAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    };
  } catch {
    return { ...DEFAULT_STATE, processedTweetIds: [], authorLastRunAt: {} };
  }
}

export function saveBotState(
  stateFilePath: string,
  state: BotPersistedState
): void {
  saveJsonAtomic(stateFilePath, state);
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

export function isMentionTooOld(
  createdAtIso: string | undefined,
  maxAgeMinutes: number,
  nowMs = Date.now()
): boolean {
  if (maxAgeMinutes <= 0 || !createdAtIso) return false;
  const parsedMs = Date.parse(createdAtIso);
  if (!Number.isFinite(parsedMs)) return false;
  return nowMs - parsedMs > maxAgeMinutes * 60_000;
}

export function getRepliesTodayCount(
  state: BotPersistedState,
  nowMs = Date.now()
): number {
  const today = getUtcDateKey(nowMs);
  if (state.repliesTodayDate !== today) return 0;
  return state.repliesTodayCount ?? 0;
}

export function canSendDailyReply(
  state: BotPersistedState,
  maxRepliesPerDay: number,
  nowMs = Date.now()
): boolean {
  if (maxRepliesPerDay <= 0) return true;
  return getRepliesTodayCount(state, nowMs) < maxRepliesPerDay;
}

export function recordReplySent(
  state: BotPersistedState,
  nowMs = Date.now()
): void {
  const today = getUtcDateKey(nowMs);
  if (state.repliesTodayDate !== today) {
    state.repliesTodayDate = today;
    state.repliesTodayCount = 0;
  }
  state.repliesTodayCount = (state.repliesTodayCount ?? 0) + 1;
  state.lastReplyAt = new Date(nowMs).toISOString();
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
    const authorEntries = Object.entries(state.authorLastRunAt);
    if (authorEntries.length > MAX_TRACKED_AUTHORS) {
      authorEntries.sort((a, b) => a[1] - b[1]);
      const keep = authorEntries.slice(-Math.floor(MAX_TRACKED_AUTHORS * 0.8));
      state.authorLastRunAt = Object.fromEntries(keep);
    }
  }
}

export type MentionGuardDecision =
  | { allow: true }
  | {
      allow: false;
      reason:
        | "already_processed"
        | "self_mention"
        | "stale_mention"
        | "author_cooldown"
        | "daily_limit_reached";
      recordProcessed: boolean;
    };

/**
 * Evaluates anti-loop, cold-start staleness, author cooldown, and daily reply budget
 * guards before triggering Chromium + Venice forensics or posting on X.
 */
export function evaluateMentionGuard(params: {
  mentionId: string;
  authorId?: string;
  createdAt?: string;
  state: BotPersistedState;
  maxMentionAgeMinutes: number;
  authorCooldownMs: number;
  maxRepliesPerDay: number;
  nowMs?: number;
}): MentionGuardDecision {
  const nowMs = params.nowMs ?? Date.now();

  if (isTweetProcessed(params.state, params.mentionId)) {
    return { allow: false, reason: "already_processed", recordProcessed: false };
  }

  if (
    params.authorId &&
    params.state.botUserId &&
    params.authorId === params.state.botUserId
  ) {
    return { allow: false, reason: "self_mention", recordProcessed: true };
  }

  if (isMentionTooOld(params.createdAt, params.maxMentionAgeMinutes, nowMs)) {
    return { allow: false, reason: "stale_mention", recordProcessed: true };
  }

  if (!canSendDailyReply(params.state, params.maxRepliesPerDay, nowMs)) {
    return { allow: false, reason: "daily_limit_reached", recordProcessed: true };
  }

  if (
    isAuthorRateLimited(
      params.state,
      params.authorId,
      params.authorCooldownMs,
      nowMs
    )
  ) {
    return { allow: false, reason: "author_cooldown", recordProcessed: true };
  }

  return { allow: true };
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
