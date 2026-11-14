import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { findLocalChromiumExecutable } from "../src/lib/buildcheck/browser-agent";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadInlineLogoDataUri(): string | null {
  const logoCandidates = [
    path.join(process.cwd(), "public", "logo.png"),
    path.join(process.cwd(), "public", "favicon.png"),
  ];
  for (const cand of logoCandidates) {
    try {
      if (fs.existsSync(cand)) {
        const b64 = fs.readFileSync(cand).toString("base64");
        return `data:image/png;base64,${b64}`;
      }
    } catch {
      // Ignore unreadable asset
    }
  }
  return null;
}

/**
 * Generates static HTML (zero scripts, escaped user strings) for a 1200x675
 * SolShield BuildCheck PNG evidence card.
 */
export function buildEvidenceCardHtml(
  report: BuildCheckReport,
  logoDataUri: string | null = null
): string {
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

  const rowsHtml = report.claimsVsProof
    .slice(0, 4)
    .map((row) => {
      const pillColor =
        row.status === "VERIFIED"
          ? "#6EE7B7"
          : row.status === "CONTRADICTED"
            ? "#FCA5A5"
            : "#FCD34D";
      return `
        <div class="claim-row">
          <div class="claim-status" style="color:${pillColor};">${escapeHtml(row.status)}</div>
          <div class="claim-body">
            <div class="claim-title">${escapeHtml(row.claim.slice(0, 74))}</div>
            <div class="claim-evidence">${escapeHtml(row.evidence.slice(0, 108))}</div>
          </div>
        </div>
      `;
    })
    .join("");

  const footerMode =
    report.inferenceMode === "venice-live-api"
      ? `Venice AI (${report.modelsUsed.join(" + ")})`
      : "Deterministic Forensic Engine";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px;
    height: 675px;
    background: radial-gradient(circle at 82% 20%, rgba(41, 52, 255, 0.22), transparent 52%),
                linear-gradient(180deg, #090B12 0%, #05070C 100%);
    background-color: #07090F;
    color: #F8FAFC;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    padding: 24px;
    overflow: hidden;
  }
  .grid-overlay {
    width: 100%;
    height: 100%;
    border: 1.5px solid rgba(255, 255, 255, 0.14);
    background-image:
      linear-gradient(to right, rgba(148, 163, 184, 0.05) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(148, 163, 184, 0.05) 1px, transparent 1px);
    background-size: 40px 40px;
    padding: 26px 32px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 18px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.18);
    object-fit: cover;
  }
  .brand-title { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
  .brand-sub {
    margin-top: 2px;
    font-size: 12px;
    font-family: ui-monospace, 'Cascadia Mono', 'JetBrains Mono', monospace;
    color: #94A3B8;
  }
  .verdict-pill {
    padding: 7px 16px;
    border-radius: 999px;
    border: 1px solid ${verdictMeta.border};
    background: ${verdictMeta.bg};
    color: ${verdictMeta.fg};
    font-size: 13px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.04em;
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 36px;
    padding-top: 12px;
  }
  .score-box { min-width: 215px; }
  .score-label {
    font-size: 12px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    color: #94A3B8;
    letter-spacing: 0.08em;
  }
  .score-row { display: flex; align-items: baseline; gap: 8px; margin-top: 4px; }
  .score-val {
    font-size: 64px;
    line-height: 1;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    color: ${verdictMeta.fg};
  }
  .score-max { font-size: 22px; font-family: ui-monospace, monospace; color: #64748B; }
  .target-block { flex: 1; min-width: 0; }
  .target-uri {
    font-size: 13px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    color: #93C5FD;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .headline {
    margin-top: 8px;
    font-size: 21px;
    line-height: 1.32;
    font-weight: 600;
    color: #F8FAFC;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .claims-section { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 9px; margin-top: 8px; }
  .claims-label {
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    color: #94A3B8;
    letter-spacing: 0.08em;
    margin-bottom: 2px;
  }
  .claim-row {
    display: flex;
    align-items: center;
    gap: 18px;
    background: rgba(17, 24, 39, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 11px 18px;
  }
  .claim-status {
    width: 112px;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
  }
  .claim-body { flex: 1; min-width: 0; }
  .claim-title {
    font-size: 14px;
    font-weight: 600;
    color: #F1F5F9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .claim-evidence {
    margin-top: 3px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
    color: #CBD5E1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-family: ui-monospace, monospace;
    color: #64748B;
    padding-top: 10px;
  }
  .footer-handle { color: #93C5FD; font-weight: 600; }
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
        <div class="verdict-pill">${escapeHtml(verdictMeta.label)}</div>
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
          <div class="target-uri">TARGET: ${escapeHtml(targetLabel.slice(0, 68))}</div>
          <div class="headline">${escapeHtml(report.headline)}</div>
        </div>
      </div>
    </div>

    <div class="claims-section">
      <div class="claims-label">CLAIMS VS CONCRETE EVIDENCE</div>
      ${rowsHtml || '<div class="claim-row"><div class="claim-status">INFO</div><div class="claim-title">Forensic evidence recorded on BuildCheck</div></div>'}
    </div>

    <div class="footer">
      <div>sol-shield.xyz/buildcheck  ·  ${escapeHtml(footerMode)}  ·  Zero Data Retention</div>
      <div class="footer-handle">@SolShieldCheck</div>
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
  outDir = path.join(process.cwd(), "worker", "out")
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

    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setViewport({ width: 1200, height: 675, deviceScaleFactor: 1 });
      const html = buildEvidenceCardHtml(report, loadInlineLogoDataUri());
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
