import { NextRequest } from "next/server";
import { prepareBuildCheckRequest } from "@/lib/buildcheck/request-guard";
import { runBuildCheckInvestigation } from "@/lib/buildcheck/orchestrator";
import { corsJson, corsOptionsResponse } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

/**
 * Synchronous JSON endpoint for SolShield BuildCheck — protected by caller
 * auth/origin checks, rate limits, shared scan cache, and concurrency caps.
 */
export async function POST(req: NextRequest) {
  const prepared = await prepareBuildCheckRequest(req);
  if (!prepared.ok) {
    return prepared.response;
  }

  try {
    const report = await runBuildCheckInvestigation(prepared.input, {
      apiKey: prepared.veniceApiKey,
      model: prepared.veniceModel,
      enableBrowser: prepared.enableBrowser,
      forceRefresh: prepared.forceRefresh,
    });

    // Omit heavy raw screenshot base64 bytes from compact JSON API unless needed
    const compactReport = {
      ...report,
      browser: {
        ...report.browser,
        stops: report.browser.stops.map(({ screenshotBase64, ...rest }) => ({
          ...rest,
          hasScreenshot: Boolean(screenshotBase64),
        })),
      },
    };

    return corsJson(
      { ok: true, report: compactReport },
      {
        req,
        policy: "web",
        headers: {
          ...prepared.responseHeaders,
          "X-SolShield-Cache": report.cache?.hit ? "HIT" : "MISS",
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "BuildCheck audit failed.";
    return corsJson(
      { ok: false, error: message },
      { status: 400, req, policy: "web", headers: prepared.responseHeaders }
    );
  } finally {
    prepared.releaseConcurrency?.();
  }
}
