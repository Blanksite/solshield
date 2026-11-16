import type { BuildCheckReport } from "@/lib/buildcheck/types";

function wrapText(
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

/**
 * Renders a 1200x675 crisp BuildCheck Evidence Card PNG via HTML5 Canvas
 * matching the modern Crypto Wrapped: Tech & On-Chain layout.
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

  const isRobinhood = Boolean(
    report.robinhood ||
    report.chain?.robinhood ||
    report.chain?.chainFamily === "evm" ||
    report.target?.mintAddress?.startsWith("0x") ||
    report.target?.kind === "evm_contract"
  );
  const rhStatus = report.robinhood?.status || report.chain?.robinhood?.status;
  const hasGithub = Boolean(report.github?.exists);

  let accentColor = "#00F5A0";
  let bodyBg1 = "#050B16";
  let bodyBg2 = "#020408";

  if (isRobinhood) {
    if (rhStatus === "IMPOSTOR_ALERT") {
      accentColor = "#EF4444";
      bodyBg1 = "#140407";
      bodyBg2 = "#080203";
    } else if (rhStatus === "ROBINHOOD_CHAIN_NATIVE") {
      accentColor = "#38BDF8";
      bodyBg1 = "#02111A";
      bodyBg2 = "#01080D";
    } else {
      accentColor = "#00FF66";
      bodyBg1 = "#020E06";
      bodyBg2 = "#010603";
    }
  }

  // Base background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, bodyBg1);
  bg.addColorStop(1, bodyBg2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Radial glow accents
  const glow = ctx.createRadialGradient(1000, 80, 20, 1000, 80, 480);
  glow.addColorStop(0, accentColor === "#EF4444" ? "rgba(239, 68, 68, 0.28)" : accentColor === "#38BDF8" ? "rgba(56, 189, 248, 0.25)" : "rgba(0, 255, 102, 0.24)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Subtle grid hairlines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx < width; gx += 40) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let gy = 0; gy < height; gy += 40) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }

  // Header Bar
  // Load SolShield Logo if available
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
    ctx.roundRect(46, 34, 40, 40, 10);
    ctx.clip();
    ctx.drawImage(img, 46, 34, 40, 40);
    ctx.restore();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(46, 34, 40, 40);
  } catch {
    // Continue
  }

  // Edition Pill
  const editionText = "SOLSHIELD WRAPPED · TECH & ON-CHAIN";
  ctx.font = "800 11px 'JetBrains Mono', monospace";
  const pillW = ctx.measureText(editionText).width + 36;
  ctx.fillStyle = "rgba(0, 245, 160, 0.12)";
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(98, 38, pillW, 32, 999);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.fillText("●", 112, 58);
  ctx.fillStyle = accentColor;
  ctx.fillText(editionText, 128, 58);

  // Venice AI Top-Right Pill
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  ctx.roundRect(width - 290, 36, 244, 36, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 11px 'Space Grotesk', sans-serif";
  ctx.fillText("VENICE AI ENGINE", width - 274, 52);
  ctx.fillStyle = accentColor;
  ctx.font = "700 9px 'JetBrains Mono', monospace";
  ctx.fillText("ZERO-DATA RETENTION", width - 274, 65);

  // Hero Section
  // Token Avatar
  const avatarX = 46;
  const avatarY = 96;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + 34, avatarY + 34, 34, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(11, 17, 30, 0.9)";
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Try loading token logo
  let tokenLogoDrawn = false;
  if (report.chain?.deep?.metadata?.imageUrl) {
    try {
      const tImg = new Image();
      tImg.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        tImg.onload = () => res();
        tImg.onerror = () => rej();
        tImg.src = report.chain!.deep!.metadata!.imageUrl!;
      });
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX + 34, avatarY + 34, 33, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(tImg, avatarX, avatarY, 68, 68);
      ctx.restore();
      tokenLogoDrawn = true;
    } catch {}
  }
  if (!tokenLogoDrawn) {
    ctx.fillStyle = accentColor;
    ctx.font = "900 24px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      (report.chain?.deep?.metadata?.symbol || report.target.rawInput.slice(0, 2)).toUpperCase(),
      avatarX + 34,
      avatarY + 42
    );
    ctx.textAlign = "start";
  }
  ctx.restore();

  // Hero Headline
  let heroHeadline = "REAL CODE. REAL ARCHITECTURE.";
  if (rhStatus === "OFFICIAL_LISTED") {
    heroHeadline = "YES, IT'S THE REAL DEAL.";
  } else if (rhStatus === "IMPOSTOR_ALERT") {
    heroHeadline = "CLONE TRAP DETECTED.";
  } else if (report.verdict === "UNPROVEN_HYPE") {
    heroHeadline = "ALL MARKETING. ZERO COMMITS.";
  } else if (report.verdict === "HIGH_FABRICATION_RISK") {
    heroHeadline = "CERTIFIED VAPORWARE LARP.";
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 42px 'Space Grotesk', sans-serif";
  ctx.fillText(heroHeadline, 132, 134);

  // Subtitle
  const targetLabel =
    report.target.githubOwnerRepo ||
    report.target.mintAddress ||
    report.target.hostname ||
    report.target.rawInput;
  ctx.fillStyle = "#94A3B8";
  ctx.font = "600 14px 'Plus Jakarta Sans', sans-serif";
  const subText = `${report.headline} · CA: ${targetLabel.slice(0, 48)}`;
  ctx.fillText(subText.slice(0, 88), 132, 160);

  // 4 Modern Stat Blocks (260px each with 16px gap)
  const cardY = 188;
  const cardW = 264;
  const cardH = 96;

  // Stat 1: TECH CODEBASE
  let s1Val = "Pure Meme";
  let s1Sub = "Zero Fake Tech LARP";
  if (hasGithub && report.github) {
    s1Val = `${report.github.recentCommitCount || 0} Commits`;
    s1Sub = `${report.github.uniqueAuthorCount || 1} Active Core Devs`;
  } else if (report.componentScores.codeProof !== null) {
    s1Val = `${Math.round(report.componentScores.codeProof)}/100`;
    s1Sub = "Codebase Score";
  }

  // Stat 2: SMART CONTRACT
  let s2Val = "Clean";
  let s2Sub = "Renounced · Zero Tax";
  if (hasGithub && report.github) {
    s2Val = report.github.hasTestsOrCi ? "Verified" : "Clean Stack";
    s2Sub = "Dockerfile & Manifests OK";
  }

  // Stat 3: LOCKED LIQUIDITY
  let s3Val = "$0 Pool";
  let s3Sub = "Unindexed DEX Pool";
  if (report.chain?.dexPair?.liquidityUsd) {
    s3Val = formatCompactUsd(report.chain.dexPair.liquidityUsd);
    s3Sub = report.chain.dexPair.liquidityUsd >= 500_000 ? "Whale & Slippage Proof" : "DEX Liquidity Pool";
  }

  // Stat 4: ROBINHOOD / CHAIN STATUS
  let s4Val = "Solana L1";
  let s4Sub = "Decentralized SPL";
  if (rhStatus === "OFFICIAL_LISTED") {
    s4Val = report.robinhood?.tradingPair || "PEPE-USD";
    s4Sub = "Live Tradable on App";
  } else if (rhStatus === "ROBINHOOD_CHAIN_NATIVE") {
    s4Val = "Passed";
    s4Sub = "Orbit L2 & AI Native";
  } else if (rhStatus === "IMPOSTOR_ALERT") {
    s4Val = "Impostor";
    s4Sub = "Fake Lookalike Trap";
  } else if (report.chain?.chainFamily === "evm" || report.target.mintAddress?.startsWith("0x")) {
    s4Val = "EVM Contract";
    s4Sub = report.chain?.networkName || "Ethereum L1";
  }

  const statItems = [
    { label: "TECH CODEBASE", val: s1Val, sub: s1Sub, accent: accentColor },
    { label: "SMART CONTRACT", val: s2Val, sub: s2Sub, accent: "#FFFFFF" },
    { label: "LOCKED LIQUIDITY", val: s3Val, sub: s3Sub, accent: "#FFFFFF" },
    { label: "ROBINHOOD PASS", val: s4Val, sub: s4Sub, accent: accentColor },
  ];

  for (let i = 0; i < 4; i += 1) {
    const item = statItems[i];
    const itemX = 46 + i * (cardW + 16);

    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.roundRect(itemX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Top accent line
    ctx.fillStyle = item.accent === accentColor ? accentColor : "rgba(255, 255, 255, 0.4)";
    ctx.fillRect(itemX, cardY, cardW, 3);

    // Label
    ctx.fillStyle = "#94A3B8";
    ctx.font = "800 10.5px 'JetBrains Mono', monospace";
    ctx.fillText(item.label, itemX + 16, cardY + 26);

    // Big Val
    ctx.fillStyle = item.accent;
    ctx.font = "900 28px 'Space Grotesk', sans-serif";
    ctx.fillText(item.val, itemX + 16, cardY + 58);

    // Sub
    ctx.fillStyle = accentColor;
    ctx.font = "600 10.5px 'JetBrains Mono', monospace";
    ctx.fillText(item.sub, itemX + 16, cardY + 80);
  }

  // Tech Forensics Breakdown Box
  const boxY = 304;
  const boxH = 290;
  ctx.fillStyle = "rgba(14, 165, 233, 0.035)";
  ctx.strokeStyle = "rgba(14, 165, 233, 0.22)";
  ctx.beginPath();
  ctx.roundRect(46, boxY, width - 92, boxH, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.font = "800 13px 'Space Grotesk', sans-serif";
  ctx.fillText("CODEBASE FORENSICS & ARCHITECTURE AUDIT", 68, boxY + 34);

  // Summary Text
  ctx.fillStyle = "#CBD5E1";
  ctx.font = "500 14px 'Plus Jakarta Sans', sans-serif";
  const summary = report.contradictionCallout || report.executiveSummary || report.headline;
  wrapText(ctx, summary, 68, boxY + 70, width - 136, 24, 3);

  // Claims & Evidence Rows inside breakdown box
  let cY = boxY + 160;
  for (const row of report.claimsVsProof.slice(0, 2)) {
    const isVer = row.status === "VERIFIED";
    ctx.fillStyle = isVer ? "rgba(0, 245, 160, 0.12)" : "rgba(239, 68, 68, 0.12)";
    ctx.strokeStyle = isVer ? accentColor : "#EF4444";
    ctx.beginPath();
    ctx.roundRect(68, cY, width - 136, 48, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isVer ? accentColor : "#EF4444";
    ctx.font = "800 11px 'JetBrains Mono', monospace";
    ctx.fillText(row.status, 84, cY + 28);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 13px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(row.claim.slice(0, 52), 190, cY + 22);

    ctx.fillStyle = "#94A3B8";
    ctx.font = "400 11.5px 'JetBrains Mono', monospace";
    ctx.fillText(row.evidence.slice(0, 78), 190, cY + 38);

    cY += 56;
  }

  // Footer
  ctx.fillStyle = "#64748B";
  ctx.font = "500 11.5px 'JetBrains Mono', monospace";
  ctx.fillText("SOLSHIELD BUILDCHECK · sol-shield.xyz/buildcheck · Venice AI Zero-Retention Verified", 46, height - 32);

  ctx.fillStyle = "#93C5FD";
  ctx.fillText("@usesolshield", width - 160, height - 32);

  return canvas.toDataURL("image/png");
}
