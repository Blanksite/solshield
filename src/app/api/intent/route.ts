import { NextRequest, NextResponse } from "next/server";
import { compileDeFiIntentWithJupiter } from "@/lib/intent-builder";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      walletAddress,
      veniceApiKey,
      maxAllowedRiskScore,
      maxDailySol,
      emergencyLocked,
    } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json(
        { ok: false, error: "Please provide a natural-language DeFi intent." },
        { status: 400 }
      );
    }

    const result = await compileDeFiIntentWithJupiter({
      prompt,
      walletAddress,
      veniceApiKey,
      maxAllowedRiskScore,
      maxDailySol,
      emergencyLocked,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to compile DeFi intent.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
