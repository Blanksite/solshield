import fs from "node:fs";
import type { WatchedProjectRecord } from "../src/lib/project-watchdog";
import type { WatchWalletChain } from "../src/lib/wallet-watch-client";
import { getUtcDateKey, saveJsonAtomic } from "./bot-shared";

export interface TgWatchedWalletEntry {
  address: string;
  chain: WatchWalletChain;
  label?: string;
  tokenAddress?: string | null;
  addedAt: string;
  lastCheckedAt?: string | null;
  lastSeenTxHash?: string | null;
  lastSummary?: string | null;
  lastNativeBalance?: string | null;
}

export interface TgBotPersistedState {
  botId: number | null;
  botUsername: string | null;
  lastUpdateId: number | null;
  processedUpdateIds: number[];
  userLastRunAt: Record<string, number>;
  chatLastRunAt: Record<string, number>;
  watchedWalletsByChat?: Record<string, TgWatchedWalletEntry[]>;
  watchedProjectsByChat?: Record<string, WatchedProjectRecord[]>;
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
    watchedWalletsByChat: {},
    watchedProjectsByChat: {},
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
      watchedWalletsByChat:
        parsed.watchedWalletsByChat && typeof parsed.watchedWalletsByChat === "object"
          ? parsed.watchedWalletsByChat
          : {},
      watchedProjectsByChat:
        parsed.watchedProjectsByChat && typeof parsed.watchedProjectsByChat === "object"
          ? parsed.watchedProjectsByChat
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

export function upsertTgWatchedWallet(
  state: TgBotPersistedState,
  chatId: string | number,
  entry: TgWatchedWalletEntry,
  maxPerChat = 12
): { added: boolean; count: number; reachedLimit: boolean } {
  const map = (state.watchedWalletsByChat ||= {});
  const key = String(chatId);
  const existingList = Array.isArray(map[key]) ? map[key] : [];
  const normAddr = entry.chain === "solana" ? entry.address : entry.address.toLowerCase();
  const idx = existingList.findIndex(
    (w) =>
      w.chain === entry.chain &&
      (w.chain === "solana" ? w.address === normAddr : w.address.toLowerCase() === normAddr)
  );
  if (idx >= 0) {
    existingList[idx] = { ...existingList[idx], ...entry, address: normAddr };
    map[key] = existingList;
    return { added: false, count: existingList.length, reachedLimit: false };
  }
  if (existingList.length >= maxPerChat) {
    return { added: false, count: existingList.length, reachedLimit: true };
  }
  existingList.push({ ...entry, address: normAddr });
  map[key] = existingList;
  return { added: true, count: existingList.length, reachedLimit: false };
}

export function removeTgWatchedWallet(
  state: TgBotPersistedState,
  chatId: string | number,
  address: string
): { removed: boolean; count: number } {
  const map = (state.watchedWalletsByChat ||= {});
  const key = String(chatId);
  const list = Array.isArray(map[key]) ? map[key] : [];
  const lower = address.trim().toLowerCase();
  const next = list.filter((w) => w.address.toLowerCase() !== lower);
  map[key] = next;
  return { removed: next.length < list.length, count: next.length };
}

export function listTgWatchedWallets(
  state: TgBotPersistedState,
  chatId: string | number
): TgWatchedWalletEntry[] {
  const map = state.watchedWalletsByChat;
  if (!map) return [];
  return Array.isArray(map[String(chatId)]) ? map[String(chatId)] : [];
}

export function upsertTgWatchedProject(
  state: TgBotPersistedState,
  chatId: string | number,
  record: WatchedProjectRecord,
  maxPerChat = 8
): { added: boolean; count: number; reachedLimit: boolean } {
  const map = (state.watchedProjectsByChat ||= {});
  const key = String(chatId);
  const existing = Array.isArray(map[key]) ? map[key] : [];
  const idx = existing.findIndex((p) => p.id === record.id);
  if (idx >= 0) {
    existing[idx] = record;
    map[key] = existing;
    return { added: false, count: existing.length, reachedLimit: false };
  }
  if (existing.length >= maxPerChat) {
    return { added: false, count: existing.length, reachedLimit: true };
  }
  existing.push(record);
  map[key] = existing;
  return { added: true, count: existing.length, reachedLimit: false };
}

export function removeTgWatchedProject(
  state: TgBotPersistedState,
  chatId: string | number,
  query: string
): { removed: boolean; count: number } {
  const map = (state.watchedProjectsByChat ||= {});
  const key = String(chatId);
  const list = Array.isArray(map[key]) ? map[key] : [];
  const lower = query.trim().toLowerCase();
  const next = list.filter(
    (p) =>
      p.id.toLowerCase() !== lower &&
      (p.contractAddress || "").toLowerCase() !== lower &&
      (p.githubRepo || "").toLowerCase() !== lower &&
      (p.websiteUrl || "").toLowerCase() !== lower &&
      p.label.toLowerCase() !== lower
  );
  map[key] = next;
  return { removed: next.length < list.length, count: next.length };
}

export function listTgWatchedProjects(
  state: TgBotPersistedState,
  chatId: string | number
): WatchedProjectRecord[] {
  const map = state.watchedProjectsByChat;
  if (!map) return [];
  return Array.isArray(map[String(chatId)]) ? map[String(chatId)] : [];
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
