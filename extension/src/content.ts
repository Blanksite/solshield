import type { ExtensionVerdict } from "../../src/lib/extension-verdict";
import brandLogoDataUrl from "../public/icons/icon48.png";
import type {
  InterceptDecisionResponse,
  InterceptRequestPayload,
  ProviderProtectionStatus,
  VerdictHistoryEntry,
} from "./types";

(() => {
  const WIN = window as unknown as Record<string, unknown>;
  if (WIN.__SOLSHIELD_CONTENT_ACTIVE__) return;
  WIN.__SOLSHIELD_CONTENT_ACTIVE__ = true;

  let activePort: MessagePort | null = null;
  let handshakeAcked = false;
  let overlayQueue: Promise<unknown> = Promise.resolve();

  function enqueueOverlay<T>(task: () => Promise<T>): Promise<T> {
    const run = overlayQueue.then(task, task);
    overlayQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function setupMessageChannel() {
    if (handshakeAcked) return;
    const channel = new MessageChannel();
    const port1 = channel.port1;
    port1.onmessage = (event: MessageEvent) => {
      void handleInjectedMessage(event.data, port1);
    };
    window.postMessage({ source: "SOLSHIELD_PORT_INIT" }, "*", [channel.port2]);
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.data?.source === "SOLSHIELD_MAIN_READY" && !handshakeAcked) {
      setupMessageChannel();
    }
  });

  setupMessageChannel();

  async function handleInjectedMessage(data: unknown, sourcePort: MessagePort) {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;

    if (msg.type === "SOLSHIELD_PORT_ACK") {
      handshakeAcked = true;
      activePort = sourcePort;
      return;
    }

    if (msg.type === "SOLSHIELD_PROVIDER_STATUS") {
      const status = msg.status as ProviderProtectionStatus;
      try {
        await chrome.runtime.sendMessage({
          type: "SOLSHIELD_PROVIDER_STATUS",
          status,
        });
      } catch {
        // Ignore if service worker is inactive on non-wallet tabs
      }
      return;
    }

    if (msg.type === "SOLSHIELD_INTERCEPT_REQUEST") {
      const payload = msg.payload as InterceptRequestPayload;
      const decision = await processInterceptRequest(payload);
      const replyPort = sourcePort || activePort;
      replyPort?.postMessage({
        type: "SOLSHIELD_INTERCEPT_DECISION",
        ...decision,
      });
    }
  }

  async function processInterceptRequest(
    payload: InterceptRequestPayload
  ): Promise<InterceptDecisionResponse> {
    try {
      const auditResponse = await chrome.runtime.sendMessage<{
        ok: boolean;
        bypass?: boolean;
        verdict?: ExtensionVerdict;
        error?: string;
      }>({
        type: "SOLSHIELD_RUN_AUDIT",
        payload,
      });

      if (auditResponse?.bypass) {
        return {
          requestId: payload.requestId,
          allow: true,
          userAction: "APPROVED",
          verdict: auditResponse.verdict as ExtensionVerdict,
        };
      }

      if (!auditResponse?.ok || !auditResponse.verdict) {
        throw new Error(auditResponse?.error || "Extension audit failed.");
      }

      const verdict = auditResponse.verdict;

      // For wallet connect() / eth_requestAccounts, allow silently if Domain Guard & reputation report SAFE
      const isConnectOnly =
        payload.walletMethod === "connect" ||
        payload.walletMethod === "eth_requestAccounts" ||
        payload.walletMethod === "wallet_requestPermissions";
      if (
        isConnectOnly &&
        verdict.decision === "SAFE" &&
        !verdict.timeoutUnverified
      ) {
        return {
          requestId: payload.requestId,
          allow: true,
          userAction: "APPROVED",
          verdict,
        };
      }

      // Show Closed Shadow DOM interactive confirmation modal (serialized via queue)
      const allow = await enqueueOverlay(() =>
        showSolShieldOverlay(payload, verdict)
      );
      const userAction = allow ? "APPROVED" : "REJECTED";

      const historyEntry: VerdictHistoryEntry = {
        id: payload.requestId,
        timestamp: Date.now(),
        hostname: verdict.domainEvaluation.hostname,
        walletMethod: payload.walletMethod,
        decision: verdict.decision,
        riskScore: verdict.riskScore,
        headline: verdict.headline,
        apiVerified: verdict.apiVerified,
        timeoutUnverified: verdict.timeoutUnverified,
        userAction,
        txCount: verdict.txCount,
      };

      void chrome.runtime
        .sendMessage({ type: "SOLSHIELD_RECORD_HISTORY", entry: historyEntry })
        .catch(() => {});

      return {
        requestId: payload.requestId,
        allow,
        userAction,
        verdict,
        errorMessage: allow
          ? undefined
          : `SolShield Guard blocked/rejected transaction (${verdict.decision}).`,
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "SolShield Guard internal error";
      return {
        requestId: payload.requestId,
        allow: false,
        userAction: "REJECTED",
        verdict: {
          decision: "BLOCK",
          riskScore: 85,
          headline: "SOLSHIELD GUARD COMMUNICATION ERROR",
          requiresTypedConfirmation: true,
          apiVerified: false,
          timeoutUnverified: true,
          walletMethod: payload.walletMethod,
          txCount: payload.base64Transactions?.length ?? 0,
          domainEvaluation: {
            hostname: payload.hostname,
            status: "UNVERIFIED",
            riskScore: 40,
            riskLevel: "MEDIUM",
            isAllowlisted: false,
            isPunycode: false,
            closestVerifiedBrand: null,
            matchedVerifiedDomain: null,
            reasons: [msg],
          },
          localReports: [],
          balanceDiffs: [],
          tokenAudits: [],
          reasons: [msg],
          veniceSummary: null,
          privacyAttestation: "Local safety fallback triggered.",
        },
        errorMessage: msg,
      };
    }
  }

  function escapeHtml(raw: string): string {
    return raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showSolShieldOverlay(
    payload: InterceptRequestPayload,
    verdict: ExtensionVerdict
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const existing = document.getElementById("solshield-guard-overlay-root");
      if (existing) existing.remove();

      const host = document.createElement("div");
      host.id = "solshield-guard-overlay-root";
      host.style.cssText =
        "all: initial; position: fixed; inset: 0; z-index: 2147483647;";

      const shadow = host.attachShadow({ mode: "closed" });

      const badgeColor =
        verdict.decision === "BLOCK"
          ? "#EF4444"
          : verdict.decision === "WARNING"
          ? "#F59E0B"
          : "#10B981";
      const badgeBg =
        verdict.decision === "BLOCK"
          ? "rgba(239, 68, 68, 0.14)"
          : verdict.decision === "WARNING"
          ? "rgba(245, 158, 11, 0.14)"
          : "rgba(16, 185, 129, 0.14)";

      const domainBadgeLabel =
        verdict.domainEvaluation.status === "VERIFIED"
          ? `VERIFIED · ${verdict.domainEvaluation.closestVerifiedBrand ?? "Trusted"}`
          : verdict.domainEvaluation.status === "DEV_LOCAL"
          ? "DEV LOCALHOST"
          : verdict.domainEvaluation.status;

      const diffsHtml =
        verdict.balanceDiffs.length > 0
          ? verdict.balanceDiffs
              .map((diff) => {
                const isIn = diff.direction === "IN";
                const sign = isIn ? "+" : "-";
                const color = isIn ? "#34D399" : "#F87171";
                const tag = diff.isToken2022 ? " [Token-2022]" : "";
                return `<div class="diff-row">
                  <span class="diff-asset">${escapeHtml(diff.asset + tag)}</span>
                  <span class="diff-amt" style="color:${color}">${sign}${Math.abs(
                  diff.deltaUiAmount
                ).toFixed(4)}</span>
                </div>`;
              })
              .join("")
          : `<div class="muted-note">No measurable balance change decoded locally/on-chain.</div>`;

      const tokenAuditHtml =
        verdict.tokenAudits.length > 0
          ? `<div class="section">
              <div class="section-title">Token Mint Security</div>
              ${verdict.tokenAudits
                .map(
                  (t) =>
                    `<div class="token-row">
                      <span>${escapeHtml(t.symbol || t.mintAddress.slice(0, 8))}</span>
                      <span class="pill pill-${escapeHtml(
                        t.classification.toLowerCase()
                      )}">${escapeHtml(t.classification)} · ${t.riskScore}/100</span>
                    </div>`
                )
                .join("")}
            </div>`
          : "";

      const reasonsHtml = verdict.reasons
        .slice(0, 6)
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("");

      const veniceBlock = verdict.veniceSummary
        ? `<div class="section venice-box">
            <div class="section-title">Venice AI Intelligence Summary</div>
            <p class="venice-text">${escapeHtml(vericeSafe(verdict.veniceSummary))}</p>
          </div>`
        : "";

      const unverifiedBanner = verdict.timeoutUnverified
        ? `<div class="unverified-banner">
            Belum terverifikasi server SolShield — keputusan memakai inspeksi lokal & Domain Guard saja.
          </div>`
        : "";

      const evmSummaryHtml = verdict.evmReport
        ? `<div class="section">
            <div class="section-title">Decoded EVM Payload (${escapeHtml(
              verdict.evmReport.chainIdHex || "EVM"
            )})</div>
            <div class="diff-row">
              <span>Action</span>
              <span style="font-family: ui-monospace, monospace; color:#93C5FD;">${escapeHtml(
                verdict.evmReport.summary.slice(0, 56)
              )}</span>
            </div>
            ${
              verdict.evmReport.spenderDetected
                ? `<div class="diff-row">
                    <span>Spender</span>
                    <span style="font-family: ui-monospace, monospace; color:#FCA5A5;">${escapeHtml(
                      verdict.evmReport.spenderDetected
                    )}</span>
                  </div>`
                : ""
            }
          </div>`
        : "";

      const allowInputHtml = verdict.requiresTypedConfirmation
        ? `<div class="allow-gate">
            <label for="solsh-allow-input">Transaksi diblokir karena risiko CRITICAL/HIGH. Ketik <strong>ALLOW</strong> untuk membuka tombol lanjut:</label>
            <input id="solsh-allow-input" type="text" autocomplete="off" spellcheck="false" placeholder="Ketik ALLOW" />
          </div>`
        : "";

      shadow.innerHTML = `
        <style>
          * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .backdrop {
            position: fixed; inset: 0;
            background: rgba(4, 7, 15, 0.78);
            backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
            padding: 16px;
          }
          .modal {
            width: 100%; max-width: 470px; max-height: 92vh; overflow-y: auto;
            background: #0B101B;
            color: #F1F5F9;
            border: 1px solid rgba(41, 52, 255, 0.45);
            border-radius: 16px;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255,255,255,0.04);
            padding: 16px 18px;
          }
          .header { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
          .brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 13.5px; letter-spacing: 0.05em; color: #E2E8F0; }
          .brand-logo { width: 24px; height: 24px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.22); object-fit: cover; background: #09090B; flex-shrink: 0; }
          .meta-tag { font-size: 11px; font-family: ui-monospace, monospace; background: #141C2E; border: 1px solid #26314A; color: #94A3B8; padding: 4px 8px; border-radius: 999px; }
          .verdict-card {
            background: ${badgeBg};
            border: 1px solid ${badgeColor};
            border-radius: 12px; padding: 11px 12px; margin-bottom: 10px;
          }
          .verdict-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
          .verdict-pill { font-size: 12px; font-weight: 800; letter-spacing: 0.06em; color: ${badgeColor}; }
          .risk-score { font-family: ui-monospace, monospace; font-size: 13px; font-weight: 700; color: ${badgeColor}; }
          .headline { font-size: 13px; font-weight: 600; color: #F8FAFC; line-height: 1.4; }
          .domain-bar {
            display: flex; justify-content: space-between; align-items: center;
            background: #101727; border: 1px solid #1E293B; border-radius: 10px;
            padding: 7px 11px; margin-bottom: 9px; font-size: 12px;
          }
          .domain-host { font-family: ui-monospace, monospace; color: #CBD5E1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
          .domain-pill { font-size: 11px; font-weight: 700; color: #93C5FD; }
          .unverified-banner {
            background: rgba(245, 158, 11, 0.14); border: 1px solid #F59E0B;
            color: #FCD34D; border-radius: 10px; padding: 8px 11px;
            font-size: 12px; line-height: 1.4; margin-bottom: 9px;
          }
          .section { background: #101727; border: 1px solid #1E293B; border-radius: 10px; padding: 9px 11px; margin-bottom: 8px; }
          .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748B; font-weight: 700; margin-bottom: 5px; }
          .diff-row, .token-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed rgba(148,163,184,0.14); }
          .diff-row:last-child, .token-row:last-child { border-bottom: none; }
          .diff-amt { font-family: ui-monospace, monospace; font-weight: 700; }
          .muted-note { font-size: 12px; color: #94A3B8; }
          ul.reasons { margin: 0; padding-left: 16px; font-size: 12px; color: #CBD5E1; line-height: 1.5; }
          ul.reasons li { margin-bottom: 4px; }
          .venice-box { border-color: rgba(41, 52, 255, 0.4); }
          .venice-text { margin: 0; font-size: 12px; color: #CBD5E1; line-height: 1.45; }
          .pill { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: #1E293B; color: #E2E8F0; }
          .pill-critical { background: rgba(239,68,68,0.2); color: #FCA5A5; }
          .pill-caution { background: rgba(245,158,11,0.2); color: #FCD34D; }
          .pill-safe { background: rgba(16,185,129,0.2); color: #6EE7B7; }
          .allow-gate {
            background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.5);
            border-radius: 10px; padding: 10px 12px; margin-bottom: 12px;
          }
          .allow-gate label { display: block; font-size: 12px; color: #FECACA; margin-bottom: 7px; line-height: 1.4; }
          .allow-gate input {
            width: 100%; background: #070B14; border: 1px solid #EF4444;
            color: #F8FAFC; border-radius: 8px; padding: 8px 10px; font-size: 13px;
            font-family: ui-monospace, monospace; outline: none;
          }
          .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
          button {
            border-radius: 10px; padding: 11px 14px; font-size: 13px; font-weight: 700;
            cursor: pointer; border: 1px solid transparent; transition: opacity 0.15s;
          }
          #solsh-reject {
            background: #2934FF; color: #FFFFFF;
          }
          #solsh-reject:hover { opacity: 0.92; }
          #solsh-approve {
            background: #172033; color: #E2E8F0; border-color: #334155;
          }
          #solsh-approve.safe-btn {
            background: #10B981; color: #04130D;
          }
          #solsh-approve:disabled {
            opacity: 0.38; cursor: not-allowed;
          }
          .privacy-foot {
            margin-top: 10px; font-size: 10px; color: #64748B; text-align: center; line-height: 1.4;
          }
        </style>
        <div class="backdrop">
          <div class="modal" role="dialog" aria-modal="true">
            <div class="header">
              <div class="brand">
                <img class="brand-logo" src="${brandLogoDataUrl}" alt="SolShield" />
                <span>SOLSHIELD BROWSER GUARD</span>
              </div>
              <span class="meta-tag">${escapeHtml(payload.walletName)} · ${escapeHtml(
        payload.walletMethod
      )}</span>
            </div>

            <div class="verdict-card">
              <div class="verdict-top">
                <span class="verdict-pill">${escapeHtml(verdict.decision)}</span>
                <span class="risk-score">Risk ${verdict.riskScore}/99</span>
              </div>
              <div class="headline">${escapeHtml(verdict.headline)}</div>
            </div>

            <div class="domain-bar">
              <span class="domain-host">${escapeHtml(
                verdict.domainEvaluation.hostname
              )}</span>
              <span class="domain-pill">${escapeHtml(domainBadgeLabel)}</span>
            </div>

            ${unverifiedBanner}

            <div class="section">
              <div class="section-title">Simulated Balance Impact (${
                verdict.txCount
              } tx)</div>
              ${diffsHtml}
            </div>

            ${tokenAuditHtml}
            ${evmSummaryHtml}

            <div class="section">
              <div class="section-title">Security Findings</div>
              <ul class="reasons">
                ${
                  reasonsHtml ||
                  "<li>Deterministic instruction scan passed with no critical flags.</li>"
                }
              </ul>
            </div>

            ${veniceBlock}
            ${allowInputHtml}

            <div class="actions">
              <button id="solsh-reject" type="button">Reject Transaction</button>
              <button id="solsh-approve" type="button" class="${
                verdict.decision === "SAFE" ? "safe-btn" : ""
              }" ${verdict.requiresTypedConfirmation ? "disabled" : ""}>
                ${
                  verdict.decision === "BLOCK"
                    ? "Proceed Anyway"
                    : "Approve & Sign"
                }
              </button>
            </div>
            <div class="privacy-foot">${escapeHtml(
              verdict.privacyAttestation
            )}</div>
          </div>
        </div>
      `;

      const rejectBtn = shadow.getElementById("solsh-reject") as HTMLButtonElement;
      const approveBtn = shadow.getElementById(
        "solsh-approve"
      ) as HTMLButtonElement;
      const allowInput = shadow.getElementById(
        "solsh-allow-input"
      ) as HTMLInputElement | null;

      function cleanup(result: boolean) {
        window.removeEventListener("keydown", onKeyDown, true);
        host.remove();
        resolve(result);
      }

      function onKeyDown(ev: KeyboardEvent) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          cleanup(false);
        }
      }

      if (allowInput) {
        allowInput.addEventListener("input", () => {
          approveBtn.disabled = allowInput.value.trim() !== "ALLOW";
        });
      }

      rejectBtn.addEventListener("click", () => cleanup(false));
      approveBtn.addEventListener("click", () => {
        if (verdict.requiresTypedConfirmation) {
          if (!allowInput || allowInput.value.trim() !== "ALLOW") return;
        }
        cleanup(true);
      });

      window.addEventListener("keydown", onKeyDown, true);
      (document.body || document.documentElement).appendChild(host);
      rejectBtn.focus({ preventScroll: true });
    });
  }

  function vericeSafe(input: string): string {
    return input.slice(0, 420);
  }
})();
