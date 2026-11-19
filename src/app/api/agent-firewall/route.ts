import { NextRequest } from "next/server";
import {
  evaluateAgentPreTradeGuard,
  inspectPromptInjection,
} from "../../../lib/agent-firewall";
import { buildGuardErrorResponse, guardApiRoute } from "../../../lib/api-guard";
import { corsJson, corsOptionsResponse } from "../../../lib/cors";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "actions");
}

export async function POST(req: NextRequest) {
  const guard = await guardApiRoute(req, {
    profile: "mcp-agent",
    kind: "fresh",
  });
  if (!guard.ok) return buildGuardErrorResponse(guard);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return corsJson(
      { error: "Invalid JSON payload." },
      { status: 400, req, policy: guard.corsPolicy, headers: guard.rateHeaders }
    );
  }

  const mode = String(body.mode || "guard_trade");

  if (mode === "sanitize_prompt") {
    const text = String(body.text || "");
    const result = inspectPromptInjection({
      text,
      source: typeof body.source === "string" ? body.source : "playground",
    });
    return corsJson(result, {
      status: 200,
      req,
      policy: guard.corsPolicy,
      headers: guard.rateHeaders,
    });
  }

  const target = String(body.target || "").trim();
  if (!target) {
    return corsJson(
      {
        error:
          "Provide a token contract address, Solana mint, or URL in `target`.",
      },
      { status: 400, req, policy: guard.corsPolicy, headers: guard.rateHeaders }
    );
  }

  const report = await evaluateAgentPreTradeGuard({
    target,
    chain: typeof body.chain === "string" ? body.chain : undefined,
    action:
      body.action === "sell" ||
      body.action === "approve" ||
      body.action === "interact"
        ? body.action
        : "buy",
    untrustedContext:
      typeof body.untrustedContext === "string"
        ? body.untrustedContext
        : undefined,
    dappUrl: typeof body.dappUrl === "string" ? body.dappUrl : undefined,
    maxSellTaxPct:
      typeof body.maxSellTaxPct === "number" ? body.maxSellTaxPct : undefined,
    skipLiveRpc: body.skipLiveRpc === true,
  });

  return corsJson(report, {
    status: 200,
    req,
    policy: guard.corsPolicy,
    headers: guard.rateHeaders,
  });
}
