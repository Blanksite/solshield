import type { TokenScanReport } from "./token-scanner";

export type ScannedTokenSource = "token-xray" | "buildcheck" | "tx-firewall";

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
}

export const SCANNED_TOKENS_STORAGE_KEY = "solshield_scanned_tokens_v1";

/**
 * Converts a full TokenScanReport into a lightweight public summary entry
 * for previously-scanned token feeds and local browser history.
 */
export function tokenReportToSummary(
  report: TokenScanReport,
  source: ScannedTokenSource,
  scannedAt = new Date().toISOString()
): ScannedTokenSummary {
  return {
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
  };
}

/**
 * Deduplicates and merges scanned token lists by `mintAddress`, keeping the most recent scan
 * metadata while preserving the highest observed `scanCount`.
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
      map.set(entry.mintAddress, entry);
      return;
    }
    const prevTs = Date.parse(prev.scannedAt) || 0;
    const nextTs = Date.parse(entry.scannedAt) || 0;
    const newest = nextTs >= prevTs ? entry : prev;
    map.set(entry.mintAddress, {
      ...newest,
      scanCount: Math.max(prev.scanCount || 1, entry.scanCount || 1),
    });
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
  limit = 24
): ScannedTokenSummary[] {
  const entry = tokenReportToSummary(report, source);
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
