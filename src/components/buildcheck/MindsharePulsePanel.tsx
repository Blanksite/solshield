"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  CheckCircle2,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  MessageSquareText,
  Radio,
  Repeat2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import type { MindshareArchitectureTile } from "@/lib/buildcheck/mindshare-architecture";
import { MindshareArchitectureMap } from "./MindshareArchitectureMap";
import type {
  HypeBuildQuadrant,
  KolTier,
  MindshareMomentum,
  MindshareStance,
  SocialMindshareReport,
  XMindsharePost,
} from "@/lib/buildcheck/types";
import { formatRelativeTime } from "@/lib/buildcheck/war-room-metrics";

type DiscourseFilter = "all" | "kols" | "bullish" | "skeptical" | "shill";

function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function quadrantTone(q: HypeBuildQuadrant): {
  badge: string;
  text: string;
  bar: string;
} {
  switch (q) {
    case "CONVICTION_RUNNER":
      return {
        badge: "bg-emerald-500/12 text-emerald-300 border-emerald-500/35",
        text: "text-emerald-300",
        bar: "bg-emerald-400",
      };
    case "UNDERVALUED_BUILDER":
      return {
        badge: "bg-[#2934FF]/18 text-[#93C5FD] border-[#5D82FF]/40",
        text: "text-[#93C5FD]",
        bar: "bg-[#5D82FF]",
      };
    case "NARRATIVE_OVERHEAT":
      return {
        badge: "bg-rose-500/12 text-rose-300 border-rose-500/35",
        text: "text-rose-300",
        bar: "bg-rose-400",
      };
    case "CONTESTED_DISCOURSE":
      return {
        badge: "bg-amber-500/12 text-amber-300 border-amber-500/35",
        text: "text-amber-300",
        bar: "bg-amber-400",
      };
    default:
      return {
        badge: "bg-white/[0.05] text-slate-300 border-white/15",
        text: "text-slate-300",
        bar: "bg-slate-400",
      };
  }
}

function momentumStyle(m: MindshareMomentum): string {
  switch (m) {
    case "SURGING":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/35";
    case "ACTIVE":
      return "bg-[#2934FF]/18 text-[#93C5FD] border-[#5D82FF]/40";
    case "EARLY":
      return "bg-amber-500/12 text-amber-300 border-amber-500/30";
    default:
      return "bg-white/[0.04] text-slate-400 border-white/12";
  }
}

function kolTierStyle(tier: KolTier): { label: string; cls: string } {
  switch (tier) {
    case "MEGA":
      return {
        label: "MEGA KOL",
        cls: "bg-purple-500/15 text-purple-300 border-purple-400/35",
      };
    case "ALPHA":
      return {
        label: "ALPHA KOL",
        cls: "bg-[#2934FF]/20 text-[#93C5FD] border-[#5D82FF]/40",
      };
    case "MID":
      return {
        label: "KOL",
        cls: "bg-cyan-500/12 text-cyan-300 border-cyan-500/35",
      };
    default:
      return {
        label: "COMMUNITY",
        cls: "bg-white/[0.04] text-slate-400 border-white/12",
      };
  }
}

function stanceBadgeStyle(stance: MindshareStance): { label: string; cls: string } {
  switch (stance) {
    case "BULLISH":
      return {
        label: "Bullish",
        cls: "bg-emerald-500/12 text-emerald-300 border-emerald-500/30",
      };
    case "SKEPTICAL":
      return {
        label: "Skeptical",
        cls: "bg-amber-500/12 text-amber-300 border-amber-500/30",
      };
    case "SHILL_NOISE":
      return {
        label: "Shill Noise",
        cls: "bg-rose-500/12 text-rose-300 border-rose-500/30",
      };
    default:
      return {
        label: "Neutral",
        cls: "bg-white/[0.05] text-slate-300 border-white/15",
      };
  }
}

function sourceLabel(source: SocialMindshareReport["source"]): string {
  switch (source) {
    case "hybrid":
      return "X API v2 + Venice AI";
    case "x-api-v2":
      return "X API v2 Live";
    case "venice-x-search":
      return "Venice X Search";
    default:
      return "No Live X Feed";
  }
}

export function MindsharePulsePanel({
  social,
  symbol,
  onScanMindshare,
  isScanningMindshare,
  scanError,
}: {
  social: SocialMindshareReport | null | undefined;
  symbol?: string | null;
  onScanMindshare?: () => void;
  isScanningMindshare?: boolean;
  scanError?: string | null;
}) {
  const [filter, setFilter] = useState<DiscourseFilter>("all");
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [selectedTile, setSelectedTile] = useState<{
    id: string;
    title: string;
    postIds: string[];
  } | null>(null);

  const filteredPosts = useMemo<XMindsharePost[]>(() => {
    if (!social) return [];
    let list = social.posts || [];
    if (selectedTile && selectedTile.postIds.length > 0) {
      const allowed = new Set(selectedTile.postIds);
      list = list.filter((p) => allowed.has(p.id));
    }
    switch (filter) {
      case "kols":
        return list.filter((p) => p.isKol);
      case "bullish":
        return list.filter((p) => p.stance === "BULLISH");
      case "skeptical":
        return list.filter((p) => p.stance === "SKEPTICAL");
      case "shill":
        return list.filter((p) => p.stance === "SHILL_NOISE");
      default:
        return list;
    }
  }, [social, filter, selectedTile]);

  if (!social) {
    return (
      <div
        data-testid="mindshare-pulse-panel"
        className="p-8 sm:p-12 text-center space-y-4 max-w-xl mx-auto"
      >
        <div className="w-14 h-14 rounded-2xl bg-[#2934FF]/14 border border-[#5D82FF]/30 flex items-center justify-center mx-auto text-[#60A5FA] shadow-[0_0_24px_rgba(41,52,255,0.2)]">
          <Radio className={`w-7 h-7 ${isScanningMindshare ? "animate-pulse" : ""}`} />
        </div>
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-blue-500/10 border border-blue-500/25 text-blue-300 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            <span>On-Demand Analysis</span>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
            X Mindshare &amp; KOL Discourse is On-Demand
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Scanning live X threads, KOL consensus, and sentiment breakdown is kept on-demand so core forensic audits (mint authorities, code, domain, and LP) stay lightning fast.
          </p>
        </div>

        {scanError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs text-left flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{scanError}</span>
          </div>
        )}

        {onScanMindshare && (
          <div className="pt-2">
            <button
              type="button"
              onClick={onScanMindshare}
              disabled={isScanningMindshare}
              className="px-6 py-2.5 rounded-xl bg-[#2934FF] hover:bg-[#3D49FF] disabled:bg-[#2934FF]/40 text-white font-semibold text-xs sm:text-sm transition-all shadow-[0_4px_20px_rgba(41,52,255,0.36)] hover:shadow-[0_6px_24px_rgba(41,52,255,0.48)] flex items-center gap-2 mx-auto cursor-pointer"
            >
              {isScanningMindshare ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin text-[#93C5FD]" />
                  <span>Scanning Live X Threads &amp; KOLs...</span>
                </>
              ) : (
                <>
                  <Radio className="w-4 h-4 text-[#93C5FD]" />
                  <span>⚡ Scan X Mindshare &amp; KOLs Now</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  const qTone = quadrantTone(social.quadrant);
  const { bullishPct, neutralPct, skepticalPct, shillNoisePct } = social.sentimentBreakdown;
  const maxDailyEngagement = Math.max(
    1,
    ...(social.dailyBuckets || []).map((b) => b.postCount)
  );
  const visiblePosts = showAllPosts ? filteredPosts : filteredPosts.slice(0, 8);
  const primarySearchHref = social.queriesUsed?.[0]
    ? `https://x.com/search?q=${encodeURIComponent(social.queriesUsed[0])}&src=typed_query&f=top`
    : symbol
      ? `https://x.com/search?q=${encodeURIComponent(`$${symbol.replace(/^\$+/, "")} solana`)}&src=typed_query&f=top`
      : null;

  return (
    <div data-testid="mindshare-pulse-panel" className="divide-y divide-white/[0.06]">
      {/* 1. Header KPI Strip */}
      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 bg-[#0B0E14]">
        {/* Mindshare Gauge */}
        <div className="lg:col-span-4 rounded-xl border border-white/[0.08] bg-[#090B10] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-[#84A7FF]" />
              <span className="text-[11px] font-mono uppercase tracking-[0.08em] text-slate-300">
                X Mindshare Pulse
              </span>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${momentumStyle(
                social.momentum
              )}`}
            >
              {social.momentum}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <div className="font-mono tabular-nums text-3xl font-bold text-white">
              {social.mindshareScore}
              <span className="text-sm font-normal text-slate-500">/100</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[10px] font-mono text-slate-400">
              {sourceLabel(social.source)}
            </span>
          </div>

          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${qTone.bar}`}
              style={{ width: `${social.mindshareScore}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono">
            <div>
              <div className="text-slate-500 text-[10px]">POSTS</div>
              <div className="text-white tabular-nums font-semibold">
                {social.totalPostsSampled}
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-[10px]">AUTHORS</div>
              <div className="text-white tabular-nums font-semibold">
                {social.uniqueAuthors}
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-[10px]">KOLS ≥2K</div>
              <div className="text-[#93C5FD] tabular-nums font-semibold">
                {social.kolCount}
              </div>
            </div>
          </div>
        </div>

        {/* Hype-vs-Build Quadrant + Organic Ratio */}
        <div className="lg:col-span-4 rounded-xl border border-white/[0.08] bg-[#090B10] p-4 flex flex-col justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.08em] text-slate-300">
                <TrendingUp className="w-3.5 h-3.5 text-[#84A7FF]" />
                <span>Hype vs. Build Alignment</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${qTone.badge}`}
              >
                {social.quadrantLabel}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {social.quadrantSummary}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.06] text-[11px] font-mono">
            <div className="min-w-0">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                Impressions
              </div>
              <div className="text-white tabular-nums font-semibold">
                {formatCompactCount(social.totalImpressions)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                Engaged
              </div>
              <div className="text-white tabular-nums font-semibold">
                {formatCompactCount(social.totalEngagement)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                Organic
              </div>
              <div
                className={`tabular-nums font-semibold ${
                  social.organicSignalPct >= 70
                    ? "text-emerald-300"
                    : social.organicSignalPct >= 45
                      ? "text-amber-300"
                      : "text-rose-300"
                }`}
              >
                {social.organicSignalPct}%
              </div>
            </div>
          </div>
        </div>

        {/* Official X Profile Card */}
        <div className="lg:col-span-4 rounded-xl border border-white/[0.08] bg-[#090B10] p-4 flex flex-col justify-between gap-3">
          {social.officialProfile ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Project X Handle
                  </span>
                  {social.officialProfile.verified && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#2934FF]/18 text-[#93C5FD] border border-[#5D82FF]/35 text-[9px] font-mono uppercase">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      {social.officialProfile.verifiedType || "Verified"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {social.officialProfile.name}
                    </div>
                    <a
                      href={`https://x.com/${social.officialProfile.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-[#93C5FD] hover:underline inline-flex items-center gap-1"
                    >
                      <span>@{social.officialProfile.username}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
                {social.officialProfile.description && (
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {social.officialProfile.description}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.06] text-[11px] font-mono">
                <div className="min-w-0">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                    Followers
                  </div>
                  <div className="text-white font-semibold tabular-nums">
                    {formatCompactCount(social.officialProfile.followersCount)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                    Posts
                  </div>
                  <div className="text-white font-semibold tabular-nums">
                    {formatCompactCount(social.officialProfile.tweetCount)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                    Age
                  </div>
                  <div className="text-white font-semibold tabular-nums">
                    {social.officialProfile.accountAgeDays !== null
                      ? `${social.officialProfile.accountAgeDays}d`
                      : "—"}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col justify-between gap-2">
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Project X Handle
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  No verified official `@handle` resolved from token metadata or audited site links.
                </p>
              </div>
              {primarySearchHref && (
                <a
                  href={primarySearchHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.07] text-[11px] font-mono text-slate-200 transition-colors"
                >
                  <span>Search X Directly</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. CA-Specific X Mindshare Architecture Treemap & Telemetry Lenses */}
      <MindshareArchitectureMap
        social={social}
        symbol={symbol}
        selectedTileId={selectedTile?.id ?? null}
        onSelectTile={(tile: MindshareArchitectureTile) => {
          setSelectedTile({
            id: tile.id,
            title: tile.title,
            postIds: tile.postIds,
          });
          setShowAllPosts(false);
        }}
        onClearTileFilter={() => setSelectedTile(null)}
      />

      {/* 3. Sentiment Spectrum + Consensus Summary */}
      <div className="p-5 space-y-4 bg-[#0D1017]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-[#84A7FF]" />
            <span className="text-xs font-mono uppercase tracking-[0.08em] text-slate-200">
              Sentiment Spectrum &amp; Consensus
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums">
            <span className="text-emerald-300">Bullish {bullishPct}%</span>
            <span className="text-slate-300">Neutral {neutralPct}%</span>
            <span className="text-amber-300">Skeptical {skepticalPct}%</span>
            <span className="text-rose-300">Shill Noise {shillNoisePct}%</span>
          </div>
        </div>

        {/* Stacked Spectrum Bar */}
        <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden flex">
          {bullishPct > 0 && (
            <div
              className="h-full bg-emerald-400 transition-all duration-500"
              style={{ width: `${bullishPct}%` }}
              title={`Bullish ${bullishPct}%`}
            />
          )}
          {neutralPct > 0 && (
            <div
              className="h-full bg-slate-500 transition-all duration-500"
              style={{ width: `${neutralPct}%` }}
              title={`Neutral ${neutralPct}%`}
            />
          )}
          {skepticalPct > 0 && (
            <div
              className="h-full bg-amber-400 transition-all duration-500"
              style={{ width: `${skepticalPct}%` }}
              title={`Skeptical ${skepticalPct}%`}
            />
          )}
          {shillNoisePct > 0 && (
            <div
              className="h-full bg-rose-500 transition-all duration-500"
              style={{ width: `${shillNoisePct}%` }}
              title={`Shill Noise ${shillNoisePct}%`}
            />
          )}
        </div>

        <p className="text-xs sm:text-sm text-slate-200 leading-relaxed rounded-lg border border-white/[0.07] bg-[#090B10] px-4 py-3">
          {social.consensusSummary}
        </p>

        {/* Two-Column Bull vs Skeptic Arguments */}
        {(social.bullThemes.length > 0 || social.skepticQuestions.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>What Supporters &amp; KOLs Highlight</span>
              </div>
              {social.bullThemes.length > 0 ? (
                <ul className="space-y-1.5">
                  {social.bullThemes.map((t, i) => (
                    <li
                      key={`bull-${i}`}
                      className="text-xs text-slate-200 leading-relaxed flex items-start gap-2"
                    >
                      <span className="text-emerald-400 font-mono mt-0.5 shrink-0">
                        +
                      </span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  No strong positive technical/conviction themes isolated yet.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>What Skeptics Question</span>
              </div>
              {social.skepticQuestions.length > 0 ? (
                <ul className="space-y-1.5">
                  {social.skepticQuestions.map((q, i) => (
                    <li
                      key={`skep-${i}`}
                      className="text-xs text-slate-200 leading-relaxed flex items-start gap-2"
                    >
                      <span className="text-amber-400 font-mono mt-0.5 shrink-0">
                        ?
                      </span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  Minimal explicit skepticism surfaced in recent sampled threads.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Daily Velocity Buckets (when timestamps exist) */}
      {social.dailyBuckets && social.dailyBuckets.length > 0 && (
        <div className="p-5 space-y-3 bg-[#0B0E14]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.08em] text-slate-300">
              <BarChart3 className="w-3.5 h-3.5 text-[#84A7FF]" />
              <span>Recent 7-Day X Velocity</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              Posts · Unique Authors · KOLs
            </span>
          </div>

          <div className="space-y-2">
            {social.dailyBuckets.map((b) => {
              const widthPct = Math.max(6, Math.round((b.postCount / maxDailyEngagement) * 100));
              return (
                <div
                  key={b.date}
                  className="grid grid-cols-12 items-center gap-2 text-[11px] font-mono"
                >
                  <span className="col-span-3 sm:col-span-2 text-slate-400 tabular-nums">
                    {b.date.slice(5)}
                  </span>
                  <div className="col-span-5 sm:col-span-6 h-2 rounded-full bg-white/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#5D82FF]"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <div className="col-span-4 text-right text-slate-300 tabular-nums">
                    {b.postCount}p · {b.uniqueAuthors}a ·{" "}
                    <span className="text-[#93C5FD]">{b.kolCount} KOL</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Filterable X Voices & KOL Feed */}
      <div className="p-5 space-y-4 bg-[#0D1017]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="w-3.5 h-3.5 text-[#84A7FF]" />
            <span className="text-xs font-mono uppercase tracking-[0.08em] text-slate-200">
              Real X Voices &amp; KOL Threads ({filteredPosts.length})
            </span>
            {selectedTile && (
              <button
                type="button"
                onClick={() => setSelectedTile(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#2934FF]/22 border border-[#5D82FF]/45 text-[11px] font-mono text-[#BFD0FF] hover:bg-[#2934FF]/35 cursor-pointer"
              >
                <span>Block: {selectedTile.title}</span>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: "all", label: `All (${social.posts.length})` },
                {
                  id: "kols",
                  label: `KOLs (${social.posts.filter((p) => p.isKol).length})`,
                },
                {
                  id: "bullish",
                  label: `Bullish (${
                    social.posts.filter((p) => p.stance === "BULLISH").length
                  })`,
                },
                {
                  id: "skeptical",
                  label: `Skeptical (${
                    social.posts.filter((p) => p.stance === "SKEPTICAL").length
                  })`,
                },
                {
                  id: "shill",
                  label: `Shill Noise (${
                    social.posts.filter((p) => p.stance === "SHILL_NOISE").length
                  })`,
                },
              ] as Array<{ id: DiscourseFilter; label: string }>
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                data-testid={`mindshare-filter-${btn.id}`}
                onClick={() => {
                  setFilter(btn.id);
                  setShowAllPosts(false);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                  filter === btn.id
                    ? "bg-[#2934FF]/25 text-white border border-[#5D82FF]/45"
                    : "bg-white/[0.03] text-slate-400 border border-white/[0.08] hover:text-white"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {visiblePosts.length > 0 ? (
          <div className="space-y-2.5">
            {visiblePosts.map((post) => {
              const tier = kolTierStyle(post.authorTier);
              const stance = stanceBadgeStyle(post.stance);
              return (
                <article
                  key={post.id}
                  data-testid="mindshare-post-card"
                  className="rounded-xl border border-white/[0.08] bg-[#090B10] p-4 space-y-2.5 hover:border-white/15 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="text-xs font-semibold text-white truncate max-w-[160px]">
                        {post.authorName}
                      </span>
                      <a
                        href={`https://x.com/${post.authorUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-slate-400 hover:text-[#93C5FD]"
                      >
                        @{post.authorUsername}
                      </a>
                      {post.authorVerified && (
                        <ShieldCheck
                          className="w-3.5 h-3.5 text-[#60A5FA] shrink-0"
                          aria-label="Verified X Account"
                        />
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase ${tier.cls}`}
                      >
                        {tier.label}
                        {post.authorFollowers > 0
                          ? ` · ${formatCompactCount(post.authorFollowers)}`
                          : ""}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase ${stance.cls}`}
                      >
                        {stance.label}
                      </span>
                      {post.createdAt && (
                        <span className="text-[10px] font-mono text-slate-500">
                          {formatRelativeTime(post.createdAt)}
                        </span>
                      )}
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-[#93C5FD] hover:underline"
                      >
                        <span>View</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>

                  <p className="text-xs sm:text-[13px] text-slate-200 leading-relaxed whitespace-pre-line break-words">
                    {post.text}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/[0.05] text-[11px] font-mono text-slate-400">
                    <div className="flex flex-wrap items-center gap-3.5 tabular-nums">
                      <span className="inline-flex items-center gap-1" title="Impressions">
                        <Eye className="w-3 h-3 text-slate-500" />
                        {formatCompactCount(post.impressionCount)}
                      </span>
                      <span className="inline-flex items-center gap-1" title="Likes">
                        <Heart className="w-3 h-3 text-slate-500" />
                        {formatCompactCount(post.likeCount)}
                      </span>
                      <span className="inline-flex items-center gap-1" title="Reposts">
                        <Repeat2 className="w-3 h-3 text-slate-500" />
                        {formatCompactCount(post.retweetCount)}
                      </span>
                      <span className="inline-flex items-center gap-1" title="Replies">
                        <MessageCircle className="w-3 h-3 text-slate-500" />
                        {formatCompactCount(post.replyCount)}
                      </span>
                      <span className="inline-flex items-center gap-1" title="Bookmarks">
                        <Bookmark className="w-3 h-3 text-slate-500" />
                        {formatCompactCount(post.bookmarkCount)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {post.shillFlags.map((flag) => (
                        <span
                          key={flag}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/12 border border-rose-500/30 text-rose-300 text-[9px]"
                        >
                          <ShieldAlert className="w-2.5 h-2.5" />
                          {flag}
                        </span>
                      ))}
                      {post.stanceReason && (
                        <span className="text-[10px] text-slate-500 truncate max-w-[260px]">
                          {post.stanceReason}
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {filteredPosts.length > 8 && (
              <div className="pt-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllPosts((v) => !v)}
                  className="px-3 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] text-xs font-mono text-slate-300 cursor-pointer transition-colors"
                >
                  {showAllPosts
                    ? "Show fewer posts"
                    : `Show all ${filteredPosts.length} sampled posts`}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.07] bg-[#090B10] p-5 text-center space-y-2">
            <MessageSquareText className="w-5 h-5 text-slate-500 mx-auto" />
            <div className="text-xs font-mono uppercase tracking-wider text-slate-300">
              {social.posts.length === 0
                ? "Pre-Discovery / No Recent X Posts Matched"
                : "No Posts Match Selected Filter"}
            </div>
            <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">
              {social.errorNote ||
                "No recent X posts matched the exact contract address, handle, repository, or disambiguated cashtag in the search window."}
            </p>
            {social.queriesUsed.length > 0 && (
              <div className="pt-1 flex flex-wrap items-center justify-center gap-1.5">
                {social.queriesUsed.map((q) => (
                  <code
                    key={q}
                    className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[10px] font-mono text-slate-400 max-w-full truncate"
                  >
                    {q}
                  </code>
                ))}
              </div>
            )}
            {primarySearchHref && (
              <div className="pt-1">
                <a
                  href={primarySearchHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#5D82FF]/35 bg-[#2934FF]/15 text-xs font-mono text-[#BFD0FF] hover:bg-[#2934FF]/25 transition-colors"
                >
                  <span>Verify Manually on X Search</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
