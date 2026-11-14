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

function sanitizeBase58(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return new PublicKey(raw.trim()).toBase58();
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

  const mint = sanitizeBase58(req.nextUrl.searchParams.get("mint"));
  const poolParam = sanitizeBase58(req.nextUrl.searchParams.get("pool"));
  const tfRaw = req.nextUrl.searchParams.get("tf") || "5m";
  const tf = TIMEFRAME_MAP[tfRaw] ? tfRaw : "5m";

  if (!mint && !poolParam) {
    return NextResponse.json(
      { ok: false, error: "Valid Solana mint or pool address required." },
      { status: 400 }
    );
  }

  let poolAddress = poolParam;
  if (!poolAddress && mint) {
    try {
      const poolsRes = await fetch(
        `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(mint)}/pools`,
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
        poolAddress = sanitizeBase58(
          poolsJson?.data?.[0]?.attributes?.address || null
        );
      }
    } catch {
      // Handled below
    }
  }

  if (!poolAddress) {
    return NextResponse.json({
      ok: true,
      poolAddress: null,
      tf,
      bars: [],
      note: "No indexed liquidity pool OHLCV found for this mint yet.",
    });
  }

  const cacheKey = `${poolAddress}:${tf}`;
  const cached = CHART_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({
      ok: true,
      poolAddress: cached.payload.poolAddress,
      tf,
      cached: true,
      bars: cached.payload.bars,
    });
  }

  const spec = TIMEFRAME_MAP[tf];
  try {
    const ohlcvRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(
        poolAddress
      )}/ohlcv/${spec.unit}?aggregate=${spec.aggregate}&limit=${spec.limit}`,
      {
        headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
        signal: AbortSignal.timeout(6500),
        cache: "no-store",
      }
    );

    if (!ohlcvRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          poolAddress,
          tf,
          bars: [],
          error: `OHLCV feed returned HTTP ${ohlcvRes.status}.`,
        },
        { status: 502 }
      );
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

    if (CHART_CACHE.size > 40) {
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
      tf,
      cached: false,
      bars,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        poolAddress,
        tf,
        bars: [],
        error: err instanceof Error ? err.message : "Failed to load OHLCV candles.",
      },
      { status: 502 }
    );
  }
}
