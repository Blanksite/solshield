import { PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "@/lib/api-guard";
import { corsOptionsResponse } from "@/lib/cors";

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

  // EVM 0x address
  if (/^0x[a-fA-F0-9]{40}$/i.test(trimmed)) {
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
  if (norm === "ethereum" || norm === "eth") return "eth";
  if (norm === "arbitrum" || norm === "arb") return "arbitrum";
  if (norm === "polygon" || norm === "matic") return "polygon_pos";
  if (norm === "base") return "base";
  if (norm === "bsc" || norm === "binance") return "bsc";
  if (norm === "avalanche" || norm === "avax") return "avax";
  if (norm === "solana" || norm === "sol") return "solana";
  return norm;
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
    return NextResponse.json(
      { ok: false, error: "Valid token contract or pool address required." },
      { status: 400 }
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
      try {
        const dexRes = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(parsedMint.address)}`,
          {
            headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
            signal: AbortSignal.timeout(4500),
            cache: "no-store",
          }
        );
        if (dexRes.ok) {
          const dexJson = (await dexRes.json()) as {
            pairs?: Array<{ pairAddress?: string; chainId?: string }>;
          };
          const top = dexJson?.pairs?.[0];
          if (top?.pairAddress) {
            poolAddress = top.pairAddress.toLowerCase();
            if (top.chainId) {
              targetNetwork = mapChainToGeckoNetwork(top.chainId);
            }
          }
        }
      } catch {
        // Fallback below
      }

      if (!poolAddress) {
        try {
          const geckoRes = await fetch(
            `https://api.geckoterminal.com/api/v2/networks/eth/tokens/${encodeURIComponent(parsedMint.address)}/pools`,
            {
              headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
              signal: AbortSignal.timeout(4500),
              cache: "no-store",
            }
          );
          if (geckoRes.ok) {
            const geckoJson = (await geckoRes.json()) as {
              data?: Array<{ attributes?: { address?: string } }>;
            };
            poolAddress = geckoJson?.data?.[0]?.attributes?.address?.toLowerCase() || null;
          }
        } catch {
          // Fallback below
        }
      }
    } else {
      // Solana pool resolution
      try {
        const poolsRes = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(parsedMint.address)}/pools`,
          {
            headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
            signal: AbortSignal.timeout(5500),
            cache: "no-store",
          }
        );
        if (poolsRes.ok) {
          const poolsJson = (await poolsRes.json()) as {
            data?: Array<{ attributes?: { address?: string } }>;
          };
          const resolved = sanitizeAddress(poolsJson?.data?.[0]?.attributes?.address || null);
          poolAddress = resolved?.address || null;
        }
      } catch {
        // Handled below
      }
    }
  }

  if (!poolAddress) {
    return NextResponse.json({
      ok: true,
      poolAddress: null,
      tf,
      bars: [],
      note: "No indexed liquidity pool OHLCV found for this contract yet.",
    });
  }

  const cacheKey = `${targetNetwork}:${poolAddress}:${tf}`;
  const cached = CHART_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({
      ok: true,
      poolAddress: cached.payload.poolAddress,
      network: targetNetwork,
      tf,
      cached: true,
      bars: cached.payload.bars,
    });
  }

  const spec = TIMEFRAME_MAP[tf];
  try {
    const ohlcvRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
        targetNetwork
      )}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${spec.unit}?aggregate=${spec.aggregate}&limit=${spec.limit}`,
      {
        headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
        signal: AbortSignal.timeout(6500),
        cache: "no-store",
      }
    );

    if (!ohlcvRes.ok) {
      return NextResponse.json({
        ok: true,
        poolAddress,
        network: targetNetwork,
        tf,
        bars: [],
        note: `OHLCV feed not yet indexed for ${targetNetwork} pool (${ohlcvRes.status}).`,
      });
    }

    const ohlcvJson = (await ohlcvRes.json()) as {
      data?: {
        attributes?: {
          ohlcv_list?: Array<[number, number, number, number, number, number]>;
        };
      };
    };

    const rawList = ohlcvJson?.data?.attributes?.ohlcv_list || [];
    const seenTimes = new Set<number>();
    const bars: OhlcvCandleBar[] = rawList
      .filter(
        (row) =>
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

    if (CHART_CACHE.size > 50) {
      const oldestKey = CHART_CACHE.keys().next().value;
      if (oldestKey) CHART_CACHE.delete(oldestKey);
    }
    CHART_CACHE.set(cacheKey, {
      expiresAt: Date.now() + 25_000,
      payload: { poolAddress, bars },
    });

    return NextResponse.json({
      ok: true,
      poolAddress,
      network: targetNetwork,
      tf,
      cached: false,
      bars,
    });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      poolAddress,
      network: targetNetwork,
      tf,
      bars: [],
      note: err instanceof Error ? err.message : "Failed to load OHLCV candles.",
    });
  }
}
