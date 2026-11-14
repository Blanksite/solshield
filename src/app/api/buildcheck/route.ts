import { NextRequest } from "next/server";
import { runBuildCheckInvestigation } from "@/lib/buildcheck/orchestrator";
import { corsJson, corsOptionsResponse } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
  return corsOptionsResponse();
}

/**
 * Synchronous JSON endpoint for SolShield BuildCheck — powers automated CLI
 * audits, Telegram commands, and the @SolShieldCheck X mention bot worker.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      input?: string;
      veniceApiKey?: string;
      veniceModel?: string;
      enableBrowser?: boolean;
    };

    const rawInput = (body.input || "").trim();
    if (!rawInput) {
      return corsJson(
        {
          ok: false,
          error: "Paste a Solana token CA, X link, GitHub repo, or website URL.",
        },
        { status: 400 }
      );
    }

    const report = await runBuildCheckInvestigation(rawInput, {
      apiKey: body.veniceApiKey,
      model: body.veniceModel,
      enableBrowser: body.enableBrowser ?? true,
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

    return corsJson({ ok: true, report: compactReport });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "BuildCheck audit failed.";
    return corsJson({ ok: false, error: message }, { status: 400 });
  }
}
