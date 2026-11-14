import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  runGuardedCachedOperation,
} from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { recordScannedToken } from "@/lib/scanned-tokens";
import { scanSolanaTokenMint } from "@/lib/token-scanner";

async function handleScanTokenRequest(
  req: NextRequest,
  rawMint: string,
  veniceApiKey?: string,
  forceRefresh?: boolean
) {
  const mintAddress = rawMint.trim();
  if (!mintAddress) {
    return corsJson(
      { ok: false, error: "Please provide a Solana token Mint CA." },
      { status: 400, req, policy: "extension" }
    );
  }
  if (mintAddress.length > 64) {
    return corsJson(
      { ok: false, error: "Invalid token mint length." },
      { status: 400, req, policy: "extension" }
    );
  }

  try {
    const guarded = await runGuardedCachedOperation(
      req,
      {
        profile: "extension-hybrid",
        byokKey: veniceApiKey,
        namespace: "scan-token",
        cacheKey: mintAddress,
        ttlMs: 10 * 60_000,
        forceRefresh,
      },
      () => scanSolanaTokenMint(mintAddress, { veniceApiKey })
    );

    if (!guarded.ok) {
      return buildGuardErrorResponse(guarded);
    }

    await recordScannedToken(guarded.value, "token-xray");

    return corsJson(
      {
        ok: true,
        cached: guarded.cached,
        cachedAt: guarded.cachedAt,
        report: guarded.value,
      },
      { req, policy: "extension", headers: guarded.headers }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to inspect Solana token mint.";
    return corsJson(
      { ok: false, error: message },
      { status: 400, req, policy: "extension" }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "extension");
}

export async function POST(req: NextRequest) {
  let body: {
    mintAddress?: unknown;
    mint?: unknown;
    address?: unknown;
    veniceApiKey?: unknown;
    apiKey?: unknown;
    forceRefresh?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return corsJson(
      { ok: false, error: "Invalid JSON request body." },
      { status: 400, req, policy: "extension" }
    );
  }

  const mintAddress =
    typeof body?.mintAddress === "string"
      ? body.mintAddress
      : typeof body?.mint === "string"
        ? body.mint
        : typeof body?.address === "string"
          ? body.address
          : "";

  const veniceApiKey =
    typeof body?.veniceApiKey === "string"
      ? body.veniceApiKey
      : typeof body?.apiKey === "string"
        ? body.apiKey
        : undefined;

  return handleScanTokenRequest(
    req,
    mintAddress,
    veniceApiKey,
    body?.forceRefresh === true
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mintAddress =
    url.searchParams.get("mint") || url.searchParams.get("address") || "";
  return handleScanTokenRequest(req, mintAddress);
}
