import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "../../../lib/api-guard";
import { corsJson, corsOptionsResponse } from "../../../lib/cors";
import type {
  ScannedTokenBuildVerdict,
  ScannedTokenSummary,
  TokenCheckCheckpoint,
} from "../../../lib/scanned-token-types";
import { listScannedTokens, recordScannedTokenSummary } from "../../../lib/scanned-tokens";

export const dynamic = "force-dynamic";

const BASE58_OR_EVM_MINT_RE = /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})$/;
const BUILDCHECK_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
const VALID_CLASSIFICATIONS = new Set(["SAFE", "CAUTION", "CRITICAL"]);
const VALID_ACTIONS = new Set(["VERIFIED_SAFE", "DYOR_CAUTION", "HIGH_RUG_RISK"]);
const VALID_SOURCES = new Set(["token-xray", "buildcheck", "tx-firewall"]);
const VALID_BUILD_VERDICTS = new Set([
  "VERIFIED_BUILD",
  "UNPROVEN_HYPE",
  "HIGH_FABRICATION_RISK",
]);

function optPositiveNum(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function optNonNegNum(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

function optScore(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) {
    return null;
  }
  return Math.round(raw);
}

function parseScoreHistory(raw: unknown): TokenCheckCheckpoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: TokenCheckCheckpoint[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const scannedAt =
      typeof row.scannedAt === "string" && Number.isFinite(Date.parse(row.scannedAt))
        ? row.scannedAt
        : null;
    const riskScore = optScore(row.riskScore);
    if (!scannedAt || riskScore === null) continue;
    const buildScore = optScore(row.buildScore);
    const buildVerdict =
      typeof row.buildVerdict === "string" && VALID_BUILD_VERDICTS.has(row.buildVerdict)
        ? (row.buildVerdict as ScannedTokenBuildVerdict)
        : null;
    const reportId =
      typeof row.reportId === "string" && BUILDCHECK_ID_RE.test(row.reportId.trim())
        ? row.reportId.trim()
        : null;
    const marketCapUsd = optPositiveNum(row.marketCapUsd);
    const priceUsd = optPositiveNum(row.priceUsd);
    const source =
      typeof row.source === "string" && VALID_SOURCES.has(row.source)
        ? (row.source as ScannedTokenSummary["source"])
        : undefined;
    out.push({
      scannedAt,
      riskScore,
      ...(buildScore !== null ? { buildScore } : {}),
      ...(buildVerdict ? { buildVerdict } : {}),
      ...(reportId ? { reportId } : {}),
      ...(marketCapUsd !== null ? { marketCapUsd } : {}),
      ...(priceUsd !== null ? { priceUsd } : {}),
      ...(source ? { source } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function parseSummaryPayload(raw: unknown): ScannedTokenSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate =
    "summary" in raw && raw.summary && typeof raw.summary === "object"
      ? (raw.summary as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  const mintAddress =
    typeof candidate.mintAddress === "string" ? candidate.mintAddress.trim() : "";
  if (!BASE58_OR_EVM_MINT_RE.test(mintAddress)) return null;

  const riskScore = Number(candidate.riskScore);
  if (!Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) return null;

  const classification = String(candidate.classification || "");
  const recommendedAction = String(candidate.recommendedAction || "");
  const source = String(candidate.source || "buildcheck");
  if (
    !VALID_CLASSIFICATIONS.has(classification) ||
    !VALID_ACTIONS.has(recommendedAction) ||
    !VALID_SOURCES.has(source)
  ) {
    return null;
  }

  const tokenProgram =
    candidate.tokenProgram === "ERC-20"
      ? "ERC-20"
      : candidate.tokenProgram === "Token-2022"
        ? "Token-2022"
        : "SPL Token";
  const scannedAt =
    typeof candidate.scannedAt === "string" &&
    Number.isFinite(Date.parse(candidate.scannedAt))
      ? candidate.scannedAt
      : new Date().toISOString();

  const buildCheckId =
    typeof candidate.buildCheckId === "string" &&
    BUILDCHECK_ID_RE.test(candidate.buildCheckId.trim())
      ? candidate.buildCheckId.trim()
      : null;
  const buildScore = optScore(candidate.buildScore);
  const buildVerdict =
    typeof candidate.buildVerdict === "string" &&
    VALID_BUILD_VERDICTS.has(candidate.buildVerdict)
      ? (candidate.buildVerdict as ScannedTokenBuildVerdict)
      : null;
  const priceUsd = optPositiveNum(candidate.priceUsd);
  const marketCapUsd = optPositiveNum(candidate.marketCapUsd);
  const liquidityUsd = optNonNegNum(candidate.liquidityUsd);
  const firstSeenAt =
    typeof candidate.firstSeenAt === "string" &&
    Number.isFinite(Date.parse(candidate.firstSeenAt))
      ? candidate.firstSeenAt
      : null;
  const firstPriceUsd = optPositiveNum(candidate.firstPriceUsd);
  const firstMarketCapUsd = optPositiveNum(candidate.firstMarketCapUsd);
  const scoreHistory = parseScoreHistory(candidate.scoreHistory);

  return {
    mintAddress,
    symbol:
      typeof candidate.symbol === "string" ? candidate.symbol.slice(0, 24) : null,
    name: typeof candidate.name === "string" ? candidate.name.slice(0, 64) : null,
    tokenProgram,
    riskScore: Math.round(riskScore),
    classification: classification as ScannedTokenSummary["classification"],
    recommendedAction: recommendedAction as ScannedTokenSummary["recommendedAction"],
    verifiedIssuer:
      typeof candidate.verifiedIssuer === "string"
        ? candidate.verifiedIssuer.slice(0, 40)
        : null,
    slot:
      typeof candidate.slot === "number" && Number.isFinite(candidate.slot)
        ? Math.max(0, Math.round(candidate.slot))
        : 0,
    scannedAt,
    source: source as ScannedTokenSummary["source"],
    scanCount:
      typeof candidate.scanCount === "number" && candidate.scanCount >= 1
        ? Math.round(candidate.scanCount)
        : 1,
    ...(buildCheckId ? { buildCheckId } : {}),
    ...(buildScore !== null ? { buildScore } : {}),
    ...(buildVerdict ? { buildVerdict } : {}),
    ...(priceUsd !== null ? { priceUsd } : {}),
    ...(marketCapUsd !== null ? { marketCapUsd } : {}),
    ...(liquidityUsd !== null ? { liquidityUsd } : {}),
    ...(firstSeenAt ? { firstSeenAt } : {}),
    ...(firstPriceUsd !== null ? { firstPriceUsd } : {}),
    ...(firstMarketCapUsd !== null ? { firstMarketCapUsd } : {}),
    ...(scoreHistory ? { scoreHistory } : {}),
  };
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function GET(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "read",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 40) : 20;
  const tokens = await listScannedTokens(limit);

  return corsJson(
    {
      ok: true,
      tokens,
    },
    { req, policy: "web", headers: guarded.rateHeaders }
  );
}

/**
 * Authenticated internal sync endpoint for the `@usesolshield` X-bot worker
 * to publish newly audited SPL mint summaries onto the live web feed at zero re-scan cost.
 */
export async function POST(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }
  if (guarded.authMode !== "api-key") {
    return corsJson(
      { ok: false, error: "Forbidden: X-bot sync requires SOLSHIELD_API_SECRET." },
      { req, policy: "web", status: 401, headers: guarded.rateHeaders }
    );
  }

  const body = await req.json().catch(() => null);
  const summary = parseSummaryPayload(body);
  if (!summary) {
    return corsJson(
      { ok: false, error: "Invalid scanned token summary payload." },
      { req, policy: "web", status: 400, headers: guarded.rateHeaders }
    );
  }

  const saved = await recordScannedTokenSummary(summary);
  return corsJson(
    { ok: true, token: saved },
    { req, policy: "web", headers: guarded.rateHeaders }
  );
}
