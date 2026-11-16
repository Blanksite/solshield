import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import {
  collectSocialMindshare,
  computeMindshareBuildAlignment,
} from "@/lib/buildcheck/x-mindshare";
import { computeDualAxisSummary } from "@/lib/buildcheck/war-room-metrics";
import type {
  BuildCheckReport,
  ChainTokenIntelReport,
  DomainIntelReport,
  GitHubForensicReport,
  ParsedTargetInput,
  SocialMindshareReport,
  XPostIntelReport,
} from "@/lib/buildcheck/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function POST(req: NextRequest) {
  const guard = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
    consumeDailyBudget: false,
  });
  if (!guard.ok) {
    return buildGuardErrorResponse(guard);
  }

  let body: {
    target?: ParsedTargetInput;
    chain?: ChainTokenIntelReport | null;
    github?: GitHubForensicReport | null;
    domain?: DomainIntelReport | null;
    xPost?: XPostIntelReport | null;
    browserXUrls?: string[];
    veniceApiKey?: string;
    veniceModel?: string;
    buildIntegrityScore?: number;
    report?: Partial<BuildCheckReport>;
  } = {};

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return corsJson(
      { ok: false, error: "Invalid JSON request body." },
      { status: 400, req, policy: "web", headers: guard.rateHeaders }
    );
  }

  const target = body.target || body.report?.target;
  if (!target || !target.rawInput) {
    return corsJson(
      { ok: false, error: "Target input is required to scan X Mindshare." },
      { status: 400, req, policy: "web", headers: guard.rateHeaders }
    );
  }

  const chain = body.chain ?? body.report?.chain ?? null;
  const github = body.github ?? body.report?.github ?? null;
  const domain = body.domain ?? body.report?.domain ?? null;
  const xPost = body.xPost ?? body.report?.xPost ?? null;
  const browserXUrls =
    body.browserXUrls ?? body.report?.browser?.discoveredXUrls ?? [];
  const veniceApiKey = body.veniceApiKey;
  const veniceModel = body.veniceModel;

  try {
    const rawSocial = await collectSocialMindshare({
      target,
      chain,
      github,
      domain,
      xPost,
      browserXUrls,
      veniceApiKey,
      veniceModel,
    });

    let buildIntegrityScore = body.buildIntegrityScore;
    if (buildIntegrityScore == null && body.report) {
      try {
        const dualAxis = computeDualAxisSummary(body.report as BuildCheckReport);
        buildIntegrityScore = dualAxis.buildIntegrity.score ?? 50;
      } catch {
        buildIntegrityScore = 50;
      }
    }

    const alignment = computeMindshareBuildAlignment({
      mindshareScore: rawSocial.mindshareScore,
      organicSignalPct: rawSocial.organicSignalPct,
      skepticalPct: rawSocial.sentimentBreakdown.skepticalPct,
      shillNoisePct: rawSocial.sentimentBreakdown.shillNoisePct,
      totalPostsSampled: rawSocial.totalPostsSampled,
      buildIntegrityScore: buildIntegrityScore ?? 50,
    });

    const finalSocial: SocialMindshareReport = {
      ...rawSocial,
      quadrant: alignment.quadrant,
      quadrantLabel: alignment.quadrantLabel,
      quadrantSummary: alignment.quadrantSummary,
    };

    return corsJson(
      {
        ok: true,
        social: finalSocial,
      },
      {
        req,
        policy: "web",
        headers: {
          ...guard.rateHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to collect on-demand X Mindshare.";
    return corsJson(
      { ok: false, error: message },
      {
        status: 500,
        req,
        policy: "web",
        headers: {
          ...guard.rateHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
