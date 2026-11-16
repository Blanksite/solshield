import type { BuildCheckReport } from "./types";
import {
  computeDualAxisSummary,
  extractMarketSnapshotFromReport,
  formatCompactUsd,
} from "./war-room-metrics";

const REPORT_ID_RE = /^bc_[a-z0-9_-]{4,40}$/i;

export interface SolShieldProofDispatch {
  subjectLabel: string;
  targetNameForHeader: string;
  shortMint: string | null;
  indexScore: number;
  verdictLabel: string;
  buildScore: number | null;
  buildLabel: string;
  postureScore: number | null;
  postureLabel: string;
  leadBrief: string;
  contradictionCallout: string | null;
  confirmedPoints: string[];
  openGaps: string[];
  takeaway: string;
  chainTraceLine: string | null;
  mindshareLine: string | null;
  reportUrl: string;
  closingNote: string;
}

export interface ProofDispatchFormatOptions {
  appPublicUrl?: string;
  maskAddresses?: boolean;
  includeUrl?: boolean;
}

export const DISPATCH_CLOSING_NOTE =
  "Execution proves the build; chain posture maps the float. Read the receipts before you sign.";

/**
 * Masks full 32–44 char Base58 Solana addresses and 0x EVM addresses inside
 * social/prose strings so automated X replies do not trigger raw-address spam filters.
 */
export function maskDispatchAddresses(text: string): string {
  return text
    .replace(
      /\b0x[a-fA-F0-9]{40}\b/g,
      (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`
    )
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (cand) => {
      const hasUpper = /[A-Z]/.test(cand);
      const hasDigitOrLower = /[0-9]/.test(cand) || /[a-z]/.test(cand);
      if (!hasUpper || !hasDigitOrLower || new Set(cand).size < 10) {
        return cand;
      }
      return `${cand.slice(0, 6)}...${cand.slice(-4)}`;
    });
}

function cleanText(raw: string | null | undefined, mask: boolean): string {
  const collapsed = (raw || "").replace(/\s+/g, " ").trim();
  return mask ? maskDispatchAddresses(collapsed) : collapsed;
}

function trimSentence(raw: string, maxLen: number): string {
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(12, maxLen - 1)).trim()}…`;
}

function dedupeItems(items: string[], maxCount: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clean = item.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const key = clean.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 48);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maxCount) break;
  }
  return out;
}

export function formatDispatchTokenIdentity(
  report: BuildCheckReport,
  maxNameLen = 22
): string | null {
  const rawName = (
    report.chain?.deep?.metadata?.name ||
    report.chain?.tokenReport?.name ||
    ""
  ).trim();
  const rawSymbol = (
    report.chain?.deep?.metadata?.symbol ||
    report.chain?.tokenReport?.symbol ||
    ""
  )
    .trim()
    .replace(/^\$+/, "");

  const cleanName =
    rawName.length > maxNameLen
      ? `${rawName.slice(0, maxNameLen - 1).trim()}…`
      : rawName;
  const cleanSymbol = rawSymbol ? `$${rawSymbol.slice(0, 12)}` : "";

  if (cleanName && cleanSymbol) {
    if (rawName.toLowerCase() === rawSymbol.toLowerCase()) {
      return cleanSymbol;
    }
    return `${cleanName} (${cleanSymbol})`;
  }
  return cleanSymbol || cleanName || null;
}

export function buildReportPermalinkUrl(
  reportId: string | undefined,
  appPublicUrl = "https://sol-shield.xyz"
): string {
  const base = `${appPublicUrl.replace(/\/+$/, "")}/buildcheck`;
  if (reportId && REPORT_ID_RE.test(reportId.trim())) {
    return `${base}?report=${encodeURIComponent(reportId.trim())}`;
  }
  return base;
}

function verdictToTag(verdict: BuildCheckReport["verdict"]): string {
  if (verdict === "VERIFIED_BUILD") return "VERIFIED BUILD";
  if (verdict === "UNPROVEN_HYPE") return "UNPROVEN HYPE";
  return "HIGH FABRICATION RISK";
}

/**
 * Synthesizes an original, structured SolShield Proof Dispatch brief from any
 * completed BuildCheckReport (token CA, GitHub repo, X post, or web app).
 */
export function buildProofDispatch(
  report: BuildCheckReport,
  options: ProofDispatchFormatOptions = {}
): SolShieldProofDispatch {
  const mask = options.maskAddresses ?? false;
  const appPublicUrl = options.appPublicUrl || "https://sol-shield.xyz";
  const dual = computeDualAxisSummary(report);

  const rawSymbol = (
    report.chain?.deep?.metadata?.symbol ||
    report.chain?.tokenReport?.symbol ||
    ""
  )
    .trim()
    .replace(/^\$+/, "");
  const tokenIdentity = formatDispatchTokenIdentity(report, 22);
  const shortMint = report.target.mintAddress
    ? `${report.target.mintAddress.slice(0, 6)}...${report.target.mintAddress.slice(-4)}`
    : null;

  const subjectLabel =
    (rawSymbol ? `$${rawSymbol.slice(0, 12)}` : null) ||
    report.target.githubOwnerRepo ||
    report.target.hostname ||
    shortMint ||
    "Audited Target";

  const targetNameForHeader =
    report.target.githubOwnerRepo ||
    (shortMint && tokenIdentity ? `${tokenIdentity} · ${shortMint}` : shortMint) ||
    report.target.hostname ||
    "target";

  const confirmedCandidates: string[] = [
    ...(report.verifiedSignals || []).map((s) =>
      trimSentence(cleanText(s, mask), 92)
    ),
    ...(report.claimsVsProof || [])
      .filter((r) => r.status === "VERIFIED")
      .map((r) => trimSentence(cleanText(`${r.claim} — ${r.evidence}`, mask), 92)),
  ];

  if (confirmedCandidates.length === 0 && report.github?.exists) {
    confirmedCandidates.push(
      `Public repository (${report.github.fullName}) with ${report.github.recentCommitCount} recent commits`
    );
  }
  if (
    confirmedCandidates.length < 2 &&
    report.chain?.tokenReport &&
    report.chain.tokenReport.mintAuthority === null &&
    report.chain.tokenReport.freezeAuthority === null
  ) {
    const isEvmToken =
      report.chain.chainFamily === "evm" ||
      report.chain.mintAddress?.startsWith("0x");
    confirmedCandidates.push(
      isEvmToken
        ? "Contract verified on-chain with clean mint hygiene"
        : "Mint & freeze authorities revoked on Solana Mainnet"
    );
  }

  const gapCandidates: string[] = [
    ...(report.keyRedFlags || []).map((f) =>
      trimSentence(cleanText(f, mask), 92)
    ),
    ...(report.claimsVsProof || [])
      .filter((r) => r.status !== "VERIFIED")
      .map((r) =>
        trimSentence(
          cleanText(
            `${r.claim} (${r.status.toLowerCase()}): ${r.evidence}`,
            mask
          ),
          92
        )
      ),
  ];

  if (
    gapCandidates.length === 0 &&
    report.componentScores.codeProof === null &&
    report.chain?.mintAddress &&
    !report.github?.exists
  ) {
    gapCandidates.push("Public source repository not discovered in audited links");
  }

  const confirmedPoints = dedupeItems(confirmedCandidates, 4);
  const openGaps = dedupeItems(gapCandidates, 3);

  const rawHeadline = cleanText(report.headline, mask);
  const rawExec = cleanText(report.executiveSummary, mask);
  const leadBrief = trimSentence(rawHeadline || rawExec, 150);

  const explicitCallout = cleanText(report.contradictionCallout, mask);
  const topContradicted = (report.claimsVsProof || []).find(
    (r) => r.status === "CONTRADICTED"
  );
  const derivedCallout = topContradicted
    ? cleanText(`${topContradicted.claim}: ${topContradicted.evidence}`, mask)
    : "";
  const rawCallout = explicitCallout || derivedCallout;
  const contradictionCallout = rawCallout ? trimSentence(rawCallout, 155) : null;

  let takeaway = rawExec;
  if (
    rawHeadline &&
    rawExec &&
    rawExec.toLowerCase().startsWith(rawHeadline.slice(0, 28).toLowerCase())
  ) {
    const rest = rawExec.slice(rawHeadline.length).replace(/^[\s.,;:–-]+/, "").trim();
    takeaway = rest || rawExec;
  }
  takeaway = trimSentence(takeaway || leadBrief, 220);

  let chainTraceLine: string | null = null;
  if (report.chain) {
    const holders = report.chain.deep?.holders;
    const { liquidityUsd } = extractMarketSnapshotFromReport(report);
    const traceParts: string[] = [];

    if (holders) {
      const clusters = holders.clusters || [];
      if (clusters.length > 0) {
        const combinedPct = Math.min(
          100,
          clusters.reduce((acc, c) => acc + (c.combinedPct || 0), 0)
        );
        traceParts.push(
          `${clusters.length} co-funded cluster${clusters.length === 1 ? "" : "s"} (${combinedPct.toFixed(1)}%)`
        );
      } else {
        traceParts.push("0 co-funded clusters");
      }
      if (typeof holders.totalHolders === "number" && holders.totalHolders > 0) {
        traceParts.push(`${holders.totalHolders.toLocaleString("en-US")} holders`);
      }
      if (typeof holders.distribution?.devPct === "number") {
        traceParts.push(`Dev ${holders.distribution.devPct.toFixed(1)}%`);
      }
    } else if (report.chain.tokenReport) {
      traceParts.push(`Top5 ${report.chain.tokenReport.top5Pct.toFixed(1)}%`);
    }

    const liqStr = formatCompactUsd(liquidityUsd);
    if (liqStr !== "—") {
      traceParts.push(`Liq ${liqStr}`);
    }

    if (traceParts.length > 0) {
      chainTraceLine = traceParts.join(" · ");
    }
  }

  let mindshareLine: string | null = null;
  if (report.social && report.social.source !== "unavailable") {
    const s = report.social;
    if (s.totalPostsSampled > 0) {
      mindshareLine = `Mindshare ${s.mindshareScore}/100 (${s.quadrantLabel}) · ${s.kolCount} KOL${
        s.kolCount === 1 ? "" : "s"
      } · ${s.sentimentBreakdown.bullishPct}% bull / ${s.sentimentBreakdown.skepticalPct}% skeptical`;
    } else if (s.officialProfile) {
      mindshareLine = `@${s.officialProfile.username} (${s.officialProfile.followersCount.toLocaleString(
        "en-US"
      )} followers) · Pre-discovery (0 X mentions)`;
    }
  }

  return {
    subjectLabel,
    targetNameForHeader,
    shortMint,
    indexScore: report.authenticityScore,
    verdictLabel: verdictToTag(report.verdict),
    buildScore: dual.buildIntegrity.score,
    buildLabel: dual.buildIntegrity.label,
    postureScore: dual.holderPosture.score,
    postureLabel: dual.holderPosture.label,
    leadBrief,
    contradictionCallout,
    confirmedPoints,
    openGaps,
    takeaway,
    chainTraceLine,
    mindshareLine,
    reportUrl: buildReportPermalinkUrl(report.id, appPublicUrl),
    closingNote: DISPATCH_CLOSING_NOTE,
  };
}

/**
 * Formats a multi-section SolShield Proof Dispatch brief suitable for long X
 * posts, Web clipboard sharing, or editorial briefing previews.
 */
export function formatSolShieldDispatchText(
  report: BuildCheckReport,
  options: ProofDispatchFormatOptions = {}
): string {
  const d = buildProofDispatch(report, options);
  const includeUrl = options.includeUrl ?? true;

  const axisLine =
    d.postureScore !== null
      ? `BUILD: ${d.buildScore ?? "N/A"} (${d.buildLabel}) · POSTURE: ${d.postureScore} (${d.postureLabel})`
      : `BUILD: ${d.buildScore ?? "N/A"} (${d.buildLabel}) · TARGET: ${d.postureLabel}`;

  const sections: string[] = [
    `${d.subjectLabel} · INDEX ${d.indexScore}/100 · [${d.verdictLabel}]\n${axisLine}`,
  ];

  if (d.leadBrief) {
    sections.push(d.leadBrief);
  }

  if (d.contradictionCallout) {
    sections.push(`CLAIM VS PROOF CALL-OUT:\n⚡ ${d.contradictionCallout}`);
  }

  if (d.confirmedPoints.length > 0) {
    sections.push(
      `CONFIRMED EVIDENCE:\n${d.confirmedPoints.map((p) => `✓ ${p}`).join("\n")}`
    );
  }

  if (d.openGaps.length > 0) {
    sections.push(
      `OPEN GAPS & CAVEATS:\n${d.openGaps.map((g) => `◦ ${g}`).join("\n")}`
    );
  }

  if (d.takeaway && d.takeaway !== d.leadBrief) {
    sections.push(`ANALYST SYNTHESIS:\n${d.takeaway}`);
  }

  const footerMeta: string[] = [];
  if (d.chainTraceLine) {
    footerMeta.push(`CHAIN TRACE: ${d.chainTraceLine}`);
  }
  if (d.mindshareLine) {
    footerMeta.push(`X MINDSHARE: ${d.mindshareLine}`);
  }
  if (includeUrl) {
    footerMeta.push(`LIVE REPORT: ${d.reportUrl}`);
  }
  if (footerMeta.length > 0) {
    sections.push(footerMeta.join("\n"));
  }

  sections.push(d.closingNote);
  return sections.join("\n\n");
}

/**
 * Formats a crisp 2-tweet X reply thread (`primary` <= 280 chars + `followup` <= 280 chars)
 * so standard X API tiers still deliver both the scorecard and the forensic story narrative.
 */
export function formatSolShieldThreadReplies(
  report: BuildCheckReport,
  appPublicUrl = "https://sol-shield.xyz",
  options: { includeUrl?: boolean } = {}
): { primary: string; followup: string } {
  const includeUrl = options.includeUrl ?? true;
  const d = buildProofDispatch(report, {
    appPublicUrl,
    maskAddresses: true,
    includeUrl,
  });

  const codeTxt =
    report.componentScores.codeProof !== null
      ? `${report.componentScores.codeProof}`
      : "N/A";
  const chainTxt =
    report.componentScores.chainProof !== null
      ? `${report.componentScores.chainProof}`
      : "N/A";
  const webTxt =
    report.componentScores.domainProof !== null
      ? `${report.componentScores.domainProof}`
      : "N/A";

  const header = `[${d.verdictLabel}] ${d.indexScore}/100 — ${d.targetNameForHeader}\nCode ${codeTxt} | Chain ${chainTxt} | Web ${webTxt}`;
  const cleanBaseUrl = `${appPublicUrl.replace(/\/+$/, "")}/buildcheck`;
  const selectedAppUrl =
    header.length + d.reportUrl.length + 28 <= 272 ? d.reportUrl : cleanBaseUrl;
  const footerLine = includeUrl
    ? selectedAppUrl
    : "SolShield x Venice AI Zero-Retention Proof Card attached";
  const budgetForFinding = 272 - header.length - footerLine.length - 6;
  const rawLead =
    report.verdict === "VERIFIED_BUILD"
      ? report.verifiedSignals[0] || report.headline
      : d.contradictionCallout ||
        report.keyRedFlags[0] ||
        report.verifiedSignals[0] ||
        report.headline;
  const maskedLead = maskDispatchAddresses(rawLead || "").replace(/\s+/g, " ").trim();
  const compactFinding =
    budgetForFinding > 24 ? maskedLead.slice(0, budgetForFinding).trim() : "";

  const primaryParts = [header];
  if (compactFinding) primaryParts.push(compactFinding);
  primaryParts.push(footerLine);
  const primary = primaryParts.join("\n\n").slice(0, 280);

  // Tweet 2: Distilled Proof Dispatch narrative strictly <= 280 chars
  const confirmedBrief = d.confirmedPoints
    .slice(0, 2)
    .map((p) => trimSentence(p, 58))
    .join("; ");
  const gapBrief = d.openGaps
    .slice(0, 2)
    .map((g) => trimSentence(g, 56))
    .join("; ");

  const followParts: string[] = [
    `PROOF DISPATCH (${d.subjectLabel})`,
    confirmedBrief ? `✓ ${confirmedBrief}` : trimSentence(d.takeaway, 95),
  ];
  if (gapBrief) {
    followParts.push(`◦ Watch: ${gapBrief}`);
  }
  if (d.chainTraceLine) {
    followParts.push(`⛓ ${d.chainTraceLine}`);
  }
  let followup = followParts.join("\n");
  if (followup.length > 280) {
    const compactParts = [
      `PROOF DISPATCH · ${d.subjectLabel}`,
      confirmedBrief ? `✓ ${trimSentence(confirmedBrief, 88)}` : "",
      gapBrief ? `◦ ${trimSentence(gapBrief, 78)}` : "",
      d.chainTraceLine ? `⛓ ${trimSentence(d.chainTraceLine, 64)}` : "",
    ].filter(Boolean);
    followup = compactParts.join("\n").slice(0, 280);
  }

  return { primary, followup };
}

function escapeHtmlBasic(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Renders the full SolShield Proof Dispatch as clean Telegram HTML for a threaded
 * narrative follow-up message alongside the Evidence Card photo.
 */
export function formatTelegramProofDispatchHtml(
  report: BuildCheckReport,
  appPublicUrl = "https://sol-shield.xyz"
): string {
  const d = buildProofDispatch(report, {
    appPublicUrl,
    maskAddresses: false,
    includeUrl: true,
  });

  const blocks: string[] = [
    `📋 <b>SOLSHIELD PROOF DISPATCH · ${escapeHtmlBasic(d.subjectLabel)}</b>`,
    `<i>${escapeHtmlBasic(d.buildLabel)}${d.postureScore !== null ? ` (${d.buildScore ?? "N/A"}) · ${escapeHtmlBasic(d.postureLabel)} (${d.postureScore})` : ""}</i>`,
  ];

  if (d.confirmedPoints.length > 0) {
    blocks.push(
      `<b>Confirmed Evidence</b>\n${d.confirmedPoints
        .map((p) => `✅ ${escapeHtmlBasic(p)}`)
        .join("\n")}`
    );
  }

  if (d.contradictionCallout) {
    blocks.push(
      `⚡ <b>Claim vs Proof Call-Out:</b> ${escapeHtmlBasic(d.contradictionCallout)}`
    );
  }

  if (d.openGaps.length > 0) {
    blocks.push(
      `<b>Open Gaps &amp; Watchpoints</b>\n${d.openGaps
        .map((g) => `⚠️ ${escapeHtmlBasic(g)}`)
        .join("\n")}`
    );
  }

  if (d.takeaway) {
    blocks.push(
      `<blockquote><b>Analyst Synthesis:</b> ${escapeHtmlBasic(d.takeaway)}</blockquote>`
    );
  }

  if (d.chainTraceLine) {
    blocks.push(`⛓ <b>Trace:</b> ${escapeHtmlBasic(d.chainTraceLine)}`);
  }

  blocks.push(
    `<i>${escapeHtmlBasic(d.closingNote)}</i>\n<a href="${escapeHtmlBasic(d.reportUrl)}">Open Full BuildCheck Dossier</a>`
  );

  return blocks.join("\n\n").slice(0, 3800);
}
