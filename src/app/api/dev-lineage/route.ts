import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { analyzeDevLineage } from "@/lib/dev-lineage";

export const maxDuration = 60; // lineage tracing can be slow with recursive RPC calls

async function handleLineageAnalysis(
  req: NextRequest,
  rawAddress: string,
  options: { veniceApiKey?: string }
) {
  const address = rawAddress.trim();
  if (!address) {
    return corsJson(
      { ok: false, error: "Please provide a Solana wallet address to trace." },
      { status: 400, req, policy: "web" }
    );
  }
  if (address.length > 64 || address.length < 32) {
    return corsJson(
      { ok: false, error: "Invalid Solana wallet address." },
      { status: 400, req, policy: "web" }
    );
  }

  const guard = await guardApiRoute(req, {
    profile: "web-ai",
    kind: "fresh",
    byokKey: options.veniceApiKey,
    consumeDailyBudget: false,
  });
  if (!guard.ok) {
    return buildGuardErrorResponse(guard);
  }

  try {
    const report = await analyzeDevLineage(address, {
      apiKey: options.veniceApiKey,
    });

    return corsJson(
      {
        ok: true,
        zeroDataRetention: true,
        report,
      },
      {
        req,
        policy: "web",
        headers: {
          ...guard.rateHeaders,
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to analyze wallet lineage.";
    return corsJson(
      { ok: false, error: message },
      {
        status: 400,
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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const address =
    url.searchParams.get("address") || url.searchParams.get("wallet") || "";
  return handleLineageAnalysis(req, address, {});
}

export async function POST(req: NextRequest) {
  let body: {
    address?: unknown;
    walletAddress?: unknown;
    veniceApiKey?: unknown;
    apiKey?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return corsJson(
      { ok: false, error: "Invalid JSON request body." },
      { status: 400, req, policy: "web" }
    );
  }

  const address =
    typeof body?.address === "string"
      ? body.address
      : typeof body?.walletAddress === "string"
        ? body.walletAddress
        : "";
  const veniceApiKey =
    typeof body?.veniceApiKey === "string"
      ? body.veniceApiKey
      : typeof body?.apiKey === "string"
        ? body.apiKey
        : undefined;

  return handleLineageAnalysis(req, address, { veniceApiKey });
}
