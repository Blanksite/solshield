import { extractClaimsReceiptsLedger } from "./claims-receipts";
import type { BuildCheckReport } from "./types";
import { formatCompactUsd } from "./war-room-metrics";

export type AutopsySeverity =
  | "CRITICAL_AUTOPSY"
  | "ELEVATED_RISK"
  | "CLEAN_FORENSIC_PROFILE";

export interface AutopsyTimelineEvent {
  stage: string;
  phaseLabel: string;
  severity: "CRITICAL" | "WARNING" | "INFO" | "CLEAN";
  title: string;
  detail: string;
  proofRef?: string | null;
}

export interface RugAutopsyReport {
  reportId: string;
  subjectLabel: string;
  tokenSymbol: string | null;
  address: string | null;
  networkName: string;
  authenticityScore: number;
  severity: AutopsySeverity;
  classification: string;
  headline: string;
  executiveDiagnosis: string;
  metrics: {
    liquidityLabel: string;
    sellTaxLabel: string;
    insiderPctLabel: string;
    possibleMmCount: number;
    earlyBuyersCount: number;
    exitedEarlyCount: number;
    contradictedClaimsCount: number;
  };
  timeline: AutopsyTimelineEvent[];
  flaggedWallets: Array<{
    address: string;
    roleLabel: string;
    summary: string;
    explorerUrl: string;
  }>;
  xThread: string[];
  reportUrl: string;
  generatedAt: string;
}

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "unknown";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Reconstructs a deterministic, citation-backed "Rug Autopsy" chronological breakdown
 * from a BuildCheckReport, complete with timeline stages and X thread copy.
 */
export function buildRugAutopsyReport(
  report: BuildCheckReport,
  appOrigin = "https://sol-shield.xyz"
): RugAutopsyReport {
  const cleanOrigin = appOrigin.replace(/\/+$/, "");
  const reportUrl = `${cleanOrigin}/buildcheck?report=${report.id}`;

  const tokenSymbol =
    report.chain?.deep?.metadata?.symbol ||
    report.chain?.tokenReport?.symbol ||
    null;
  const address =
    report.chain?.mintAddress ||
    report.target.contractAddress ||
    report.target.mintAddress ||
    null;
  const networkName =
    report.chain?.evmSecurity?.networkName ||
    report.chain?.networkName ||
    (report.chain?.chainFamily === "solana" ? "Solana Mainnet" : "Multi-Chain");

  const subjectLabel = tokenSymbol
    ? `$${tokenSymbol.replace(/^\$/, "")}`
    : report.github?.fullName ||
      report.domain?.registrableDomain ||
      shortAddr(address) ||
      "Target";

  const evm = report.chain?.evmSecurity;
  const tok = report.chain?.tokenReport;
  const holders = report.chain?.deep?.holders;
  const dev = report.chain?.deep?.devHistory;
  const market = report.chain?.deep?.market;
  const claims = extractClaimsReceiptsLedger(report);
  const wallets = holders?.walletsToWatch || [];

  const exitedEarly = wallets.filter(
    (w) =>
      (w.category === "early_buyer" || w.category === "possible_mm") &&
      w.holdingPct <= 0.02 &&
      ((w.acquiredPct ?? 0) >= 0.2 || (w.sellCount ?? 0) >= 2)
  );

  const insiderCombinedPct = holders
    ? Math.round(
        (holders.distribution.insidersPct + holders.distribution.snipersPct) * 10
      ) / 10
    : null;

  // Classify root failure or clean profile
  const isHoneypot = evm?.honeypotStatus === "HONEYPOT";
  const isHighTax =
    typeof evm?.sellTaxPct === "number" && evm.sellTaxPct >= 15;
  const isRiggedHolders =
    holders?.verdict === "RIGGED" || (insiderCombinedPct ?? 0) >= 25;
  const isProxyTrap = Boolean(
    evm?.isProxy && (evm.capabilities.blacklistable || evm.capabilities.mintable)
  );
  const isImpostor =
    report.robinhood?.status === "IMPOSTOR_ALERT" ||
    report.chain?.robinhood?.status === "IMPOSTOR_ALERT";
  const isSolFreezeTrap = Boolean(tok?.freezeAuthority);
  const isLarpBuild =
    report.verdict === "HIGH_FABRICATION_RISK" ||
    claims.contradictedCount >= 2;

  let classification = "Clean Verified Architecture";
  let severity: AutopsySeverity = "CLEAN_FORENSIC_PROFILE";
  let headline = `${subjectLabel} passed multi-layer contract & build forensics.`;

  if (isHoneypot || isHighTax) {
    severity = "CRITICAL_AUTOPSY";
    classification = "Honeypot / Punitive Sell-Tax Trap";
    headline = `${subjectLabel} blocks or drains exit swaps (${evm?.sellTaxPct ?? 99}% sell tax).`;
  } else if (isImpostor) {
    severity = "CRITICAL_AUTOPSY";
    classification = "Impostor / Spoofed Asset Clone";
    headline = `${subjectLabel} mimics an official listed asset without canonical contract ownership.`;
  } else if (isSolFreezeTrap) {
    severity = "CRITICAL_AUTOPSY";
    classification = "Active Freeze Authority Trap";
    headline = `${subjectLabel} retains active Solana Freeze Authority capable of locking buyer balances.`;
  } else if (isProxyTrap || isRiggedHolders) {
    severity = "CRITICAL_AUTOPSY";
    classification = isProxyTrap
      ? "Upgradeable Proxy + Admin Backdoor Risk"
      : "Coordinated Cabal & Insider Exit Pattern";
    headline = isProxyTrap
      ? `${subjectLabel} runs an upgradeable ${evm?.proxyType || "proxy"} with privileged admin selectors.`
      : `${subjectLabel} shows ${insiderCombinedPct ?? 0}% sniper/insider concentration and ${exitedEarly.length} exited early wallets.`;
  } else if (isLarpBuild || report.authenticityScore < 55) {
    severity = "ELEVATED_RISK";
    classification = "Unverified Hype / Thin Build Proof";
    headline = `${subjectLabel} shows ${claims.contradictedCount} contradicted claim(s) and weak shipping evidence (${report.authenticityScore}/100).`;
  } else if (
    report.authenticityScore < 72 ||
    (holders && holders.verdict === "SKETCHY") ||
    evm?.isProxy
  ) {
    severity = "ELEVATED_RISK";
    classification = "Mixed Posture — Monitor Closely";
    headline = `${subjectLabel} has verifiable components but carries open distribution or contract cautions.`;
  }

  // Build ordered forensic timeline
  const timeline: AutopsyTimelineEvent[] = [];

  // Stage 1: T-0 Deployer & Infrastructure Origin
  const originParts: string[] = [];
  if (dev?.devAddress) {
    originParts.push(
      `Deployer ${shortAddr(dev.devAddress)} (${dev.coinsLaunchedCount} token(s) traced${dev.flaggedCoinsCount > 0 ? `, ${dev.flaggedCoinsCount} flagged` : ""})`
    );
  } else if (evm?.creatorAddress) {
    originParts.push(`Creator ${shortAddr(evm.creatorAddress)} on ${networkName}`);
  }
  if (report.domain) {
    originParts.push(
      `Domain ${report.domain.registrableDomain} (${report.domain.domainAgeDays !== null ? `${report.domain.domainAgeDays}d old` : "age unknown"}, ${report.domain.domainEval.status})`
    );
  }
  if (report.github?.exists) {
    originParts.push(
      `Repo ${report.github.fullName} (${report.github.ageDays !== null ? `${report.github.ageDays}d old` : "age unknown"}, ${report.github.recentCommitCount} commits${report.github.isFork ? ", FORK" : ""})`
    );
  }
  timeline.push({
    stage: "STAGE 01",
    phaseLabel: "T-0 · Deployer & Infra Origin",
    severity:
      (dev?.flaggedCoinsCount ?? 0) > 0 ||
      report.domain?.domainEval.status === "TYPOSQUAT_CRITICAL"
        ? "CRITICAL"
        : (report.domain?.domainAgeDays !== null &&
              report.domain !== null &&
              report.domain.domainAgeDays <= 7) ||
            Boolean(report.github?.isFork)
          ? "WARNING"
          : "CLEAN",
    title: dev?.devAddress
      ? `Deployer & Provenance Mapped (${shortAddr(dev.devAddress)})`
      : `Infrastructure & Origin Fingerprinted (${networkName})`,
    detail:
      originParts.join(" · ") ||
      `Initial target ${shortAddr(address)} indexed on ${networkName}.`,
    proofRef: dev?.devAddress || evm?.creatorAddress || report.github?.url || null,
  });

  // Stage 2: Contract Bytecode & Trap Posture
  if (evm) {
    timeline.push({
      stage: "STAGE 02",
      phaseLabel: "Contract Bytecode & Swap Sim",
      severity:
        isHoneypot || isHighTax
          ? "CRITICAL"
          : evm.isProxy || evm.capabilities.blacklistable || evm.capabilities.mintable
            ? "WARNING"
            : "CLEAN",
      title: isHoneypot
        ? `Honeypot Confirmed (${evm.sellTaxPct ?? 99}% Sell Tax)`
        : evm.isProxy
          ? `Upgradeable ${evm.proxyType || "Proxy"} Bytecode Detected`
          : `Non-Proxy ERC-20 Bytecode (${evm.bytecodeBytes} bytes)`,
      detail: `${evm.summary} Verified source: ${evm.verifiedSource}. Buy/Sell tax: ${evm.buyTaxPct ?? 0}% / ${evm.sellTaxPct ?? 0}%.`,
      proofRef: evm.implementationAddress || evm.address,
    });
  } else if (tok) {
    timeline.push({
      stage: "STAGE 02",
      phaseLabel: "Solana Mint & Authority State",
      severity:
        tok.freezeAuthority !== null
          ? "CRITICAL"
          : tok.mintAuthority !== null
            ? "WARNING"
            : "CLEAN",
      title:
        tok.mintAuthority === null && tok.freezeAuthority === null
          ? "Mint & Freeze Authorities Revoked"
          : "Privileged Solana Authority Still Active",
      detail: `Mint Auth: ${tok.mintAuthority ? shortAddr(tok.mintAuthority) : "Revoked"} · Freeze Auth: ${tok.freezeAuthority ? shortAddr(tok.freezeAuthority) : "Revoked"} · Risk ${tok.riskScore}/100.`,
      proofRef: report.chain?.mintAddress || null,
    });
  }

  // Stage 3: Launch Block Bundles & Early Buyers
  if (holders) {
    const firstCluster = holders.clusters[0];
    timeline.push({
      stage: "STAGE 03",
      phaseLabel: "Launch Entry · Bundles & Cabal",
      severity:
        holders.verdict === "RIGGED"
          ? "CRITICAL"
          : holders.verdict === "SKETCHY"
            ? "WARNING"
            : "CLEAN",
      title:
        holders.clusters.length > 0
          ? `${holders.clusters.length} Coordinated Cluster(s) & ${holders.earlyBuyersCount ?? 0} Early Buyers`
          : `${holders.earlyBuyersCount ?? 0} Early Buyers Mapped · No Rigged Cabal`,
      detail: firstCluster
        ? `Primary cluster "${firstCluster.label}" holds ${firstCluster.combinedPct.toFixed(1)}% across ${firstCluster.wallets.length} wallets. Total insiders + snipers: ${insiderCombinedPct ?? 0}%.`
        : `Holder hygiene scored ${holders.score}/100 (${holders.verdict}) with ${insiderCombinedPct ?? 0}% combined sniper/insider share.`,
      proofRef: firstCluster?.funder || null,
    });
  }

  // Stage 4: Market-Maker Churn & Early Exit Waves
  if (wallets.length > 0) {
    const topMm = wallets.find((w) => w.category === "possible_mm") || wallets[0];
    timeline.push({
      stage: "STAGE 04",
      phaseLabel: "Post-Launch Flow · MM & Exits",
      severity:
        exitedEarly.length >= 3 || (holders?.possibleMmCount ?? 0) >= 8
          ? "WARNING"
          : "INFO",
      title: `${holders?.possibleMmCount ?? 0} Possible MMs · ${exitedEarly.length} Early Wallet(s) Exited`,
      detail: topMm
        ? `Top watched actor ${shortAddr(topMm.address)} (${topMm.category.replace("_", " ")}): ${topMm.buyCount ?? 0}B / ${topMm.sellCount ?? 0}S, holding ${topMm.holdingPct.toFixed(2)}% — ${topMm.reason}.`
        : `Tracked ${wallets.length} key wallets across launch transfers.`,
      proofRef: topMm?.address || null,
    });
  }

  // Stage 5: Product Reality & Claims vs Receipts
  timeline.push({
    stage: "STAGE 05",
    phaseLabel: "Product Execution & Claims Check",
    severity:
      claims.contradictedCount >= 1
        ? "CRITICAL"
        : claims.receiptScorePct < 60
          ? "WARNING"
          : "CLEAN",
    title: `Claims vs Receipts: ${claims.receiptScorePct}% (${claims.verifiedCount} Verified · ${claims.contradictedCount} Contradicted)`,
    detail:
      report.contradictionCallout ||
      `Headless Chromium observed ${report.browser?.totalXhrObserved ?? 0} live API/XHR call(s). BuildCheck Trust Index: ${report.authenticityScore}/100 (${report.verdict}).`,
    proofRef: report.browser?.stops?.[0]?.url || null,
  });

  const flaggedWallets = wallets.slice(0, 5).map((w) => ({
    address: w.address,
    roleLabel:
      w.category === "possible_mm"
        ? "Possible MM"
        : w.category === "early_buyer"
          ? "Early Buyer"
          : w.category === "cabal_linked"
            ? "Cabal Linked"
            : w.category === "dev_linked"
              ? "Dev Linked"
              : "Top Holder",
    summary: `${w.holdingPct.toFixed(2)}% held${w.buyCount !== undefined ? ` · ${w.buyCount}B/${w.sellCount ?? 0}S` : ""} — ${w.reason}`,
    explorerUrl: w.explorerUrl,
  }));

  const liquidityUsd =
    market?.liquidityUsd ?? report.chain?.dexPair?.liquidityUsd ?? null;
  const liquidityLabel =
    liquidityUsd !== null && liquidityUsd > 0
      ? formatCompactUsd(liquidityUsd)
      : "Unindexed";
  const sellTaxLabel =
    evm?.honeypotStatus === "HONEYPOT"
      ? `BLOCKED (${evm.sellTaxPct ?? 99}%)`
      : typeof evm?.sellTaxPct === "number"
        ? `${evm.sellTaxPct.toFixed(1)}%`
        : tok
          ? tok.freezeAuthority
            ? "FREEZE ACTIVE"
            : "0% SPL"
          : "N/A";

  // Build ready-to-post 3-part X Autopsy Thread
  const xThread = [
    `1/3 FORENSIC AUTOPSY: ${subjectLabel} (${networkName})\n\nClassification: ${classification}\nTrust Index: ${report.authenticityScore}/100 · Receipts: ${claims.receiptScorePct}%\n\n${headline}\n\nBreakdown below via @usesolshield:`,
    `2/3 ON-CHAIN & FLOW RECEIPTS:\n• Contract / Exit: ${sellTaxLabel}${evm?.isProxy ? ` (${evm.proxyType || "Proxy"})` : ""}\n• DEX Liquidity: ${liquidityLabel}\n• Insiders & Snipers: ${insiderCombinedPct !== null ? `${insiderCombinedPct}%` : "N/A"}\n• Possible MMs: ${holders?.possibleMmCount ?? 0} | Early Buyers Exited: ${exitedEarly.length}\n• Claims Contradicted: ${claims.contradictedCount}`,
    `3/3 VERIFY BEFORE YOU SIGN:\n${timeline
      .slice(0, 3)
      .map((t) => `• ${t.phaseLabel}: ${t.title}`)
      .join("\n")}\n\nFull interactive dossier + live wallet tracker:\n${reportUrl}`,
  ];

  return {
    reportId: report.id,
    subjectLabel,
    tokenSymbol,
    address,
    networkName,
    authenticityScore: report.authenticityScore,
    severity,
    classification,
    headline,
    executiveDiagnosis: report.executiveSummary,
    metrics: {
      liquidityLabel,
      sellTaxLabel,
      insiderPctLabel:
        insiderCombinedPct !== null ? `${insiderCombinedPct}%` : "N/A",
      possibleMmCount: holders?.possibleMmCount ?? 0,
      earlyBuyersCount: holders?.earlyBuyersCount ?? 0,
      exitedEarlyCount: exitedEarly.length,
      contradictedClaimsCount: claims.contradictedCount,
    },
    timeline,
    flaggedWallets,
    xThread,
    reportUrl,
    generatedAt: new Date().toISOString(),
  };
}
