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

/**
 * Generates static HTML (zero scripts, escaped user strings) for a 1200x675
 * SolShield BuildCheck PNG evidence card with Venice AI Zero-Retention branding.
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

  const verdictMeta =
    report.verdict === "VERIFIED_BUILD"
      ? { label: "VERIFIED BUILD", fg: "#6EE7B7", bg: "rgba(16,185,129,0.16)", border: "#10B981" }
      : report.verdict === "UNPROVEN_HYPE"
        ? { label: "UNPROVEN HYPE", fg: "#FCD34D", bg: "rgba(245,158,11,0.16)", border: "#F59E0B" }
        : { label: "HIGH FABRICATION RISK", fg: "#FCA5A5", bg: "rgba(239,68,68,0.18)", border: "#EF4444" };

  const targetLabel =
    report.target.githubOwnerRepo ||
    report.target.mintAddress ||
    report.target.hostname ||
    report.target.rawInput;

  const targetKindLabel = report.target.kind.replace(/_/g, " ").toUpperCase();
  const tokenIdentity = formatTokenIdentityLabel(report, 26);
  const tokenIdentityHtml = tokenIdentity
    ? `<span class="token-name-tag">${escapeHtml(tokenIdentity)}</span>`
    : "";
  const tokenAvatarHtml = safeTokenLogoDataUri
    ? `<div class="token-avatar"><img class="token-avatar-img" src="${escapeHtml(safeTokenLogoDataUri)}" alt="" /></div>`
    : report.target.kind === "token_ca" || Boolean(tokenIdentity)
      ? `<div class="token-avatar token-avatar-fallback">${escapeHtml(extractTokenMonogram(report))}</div>`
      : "";

  const rowsHtml = report.claimsVsProof
    .slice(0, 3)
    .map((row) => {
      const pillColor =
        row.status === "VERIFIED"
          ? "#6EE7B7"
          : row.status === "CONTRADICTED"
            ? "#FCA5A5"
            : "#FCD34D";
      const pillBorder =
        row.status === "VERIFIED"
          ? "rgba(16,185,129,0.35)"
          : row.status === "CONTRADICTED"
            ? "rgba(239,68,68,0.35)"
            : "rgba(245,158,11,0.35)";
      return `
        <div class="claim-row">
          <div class="claim-status" style="color:${pillColor};border-color:${pillBorder};">${escapeHtml(row.status)}</div>
          <div class="claim-body">
            <div class="claim-title">${escapeHtml(row.claim.slice(0, 78))}</div>
            <div class="claim-evidence">${escapeHtml(row.evidence.slice(0, 114))}</div>
          </div>
        </div>
      `;
    })
    .join("");

  const footerMode =
    report.inferenceMode === "venice-live-api"
      ? `Venice AI (${report.modelsUsed.join(" + ")})`
      : "Deterministic Forensic Engine";

  const veniceTag =
    report.inferenceMode === "venice-live-api"
      ? "VENICE AI · ZERO RETENTION"
      : "ZERO DATA RETENTION";

  const chipsHtml = [
    formatScoreChip("CODE", report.componentScores.codeProof),
    formatScoreChip("CHAIN", report.componentScores.chainProof),
    formatScoreChip("WEB", report.componentScores.domainProof),
    ...(report.componentScores.holdersProof !== undefined &&
    report.componentScores.holdersProof !== null
      ? [formatScoreChip("HOLDERS", report.componentScores.holdersProof)]
      : [formatScoreChip("ALIGN", report.componentScores.claimAlignment)]),
  ].join("");

  const flagsHtml = `
    <div class="flags-section">
      ${renderFlagColumnHtml(
        "GREEN FLAGS",
        report.verifiedSignals ?? [],
        "green",
        "No strong green flags recorded yet"
      )}
      ${renderFlagColumnHtml(
        "RED FLAGS & GAPS",
        report.keyRedFlags ?? [],
        "red",
        "No critical red flags detected"
      )}
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px;
    height: 675px;
    background: radial-gradient(circle at 86% 16%, rgba(41, 52, 255, 0.25), transparent 50%),
                radial-gradient(circle at 14% 88%, rgba(224, 90, 45, 0.14), transparent 44%),
                linear-gradient(180deg, #090B12 0%, #05070C 100%);
    background-color: #06080E;
    color: #F8FAFC;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    padding: 22px;
    overflow: hidden;
  }
  .grid-overlay {
    width: 100%;
    height: 100%;
    border: 1.5px solid rgba(255, 255, 255, 0.14);
    border-radius: 14px;
    background-image:
      linear-gradient(to right, rgba(148, 163, 184, 0.045) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
    background-size: 40px 40px;
    padding: 20px 28px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 11px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo {
    width: 42px;
    height: 42px;
    border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.18);
    object-fit: cover;
  }
  .brand-title { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
  .brand-sub {
    margin-top: 2px;
    font-size: 11px;
    font-family: ui-monospace, 'Cascadia Mono', 'JetBrains Mono', monospace;
    color: #94A3B8;
    letter-spacing: 0.05em;
  }
  .header-badges {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .venice-pill {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid rgba(224, 90, 45, 0.42);
    background: rgba(224, 90, 45, 0.1);
    color: #FDBA74;
    font-size: 11px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.04em;
  }
  .venice-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }
  .verdict-pill {
    padding: 7px 16px;
    border-radius: 999px;
    border: 1px solid ${verdictMeta.border};
    background: ${verdictMeta.bg};
    color: ${verdictMeta.fg};
    font-size: 12.5px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.05em;
  }
  .hero {
    display: flex;
    align-items: flex-start;
    gap: 24px;
    padding-top: 12px;
  }
  .score-box {
    min-width: 204px;
    background: rgba(15, 23, 42, 0.56);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 12px 18px;
  }
  .score-label {
    font-size: 11px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    color: #94A3B8;
    letter-spacing: 0.08em;
  }
  .score-row { display: flex; align-items: baseline; gap: 6px; margin-top: 4px; }
  .score-val {
    font-size: 54px;
    line-height: 1;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    color: ${verdictMeta.fg};
  }
  .score-max { font-size: 19px; font-family: ui-monospace, monospace; color: #64748B; }
  .target-block { flex: 1; min-width: 0; }
  .target-top {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .target-main {
    flex: 1;
    min-width: 0;
  }
  .token-avatar {
    width: 56px;
    height: 56px;
    border-radius: 12px;
    border: 1px solid rgba(110, 231, 183, 0.35);
    background: rgba(15, 23, 42, 0.88);
    flex-shrink: 0;
    overflow: hidden;
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
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(41, 52, 255, 0.24));
    border-color: rgba(110, 231, 183, 0.44);
    color: #6EE7B7;
    font-size: 19px;
    font-weight: 800;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.04em;
  }
  .target-meta {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .kind-tag {
    padding: 3px 8px;
    border-radius: 5px;
    background: rgba(41, 52, 255, 0.2);
    border: 1px solid rgba(99, 102, 241, 0.45);
    color: #C7D2FE;
    font-size: 10.5px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    flex-shrink: 0;
  }
  .token-name-tag {
    padding: 3px 9px;
    border-radius: 5px;
    background: rgba(20, 241, 149, 0.14);
    border: 1px solid rgba(110, 231, 183, 0.42);
    color: #6EE7B7;
    font-size: 11px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    flex-shrink: 0;
    max-width: 270px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .target-uri {
    min-width: 0;
    flex: 1;
    font-size: 12.5px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    color: #93C5FD;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .headline {
    margin-top: 5px;
    font-size: 18.5px;
    line-height: 1.28;
    font-weight: 600;
    color: #F8FAFC;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .metrics-bar {
    display: flex;
    gap: 9px;
    margin-top: 9px;
  }
  .metric-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    border-radius: 7px;
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(255,255,255,0.1);
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .metric-label { color: #94A3B8; font-weight: 600; }
  .metric-value { font-weight: 700; }
  .middle-sections {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
    margin-top: 10px;
    min-height: 0;
  }
  .claims-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .claims-label {
    font-size: 10.5px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    color: #94A3B8;
    letter-spacing: 0.08em;
    margin-bottom: 1px;
  }
  .claim-row {
    display: flex;
    align-items: center;
    gap: 14px;
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9px;
    padding: 8px 14px;
  }
  .claim-status {
    width: 108px;
    text-align: center;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(2, 6, 23, 0.65);
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
  }
  .claim-body { flex: 1; min-width: 0; }
  .claim-title {
    font-size: 13.5px;
    font-weight: 600;
    color: #F1F5F9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .claim-evidence {
    margin-top: 2px;
    font-size: 11.5px;
    font-family: ui-monospace, monospace;
    color: #CBD5E1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flags-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .flag-card {
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9px;
    padding: 9px 14px;
    min-width: 0;
  }
  .flag-card-green {
    border-color: rgba(16, 185, 129, 0.28);
    background: linear-gradient(180deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.76));
  }
  .flag-card-red {
    border-color: rgba(239, 68, 68, 0.28);
    background: linear-gradient(180deg, rgba(239, 68, 68, 0.08), rgba(15, 23, 42, 0.76));
  }
  .flag-header {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 10.5px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.08em;
    margin-bottom: 6px;
  }
  .flag-header-green { color: #6EE7B7; }
  .flag-header-red { color: #FCA5A5; }
  .flag-badge {
    width: 15px;
    height: 15px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 800;
  }
  .flag-badge-green {
    background: rgba(16, 185, 129, 0.22);
    color: #6EE7B7;
    border: 1px solid rgba(16, 185, 129, 0.45);
  }
  .flag-badge-red {
    background: rgba(239, 68, 68, 0.22);
    color: #FCA5A5;
    border: 1px solid rgba(239, 68, 68, 0.45);
  }
  .flag-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .flag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 12px;
    line-height: 1.35;
    color: #E2E8F0;
  }
  .flag-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .flag-dot-green { background: #34D399; }
  .flag-dot-red { background: #F87171; }
  .flag-text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flag-empty {
    font-size: 11.5px;
    font-family: ui-monospace, monospace;
    color: #64748B;
    line-height: 1.35;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    font-family: ui-monospace, monospace;
    color: #94A3B8;
    padding-top: 9px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .footer-handle { color: #93C5FD; font-weight: 700; }
</style>
</head>
<body>
  <div class="grid-overlay">
    <div>
      <div class="header">
        <div class="brand">
          ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="SolShield" />` : ""}
          <div>
            <div class="brand-title">SOLSHIELD® BUILDCHECK</div>
            <div class="brand-sub">PROOF-OF-BUILD &amp; ON-CHAIN FORENSIC CARD</div>
          </div>
        </div>
        <div class="header-badges">
          <div class="venice-pill">
            ${veniceLogoDataUri ? `<img class="venice-icon" src="${veniceLogoDataUri}" alt="Venice" />` : ""}
            <span>${escapeHtml(veniceTag)}</span>
          </div>
          <div class="verdict-pill">${escapeHtml(verdictMeta.label)}</div>
        </div>
      </div>

      <div class="hero">
        <div class="score-box">
          <div class="score-label">PROOF SCORE</div>
          <div class="score-row">
            <span class="score-val">${report.authenticityScore}</span>
            <span class="score-max">/ 100</span>
          </div>
        </div>
        <div class="target-block">
          <div class="target-top">
            ${tokenAvatarHtml}
            <div class="target-main">
              <div class="target-meta">
                <span class="kind-tag">${escapeHtml(targetKindLabel)}</span>
                ${tokenIdentityHtml}
                <span class="target-uri">${escapeHtml(targetLabel.slice(0, 56))}</span>
              </div>
              <div class="headline">${escapeHtml(report.headline)}</div>
            </div>
          </div>
          <div class="metrics-bar">${chipsHtml}</div>
        </div>
      </div>
    </div>

    <div class="middle-sections">
      <div class="claims-section">
        <div class="claims-label">CLAIMS VS CONCRETE EVIDENCE</div>
        ${rowsHtml || '<div class="claim-row"><div class="claim-status">INFO</div><div class="claim-title">Forensic evidence recorded on BuildCheck</div></div>'}
      </div>

      ${flagsHtml}
    </div>

    <div class="footer">
      <div>${escapeHtml(cleanAppDomain)}/buildcheck  ·  ${escapeHtml(footerMode)}  ·  ${escapeHtml(report.privacyAttestation || "Zero Data Retention")}</div>
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
      report.chain?.deep?.metadata?.imageUrl
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
      await page.setContent(html, { waitUntil: "load" });
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
