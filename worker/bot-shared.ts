import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";
import { tokenReportToSummary } from "../src/lib/scanned-token-types";

export function parseBooleanEnv(
  raw: string | undefined,
  defaultValue: boolean
): boolean {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  return defaultValue;
}

export function parsePositiveIntEnv(
  raw: string | undefined,
  defaultValue: number,
  min = 0
): number {
  const num = Number(raw?.trim());
  if (!Number.isFinite(num)) return defaultValue;
  return Math.max(min, Math.floor(num));
}

export function getUtcDateKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Atomically writes a JSON-serializable object via a temporary sibling file and rename.
 */
export function saveJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Publishes scanned token metadata to the web feed when `syncEnabled` and `SOLSHIELD_API_SECRET` are set.
 */
export async function syncScannedTokenToWeb(
  report: BuildCheckReport,
  appPublicUrl: string,
  syncEnabled: boolean
): Promise<void> {
  if (!syncEnabled || !report.chain?.tokenReport) return;
  const apiSecret = process.env.SOLSHIELD_API_SECRET?.trim();
  if (!apiSecret) return;

  const endpoint = `${appPublicUrl.replace(/\/+$/, "")}/api/scanned-tokens`;
  const summary = tokenReportToSummary(report.chain.tokenReport, "buildcheck");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-solshield-api-key": apiSecret,
      },
      body: JSON.stringify({ summary }),
      signal: controller.signal,
    });
    if (res.ok) {
      console.log(
        `[Sync] Published ${summary.mintAddress.slice(0, 8)}... (${summary.symbol || "SPL"}) to web feed.`
      );
    } else {
      console.warn(
        `[Sync Warn] Web feed returned HTTP ${res.status} for ${summary.mintAddress}`
      );
    }
  } catch (err) {
    console.warn(
      "[Sync Warn] Could not publish scanned token to web feed:",
      err instanceof Error ? err.message : err
    );
  } finally {
    clearTimeout(timer);
  }
}

export function sleepInterruptible(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Starts a lightweight `/health` HTTP server for Railway / container liveness checks.
 */
export function startBotHealthServer(options: {
  port: number;
  logPrefix: string;
  getStatusPayload: () => Record<string, unknown>;
}): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(options.getStatusPayload()));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });
  server.listen(options.port, "0.0.0.0", () => {
    console.log(
      `${options.logPrefix} Health endpoint listening on :${options.port}/health`
    );
  });
  return server;
}
