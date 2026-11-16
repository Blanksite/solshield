import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { auditWalletApprovals } from "@/lib/wallet-detox";

export const maxDuration = 30;

async function handleWalletDetoxAudit(
  req: NextRequest,
  rawAddress: string,
  options: { cluster?: string; veniceApiKey?: string; rpcUrl?: string }
) {
  const address = rawAddress.trim();
  if (!address) {
    return corsJson(
      { ok: false, error: "Please provide a Solana wallet address." },
      { status: 400, req, policy: "web" }
    );
  }
  if (address.length > 64) {
    return corsJson(
      { ok: false, error: "Invalid Solana wallet address length." },
      { status: 400, req, policy: "web" }
    );
  }

  const guard = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
    byokKey: options.veniceApiKey,
    consumeDailyBudget: false,
  });
  if (!guard.ok) {
    return buildGuardErrorResponse(guard);
  }

  try {
    const report = await auditWalletApprovals(address, {
      cluster: options.cluster,
      veniceApiKey: options.veniceApiKey,
      rpcUrl: options.rpcUrl,
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
      err instanceof Error ? err.message : "Failed to audit wallet approvals.";
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
  const cluster = url.searchParams.get("cluster") || undefined;
  return handleWalletDetoxAudit(req, address, { cluster });
}

export async function POST(req: NextRequest) {
  let body: {
    address?: unknown;
    walletAddress?: unknown;
    cluster?: unknown;
    veniceApiKey?: unknown;
    apiKey?: unknown;
    rpcUrl?: unknown;
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
  const cluster = typeof body?.cluster === "string" ? body.cluster : undefined;
  const veniceApiKey =
    typeof body?.veniceApiKey === "string"
      ? body.veniceApiKey
      : typeof body?.apiKey === "string"
        ? body.apiKey
        : undefined;
  const rpcUrl = typeof body?.rpcUrl === "string" ? body.rpcUrl : undefined;

  return handleWalletDetoxAudit(req, address, { cluster, veniceApiKey, rpcUrl });
}
