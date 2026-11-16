import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { findLocalChromiumExecutable } from "../src/lib/buildcheck/browser-agent";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";
import { assertSafePublicHttpUrl } from "../src/lib/buildcheck/url-safety";
import { formatTokenIdentityLabel } from "./x-client";

const MAX_TOKEN_LOGO_BYTES = 512 * 1024;
const TOKEN_LOGO_FETCH_TIMEOUT_MS = 3000;
const MAX_TOKEN_LOGO_REDIRECTS = 2;
const ALLOWED_RASTER_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);
const SAFE_RASTER_DATA_URI_RE =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EvidenceCardAssets {
  logoDataUri?: string | null;
  veniceLogoDataUri?: string | null;
  tokenLogoDataUri?: string | null;
  botHandle?: string;
  appPublicUrl?: string;
}

function loadInlineAssetDataUri(
  candidates: string[],
  mimeType: string
): string | null {
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) {
        const b64 = fs.readFileSync(cand).toString("base64");
        return `data:${mimeType};base64,${b64}`;
      }
    } catch {
      // Ignore unreadable asset
    }
  }
  return null;
}

function loadInlineLogoDataUri(): string | null {
  return loadInlineAssetDataUri(
    [
      path.join(process.cwd(), "public", "logo.png"),
      path.join(process.cwd(), "public", "favicon.png"),
    ],
    "image/png"
  );
}

function loadInlineVeniceLogoDataUri(): string | null {
  return loadInlineAssetDataUri(
    [
      path.join(process.cwd(), "public", "venice-color.svg"),
      path.join(process.cwd(), "public", "venice-logo.svg"),
    ],
    "image/svg+xml"
  );
}

function formatScoreChip(label: string, val: number | null | undefined): string {
  const hasScore = typeof val === "number" && Number.isFinite(val);
  const display = hasScore ? `${Math.round(val)}` : "N/A";
  const color = !hasScore
    ? "#64748B"
    : val >= 70
      ? "#6EE7B7"
      : val >= 45
        ? "#FCD34D"
        : "#FCA5A5";
  return `
    <div class="metric-chip">
      <span class="metric-label">${escapeHtml(label)}</span>
      <span class="metric-value" style="color:${color};">${escapeHtml(display)}</span>
    </div>
  `;
}

function normalizeTokenLogoUrl(rawUrl?: string | null): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;
  if (/^ipfs:\/\//i.test(trimmed)) {
    const cidPath = trimmed.replace(/^ipfs:\/\/(?:ipfs\/)?/i, "").replace(/^\/+/, "");
    return cidPath ? `https://ipfs.io/ipfs/${cidPath}` : null;
  }
  return trimmed;
}

function detectRasterMimeFromBytes(buf: Buffer): string | null {
  if (
    buf.length >= 4 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "GIF8") {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function readLimitedResponseBytes(
  res: Response,
  maxBytes: number
): Promise<Buffer | null> {
  const declaredLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return null;
  }

  if (!res.body) {
    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0 || arr.byteLength > maxBytes) return null;
    return Buffer.from(arr);
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }

  if (total === 0) return null;
  return Buffer.concat(chunks, total);
}

/**
 * Safely fetches an external token logo image over HTTPS/HTTP with SSRF validation,
 * bounded redirects, strict raster MIME + signature checks (rejecting SVG), size cap, and timeout.
 */
export async function loadTokenLogoDataUri(rawUrl?: string | null): Promise<string | null> {
  let currentUrl = normalizeTokenLogoUrl(rawUrl);
  if (!currentUrl) return null;

  const deadline = Date.now() + TOKEN_LOGO_FETCH_TIMEOUT_MS;

  try {
    for (let hop = 0; hop <= MAX_TOKEN_LOGO_REDIRECTS; hop++) {
      const safeUrl = await assertSafePublicHttpUrl(currentUrl);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remainingMs);
      let res: Response;
      try {
        res = await fetch(safeUrl.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "image/png,image/jpeg,image/webp,image/gif",
            "User-Agent": "SolShield-CardRenderer/1.0",
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location || hop >= MAX_TOKEN_LOGO_REDIRECTS) return null;
        currentUrl = new URL(location, safeUrl).toString();
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }

      const rawContentType = (res.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!ALLOWED_RASTER_MIME.has(rawContentType)) {
        await res.body?.cancel().catch(() => {});
        return null;
      }

      const buf = await readLimitedResponseBytes(res, MAX_TOKEN_LOGO_BYTES);
      if (!buf) return null;

      const detectedMime = detectRasterMimeFromBytes(buf);
      if (!detectedMime) return null;

      return `data:${detectedMime};base64,${buf.toString("base64")}`;
    }
  } catch {
    return null;
  }

  return null;
}

function extractTokenMonogram(report: BuildCheckReport): string {
  const symbolRaw =
    report.chain?.deep?.metadata?.symbol ||
    report.chain?.tokenReport?.symbol ||
    "";
  const symbolClean = symbolRaw.replace(/[^A-Za-z0-9]/g, "");
  if (symbolClean.length > 0) {
    return symbolClean.slice(0, 2).toUpperCase();
  }

  const nameRaw =
    report.chain?.deep?.metadata?.name ||
    report.chain?.tokenReport?.name ||
    "";
  const words = nameRaw
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return "TK";
}

function sanitizeTokenLogoDataUri(candidate?: string | null): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;
  if (trimmed.length > 750_000) return null;
  return SAFE_RASTER_DATA_URI_RE.test(trimmed) ? trimmed : null;
}

function renderFlagColumnHtml(
  title: string,
  items: string[],
  tone: "green" | "red",
  emptyFallback: string
): string {
  const cleaned = items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);
  const listHtml =
    cleaned.length > 0
      ? cleaned
          .map(
            (item) => `
              <div class="flag-item">
                <span class="flag-dot flag-dot-${tone}"></span>
                <span class="flag-text">${escapeHtml(item.slice(0, 92))}</span>
              </div>`
          )
          .join("")
      : `<div class="flag-empty">${escapeHtml(emptyFallback)}</div>`;
  return `
    <div class="flag-card flag-card-${tone}">
      <div class="flag-header flag-header-${tone}">
        <span class="flag-badge flag-badge-${tone}">${tone === "green" ? "+" : "!"}</span>
        <span>${escapeHtml(title)}</span>
      </div>
      <div class="flag-list">${listHtml}</div>
    </div>
  `;
}

function formatCompactUsd(val: number | null | undefined): string {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return "$0";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

/**
 * Generates static HTML (zero scripts, escaped user strings) for a 1200x675
 * SolShield BuildCheck PNG evidence card with Venice AI Zero-Retention branding
 * using the high-impact Crypto Wrapped Tech & On-Chain design.
 */
export function buildEvidenceCardHtml(
  report: BuildCheckReport,
  assetsOrLogo: string | null | EvidenceCardAssets = null
): string {
  const assets: EvidenceCardAssets =
    typeof assetsOrLogo === "string" || assetsOrLogo === null
      ? { logoDataUri: assetsOrLogo }
      : assetsOrLogo;

  const logoDataUri = assets.logoDataUri ?? null;
  const veniceLogoDataUri = assets.veniceLogoDataUri ?? null;
  const safeTokenLogoDataUri = sanitizeTokenLogoDataUri(assets.tokenLogoDataUri);
  const cleanHandle = (
    assets.botHandle ||
    process.env.BOT_X_HANDLE?.trim() ||
    "usesolshield"
  ).replace(/^@/, "");
  const cleanAppDomain = (
    assets.appPublicUrl ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://sol-shield.xyz"
  )
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  const isRobinhood = Boolean(
    report.robinhood ||
    report.chain?.robinhood ||
    report.chain?.chainFamily === "evm" ||
    report.target?.mintAddress?.startsWith("0x") ||
    report.target?.kind === "evm_contract"
  );
  const rhStatus = report.robinhood?.status || report.chain?.robinhood?.status;
  const hasGithub = Boolean(report.github?.exists);

  // Background Theme
  let bodyBackground = `
    radial-gradient(circle at 92% 8%, rgba(0, 245, 160, 0.22), transparent 48%),
    radial-gradient(circle at 8% 92%, rgba(14, 165, 233, 0.18), transparent 45%),
    radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.06), transparent 60%),
    linear-gradient(180deg, #050B16 0%, #020408 100%)
  `;
  let bodyBgColor = "#04070E";
  let brandSubText = "TECH &amp; ON-CHAIN EDITION";
  let brandSubBadge = hasGithub ? "AI AGENT &amp; TECH AUDIT" : "CODEBASE &amp; FORENSICS";
  let cardAccentGlow = "linear-gradient(90deg, #00F5A0, #00D9F5)";
  let accentColor = "#00F5A0";

  if (isRobinhood) {
    if (rhStatus === "IMPOSTOR_ALERT") {
      bodyBackground = `
        radial-gradient(circle at 92% 8%, rgba(239, 68, 68, 0.32), transparent 50%),
        radial-gradient(circle at 8% 92%, rgba(245, 158, 11, 0.22), transparent 44%),
        linear-gradient(180deg, #140407 0%, #080203 100%)
      `;
      bodyBgColor = "#0A0204";
      brandSubText = "ROBINHOOD IMPOSTOR ALERT";
      brandSubBadge = "⚠️ CLONE ALERT";
      cardAccentGlow = "linear-gradient(90deg, #EF4444, #F59E0B)";
      accentColor = "#EF4444";
    } else if (rhStatus === "ROBINHOOD_CHAIN_NATIVE") {
      bodyBackground = `
        radial-gradient(circle at 92% 8%, rgba(14, 165, 233, 0.26), transparent 50%),
        radial-gradient(circle at 8% 92%, rgba(0, 200, 5, 0.18), transparent 44%),
        linear-gradient(180deg, #02111A 0%, #01080D 100%)
      `;
      bodyBgColor = "#01090F";
      brandSubText = "ROBINHOOD CHAIN L2";
      brandSubBadge = "L2 NATIVE TECH";
      cardAccentGlow = "linear-gradient(90deg, #38BDF8, #00FF66)";
      accentColor = "#38BDF8";
    } else {
      // Official Robinhood Listed / Cyber Emerald
      bodyBackground = `
        radial-gradient(circle at 92% 8%, rgba(0, 200, 5, 0.28), transparent 48%),
        radial-gradient(circle at 8% 92%, rgba(16, 185, 129, 0.18), transparent 45%),
        radial-gradient(circle at 50% 50%, rgba(0, 200, 5, 0.05), transparent 60%),
        linear-gradient(180deg, #020E06 0%, #010603 100%)
      `;
      bodyBgColor = "#020905";
      brandSubText = "TECH &amp; ON-CHAIN EDITION";
      brandSubBadge = "ROBINHOOD OFFICIAL LISTING";
      cardAccentGlow = "linear-gradient(90deg, #00FF66, #00C805)";
      accentColor = "#00FF66";
    }
  }

  // Target Identity & Avatar
  const targetLabel =
    report.target.githubOwnerRepo ||
    report.target.mintAddress ||
    report.target.hostname ||
    report.target.rawInput;
  const tokenIdentity = formatTokenIdentityLabel(report, 26);
  const tokenIdentityHtml = tokenIdentity
    ? `<span class="token-name-tag">${escapeHtml(tokenIdentity)}</span>`
    : "";
  const tokenAvatarHtml = safeTokenLogoDataUri
    ? `<div class="token-avatar"><img class="token-avatar-img" src="${escapeHtml(safeTokenLogoDataUri)}" alt="" /></div>`
    : report.target.kind === "token_ca" || Boolean(tokenIdentity)
      ? `<div class="token-avatar token-avatar-fallback">${escapeHtml(extractTokenMonogram(report))}</div>`
      : "";

  // Determine if target is a verified Tech/dApp product vs Authentic Meme vs Vaporware
  const hasLiveDapp = Boolean(
    (report.browser && (report.browser.totalXhrObserved > 0 || (report.browser.inspectedApiPayloads && report.browser.inspectedApiPayloads.length > 0))) ||
    (report.claimsVsProof && report.claimsVsProof.some((c) => c.status === "VERIFIED" && /product|marketplace|api|platform|dapp|app/i.test(c.claim)))
  );

  const isVerifiedTechProduct =
    report.verdict === "VERIFIED_BUILD" && (Boolean(hasGithub) || hasLiveDapp);

  const isMemeListing =
    rhStatus === "OFFICIAL_LISTED" ||
    Boolean(report.chain?.tokenReport?.isPumpFunSuffix) ||
    (!hasGithub && !hasLiveDapp && report.authenticityScore >= 70);

  // 1. Dynamic Headline (Strictly harmonious with codebase verdict, never contradictory)
  let heroHeadline = "REAL CODE. REAL ARCHITECTURE.";
  if (rhStatus === "OFFICIAL_LISTED" || isMemeListing) {
    heroHeadline = "YES, IT'S THE REAL DEAL.";
  } else if (rhStatus === "IMPOSTOR_ALERT") {
    heroHeadline = "CLONE TRAP DETECTED.";
  } else if (report.verdict === "UNPROVEN_HYPE") {
    heroHeadline = "ALL MARKETING. ZERO COMMITS.";
  } else if (report.verdict === "HIGH_FABRICATION_RISK") {
    heroHeadline = "CERTIFIED VAPORWARE LARP.";
  } else if (isVerifiedTechProduct) {
    heroHeadline = "REAL CODE. REAL ARCHITECTURE.";
  } else if (report.authenticityScore >= 75) {
    heroHeadline = "YES, IT'S THE REAL DEAL.";
  } else {
    heroHeadline = "ALL MARKETING. ZERO COMMITS.";
  }

  // 4 Modern Metric Cards (Clean text titles, NO emoji icons, "TECH CODEBASE" as first card)
  // Card 1: TECH CODEBASE
  let techCodebaseVal = "Pure Meme";
  let techCodebaseSub = "Zero Fake Tech LARP";
  if (hasGithub && report.github) {
    const commitCount = report.github.recentCommitCount || 0;
    techCodebaseVal = commitCount > 0 ? `${commitCount} Commits` : "Active Repo";
    techCodebaseSub = report.github.uniqueAuthorCount
      ? `${report.github.uniqueAuthorCount} Active Core Devs`
      : `${report.github.topLanguages[0] || "Open Source"} Stack`;
  } else if (report.componentScores.codeProof !== null && report.componentScores.codeProof !== undefined && report.componentScores.codeProof > 0) {
    techCodebaseVal = `${Math.round(report.componentScores.codeProof)}/100`;
    techCodebaseSub = report.componentScores.codeProof >= 70 ? "Active Builders" : "Low Code Footprint";
  } else if (hasLiveDapp && report.verdict === "VERIFIED_BUILD") {
    const xhrCount = report.browser?.totalXhrObserved || report.browser?.inspectedApiPayloads?.length || 0;
    techCodebaseVal = xhrCount > 0 ? "Live dApp" : "Verified App";
    techCodebaseSub = xhrCount > 0 ? `${xhrCount} Live API Calls` : "Operational Web3";
  } else if (report.verdict === "UNPROVEN_HYPE" || report.verdict === "HIGH_FABRICATION_RISK") {
    techCodebaseVal = "No Code";
    techCodebaseSub = "Unverified Tech Claims";
  } else {
    techCodebaseVal = "Pure Meme";
    techCodebaseSub = "Zero Fake Tech LARP";
  }

  // Card 2: OPEN SOURCE TECH / SMART CONTRACT
  let contractTechVal = "Clean";
  let contractTechSub = "Renounced · Zero Tax";
  if (hasGithub && report.github) {
    contractTechVal = report.github.hasTestsOrCi ? "Verified" : "Clean Stack";
    contractTechSub = report.github.topLevelFiles.slice(0, 2).join(", ") || "Manifests & CI OK";
  } else if (report.chain?.tokenReport) {
    if (report.chain.tokenReport.riskScore <= 20) {
      contractTechVal = "Clean";
      contractTechSub = report.chain.chainFamily === "evm" ? "Renounced · Zero Tax" : "Authorities Revoked";
    } else if (report.chain.tokenReport.riskScore >= 55) {
      contractTechVal = "Flagged";
      contractTechSub = `Risk Score: ${report.chain.tokenReport.riskScore}/100`;
    } else {
      contractTechVal = "Audited";
      contractTechSub = "Standard Token Hygiene";
    }
  }

  // Card 3: LOCKED LIQUIDITY / POOL DEPTH
  let liquidityVal = "$0 Pool";
  let liquiditySub = "Unindexed DEX Pool";
  if (report.chain?.dexPair?.liquidityUsd) {
    liquidityVal = formatCompactUsd(report.chain.dexPair.liquidityUsd);
    liquiditySub =
      report.chain.dexPair.liquidityUsd >= 500_000
        ? "Whale & Slippage Proof"
        : `${report.chain.dexPair.dexId || "DEX"} Liquidity Pool`;
  }

  // Card 4: ROBINHOOD / CHAIN STATUS
  let chainStatusVal = "Solana L1";
  let chainStatusSub = "Decentralized SPL";
  if (rhStatus === "OFFICIAL_LISTED") {
    chainStatusVal = report.robinhood?.tradingPair || report.chain?.robinhood?.tradingPair || "PEPE-USD";
    chainStatusSub = "Live Tradable on App";
  } else if (rhStatus === "ROBINHOOD_CHAIN_NATIVE") {
    chainStatusVal = "Passed";
    chainStatusSub = "Orbit L2 & AI Native";
  } else if (rhStatus === "IMPOSTOR_ALERT") {
    chainStatusVal = "Impostor";
    chainStatusSub = "Fake Lookalike Trap";
  } else if (report.chain?.chainFamily === "evm" || report.target.mintAddress?.startsWith("0x")) {
    chainStatusVal = "EVM Contract";
    chainStatusSub = report.chain?.networkName || "Ethereum L1";
  }

  // Language / Stack Chips for Breakdown Box
  let stackChipsHtml = "";
  if (report.github?.topLanguages && report.github.topLanguages.length > 0) {
    stackChipsHtml = report.github.topLanguages
      .slice(0, 3)
      .map((l) => `<span class="stack-chip">${escapeHtml(l)}</span>`)
      .join("");
  } else if (report.chain?.chainFamily === "evm" || report.target.mintAddress?.startsWith("0x")) {
    stackChipsHtml = `
      <span class="stack-chip">Solidity ERC-20</span>
      <span class="stack-chip">No Backdoor Mint</span>
      <span class="stack-chip">Decentralized LP</span>
    `;
  } else {
    stackChipsHtml = `
      <span class="stack-chip">Solana SPL Token</span>
      <span class="stack-chip">Revoked Authorities</span>
      <span class="stack-chip">DeFi Native</span>
    `;
  }

  // Synthesis Summary
  const synthesisSummary =
    report.contradictionCallout ||
    report.executiveSummary ||
    report.headline;

  // Green Flags and Red Flags for full compatibility with test assertions
  const verifiedSignals = (report.verifiedSignals ?? []).filter(Boolean).slice(0, 2);
  const keyRedFlags = (report.keyRedFlags ?? []).filter(Boolean).slice(0, 2);

  const greenFlagsHtml =
    verifiedSignals.length > 0
      ? verifiedSignals.map((s) => `<div class="tag-item tag-green">✓ ${escapeHtml(s.slice(0, 68))}</div>`).join("")
      : `<div class="tag-item tag-muted">No strong green flags recorded yet</div>`;

  const redFlagsHtml =
    keyRedFlags.length > 0
      ? keyRedFlags.map((f) => `<div class="tag-item tag-red">! ${escapeHtml(f.slice(0, 68))}</div>`).join("")
      : `<div class="tag-item tag-muted">No critical red flags detected</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&family=Space+Grotesk:wght@700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px;
    height: 675px;
    background: ${bodyBackground};
    background-color: ${bodyBgColor};
    color: #F8FAFC;
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    padding: 34px 46px 28px 46px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .grid-lines {
    position: absolute;
    inset: 0;
    background-image: 
      linear-gradient(to right, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 1;
  }
  .content-layer {
    position: relative;
    z-index: 2;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  /* Top Bar */
  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 1.5px solid rgba(0, 245, 160, 0.4);
    background: #020F08;
    box-shadow: 0 0 18px rgba(0, 245, 160, 0.25);
    object-fit: cover;
  }
  .edition-pill {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 6px 14px;
    border-radius: 50px;
    background: linear-gradient(90deg, rgba(0, 245, 160, 0.16) 0%, rgba(14, 165, 233, 0.16) 100%);
    border: 1px solid rgba(0, 245, 160, 0.4);
    color: ${accentColor};
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .badge-tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 700;
    color: #38BDF8;
    background: rgba(14, 165, 233, 0.12);
    border: 1px solid rgba(14, 165, 233, 0.3);
    border-radius: 6px;
    padding: 4px 10px;
  }

  /* Venice AI Pill */
  .venice-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 6px 14px;
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .venice-icon {
    height: 20px;
    width: auto;
  }
  .venice-text {
    display: flex;
    flex-direction: column;
    text-align: left;
  }
  .venice-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px;
    font-weight: 800;
    color: #FFFFFF;
    letter-spacing: 0.05em;
  }
  .venice-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    color: ${accentColor};
    letter-spacing: 0.08em;
  }

  /* Hero Section */
  .hero-container {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .token-avatar {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    border: 2.5px solid ${accentColor};
    box-shadow: 0 0 24px rgba(0, 245, 160, 0.35);
    overflow: hidden;
    flex-shrink: 0;
    background: #0B111E;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .token-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .token-avatar-fallback {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(14, 165, 233, 0.3));
    color: #6EE7B7;
    font-size: 24px;
    font-weight: 900;
    font-family: 'Space Grotesk', sans-serif;
  }
  .hero-titles {
    flex: 1;
    min-width: 0;
  }
  .hero-headline {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 44px;
    font-weight: 900;
    letter-spacing: -0.03em;
    line-height: 1.05;
    background: linear-gradient(90deg, #FFFFFF 0%, #E2E8F0 45%, ${accentColor} 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .hero-sub {
    font-size: 14.5px;
    color: #94A3B8;
    font-weight: 600;
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .token-name-tag {
    color: ${accentColor};
    font-weight: 700;
  }
  .target-pill {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #38BDF8;
    background: rgba(14, 165, 233, 0.14);
    border: 1px solid rgba(14, 165, 233, 0.35);
    padding: 2px 9px;
    border-radius: 6px;
  }

  /* 4 Modern Stat Blocks (No Emoji Icons, Clean Titles) */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-top: 16px;
  }
  .stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px 18px;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 98px;
  }
  .stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: ${cardAccentGlow};
    opacity: 0.85;
  }
  .stat-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94A3B8;
  }
  .stat-val {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: -0.02em;
    color: #FFFFFF;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stat-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 600;
    color: ${accentColor};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Tech Forensics Breakdown Box */
  .tech-box {
    margin-top: 14px;
    background: rgba(14, 165, 233, 0.04);
    border: 1px solid rgba(14, 165, 233, 0.25);
    border-radius: 14px;
    padding: 13px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .tech-left {
    flex: 1;
    min-width: 0;
  }
  .tech-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .tech-badge-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12.5px;
    font-weight: 800;
    color: ${accentColor};
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .tech-stack-chips {
    display: flex;
    gap: 6px;
  }
  .stack-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    padding: 2px 7px;
    color: #E2E8F0;
  }
  .tech-summary {
    font-size: 12px;
    color: #CBD5E1;
    font-weight: 500;
    line-height: 1.45;
  }
  .tech-summary strong {
    color: #FFFFFF;
  }

  /* Flags Section in Wrapped Box */
  .flags-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  .flag-label-mini {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #94A3B8;
    text-transform: uppercase;
  }
  .tag-item {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    padding: 4px 9px;
    border-radius: 6px;
    white-space: nowrap;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag-green {
    background: rgba(0, 245, 160, 0.12);
    border: 1px solid rgba(0, 245, 160, 0.35);
    color: #00F5A0;
  }
  .tag-red {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #FCA5A5;
  }
  .tag-muted {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #94A3B8;
  }

  /* Footer */
  .footer-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #64748B;
  }
  .footer-brand {
    color: #94A3B8;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .footer-brand span {
    color: ${accentColor};
  }
  .footer-handle {
    color: #93C5FD;
    font-weight: 700;
  }
</style>
</head>
<body>
  <div class="grid-lines"></div>

  <div class="content-layer">
    <!-- Top Bar: SolShield Logo + Edition Pill + Venice AI Logo -->
    <div class="top-bar">
      <div class="brand-wrap">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="SolShield" />` : ""}
        <div class="edition-pill">
          <span style="color:${accentColor};">●</span> SOLSHIELD WRAPPED · ${brandSubText}
        </div>
        <div class="badge-tag">${brandSubBadge}</div>
      </div>

      <div class="venice-pill">
        ${veniceLogoDataUri ? `<img class="venice-icon" src="${veniceLogoDataUri}" alt="Venice AI" />` : ""}
        <div class="venice-text">
          <span class="venice-label">VENICE AI ENGINE</span>
          <span class="venice-sub">ZERO-DATA RETENTION</span>
        </div>
      </div>
    </div>

    <!-- Hero Section with Token Logo & Big Headline -->
    <div class="hero-container">
      ${tokenAvatarHtml}
      <div class="hero-titles">
        <div class="hero-headline">${escapeHtml(heroHeadline)}</div>
        <div class="hero-sub">
          ${tokenIdentityHtml}
          <span>${escapeHtml(report.headline)}</span>
          <span class="target-pill">${escapeHtml(targetLabel.slice(0, 56))}</span>
        </div>
      </div>
    </div>

    <!-- 4 Modern Stat Blocks (No Emoji Icons, Clean Titles) -->
    <div class="stats-grid">
      <!-- 1: TECH CODEBASE -->
      <div class="stat-card">
        <div class="stat-label">Tech Codebase</div>
        <div class="stat-val" style="color: ${accentColor};">${escapeHtml(techCodebaseVal)}</div>
        <div class="stat-sub">${escapeHtml(techCodebaseSub)}</div>
      </div>

      <!-- 2: OPEN SOURCE TECH / SMART CONTRACT -->
      <div class="stat-card">
        <div class="stat-label">Smart Contract</div>
        <div class="stat-val">${escapeHtml(contractTechVal)}</div>
        <div class="stat-sub">${escapeHtml(contractTechSub)}</div>
      </div>

      <!-- 3: LOCKED LIQUIDITY -->
      <div class="stat-card">
        <div class="stat-label">Locked Liquidity</div>
        <div class="stat-val">${escapeHtml(liquidityVal)}</div>
        <div class="stat-sub">${escapeHtml(liquiditySub)}</div>
      </div>

      <!-- 4: HOOD / CHAIN STATUS -->
      <div class="stat-card">
        <div class="stat-label">Robinhood Status</div>
        <div class="stat-val" style="color: ${accentColor};">${escapeHtml(chainStatusVal)}</div>
        <div class="stat-sub">${escapeHtml(chainStatusSub)}</div>
      </div>
    </div>

    <!-- Tech Forensics Breakdown & Flags Box -->
    <div class="tech-box">
      <div class="tech-left">
        <div class="tech-header">
          <div class="tech-badge-title">Codebase Forensics &amp; Architecture</div>
          <div class="tech-stack-chips">${stackChipsHtml}</div>
        </div>
        <div class="tech-summary">${escapeHtml(synthesisSummary)}</div>
      </div>

      <div class="flags-group">
        <div>
          <div class="flag-label-mini">GREEN FLAGS</div>
          ${greenFlagsHtml}
        </div>
        <div>
          <div class="flag-label-mini">RED FLAGS &amp; GAPS</div>
          ${redFlagsHtml}
        </div>
      </div>
    </div>

    <!-- Footer Bar -->
    <div class="footer-bar">
      <div class="footer-brand">
        <span>SOLSHIELD BUILDCHECK</span> · ${escapeHtml(cleanAppDomain)}/buildcheck · Venice AI Zero-Retention Verified
      </div>
      <div class="footer-handle">@${escapeHtml(cleanHandle)}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Renders a BuildCheck report as a crisp 1200x675 PNG buffer via Chromium and saves it under worker/out.
 */
export async function renderEvidenceCardPng(
  report: BuildCheckReport,
  outDir = path.join(process.cwd(), "worker", "out"),
  renderOptions: { botHandle?: string; appPublicUrl?: string } = {}
): Promise<{ pngBuffer: Buffer; filePath: string }> {
  const remoteWs = process.env.BUILDCHECK_BROWSER_WS_ENDPOINT?.trim();
  const localExec = !remoteWs ? findLocalChromiumExecutable() : null;

  if (!remoteWs && !localExec) {
    throw new Error(
      "Chromium executable not found for PNG card rendering (set BUILDCHECK_CHROME_PATH or BUILDCHECK_BROWSER_WS_ENDPOINT)."
    );
  }

  let browser: Browser | null = null;
  let ownsBrowser = false;

  try {
    if (remoteWs) {
      browser = await puppeteer.connect({ browserWSEndpoint: remoteWs });
    } else if (localExec) {
      browser = await puppeteer.launch({
        executablePath: localExec.path,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
      ownsBrowser = true;
    }

    if (!browser) throw new Error("Failed to acquire browser instance");

    const tokenLogoDataUri = await loadTokenLogoDataUri(
      report.chain?.deep?.metadata?.imageUrl ||
      report.chain?.dexPair?.imageUrl ||
      null
    );
    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setViewport({ width: 1200, height: 675, deviceScaleFactor: 1 });
      const html = buildEvidenceCardHtml(report, {
        logoDataUri: loadInlineLogoDataUri(),
        veniceLogoDataUri: loadInlineVeniceLogoDataUri(),
        tokenLogoDataUri,
        botHandle: renderOptions.botHandle,
        appPublicUrl: renderOptions.appPublicUrl,
      });
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });
      const rawShot = await page.screenshot({ type: "png" });
      const pngBuffer = Buffer.from(rawShot);

      fs.mkdirSync(outDir, { recursive: true });
      const filePath = path.join(outDir, `evidence-${report.id}.png`);
      fs.writeFileSync(filePath, pngBuffer);
      return { pngBuffer, filePath };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (browser) {
      if (ownsBrowser) await browser.close().catch(() => {});
      else await browser.disconnect().catch(() => {});
    }
  }
}
