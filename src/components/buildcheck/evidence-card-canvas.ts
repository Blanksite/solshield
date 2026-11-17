import type { BuildCheckReport } from "@/lib/buildcheck/types";

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 2
): number {
  const words = text.split(/\s+/);
  let line = "";
  let linesDrawn = 0;

  for (let i = 0; i < words.length; i += 1) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      linesDrawn += 1;
      if (linesDrawn >= maxLines) {
        ctx.fillText(`${line}...`, x, y);
        return y + lineHeight;
      }
      ctx.fillText(line, x, y);
      line = words[i];
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function formatCompactUsd(val: number | null | undefined): string {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return "$0";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

function shortenMiddle(raw: string, head = 7, tail = 5): string {
  const s = raw.trim();
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

/**
 * Renders a crisp 1200x675 SolShield Evidence Card V3 ("Forensic Dossier / Terminal Proof")
 * PNG via HTML5 Canvas, synchronized visually with the X & Telegram Bot card renderer.
 */
export async function generateBuildCheckEvidencePng(
  report: BuildCheckReport
): Promise<string> {
  const width = 1200;
  const height = 675;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

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

  // Obsidian background
  ctx.fillStyle = "#06070B";
  ctx.fillRect(0, 0, width, height);

  // Subtle Cobalt top-left & Verdict top-right atmospheric glow
  const cobaltGlow = ctx.createRadialGradient(140, 60, 10, 140, 60, 520);
  cobaltGlow.addColorStop(0, "rgba(41, 52, 255, 0.22)");
  cobaltGlow.addColorStop(1, "rgba(6, 7, 11, 0)");
  ctx.fillStyle = cobaltGlow;
  ctx.fillRect(0, 0, width, height);

  const verdictGlow = ctx.createRadialGradient(1060, 90, 10, 1060, 90, 480);
  verdictGlow.addColorStop(0, accentGlow);
  verdictGlow.addColorStop(1, "rgba(6, 7, 11, 0)");
  ctx.fillStyle = verdictGlow;
  ctx.fillRect(0, 0, width, height);

  // Subtle dot matrix
  ctx.fillStyle = "rgba(148, 163, 184, 0.12)";
  for (let dx = 24; dx < width; dx += 24) {
    for (let dy = 24; dy < height; dy += 24) {
      ctx.fillRect(dx, dy, 1.2, 1.2);
    }
  }

  // Top 4px Classification Strip
  const topStrip = ctx.createLinearGradient(0, 0, width, 0);
  topStrip.addColorStop(0, "#2934FF");
  topStrip.addColorStop(1, accentColor);
  ctx.fillStyle = topStrip;
  ctx.fillRect(0, 0, width, 4);

  // Header Bar
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject();
      img.src = "/logo.png?v=2";
    });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(40, 24, 36, 36, 9);
    ctx.clip();
    ctx.drawImage(img, 40, 24, 36, 36);
    ctx.restore();
    ctx.strokeStyle = "rgba(41, 52, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(40, 24, 36, 36, 9);
    ctx.stroke();
  } catch {
    // ignore
  }

  ctx.font = "800 12px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#E2E8F0";
  ctx.fillText("SOLSHIELD", 88, 46);
  ctx.fillStyle = "#7D95FF";
  ctx.fillText("// BUILDCHECK", 164, 46);

  const chainHeaderTag = isHoodChain
    ? "ROBINHOOD CHAIN L2 · ID 4663"
    : evmSec
      ? `${evmSec.networkName.toUpperCase()} · ERC-20`
      : isEvm
        ? `${(report.chain?.networkName || "EVM").toUpperCase()} · ERC-20`
        : report.chain?.mintAddress
          ? `SOLANA · ${report.chain.tokenReport?.tokenProgram?.toUpperCase() || "SPL"}`
          : "GITHUB / DAPP FORENSICS";

  ctx.font = "700 11px 'JetBrains Mono', monospace";
  const chainPillW = ctx.measureText(chainHeaderTag).width + 24;
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(272, 29, chainPillW, 26, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accentColor;
  ctx.fillText(chainHeaderTag, 284, 46);

  // Venice AI Header Badge
  ctx.fillStyle = "rgba(13, 16, 23, 0.9)";
  ctx.strokeStyle = "rgba(41, 52, 255, 0.38)";
  ctx.beginPath();
  ctx.roundRect(width - 236, 24, 196, 36, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 10.5px 'Space Grotesk', sans-serif";
  ctx.fillText("VENICE AI ENGINE", width - 220, 40);
  ctx.fillStyle = "#93C5FD";
  ctx.font = "700 9px 'JetBrains Mono', monospace";
  ctx.fillText("ZERO-DATA RETENTION", width - 220, 53);

  // Hero Dossier Card
  const heroY = 76;
  const heroH = 148;
  ctx.fillStyle = "#0D1017";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.beginPath();
  ctx.roundRect(40, heroY, width - 80, heroH, 14);
  ctx.fill();
  ctx.stroke();

  // Avatar
  const avX = 60;
  const avY = heroY + 40;
  ctx.fillStyle = "#07080D";
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(avX, avY, 68, 68, 14);
  ctx.fill();
  ctx.stroke();

  let logoDrawn = false;
  const tokenLogoUrl =
    report.chain?.deep?.metadata?.imageUrl ||
    report.chain?.dexPair?.imageUrl ||
    null;
  if (tokenLogoUrl) {
    try {
      const tImg = new Image();
      tImg.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        tImg.onload = () => res();
        tImg.onerror = () => rej();
        tImg.src = tokenLogoUrl;
      });
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(avX + 1, avY + 1, 66, 66, 13);
      ctx.clip();
      ctx.drawImage(tImg, avX + 1, avY + 1, 66, 66);
      ctx.restore();
      logoDrawn = true;
    } catch {
      // ignore
    }
  }
  if (!logoDrawn) {
    const mono = (
      report.chain?.deep?.metadata?.symbol ||
      report.chain?.tokenReport?.symbol ||
      report.target.rawInput
    )
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 2)
      .toUpperCase() || "TK";
    ctx.fillStyle = "#F8FAFC";
    ctx.font = "800 24px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(mono, avX + 34, avY + 42);
    ctx.textAlign = "start";
  }

  // Hero Left Metadata & Headline
  const metaX = 146;
  ctx.font = "800 10.5px 'JetBrains Mono', monospace";
  const vBadgeW = ctx.measureText(verdictBadgeText).width + 18;
  ctx.fillStyle = accentGlow;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(metaX, heroY + 20, vBadgeW, 22, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accentColor;
  ctx.fillText(verdictBadgeText, metaX + 9, heroY + 35);

  const tokenSym =
    report.chain?.deep?.metadata?.symbol || report.chain?.tokenReport?.symbol;
  const tokenName =
    report.chain?.deep?.metadata?.name || report.chain?.tokenReport?.name;
  const tokenLabel = tokenName && tokenSym
    ? `${tokenName} ($${tokenSym})`
    : tokenSym
      ? `$${tokenSym}`
      : "";
  let nextKickerX = metaX + vBadgeW + 12;
  if (tokenLabel) {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 13.5px 'Plus Jakarta Sans', sans-serif";
    const clippedTok = tokenLabel.slice(0, 26);
    ctx.fillText(clippedTok, nextKickerX, heroY + 36);
    nextKickerX += ctx.measureText(clippedTok).width + 10;
  }

  const targetLabel =
    report.target.githubOwnerRepo ||
    report.target.mintAddress ||
    report.target.hostname ||
    report.target.rawInput;
  const shortTarget =
    targetLabel.startsWith("0x") || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(targetLabel)
      ? shortenMiddle(targetLabel, 7, 5)
      : targetLabel.slice(0, 34);
  ctx.font = "700 11px 'JetBrains Mono', monospace";
  const tPillW = ctx.measureText(shortTarget).width + 16;
  ctx.fillStyle = "rgba(41, 52, 255, 0.16)";
  ctx.strokeStyle = "rgba(41, 52, 255, 0.42)";
  ctx.beginPath();
  ctx.roundRect(nextKickerX, heroY + 21, tPillW, 21, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#93C5FD";
  ctx.fillText(shortTarget, nextKickerX + 8, heroY + 35);

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
  if (evmSec?.honeypotStatus === "HONEYPOT") heroHeadline = "HONEYPOT TRAP DETECTED.";
  else if (rhStatus === "IMPOSTOR_ALERT" || rhStatus === "TICKER_CLONE_WARNING") {
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

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 34px 'Space Grotesk', sans-serif";
  ctx.fillText(heroHeadline, metaX, heroY + 80);

  ctx.fillStyle = "#CBD5E1";
  ctx.font = "500 13.5px 'Plus Jakarta Sans', sans-serif";
  wrapTextLines(ctx, report.headline, metaX, heroY + 106, 760, 19, 2);

  // Score Stamp Module (Right)
  const scX = width - 275;
  const scY = heroY + 16;
  const scW = 215;
  const scH = 116;
  ctx.fillStyle = "#07080D";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.beginPath();
  ctx.roundRect(scX, scY, scW, scH, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.fillRect(scX, scY + 4, 3, scH - 8);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "800 10px 'JetBrains Mono', monospace";
  ctx.fillText("TRUST INDEX", scX + 16, scY + 22);

  ctx.fillStyle = accentColor;
  ctx.font = "800 44px 'Space Grotesk', sans-serif";
  const scoreStr = String(score);
  ctx.fillText(scoreStr, scX + 16, scY + 66);
  const scoreStrW = ctx.measureText(scoreStr).width;
  ctx.fillStyle = "#64748B";
  ctx.font = "700 14px 'JetBrains Mono', monospace";
  ctx.fillText("/ 100", scX + 22 + scoreStrW, scY + 64);

  const filledTicks = Math.max(0, Math.min(10, Math.round(score / 10)));
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i < filledTicks ? accentColor : "rgba(255,255,255,0.10)";
    ctx.beginPath();
    ctx.roundRect(scX + 16 + i * 18.2, scY + 78, 15, 6, 2);
    ctx.fill();
  }
  ctx.fillStyle = accentColor;
  ctx.font = "800 10px 'JetBrains Mono', monospace";
  ctx.fillText(scoreSubLabel, scX + 16, scY + 102);

  // Lower Two-Column Forensic Matrix
  const bodyY = 238;
  const bodyH = 382;
  const leftW = 440;
  const rightX = 40 + leftW + 16;
  const rightW = width - rightX - 40;

  // Left Panel
  ctx.fillStyle = "#0D1017";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.beginPath();
  ctx.roundRect(40, bodyY, leftW, bodyH, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#93C5FD";
  ctx.font = "800 10.5px 'JetBrains Mono', monospace";
  ctx.fillText("ON-CHAIN & BUILD MATRIX", 60, bodyY + 26);
  ctx.fillStyle = "#64748B";
  ctx.fillText("MULTI-CHAIN", 40 + leftW - 96, bodyY + 26);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(60, bodyY + 38);
  ctx.lineTo(40 + leftW - 20, bodyY + 38);
  ctx.stroke();

  // Compute Left Rows
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
      row2Sub = `Sell Blocked${evmSec.sellTaxPct !== null ? ` (${evmSec.sellTaxPct}% Tax)` : ""}`;
      row2Color = "#EF4444";
    } else if (evmSec.honeypotStatus === "HIGH_TAX") {
      row2Val = `${evmSec.buyTaxPct ?? 0}% / ${evmSec.sellTaxPct ?? 0}% Tax`;
      row2Sub = `${evmSec.isProxy ? evmSec.proxyType || "Proxy" : "Non-Proxy"} · High Fee`;
      row2Color = "#F59E0B";
    } else {
      row2Val =
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
      row2Sub = `${proxyTag} · ${ownerTag}`;
      row2Color = evmSec.verdict === "CAUTION" ? "#F59E0B" : "#10B981";
    }
  } else if (report.chain?.tokenReport) {
    const tok = report.chain.tokenReport;
    if (tok.riskScore >= 55) {
      row2Val = `Risk ${tok.riskScore}/100`;
      row2Sub = tok.mintAuthority ? "Mint Authority ACTIVE" : "Inspect Token Flags";
      row2Color = "#EF4444";
    } else {
      row2Val = isEvm ? "ERC-20 Clean" : "Clean SPL";
      row2Sub = isEvm ? "On-Chain Bytecode Verified" : "Mint & Freeze Revoked";
    }
  }

  let row3Val = "No DEX Pool";
  let row3Sub = "Unindexed Liquidity";
  let row3Color = "#94A3B8";
  if (report.chain?.dexPair?.liquidityUsd && report.chain.dexPair.liquidityUsd > 0) {
    const liq = report.chain.dexPair.liquidityUsd;
    row3Val = formatCompactUsd(liq);
    const dexLabel = (report.chain.dexPair.dexId || "DEX")
      .replace(/[-_]+/g, " ")
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
    row3Sub = `${dexLabel} Pool Depth`;
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
    row4Val = `Top-5 ${top5.toFixed(1)}%`;
    row4Sub = `Verdict: ${report.chain.deep.holders.verdict}`;
    row4Color = top5 >= 45 ? "#EF4444" : top5 >= 25 ? "#F59E0B" : "#10B981";
  }

  const matrixRows = [
    { label: "CODE / PRODUCT", val: row1Val, sub: row1Sub, color: row1Color },
    { label: "CONTRACT SECURITY", val: row2Val, sub: row2Sub, color: row2Color },
    { label: "DEX LIQUIDITY", val: row3Val, sub: row3Sub, color: row3Color },
    { label: row4Label, val: row4Val, sub: row4Sub, color: row4Color },
  ];

  let ry = bodyY + 68;
  for (let i = 0; i < matrixRows.length; i++) {
    const r = matrixRows[i];
    ctx.fillStyle = "#94A3B8";
    ctx.font = "800 10.5px 'JetBrains Mono', monospace";
    ctx.fillText(r.label, 60, ry);
    ctx.fillStyle = "#CBD5E1";
    ctx.font = "500 12px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(r.sub.slice(0, 34), 60, ry + 20);

    ctx.fillStyle = r.color;
    ctx.font = "800 19px 'Space Grotesk', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(r.val.slice(0, 22), 40 + leftW - 20, ry + 14);
    ctx.textAlign = "start";

    if (i < matrixRows.length - 1) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.beginPath();
      ctx.moveTo(60, ry + 36);
      ctx.lineTo(40 + leftW - 20, ry + 36);
      ctx.stroke();
    }
    ry += 78;
  }

  // Right Panel
  ctx.fillStyle = "#0D1017";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.beginPath();
  ctx.roundRect(rightX, bodyY, rightW, bodyH, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#93C5FD";
  ctx.font = "800 10.5px 'JetBrains Mono', monospace";
  ctx.fillText("EVIDENCE & RISK BREAKDOWN", rightX + 20, bodyY + 26);
  ctx.fillStyle = "#64748B";
  ctx.fillText("LIVE AUDIT", rightX + rightW - 84, bodyY + 26);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(rightX + 20, bodyY + 38);
  ctx.lineTo(rightX + rightW - 20, bodyY + 38);
  ctx.stroke();

  ctx.fillStyle = "#CBD5E1";
  ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
  const summary =
    report.contradictionCallout || report.executiveSummary || report.headline;
  wrapTextLines(ctx, summary, rightX + 20, bodyY + 64, rightW - 40, 20, 3);

  const colW = (rightW - 52) / 2;
  const flagY = bodyY + 142;

  ctx.fillStyle = "#94A3B8";
  ctx.font = "800 10px 'JetBrains Mono', monospace";
  ctx.fillText("GREEN FLAGS", rightX + 20, flagY);
  ctx.fillText("RED FLAGS & GAPS", rightX + 32 + colW, flagY);

  const greens = (report.verifiedSignals ?? []).filter(Boolean).slice(0, 2);
  const reds = (report.keyRedFlags ?? []).filter(Boolean).slice(0, 2);

  const drawFlagBox = (
    items: string[],
    fx: number,
    tone: "green" | "red",
    fallback: string
  ) => {
    let fy = flagY + 12;
    const rows = items.length > 0 ? items : [fallback];
    for (const item of rows) {
      const isMuted = items.length === 0;
      ctx.fillStyle = isMuted
        ? "rgba(255,255,255,0.03)"
        : tone === "green"
          ? "rgba(16,185,129,0.11)"
          : "rgba(239,68,68,0.12)";
      ctx.strokeStyle = isMuted
        ? "rgba(255,255,255,0.09)"
        : tone === "green"
          ? "rgba(16,185,129,0.34)"
          : "rgba(239,68,68,0.38)";
      ctx.beginPath();
      ctx.roundRect(fx, fy, colW, 64, 7);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isMuted
        ? "#94A3B8"
        : tone === "green"
          ? "#A7F3D0"
          : "#FECACA";
      ctx.font = "600 12px 'Plus Jakarta Sans', sans-serif";
      const prefix = isMuted ? "" : tone === "green" ? "✓ " : "! ";
      wrapTextLines(ctx, `${prefix}${item.slice(0, 96)}`, fx + 10, fy + 22, colW - 20, 17, 2);
      fy += 74;
    }
  };

  drawFlagBox(greens, rightX + 20, "green", "No strong green flags recorded yet");
  drawFlagBox(reds, rightX + 32 + colW, "red", "No critical red flags detected");

  // Proof Stack footer inside right box
  ctx.fillStyle = "#94A3B8";
  ctx.font = "800 10px 'JetBrains Mono', monospace";
  ctx.fillText("PROOF STACK", rightX + 20, bodyY + bodyH - 22);

  const chips: string[] = [];
  if (evmSec) chips.push("ERC-20", evmSec.verificationBasis);
  else if (isEvm) chips.push("EVM ERC-20");
  else chips.push(report.chain?.tokenReport?.tokenProgram || "Solana SPL");
  if (isHoodChain) chips.push("Orbit L2");

  let cx = rightX + 120;
  for (const ch of Array.from(new Set(chips)).slice(0, 3)) {
    ctx.font = "700 10.5px 'JetBrains Mono', monospace";
    const cw = ctx.measureText(ch).width + 16;
    ctx.fillStyle = "rgba(41, 52, 255, 0.14)";
    ctx.strokeStyle = "rgba(41, 52, 255, 0.36)";
    ctx.beginPath();
    ctx.roundRect(cx, bodyY + bodyH - 36, cw, 22, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#C7D2FE";
    ctx.fillText(ch, cx + 8, bodyY + bodyH - 21);
    cx += cw + 8;
  }

  // Bottom Footer Bar
  ctx.fillStyle = "#93C5FD";
  ctx.font = "700 11px 'JetBrains Mono', monospace";
  ctx.fillText(`sol-shield.xyz/buildcheck?report=${report.id}`, 40, height - 20);
  ctx.fillStyle = "#64748B";
  ctx.fillText(" · Venice Zero-Retention Verified", 40 + ctx.measureText(`sol-shield.xyz/buildcheck?report=${report.id}`).width, height - 20);

  ctx.fillStyle = "#2934FF";
  ctx.beginPath();
  ctx.roundRect(width - 148, height - 35, 108, 22, 5);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 11px 'JetBrains Mono', monospace";
  ctx.fillText("@usesolshield", width - 139, height - 20);

  return canvas.toDataURL("image/png");
}
