import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PublicKey } from "@solana/web3.js";
import {
  analyzeBase64Transaction,
  DeterministicSimulationReport,
  ThreatFlag,
} from "./solana-parser";

const DEFAULT_INSPECT_ACCOUNT = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const MAX_ACTION_JSON_BYTES = 512 * 1024;

export interface BlinkActionInspectionMeta {
  inspectionMode:
    | "live-action-tx-audited"
    | "live-action-post-blocked"
    | "live-action-get-only"
    | "live-action-unreachable";
  actionUrl: string;
  postUrl?: string;
  title?: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  actionsCount?: number;
  httpGetStatus?: number;
  httpPostStatus?: number;
  failureReason?: string;
}

export interface AuditedBlinkReportBundle {
  report: DeterministicSimulationReport;
  blinkMeta: BlinkActionInspectionMeta;
}

export class BlinkInspectionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BlinkInspectionError";
    this.status = status;
  }
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to loopback, private,
 * carrier-grade NAT, multicast, or link-local ranges (SSRF guard).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 0) return true;

  if (version === 4) {
    const parts = normalized.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a >= 224) return true; // multicast & reserved
    return false;
  }

  // IPv6 guards
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA fc00::/7
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true; // link-local fe80::/10
  }
  if (normalized.startsWith("ff")) return true; // multicast
  if (normalized.startsWith("::ffff:")) {
    const mappedV4 = normalized.slice("::ffff:".length);
    if (isIP(mappedV4) === 4) {
      return isPrivateOrReservedIp(mappedV4);
    }
    // Check hex form ::ffff:7f00:0001 etc.
    return true;
  }
  return false;
}

/**
 * Unwraps `solana-action:` or `dial.to/?action=` URLs and enforces strict HTTPS
 * + anti-SSRF hostname checks.
 */
export function parseSafeBlinkActionUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new BlinkInspectionError(
      "Blink URL must be a valid non-empty URL under 2048 characters.",
      400
    );
  }

  let candidate = trimmed;
  if (candidate.toLowerCase().startsWith("solana-action:")) {
    candidate = candidate.slice("solana-action:".length);
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BlinkInspectionError("Malformed Blink / Solana Action URL.", 400);
  }

  // Support dial.to interstitial wrapper links: https://dial.to/?action=solana-action:...
  if (
    (parsed.hostname === "dial.to" || parsed.hostname.endsWith(".dial.to")) &&
    parsed.searchParams.get("action")
  ) {
    const inner = parsed.searchParams.get("action")!;
    return parseSafeBlinkActionUrl(inner);
  }

  if (parsed.protocol !== "https:") {
    throw new BlinkInspectionError(
      "Only HTTPS Solana Action URLs are permitted for inspection.",
      400
    );
  }

  if (parsed.username || parsed.password) {
    throw new BlinkInspectionError(
      "Blink URLs containing embedded credentials are rejected.",
      400
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new BlinkInspectionError(
      "Local or internal hostnames are blocked by SolShield SSRF policy.",
      400
    );
  }

  if (isIP(host) !== 0 && isPrivateOrReservedIp(host)) {
    throw new BlinkInspectionError(
      "Private or reserved IP targets are blocked by SolShield SSRF policy.",
      400
    );
  }

  return parsed;
}

async function assertHostnameResolvesPublic(hostname: string): Promise<void> {
  if (isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new BlinkInspectionError(
        "Resolved IP address falls in a private/reserved range.",
        400
      );
    }
    return;
  }

  const records = await lookup(hostname, { all: true, verbatim: false });
  if (!records || records.length === 0) {
    throw new BlinkInspectionError(`DNS lookup returned no records for ${hostname}.`, 502);
  }
  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new BlinkInspectionError(
        `DNS resolution for ${hostname} resolved to blocked non-public IP ${record.address}.`,
        400
      );
    }
  }
}

async function readBoundedJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_ACTION_JSON_BYTES) {
    throw new BlinkInspectionError(
      "Solana Action response exceeded 512KB payload limit.",
      502
    );
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function fetchActionJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = 4000
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
      cache: "no-store",
    });
    const json = await readBoundedJson(res).catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function buildDiagnosticBlinkReport(params: {
  actionUrl: string;
  title?: string;
  description?: string;
  threatCode: ThreatFlag["code"];
  threatTitle: string;
  threatDescription: string;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  score: number;
  account: string;
}): DeterministicSimulationReport {
  return {
    sourceType: "BLINK_URL",
    feePayer: params.account,
    recentBlockhash: "",
    instructions: [],
    balanceDeltas: [],
    threatFlags: [
      {
        code: params.threatCode,
        severity: params.severity,
        title: params.threatTitle,
        description: params.threatDescription,
      },
    ],
    deterministicRiskScore: params.score,
    deterministicClassification:
      params.score >= 70 ? "CRITICAL" : params.score >= 30 ? "WARNING" : "SAFE",
    hasUnverifiedTransferHook: false,
    estimatedSpendLamports: 0,
  };
}

/**
 * Fetches live Solana Action GET metadata and POST transaction payload under strict
 * SSRF + timeout guards, then decompiles any returned transaction via `analyzeBase64Transaction`.
 */
export async function inspectLiveBlinkUrl(params: {
  blinkUrl: string;
  account?: string;
  fetchImpl?: typeof fetch;
  skipDnsCheck?: boolean;
}): Promise<AuditedBlinkReportBundle> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const skipDnsCheck = params.skipDnsCheck ?? Boolean(params.fetchImpl);

  const actionUrl = parseSafeBlinkActionUrl(params.blinkUrl);
  if (!skipDnsCheck) {
    try {
      await assertHostnameResolvesPublic(actionUrl.hostname);
    } catch (err: unknown) {
      if (err instanceof BlinkInspectionError && err.status === 400) {
        throw err;
      }
      // DNS lookup failure means destination host cannot be reached safely.
      const reason =
        err instanceof Error ? err.message : "DNS resolution failed.";
      return {
        report: buildDiagnosticBlinkReport({
          actionUrl: actionUrl.toString(),
          threatCode: "BLINK_ENDPOINT_UNVERIFIED",
          threatTitle: "Unreachable Solana Action Endpoint",
          threatDescription: `Could not resolve or reach ${actionUrl.hostname} (${reason}). Never blindly trust unreachable Blink action URLs.`,
          severity: "HIGH",
          score: 55,
          account: DEFAULT_INSPECT_ACCOUNT,
        }),
        blinkMeta: {
          inspectionMode: "live-action-unreachable",
          actionUrl: actionUrl.toString(),
          failureReason: reason,
        },
      };
    }
  }

  let inspectAccount = DEFAULT_INSPECT_ACCOUNT;
  if (params.account) {
    try {
      inspectAccount = new PublicKey(params.account).toBase58();
    } catch {
      inspectAccount = DEFAULT_INSPECT_ACCOUNT;
    }
  }

  let getStatus = 0;
  let getJson: Record<string, unknown> | null = null;
  try {
    const res = await fetchActionJson(fetchImpl, actionUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    getStatus = res.status;
    getJson = res.json;
  } catch (err: unknown) {
    const reason =
      err instanceof Error ? err.message : "Live HTTP GET fetch failed.";
    return {
      report: buildDiagnosticBlinkReport({
        actionUrl: actionUrl.toString(),
        threatCode: "BLINK_ENDPOINT_UNVERIFIED",
        threatTitle: "Blink Action Endpoint Unreachable",
        threatDescription: `Live Action GET to ${actionUrl.toString()} failed (${reason}). Unverified or offline Blink endpoints are treated as elevated risk.`,
        severity: "HIGH",
        score: 55,
        account: inspectAccount,
      }),
      blinkMeta: {
        inspectionMode: "live-action-unreachable",
        actionUrl: actionUrl.toString(),
        failureReason: reason,
      },
    };
  }

  if (getStatus < 200 || getStatus >= 300 || !getJson) {
    const reason = `HTTP ${getStatus || "error"} from Action GET`;
    return {
      report: buildDiagnosticBlinkReport({
        actionUrl: actionUrl.toString(),
        threatCode: "BLINK_ENDPOINT_UNVERIFIED",
        threatTitle: "Invalid or Rejected Action Metadata",
        threatDescription: `${actionUrl.toString()} responded with ${reason} or invalid Action JSON.`,
        severity: "MEDIUM",
        score: 45,
        account: inspectAccount,
      }),
      blinkMeta: {
        inspectionMode: "live-action-unreachable",
        actionUrl: actionUrl.toString(),
        httpGetStatus: getStatus,
        failureReason: reason,
      },
    };
  }

  const title = typeof getJson.title === "string" ? getJson.title : undefined;
  const label = typeof getJson.label === "string" ? getJson.label : undefined;
  const description =
    typeof getJson.description === "string" ? getJson.description : undefined;
  const disabled = Boolean(getJson.disabled);
  const links =
    getJson.links && typeof getJson.links === "object"
      ? (getJson.links as { actions?: Array<{ href?: string; label?: string }> })
      : undefined;
  const actionsList = Array.isArray(links?.actions) ? links.actions : [];

  // Choose first concrete POST href or fall back to base action URL.
  let postUrl = actionUrl.toString();
  const candidateAction = actionsList.find(
    (item) => typeof item?.href === "string" && item.href.trim().length > 0
  );
  if (candidateAction?.href) {
    const materializedHref = candidateAction.href.replace(/\{amount\}/gi, "1");
    if (!/\{[^}]+\}/.test(materializedHref)) {
      const resolvedUrl = new URL(materializedHref, actionUrl.origin);
      const checkedPostUrl = parseSafeBlinkActionUrl(resolvedUrl.toString());
      if (!skipDnsCheck) {
        await assertHostnameResolvesPublic(checkedPostUrl.hostname);
      }
      postUrl = checkedPostUrl.toString();
    }
  }

  try {
    const postRes = await fetchActionJson(fetchImpl, postUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ account: inspectAccount }),
    });

    const txBase64 =
      postRes.json && typeof postRes.json.transaction === "string"
        ? postRes.json.transaction
        : null;

    if (postRes.status >= 200 && postRes.status < 300 && txBase64) {
      const report = analyzeBase64Transaction(txBase64);
      report.sourceType = "BLINK_URL";
      return {
        report,
        blinkMeta: {
          inspectionMode: "live-action-tx-audited",
          actionUrl: actionUrl.toString(),
          postUrl,
          title,
          label,
          description,
          disabled,
          actionsCount: actionsList.length,
          httpGetStatus: getStatus,
          httpPostStatus: postRes.status,
        },
      };
    }

    const errorObj = postRes.json?.error;
    const errorMessage =
      errorObj &&
      typeof errorObj === "object" &&
      "message" in errorObj &&
      typeof (errorObj as { message?: unknown }).message === "string"
        ? (errorObj as { message: string }).message
        : null;
    const remoteErr: string =
      errorMessage ||
      (typeof postRes.json?.message === "string" ? postRes.json.message : null) ||
      `HTTP ${postRes.status}`;

    return {
      report: buildDiagnosticBlinkReport({
        actionUrl: actionUrl.toString(),
        title,
        description,
        threatCode: "BLINK_ENDPOINT_UNVERIFIED",
        threatTitle:
          postRes.status === 403
            ? "Action Rejected Transaction Build (403)"
            : "Action POST Did Not Return Transaction Payload",
        threatDescription: `Solana Action POST to ${postUrl} returned ${remoteErr}.`,
        severity: postRes.status === 403 ? "HIGH" : "MEDIUM",
        score: postRes.status === 403 ? 65 : 40,
        account: inspectAccount,
      }),
      blinkMeta: {
        inspectionMode:
          postRes.status === 403
            ? "live-action-post-blocked"
            : "live-action-get-only",
        actionUrl: actionUrl.toString(),
        postUrl,
        title,
        label,
        description,
        disabled,
        actionsCount: actionsList.length,
        httpGetStatus: getStatus,
        httpPostStatus: postRes.status,
        failureReason: remoteErr,
      },
    };
  } catch (err: unknown) {
    const reason =
      err instanceof Error ? err.message : "Action POST request failed.";
    return {
      report: buildDiagnosticBlinkReport({
        actionUrl: actionUrl.toString(),
        title,
        description,
        threatCode: "BLINK_ENDPOINT_UNVERIFIED",
        threatTitle: "Could Not Retrieve Action Transaction Payload",
        threatDescription: `Fetched Action GET (${title ?? actionUrl.hostname}), but POST ${postUrl} failed: ${reason}.`,
        severity: "MEDIUM",
        score: 40,
        account: inspectAccount,
      }),
      blinkMeta: {
        inspectionMode: "live-action-get-only",
        actionUrl: actionUrl.toString(),
        postUrl,
        title,
        label,
        description,
        disabled,
        actionsCount: actionsList.length,
        httpGetStatus: getStatus,
        failureReason: reason,
      },
    };
  }
}
