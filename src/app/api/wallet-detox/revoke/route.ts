import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import {
  buildEvmRevokeTransactions,
  type EvmRevokeTargetSpec,
} from "@/lib/evm-detox";
import {
  BatchRevokeSpec,
  buildBatchSplDelegateRevokeTransaction,
  normalizeDetoxCluster,
} from "@/lib/wallet-detox";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function POST(req: NextRequest) {
  let body: {
    owner?: unknown;
    targets?: unknown;
    cluster?: unknown;
    chain?: unknown;
    recentBlockhash?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return corsJson(
      { ok: false, error: "Invalid JSON request body." },
      { status: 400, req, policy: "web" }
    );
  }

  const guard = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
    consumeDailyBudget: false,
  });
  if (!guard.ok) {
    return buildGuardErrorResponse(guard);
  }

  const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
  const rawTargets = Array.isArray(body?.targets) ? body.targets : [];

  if (owner.startsWith("0x")) {
    const evmTargets: EvmRevokeTargetSpec[] = rawTargets
      .filter(
        (
          item
        ): item is {
          kind?: string;
          tokenAddress: string;
          spenderAddress: string;
        } =>
          Boolean(item) &&
          typeof (item as { tokenAddress?: unknown }).tokenAddress === "string" &&
          typeof (item as { spenderAddress?: unknown }).spenderAddress === "string"
      )
      .map((item) => ({
        kind: item.kind === "permit2" ? "permit2" : "erc20",
        tokenAddress: item.tokenAddress.trim(),
        spenderAddress: item.spenderAddress.trim(),
      }));

    if (evmTargets.length === 0) {
      return corsJson(
        {
          ok: false,
          error:
            "Both `owner` EVM address and non-empty EVM `targets` (tokenAddress, spenderAddress) are required.",
        },
        { status: 400, req, policy: "web", headers: guard.rateHeaders }
      );
    }

    try {
      const artifact = buildEvmRevokeTransactions({
        owner,
        chain:
          typeof body?.chain === "string"
            ? body.chain
            : typeof body?.cluster === "string"
              ? body.cluster
              : undefined,
        targets: evmTargets,
      });

      return corsJson(
        {
          ok: true,
          artifact,
        },
        {
          req,
          policy: "web",
          headers: {
            ...guard.rateHeaders,
            "Cache-Control": "no-store",
          },
        }
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to construct EVM Revoke transaction.";
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

  const targets: BatchRevokeSpec[] = rawTargets
    .filter(
      (item): item is { tokenAccount: string; isToken2022?: boolean } =>
        Boolean(item) &&
        typeof (item as { tokenAccount?: unknown }).tokenAccount === "string" &&
        (item as { tokenAccount: string }).tokenAccount.trim().length > 0
    )
    .map((item) => ({
      tokenAccount: item.tokenAccount.trim(),
      isToken2022: item.isToken2022 === true,
    }));

  if (!owner || targets.length === 0) {
    return corsJson(
      {
        ok: false,
        error: "Both `owner` wallet address and non-empty `targets` are required.",
      },
      { status: 400, req, policy: "web", headers: guard.rateHeaders }
    );
  }

  try {
    const artifact = await buildBatchSplDelegateRevokeTransaction({
      owner,
      targets,
      cluster: normalizeDetoxCluster(
        typeof body?.cluster === "string" ? body.cluster : undefined
      ),
      recentBlockhash:
        typeof body?.recentBlockhash === "string"
          ? body.recentBlockhash
          : undefined,
    });

    return corsJson(
      {
        ok: true,
        artifact,
      },
      {
        req,
        policy: "web",
        headers: {
          ...guard.rateHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to construct SPL Revoke transaction.";
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
