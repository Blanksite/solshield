import type { BuildCheckReport, ClaimStatus } from "./types";

export type ClaimCategory =
  | "code_open_source"
  | "live_product"
  | "contract_safety"
  | "liquidity_tax"
  | "distribution"
  | "listing_partnership"
  | "security_audit"
  | "longevity";

export type ClaimSourceLabel =
  | "X Post"
  | "Website DOM"
  | "Token Metadata"
  | "BuildCheck Engine";

export interface ClaimReceiptItem {
  id: string;
  category: ClaimCategory;
  claim: string;
  source: ClaimSourceLabel;
  status: ClaimStatus;
  receipt: string;
}

export interface ClaimsReceiptsLedger {
  reportId: string;
  subjectLabel: string;
  capturedAt: string;
  receiptScorePct: number;
  verifiedCount: number;
  mixedCount: number;
  unverifiedCount: number;
  contradictedCount: number;
  items: ClaimReceiptItem[];
  shareTextForX: string;
}

export interface ClaimsDiffChange {
  id: string;
  claim: string;
  previousStatus: ClaimStatus;
  currentStatus: ClaimStatus;
  direction: "IMPROVED" | "REGRESSED" | "CHANGED";
  receipt: string;
}

export interface ClaimsSnapshotDiff {
  baselineCapturedAt: string;
  currentCapturedAt: string;
  scoreDelta: number;
  newlyVerified: number;
  newlyContradicted: number;
  changes: ClaimsDiffChange[];
}

function getSourceTexts(report: BuildCheckReport): Array<{
  source: ClaimSourceLabel;
  text: string;
}> {
  const sources: Array<{ source: ClaimSourceLabel; text: string }> = [];
  if (report.xPost?.textContent) {
    sources.push({ source: "X Post", text: report.xPost.textContent });
  }
  const domText = (report.browser?.stops || [])
    .map((s) => `${s.title || ""} ${s.textExcerpt || ""}`)
    .join(" ")
    .trim();
  if (domText) {
    sources.push({ source: "Website DOM", text: domText });
  }
  const metaDesc = [
    report.chain?.deep?.metadata?.name,
    report.chain?.deep?.metadata?.description,
    report.github?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (metaDesc) {
    sources.push({ source: "Token Metadata", text: metaDesc });
  }
  return sources;
}

function findMatchingSource(
  sources: Array<{ source: ClaimSourceLabel; text: string }>,
  pattern: RegExp
): ClaimSourceLabel | null {
  for (const s of sources) {
    if (pattern.test(s.text)) return s.source;
  }
  return null;
}

function inferCategory(claimText: string): ClaimCategory {
  const lower = claimText.toLowerCase();
  if (/open[- ]?source|github|repo|commit|codebase/.test(lower)) {
    return "code_open_source";
  }
  if (/dapp|api|live|app|terminal|website|browser/.test(lower)) {
    return "live_product";
  }
  if (/proxy|mint|freeze|immutable|owner|bytecode|contract/.test(lower)) {
    return "contract_safety";
  }
  if (/tax|honeypot|liquid|lp|swap|sell/.test(lower)) {
    return "liquidity_tax";
  }
  if (/holder|fair|cabal|sniper|insider|mm|distribution/.test(lower)) {
    return "distribution";
  }
  if (/robinhood|listed|listing|partner|exchange/.test(lower)) {
    return "listing_partnership";
  }
  if (/audit|certik|hacken|ottersec|zellic/.test(lower)) {
    return "security_audit";
  }
  return "longevity";
}

function normalizeClaimKey(claim: string): string {
  return claim
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 48);
}

/**
 * Builds a structured "Claims vs Receipts" verification ledger from a BuildCheckReport.
 * Merges Venice/engine claims with deterministic receipts from RPC bytecode, Chromium DOM,
 * GitHub provenance, holder distribution, and Robinhood verification.
 */
export function extractClaimsReceiptsLedger(
  report: BuildCheckReport
): ClaimsReceiptsLedger {
  const sources = getSourceTexts(report);
  const items: ClaimReceiptItem[] = [];
  const seenKeys = new Set<string>();

  const pushItem = (item: ClaimReceiptItem) => {
    const key = normalizeClaimKey(item.claim);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    items.push(item);
  };

  // 1. Deterministic high-signal claim detectors across marketing copy & metadata
  const openSourceSrc = findMatchingSource(
    sources,
    /\b(open[- ]?source|public\s+github|github\s+repo|open\s+codebase)\b/i
  );
  if (openSourceSrc || report.github) {
    const gh = report.github;
    if (gh && gh.exists && !gh.isFork && gh.recentCommitCount >= 3) {
      pushItem({
        id: "claim-open-source",
        category: "code_open_source",
        claim: "Open-source original engineering repository",
        source: openSourceSrc || "BuildCheck Engine",
        status: "VERIFIED",
        receipt: `${gh.fullName} verified (${gh.recentCommitCount} recent commits, ${gh.stars} stars${gh.hasTestsOrCi ? ", CI/tests present" : ""}).`,
      });
    } else if (gh && gh.exists && gh.isFork) {
      pushItem({
        id: "claim-open-source",
        category: "code_open_source",
        claim: "Open-source original engineering repository",
        source: openSourceSrc || "BuildCheck Engine",
        status: gh.recentCommitCount <= 3 ? "CONTRADICTED" : "MIXED",
        receipt: `${gh.fullName} is a fork${gh.forkParent ? ` of ${gh.forkParent}` : ""} with ${gh.recentCommitCount} recent commits.`,
      });
    } else if (openSourceSrc) {
      pushItem({
        id: "claim-open-source",
        category: "code_open_source",
        claim: "Open-source original engineering repository",
        source: openSourceSrc,
        status: "CONTRADICTED",
        receipt: "Copy advertises open-source code, but no public GitHub repository could be verified.",
      });
    }
  }

  // 2. Live working product / API claim
  const liveAppSrc = findMatchingSource(
    sources,
    /\b(live\s+(?:ai|agent|app|dapp|api|mainnet|product)|working\s+product|autonomous\s+agent)\b/i
  );
  const firstStop = report.browser?.stops?.[0];
  if (liveAppSrc || firstStop) {
    const xhr = report.browser?.totalXhrObserved ?? 0;
    const hasPlaceholder = Boolean(firstStop?.hasPlaceholderCopy);
    if (hasPlaceholder) {
      pushItem({
        id: "claim-live-app",
        category: "live_product",
        claim: "Live working product / functional web app",
        source: liveAppSrc || "Website DOM",
        status: "CONTRADICTED",
        receipt: "Headless Chromium detected placeholder or 'Coming Soon' copy on the rendered site.",
      });
    } else if (xhr > 0) {
      pushItem({
        id: "claim-live-app",
        category: "live_product",
        claim: "Live working product / functional web app",
        source: liveAppSrc || "Website DOM",
        status: "VERIFIED",
        receipt: `Headless Chromium observed ${xhr} live API/XHR call(s) across ${report.browser.stops.length} visited stop(s).`,
      });
    } else if (liveAppSrc) {
      pushItem({
        id: "claim-live-app",
        category: "live_product",
        claim: "Live working product / functional web app",
        source: liveAppSrc,
        status: "UNVERIFIED",
        receipt: "Rendered website logged 0 live XHR/API requests during headless browser inspection.",
      });
    }
  }

  // 3. Smart Contract Immutability / Non-Proxy / Authorities
  const evm = report.chain?.evmSecurity;
  const tok = report.chain?.tokenReport;
  if (evm && evm.isDeployed) {
    const nonProxyClaim = findMatchingSource(
      sources,
      /\b(non[- ]?proxy|immutable|renounced|safe\s+contract|no\s+backdoor)\b/i
    );
    const hasHardTrap =
      evm.honeypotStatus === "HONEYPOT" ||
      (evm.sellTaxPct !== null && evm.sellTaxPct >= 25);
    if (hasHardTrap) {
      pushItem({
        id: "claim-sellable-contract",
        category: "liquidity_tax",
        claim: "Freely tradable ERC-20 without honeypot sell tax",
        source: "BuildCheck Engine",
        status: "CONTRADICTED",
        receipt: `Simulated sell failed/taxed (${evm.honeypotStatus}, sell tax ${evm.sellTaxPct ?? "?"}%) on ${evm.networkName}.`,
      });
    } else if (evm.honeypotStatus === "SELLABLE") {
      pushItem({
        id: "claim-sellable-contract",
        category: "liquidity_tax",
        claim: "Freely tradable ERC-20 without honeypot sell tax",
        source: "BuildCheck Engine",
        status: "VERIFIED",
        receipt: `Exit swap simulation SELLABLE on ${evm.networkName} (buy ${evm.buyTaxPct ?? 0}% / sell ${evm.sellTaxPct ?? 0}%).`,
      });
    }

    pushItem({
      id: "claim-contract-immutability",
      category: "contract_safety",
      claim: "Immutable non-proxy bytecode without hidden admin takeover",
      source: nonProxyClaim || "BuildCheck Engine",
      status: evm.isProxy
        ? "CONTRADICTED"
        : evm.capabilities.blacklistable || evm.capabilities.mintable
          ? "MIXED"
          : "VERIFIED",
      receipt: evm.isProxy
        ? `Upgradeable ${evm.proxyType || "proxy"} detected${evm.implementationAddress ? ` (impl ${evm.implementationAddress.slice(0, 10)}...)` : ""}.`
        : evm.capabilities.blacklistable || evm.capabilities.mintable
          ? `Non-proxy bytecode, but admin selectors detected (${[evm.capabilities.mintable ? "mint()" : "", evm.capabilities.blacklistable ? "blacklist()" : ""].filter(Boolean).join(", ")}).`
          : `Non-proxy bytecode (${evm.bytecodeBytes} bytes) on ${evm.networkName}; no upgradeable delegate slot.`,
    });
  } else if (tok) {
    const authClean = tok.mintAuthority === null && tok.freezeAuthority === null;
    pushItem({
      id: "claim-sol-authorities",
      category: "contract_safety",
      claim: "Solana Mint & Freeze authorities permanently revoked",
      source: "BuildCheck Engine",
      status: authClean ? "VERIFIED" : "CONTRADICTED",
      receipt: authClean
        ? "On-chain SPL/Token-2022 state confirms both Mint Authority and Freeze Authority are null."
        : `Active authority detected (${[tok.mintAuthority ? "Mint Authority" : "", tok.freezeAuthority ? "Freeze Authority" : ""].filter(Boolean).join(" & ")}).`,
    });
  }

  // 4. Fair Launch / Distribution / Anti-Cabal receipt
  const holders = report.chain?.deep?.holders;
  const fairClaim = findMatchingSource(
    sources,
    /\b(fair\s+launch|no\s+team\s+allocation|no\s+insiders?|community[- ]?owned|organic\s+distribution)\b/i
  );
  if (holders) {
    const insiderTotal = Math.round(
      (holders.distribution.insidersPct + holders.distribution.snipersPct) * 10
    ) / 10;
    const isRigged = holders.verdict === "RIGGED" || insiderTotal >= 25;
    const isSketchy = holders.verdict === "SKETCHY" || insiderTotal >= 12;
    pushItem({
      id: "claim-distribution",
      category: "distribution",
      claim: "Organic holder distribution free from coordinated cabals",
      source: fairClaim || "BuildCheck Engine",
      status: isRigged ? "CONTRADICTED" : isSketchy ? "MIXED" : "VERIFIED",
      receipt: `Holder hygiene ${holders.score}/100 (${holders.verdict}): ${insiderTotal}% snipers/insiders, ${holders.clusters.length} cluster(s), ${holders.possibleMmCount ?? 0} Possible MMs.`,
    });
  }

  // 5. Robinhood / Official Listing receipt
  const rh = report.robinhood || report.chain?.robinhood;
  if (rh && rh.status !== "NOT_LISTED") {
    pushItem({
      id: "claim-robinhood-status",
      category: "listing_partnership",
      claim: "Robinhood listing / Orbit L2 authenticity",
      source: "BuildCheck Engine",
      status:
        rh.status === "IMPOSTOR_ALERT"
          ? "CONTRADICTED"
          : rh.status === "TICKER_CLONE_WARNING"
            ? "MIXED"
            : "VERIFIED",
      receipt: rh.summary,
    });
  }

  // 6. Merge existing Venice/deterministic claimsVsProof rows without duplicates
  for (let i = 0; i < (report.claimsVsProof || []).length; i++) {
    const row = report.claimsVsProof[i];
    pushItem({
      id: `engine-claim-${i + 1}`,
      category: inferCategory(row.claim),
      claim: row.claim,
      source: "BuildCheck Engine",
      status: row.status,
      receipt: row.evidence,
    });
  }

  const verifiedCount = items.filter((i) => i.status === "VERIFIED").length;
  const mixedCount = items.filter((i) => i.status === "MIXED").length;
  const unverifiedCount = items.filter((i) => i.status === "UNVERIFIED").length;
  const contradictedCount = items.filter((i) => i.status === "CONTRADICTED").length;

  const weighted =
    items.length > 0
      ? Math.round(
          ((verifiedCount * 1 + mixedCount * 0.5 + unverifiedCount * 0.25) /
            items.length) *
            100
        )
      : report.componentScores.claimAlignment;

  const subjectLabel =
    report.chain?.deep?.metadata?.symbol
      ? `$${report.chain.deep.metadata.symbol.replace(/^\$/, "")}`
      : report.github?.fullName ||
        report.domain?.registrableDomain ||
        report.target.rawInput.slice(0, 28);

  const shareLines = [
    `Claims vs Receipts on ${subjectLabel} (SolShield® BuildCheck):`,
    `Receipt Score: ${weighted}% (${verifiedCount} Verified · ${contradictedCount} Contradicted · ${unverifiedCount} Unverified)`,
    "",
    ...items.slice(0, 4).map((item) => {
      const tag =
        item.status === "VERIFIED"
          ? "[VERIFIED]"
          : item.status === "CONTRADICTED"
            ? "[CONTRADICTED]"
            : item.status === "MIXED"
              ? "[MIXED]"
              : "[UNVERIFIED]";
      return `${tag} ${item.claim} — ${item.receipt.slice(0, 110)}`;
    }),
    "",
    `Full dossier: https://sol-shield.xyz/buildcheck?report=${report.id}`,
  ];

  return {
    reportId: report.id,
    subjectLabel,
    capturedAt: report.createdAt || new Date().toISOString(),
    receiptScorePct: Math.max(0, Math.min(100, weighted)),
    verifiedCount,
    mixedCount,
    unverifiedCount,
    contradictedCount,
    items,
    shareTextForX: shareLines.join("\n"),
  };
}

const STATUS_RANK: Record<ClaimStatus, number> = {
  CONTRADICTED: 0,
  UNVERIFIED: 1,
  MIXED: 2,
  VERIFIED: 3,
};

/**
 * Compares a previously saved Claims vs Receipts baseline against a fresh audit
 * so traders can see which dev promises actually shipped vs regressed.
 */
export function diffClaimSnapshots(
  baseline: ClaimsReceiptsLedger,
  current: ClaimsReceiptsLedger
): ClaimsSnapshotDiff {
  const prevByKey = new Map<string, ClaimReceiptItem>();
  for (const item of baseline.items) {
    prevByKey.set(item.id, item);
    prevByKey.set(normalizeClaimKey(item.claim), item);
  }

  const changes: ClaimsDiffChange[] = [];
  let newlyVerified = 0;
  let newlyContradicted = 0;

  for (const cur of current.items) {
    const prev =
      prevByKey.get(cur.id) || prevByKey.get(normalizeClaimKey(cur.claim));
    if (!prev || prev.status === cur.status) continue;

    const prevRank = STATUS_RANK[prev.status];
    const curRank = STATUS_RANK[cur.status];
    const direction: ClaimsDiffChange["direction"] =
      curRank > prevRank
        ? "IMPROVED"
        : curRank < prevRank
          ? "REGRESSED"
          : "CHANGED";

    if (cur.status === "VERIFIED") newlyVerified += 1;
    if (cur.status === "CONTRADICTED") newlyContradicted += 1;

    changes.push({
      id: cur.id,
      claim: cur.claim,
      previousStatus: prev.status,
      currentStatus: cur.status,
      direction,
      receipt: cur.receipt,
    });
  }

  return {
    baselineCapturedAt: baseline.capturedAt,
    currentCapturedAt: current.capturedAt,
    scoreDelta: current.receiptScorePct - baseline.receiptScorePct,
    newlyVerified,
    newlyContradicted,
    changes,
  };
}
