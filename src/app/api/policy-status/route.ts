import { NextRequest, NextResponse } from "next/server";
import { fetchDevnetPolicyVaultStatus } from "@/lib/anchor-vault";

export async function GET(req: NextRequest) {
  const ownerAddress = req.nextUrl.searchParams.get("owner") ?? undefined;
  const status = await fetchDevnetPolicyVaultStatus({ ownerAddress });
  return NextResponse.json({
    ok: true,
    ...status,
  });
}
