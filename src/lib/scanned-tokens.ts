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

interface GlobalScannedTokenStore {
  loadedFromDisk: boolean;
  items: ScannedTokenSummary[];
}

function getStore(): GlobalScannedTokenStore {
  const g = globalThis as unknown as {
    __solshieldScannedTokensStore?: GlobalScannedTokenStore;
  };
  if (!g.__solshieldScannedTokensStore) {
    g.__solshieldScannedTokensStore = {
      loadedFromDisk: false,
      items: [],
    };
  }
  return g.__solshieldScannedTokensStore;
}

function getHistoryFilePath(): string {
  return path.join(getScanCacheDir(), HISTORY_FILENAME);
}

async function ensureLoaded(): Promise<GlobalScannedTokenStore> {
  const store = getStore();
  if (store.loadedFromDisk || !isScanDiskPersistenceEnabled()) {
    store.loadedFromDisk = true;
    return store;
  }

  try {
    const raw = await fs.promises.readFile(getHistoryFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(
        (item): item is ScannedTokenSummary =>
          Boolean(item && typeof item === "object" && "mintAddress" in item)
      );
      store.items = mergeScannedTokenLists(store.items, valid, MAX_STORED_SCANNED_TOKENS);
    }
  } catch {
    // History file may not exist yet on fresh start
  }
  store.loadedFromDisk = true;
  return store;
}

async function persistItems(items: ScannedTokenSummary[]): Promise<void> {
  if (!isScanDiskPersistenceEnabled()) return;
  try {
    const filePath = getHistoryFilePath();
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(items), "utf8");
    await fs.promises.rename(tmpPath, filePath);
  } catch {
    // Gracefully skip disk write on read-only environments
  }
}

/**
 * Records a genuine on-chain token mint audit in the recently-scanned registry
 * (public SPL/Token-2022 mint metadata only, never private wallet keys or prompts).
 */
export async function recordScannedToken(
  report: TokenScanReport,
  source: ScannedTokenSource
): Promise<ScannedTokenSummary> {
  const store = await ensureLoaded();
  const nextEntry = tokenReportToSummary(report, source);
  const existing = store.items.find((i) => i.mintAddress === nextEntry.mintAddress);
  if (existing) {
    nextEntry.scanCount = (existing.scanCount || 1) + 1;
  }
  store.items = mergeScannedTokenLists(
    [nextEntry],
    store.items,
    MAX_STORED_SCANNED_TOKENS
  );
  await persistItems(store.items);
  return nextEntry;
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
  if (isScanDiskPersistenceEnabled()) {
    await fs.promises.unlink(getHistoryFilePath()).catch(() => undefined);
  }
}
