"use client";

import React from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Clock,
  Code2,
  Crown,
  ExternalLink,
  Eye,
  Flame,
  RefreshCw,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import type { WalletWatchCategory } from "@/lib/buildcheck/types";
import type {
  TrackedWalletItem,
  WatchedWalletActivityEvent,
  WatchedWalletActivitySnapshot,
} from "@/lib/wallet-watch-client";

export type AnyWalletRole = WalletWatchCategory | "custom";

export interface RoleVisualMeta {
  label: string;
  badgeCls: string;
  avatarCls: string;
  accentHex: string;
  icon: React.ReactNode;
}

export function getWalletRoleMeta(role: AnyWalletRole): RoleVisualMeta {
  switch (role) {
    case "possible_mm":
      return {
        label: "Possible MM",
        badgeCls: "border-violet-500/40 bg-violet-500/12 text-violet-300",
        avatarCls:
          "border-violet-500/40 bg-gradient-to-br from-violet-500/20 to-[#0B0E17] text-violet-300",
        accentHex: "#A78BFA",
        icon: <ArrowLeftRight className="w-4 h-4" />,
      };
    case "early_buyer":
      return {
        label: "Early Buyer",
        badgeCls: "border-amber-500/40 bg-amber-500/12 text-amber-300",
        avatarCls:
          "border-amber-500/40 bg-gradient-to-br from-amber-500/20 to-[#0B0E17] text-amber-300",
        accentHex: "#FBBF24",
        icon: <Clock className="w-4 h-4" />,
      };
    case "cabal_linked":
      return {
        label: "Cabal Cluster",
        badgeCls: "border-rose-500/40 bg-rose-500/12 text-rose-300",
        avatarCls:
          "border-rose-500/40 bg-gradient-to-br from-rose-500/20 to-[#0B0E17] text-rose-300",
        accentHex: "#FB7185",
        icon: <ShieldAlert className="w-4 h-4" />,
      };
    case "dev_linked":
      return {
        label: "Dev / Creator",
        badgeCls: "border-sky-500/40 bg-sky-500/12 text-sky-300",
        avatarCls:
          "border-sky-500/40 bg-gradient-to-br from-sky-500/20 to-[#0B0E17] text-sky-300",
        accentHex: "#38BDF8",
        icon: <Code2 className="w-4 h-4" />,
      };
    case "custom":
      return {
        label: "Custom Watch",
        badgeCls: "border-emerald-500/40 bg-emerald-500/12 text-emerald-300",
        avatarCls:
          "border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 to-[#0B0E17] text-emerald-300",
        accentHex: "#34D399",
        icon: <Eye className="w-4 h-4" />,
      };
    case "top_holder":
    default:
      return {
        label: "Top Holder",
        badgeCls: "border-[#2934FF]/40 bg-[#2934FF]/14 text-[#BFD0FF]",
        avatarCls:
          "border-[#2934FF]/40 bg-gradient-to-br from-[#2934FF]/22 to-[#0B0E17] text-[#93C5FD]",
        accentHex: "#60A5FA",
        icon: <Crown className="w-4 h-4" />,
      };
  }
}

export function WalletRoleAvatar({ role }: { role: AnyWalletRole }) {
  const meta = getWalletRoleMeta(role);
  return (
    <div
      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${meta.avatarCls}`}
      aria-hidden="true"
    >
      {meta.icon}
    </div>
  );
}

export function SupplyRetentionMeter({
  holdingPct,
  acquiredPct,
}: {
  holdingPct: number;
  acquiredPct?: number | null;
}) {
  const hasEntry = typeof acquiredPct === "number" && acquiredPct > 0;
  const retainedRatio = hasEntry
    ? Math.max(0, Math.min(100, Math.round((holdingPct / acquiredPct!) * 100)))
    : null;
  const fillPct =
    retainedRatio !== null
      ? retainedRatio
      : Math.max(6, Math.min(100, holdingPct * 5));

  const barColor =
    holdingPct <= 0.01
      ? "bg-slate-600"
      : retainedRatio !== null && retainedRatio < 35
        ? "bg-amber-400"
        : "bg-emerald-400";

  return (
    <div className="min-w-[108px] space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-white">
          {holdingPct > 0 ? `${holdingPct.toFixed(2)}%` : "Exited"}
        </span>
        {retainedRatio !== null && (
          <span className="font-mono tabular-nums text-[10px] text-slate-400">
            {retainedRatio > 0 ? `${retainedRatio}% kept` : `from ${acquiredPct!.toFixed(1)}%`}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(4, fillPct)}%` }}
        />
      </div>
    </div>
  );
}

export function BuySellFlowBar({
  buyCount = 0,
  sellCount = 0,
}: {
  buyCount?: number;
  sellCount?: number;
}) {
  const total = buyCount + sellCount;
  if (total <= 0) return null;
  const buyPct = Math.round((buyCount / total) * 100);
  const sellPct = 100 - buyPct;

  return (
    <div className="min-w-[92px] space-y-1">
      <div className="flex items-center justify-between gap-2 font-mono tabular-nums text-[11px]">
        <span className="text-emerald-300">{buyCount}B</span>
        <span className="text-slate-500">/</span>
        <span className="text-rose-300">{sellCount}S</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden flex">
        {buyPct > 0 && (
          <div className="h-full bg-emerald-400/85" style={{ width: `${buyPct}%` }} />
        )}
        {sellPct > 0 && (
          <div className="h-full bg-rose-400/85" style={{ width: `${sellPct}%` }} />
        )}
      </div>
    </div>
  );
}

function getEventIcon(action: WatchedWalletActivityEvent["action"]) {
  switch (action) {
    case "token_in":
      return <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "token_out":
      return <ArrowUpRight className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
    case "swap":
      return <ArrowLeftRight className="w-3.5 h-3.5 text-[#84A7FF] shrink-0" />;
    case "burn":
      return <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case "deploy":
    case "claim":
      return <Code2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    default:
      return <Terminal className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  }
}

export function WalletActivityTimeline({
  snapshot,
  onRefreshSingle,
  onClose,
}: {
  snapshot: WatchedWalletActivitySnapshot;
  onRefreshSingle?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="mt-2.5 rounded-xl border border-white/[0.08] bg-[#07090E] overflow-hidden">
      <div className="px-3.5 py-2 border-b border-white/[0.06] bg-white/[0.02] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3 font-mono text-slate-300">
          <span>
            Balance:{" "}
            <strong className="text-white">{snapshot.nativeBalance || "—"}</strong>
          </span>
          {snapshot.nonce !== null && (
            <span className="text-slate-400">Nonce {snapshot.nonce}</span>
          )}
          {snapshot.tokenBalancePct !== null && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/12 border border-emerald-500/30 text-emerald-300 text-[11px]">
              Token {snapshot.tokenBalancePct}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRefreshSingle && (
            <button
              type="button"
              onClick={onRefreshSingle}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Sync</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-slate-500 hover:text-slate-200 cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {snapshot.events.length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-slate-400">
          {snapshot.latestSummary || "No recent token or swap transfers in sampled window."}
        </div>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {snapshot.events.slice(0, 4).map((ev) => (
            <div
              key={`${ev.txHash}-${ev.action}-${ev.slotOrBlock}`}
              className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs hover:bg-white/[0.015]"
            >
              <div className="flex items-center gap-2 min-w-0">
                {getEventIcon(ev.action)}
                <span className="text-slate-200 truncate">{ev.summary}</span>
              </div>
              <div className="flex items-center gap-3 font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                {ev.timestamp && (
                  <span className="hidden sm:inline">
                    {new Date(ev.timestamp).toLocaleString()}
                  </span>
                )}
                <a
                  href={ev.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#84A7FF] hover:text-white inline-flex items-center gap-1"
                >
                  <span>{ev.txHash.slice(0, 10)}...</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatShortWalletAddress(addr: string, head = 6, tail = 5): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

export function formatTelegramWatchCmd(w: Pick<TrackedWalletItem, "address" | "chain">): string {
  return `/watch ${w.address}${w.chain !== "solana" ? ` ${w.chain}` : ""}`;
}
