import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  getApiGuardSnapshotAsync,
  guardApiRoute,
  peekFreshBuildCheckQuotaAsync,
} from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { getScanCacheStats } from "@/lib/scan-cache";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

/**
 * Reports non-sensitive API Guard & shared scan cache telemetry for the
 * authenticated caller (no user inputs, targets, or IPs are exposed).
 */
export async function GET(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "read",
  });
  if (!guarded.ok) {
    return buildGuardErrorResponse(guarded);
  }

  const [quota, guard] = await Promise.all([
    peekFreshBuildCheckQuotaAsync(guarded.clientIp, guarded.authMode),
    getApiGuardSnapshotAsync(),
  ]);

  return corsJson(
    {
      ok: true,
      authMode: guarded.authMode,
      quota,
      cache: getScanCacheStats(),
      guard,
    },
    {
      req,
      policy: "web",
      headers: guarded.rateHeaders,
    }
  );
}
