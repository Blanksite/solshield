import type {
  BuildCheckReport,
  BuildCheckVerdict,
  DexPairSummary,
  TokenDeepMarketStats,
} from "./types";
import type { ScannedTokenExtraMetadata } from "../scanned-token-types";

export type AxisTone = "emerald" | "amber" | "rose" | "slate";

export interface DualAxisGaugeMetric {
  score: number | null;
  label: string;
  tone: AxisTone;
  breakdown: string;
  pillars: Array<{ label: string; score: number }>;
}

export interface DeployerTrackRecordSummary {
  devAddress: string | null;
  priorMintsCount: number;
  alertCount: number;
  burnsCount: number;
  label: "CLEAN HISTORY" | "PRIOR ALERTS" | "SINGLE DEPLOYMENT" | "UNKNOWN";
  tone: AxisTone;
  summaryText: string;
}

export interface DualAxisSummary {
  buildIntegrity: DualAxisGaugeMetric;
  holderPosture: DualAxisGaugeMetric;
  deployerRecord: DeployerTrackRecordSummary | null;
}

export type MarketFlowState =
  | "BULLISH FLOW"
  | "CONSOLIDATING"
  | "SELL PRESSURE"
  | "NO MARKET DATA";

export interface MarketPulseInput {
  market?: TokenDeepMarketStats | null;
  dexPair?: DexPairSummary | null;
  firstPriceUsd?: number | null;
  firstMarketCapUsd?: number | null;
  firstSeenAt?: string | null;
}

export interface MarketTelemetryPulse {
  flowState: MarketFlowState;
  tone: AxisTone;
  pctSinceFirstAudit: number | null;
  baselineLabel: string | null;
  buyRatioPct: number | null;
  buyRatioWindow: "1h" | "24h" | null;
  signalReason: string;
}

export type AuditLedgerFilter = "all" | "verified" | "watchlist" | "critical";

export interface AuditLedgerEntryLike {
  mintAddress: string;
  symbol: string | null;
  name: string | null;
  riskScore: number;
  classification: "SAFE" | "CAUTION" | "CRITICAL";
  verifiedIssuer: string | null;
  scannedAt: string;
  scanCount: number;
  buildCheckId?: string | null;
  buildScore?: number | null;
  buildVerdict?: BuildCheckVerdict | null;
  marketCapUsd?: number | null;
  priceUsd?: number | null;
  liquidityUsd?: number | null;
  firstSeenAt?: string | null;
  firstPriceUsd?: number | null;
  firstMarketCapUsd?: number | null;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function weightedAverage(
  entries: Array<{ label: string; score: number | null | undefined; weight: number }>
): { score: number | null; pillars: Array<{ label: string; score: number }> } {
  let weightedSum = 0;
  let totalWeight = 0;
  const pillars: Array<{ label: string; score: number }> = [];

  for (const item of entries) {
    if (typeof item.score === "number" && Number.isFinite(item.score)) {
      const clamped = clampScore(item.score);
      weightedSum += clamped * item.weight;
      totalWeight += item.weight;
      pillars.push({ label: item.label, score: clamped });
    }
  }

  if (totalWeight <= 0) {
    return { score: null, pillars: [] };
  }

  return {
    score: clampScore(weightedSum / totalWeight),
    pillars,
  };
}

function formatBreakdown(pillars: Array<{ label: string; score: number }>): string {
  if (pillars.length === 0) return "No signals recorded";
  return pillars.map((p) => `${p.label} ${p.score}`).join(" · ");
}

/**
 * Derives the Dual-Axis Forensic Profile and Deployer Track Record
 * from a completed BuildCheckReport using SolShield's own domain vocabulary.
 */
export function computeDualAxisSummary(report: BuildCheckReport): DualAxisSummary {
  const { codeProof, domainProof, chainProof, holdersProof, claimAlignment } =
    report.componentScores;

  const buildAvg = weightedAverage([
    { label: "Code", score: codeProof, weight: 0.4 },
    { label: "Domain", score: domainProof, weight: 0.3 },
    { label: "Claims", score: claimAlignment, weight: 0.3 },
  ]);

  const buildScore = buildAvg.score ?? clampScore(claimAlignment);
  const buildTone: AxisTone =
    buildScore >= 70 ? "emerald" : buildScore >= 42 ? "amber" : "rose";
  const buildLabel =
    buildScore >= 70
      ? "VERIFIED BUILD"
      : buildScore >= 42
        ? "UNPROVEN CLAIMS"
        : "VAPORWARE RISK";

  const effectiveHoldersScore =
    holdersProof !== undefined && holdersProof !== null
      ? holdersProof
      : report.chain?.deep?.holders?.score ?? null;

  const holderAvg = weightedAverage([
    { label: "Chain", score: chainProof, weight: 0.45 },
    { label: "Holders", score: effectiveHoldersScore, weight: 0.55 },
  ]);

  let holderPosture: DualAxisGaugeMetric;
  if (holderAvg.score === null) {
    holderPosture = {
      score: null,
      label: "OFF-CHAIN TARGET",
      tone: "slate",
      breakdown: "No Solana mint attached",
      pillars: [],
    };
  } else {
    const hScore = holderAvg.score;
    holderPosture = {
      score: hScore,
      label:
        hScore >= 70
          ? "CLEAN POSTURE"
          : hScore >= 45
            ? "WATCHLIST"
            : "ELEVATED EXPOSURE",
      tone: hScore >= 70 ? "emerald" : hScore >= 45 ? "amber" : "rose",
      breakdown: formatBreakdown(holderAvg.pillars),
      pillars: holderAvg.pillars,
    };
  }

  let deployerRecord: DeployerTrackRecordSummary | null = null;
  const devHistory = report.chain?.deep?.devHistory;
  if (devHistory && (devHistory.devAddress || devHistory.coinsLaunchedCount > 0)) {
    const priorMintsCount = Math.max(0, devHistory.coinsLaunchedCount || 0);
    const alertCount = Math.max(0, devHistory.flaggedCoinsCount || 0);
    const burnsCount = (devHistory.recentTxs || []).filter(
      (tx) => tx.action === "burn" && !tx.err
    ).length;

    let label: DeployerTrackRecordSummary["label"] = "CLEAN HISTORY";
    let tone: AxisTone = "emerald";
    if (alertCount > 0) {
      label = "PRIOR ALERTS";
      tone = "rose";
    } else if (priorMintsCount <= 1) {
      label = priorMintsCount === 1 ? "SINGLE DEPLOYMENT" : "UNKNOWN";
      tone = priorMintsCount === 1 ? "emerald" : "slate";
    }

    const parts = [
      `${priorMintsCount} prior ${priorMintsCount === 1 ? "mint" : "mints"}`,
      `${alertCount} risk ${alertCount === 1 ? "alert" : "alerts"}`,
    ];
    if (burnsCount > 0) {
      parts.push(`${burnsCount} ${burnsCount === 1 ? "burn" : "burns"}`);
    }

    deployerRecord = {
      devAddress: devHistory.devAddress,
      priorMintsCount,
      alertCount,
      burnsCount,
      label,
      tone,
      summaryText: parts.join(" · "),
    };
  }

  return {
    buildIntegrity: {
      score: buildScore,
      label: buildLabel,
      tone: buildTone,
      breakdown: formatBreakdown(buildAvg.pillars),
      pillars: buildAvg.pillars,
    },
    holderPosture,
    deployerRecord,
  };
}

/**
 * Extracts normalized USD price, market cap, and liquidity metrics from a BuildCheckReport.
 */
export function extractMarketSnapshotFromReport(report: BuildCheckReport): {
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
} {
  const deepMarket = report.chain?.deep?.market ?? null;
  const dexPair = report.chain?.dexPair ?? null;

  const priceUsd =
    typeof deepMarket?.priceUsd === "number" &&
    Number.isFinite(deepMarket.priceUsd) &&
    deepMarket.priceUsd > 0
      ? deepMarket.priceUsd
      : null;

  const rawMc =
    deepMarket?.marketCapUsd ?? deepMarket?.fdvUsd ?? dexPair?.fdv ?? null;
  const marketCapUsd =
    typeof rawMc === "number" && Number.isFinite(rawMc) && rawMc > 0
      ? rawMc
      : null;

  const rawLiq = deepMarket?.liquidityUsd ?? dexPair?.liquidityUsd ?? null;
  const liquidityUsd =
    typeof rawLiq === "number" && Number.isFinite(rawLiq) && rawLiq >= 0
      ? rawLiq
      : null;

  return { priceUsd, marketCapUsd, liquidityUsd };
}

/**
 * Builds canonical ScannedTokenSummary enrichment metadata from a completed BuildCheckReport.
 */
export function toScannedTokenExtraFromReport(
  report: BuildCheckReport
): ScannedTokenExtraMetadata {
  const { priceUsd, marketCapUsd, liquidityUsd } =
    extractMarketSnapshotFromReport(report);
  return {
    buildCheckId: report.id || null,
    buildScore: report.authenticityScore,
    buildVerdict: report.verdict,
    priceUsd,
    marketCapUsd,
    liquidityUsd,
  };
}

/**
 * Computes percentage change between current and initial positive baseline values.
 */
export function computePctDelta(
  current: number | null | undefined,
  baseline: number | null | undefined
): number | null {
  if (
    typeof current !== "number" ||
    typeof baseline !== "number" ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    current <= 0 ||
    baseline <= 0
  ) {
    return null;
  }
  const pct = ((current - baseline) / baseline) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}

export function formatSignedPct(pct: number | null | undefined): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  if (rounded > 0) return `+${rounded.toFixed(1)}%`;
  if (rounded < 0) return `${rounded.toFixed(1)}%`;
  return "0.0%";
}

export function formatCompactUsd(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
  if (val >= 1) return `$${val.toFixed(2)}`;
  if (val >= 0.0001) return `$${val.toFixed(5)}`;
  return `$${val.toFixed(8)}`;
}

/**
 * Computes current Market Telemetry posture and delta since first recorded audit.
 */
export function computeMarketPulse(input: MarketPulseInput): MarketTelemetryPulse {
  const { market, dexPair, firstPriceUsd, firstMarketCapUsd, firstSeenAt } = input;

  const currentPrice = market?.priceUsd ?? null;
  const currentMc = market?.marketCapUsd ?? market?.fdvUsd ?? dexPair?.fdv ?? null;

  const priceDelta = computePctDelta(currentPrice, firstPriceUsd);
  const mcDelta = computePctDelta(currentMc, firstMarketCapUsd);
  const pctSinceFirstAudit = priceDelta ?? mcDelta;

  let baselineLabel: string | null = null;
  if (pctSinceFirstAudit !== null) {
    const rel = firstSeenAt ? formatRelativeTime(firstSeenAt) : null;
    baselineLabel =
      priceDelta !== null
        ? `vs. 1st price baseline${rel && rel !== "—" ? ` (${rel})` : ""}`
        : `vs. 1st market cap baseline${rel && rel !== "—" ? ` (${rel})` : ""}`;
  }

  let buyRatioPct: number | null = null;
  let buyRatioWindow: "1h" | "24h" | null = null;
  if (
    typeof market?.buys1h === "number" &&
    typeof market?.sells1h === "number" &&
    market.buys1h + market.sells1h > 0
  ) {
    buyRatioPct = Math.round((market.buys1h / (market.buys1h + market.sells1h)) * 100);
    buyRatioWindow = "1h";
  } else if (
    typeof market?.buys24h === "number" &&
    typeof market?.sells24h === "number" &&
    market.buys24h + market.sells24h > 0
  ) {
    buyRatioPct = Math.round((market.buys24h / (market.buys24h + market.sells24h)) * 100);
    buyRatioWindow = "24h";
  }

  if (!market && !dexPair) {
    return {
      flowState: "NO MARKET DATA",
      tone: "slate",
      pctSinceFirstAudit,
      baselineLabel,
      buyRatioPct: null,
      buyRatioWindow: null,
      signalReason: "No active DEX pair detected yet",
    };
  }

  const move1h = market?.priceChange1h ?? null;
  const move5m = market?.priceChange5m ?? null;
  const move24h = market?.priceChange24h ?? null;
  const primaryMove = move1h ?? move5m ?? move24h ?? null;
  const primaryLabel =
    move1h !== null ? "1h" : move5m !== null ? "5m" : move24h !== null ? "24h" : null;

  let flowState: MarketFlowState = "CONSOLIDATING";
  let tone: AxisTone = "slate";

  if (
    (primaryMove !== null && primaryMove >= 8) ||
    (primaryMove !== null && primaryMove >= 3 && (buyRatioPct ?? 50) >= 58) ||
    (move5m !== null && move5m >= 5 && (buyRatioPct ?? 50) >= 55)
  ) {
    flowState = "BULLISH FLOW";
    tone = "emerald";
  } else if (
    (primaryMove !== null && primaryMove <= -8) ||
    (primaryMove !== null && primaryMove <= -3 && (buyRatioPct ?? 50) <= 42) ||
    (move5m !== null && move5m <= -5 && (buyRatioPct ?? 50) <= 45)
  ) {
    flowState = "SELL PRESSURE";
    tone = "rose";
  }

  const reasonParts: string[] = [];
  if (primaryMove !== null && primaryLabel) {
    reasonParts.push(`${primaryLabel} ${formatSignedPct(primaryMove)}`);
  }
  if (buyRatioPct !== null && buyRatioWindow) {
    reasonParts.push(`${buyRatioPct}% buys (${buyRatioWindow})`);
  }

  return {
    flowState,
    tone,
    pctSinceFirstAudit,
    baselineLabel,
    buyRatioPct,
    buyRatioWindow,
    signalReason:
      reasonParts.length > 0
        ? reasonParts.join(" · ")
        : "Balanced recent liquidity variance",
  };
}

/**
 * Classifies an audited ledger token into SolShield directory filter buckets.
 */
export function classifyLedgerTier(
  entry: Pick<AuditLedgerEntryLike, "buildScore" | "classification">
): Exclude<AuditLedgerFilter, "all"> {
  if (typeof entry.buildScore === "number" && Number.isFinite(entry.buildScore)) {
    if (entry.buildScore < 42 || entry.classification === "CRITICAL") {
      return "critical";
    }
    if (entry.buildScore >= 70) {
      return "verified";
    }
    return "watchlist";
  }

  if (entry.classification === "CRITICAL") return "critical";
  if (entry.classification === "CAUTION") return "watchlist";
  return "verified";
}

/**
 * Filters scanned tokens by ledger tier and search query while preserving recency sort.
 */
export function filterAndSortScannedTokens<T extends AuditLedgerEntryLike>(
  tokens: T[],
  options: { query?: string; filter?: AuditLedgerFilter } = {}
): T[] {
  const filter = options.filter ?? "all";
  const q = (options.query ?? "").trim().toLowerCase();

  return tokens
    .filter((item) => {
      if (filter !== "all" && classifyLedgerTier(item) !== filter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.symbol,
        item.name,
        item.mintAddress,
        item.verifiedIssuer,
        item.buildVerdict,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .slice()
    .sort((a, b) => (Date.parse(b.scannedAt) || 0) - (Date.parse(a.scannedAt) || 0));
}

export function formatRelativeTime(
  isoString: string | null | undefined,
  nowMs = Date.now()
): string {
  if (!isoString) return "—";
  const ts = Date.parse(isoString);
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo ago`;
}
