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

function shortenMiddle(raw: string, head = 8, tail = 6): string {
  const s = raw.trim();
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

function buildScoreTicksHtml(score: number, accentColor: string): string {
  const filledCount = Math.max(0, Math.min(10, Math.round(score / 10)));
  let html = "";
  for (let i = 0; i < 10; i++) {
    const active = i < filledCount;
    html += `<span class="score-tick" style="background:${
      active ? accentColor : "rgba(255,255,255,0.10)"
    };"></span>`;
  }
  return html;
}

/**
 * Generates static HTML (zero scripts, escaped user strings) for a 1200x675
 * SolShield BuildCheck PNG evidence card V3 ("Forensic Dossier / Terminal Proof")
 * with Venice AI Zero-Retention branding and full Multi-Chain / EVM Honeypot telemetry.
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

  const evmSec = report.chain?.evmSecurity ?? null;
  const rh = report.robinhood || report.chain?.robinhood || null;
  const rhStatus = rh?.status;
  const isEvm = Boolean(
    evmSec ||
      report.chain?.chainFamily === "evm" ||
      report.target?.mintAddress?.startsWith("0x") ||
      report.target?.kind === "evm_contract" ||
      rh?.chainFamily === "evm"
  );
  const isHoodChain = rhStatus === "ROBINHOOD_CHAIN_NATIVE";
  const hasGithub = Boolean(report.github?.exists);
  const score = Math.max(0, Math.min(100, Math.round(report.authenticityScore || 0)));

  const isCriticalTrap =
    rhStatus === "IMPOSTOR_ALERT" ||
    rhStatus === "TICKER_CLONE_WARNING" ||
    evmSec?.honeypotStatus === "HONEYPOT" ||
    evmSec?.verdict === "CRITICAL" ||
    report.verdict === "HIGH_FABRICATION_RISK" ||
    score < 45;

  const isCaution =
    !isCriticalTrap &&
    (report.verdict === "UNPROVEN_HYPE" ||
      evmSec?.verdict === "CAUTION" ||
      score < 70);

  let accentColor = "#10B981";
  let accentGlow = "rgba(16, 185, 129, 0.20)";
  let verdictBadgeText = "VERIFIED BUILD";
  let scoreSubLabel = "CLEAN POSTURE";

  if (isCriticalTrap) {
    accentColor = "#EF4444";
    accentGlow = "rgba(239, 68, 68, 0.25)";
    verdictBadgeText =
      evmSec?.honeypotStatus === "HONEYPOT"
        ? "HONEYPOT TRAP"
        : rhStatus === "IMPOSTOR_ALERT"
          ? "IMPOSTOR ALERT"
          : "HIGH RISK DETECTED";
    scoreSubLabel = "DO NOT TRUST";
  } else if (isCaution) {
    accentColor = "#F59E0B";
    accentGlow = "rgba(245, 158, 11, 0.20)";
    verdictBadgeText = "CAUTION · UNPROVEN";
    scoreSubLabel = "VERIFY BEFORE BUY";
  } else if (isHoodChain) {
    accentColor = "#38BDF8";
    accentGlow = "rgba(56, 189, 248, 0.22)";
    verdictBadgeText = "VERIFIED · ORBIT L2";
    scoreSubLabel = "ROBINHOOD L2 CLEAN";
  } else if (rhStatus === "OFFICIAL_LISTED") {
    accentColor = "#10B981";
    accentGlow = "rgba(16, 185, 129, 0.22)";
    verdictBadgeText = "OFFICIAL LISTING";
    scoreSubLabel = "ROBINHOOD VERIFIED";
  }

  const chainHeaderTag = isHoodChain
    ? "ROBINHOOD CHAIN L2 · ID 4663"
    : evmSec
      ? `${evmSec.networkName.toUpperCase()} · ERC-20`
      : isEvm
        ? `${(report.chain?.networkName || "EVM").toUpperCase()} · ERC-20`
        : report.chain?.mintAddress
          ? `SOLANA · ${report.chain.tokenReport?.tokenProgram?.toUpperCase() || "SPL"}`
          : "GITHUB / DAPP FORENSICS";

  const targetLabel =
    report.target.githubOwnerRepo ||
    report.target.mintAddress ||
    report.target.hostname ||
    report.target.rawInput;
  const shortTargetDisplay =
    targetLabel.startsWith("0x") || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(targetLabel)
      ? shortenMiddle(targetLabel, 7, 5)
      : targetLabel.slice(0, 34);
  const tokenIdentity = formatTokenIdentityLabel(report, 26);
  const tokenIdentityHtml = tokenIdentity
    ? `<span class="token-name-tag">${escapeHtml(tokenIdentity)}</span>`
    : "";
  const tokenAvatarHtml = safeTokenLogoDataUri
    ? `<div class="token-avatar"><img class="token-avatar-img" src="${escapeHtml(safeTokenLogoDataUri)}" alt="" /></div>`
    : report.target.kind === "token_ca" || Boolean(tokenIdentity)
      ? `<div class="token-avatar token-avatar-fallback">${escapeHtml(extractTokenMonogram(report))}</div>`
      : "";

  const hasLiveDapp = Boolean(
    (report.browser &&
      (report.browser.totalXhrObserved > 0 ||
        (report.browser.inspectedApiPayloads &&
          report.browser.inspectedApiPayloads.length > 0))) ||
      (report.claimsVsProof &&
        report.claimsVsProof.some(
          (c) =>
            c.status === "VERIFIED" &&
            /product|marketplace|api|platform|dapp|app/i.test(c.claim)
        ))
  );

  const commitCount = report.github?.recentCommitCount || 0;
  let heroHeadline = "VERIFIED CODE & INFRA.";
  if (evmSec?.honeypotStatus === "HONEYPOT") {
    heroHeadline = "HONEYPOT TRAP DETECTED.";
  } else if (rhStatus === "IMPOSTOR_ALERT" || rhStatus === "TICKER_CLONE_WARNING") {
    heroHeadline = "FAKE BRAND LOOKALIKE TRAP.";
  } else if (report.verdict === "HIGH_FABRICATION_RISK") {
    heroHeadline = "CRITICAL VAPORWARE RISK.";
  } else if (isCaution) {
    heroHeadline =
      commitCount > 0 || hasLiveDapp
        ? "EARLY BUILD. LIMITED PROOF."
        : "UNVERIFIED HYPE. NO CODE PROOF.";
  } else if (rhStatus === "OFFICIAL_LISTED") {
    heroHeadline = "VERIFIED OFFICIAL ASSET.";
  } else if (hasGithub || hasLiveDapp) {
    heroHeadline = "REAL CODE. LIVE INFRA.";
  } else {
    heroHeadline = "CLEAN ON-CHAIN CONTRACT.";
  }

  let row1Val = "Pure Meme";
  let row1Sub = "No Fake Tech Claims";
  let row1Color = "#E2E8F0";
  if (hasGithub && report.github) {
    row1Val = commitCount > 0 ? `${commitCount} Commits` : "Active Repo";
    const ageStr =
      report.github.ageDays !== null ? ` · ${report.github.ageDays}d age` : "";
    row1Sub = `${report.github.uniqueAuthorCount || 1} Core Dev${
      (report.github.uniqueAuthorCount || 1) > 1 ? "s" : ""
    }${ageStr}`;
    row1Color = report.github.ageDays !== null && report.github.ageDays <= 3 ? "#F59E0B" : "#10B981";
  } else if (hasLiveDapp) {
    const xhrCount =
      report.browser?.totalXhrObserved ||
      report.browser?.inspectedApiPayloads?.length ||
      0;
    row1Val = xhrCount > 0 ? "Live dApp" : "Verified App";
    row1Sub = xhrCount > 0 ? `${xhrCount} Live API Calls` : "Working Web Execution";
    row1Color = accentColor;
  } else if (isCaution || isCriticalTrap) {
    row1Val = "No Repo";
    row1Sub = "0 Verified GitHub Commits";
    row1Color = "#F59E0B";
  }

  let row2Val = "Clean Contract";
  let row2Sub = "No Critical Backdoors";
  let row2Color = "#10B981";
  if (evmSec) {
    if (evmSec.honeypotStatus === "HONEYPOT") {
      row2Val = "HONEYPOT";
      row2Sub = `Sell Blocked${
        evmSec.sellTaxPct !== null ? ` (${evmSec.sellTaxPct}% Tax)` : ""
      }`;
      row2Color = "#EF4444";
    } else if (evmSec.honeypotStatus === "HIGH_TAX") {
      row2Val = `${evmSec.buyTaxPct ?? 0}% / ${evmSec.sellTaxPct ?? 0}% Tax`;
      row2Sub = `${evmSec.isProxy ? evmSec.proxyType || "Proxy" : "Non-Proxy"} · High Fee`;
      row2Color = "#F59E0B";
    } else {
      const hpTag =
        evmSec.honeypotStatus === "SELLABLE"
          ? `SELLABLE (${evmSec.buyTaxPct ?? 0}%/${evmSec.sellTaxPct ?? 0}%)`
          : "Bytecode Clean";
      const proxyTag = evmSec.isProxy ? `${evmSec.proxyType || "Proxy"}` : "Non-Proxy";
      const ownerTag =
        evmSec.ownershipRenounced === true
          ? "Renounced"
          : evmSec.ownershipRenounced === false
            ? "Active Owner"
            : "No owner()";
      row2Val = hpTag;
      row2Sub = `${proxyTag} · ${ownerTag}`;
      row2Color = evmSec.verdict === "CAUTION" ? "#F59E0B" : "#10B981";
    }
  } else if (report.chain?.tokenReport) {
    const tok = report.chain.tokenReport;
    if (tok.riskScore >= 55) {
      row2Val = `Risk ${tok.riskScore}/100`;
      row2Sub = tok.mintAuthority ? "Mint Authority ACTIVE" : "Inspect Token Flags";
      row2Color = "#EF4444";
    } else if (isEvm) {
      row2Val = "ERC-20 Clean";
      row2Sub = "On-Chain Bytecode Verified";
      row2Color = "#10B981";
    } else {
      row2Val = "Clean SPL";
      row2Sub = "Mint & Freeze Revoked";
      row2Color = "#10B981";
    }
  } else if (hasGithub && report.github) {
    row2Val = report.github.hasTestsOrCi ? "CI & Tests OK" : "No CI Pipeline";
    row2Sub = report.github.topLevelFiles.slice(0, 2).join(" · ") || "Repo Inspected";
    row2Color = report.github.hasTestsOrCi ? "#10B981" : "#94A3B8";
  }

  let row3Val = "No DEX Pool";
  let row3Sub = "Unindexed Liquidity";
  let row3Color = "#94A3B8";
  if (report.chain?.dexPair?.liquidityUsd && report.chain.dexPair.liquidityUsd > 0) {
    const liq = report.chain.dexPair.liquidityUsd;
    row3Val = formatCompactUsd(liq);
    const lpLock = report.chain.deep?.market?.lpLockedPct;
    const lpNote =
      typeof lpLock === "number" && lpLock > 0
        ? ` · ${lpLock.toFixed(0)}% Locked`
        : " Pool Depth";
    const dexLabel = (report.chain.dexPair.dexId || "DEX")
      .replace(/[-_]+/g, " ")
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
    row3Sub = `${dexLabel}${lpNote}`;
    row3Color = liq >= 25_000 ? "#10B981" : liq >= 5_000 ? "#F8FAFC" : "#F59E0B";
  }

  let row4Label = "HOLDERS / CABAL";
  let row4Val = "Distributed";
  let row4Sub = "Low Whale Concentration";
  let row4Color = "#E2E8F0";

  if (
    rhStatus === "OFFICIAL_LISTED" ||
    rhStatus === "ROBINHOOD_CHAIN_NATIVE" ||
    rhStatus === "IMPOSTOR_ALERT" ||
    rhStatus === "TICKER_CLONE_WARNING"
  ) {
    row4Label = "ROBINHOOD CHECK";
    if (rhStatus === "OFFICIAL_LISTED") {
      row4Val = rh?.tradingPair || "LISTED";
      row4Sub = "Official Tradable Asset";
      row4Color = "#10B981";
    } else if (rhStatus === "ROBINHOOD_CHAIN_NATIVE") {
      row4Val = isCriticalTrap ? "Flagged L2" : "Orbit L2 Native";
      row4Sub = "Deployed on Chain 4663";
      row4Color = isCriticalTrap ? "#EF4444" : "#38BDF8";
    } else {
      row4Val = "IMPOSTOR";
      row4Sub = "Unauthorized Clone Alert";
      row4Color = "#EF4444";
    }
  } else if (report.chain?.deep?.holders) {
    const top5 = report.chain.tokenReport?.top5Pct ?? 0;
    const snipers = report.chain.deep.holders.distribution?.snipersPct ?? 0;
    row4Val = `Top-5 ${top5.toFixed(1)}%`;
    row4Sub =
      snipers > 0
        ? `Snipers ${snipers.toFixed(1)}% · ${report.chain.deep.holders.verdict}`
        : `Verdict: ${report.chain.deep.holders.verdict}`;
    row4Color =
      report.chain.deep.holders.verdict === "RIGGED" || top5 >= 45
        ? "#EF4444"
        : top5 >= 25
          ? "#F59E0B"
          : "#10B981";
  } else if (hasGithub && report.github) {
    row4Label = "GITHUB TRACTION";
    row4Val = `★ ${report.github.stars.toLocaleString("en-US")}`;
    row4Sub = `${report.github.forks} Forks · ${
      report.github.isFork ? "Forked Repo" : "Original Repo"
    }`;
  }

  const proofChips: string[] = [];
  if (report.github?.topLanguages?.length) {
    proofChips.push(...report.github.topLanguages.slice(0, 2));
  }
  if (evmSec) {
    proofChips.push("ERC-20", evmSec.verificationBasis);
  } else if (isEvm) {
    proofChips.push("EVM ERC-20");
  } else if (report.chain?.tokenReport) {
    proofChips.push(report.chain.tokenReport.tokenProgram);
  }
  if (isHoodChain) proofChips.push("Orbit L2");
  if (proofChips.length === 0) proofChips.push("Venice Zero-Retention");
  const stackChipsHtml = Array.from(new Set(proofChips))
    .slice(0, 4)
    .map((chip) => `<span class="stack-chip">${escapeHtml(chip)}</span>`)
    .join("");

  const synthesisSummary =
    report.contradictionCallout ||
    report.executiveSummary ||
    report.headline;

  const verifiedSignals = (report.verifiedSignals ?? []).filter(Boolean).slice(0, 2);
  const keyRedFlags = (report.keyRedFlags ?? []).filter(Boolean).slice(0, 2);

  const greenFlagsHtml =
    verifiedSignals.length > 0
      ? verifiedSignals
          .map(
            (s) =>
              `<div class="tag-item tag-green"><span class="tag-icon">✓</span><span>${escapeHtml(
                s.slice(0, 118)
              )}</span></div>`
          )
          .join("")
      : `<div class="tag-item tag-muted">No strong green flags recorded yet</div>`;

  const redFlagsHtml =
    keyRedFlags.length > 0
      ? keyRedFlags
          .map(
            (f) =>
              `<div class="tag-item tag-red"><span class="tag-icon">!</span><span>${escapeHtml(
                f.slice(0, 118)
              )}</span></div>`
          )
          .join("")
      : `<div class="tag-item tag-muted">No critical red flags detected</div>`;

  const scoreTicksHtml = buildScoreTicksHtml(score, accentColor);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@500;700;800&family=Space+Grotesk:wght@700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px;
    height: 675px;
    background:
      radial-gradient(circle at 12% 8%, rgba(41, 52, 255, 0.22), transparent 44%),
      radial-gradient(circle at 90% 14%, ${accentGlow}, transparent 42%),
      #06070B;
    color: #F4F6FB;
    font-family: 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif;
    padding: 26px 40px 22px 40px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .top-classification-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, #2934FF 0%, ${accentColor} 100%);
    z-index: 5;
  }
  .dot-matrix {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px);
    background-size: 24px 24px;
    opacity: 0.45;
    pointer-events: none;
    z-index: 1;
  }
  .content-layer {
    position: relative;
    z-index: 2;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* Header Bar */
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
    width: 36px;
    height: 36px;
    border-radius: 9px;
    border: 1.5px solid rgba(41, 52, 255, 0.7);
    background: #0A0C12;
    object-fit: cover;
  }
  .brand-kicker {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #E2E8F0;
  }
  .brand-kicker span {
    color: #7D95FF;
  }
  .chain-pill {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
    font-weight: 700;
    color: ${accentColor};
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    padding: 5px 11px;
    letter-spacing: 0.06em;
  }

  .venice-pill {
    display: flex;
    align-items: center;
    gap: 9px;
    background: rgba(13, 16, 23, 0.9);
    border: 1px solid rgba(41, 52, 255, 0.38);
    border-radius: 8px;
    padding: 6px 13px;
  }
  .venice-icon {
    height: 18px;
    width: auto;
  }
  .venice-text {
    display: flex;
    flex-direction: column;
  }
  .venice-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 10.5px;
    font-weight: 800;
    color: #FFFFFF;
    letter-spacing: 0.06em;
  }
  .venice-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    color: #93C5FD;
    letter-spacing: 0.08em;
  }

  /* Hero Section: Identity + Big Score Module */
  .hero-row {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 18px;
    padding: 16px 20px;
    border-radius: 14px;
    background: #0D1017;
    border: 1px solid rgba(255, 255, 255, 0.09);
  }
  .hero-left {
    display: flex;
    align-items: center;
    gap: 18px;
    flex: 1;
    min-width: 0;
  }
  .token-avatar {
    width: 68px;
    height: 68px;
    border-radius: 14px;
    border: 2px solid ${accentColor};
    background: #07080D;
    overflow: hidden;
    flex-shrink: 0;
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
    background: linear-gradient(135deg, rgba(41, 52, 255, 0.32), ${accentGlow});
    color: #F8FAFC;
    font-size: 24px;
    font-weight: 800;
    font-family: 'Space Grotesk', sans-serif;
  }
  .hero-meta {
    flex: 1;
    min-width: 0;
  }
  .hero-kicker-line {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: nowrap;
    margin-bottom: 5px;
  }
  .verdict-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 3px 9px;
    border-radius: 5px;
    background: ${accentGlow};
    border: 1px solid ${accentColor};
    color: ${accentColor};
    flex-shrink: 0;
  }
  .token-name-tag {
    font-size: 13.5px;
    font-weight: 800;
    color: #FFFFFF;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .target-pill {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 11px;
    font-weight: 700;
    color: #93C5FD;
    background: rgba(41, 52, 255, 0.16);
    border: 1px solid rgba(41, 52, 255, 0.42);
    padding: 2px 8px;
    border-radius: 5px;
    flex-shrink: 0;
  }
  .hero-headline {
    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
    font-size: 35px;
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.06;
    color: #FFFFFF;
  }
  .hero-sub {
    margin-top: 6px;
    font-size: 13.5px;
    color: #CBD5E1;
    font-weight: 500;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Hero Score Stamp */
  .score-box {
    width: 215px;
    flex-shrink: 0;
    background: #07080D;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-left: 3px solid ${accentColor};
    border-radius: 10px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .score-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #94A3B8;
  }
  .score-num-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin: 2px 0;
  }
  .score-num {
    font-family: 'Space Grotesk', monospace;
    font-size: 46px;
    font-weight: 800;
    line-height: 1;
    color: ${accentColor};
    font-variant-numeric: tabular-nums;
  }
  .score-denom {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    font-weight: 700;
    color: #64748B;
  }
  .score-ticks {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 3px;
    margin: 4px 0;
  }
  .score-tick {
    height: 6px;
    border-radius: 2px;
  }
  .score-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: ${accentColor};
  }

  /* Asymmetric 2-Column Forensic Body */
  .dossier-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 440px 1fr;
    gap: 16px;
  }
  .panel {
    background: #0D1017;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 14px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .panel-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: #93C5FD;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* Left Matrix Rows */
  .matrix-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-top: 8px;
  }
  .matrix-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 0;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
  }
  .matrix-row:last-child {
    border-bottom: none;
    padding-bottom: 2px;
  }
  .matrix-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .matrix-k {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.09em;
    color: #94A3B8;
  }
  .matrix-sub {
    font-size: 12px;
    color: #CBD5E1;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 245px;
  }
  .matrix-v {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 20px;
    font-weight: 800;
    text-align: right;
    white-space: nowrap;
  }

  /* Right Evidence & Flags Column */
  .evidence-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 10px;
    padding-top: 10px;
    min-height: 0;
  }
  .forensic-summary {
    font-size: 13px;
    line-height: 1.45;
    color: #CBD5E1;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .flags-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .flag-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flag-label-mini {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.09em;
    color: #94A3B8;
    text-transform: uppercase;
  }
  .tag-item {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.35;
    padding: 8px 10px;
    border-radius: 7px;
    display: flex;
    align-items: flex-start;
    gap: 7px;
  }
  .tag-icon {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 800;
    flex-shrink: 0;
  }
  .tag-green {
    background: rgba(16, 185, 129, 0.11);
    border: 1px solid rgba(16, 185, 129, 0.34);
    color: #A7F3D0;
  }
  .tag-red {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.38);
    color: #FECACA;
  }
  .tag-muted {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.09);
    color: #94A3B8;
  }
  .stack-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  .tech-stack-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .stack-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 700;
    background: rgba(41, 52, 255, 0.12);
    border: 1px solid rgba(41, 52, 255, 0.32);
    border-radius: 5px;
    padding: 3px 8px;
    color: #C7D2FE;
  }

  /* Footer */
  .footer-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #64748B;
  }
  .footer-brand {
    color: #94A3B8;
    font-weight: 700;
  }
  .footer-brand span {
    color: #93C5FD;
  }
  .footer-handle {
    color: #FFFFFF;
    background: #2934FF;
    padding: 3px 10px;
    border-radius: 5px;
    font-weight: 800;
    font-size: 11px;
  }
</style>
</head>
<body data-target="${escapeHtml(targetLabel)}">
  <div class="top-classification-bar"></div>
  <div class="dot-matrix"></div>

  <div class="content-layer">
    <!-- Header Bar -->
    <div class="top-bar">
      <div class="brand-wrap">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="SolShield" />` : ""}
        <div class="brand-kicker">SOLSHIELD <span>// BUILDCHECK</span></div>
        <div class="chain-pill">${escapeHtml(chainHeaderTag)}</div>
      </div>

      <div class="venice-pill">
        ${veniceLogoDataUri ? `<img class="venice-icon" src="${veniceLogoDataUri}" alt="Venice AI" />` : ""}
        <div class="venice-text">
          <span class="venice-label">VENICE AI ENGINE</span>
          <span class="venice-sub">ZERO-DATA RETENTION</span>
        </div>
      </div>
    </div>

    <!-- Hero Dossier + Score Stamp -->
    <div class="hero-row">
      <div class="hero-left">
        ${tokenAvatarHtml}
        <div class="hero-meta">
          <div class="hero-kicker-line">
            <span class="verdict-chip">${escapeHtml(verdictBadgeText)}</span>
            ${tokenIdentityHtml}
            <span class="target-pill" title="${escapeHtml(targetLabel)}">${escapeHtml(shortTargetDisplay)}</span>
          </div>
          <div class="hero-headline">${escapeHtml(heroHeadline)}</div>
          <div class="hero-sub">${escapeHtml(report.headline)}</div>
        </div>
      </div>

      <div class="score-box">
        <div class="score-label">TRUST INDEX</div>
        <div class="score-num-row">
          <span class="score-num">${score}</span>
          <span class="score-denom">/ 100</span>
        </div>
        <div class="score-ticks">${scoreTicksHtml}</div>
        <div class="score-sub">${escapeHtml(scoreSubLabel)}</div>
      </div>
    </div>

    <!-- Asymmetric 2-Column Forensic Body -->
    <div class="dossier-grid">
      <!-- Left Column: On-Chain & Build Matrix -->
      <div class="panel">
        <div class="panel-title">
          <span>ON-CHAIN &amp; BUILD MATRIX</span>
          <span style="color:#64748B;">MULTI-CHAIN</span>
        </div>
        <div class="matrix-list">
          <div class="matrix-row">
            <div class="matrix-left">
              <span class="matrix-k">CODE / PRODUCT</span>
              <span class="matrix-sub">${escapeHtml(row1Sub)}</span>
            </div>
            <span class="matrix-v" style="color:${row1Color};">${escapeHtml(row1Val)}</span>
          </div>

          <div class="matrix-row">
            <div class="matrix-left">
              <span class="matrix-k">CONTRACT SECURITY</span>
              <span class="matrix-sub">${escapeHtml(row2Sub)}</span>
            </div>
            <span class="matrix-v" style="color:${row2Color};">${escapeHtml(row2Val)}</span>
          </div>

          <div class="matrix-row">
            <div class="matrix-left">
              <span class="matrix-k">DEX LIQUIDITY</span>
              <span class="matrix-sub">${escapeHtml(row3Sub)}</span>
            </div>
            <span class="matrix-v" style="color:${row3Color};">${escapeHtml(row3Val)}</span>
          </div>

          <div class="matrix-row">
            <div class="matrix-left">
              <span class="matrix-k">${escapeHtml(row4Label)}</span>
              <span class="matrix-sub">${escapeHtml(row4Sub)}</span>
            </div>
            <span class="matrix-v" style="color:${row4Color};">${escapeHtml(row4Val)}</span>
          </div>
        </div>
      </div>

      <!-- Right Column: Synthesis & Flags -->
      <div class="panel">
        <div class="panel-title">
          <span>EVIDENCE &amp; RISK BREAKDOWN</span>
          <span style="color:#64748B;">LIVE AUDIT</span>
        </div>
        <div class="evidence-body">
          <div class="forensic-summary">${escapeHtml(synthesisSummary)}</div>

          <div class="flags-grid">
            <div class="flag-col">
              <div class="flag-label-mini">GREEN FLAGS</div>
              ${greenFlagsHtml}
            </div>
            <div class="flag-col">
              <div class="flag-label-mini">RED FLAGS &amp; GAPS</div>
              ${redFlagsHtml}
            </div>
          </div>

          <div class="stack-row">
            <span class="flag-label-mini">PROOF STACK</span>
            <div class="tech-stack-chips">${stackChipsHtml}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer Bar -->
    <div class="footer-bar">
      <div class="footer-brand">
        <span>${escapeHtml(cleanAppDomain)}/buildcheck?report=${escapeHtml(report.id)}</span> · Venice Zero-Retention Verified
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
