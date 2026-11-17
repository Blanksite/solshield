"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Activity, Flame, Loader2, RefreshCw } from "lucide-react";
import type { DevTxEntry } from "@/lib/buildcheck/types";

interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradingViewTokenChartProps {
  mintAddress: string;
  poolAddress?: string | null;
  symbol?: string | null;
  totalSupply?: number | null;
  devTxs?: DevTxEntry[];
  chainFamily?: "solana" | "evm" | "unknown";
  networkName?: string;
  quoteSymbol?: string | null;
}

function formatCompactPrice(val: number, isMcap: boolean): string {
  if (!Number.isFinite(val) || val < 0) return "";
  if (isMcap) {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
    return `$${val.toFixed(0)}`;
  }
  if (val >= 1) return `$${val.toFixed(3)}`;
  if (val >= 0.001) return `$${val.toFixed(5)}`;
  return `$${val.toFixed(8)}`;
}

export function TradingViewTokenChart({
  mintAddress,
  poolAddress,
  symbol,
  totalSupply,
  devTxs = [],
  chainFamily = "solana",
  networkName,
  quoteSymbol,
}: TradingViewTokenChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [tf, setTf] = useState<"1m" | "5m" | "15m" | "1h">("5m");
  const [mode, setMode] = useState<"mcap" | "price">(
    totalSupply && totalSupply > 0 ? "mcap" : "price"
  );
  const [bars, setBars] = useState<CandleBar[]>([]);
  const [resolvedPool, setResolvedPool] = useState<string | null>(poolAddress || null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hoverBar, setHoverBar] = useState<CandleBar | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const isEvmToken =
    chainFamily === "evm" ||
    mintAddress.startsWith("0x") ||
    Boolean(networkName?.toLowerCase().includes("robinhood"));

  const supplyMultiplier = useMemo(() => {
    if (mode === "mcap" && totalSupply && totalSupply > 0) return totalSupply;
    return 1;
  }, [mode, totalSupply]);

  useEffect(() => {
    setResolvedPool(poolAddress || null);
  }, [poolAddress, mintAddress]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);

    const params = new URLSearchParams({ mint: mintAddress, tf });
    if (poolAddress) params.set("pool", poolAddress);
    if (networkName) {
      params.set(
        "network",
        networkName.toLowerCase().includes("robinhood") ? "robinhood" : networkName
      );
    } else if (isEvmToken) {
      params.set("network", "eth");
    }

    fetch(`/api/token-chart?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { ok?: boolean; poolAddress?: string | null; bars?: CandleBar[]; error?: string; note?: string }) => {
        if (cancelled) return;
        if (json.poolAddress) setResolvedPool(json.poolAddress);
        if (Array.isArray(json.bars) && json.bars.length > 0) {
          setBars(json.bars);
          setErrorMsg(null);
        } else {
          setBars([]);
          setErrorMsg(json.error || json.note || "No pool candlestick bars returned yet.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBars([]);
        setErrorMsg(err instanceof Error ? err.message : "Failed to load TradingView feed.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mintAddress, poolAddress, tf, refreshTick, networkName, isEvmToken]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: "#090B10" },
        textColor: "#8A91A2",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.035)" },
        horzLines: { color: "rgba(255, 255, 255, 0.035)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(41, 52, 255, 0.55)", labelBackgroundColor: "#2934FF" },
        horzLine: { color: "rgba(41, 52, 255, 0.55)", labelBackgroundColor: "#2934FF" },
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.07)",
        scaleMargins: { top: 0.14, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.08)",
        timeVisible: true,
        secondsVisible: tf === "1m",
      },
      localization: {
        priceFormatter: (price: number) => formatCompactPrice(price, supplyMultiplier > 1),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10B981",
      downColor: "#EF4444",
      borderUpColor: "#10B981",
      borderDownColor: "#EF4444",
      wickUpColor: "#10B981",
      wickDownColor: "#EF4444",
      priceFormat: {
        type: "price",
        precision: supplyMultiplier > 1 ? 0 : 8,
        minMove: supplyMultiplier > 1 ? 1 : 0.00000001,
      },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const scaledCandles = bars.map((b) => ({
      time: b.time as UTCTimestamp,
      open: b.open * supplyMultiplier,
      high: b.high * supplyMultiplier,
      low: b.low * supplyMultiplier,
      close: b.close * supplyMultiplier,
    }));

    const volumeData = bars.map((b) => ({
      time: b.time as UTCTimestamp,
      value: b.volume,
      color: b.close >= b.open ? "rgba(16, 185, 129, 0.28)" : "rgba(239, 68, 68, 0.28)",
    }));

    candleSeries.setData(scaledCandles);
    volumeSeries.setData(volumeData);

    // Map high-signal Dev events (burn / deploy / swap) onto nearest candles without dropping secondary burns
    if (devTxs.length > 0 && bars.length > 1) {
      const minTime = bars[0].time;
      const maxTime = bars[bars.length - 1].time;

      const findNearestBar = (bt: number) => {
        let nearest = bars[0];
        let bestDiff = Infinity;
        for (const bar of bars) {
          const diff = Math.abs(bar.time - bt);
          if (diff < bestDiff) {
            bestDiff = diff;
            nearest = bar;
          }
        }
        return nearest;
      };

      const inWindow = devTxs.filter(
        (tx) =>
          !tx.err &&
          tx.blockTime &&
          tx.blockTime >= minTime - 3600 &&
          tx.blockTime <= maxTime + 1800 &&
          (tx.action === "burn" || tx.action === "deploy" || tx.action === "swap")
      );

      // Group burns per candle so multiple burns in same bar count as BURN xN while distinct candles each get BURN
      const burnCountsByBar = new Map<number, number>();
      const nonBurnByBar = new Map<number, "deploy" | "swap">();

      for (const tx of inWindow) {
        const nearest = findNearestBar(tx.blockTime!);
        if (tx.action === "burn") {
          burnCountsByBar.set(nearest.time, (burnCountsByBar.get(nearest.time) || 0) + 1);
        } else if (tx.action === "deploy") {
          nonBurnByBar.set(nearest.time, "deploy");
        } else if (tx.action === "swap" && !nonBurnByBar.has(nearest.time)) {
          nonBurnByBar.set(nearest.time, "swap");
        }
      }

      const markers: SeriesMarker<Time>[] = [];
      for (const [barTime, count] of burnCountsByBar.entries()) {
        markers.push({
          time: barTime as UTCTimestamp,
          position: "aboveBar",
          color: "#F59E0B",
          shape: "circle",
          text: count > 1 ? `BURN x${count}` : "BURN",
        });
      }
      for (const [barTime, action] of nonBurnByBar.entries()) {
        if (action === "deploy") {
          markers.push({
            time: barTime as UTCTimestamp,
            position: "belowBar",
            color: "#60A5FA",
            shape: "arrowUp",
            text: "DEV",
          });
        } else {
          markers.push({
            time: barTime as UTCTimestamp,
            position: "belowBar",
            color: "#A78BFA",
            shape: "circle",
            text: "SWAP",
          });
        }
      }

      markers.sort((a, b) => Number(a.time) - Number(b.time));
      if (markers.length > 0) {
        createSeriesMarkers(candleSeries, markers);
      }
    }

    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoverBar(null);
        return;
      }
      const match = bars.find((b) => b.time === Number(param.time));
      setHoverBar(match || null);
    });

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 100) chart.applyOptions({ width: w });
      }
    });
    ro.observe(el);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [bars, devTxs, supplyMultiplier, tf]);

  const activeBar = hoverBar || (bars.length > 0 ? bars[bars.length - 1] : null);
  const isMcapMode = supplyMultiplier > 1;
  const pctChange =
    bars.length >= 2 && bars[0].open > 0
      ? ((bars[bars.length - 1].close - bars[0].open) / bars[0].open) * 100
      : null;

  const burnEventsCount = devTxs.filter((t) => !t.err && t.action === "burn").length;
  const deployEventsCount = devTxs.filter((t) => !t.err && t.action === "deploy").length;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#090B10] overflow-hidden">
      {/* Compact Unified Chart Header Bar */}
      <div className="px-3.5 py-2.5 border-b border-white/[0.06] bg-[#0D1017] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {totalSupply && totalSupply > 0 ? (
            <div className="inline-flex rounded-md border border-white/10 bg-[#07090D] p-0.5">
              <button
                type="button"
                onClick={() => setMode("mcap")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  mode === "mcap"
                    ? "bg-white/12 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                MC
              </button>
              <button
                type="button"
                onClick={() => setMode("price")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  mode === "price"
                    ? "bg-white/12 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Price
              </button>
            </div>
          ) : null}

          <div className="inline-flex rounded-md border border-white/10 bg-[#07090D] p-0.5">
            {(["1m", "5m", "15m", "1h"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTf(item)}
                className={`px-2 py-0.5 rounded font-mono tabular-nums text-[11px] transition-colors cursor-pointer ${
                  tf === item
                    ? "bg-[#2934FF] text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <span className="hidden sm:inline font-mono text-[11px] text-slate-400 pl-1">
            {symbol || "TOKEN"}/
            {quoteSymbol ||
              (isEvmToken
                ? networkName?.toLowerCase().includes("robinhood")
                  ? "ETH"
                  : "USD"
                : "SOL")}
          </span>
        </div>

        <div className="flex items-center gap-2.5 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live</span>
          </span>
          {pctChange !== null ? (
            <span
              className={`font-mono tabular-nums font-medium ${
                pctChange >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {pctChange >= 0 ? "+" : ""}
              {pctChange.toFixed(1)}%
            </span>
          ) : null}
          {resolvedPool ? (
            <span className="hidden md:inline font-mono text-slate-500">
              Pool {resolvedPool.slice(0, 6)}...
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            title="Refresh candles"
            className="p-1.5 rounded-md border border-white/10 bg-[#07090D] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Chart Canvas + Embedded Floating OHLCV / Marker Legend */}
      <div className="relative bg-[#090B10] min-h-[400px]">
        {bars.length > 0 && (
          <div className="pointer-events-none absolute top-2.5 left-3 right-16 z-10 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="px-2.5 py-1 rounded-md bg-[#090B10]/85 backdrop-blur-sm border border-white/[0.06] font-mono tabular-nums text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {activeBar ? (
                <>
                  <span>
                    O{" "}
                    <strong className="text-white font-medium">
                      {formatCompactPrice(activeBar.open * supplyMultiplier, isMcapMode) || "—"}
                    </strong>
                  </span>
                  <span>
                    H{" "}
                    <strong className="text-emerald-400 font-medium">
                      {formatCompactPrice(activeBar.high * supplyMultiplier, isMcapMode) || "—"}
                    </strong>
                  </span>
                  <span>
                    L{" "}
                    <strong className="text-rose-400 font-medium">
                      {formatCompactPrice(activeBar.low * supplyMultiplier, isMcapMode) || "—"}
                    </strong>
                  </span>
                  <span>
                    C{" "}
                    <strong className="text-white font-medium">
                      {formatCompactPrice(activeBar.close * supplyMultiplier, isMcapMode) || "—"}
                    </strong>
                  </span>
                  <span className="text-slate-400">
                    Vol ${Math.round(activeBar.volume).toLocaleString("en-US")}
                  </span>
                </>
              ) : (
                <span className="text-slate-400">Loading OHLCV...</span>
              )}
            </div>

            {(burnEventsCount > 0 || deployEventsCount > 0) && (
              <div className="px-2 py-1 rounded-md bg-[#090B10]/85 backdrop-blur-sm border border-white/[0.06] inline-flex items-center gap-2 text-[10px] font-medium">
                {burnEventsCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <Flame className="w-3 h-3" />
                    {burnEventsCount} {burnEventsCount === 1 ? "Burn" : "Burns"}
                  </span>
                )}
                {deployEventsCount > 0 && (
                  <span className="text-sky-300">DEV Launch</span>
                )}
              </div>
            )}
          </div>
        )}

        {loading && bars.length === 0 ? (
          <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-[#84A7FF]" />
            <span>Loading live TradingView OHLCV candlesticks...</span>
          </div>
        ) : bars.length === 0 ? (
          <div className="h-[400px] flex flex-col items-center justify-center gap-3 px-6 text-center text-xs text-slate-400">
            <Activity className="w-6 h-6 text-slate-500" />
            <span>
              {errorMsg && !errorMsg.includes("Solana")
                ? errorMsg
                : isEvmToken
                ? "No indexed liquidity pool OHLCV candles available on EVM/Robinhood DEX yet."
                : "No indexed liquidity pool OHLCV data available yet."}
            </span>
            {resolvedPool && (
              <a
                href={`https://dexscreener.com/${
                  networkName?.toLowerCase().includes("robinhood")
                    ? "robinhood"
                    : isEvmToken
                    ? "ethereum"
                    : "solana"
                }/${resolvedPool}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 transition-colors"
              >
                Open Live Chart on DexScreener ↗
              </a>
            )}
          </div>
        ) : (
          <div ref={containerRef} className="w-full h-[400px]" />
        )}
      </div>
    </div>
  );
}
