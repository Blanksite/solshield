"use client";

import React, { useEffect, useState } from "react";
import {
  Clock,
  Info,
  Loader2,
  ShieldCheck,
} from "lucide-react";

interface ShieldedSwapPanelProps {
  mintAddress: string;
  symbol?: string | null;
  decimals?: number;
  priceUsd?: number | null;
}

interface QuotePreview {
  inAmountUi: number;
  outAmountUi: number;
  priceImpactPct: string | null;
  routeLabels: string[];
}

function sanitizeDecimalInput(raw: string): string {
  const normalized = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const parts = normalized.split(".");
  if (parts.length <= 1) return normalized;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

export function ShieldedSwapPanel({
  mintAddress,
  symbol,
  decimals = 6,
  priceUsd,
}: ShieldedSwapPanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amountInput, setAmountInput] = useState<string>("0.25");
  const [slippageBps, setSlippageBps] = useState<number>(150);
  const [quote, setQuote] = useState<QuotePreview | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const numericAmount = Number(amountInput);
  const tokenLabel = symbol || mintAddress.slice(0, 5);

  useEffect(() => {
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setQuote(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
      const params = new URLSearchParams({
        side,
        mint: mintAddress,
        decimals: String(decimals),
        amountUi: String(numericAmount),
        slippageBps: String(slippageBps),
      });
      fetch(`/api/token-swap?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setQuote({
              inAmountUi: data.inAmountUi,
              outAmountUi: data.outAmountUi,
              priceImpactPct: data.priceImpactPct,
              routeLabels: data.routeLabels || [],
            });
          } else {
            setQuote(null);
            setQuoteError(data.error || "Quote unavailable.");
          }
        })
        .catch((err) => {
          if (err?.name !== "AbortError") {
            setQuote(null);
            setQuoteError("Unable to reach Jupiter quote router.");
          }
        })
        .finally(() => setQuoteLoading(false));
    }, 320);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mintAddress, decimals, side, numericAmount, slippageBps]);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0D1017] p-4 space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <ShieldCheck className="w-4 h-4 text-[#84A7FF]" />
          <span>Shielded Swap</span>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/12 border border-amber-500/30 text-[10px] font-medium text-amber-300">
          <Clock className="w-3 h-3" />
          Not Ready · Quote Only
        </span>
      </div>

      {/* Buy / Sell Tabs */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#080A0F] border border-white/[0.07]">
        <button
          type="button"
          onClick={() => {
            setSide("buy");
            setAmountInput("0.25");
          }}
          className={`py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
            side === "buy"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/35"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Buy {tokenLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setSide("sell");
            setAmountInput("10000");
          }}
          className={`py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
            side === "sell"
              ? "bg-rose-500/20 text-rose-300 border border-rose-500/35"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Sell {tokenLabel}
        </button>
      </div>

      {/* Amount Input */}
      <div className="rounded-lg border border-white/[0.08] bg-[#080A0F] p-3 space-y-2.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{side === "buy" ? "Pay (SOL)" : `Sell (${tokenLabel})`}</span>
          <span className="font-mono tabular-nums">
            Slippage {(slippageBps / 100).toFixed(1)}%
          </span>
        </div>

        <input
          type="text"
          inputMode="decimal"
          value={amountInput}
          onChange={(e) => setAmountInput(sanitizeDecimalInput(e.target.value))}
          placeholder="0.00"
          className="w-full bg-transparent text-xl font-mono tabular-nums font-semibold text-white outline-none placeholder:text-slate-600"
        />

        <div className="grid grid-cols-4 gap-1.5 pt-0.5">
          {(side === "buy" ? ["0.1", "0.25", "0.5", "1"] : ["1000", "5000", "25000", "100000"]).map(
            (preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmountInput(preset)}
                className={`py-1 rounded border font-mono tabular-nums text-[10px] transition-colors cursor-pointer ${
                  amountInput === preset
                    ? "border-[#2934FF]/70 bg-[#2934FF]/15 text-white"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/25 text-slate-300"
                }`}
              >
                {side === "buy" ? `${preset} SOL` : preset}
              </button>
            )
          )}
        </div>
      </div>

      {/* Slippage Toggle */}
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>Max slippage</span>
        <div className="flex items-center gap-1 font-mono tabular-nums">
          {[100, 150, 300, 500].map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => setSlippageBps(bps)}
              className={`px-2 py-0.5 rounded border text-[10px] transition-colors cursor-pointer ${
                slippageBps === bps
                  ? "border-[#2934FF] bg-[#2934FF]/20 text-white"
                  : "border-white/[0.08] text-slate-400 hover:text-white"
              }`}
            >
              {(bps / 100).toFixed(1)}%
            </button>
          ))}
        </div>
      </div>

      {/* Live Jupiter Quote Preview */}
      <div className="p-3 rounded-lg border border-white/[0.07] bg-[#080A0F] space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Est. receive</span>
          {quoteLoading ? (
            <span className="inline-flex items-center gap-1.5 text-slate-400 font-mono text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin" /> quoting...
            </span>
          ) : quote ? (
            <span className="font-mono tabular-nums font-semibold text-white">
              {quote.outAmountUi.toLocaleString("en-US", {
                maximumFractionDigits: side === "buy" ? 2 : 5,
              })}{" "}
              {side === "buy" ? tokenLabel : "SOL"}
            </span>
          ) : (
            <span className="text-rose-300/80 text-[11px]">
              {quoteError || "—"}
            </span>
          )}
        </div>

        {quote && (
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400">
            <span className="truncate">
              Route: {quote.routeLabels.join(" -> ") || "Jupiter v1"}
            </span>
            {quote.priceImpactPct ? (
              <span className="shrink-0">
                Impact {(Number(quote.priceImpactPct) * 100).toFixed(2)}%
              </span>
            ) : null}
          </div>
        )}

        {priceUsd && side === "buy" && quote && (
          <div className="text-[11px] font-mono tabular-nums text-slate-500">
            Est. USD value ~ ${(quote.outAmountUi * priceUsd).toFixed(2)}
          </div>
        )}
      </div>

      {/* Disabled Execution Button + Explicit "Not Ready" Note */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="w-full py-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-200/90 text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-not-allowed"
      >
        <Clock className="w-3.5 h-3.5" />
        <span>Shielded Swap — Not Ready Yet</span>
      </button>

      <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        <Info className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
        <span>
          Quote preview only. Direct on-chain swap execution is disabled for now while
          SolShield pre-sign bytecode guardrails and routing protection undergo mainnet
          hardening.
        </span>
      </div>
    </div>
  );
}
