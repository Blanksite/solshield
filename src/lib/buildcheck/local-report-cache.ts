import type { BuildCheckReport } from "./types";
import {
  mergeScannedTokenLists,
  readLocalScannedTokens,
  type ScannedTokenSummary,
} from "../scanned-token-types";

export const LOCAL_BUILDCHECK_REPORTS_KEY = "solshield_buildcheck_reports_v1";
export const LOCAL_REPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_LOCAL_BUILDCHECK_REPORTS = 8;

interface StoredLocalReportEntry {
  id: string;
  savedAtMs: number;
  report: BuildCheckReport;
}

function normalizeReportId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isLocalReportIdShape(id: string): boolean {
  return /^bc_[a-z0-9_-]{4,40}$/i.test(id.trim());
}

/**
 * Strips heavy base64 screenshots and bounds large arrays so recent BuildCheck
 * reports fit comfortably inside browser localStorage alongside ledger entries.
 */
export function compactReportForLocalCache(
  report: BuildCheckReport
): BuildCheckReport {
  return {
    ...report,
    id: normalizeReportId(report.id),
    browser: {
      ...report.browser,
      stops: (report.browser?.stops || []).slice(0, 6).map((stop) => ({
        ...stop,
        screenshotBase64: "",
        textExcerpt: (stop.textExcerpt || "").slice(0, 800),
        apiPayloads: stop.apiPayloads?.slice(0, 4).map((p) => ({
          ...p,
          jsonExcerpt: (p.jsonExcerpt || "").slice(0, 400),
        })),
      })),
      inspectedApiPayloads: report.browser?.inspectedApiPayloads
        ?.slice(0, 4)
        .map((p) => ({
          ...p,
          jsonExcerpt: (p.jsonExcerpt || "").slice(0, 400),
        })),
    },
    chain: report.chain
      ? {
          ...report.chain,
          deep: report.chain.deep
            ? {
                ...report.chain.deep,
                holders: {
                  ...report.chain.deep.holders,
                  nodes: (report.chain.deep.holders.nodes || []).slice(0, 35),
                  clusters: (report.chain.deep.holders.clusters || [])
                    .slice(0, 8)
                    .map((cluster) => ({
                      ...cluster,
                      wallets: (cluster.wallets || []).slice(0, 6),
                    })),
                },
                devHistory: {
                  ...report.chain.deep.devHistory,
                  launchedTokens: (
                    report.chain.deep.devHistory.launchedTokens || []
                  ).slice(0, 12),
                  recentTxs: (
                    report.chain.deep.devHistory.recentTxs || []
                  ).slice(0, 15),
                },
              }
            : null,
        }
      : null,
  };
}

function readLocalEntriesRaw(nowMs = Date.now()): StoredLocalReportEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_BUILDCHECK_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredLocalReportEntry =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as StoredLocalReportEntry).id === "string" &&
            typeof (item as StoredLocalReportEntry).savedAtMs === "number" &&
            nowMs - (item as StoredLocalReportEntry).savedAtMs <=
              LOCAL_REPORT_TTL_MS &&
            (item as StoredLocalReportEntry).report &&
            typeof (item as StoredLocalReportEntry).report === "object"
        )
    );
  } catch {
    return [];
  }
}

export function saveLocalBuildCheckReport(
  report: BuildCheckReport,
  nowMs = Date.now()
): void {
  if (typeof window === "undefined" || !report?.id) return;
  const normalizedId = normalizeReportId(report.id);
  if (!isLocalReportIdShape(normalizedId)) return;

  const compact = compactReportForLocalCache(report);
  const existing = readLocalEntriesRaw(nowMs).filter(
    (entry) => normalizeReportId(entry.id) !== normalizedId
  );
  const next: StoredLocalReportEntry[] = [
    { id: normalizedId, savedAtMs: nowMs, report: compact },
    ...existing,
  ].slice(0, MAX_LOCAL_BUILDCHECK_REPORTS);

  for (const cap of [MAX_LOCAL_BUILDCHECK_REPORTS, 4, 2, 1]) {
    try {
      window.localStorage.setItem(
        LOCAL_BUILDCHECK_REPORTS_KEY,
        JSON.stringify(next.slice(0, cap))
      );
      return;
    } catch {
      // Retry with smaller retention count if localStorage quota is tight
    }
  }
}

export function readLocalBuildCheckReport(
  reportId: string,
  nowMs = Date.now()
): BuildCheckReport | null {
  if (typeof window === "undefined") return null;
  const cleanId = normalizeReportId(reportId || "");
  if (!isLocalReportIdShape(cleanId)) return null;
  const match = readLocalEntriesRaw(nowMs).find(
    (entry) => normalizeReportId(entry.id) === cleanId
  );
  return match?.report ?? null;
}

/**
 * Resolves the Solana mint CA linked to an older or expired BuildCheck report ID
 * from either the token's primary `buildCheckId` or historical checkpoints.
 */
export function findMintByReportIdInTokens(
  tokens: ScannedTokenSummary[],
  reportId: string
): string | null {
  const cleanId = normalizeReportId(reportId || "");
  if (!cleanId) return null;

  for (const tok of tokens) {
    if (
      tok.buildCheckId &&
      normalizeReportId(tok.buildCheckId) === cleanId &&
      tok.mintAddress
    ) {
      return tok.mintAddress;
    }
    if (Array.isArray(tok.scoreHistory)) {
      for (const cp of tok.scoreHistory) {
        if (cp?.reportId && normalizeReportId(cp.reportId) === cleanId) {
          return tok.mintAddress;
        }
      }
    }
  }
  return null;
}

/**
 * Looks up a missing report ID against in-memory/localStorage ledger tokens first,
 * then queries `/api/scanned-tokens?limit=40` so cross-environment or expired links
 * can auto-recover with a fresh scan of the underlying token CA.
 */
export async function resolveFallbackMintForReport(
  reportId: string,
  inMemoryTokens: ScannedTokenSummary[] = []
): Promise<string | null> {
  const localTokens = readLocalScannedTokens();
  const initialPool = mergeScannedTokenLists(inMemoryTokens, localTokens, 40);
  const directMatch = findMintByReportIdInTokens(initialPool, reportId);
  if (directMatch) return directMatch;

  if (typeof window === "undefined") return null;
  try {
    let res = await fetch("/api/scanned-tokens?limit=40", {
      cache: "no-store",
    });
    if (res.status === 401) {
      await fetch(window.location.pathname || "/buildcheck", {
        method: "HEAD",
        credentials: "same-origin",
      }).catch(() => undefined);
      res = await fetch("/api/scanned-tokens?limit=40", {
        cache: "no-store",
      });
    }
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      tokens?: ScannedTokenSummary[];
    } | null;
    if (!data?.ok || !Array.isArray(data.tokens)) return null;
    const merged = mergeScannedTokenLists(data.tokens, initialPool, 40);
    return findMintByReportIdInTokens(merged, reportId);
  } catch {
    return null;
  }
}
