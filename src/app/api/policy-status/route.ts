import { NextRequest } from "next/server";
import {
  fetchPolicyVaultStatus,
  type PolicyVaultProbeMode,
} from "@/lib/anchor-vault";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";

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

  const ownerAddress = req.nextUrl.searchParams.get("owner") ?? undefined;
  const rawCluster = req.nextUrl.searchParams.get("cluster")?.trim().toLowerCase();
  const cluster: PolicyVaultProbeMode =
    rawCluster === "mainnet" || rawCluster === "devnet" ? rawCluster : "auto";

  const status = await fetchPolicyVaultStatus({ ownerAddress, cluster });
  return corsJson(
    {
      ok: true,
      ...status,
    },
    { req, policy: "web", headers: guarded.rateHeaders }
  );
}
