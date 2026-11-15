import { getCachedEntry, setCachedEntry } from "../scan-cache";
import { runUpstashCommand } from "../upstash-rest";
import type { BuildCheckReport } from "./types";

export const BUILDCHECK_REPORT_NAMESPACE = "buildcheck-report";
export const BUILDCHECK_REPORT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
export const BUILDCHECK_REPORT_TTL_MS = BUILDCHECK_REPORT_TTL_SEC * 1000;
export const BUILDCHECK_REPORT_ID_RE = /^bc_[a-z0-9_-]{4,36}$/i;

export const MAX_REDIS_REPORT_BYTES = 450_000;

function redisReportKey(id: string): string {
  return `solshield:buildcheck:report:${id.toLowerCase()}`;
}

/**
 * Validates that a shareable BuildCheck report ID matches `bc_<slug>` and is safe for key construction.
 */
export function isValidBuildCheckReportId(
  id: string | null | undefined
): id is string {
  return typeof id === "string" && BUILDCHECK_REPORT_ID_RE.test(id.trim());
}

/**
 * Strips heavy base64 screenshots and oversize raw excerpts while preserving
 * all forensic scores, claims-vs-proof rows, chain/holders/dev telemetry, and stops metadata
 * so reports fit comfortably in distributed Redis storage for `/buildcheck?report=<id>`.
 */
export function compactBuildCheckReportForPermalink(
  report: BuildCheckReport
): BuildCheckReport {
  const stops = Array.isArray(report.browser?.stops)
    ? report.browser.stops.map((stop) => ({
        ...stop,
        screenshotBase64: "",
        textExcerpt:
          typeof stop.textExcerpt === "string"
            ? stop.textExcerpt.slice(0, 1800)
            : "",
        apiPayloads: Array.isArray(stop.apiPayloads)
          ? stop.apiPayloads.slice(0, 4).map((p) => ({
              ...p,
              jsonExcerpt:
                typeof p.jsonExcerpt === "string"
                  ? p.jsonExcerpt.slice(0, 900)
                  : "",
            }))
          : undefined,
      }))
    : [];

  return {
    ...report,
    browser: {
      ...report.browser,
      stops,
      inspectedApiPayloads: Array.isArray(report.browser?.inspectedApiPayloads)
        ? report.browser.inspectedApiPayloads.slice(0, 6).map((p) => ({
            ...p,
            jsonExcerpt:
              typeof p.jsonExcerpt === "string"
                ? p.jsonExcerpt.slice(0, 900)
                : "",
          }))
        : undefined,
    },
  };
}

function serializeWithinSizeBudget(report: BuildCheckReport): string {
  let current = compactBuildCheckReportForPermalink(report);
  let raw = JSON.stringify(current);
  if (Buffer.byteLength(raw, "utf8") <= MAX_REDIS_REPORT_BYTES) {
    return raw;
  }

  // Secondary trim if target returned huge dev history or text blobs
  current = {
    ...current,
    browser: {
      ...current.browser,
      stops: current.browser.stops.map((stop) => ({
        ...stop,
        textExcerpt: stop.textExcerpt.slice(0, 400),
        apiPayloads: undefined,
      })),
      inspectedApiPayloads: undefined,
    },
    chain: current.chain?.deep
      ? {
          ...current.chain,
          deep: {
            ...current.chain.deep,
            holders: {
              ...current.chain.deep.holders,
              nodes: current.chain.deep.holders.nodes.slice(0, 15),
            },
            devHistory: {
              ...current.chain.deep.devHistory,
              launchedTokens:
                current.chain.deep.devHistory.launchedTokens.slice(0, 10),
              recentTxs: current.chain.deep.devHistory.recentTxs.slice(0, 10),
            },
          },
        }
      : current.chain,
  };
  raw = JSON.stringify(current);
  if (Buffer.byteLength(raw, "utf8") <= MAX_REDIS_REPORT_BYTES) {
    return raw;
  }

  // Pass 3: Strict Redis budget trim (drop heavy graph nodes & long excerpts while preserving verdict/proof)
  current = {
    ...current,
    executiveSummary: current.executiveSummary.slice(0, 800),
    visionSummary: current.visionSummary ? current.visionSummary.slice(0, 600) : null,
    claimsVsProof: current.claimsVsProof.slice(0, 8),
    browser: {
      ...current.browser,
      stops: current.browser.stops.slice(0, 4).map((stop) => ({
        ...stop,
        screenshotBase64: "",
        textExcerpt: "",
        apiPayloads: [],
      })),
      inspectedApiPayloads: [],
    },
    chain: current.chain
      ? {
          ...current.chain,
          deep: current.chain.deep
            ? {
                ...current.chain.deep,
                holders: {
                  ...current.chain.deep.holders,
                  nodes: [],
                  clusters: (current.chain.deep.holders.clusters || [])
                    .slice(0, 5)
                    .map((cluster) => ({
                      ...cluster,
                      wallets: (cluster.wallets || []).slice(0, 3),
                    })),
                },
                devHistory: {
                  ...current.chain.deep.devHistory,
                  launchedTokens: (
                    current.chain.deep.devHistory.launchedTokens || []
                  ).slice(0, 5),
                  recentTxs: (current.chain.deep.devHistory.recentTxs || []).slice(0, 6),
                },
              }
            : null,
        }
      : null,
  };
  raw = JSON.stringify(current);
  if (Buffer.byteLength(raw, "utf8") <= MAX_REDIS_REPORT_BYTES) {
    return raw;
  }

  // Pass 4: Extreme emergency trim so oversized targets still persist in Redis
  current = {
    ...current,
    browser: {
      ...current.browser,
      stops: current.browser.stops.slice(0, 2),
    },
    chain: current.chain
      ? {
          ...current.chain,
          deep: current.chain.deep
            ? {
                ...current.chain.deep,
                holders: {
                  ...current.chain.deep.holders,
                  nodes: [],
                  clusters: [],
                },
              }
            : null,
        }
      : null,
    xPost: current.xPost
      ? {
          ...current.xPost,
          textContent: current.xPost.textContent?.slice(0, 400) ?? null,
        }
      : null,
  };
  raw = JSON.stringify(current);
  return raw;
}

/**
 * Compacts and size-bounds a BuildCheck report so external callers (such as bots)
 * always post payloads strictly within the Redis permalink storage budget.
 */
export function compactBuildCheckReportWithinBudget(
  report: BuildCheckReport
): BuildCheckReport {
  return JSON.parse(serializeWithinSizeBudget(report)) as BuildCheckReport;
}

/**
 * Persists a compact BuildCheck report by its `report.id` across local scan cache
 * and Upstash Redis (when configured) so permalink URLs resolve across instances.
 */
export async function saveBuildCheckReportPermalink(
  report: BuildCheckReport
): Promise<{ id: string; storedInRedis: boolean }> {
  const id = report?.id?.trim();
  if (!isValidBuildCheckReportId(id)) {
    throw new Error("Invalid BuildCheck report ID.");
  }

  const cleanId = id.trim();
  const normalizedId = cleanId.toLowerCase();
  const compact = compactBuildCheckReportForPermalink({
    ...report,
    id: cleanId,
  });

  await setCachedEntry(
    BUILDCHECK_REPORT_NAMESPACE,
    normalizedId,
    compact,
    BUILDCHECK_REPORT_TTL_MS
  );

  let storedInRedis = false;
  try {
    const payload = serializeWithinSizeBudget(compact);
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (payloadBytes <= MAX_REDIS_REPORT_BYTES) {
      const res = await runUpstashCommand<string>(
        ["SET", redisReportKey(normalizedId), payload, "EX", BUILDCHECK_REPORT_TTL_SEC],
        3500
      );
      storedInRedis = res === "OK";
      if (!storedInRedis && Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)) {
        console.warn(
          `[ReportStore] Redis SET for ${normalizedId} (${payloadBytes} bytes) returned:`,
          res
        );
      }
    } else {
      console.warn(
        `[ReportStore] Report ${normalizedId} (${payloadBytes} bytes) exceeded Redis size limit (${MAX_REDIS_REPORT_BYTES}); skipped Redis save.`
      );
    }
  } catch (err) {
    console.warn(
      `[ReportStore] Failed saving ${normalizedId} to Redis:`,
      err instanceof Error ? err.message : err
    );
    storedInRedis = false;
  }

  return { id: normalizedId, storedInRedis };
}

/**
 * Retrieves a persisted BuildCheck report by `report.id` from local cache or Upstash Redis.
 */
export async function getBuildCheckReportPermalink(
  rawId: string
): Promise<BuildCheckReport | null> {
  if (!isValidBuildCheckReportId(rawId)) return null;
  const normalizedId = rawId.trim().toLowerCase();

  const cached = await getCachedEntry<BuildCheckReport>(
    BUILDCHECK_REPORT_NAMESPACE,
    normalizedId
  );
  if (cached?.value) {
    return cached.value;
  }

  try {
    const raw = await runUpstashCommand<string>(
      ["GET", redisReportKey(normalizedId)],
      3500
    );
    if (!raw || typeof raw !== "string") return null;
    const parsed = JSON.parse(raw) as Partial<BuildCheckReport>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.id !== "string" ||
      !parsed.target ||
      typeof parsed.authenticityScore !== "number"
    ) {
      return null;
    }
    const report = parsed as BuildCheckReport;
    await setCachedEntry(
      BUILDCHECK_REPORT_NAMESPACE,
      normalizedId,
      report,
      BUILDCHECK_REPORT_TTL_MS
    );
    return report;
  } catch {
    return null;
  }
}
