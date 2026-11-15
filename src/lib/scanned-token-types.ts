import type { TokenScanReport } from "./token-scanner";

export type ScannedTokenSource = "token-xray" | "buildcheck" | "tx-firewall";

export type ScannedTokenBuildVerdict =
  | "VERIFIED_BUILD"
  | "UNPROVEN_HYPE"
  | "HIGH_FABRICATION_RISK";

export interface TokenCheckCheckpoint {
  scannedAt: string;
  riskScore: number;
  buildScore?: number | null;
  buildVerdict?: ScannedTokenBuildVerdict | null;
  reportId?: string | null;
  marketCapUsd?: number | null;
  priceUsd?: number | null;
  source?: ScannedTokenSource;
}

export interface ScannedTokenExtraMetadata {
  buildCheckId?: string | null;
  buildScore?: number | null;
  buildVerdict?: ScannedTokenBuildVerdict | null;
  marketCapUsd?: number | null;
  priceUsd?: number | null;
  liquidityUsd?: number | null;
}

export interface ScannedTokenSummary {
  mintAddress: string;
  symbol: string | null;
  name: string | null;
  tokenProgram: "SPL Token" | "Token-2022";
  riskScore: number;
  classification: "SAFE" | "CAUTION" | "CRITICAL";
  recommendedAction: "VERIFIED_SAFE" | "DYOR_CAUTION" | "HIGH_RUG_RISK";
  verifiedIssuer: string | null;
  slot: number;
  scannedAt: string;
  source: ScannedTokenSource;
  scanCount: number;
  buildCheckId?: string | null;
  buildScore?: number | null;
  buildVerdict?: ScannedTokenBuildVerdict | null;
  marketCapUsd?: number | null;
  priceUsd?: number | null;
  liquidityUsd?: number | null;
  firstSeenAt?: string | null;
  firstPriceUsd?: number | null;
  firstMarketCapUsd?: number | null;
  scoreHistory?: TokenCheckCheckpoint[];
}

export const SCANNED_TOKENS_STORAGE_KEY = "solshield_scanned_tokens_v1";
export const MAX_TOKEN_SCORE_HISTORY = 12;

function positiveNumOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function nonNegNumOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function buildCheckpointFromSummary(
  entry: ScannedTokenSummary
): TokenCheckCheckpoint {
  return {
    scannedAt: entry.scannedAt,
    riskScore: entry.riskScore,
    ...(typeof entry.buildScore === "number" && Number.isFinite(entry.buildScore)
      ? { buildScore: entry.buildScore }
      : {}),
    ...(entry.buildVerdict ? { buildVerdict: entry.buildVerdict } : {}),
    ...(entry.buildCheckId ? { reportId: entry.buildCheckId } : {}),
    ...(positiveNumOrNull(entry.marketCapUsd) !== null
      ? { marketCapUsd: entry.marketCapUsd }
      : {}),
    ...(positiveNumOrNull(entry.priceUsd) !== null
      ? { priceUsd: entry.priceUsd }
      : {}),
    source: entry.source,
  };
}

function checkpointRichnessScore(cp: TokenCheckCheckpoint): number {
  let score = 0;
  if (cp.reportId) score += 4;
  if (typeof cp.buildScore === "number") score += 2;
  if (positiveNumOrNull(cp.marketCapUsd) !== null) score += 1;
  if (positiveNumOrNull(cp.priceUsd) !== null) score += 1;
  return score;
}

/**
 * Merges and deduplicates audit checkpoints newest-first up to MAX_TOKEN_SCORE_HISTORY.
 */
export function mergeTokenScoreHistory(
  a?: TokenCheckCheckpoint[],
  b?: TokenCheckCheckpoint[]
): TokenCheckCheckpoint[] {
  const combined = [...(a || []), ...(b || [])].filter(
    (cp) =>
      Boolean(cp) &&
      typeof cp.scannedAt === "string" &&
      Number.isFinite(Date.parse(cp.scannedAt)) &&
      typeof cp.riskScore === "number" &&
      Number.isFinite(cp.riskScore)
  );

  combined.sort((x, y) => Date.parse(y.scannedAt) - Date.parse(x.scannedAt));

  const deduped: TokenCheckCheckpoint[] = [];
  for (const cp of combined) {
    const cpTs = Date.parse(cp.scannedAt);
    const existingIdx = deduped.findIndex((kept) => {
      if (cp.reportId && kept.reportId && cp.reportId === kept.reportId) {
        return true;
      }
      const keptTs = Date.parse(kept.scannedAt);
      const nearInTime = Math.abs(keptTs - cpTs) < 60_000;
      return (
        nearInTime &&
        kept.riskScore === cp.riskScore &&
        (kept.buildScore ?? null) === (cp.buildScore ?? null) &&
        (kept.reportId ?? null) === (cp.reportId ?? null) &&
        (kept.marketCapUsd ?? null) === (cp.marketCapUsd ?? null) &&
        (kept.priceUsd ?? null) === (cp.priceUsd ?? null)
      );
    });

    if (existingIdx === -1) {
      deduped.push(cp);
    } else if (checkpointRichnessScore(cp) > checkpointRichnessScore(deduped[existingIdx])) {
      deduped[existingIdx] = cp;
    }

    if (deduped.length >= MAX_TOKEN_SCORE_HISTORY) break;
  }

  return deduped;
}

function normalizeScannedTokenEntry(
  entry: ScannedTokenSummary
): ScannedTokenSummary {
  const firstPriceUsd =
    positiveNumOrNull(entry.firstPriceUsd) ?? positiveNumOrNull(entry.priceUsd);
  const firstMarketCapUsd =
    positiveNumOrNull(entry.firstMarketCapUsd) ??
    positiveNumOrNull(entry.marketCapUsd);
  const scoreHistory = mergeTokenScoreHistory(
    entry.scoreHistory && entry.scoreHistory.length > 0
      ? entry.scoreHistory
      : [buildCheckpointFromSummary(entry)],
    []
  );

  return {
    ...entry,
    priceUsd: positiveNumOrNull(entry.priceUsd) ?? undefined,
    marketCapUsd: positiveNumOrNull(entry.marketCapUsd) ?? undefined,
    liquidityUsd: nonNegNumOrNull(entry.liquidityUsd) ?? undefined,
    firstSeenAt: entry.firstSeenAt ?? entry.scannedAt,
    firstPriceUsd: firstPriceUsd ?? undefined,
    firstMarketCapUsd: firstMarketCapUsd ?? undefined,
    scoreHistory,
  };
}

function mergeScannedTokenEntries(
  prev: ScannedTokenSummary,
  entry: ScannedTokenSummary
): ScannedTokenSummary {
  const prevTs = Date.parse(prev.scannedAt) || 0;
  const nextTs = Date.parse(entry.scannedAt) || 0;
  // Primary list (`prev`) wins exact timestamp ties.
  const newer = nextTs > prevTs ? entry : prev;
  const older = nextTs > prevTs ? prev : entry;

  const firstSeenCandidates = [
    prev.firstSeenAt,
    entry.firstSeenAt,
    older.scannedAt,
    newer.scannedAt,
  ]
    .filter((v): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)))
    .sort((x, y) => Date.parse(x) - Date.parse(y));

  const firstPriceUsd =
    positiveNumOrNull(older.firstPriceUsd) ??
    positiveNumOrNull(older.priceUsd) ??
    positiveNumOrNull(newer.firstPriceUsd) ??
    positiveNumOrNull(newer.priceUsd);

  const firstMarketCapUsd =
    positiveNumOrNull(older.firstMarketCapUsd) ??
    positiveNumOrNull(older.marketCapUsd) ??
    positiveNumOrNull(newer.firstMarketCapUsd) ??
    positiveNumOrNull(newer.marketCapUsd);

  const priceUsd =
    positiveNumOrNull(newer.priceUsd) ?? positiveNumOrNull(older.priceUsd);
  const marketCapUsd =
    positiveNumOrNull(newer.marketCapUsd) ??
    positiveNumOrNull(older.marketCapUsd);
  const liquidityUsd =
    nonNegNumOrNull(newer.liquidityUsd) ?? nonNegNumOrNull(older.liquidityUsd);

  const buildCheckId = newer.buildCheckId ?? older.buildCheckId ?? null;
  const buildScore =
    typeof newer.buildScore === "number" && Number.isFinite(newer.buildScore)
      ? newer.buildScore
      : typeof older.buildScore === "number" && Number.isFinite(older.buildScore)
        ? older.buildScore
        : null;
  const buildVerdict = newer.buildVerdict ?? older.buildVerdict ?? null;

  const prevHistory =
    prev.scoreHistory && prev.scoreHistory.length > 0
      ? prev.scoreHistory
      : [buildCheckpointFromSummary(prev)];
  const entryHistory =
    entry.scoreHistory && entry.scoreHistory.length > 0
      ? entry.scoreHistory
      : [buildCheckpointFromSummary(entry)];

  return {
    ...newer,
    scanCount: Math.max(prev.scanCount || 1, entry.scanCount || 1),
    ...(buildCheckId ? { buildCheckId } : {}),
    ...(buildScore !== null ? { buildScore } : {}),
    ...(buildVerdict ? { buildVerdict } : {}),
    ...(priceUsd !== null ? { priceUsd } : {}),
    ...(marketCapUsd !== null ? { marketCapUsd } : {}),
    ...(liquidityUsd !== null ? { liquidityUsd } : {}),
    firstSeenAt: firstSeenCandidates[0] ?? older.scannedAt ?? newer.scannedAt,
    ...(firstPriceUsd !== null ? { firstPriceUsd } : {}),
    ...(firstMarketCapUsd !== null ? { firstMarketCapUsd } : {}),
    scoreHistory: mergeTokenScoreHistory(prevHistory, entryHistory),
  };
}

/**
 * Converts a full TokenScanReport into a lightweight public summary entry
 * for previously-scanned token feeds and local browser history.
 */
export function tokenReportToSummary(
  report: TokenScanReport,
  source: ScannedTokenSource,
  scannedAt = new Date().toISOString(),
  extra?: ScannedTokenExtraMetadata
): ScannedTokenSummary {
  const priceUsd = positiveNumOrNull(extra?.priceUsd);
  const marketCapUsd = positiveNumOrNull(extra?.marketCapUsd);
  const liquidityUsd = nonNegNumOrNull(extra?.liquidityUsd);
  const buildScore =
    typeof extra?.buildScore === "number" && Number.isFinite(extra.buildScore)
      ? Math.max(0, Math.min(100, Math.round(extra.buildScore)))
      : undefined;

  const summary: ScannedTokenSummary = {
    mintAddress: report.mintAddress,
    symbol: report.symbol ?? report.verifiedAsset?.symbol ?? null,
    name: report.name ?? report.verifiedAsset?.name ?? null,
    tokenProgram: report.tokenProgram,
    riskScore: report.riskScore,
    classification: report.classification,
    recommendedAction: report.recommendedAction,
    verifiedIssuer: report.verifiedAsset?.issuer ?? null,
    slot: report.slot,
    scannedAt,
    source,
    scanCount: 1,
    ...(extra?.buildCheckId ? { buildCheckId: extra.buildCheckId } : {}),
    ...(buildScore !== undefined ? { buildScore } : {}),
    ...(extra?.buildVerdict ? { buildVerdict: extra.buildVerdict } : {}),
    ...(priceUsd !== null ? { priceUsd, firstPriceUsd: priceUsd } : {}),
    ...(marketCapUsd !== null
      ? { marketCapUsd, firstMarketCapUsd: marketCapUsd }
      : {}),
    ...(liquidityUsd !== null ? { liquidityUsd } : {}),
    firstSeenAt: scannedAt,
  };

  summary.scoreHistory = [buildCheckpointFromSummary(summary)];
  return summary;
}

/**
 * Deduplicates and merges scanned token lists by `mintAddress`, keeping the most recent scan
 * metadata while preserving the highest observed `scanCount`, earliest baseline, and checkpoint history.
 */
export function mergeScannedTokenLists(
  primary: ScannedTokenSummary[],
  secondary: ScannedTokenSummary[],
  limit = 24
): ScannedTokenSummary[] {
  const map = new Map<string, ScannedTokenSummary>();

  const upsert = (entry: ScannedTokenSummary) => {
    if (!entry || !entry.mintAddress) return;
    const prev = map.get(entry.mintAddress);
    if (!prev) {
      map.set(entry.mintAddress, normalizeScannedTokenEntry(entry));
      return;
    }
    map.set(entry.mintAddress, mergeScannedTokenEntries(prev, entry));
  };

  for (const item of primary) upsert(item);
  for (const item of secondary) upsert(item);

  return Array.from(map.values())
    .sort((a, b) => (Date.parse(b.scannedAt) || 0) - (Date.parse(a.scannedAt) || 0))
    .slice(0, Math.max(1, limit));
}

export function readLocalScannedTokens(): ScannedTokenSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCANNED_TOKENS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ScannedTokenSummary =>
        Boolean(item && typeof item === "object" && "mintAddress" in item)
    );
  } catch {
    return [];
  }
}

export function saveLocalScannedToken(
  report: TokenScanReport,
  source: ScannedTokenSource,
  limit = 24,
  extra?: ScannedTokenExtraMetadata
): ScannedTokenSummary[] {
  const entry = tokenReportToSummary(report, source, new Date().toISOString(), extra);
  const existing = readLocalScannedTokens();
  const prev = existing.find((item) => item.mintAddress === entry.mintAddress);
  if (prev) {
    entry.scanCount = (prev.scanCount || 1) + 1;
  }
  const next = mergeScannedTokenLists([entry], existing, limit);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SCANNED_TOKENS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

export function clearLocalScannedTokens(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SCANNED_TOKENS_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
}
