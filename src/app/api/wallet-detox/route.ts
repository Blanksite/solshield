import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { auditEvmWalletApprovals } from "@/lib/evm-detox";
import { auditWalletApprovals } from "@/lib/wallet-detox";

export const maxDuration = 30;

async function handleWalletDetoxAudit(
  req: NextRequest,
  rawAddress: string,
  options: {
    cluster?: string;
    chain?: string;
    veniceApiKey?: string;
    rpcUrl?: string;
    additionalTokens?: string[];
    additionalSpenders?: string[];
  }
) {
  const address = rawAddress.trim();
  if (!address) {
    return corsJson(
      { ok: false, error: "Please provide a Solana or EVM (0x...) wallet address." },
      { status: 400, req, policy: "web" }
    );
  }
  if (address.length > 64) {
    return corsJson(
      { ok: false, error: "Invalid wallet address length." },
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
    const isEvm = address.startsWith("0x");
    const report = isEvm
      ? await auditEvmWalletApprovals(address, {
          chain: options.chain || options.cluster,
          veniceApiKey: options.veniceApiKey,
          rpcUrl: options.rpcUrl,
          additionalTokens: options.additionalTokens,
          additionalSpenders: options.additionalSpenders,
        })
      : await auditWalletApprovals(address, {
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
  const chain = url.searchParams.get("chain") || undefined;
  return handleWalletDetoxAudit(req, address, { cluster, chain });
}

export async function POST(req: NextRequest) {
  let body: {
    address?: unknown;
    walletAddress?: unknown;
    cluster?: unknown;
    chain?: unknown;
    veniceApiKey?: unknown;
    apiKey?: unknown;
    rpcUrl?: unknown;
    additionalTokens?: unknown;
    additionalSpenders?: unknown;
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
  const chain = typeof body?.chain === "string" ? body.chain : undefined;
  const veniceApiKey =
    typeof body?.veniceApiKey === "string"
      ? body.veniceApiKey
      : typeof body?.apiKey === "string"
        ? body.apiKey
        : undefined;
  const rpcUrl = typeof body?.rpcUrl === "string" ? body.rpcUrl : undefined;
  const additionalTokens = Array.isArray(body?.additionalTokens)
    ? body.additionalTokens.filter((v): v is string => typeof v === "string")
    : undefined;
  const additionalSpenders = Array.isArray(body?.additionalSpenders)
    ? body.additionalSpenders.filter((v): v is string => typeof v === "string")
    : undefined;

  return handleWalletDetoxAudit(req, address, {
    cluster,
    chain,
    veniceApiKey,
    rpcUrl,
    additionalTokens,
    additionalSpenders,
  });
}
