import fs from "node:fs";
import { getUtcDateKey, saveJsonAtomic } from "./bot-shared";

export interface TgBotPersistedState {
  botId: number | null;
  botUsername: string | null;
  lastUpdateId: number | null;
  processedUpdateIds: number[];
  userLastRunAt: Record<string, number>;
  chatLastRunAt: Record<string, number>;
  scansTodayDate?: string;
  scansTodayCount?: number;
  lastPollAt?: string | null;
  lastReplyAt?: string | null;
  lastError?: string | null;
}

const DEFAULT_TG_STATE: TgBotPersistedState = {
  botId: null,
  botUsername: null,
  lastUpdateId: null,
  processedUpdateIds: [],
  userLastRunAt: {},
  chatLastRunAt: {},
  scansTodayDate: undefined,
  scansTodayCount: 0,
  lastPollAt: null,
  lastReplyAt: null,
  lastError: null,
};

const MAX_TRACKED_UPDATES = 500;
const MAX_TRACKED_USERS = 1500;
const MAX_TRACKED_CHATS = 1000;

function createEmptyTgState(): TgBotPersistedState {
  return {
    ...DEFAULT_TG_STATE,
    processedUpdateIds: [],
    userLastRunAt: {},
    chatLastRunAt: {},
  };
}

function pruneTimestampMap(
  map: Record<string, number>,
  maxEntries: number
): Record<string, number> {
  const entries = Object.entries(map);
  if (entries.length <= maxEntries) return map;
  entries.sort((a, b) => a[1] - b[1]);
  return Object.fromEntries(entries.slice(-Math.floor(maxEntries * 0.8)));
}

export function loadTgBotState(stateFilePath: string): TgBotPersistedState {
  try {
    if (!fs.existsSync(stateFilePath)) {
      return createEmptyTgState();
    }
    const raw = fs.readFileSync(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TgBotPersistedState>;
    return {
      botId:
        typeof parsed.botId === "number" && Number.isFinite(parsed.botId)
          ? parsed.botId
          : null,
      botUsername:
        typeof parsed.botUsername === "string" ? parsed.botUsername : null,
      lastUpdateId:
        typeof parsed.lastUpdateId === "number" &&
        Number.isFinite(parsed.lastUpdateId)
          ? parsed.lastUpdateId
          : null,
      processedUpdateIds: Array.isArray(parsed.processedUpdateIds)
        ? parsed.processedUpdateIds
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
            .slice(-MAX_TRACKED_UPDATES)
        : [],
      userLastRunAt:
        parsed.userLastRunAt && typeof parsed.userLastRunAt === "object"
          ? parsed.userLastRunAt
          : {},
      chatLastRunAt:
        parsed.chatLastRunAt && typeof parsed.chatLastRunAt === "object"
          ? parsed.chatLastRunAt
          : {},
      scansTodayDate:
        typeof parsed.scansTodayDate === "string"
          ? parsed.scansTodayDate
          : undefined,
      scansTodayCount:
        typeof parsed.scansTodayCount === "number" &&
        Number.isFinite(parsed.scansTodayCount) &&
        parsed.scansTodayCount >= 0
          ? parsed.scansTodayCount
          : 0,
      lastPollAt: typeof parsed.lastPollAt === "string" ? parsed.lastPollAt : null,
      lastReplyAt:
        typeof parsed.lastReplyAt === "string" ? parsed.lastReplyAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    };
  } catch {
    return createEmptyTgState();
  }
}

export function saveTgBotState(
  stateFilePath: string,
  state: TgBotPersistedState
): void {
  saveJsonAtomic(stateFilePath, state);
}

export function getTgScansTodayCount(
  state: TgBotPersistedState,
  nowMs = Date.now()
): number {
  const today = getUtcDateKey(nowMs);
  if (state.scansTodayDate !== today) return 0;
  return state.scansTodayCount ?? 0;
}

export function recordTgScanCompleted(
  state: TgBotPersistedState,
  chatId?: string | number,
  userId?: string | number,
  nowMs = Date.now()
): void {
  const today = getUtcDateKey(nowMs);
  if (state.scansTodayDate !== today) {
    state.scansTodayDate = today;
    state.scansTodayCount = 0;
  }
  state.scansTodayCount = (state.scansTodayCount ?? 0) + 1;
  state.lastReplyAt = new Date(nowMs).toISOString();

  if (chatId !== undefined) {
    state.chatLastRunAt[String(chatId)] = nowMs;
    state.chatLastRunAt = pruneTimestampMap(state.chatLastRunAt, MAX_TRACKED_CHATS);
  }
  if (userId !== undefined) {
    state.userLastRunAt[String(userId)] = nowMs;
    state.userLastRunAt = pruneTimestampMap(state.userLastRunAt, MAX_TRACKED_USERS);
  }
}

export function recordTgUpdateSeen(
  state: TgBotPersistedState,
  updateId: number
): void {
  if (!state.processedUpdateIds.includes(updateId)) {
    state.processedUpdateIds.push(updateId);
    if (state.processedUpdateIds.length > MAX_TRACKED_UPDATES) {
      state.processedUpdateIds = state.processedUpdateIds.slice(-MAX_TRACKED_UPDATES);
    }
  }
  if (state.lastUpdateId === null || updateId > state.lastUpdateId) {
    state.lastUpdateId = updateId;
  }
}

export type TgScanGuardDecision =
  | { allow: true }
  | {
      allow: false;
      reason:
        | "already_processed"
        | "chat_not_allowed"
        | "stale_message"
        | "daily_limit_reached"
        | "chat_cooldown"
        | "user_cooldown";
      retryAfterSec?: number;
    };

/**
 * Enforces replay dedup, optional chat allowlist, cold-start age cutoff,
 * daily budget, and per-chat / per-user cooldowns before starting heavy Chromium scans.
 */
export function evaluateTgScanGuard(params: {
  updateId: number;
  chatId: string | number;
  userId?: string | number;
  messageDateSec?: number;
  state: TgBotPersistedState;
  allowedChatIds?: string[];
  maxMessageAgeMinutes: number;
  userCooldownMs: number;
  chatCooldownMs: number;
  maxScansPerDay: number;
  nowMs?: number;
}): TgScanGuardDecision {
  const nowMs = params.nowMs ?? Date.now();

  if (params.state.processedUpdateIds.includes(params.updateId)) {
    return { allow: false, reason: "already_processed" };
  }

  if (
    params.allowedChatIds &&
    params.allowedChatIds.length > 0 &&
    !params.allowedChatIds.includes(String(params.chatId))
  ) {
    return { allow: false, reason: "chat_not_allowed" };
  }

  if (
    params.maxMessageAgeMinutes > 0 &&
    typeof params.messageDateSec === "number" &&
    Number.isFinite(params.messageDateSec)
  ) {
    const ageMs = nowMs - params.messageDateSec * 1000;
    if (ageMs > params.maxMessageAgeMinutes * 60_000) {
      return { allow: false, reason: "stale_message" };
    }
  }

  if (
    params.maxScansPerDay > 0 &&
    getTgScansTodayCount(params.state, nowMs) >= params.maxScansPerDay
  ) {
    return { allow: false, reason: "daily_limit_reached" };
  }

  if (params.chatCooldownMs > 0) {
    const lastChat = params.state.chatLastRunAt[String(params.chatId)];
    if (typeof lastChat === "number" && nowMs - lastChat < params.chatCooldownMs) {
      const remaining = Math.ceil(
        (params.chatCooldownMs - (nowMs - lastChat)) / 1000
      );
      return {
        allow: false,
        reason: "chat_cooldown",
        retryAfterSec: Math.max(1, remaining),
      };
    }
  }

  if (params.userCooldownMs > 0 && params.userId !== undefined) {
    const lastUser = params.state.userLastRunAt[String(params.userId)];
    if (typeof lastUser === "number" && nowMs - lastUser < params.userCooldownMs) {
      const remaining = Math.ceil(
        (params.userCooldownMs - (nowMs - lastUser)) / 1000
      );
      return {
        allow: false,
        reason: "user_cooldown",
        retryAfterSec: Math.max(1, remaining),
      };
    }
  }

  return { allow: true };
}
