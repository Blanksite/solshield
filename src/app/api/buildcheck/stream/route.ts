import { NextRequest } from "next/server";
import { runBuildCheckInvestigation } from "@/lib/buildcheck/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Streams real-time BuildCheck investigation steps, live Chromium viewport JPEG
 * screenshots, collector badges, and the final Venice AI forensic verdict via SSE.
 */
export async function POST(req: NextRequest) {
  let body: {
    input?: string;
    veniceApiKey?: string;
    veniceModel?: string;
    enableBrowser?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const rawInput = (body.input || "").trim();
  if (!rawInput) {
    return Response.json(
      {
        ok: false,
        error: "Paste a Solana token CA, X link, GitHub repo, or website URL.",
      },
      { status: 400 }
    );
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
        await runBuildCheckInvestigation(rawInput, {
          apiKey: body.veniceApiKey,
          model: body.veniceModel,
          enableBrowser: body.enableBrowser ?? true,
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
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
