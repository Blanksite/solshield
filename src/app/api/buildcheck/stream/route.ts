import { NextRequest } from "next/server";
import { prepareBuildCheckRequest } from "@/lib/buildcheck/request-guard";
import { runBuildCheckInvestigation } from "@/lib/buildcheck/orchestrator";
import { corsOptionsResponse } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

/**
 * Streams real-time BuildCheck investigation steps, live Chromium viewport JPEG
 * screenshots, collector badges, or instant cached scan replays via SSE.
 */
export async function POST(req: NextRequest) {
  const prepared = await prepareBuildCheckRequest(req);
  if (!prepared.ok) {
    return prepared.response;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeSend = (payload: unknown) => {
        if (closed || req.signal.aborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      try {
        await runBuildCheckInvestigation(prepared.input, {
          apiKey: prepared.veniceApiKey,
          model: prepared.veniceModel,
          enableBrowser: prepared.enableBrowser,
          forceRefresh: prepared.forceRefresh,
          onEvent: (event) => {
            safeSend(event);
          },
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "BuildCheck investigation failed.";
        safeSend({
          type: "error",
          elapsedMs: 0,
          message,
        });
      } finally {
        prepared.releaseConcurrency?.();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Stream already closed by client
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...prepared.responseHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
