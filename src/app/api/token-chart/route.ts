import { PublicKey } from "@solana/web3.js";
import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";

export interface OhlcvCandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CHART_CACHE = new Map<
  string,
  { expiresAt: number; payload: { poolAddress: string; bars: OhlcvCandleBar[] } }
>();

const TIMEFRAME_MAP: Record<
  string,
  { unit: "minute" | "hour"; aggregate: number; limit: number }
> = {
  "1m": { unit: "minute", aggregate: 1, limit: 180 },
  "5m": { unit: "minute", aggregate: 5, limit: 160 },
  "15m": { unit: "minute", aggregate: 15, limit: 150 },
  "1h": { unit: "hour", aggregate: 1, limit: 150 },
};

function sanitizeAddress(raw: string | null): { address: string; chain: "solana" | "evm" } | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // EVM 0x address (20-byte contract address or 32-byte pool address)
  if (/^0x[a-fA-F0-9]{40,64}$/i.test(trimmed)) {
    return { address: trimmed.toLowerCase(), chain: "evm" };
  }

  // Solana Base58 address
  try {
    const b58 = new PublicKey(trimmed).toBase58();
    return { address: b58, chain: "solana" };
  } catch {
    return null;
  }
}

function mapChainToGeckoNetwork(chain: string): string {
  const norm = chain.toLowerCase().trim();
  if (norm === "robinhood" || norm.includes("robinhood")) return "robinhood";
  if (norm === "ethereum" || norm === "eth") return "eth";
  if (norm === "arbitrum" || norm === "arb") return "arbitrum";
  if (norm === "polygon" || norm === "matic") return "polygon_pos";
  if (norm === "base") return "base";
  if (norm === "bsc" || norm === "binance") return "bsc";
  if (norm === "avalanche" || norm === "avax") return "avax";
  if (norm === "solana" || norm === "sol") return "solana";
  return norm;
}

function parseGeckoOhlcvList(rawList: unknown): OhlcvCandleBar[] {
  if (!Array.isArray(rawList)) return [];
  const seenTimes = new Set<number>();
  return rawList
    .filter(
      (row): row is [number, number, number, number, number, number] =>
        Array.isArray(row) &&
        row.length >= 6 &&
        row.every((v) => Number.isFinite(Number(v)))
    )
    .map((row) => ({
      time: Math.floor(Number(row[0])),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .sort((a, b) => a.time - b.time)
    .filter((bar) => {
      if (seenTimes.has(bar.time)) return false;
      seenTimes.add(bar.time);
      return true;
    });
}

async function fetchGeckoPoolOhlcv(
  network: string,
  poolAddress: string,
  unit: "minute" | "hour" | "day",
  aggregate: number,
  limit: number
): Promise<{ ok: boolean; status: number; bars: OhlcvCandleBar[] }> {
  const ohlcvRes = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
      network
    )}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${unit}?aggregate=${aggregate}&limit=${limit}`,
    {
      headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
      signal: AbortSignal.timeout(6500),
      cache: "no-store",
    }
  );
  if (!ohlcvRes.ok) {
    return { ok: false, status: ohlcvRes.status, bars: [] };
  }
  const ohlcvJson = (await ohlcvRes.json()) as {
    data?: { attributes?: { ohlcv_list?: unknown } };
  };
  return {
    ok: true,
    status: ohlcvRes.status,
    bars: parseGeckoOhlcvList(ohlcvJson?.data?.attributes?.ohlcv_list),
  };
}

async function resolveDexScreenerPair(
  mintAddress: string
): Promise<{ pairAddress: string; network: string } | null> {
  try {
    const dexRes = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mintAddress)}`,
      {
        headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }
    );
    if (!dexRes.ok) return null;
    const dexJson = (await dexRes.json()) as {
      pairs?: Array<{ pairAddress?: string; chainId?: string }>;
    };
    const top = dexJson?.pairs?.[0];
    if (!top?.pairAddress) return null;
    return {
      pairAddress: top.pairAddress.toLowerCase(),
      network: top.chainId ? mapChainToGeckoNetwork(top.chainId) : "eth",
    };
  } catch {
    return null;
  }
}

async function resolveGeckoTokenTopPool(
  network: string,
  mintAddress: string
): Promise<string | null> {
  try {
    const geckoRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
        network
      )}/tokens/${encodeURIComponent(mintAddress)}/pools`,
      {
        headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
        signal: AbortSignal.timeout(4500),
        cache: "no-store",
      }
    );
    if (!geckoRes.ok) return null;
    const geckoJson = (await geckoRes.json()) as {
      data?: Array<{ attributes?: { address?: string } }>;
    };
    const resolved = sanitizeAddress(geckoJson?.data?.[0]?.attributes?.address || null);
    return resolved?.address || null;
  } catch {
    return null;
  }
}

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

  const rawMint = req.nextUrl.searchParams.get("mint");
  const rawPool = req.nextUrl.searchParams.get("pool");
  const parsedMint = sanitizeAddress(rawMint);
  const parsedPool = sanitizeAddress(rawPool);

  const tfRaw = req.nextUrl.searchParams.get("tf") || "5m";
  const tf = TIMEFRAME_MAP[tfRaw] ? tfRaw : "5m";

  if (!parsedMint && !parsedPool) {
    return corsJson(
      { ok: false, error: "Valid token contract or pool address required." },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const chain = parsedMint?.chain || parsedPool?.chain || "solana";
  let targetNetwork = mapChainToGeckoNetwork(
    req.nextUrl.searchParams.get("network") || (chain === "evm" ? "eth" : "solana")
  );

  let poolAddress = parsedPool?.address || null;

  // Resolve pool address if not explicitly passed
  if (!poolAddress && parsedMint) {
    if (parsedMint.chain === "evm") {
      const dexPair = await resolveDexScreenerPair(parsedMint.address);
      if (dexPair) {
        poolAddress = dexPair.pairAddress;
        targetNetwork = dexPair.network;
      }

      if (!poolAddress) {
        poolAddress = await resolveGeckoTokenTopPool(targetNetwork, parsedMint.address);
      }
    } else {
      // Solana pool resolution
      poolAddress = await resolveGeckoTokenTopPool("solana", parsedMint.address);
    }
  }

  if (!poolAddress) {
    return corsJson(
      {
        ok: true,
        poolAddress: null,
        tf,
        bars: [],
        note: "No indexed liquidity pool OHLCV found for this contract yet.",
      },
      { req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const cacheKey = `${targetNetwork}:${poolAddress}:${tf}`;
  const cached = CHART_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return corsJson(
      {
        ok: true,
        poolAddress: cached.payload.poolAddress,
        network: targetNetwork,
        tf,
        cached: true,
        bars: cached.payload.bars,
      },
      { req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const spec = TIMEFRAME_MAP[tf];
  try {
    let activePool = poolAddress;
    let activeNetwork = targetNetwork;
    let feed = await fetchGeckoPoolOhlcv(
      activeNetwork,
      activePool,
      spec.unit,
      spec.aggregate,
      spec.limit
    );

    // If an explicit pool/network defaulted to "eth" (e.g. legacy cached Robinhood report), auto-detect chain via DexScreener
    if ((!feed.ok || feed.bars.length === 0) && chain === "evm" && parsedMint) {
      const dexPair = await resolveDexScreenerPair(parsedMint.address);
      if (dexPair && (dexPair.network !== activeNetwork || dexPair.pairAddress !== activePool)) {
        const dexFeed = await fetchGeckoPoolOhlcv(
          dexPair.network,
          dexPair.pairAddress,
          spec.unit,
          spec.aggregate,
          spec.limit
        );
        if (dexFeed.ok && (dexFeed.bars.length > 0 || !feed.ok)) {
          activeNetwork = dexPair.network;
          activePool = dexPair.pairAddress;
          feed = dexFeed;
        }
      }
    }

    // If an explicit/secondary pool isn't indexed on GeckoTerminal, resolve the token's top pool
    if ((!feed.ok || feed.bars.length === 0) && parsedMint) {
      const altPool = await resolveGeckoTokenTopPool(activeNetwork, parsedMint.address);
      if (altPool && altPool !== activePool) {
        const altFeed = await fetchGeckoPoolOhlcv(
          activeNetwork,
          altPool,
          spec.unit,
          spec.aggregate,
          spec.limit
        );
        if (altFeed.ok && altFeed.bars.length > 0) {
          activePool = altPool;
          feed = altFeed;
        }
      }
    }

    // Lower-frequency L2/DEX pools may have no minute bars yet; fall back to hourly bars
    if (feed.ok && feed.bars.length === 0 && spec.unit === "minute") {
      const hourlyFeed = await fetchGeckoPoolOhlcv(activeNetwork, activePool, "hour", 1, 150);
      if (hourlyFeed.ok && hourlyFeed.bars.length > 0) {
        feed = hourlyFeed;
      }
    }

    if (!feed.ok) {
      return corsJson(
        {
          ok: true,
          poolAddress: activePool,
          network: activeNetwork,
          tf,
          bars: [],
          note: `OHLCV feed not yet indexed for ${activeNetwork} pool (${feed.status}).`,
        },
        { req, policy: "web", headers: guarded.rateHeaders }
      );
    }

    const bars = feed.bars;
    if (bars.length > 0) {
      if (CHART_CACHE.size > 50) {
        const oldestKey = CHART_CACHE.keys().next().value;
        if (oldestKey) CHART_CACHE.delete(oldestKey);
      }
      CHART_CACHE.set(cacheKey, {
        expiresAt: Date.now() + 25_000,
        payload: { poolAddress: activePool, bars },
      });
    }

    return corsJson(
      {
        ok: true,
        poolAddress: activePool,
        network: activeNetwork,
        tf,
        cached: false,
        bars,
      },
      { req, policy: "web", headers: guarded.rateHeaders }
    );
  } catch (err) {
    return corsJson(
      {
        ok: true,
        poolAddress,
        network: targetNetwork,
        tf,
        bars: [],
        note: err instanceof Error ? err.message : "Failed to load OHLCV candles.",
      },
      { req, policy: "web", headers: guarded.rateHeaders }
    );
  }
}
