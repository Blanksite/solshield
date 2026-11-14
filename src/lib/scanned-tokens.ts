import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getScanCacheDir, isScanDiskPersistenceEnabled } from "./scan-cache";
import {
  mergeScannedTokenLists,
  ScannedTokenSource,
  ScannedTokenSummary,
  tokenReportToSummary,
} from "./scanned-token-types";
import type { TokenScanReport } from "./token-scanner";

const MAX_STORED_SCANNED_TOKENS = 40;
const HISTORY_FILENAME = "scanned-tokens_history.json";
const UPSTASH_SCANNED_TOKENS_KEY = "solshield:scanned_tokens:v1";

interface GlobalScannedTokenStore {
  loadedFromDisk: boolean;
  lastDiskMtimeMs: number;
  lastRemoteSyncAtMs: number;
  items: ScannedTokenSummary[];
}

function getStore(): GlobalScannedTokenStore {
  const g = globalThis as unknown as {
    __solshieldScannedTokensStore?: GlobalScannedTokenStore;
  };
  if (!g.__solshieldScannedTokensStore) {
    g.__solshieldScannedTokensStore = {
      loadedFromDisk: false,
      lastDiskMtimeMs: 0,
      lastRemoteSyncAtMs: 0,
      items: [],
    };
  }
  return g.__solshieldScannedTokensStore;
}

function getHistoryFilePath(): string {
  return path.join(getScanCacheDir(), HISTORY_FILENAME);
}

function getUpstashConfig(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    "";
  if (!url || !token || !/^https?:\/\//i.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

function parseValidSummaries(raw: unknown): ScannedTokenSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ScannedTokenSummary =>
      Boolean(item && typeof item === "object" && "mintAddress" in item)
  );
}

async function readUpstashScannedTokens(): Promise<ScannedTokenSummary[] | null> {
  const cfg = getUpstashConfig();
  if (!cfg) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(
        `${cfg.url}/get/${encodeURIComponent(UPSTASH_SCANNED_TOKENS_KEY)}`,
        {
          headers: { Authorization: `Bearer ${cfg.token}` },
          signal: controller.signal,
          cache: "no-store",
        }
      );
      if (!res.ok) return null;
      const payload = (await res.json()) as { result?: unknown };
      if (typeof payload.result !== "string" || !payload.result.trim()) {
        return [];
      }
      return parseValidSummaries(JSON.parse(payload.result));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function writeUpstashScannedTokens(
  items: ScannedTokenSummary[]
): Promise<void> {
  const cfg = getUpstashConfig();
  if (!cfg) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await fetch(
        `${cfg.url}/set/${encodeURIComponent(UPSTASH_SCANNED_TOKENS_KEY)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(JSON.stringify(items)),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Gracefully fall back to local cache if shared KV is momentarily unreachable
  }
}

async function ensureLoaded(includeRemote = true): Promise<GlobalScannedTokenStore> {
  const store = getStore();

  // Reload from disk whenever another local process (e.g. X bot worker) updates the file
  if (isScanDiskPersistenceEnabled()) {
    try {
      const filePath = getHistoryFilePath();
      const stat = await fs.promises.stat(filePath);
      if (!store.loadedFromDisk || stat.mtimeMs > store.lastDiskMtimeMs) {
        const raw = await fs.promises.readFile(filePath, "utf8");
        const valid = parseValidSummaries(JSON.parse(raw));
        store.items = mergeScannedTokenLists(
          valid,
          store.items,
          MAX_STORED_SCANNED_TOKENS
        );
        store.lastDiskMtimeMs = stat.mtimeMs;
      }
    } catch {
      // History file may not exist yet on fresh start
    }
  }
  store.loadedFromDisk = true;

  // Optionally sync shared Redis/KV store (rate-limited to at most once every 5s per instance)
  if (includeRemote && Date.now() - store.lastRemoteSyncAtMs >= 5000) {
    const remote = await readUpstashScannedTokens();
    if (remote !== null) {
      store.lastRemoteSyncAtMs = Date.now();
      if (remote.length > 0) {
        store.items = mergeScannedTokenLists(
          remote,
          store.items,
          MAX_STORED_SCANNED_TOKENS
        );
      }
    }
  }

  return store;
}

async function persistItems(items: ScannedTokenSummary[]): Promise<void> {
  if (isScanDiskPersistenceEnabled()) {
    try {
      const filePath = getHistoryFilePath();
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(items), "utf8");
      await fs.promises.rename(tmpPath, filePath);
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (stat) {
        getStore().lastDiskMtimeMs = stat.mtimeMs;
      }
    } catch {
      // Gracefully skip disk write on read-only environments
    }
  }
  await writeUpstashScannedTokens(items);
}

/**
 * Upserts a pre-computed ScannedTokenSummary (used by authenticated X-bot sync or collectors)
 * and persists across disk + optional shared Upstash Redis store.
 */
export async function recordScannedTokenSummary(
  entry: ScannedTokenSummary
): Promise<ScannedTokenSummary> {
  const store = await ensureLoaded();
  const existing = store.items.find((i) => i.mintAddress === entry.mintAddress);
  const nextEntry: ScannedTokenSummary = {
    ...entry,
    scanCount: existing ? Math.max(existing.scanCount + 1, entry.scanCount || 1) : entry.scanCount || 1,
  };
  store.items = mergeScannedTokenLists(
    [nextEntry],
    store.items,
    MAX_STORED_SCANNED_TOKENS
  );
  store.lastRemoteSyncAtMs = Date.now();
  await persistItems(store.items);
  return nextEntry;
}

/**
 * Records a genuine on-chain token mint audit in the recently-scanned registry
 * (public SPL/Token-2022 mint metadata only, never private wallet keys or prompts).
 */
export async function recordScannedToken(
  report: TokenScanReport,
  source: ScannedTokenSource
): Promise<ScannedTokenSummary> {
  const nextEntry = tokenReportToSummary(report, source);
  return recordScannedTokenSummary(nextEntry);
}

/**
 * Lists genuinely scanned tokens sorted from newest to oldest.
 */
export async function listScannedTokens(
  limit = 20
): Promise<ScannedTokenSummary[]> {
  const store = await ensureLoaded();
  return store.items.slice(0, Math.max(1, Math.min(limit, MAX_STORED_SCANNED_TOKENS)));
}

/**
 * Clears stored scanned-token history (used for testing).
 */
export async function clearScannedTokens(): Promise<void> {
  const store = getStore();
  store.items = [];
  store.loadedFromDisk = false;
  store.lastDiskMtimeMs = 0;
  store.lastRemoteSyncAtMs = 0;
  if (isScanDiskPersistenceEnabled()) {
    await fs.promises.unlink(getHistoryFilePath()).catch(() => undefined);
  }
}
