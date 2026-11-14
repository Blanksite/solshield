import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface StoredCacheRecord<T> {
  namespace: string;
  keyHash: string;
  cachedAt: string;
  expiresAtMs: number;
  value: T;
}

export interface CacheLookupResult<T> {
  value: T;
  cacheKey: string;
  cachedAt: string;
  expiresAt: string;
}

interface CacheRuntimeStats {
  hits: number;
  misses: number;
  coalesced: number;
  diskHits: number;
}

interface GlobalScanCacheStore {
  memory: Map<string, StoredCacheRecord<unknown>>;
  stats: CacheRuntimeStats;
}

const DEFAULT_MAX_MEMORY_ENTRIES = 120;
const HEAVY_NAMESPACE_MAX_MEMORY = 24;

function getCacheStore(): GlobalScanCacheStore {
  const g = globalThis as unknown as {
    __solshieldScanCacheStore?: GlobalScanCacheStore;
  };
  if (!g.__solshieldScanCacheStore) {
    g.__solshieldScanCacheStore = {
      memory: new Map(),
      stats: {
        hits: 0,
        misses: 0,
        coalesced: 0,
        diskHits: 0,
      },
    };
  }
  return g.__solshieldScanCacheStore;
}

export function getScanCacheDir(): string {
  const configured = process.env.SOLSHIELD_CACHE_DIR?.trim();
  return configured || path.join(os.tmpdir(), "solshield-scan-cache");
}

export function isScanDiskPersistenceEnabled(): boolean {
  return process.env.SOLSHIELD_DISABLE_DISK_CACHE !== "true";
}

function getCacheDir(): string {
  return getScanCacheDir();
}

function isDiskPersistenceEnabled(): boolean {
  return isScanDiskPersistenceEnabled();
}

/**
 * Produces a deterministic, path-safe SHA-256 hex digest for a cache key.
 */
export function createCacheKeyHash(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

function buildCompositeKey(namespace: string, rawKey: string): {
  composite: string;
  keyHash: string;
  diskPath: string;
} {
  const safeNamespace = namespace.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const keyHash = createCacheKeyHash(`${safeNamespace}:${rawKey}`);
  const composite = `${safeNamespace}:${keyHash}`;
  const diskPath = path.join(getCacheDir(), `${safeNamespace}_${keyHash.slice(0, 32)}.json`);
  return { composite, keyHash, diskPath };
}

function pruneExpiredMemory(store: GlobalScanCacheStore, now: number): void {
  for (const [k, rec] of store.memory.entries()) {
    if (rec.expiresAtMs <= now) {
      store.memory.delete(k);
    }
  }
}

function enforceMemoryCap(store: GlobalScanCacheStore, namespace: string): void {
  const maxEntries =
    namespace === "buildcheck"
      ? HEAVY_NAMESPACE_MAX_MEMORY
      : DEFAULT_MAX_MEMORY_ENTRIES;

  const nsKeys: string[] = [];
  for (const [k, rec] of store.memory.entries()) {
    if (rec.namespace === namespace) {
      nsKeys.push(k);
    }
  }

  while (nsKeys.length > maxEntries) {
    const oldest = nsKeys.shift();
    if (oldest) store.memory.delete(oldest);
  }
}

async function readDiskRecord<T>(diskPath: string): Promise<StoredCacheRecord<T> | null> {
  if (!isDiskPersistenceEnabled()) return null;
  try {
    const raw = await fs.promises.readFile(diskPath, "utf8");
    const parsed = JSON.parse(raw) as StoredCacheRecord<T>;
    if (!parsed || typeof parsed.expiresAtMs !== "number") return null;
    if (parsed.expiresAtMs <= Date.now()) {
      void fs.promises.unlink(diskPath).catch(() => undefined);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskRecord<T>(
  diskPath: string,
  record: StoredCacheRecord<T>
): Promise<void> {
  if (!isDiskPersistenceEnabled()) return;
  try {
    await fs.promises.mkdir(path.dirname(diskPath), { recursive: true });
    const tmpPath = `${diskPath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(record), "utf8");
    await fs.promises.rename(tmpPath, diskPath);
  } catch {
    // Gracefully skip disk persistence on read-only runtimes
  }
}

/**
 * Looks up a cached scan across memory LRU and disk backup using optional fallback keys.
 */
export async function getCachedEntry<T>(
  namespace: string,
  key: string,
  fallbackKeys: string[] = []
): Promise<CacheLookupResult<T> | null> {
  const store = getCacheStore();
  const now = Date.now();
  pruneExpiredMemory(store, now);

  const candidates = [key, ...fallbackKeys];
  for (const candidateKey of candidates) {
    const { composite, diskPath } = buildCompositeKey(namespace, candidateKey);
    const memHit = store.memory.get(composite);
    if (memHit && memHit.expiresAtMs > now) {
      // Refresh LRU position on read
      store.memory.delete(composite);
      store.memory.set(composite, memHit);
      store.stats.hits += 1;
      return {
        value: memHit.value as T,
        cacheKey: candidateKey,
        cachedAt: memHit.cachedAt,
        expiresAt: new Date(memHit.expiresAtMs).toISOString(),
      };
    }

    const diskHit = await readDiskRecord<T>(diskPath);
    if (diskHit && diskHit.expiresAtMs > now) {
      store.memory.set(composite, diskHit);
      enforceMemoryCap(store, namespace);
      store.stats.hits += 1;
      store.stats.diskHits += 1;
      return {
        value: diskHit.value,
        cacheKey: candidateKey,
        cachedAt: diskHit.cachedAt,
        expiresAt: new Date(diskHit.expiresAtMs).toISOString(),
      };
    }
  }

  store.stats.misses += 1;
  return null;
}

/**
 * Stores a scan result in both memory LRU and optional disk store with explicit TTL.
 */
export async function setCachedEntry<T>(
  namespace: string,
  key: string,
  value: T,
  ttlMs: number
): Promise<{ cachedAt: string; expiresAt: string }> {
  const safeTtlMs = Math.max(1000, ttlMs);
  const store = getCacheStore();
  const now = Date.now();
  const { composite, keyHash, diskPath } = buildCompositeKey(namespace, key);

  const cachedAt = new Date(now).toISOString();
  const expiresAtMs = now + safeTtlMs;
  const record: StoredCacheRecord<T> = {
    namespace,
    keyHash,
    cachedAt,
    expiresAtMs,
    value,
  };

  store.memory.delete(composite);
  store.memory.set(composite, record);
  enforceMemoryCap(store, namespace);
  await writeDiskRecord(diskPath, record);

  return {
    cachedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function recordCoalescedHit(): void {
  const store = getCacheStore();
  store.stats.coalesced += 1;
}

/**
 * Returns aggregate cache statistics without revealing any stored user targets.
 */
export function getScanCacheStats(): {
  memoryEntries: number;
  hits: number;
  misses: number;
  coalesced: number;
  diskHits: number;
} {
  const store = getCacheStore();
  pruneExpiredMemory(store, Date.now());
  return {
    memoryEntries: store.memory.size,
    hits: store.stats.hits,
    misses: store.stats.misses,
    coalesced: store.stats.coalesced,
    diskHits: store.stats.diskHits,
  };
}

/**
 * Clears cached entries (primarily for unit testing).
 */
export async function clearScanCache(namespace?: string): Promise<void> {
  const store = getCacheStore();
  if (!namespace) {
    store.memory.clear();
    store.stats = { hits: 0, misses: 0, coalesced: 0, diskHits: 0 };
  } else {
    const safeNs = namespace.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    for (const [k, rec] of store.memory.entries()) {
      if (rec.namespace === safeNs) {
        store.memory.delete(k);
      }
    }
  }

  if (isDiskPersistenceEnabled()) {
    try {
      const dir = getCacheDir();
      const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
      const safeNs = namespace?.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      await Promise.all(
        files
          .filter((f) => !safeNs || f.startsWith(`${safeNs}_`))
          .map((f) => fs.promises.unlink(path.join(dir, f)).catch(() => undefined))
      );
    } catch {
      // Ignore cleanup failures
    }
  }
}
