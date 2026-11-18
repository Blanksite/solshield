import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import { runUpstashCommand } from "@/lib/upstash-rest";
import {
  fetchWatchedWalletActivity,
  isValidWatchedChain,
  makeWatchedWalletId,
  normalizeWatchedAddress,
  type TrackedWalletItem,
  type WatchWalletChain,
} from "@/lib/wallet-watch-tracker";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const WATCHLIST_SYNC_KEY_RE = /^[a-f0-9]{16,48}$/i;
const WATCHLIST_TTL_SEC = 30 * 24 * 60 * 60;

function redisWatchlistKey(syncKey: string): string {
  return `solshield:watchlist:${syncKey.toLowerCase()}`;
}

function sanitizeTrackedWalletArray(raw: unknown): TrackedWalletItem[] {
  if (!Array.isArray(raw)) return [];
  const deduped = new Map<string, TrackedWalletItem>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<TrackedWalletItem>;
    if (typeof candidate.address !== "string") continue;
    const rawChain =
      typeof candidate.chain === "string" && isValidWatchedChain(candidate.chain)
        ? candidate.chain
        : undefined;
    const norm = normalizeWatchedAddress(candidate.address, rawChain);
    if (!norm.valid) continue;
    const id = makeWatchedWalletId(norm.address, norm.chain);
    if (deduped.has(id)) continue;
    deduped.set(id, {
      id,
      address: norm.address,
      chain: norm.chain,
      label:
        typeof candidate.label === "string"
          ? candidate.label.trim().slice(0, 64)
          : "Watched Wallet",
      tag:
        candidate.tag === "early_buyer" ||
        candidate.tag === "possible_mm" ||
        candidate.tag === "top_holder" ||
        candidate.tag === "cabal_linked" ||
        candidate.tag === "dev_linked"
          ? candidate.tag
          : "custom",
      tokenSymbol:
        typeof candidate.tokenSymbol === "string"
          ? candidate.tokenSymbol.trim().slice(0, 20)
          : null,
      tokenAddress:
        typeof candidate.tokenAddress === "string"
          ? candidate.tokenAddress.trim().slice(0, 64)
          : null,
      addedAt:
        typeof candidate.addedAt === "string"
          ? candidate.addedAt
          : new Date().toISOString(),
      lastCheckedAt:
        typeof candidate.lastCheckedAt === "string"
          ? candidate.lastCheckedAt
          : null,
      lastTxHash:
        typeof candidate.lastTxHash === "string"
          ? candidate.lastTxHash.slice(0, 128)
          : null,
      lastTxSummary:
        typeof candidate.lastTxSummary === "string"
          ? candidate.lastTxSummary.slice(0, 180)
          : null,
      lastNativeBalance:
        typeof candidate.lastNativeBalance === "string"
          ? candidate.lastNativeBalance.slice(0, 48)
          : null,
      lastNonce:
        typeof candidate.lastNonce === "number" && Number.isFinite(candidate.lastNonce)
          ? candidate.lastNonce
          : null,
    });
    if (deduped.size >= 30) break;
  }
  return Array.from(deduped.values());
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function GET(req: NextRequest) {
  const guard = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "read",
  });
  if (!guard.ok) {
    return buildGuardErrorResponse(guard);
  }

  const syncKey = req.nextUrl.searchParams.get("syncKey")?.trim() || "";
  if (syncKey) {
    if (!WATCHLIST_SYNC_KEY_RE.test(syncKey)) {
      return corsJson(
        { ok: false, error: "Invalid watchlist sync key format." },
        { status: 400, req, policy: "web", headers: guard.rateHeaders }
      );
    }
    try {
      const raw = await runUpstashCommand<string>(
        ["GET", redisWatchlistKey(syncKey)],
        3000
      );
      const parsed = raw ? sanitizeTrackedWalletArray(JSON.parse(raw)) : [];
      return corsJson(
        { ok: true, wallets: parsed, persistedInRedis: true },
        { req, policy: "web", headers: guard.rateHeaders }
      );
    } catch {
      return corsJson(
        { ok: true, wallets: [], persistedInRedis: false },
        { req, policy: "web", headers: guard.rateHeaders }
      );
    }
  }

  const rawAddress = req.nextUrl.searchParams.get("address")?.trim() || "";
  const rawChain = req.nextUrl.searchParams.get("chain")?.trim().toLowerCase() || "";
  const rawToken = req.nextUrl.searchParams.get("token")?.trim() || null;

  const norm = normalizeWatchedAddress(rawAddress, rawChain || undefined);
  if (!norm.valid) {
    return corsJson(
      { ok: false, error: norm.error || "Invalid wallet address." },
      { status: 400, req, policy: "web", headers: guard.rateHeaders }
    );
  }

  const snapshot = await fetchWatchedWalletActivity({
    address: norm.address,
    chain: norm.chain,
    tokenAddress: rawToken,
  });

  return corsJson(
    { ok: true, snapshot },
    {
      req,
      policy: "web",
      headers: {
        ...guard.rateHeaders,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(req: NextRequest) {
  const guard = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
    consumeDailyBudget: false,
  });
  if (!guard.ok) {
    return buildGuardErrorResponse(guard);
  }

  let body: {
    action?: "activity" | "save";
    syncKey?: string;
    wallets?: unknown[];
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return corsJson(
      { ok: false, error: "Invalid JSON request body." },
      { status: 400, req, policy: "web", headers: guard.rateHeaders }
    );
  }

  if (body.action === "save") {
    const syncKey = (body.syncKey || "").trim();
    if (!WATCHLIST_SYNC_KEY_RE.test(syncKey)) {
      return corsJson(
        { ok: false, error: "Valid hex watchlist syncKey required." },
        { status: 400, req, policy: "web", headers: guard.rateHeaders }
      );
    }
    const sanitized = sanitizeTrackedWalletArray(body.wallets);
    try {
      const res = await runUpstashCommand<string>(
        [
          "SET",
          redisWatchlistKey(syncKey),
          JSON.stringify(sanitized),
          "EX",
          WATCHLIST_TTL_SEC,
        ],
        3000
      );
      return corsJson(
        {
          ok: true,
          count: sanitized.length,
          storedInRedis: res === "OK",
        },
        { req, policy: "web", headers: guard.rateHeaders }
      );
    } catch {
      return corsJson(
        { ok: true, count: sanitized.length, storedInRedis: false },
        { req, policy: "web", headers: guard.rateHeaders }
      );
    }
  }

  const rawList = Array.isArray(body.wallets) ? body.wallets : [];
  if (rawList.length === 0) {
    return corsJson(
      { ok: false, error: "Provide at least one wallet to check activity." },
      { status: 400, req, policy: "web", headers: guard.rateHeaders }
    );
  }

  const validatedInputs: Array<{
    address: string;
    chain: WatchWalletChain;
    tokenAddress: string | null;
  }> = [];

  for (const item of rawList.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { address?: unknown; chain?: unknown; tokenAddress?: unknown };
    if (typeof row.address !== "string") continue;
    const chainHint =
      typeof row.chain === "string" && isValidWatchedChain(row.chain.toLowerCase())
        ? row.chain.toLowerCase()
        : undefined;
    const norm = normalizeWatchedAddress(row.address, chainHint);
    if (!norm.valid) continue;
    validatedInputs.push({
      address: norm.address,
      chain: norm.chain,
      tokenAddress:
        typeof row.tokenAddress === "string" && row.tokenAddress.trim().length <= 64
          ? row.tokenAddress.trim()
          : null,
    });
  }

  if (validatedInputs.length === 0) {
    return corsJson(
      { ok: false, error: "No valid Solana or EVM wallet addresses provided." },
      { status: 400, req, policy: "web", headers: guard.rateHeaders }
    );
  }

  const snapshots = await Promise.all(
    validatedInputs.map((item) => fetchWatchedWalletActivity(item))
  );

  return corsJson(
    { ok: true, snapshots },
    {
      req,
      policy: "web",
      headers: {
        ...guard.rateHeaders,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
