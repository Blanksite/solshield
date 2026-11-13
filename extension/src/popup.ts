import type { PopupStateSnapshot, SolShieldSettings } from "./types";

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function refreshPopup() {
  const res = await chrome.runtime.sendMessage<{
    ok: boolean;
    snapshot?: PopupStateSnapshot;
  }>({ type: "SOLSHIELD_GET_POPUP_STATE" });

  if (!res?.ok || !res.snapshot) return;
  const { settings, history, activeTab } = res.snapshot;

  const toggleBtn = document.getElementById("toggle-enabled") as HTMLButtonElement;
  const endpointBadge = document.getElementById("endpoint-badge") as HTMLElement;
  const networkBadge = document.getElementById("network-badge") as HTMLElement;
  const activeHostEl = document.getElementById("active-host") as HTMLElement;
  const domainPill = document.getElementById("domain-status-pill") as HTMLElement;
  const chipsContainer = document.getElementById("provider-chips") as HTMLElement;
  const historyList = document.getElementById("history-list") as HTMLElement;

  toggleBtn.textContent = settings.enabled ? "ACTIVE" : "PAUSED";
  toggleBtn.className = `toggle-btn ${settings.enabled ? "active" : "off"}`;

  const isLocalApi =
    settings.apiBaseUrl.includes("localhost") ||
    settings.apiBaseUrl.includes("127.0.0.1");
  endpointBadge.textContent = isLocalApi
    ? "BACKEND: LOCALHOST:3000"
    : "BACKEND: SOL-SHIELD.XYZ";
  networkBadge.textContent = settings.network.toUpperCase();

  activeHostEl.textContent = activeTab.hostname || "Internal / Non-HTTP Tab";

  if (activeTab.domainEvaluation) {
    const st = activeTab.domainEvaluation.status;
    domainPill.textContent = st;
    domainPill.className =
      st === "VERIFIED" || st === "DEV_LOCAL"
        ? "pill safe"
        : st === "TYPOSQUAT_CRITICAL"
        ? "pill block"
        : "pill warning";
  } else {
    domainPill.textContent = "N/A";
    domainPill.className = "pill";
  }

  const prov = activeTab.providerStatus;
  if (
    prov &&
    (prov.legacyProvidersWrapped.length > 0 ||
      prov.walletStandardWrapped.length > 0 ||
      prov.frozenProviders.length > 0)
  ) {
    const items: string[] = [];
    for (const p of prov.legacyProvidersWrapped) {
      items.push(`<span class="chip">Legacy: ${escapeText(p)}</span>`);
    }
    for (const w of prov.walletStandardWrapped) {
      items.push(`<span class="chip">Standard: ${escapeText(w)}</span>`);
    }
    for (const f of prov.frozenProviders) {
      items.push(`<span class="chip frozen">Limited: ${escapeText(f)}</span>`);
    }
    chipsContainer.innerHTML = items.join("");
  } else {
    chipsContainer.innerHTML =
      '<span class="muted">No Solana wallet provider detected on this tab yet.</span>';
  }

  if (history.length === 0) {
    historyList.innerHTML =
      '<div class="muted">No local transaction audits recorded yet.</div>';
  } else {
    historyList.innerHTML = history
      .map((entry) => {
        const cls =
          entry.decision === "BLOCK"
            ? "block"
            : entry.decision === "WARNING"
            ? "warning"
            : "safe";
        const timeStr = new Date(entry.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `<div class="history-item">
          <div class="history-top">
            <strong>${escapeText(entry.hostname)}</strong>
            <span class="pill ${cls}">${escapeText(entry.decision)} (${
          entry.riskScore
        })</span>
          </div>
          <div class="history-meta">${escapeText(
            entry.walletMethod
          )} · ${escapeText(entry.userAction)} · ${timeStr}${
          entry.timeoutUnverified ? " · Unverified Server" : ""
        }</div>
        </div>`;
      })
      .join("");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  void refreshPopup();

  document
    .getElementById("toggle-enabled")
    ?.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage<{
        ok: boolean;
        snapshot?: PopupStateSnapshot;
      }>({ type: "SOLSHIELD_GET_POPUP_STATE" });
      const currentEnabled = res?.snapshot?.settings.enabled ?? true;
      await chrome.runtime.sendMessage<{
        ok: boolean;
        settings?: SolShieldSettings;
      }>({
        type: "SOLSHIELD_UPDATE_SETTINGS",
        settings: { enabled: !currentEnabled },
      });
      await refreshPopup();
    });

  document.getElementById("open-options")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  document
    .getElementById("clear-history")
    ?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "SOLSHIELD_CLEAR_HISTORY" });
      await refreshPopup();
    });
});
