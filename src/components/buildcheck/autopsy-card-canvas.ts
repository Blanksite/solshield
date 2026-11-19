import type { ClaimsReceiptsLedger } from "@/lib/buildcheck/claims-receipts";
import type { RugAutopsyReport } from "@/lib/buildcheck/rug-autopsy";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTruncated(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
) {
  let out = text;
  if (ctx.measureText(out).width > maxWidth) {
    while (out.length > 4 && ctx.measureText(`${out}…`).width > maxWidth) {
      out = out.slice(0, -1);
    }
    out = `${out}…`;
  }
  ctx.fillText(out, x, y);
}

function triggerPngDownload(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Generates and downloads a 1200x675 PNG card summarizing Claims vs Receipts for X.
 */
export function downloadClaimsReceiptsCardPng(ledger: ClaimsReceiptsLedger): void {
  const W = 1200;
  const H = 675;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(2, 2);

  // Obsidian backdrop
  ctx.fillStyle = "#06080E";
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 40) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, H);
    ctx.stroke();
  }
  for (let gy = 0; gy < H; gy += 40) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
  }

  // Top spectrum bar
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#2934FF");
  grad.addColorStop(0.5, "#38BDF8");
  grad.addColorStop(1, "#10B981");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 4);

  // Header
  ctx.fillStyle = "#93C5FD";
  ctx.font = "700 13px 'JetBrains Mono', monospace";
  ctx.fillText("SOLSHIELD® // CLAIMS VS RECEIPTS LEDGER", 48, 46);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 36px 'Inter', system-ui, sans-serif";
  drawTruncated(ctx, `${ledger.subjectLabel} — Promises vs Proof`, 48, 92, 820);

  // Score badge
  const scoreColor =
    ledger.receiptScorePct >= 75
      ? "#10B981"
      : ledger.receiptScorePct >= 45
        ? "#F59E0B"
        : "#EF4444";
  roundRect(ctx, 940, 34, 212, 76, 14);
  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  ctx.fill();
  ctx.strokeStyle = scoreColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#94A3B8";
  ctx.font = "700 11px 'JetBrains Mono', monospace";
  ctx.fillText("RECEIPT INTEGRITY", 960, 58);

  ctx.fillStyle = scoreColor;
  ctx.font = "800 32px 'JetBrains Mono', monospace";
  ctx.fillText(`${ledger.receiptScorePct}%`, 960, 96);

  // Counters strip
  const counters = [
    { label: "VERIFIED", val: ledger.verifiedCount, color: "#10B981" },
    { label: "CONTRADICTED", val: ledger.contradictedCount, color: "#EF4444" },
    { label: "UNVERIFIED", val: ledger.unverifiedCount, color: "#F59E0B" },
    { label: "MIXED", val: ledger.mixedCount, color: "#38BDF8" },
  ];
  counters.forEach((c, idx) => {
    const cx = 48 + idx * 280;
    roundRect(ctx, cx, 128, 264, 62, 12);
    ctx.fillStyle = "#0D111C";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#94A3B8";
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.fillText(c.label, cx + 18, 150);

    ctx.fillStyle = c.color;
    ctx.font = "800 24px 'JetBrains Mono', monospace";
    ctx.fillText(String(c.val), cx + 18, 178);
  });

  // Ledger rows (top 5)
  const rows = ledger.items.slice(0, 5);
  rows.forEach((row, idx) => {
    const ry = 214 + idx * 78;
    roundRect(ctx, 48, ry, W - 96, 66, 12);
    ctx.fillStyle = "#0B101A";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const badgeColor =
      row.status === "VERIFIED"
        ? "#10B981"
        : row.status === "CONTRADICTED"
          ? "#EF4444"
          : row.status === "MIXED"
            ? "#38BDF8"
            : "#F59E0B";

    roundRect(ctx, 64, ry + 18, 126, 28, 6);
    ctx.fillStyle = `${badgeColor}22`;
    ctx.fill();
    ctx.strokeStyle = `${badgeColor}88`;
    ctx.stroke();

    ctx.fillStyle = badgeColor;
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.fillText(row.status, 76, ry + 36);

    ctx.fillStyle = "#F8FAFC";
    ctx.font = "700 15px 'Inter', system-ui, sans-serif";
    drawTruncated(ctx, row.claim, 208, ry + 29, 920);

    ctx.fillStyle = "#94A3B8";
    ctx.font = "500 12.5px 'JetBrains Mono', monospace";
    drawTruncated(ctx, row.receipt, 208, ry + 50, 920);
  });

  // Footer
  ctx.fillStyle = "#64748B";
  ctx.font = "600 12px 'JetBrains Mono', monospace";
  ctx.fillText(
    `sol-shield.xyz/buildcheck?report=${ledger.reportId} · Zero-Retention Forensics`,
    48,
    644
  );
  ctx.fillStyle = "#93C5FD";
  ctx.fillText("@usesolshield", 1040, 644);

  triggerPngDownload(canvas, `solshield-claims-${ledger.reportId}.png`);
}

/**
 * Generates and downloads a 1200x675 PNG card summarizing the Rug Autopsy Timeline for X.
 */
export function downloadRugAutopsyCardPng(autopsy: RugAutopsyReport): void {
  const W = 1200;
  const H = 675;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(2, 2);

  const accent =
    autopsy.severity === "CRITICAL_AUTOPSY"
      ? "#EF4444"
      : autopsy.severity === "ELEVATED_RISK"
        ? "#F59E0B"
        : "#10B981";

  ctx.fillStyle = "#06080E";
  ctx.fillRect(0, 0, W, H);

  // Radial glow
  const glow = ctx.createRadialGradient(960, 120, 40, 960, 120, 560);
  glow.addColorStop(0, `${accent}26`);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Top bar
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 4);

  ctx.fillStyle = accent;
  ctx.font = "700 13px 'JetBrains Mono', monospace";
  ctx.fillText(
    `SOLSHIELD® // RUG AUTOPSY TIMELINE · ${autopsy.networkName.toUpperCase()}`,
    48,
    46
  );

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 34px 'Inter', system-ui, sans-serif";
  drawTruncated(
    ctx,
    `${autopsy.subjectLabel} — ${autopsy.classification}`,
    48,
    90,
    850
  );

  ctx.fillStyle = "#CBD5E1";
  ctx.font = "500 15px 'Inter', system-ui, sans-serif";
  drawTruncated(ctx, autopsy.headline, 48, 118, 860);

  // Trust index badge
  roundRect(ctx, 956, 34, 196, 84, 14);
  ctx.fillStyle = "#0D111C";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#94A3B8";
  ctx.font = "700 11px 'JetBrains Mono', monospace";
  ctx.fillText("TRUST INDEX", 978, 58);

  ctx.fillStyle = accent;
  ctx.font = "800 34px 'JetBrains Mono', monospace";
  ctx.fillText(`${autopsy.authenticityScore}/100`, 978, 100);

  // Key metrics row
  const metricBoxes = [
    { k: "LIQUIDITY", v: autopsy.metrics.liquidityLabel },
    { k: "EXIT / SELL TAX", v: autopsy.metrics.sellTaxLabel },
    { k: "INSIDERS + SNIPERS", v: autopsy.metrics.insiderPctLabel },
    { k: "POSSIBLE MMs", v: String(autopsy.metrics.possibleMmCount) },
    { k: "EARLY EXITS", v: String(autopsy.metrics.exitedEarlyCount) },
  ];
  metricBoxes.forEach((m, idx) => {
    const mx = 48 + idx * 224;
    roundRect(ctx, mx, 140, 212, 58, 10);
    ctx.fillStyle = "#0C101B";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#94A3B8";
    ctx.font = "700 10.5px 'JetBrains Mono', monospace";
    ctx.fillText(m.k, mx + 14, 160);

    ctx.fillStyle = "#F8FAFC";
    ctx.font = "700 18px 'JetBrains Mono', monospace";
    drawTruncated(ctx, m.v, mx + 14, 185, 184);
  });

  // Timeline steps (5 rows)
  autopsy.timeline.slice(0, 5).forEach((ev, idx) => {
    const ty = 218 + idx * 78;
    const evColor =
      ev.severity === "CRITICAL"
        ? "#EF4444"
        : ev.severity === "WARNING"
          ? "#F59E0B"
          : ev.severity === "CLEAN"
            ? "#10B981"
            : "#38BDF8";

    roundRect(ctx, 48, ty, W - 96, 66, 12);
    ctx.fillStyle = "#0B101A";
    ctx.fill();
    ctx.strokeStyle = `${evColor}44`;
    ctx.lineWidth = 1;
    ctx.stroke();

    roundRect(ctx, 64, ty + 16, 86, 32, 7);
    ctx.fillStyle = `${evColor}22`;
    ctx.fill();
    ctx.fillStyle = evColor;
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.fillText(ev.stage, 75, ty + 36);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 15px 'Inter', system-ui, sans-serif";
    drawTruncated(ctx, `${ev.phaseLabel} — ${ev.title}`, 168, ty + 29, 960);

    ctx.fillStyle = "#94A3B8";
    ctx.font = "500 12.5px 'JetBrains Mono', monospace";
    drawTruncated(ctx, ev.detail, 168, ty + 50, 960);
  });

  ctx.fillStyle = "#64748B";
  ctx.font = "600 12px 'JetBrains Mono', monospace";
  ctx.fillText(
    `sol-shield.xyz/autopsy?report=${autopsy.reportId} · Forensic Evidence Timeline`,
    48,
    644
  );
  ctx.fillStyle = "#93C5FD";
  ctx.fillText("@usesolshield", 1040, 644);

  triggerPngDownload(canvas, `solshield-autopsy-${autopsy.reportId}.png`);
}
