import { NextRequest, NextResponse } from "next/server";
import { scanSolanaTokenMint } from "@/lib/token-scanner";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mintAddress: string =
      body?.mintAddress || body?.mint || body?.address || "";
    const veniceApiKey: string | undefined =
      body?.veniceApiKey || body?.apiKey;

    if (!mintAddress.trim()) {
      return NextResponse.json(
        { ok: false, error: "Please provide a Solana token Mint CA." },
        { status: 400 }
      );
    }

    const report = await scanSolanaTokenMint(mintAddress, { veniceApiKey });
    return NextResponse.json({ ok: true, report });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to inspect Solana token mint.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const mintAddress =
      url.searchParams.get("mint") || url.searchParams.get("address") || "";

    if (!mintAddress.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing query parameter: ?mint=<TOKEN_CA>" },
        { status: 400 }
      );
    }

    const report = await scanSolanaTokenMint(mintAddress);
    return NextResponse.json({ ok: true, report });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to inspect Solana token mint.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
