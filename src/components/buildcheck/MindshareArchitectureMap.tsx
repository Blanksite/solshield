"use client";

import React, { useMemo, useState } from "react";
import {
  ExternalLink,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  buildMindshareArchitectureTiles,
  computeSquarifiedTreemap,
  type MindshareArchitectureTile,
  type MindshareTimeframe,
  type MindshareWeightMode,
  type TelemetryLensId,
} from "@/lib/buildcheck/mindshare-architecture";
import type { SocialMindshareReport } from "@/lib/buildcheck/types";

const TILE_PALETTE = [
  {
    bg: "bg-gradient-to-br from-[#D62B20] to-[#9E1912]",
    border: "border-[#F87171]/45",
    dot: "#D62B20",
  },
  {
    bg: "bg-gradient-to-br from-[#0284C7] to-[#036194]",
    border: "border-[#38BDF8]/45",
    dot: "#0284C7",
  },
  {
    bg: "bg-gradient-to-br from-[#E25A08] to-[#B44105]",
    border: "border-[#FB923C]/45",
    dot: "#E25A08",
  },
  {
    bg: "bg-gradient-to-br from-[#7332EC] to-[#531BC2]",
    border: "border-[#A78BFA]/45",
    dot: "#7332EC",
  },
  {
    bg: "bg-gradient-to-br from-[#059669] to-[#04724E]",
    border: "border-[#34D399]/45",
    dot: "#059669",
  },
  {
    bg: "bg-gradient-to-br from-[#334155] to-[#1E293B]",
    border: "border-slate-400/35",
    dot: "#475569",
  },
];

const LENS_OPTIONS: Array<{
  id: TelemetryLensId;
  title: string;
  subtitle: string;
}> = [
  {
    id: "topics",
    title: "Discussion Topics",
    subtitle: "Core narrative sub-themes on X",
  },
  {
    id: "accounts",
    title: "KOL & Key Accounts",
    subtitle: "Accounts driving token mentions",
  },
  {
    id: "drivers",
    title: "Sentiment Drivers",
    subtitle: "Utility vs speculation vs FUD",
  },
  {
    id: "cohorts",
    title: "Community Channels",
    subtitle: "Devs, security scouts & alpha callers",
  },
];

export function MindshareArchitectureMap({
  social,
  symbol,
  selectedTileId,
  onSelectTile,
  onClearTileFilter,
}: {
  social: SocialMindshareReport;
  symbol?: string | null;
  selectedTileId: string | null;
  onSelectTile: (tile: MindshareArchitectureTile) => void;
  onClearTileFilter: () => void;
}) {
  const [lens, setLens] = useState<TelemetryLensId>("topics");
  const [timeframe, setTimeframe] = useState<MindshareTimeframe>("7d");
  const [weightMode, setWeightMode] = useState<MindshareWeightMode>("relative");
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredTileId, setHoveredTileId] = useState<string | null>(null);

  const tickerLabel = symbol
    ? `$${symbol.replace(/^\$+/, "").toUpperCase()}`
    : social.officialProfile?.username
      ? `@${social.officialProfile.username}`
      : "TARGET";

  const { tiles, scopedPosts } = useMemo(
    () =>
      buildMindshareArchitectureTiles({
        social,
        lens,
        timeframe,
        weightMode,
        searchQuery,
      }),
    [social, lens, timeframe, weightMode, searchQuery]
  );

  const rects = useMemo(() => computeSquarifiedTreemap(tiles), [tiles]);

  const activeTile = useMemo(() => {
    const idToFind = selectedTileId || hoveredTileId;
    if (idToFind) {
      const hit = tiles.find((t) => t.id === idToFind);
      if (hit) return hit;
    }
    return tiles[0] ?? null;
  }, [tiles, selectedTileId, hoveredTileId]);

  const scopedConviction = useMemo(() => {
    const rawPool = scopedPosts.length > 0 ? scopedPosts : social.posts || [];
    const officialLower = social.officialProfile?.username.toLowerCase() || null;
    const externalPool = officialLower
      ? rawPool.filter((p) => p.authorUsername.toLowerCase() !== officialLower)
      : rawPool;
    const pool = externalPool.length > 0 ? externalPool : rawPool;
    const denom = Math.max(1, pool.length);
    const bull = pool.filter((p) => p.stance === "BULLISH").length;
    const organic = pool.filter((p) => p.stance !== "SHILL_NOISE").length;
    return {
      bullishPct: pool.length > 0 ? Math.round((bull / denom) * 100) : social.sentimentBreakdown.bullishPct,
      organicPct: pool.length > 0 ? Math.round((organic / denom) * 100) : social.organicSignalPct,
    };
  }, [scopedPosts, social]);

  const leadVoiceHandle = social.officialProfile?.username || social.topVoices[0]?.authorUsername || null;

  return (
    <div
      data-testid="mindshare-architecture-map"
      className="bg-[#0B0E14] border-b border-white/[0.06]"
    >
      {/* Architecture Header Bar */}
      <div className="px-5 py-3.5 border-b border-white/[0.07] bg-[#090B10] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#111622] border border-white/15 flex items-center justify-center shrink-0 text-white">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs sm:text-sm font-mono font-bold uppercase tracking-[0.06em] text-white">
                {tickerLabel} · X (Crypto Twitter) Mindshare Architecture
              </h4>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-mono text-[10px] font-semibold uppercase">
                CA-Specific
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Breakdown of{" "}
              <span className="font-mono text-slate-200">{scopedPosts.length}</span>{" "}
              live sampled X posts discussing {tickerLabel} across sub-topics, KOLs, sentiment &amp; community channels.
            </p>
          </div>
        </div>

        {/* Filter, Relative/Posts Toggle & Timeframe Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              data-testid="mindshare-treemap-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter topics..."
              aria-label="Filter mindshare topics"
              className="pl-8 pr-7 py-1.5 rounded-lg bg-[#05070C] border border-white/12 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#5D82FF] w-40 sm:w-44 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear topic filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            data-testid="mindshare-relative-toggle"
            onClick={() =>
              setWeightMode((prev) => (prev === "relative" ? "posts" : "relative"))
            }
            title={
              weightMode === "relative"
                ? "Weighted by engagement + KOL reach"
                : "Weighted purely by post count"
            }
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#05070C] border border-white/12 hover:border-white/25 text-xs text-slate-200 cursor-pointer transition-colors"
          >
            <span>{weightMode === "relative" ? "Relative" : "Posts %"}</span>
            <span
              className={`w-7 h-3.5 rounded-full p-0.5 flex items-center transition-colors ${
                weightMode === "relative"
                  ? "bg-sky-500 justify-end"
                  : "bg-slate-600 justify-start"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-white" />
            </span>
          </button>

          <div className="inline-flex items-center rounded-lg bg-[#05070C] border border-white/12 p-0.5">
            {(
              [
                { id: "24h", label: "24H" },
                { id: "72h", label: "72H" },
                { id: "7d", label: "7D" },
              ] as Array<{ id: MindshareTimeframe; label: string }>
            ).map((tf) => (
              <button
                key={tf.id}
                type="button"
                data-testid={`mindshare-tf-${tf.id}`}
                onClick={() => {
                  setTimeframe(tf.id);
                  onClearTileFilter();
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                  timeframe === tf.id
                    ? "bg-[#2934FF] text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split Grid: Treemap (8 cols) + Telemetry Lens Sidebar (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Left: Squarified Proportional Treemap */}
        <div className="lg:col-span-8 p-4 sm:p-5 space-y-3 bg-[#07090F]">
          {rects.length > 0 ? (
            <>
              {/* Desktop Squarified Layout */}
              <div
                data-testid="mindshare-treemap-grid"
                className="hidden md:block relative w-full h-[420px] rounded-xl bg-[#04060A] border border-white/[0.06] overflow-hidden"
              >
                {rects.map((rect, idx) => {
                  const palette = TILE_PALETTE[idx % TILE_PALETTE.length];
                  const isSelected = selectedTileId === rect.tile.id;
                  const isCompact = rect.hPct < 45 || rect.wPct < 35;
                  const isTight = rect.wPct < 34 || rect.hPct < 40;
                  const isNarrowHeader = rect.wPct < 36;
                  const isLarge = rect.wPct >= 40 && rect.hPct >= 42;

                  return (
                    <div
                      key={rect.tile.id}
                      style={{
                        left: `${rect.xPct}%`,
                        top: `${rect.yPct}%`,
                        width: `${rect.wPct}%`,
                        height: `${rect.hPct}%`,
                      }}
                      className="absolute p-1 box-border"
                    >
                      <button
                        type="button"
                        data-testid={`mindshare-tile-${idx}`}
                        onClick={() => {
                          if (isSelected) onClearTileFilter();
                          else onSelectTile(rect.tile);
                        }}
                        onMouseEnter={() => setHoveredTileId(rect.tile.id)}
                        onMouseLeave={() => setHoveredTileId(null)}
                        className={`w-full h-full rounded-xl border ${palette.bg} ${palette.border} ${
                          isCompact ? "p-2.5 sm:p-3" : "p-3.5 sm:p-4"
                        } flex flex-col justify-between text-left transition-all duration-150 hover:brightness-110 cursor-pointer relative overflow-hidden ${
                          isSelected
                            ? "ring-2 ring-white shadow-[0_0_24px_rgba(255,255,255,0.22)] z-10"
                            : ""
                        }`}
                      >
                        <div className="space-y-1 min-w-0 w-full">
                          <div
                            className={`flex ${
                              isNarrowHeader
                                ? "flex-col items-start gap-1"
                                : "items-start justify-between gap-2"
                            }`}
                          >
                            <span
                              className={`font-semibold text-white tracking-tight leading-snug line-clamp-2 min-w-0 ${
                                isLarge
                                  ? "text-base sm:text-lg"
                                  : isCompact
                                    ? "text-xs sm:text-[13px]"
                                    : "text-sm"
                              }`}
                            >
                              {rect.tile.title}
                            </span>
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-black/45 border border-white/15 text-[9px] sm:text-[10px] font-mono font-semibold text-white whitespace-nowrap">
                              {rect.tile.badgeText}
                            </span>
                          </div>
                          {!isCompact && (
                            <p className="text-[11px] text-white/80 leading-snug line-clamp-2">
                              {rect.tile.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-end justify-between gap-1.5 pt-1.5 border-t border-white/15 w-full">
                          <div className="min-w-0">
                            <span className="text-[10px] font-mono text-white/85 block truncate">
                              {rect.tile.postCount}{" "}
                              {rect.tile.postCount === 1 ? "post" : "posts"}
                            </span>
                            {!isTight && rect.tile.tags.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {rect.tile.tags.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag}
                                    className="px-1.5 py-0.5 rounded bg-black/35 border border-white/15 text-[9px] font-mono text-white/95"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div
                            className={`font-mono font-bold tabular-nums leading-none text-white shrink-0 ${
                              isLarge
                                ? "text-2xl sm:text-3xl"
                                : isCompact
                                  ? "text-base sm:text-lg"
                                  : "text-lg sm:text-xl"
                            }`}
                          >
                            {rect.tile.sharePct.toFixed(1)}%
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Mobile / Narrow Viewport Stacked Bento Fallback */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:hidden">
                {tiles.map((tile, idx) => {
                  const palette = TILE_PALETTE[idx % TILE_PALETTE.length];
                  const isSelected = selectedTileId === tile.id;
                  return (
                    <button
                      key={tile.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) onClearTileFilter();
                        else onSelectTile(tile);
                      }}
                      className={`rounded-xl border ${palette.bg} ${palette.border} p-3.5 text-left flex flex-col justify-between gap-3 cursor-pointer transition-all ${
                        isSelected ? "ring-2 ring-white" : ""
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-white leading-snug">
                            {tile.title}
                          </span>
                          <span className="shrink-0 px-2 py-0.5 rounded bg-black/45 border border-white/15 text-[10px] font-mono text-white">
                            {tile.badgeText}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/80 leading-snug">
                          {tile.description}
                        </p>
                      </div>

                      <div className="flex items-end justify-between pt-2 border-t border-white/15">
                        <span className="text-[11px] font-mono text-white/85">
                          {tile.postCount} {tile.postCount === 1 ? "post" : "posts"}
                        </span>
                        <span className="text-xl font-mono font-bold tabular-nums text-white">
                          {tile.sharePct.toFixed(1)}%
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Tile Status / Quick Action Strip */}
              {activeTile && (
                <div className="rounded-lg border border-white/[0.08] bg-[#090B10] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          TILE_PALETTE[
                            Math.max(0, tiles.findIndex((t) => t.id === activeTile.id)) %
                              TILE_PALETTE.length
                          ].dot,
                      }}
                    />
                    <span className="font-semibold text-white truncate">
                      {activeTile.title}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono text-[#93C5FD] tabular-nums">
                      {activeTile.sharePct.toFixed(1)}% share ({activeTile.postCount}{" "}
                      {activeTile.postCount === 1 ? "post" : "posts"})
                    </span>
                    {selectedTileId && (
                      <button
                        type="button"
                        onClick={onClearTileFilter}
                        className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#2934FF]/20 border border-[#5D82FF]/40 text-[11px] font-mono text-[#BFD0FF] hover:bg-[#2934FF]/35 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                        <span>Clear block filter</span>
                      </button>
                    )}
                  </div>

                  <span className="text-[11px] text-slate-400">
                    {selectedTileId
                      ? "Showing posts inside this block below"
                      : "Click any block to filter X voices below"}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="h-[260px] rounded-xl border border-white/[0.07] bg-[#090B10] p-6 flex flex-col items-center justify-center text-center space-y-2">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-300">
                No X Mindshare Clusters in Current Filter
              </div>
              <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                {social.posts.length === 0
                  ? "This token is pre-discovery on X or returned 0 recent public posts in the 7-day search window."
                  : `No sampled X posts matched "${searchQuery || timeframe}".`}
              </p>
              {(searchQuery || timeframe !== "7d") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setTimeframe("7d");
                    onClearTileFilter();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#2934FF]/20 border border-[#5D82FF]/40 text-xs font-mono text-[#BFD0FF] hover:bg-[#2934FF]/35 cursor-pointer"
                >
                  Reset to full 7D window
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar: 4 Switchable Telemetry Lenses + Conviction Rating */}
        <div
          data-testid="mindshare-lens-sidebar"
          className="lg:col-span-4 p-4 sm:p-5 border-t lg:border-t-0 lg:border-l border-white/[0.07] bg-[#0B0E14] flex flex-col justify-between gap-4"
        >
          <div className="space-y-3">
            <div className="pb-2.5 border-b border-white/[0.07]">
              <h5 className="text-xs font-mono font-bold uppercase tracking-[0.08em] text-white">
                {tickerLabel} Social Metrics
              </h5>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                Switch telemetry lens across sampled X discussions for this token.
              </p>
            </div>

            <div className="space-y-2">
              {LENS_OPTIONS.map((opt) => {
                const isActive = lens === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`mindshare-lens-${opt.id}`}
                    onClick={() => {
                      setLens(opt.id);
                      onClearTileFilter();
                    }}
                    className={`w-full min-h-[54px] px-3 py-2.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer ${
                      isActive
                        ? "bg-[#090B10] border-sky-400/70 shadow-[0_0_16px_rgba(56,189,248,0.12)]"
                        : "bg-white/[0.02] border-white/[0.06] hover:border-white/15 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-white block">
                        {opt.title}
                      </span>
                      <span className="text-[11px] text-slate-400 block truncate">
                        {opt.subtitle}
                      </span>
                    </div>
                    <span
                      className={`w-8 h-4 rounded-full p-0.5 flex items-center shrink-0 transition-colors ${
                        isActive
                          ? "bg-sky-400 justify-end"
                          : "bg-slate-700 justify-start"
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full bg-white" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Token Conviction Rating Footer Box */}
          <div className="rounded-xl border border-white/[0.08] bg-[#090B10] p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-sky-300">
              <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
              <span>Token Conviction Rating</span>
            </div>

            <div className="flex items-baseline justify-between text-xs">
              <span className="text-slate-300">Bullish CT Mindshare</span>
              <span className="font-mono font-bold tabular-nums text-emerald-400">
                {scopedConviction.bullishPct}%
              </span>
            </div>

            <div className="flex items-baseline justify-between text-xs">
              <span className="text-slate-400">Organic Non-Shill Signal</span>
              <span className="font-mono font-semibold tabular-nums text-slate-200">
                {scopedConviction.organicPct}%
              </span>
            </div>

            {leadVoiceHandle && (
              <div className="pt-2 border-t border-white/[0.06]">
                <a
                  href={`https://x.com/${leadVoiceHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono text-[#93C5FD] hover:underline inline-flex items-center gap-1"
                >
                  <span>Lead Voice: @{leadVoiceHandle}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
