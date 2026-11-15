import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  guardApiRoute,
} from "../../../../lib/api-guard";
import {
  getBuildCheckReportPermalink,
  isValidBuildCheckReportId,
  saveBuildCheckReportPermalink,
} from "../../../../lib/buildcheck/report-store";
import type { BuildCheckReport } from "../../../../lib/buildcheck/types";
import { corsJson, corsOptionsResponse } from "../../../../lib/cors";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

function isValidReportPayload(value: unknown): value is BuildCheckReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BuildCheckReport>;
  return (
    isValidBuildCheckReportId(candidate.id) &&
    typeof candidate.authenticityScore === "number" &&
    Number.isFinite(candidate.authenticityScore) &&
    typeof candidate.verdict === "string" &&
    typeof candidate.createdAt === "string" &&
    Boolean(candidate.target && typeof candidate.target.rawInput === "string")
  );
}

export async function GET(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "read",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  const reportId = req.nextUrl.searchParams.get("id")?.trim() || "";
  if (!isValidBuildCheckReportId(reportId)) {
    return corsJson(
      { ok: false, error: "Invalid or missing BuildCheck report ID." },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const report = await getBuildCheckReportPermalink(reportId);
  if (!report) {
    return corsJson(
      { ok: false, error: "Shared BuildCheck report not found or expired." },
      { status: 404, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  return corsJson(
    { ok: true, report },
    { req, policy: "web", headers: guarded.rateHeaders }
  );
}

export async function POST(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "buildcheck",
    kind: "read",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  if (guarded.authMode !== "api-key") {
    return corsJson(
      { ok: false, error: "Valid x-solshield-api-key required to publish permalink reports." },
      { status: 401, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  let body: { report?: unknown } = {};
  try {
    body = (await req.json()) as { report?: unknown };
  } catch {
    return corsJson(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  if (!isValidReportPayload(body.report)) {
    return corsJson(
      { ok: false, error: "Invalid BuildCheck report permalink payload." },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const saved = await saveBuildCheckReportPermalink(body.report);
  return corsJson(
    {
      ok: true,
      id: saved.id,
      storedInRedis: saved.storedInRedis,
      path: `/buildcheck?report=${encodeURIComponent(saved.id)}`,
    },
    { status: 201, req, policy: "web", headers: guarded.rateHeaders }
  );
}
