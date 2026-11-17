import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { verifyRobinhoodStatus } from "@/lib/buildcheck/robinhood-verifier";

export const dynamic = "force-dynamic";

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

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query")?.trim() || searchParams.get("address")?.trim();
  const name = searchParams.get("name")?.trim();
  const symbol = searchParams.get("symbol")?.trim();

  if (!query) {
    return corsJson(
      { ok: false, error: "Missing query or address parameter." },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  try {
    const report = await verifyRobinhoodStatus({
      address: query,
      name,
      symbol,
    });

    return corsJson(
      { ok: true, robinhood: report },
      {
        req,
        policy: "web",
        headers: {
          ...guarded.rateHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Robinhood verification failed.";
    return corsJson(
      { ok: false, error: message },
      { status: 500, req, policy: "web", headers: guarded.rateHeaders }
    );
  }
}

export async function POST(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  try {
    const body = (await req.json()) as {
      address?: string;
      name?: string;
      symbol?: string;
      chainFamily?: "solana" | "evm" | "unknown";
      metadataText?: string;
    };

    if (!body.address?.trim()) {
      return corsJson(
        { ok: false, error: "Missing token contract address." },
        { status: 400, req, policy: "web", headers: guarded.rateHeaders }
      );
    }

    const report = await verifyRobinhoodStatus({
      address: body.address.trim(),
      name: body.name,
      symbol: body.symbol,
      chainFamily: body.chainFamily,
      metadataText: body.metadataText,
    });

    return corsJson(
      { ok: true, robinhood: report },
      {
        req,
        policy: "web",
        headers: {
          ...guarded.rateHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Robinhood verification failed.";
    return corsJson(
      { ok: false, error: message },
      { status: 500, req, policy: "web", headers: guarded.rateHeaders }
    );
  }
}
