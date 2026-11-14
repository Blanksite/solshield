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

/**
 * Renders a 1200x675 crisp obsidian BuildCheck Evidence Card PNG containing the
 * real SolShield halftone logo, Proof Score, verdict pill, and Claims vs Reality.
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

  // Obsidian background with subtle radial cobalt accent
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#090B12");
  bg.addColorStop(1, "#05070C");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(980, 140, 20, 980, 140, 440);
  glow.addColorStop(0, "rgba(41, 52, 255, 0.22)");
  glow.addColorStop(1, "rgba(41, 52, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Subtle grid hairlines
  ctx.strokeStyle = "rgba(148, 163, 184, 0.05)";
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

  // Outer card frame
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 24, width - 48, height - 48);

  // Load SolShield halftone logo if available
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
    ctx.roundRect(54, 48, 46, 46, 8);
    ctx.clip();
    ctx.drawImage(img, 54, 48, 46, 46);
    ctx.restore();
  } catch {
    // Continue gracefully if image cannot load
  }

  // Header brand
  ctx.fillStyle = "#F8FAFC";
  ctx.font = "700 20px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("SOLSHIELD® BUILDCHECK", 114, 70);
  ctx.fillStyle = "#94A3B8";
  ctx.font = "500 13px 'JetBrains Mono', monospace";
  ctx.fillText("PROOF-OF-BUILD & ON-CHAIN FORENSIC CARD", 114, 92);

  // Verdict badge top right
  const verdictMeta =
    report.verdict === "VERIFIED_BUILD"
      ? { label: "VERIFIED BUILD", fg: "#6EE7B7", bg: "rgba(16, 185, 129, 0.18)", border: "#10B981" }
      : report.verdict === "UNPROVEN_HYPE"
        ? { label: "UNPROVEN HYPE", fg: "#FCD34D", bg: "rgba(245, 158, 11, 0.18)", border: "#F59E0B" }
        : { label: "HIGH FABRICATION RISK", fg: "#FCA5A5", bg: "rgba(239, 68, 68, 0.2)", border: "#EF4444" };

  ctx.font = "700 14px 'JetBrains Mono', monospace";
  const badgeW = ctx.measureText(verdictMeta.label).width + 34;
  ctx.fillStyle = verdictMeta.bg;
  ctx.strokeStyle = verdictMeta.border;
  ctx.beginPath();
  ctx.roundRect(width - 54 - badgeW, 50, badgeW, 34, 999);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = verdictMeta.fg;
  ctx.fillText(verdictMeta.label, width - 54 - badgeW + 17, 72);

  // Divider line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.beginPath();
  ctx.moveTo(54, 114);
  ctx.lineTo(width - 54, 114);
  ctx.stroke();

  // Score hero block
  ctx.fillStyle = "#94A3B8";
  ctx.font = "600 13px 'JetBrains Mono', monospace";
  ctx.fillText("PROOF SCORE", 54, 150);

  const scoreText = `${report.authenticityScore}`;
  ctx.fillStyle = verdictMeta.fg;
  ctx.font = "700 68px 'JetBrains Mono', monospace";
  const scoreWidth = ctx.measureText(scoreText).width;
  ctx.fillText(scoreText, 54, 222);

  ctx.fillStyle = "#64748B";
  ctx.font = "500 24px 'JetBrains Mono', monospace";
  ctx.fillText("/ 100", 54 + scoreWidth + 10, 222);

  // Target + Headline on right of score
  const targetLabel =
    report.target.githubOwnerRepo ||
    report.target.mintAddress ||
    report.target.hostname ||
    report.target.rawInput;
  ctx.fillStyle = "#93C5FD";
  ctx.font = "600 14px 'JetBrains Mono', monospace";
  ctx.fillText(`TARGET: ${targetLabel.slice(0, 62)}`, 290, 150);

  ctx.fillStyle = "#F8FAFC";
  ctx.font = "600 22px 'Plus Jakarta Sans', system-ui, sans-serif";
  wrapText(ctx, report.headline, 290, 188, width - 350, 30, 3);

  // Claims vs Proof table rows
  let rowY = 278;
  ctx.fillStyle = "#94A3B8";
  ctx.font = "600 12px 'JetBrains Mono', monospace";
  ctx.fillText("CLAIMS VS CONCRETE EVIDENCE", 54, rowY);
  rowY += 18;

  for (const row of report.claimsVsProof.slice(0, 4)) {
    ctx.fillStyle = "rgba(17, 24, 39, 0.72)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.roundRect(54, rowY, width - 108, 66, 8);
    ctx.fill();
    ctx.stroke();

    const pillColor =
      row.status === "VERIFIED"
        ? "#6EE7B7"
        : row.status === "CONTRADICTED"
          ? "#FCA5A5"
          : "#FCD34D";

    ctx.fillStyle = pillColor;
    ctx.font = "700 12px 'JetBrains Mono', monospace";
    ctx.fillText(row.status, 74, rowY + 26);

    ctx.fillStyle = "#F1F5F9";
    ctx.font = "600 15px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.fillText(row.claim.slice(0, 56), 196, rowY + 26);

    ctx.fillStyle = "#CBD5E1";
    ctx.font = "400 13px 'JetBrains Mono', monospace";
    ctx.fillText(row.evidence.slice(0, 96), 196, rowY + 49);

    rowY += 76;
  }

  // Footer
  ctx.fillStyle = "#64748B";
  ctx.font = "500 13px 'JetBrains Mono', monospace";
  ctx.fillText(
    `sol-shield.xyz/buildcheck  ·  ${
      report.inferenceMode === "venice-live-api"
        ? `Venice AI (${report.modelsUsed.join(" + ")})`
        : "Deterministic Forensic Engine"
    }  ·  Zero Data Retention`,
    54,
    height - 44
  );

  ctx.fillStyle = "#93C5FD";
  ctx.fillText("@SolShieldCheck", width - 190, height - 44);

  return canvas.toDataURL("image/png");
}
