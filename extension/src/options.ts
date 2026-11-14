import { normalizeHostname } from "../../src/lib/domain-guard";
import {
  DEFAULT_SETTINGS,
  type PopupStateSnapshot,
  type SolShieldSettings,
} from "./types";

function parseDomainLines(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((line) => normalizeHostname(line))
        .filter((host): host is string => Boolean(host))
    )
  );
}

async function loadOptions() {
  const res = await chrome.runtime.sendMessage<{
    ok: boolean;
    snapshot?: PopupStateSnapshot;
  }>({ type: "SOLSHIELD_GET_POPUP_STATE" });

  if (!res?.ok || !res.snapshot) return;
  const s = res.snapshot.settings;

  (document.getElementById("api-base-url") as HTMLInputElement).value =
    s.apiBaseUrl;
  (document.getElementById("network") as HTMLSelectElement).value = s.network;
  (document.getElementById("custom-rpc") as HTMLInputElement).value =
    s.customRpcUrl;
  (document.getElementById("venice-key") as HTMLInputElement).value =
    s.veniceApiKey;
  (document.getElementById("strict-mode") as HTMLInputElement).checked =
    s.strictMode;
  (document.getElementById("trusted-domains") as HTMLTextAreaElement).value =
    s.trustedDomains.join("\n");
  (document.getElementById("blocked-domains") as HTMLTextAreaElement).value =
    s.blockedDomains.join("\n");
}

document.addEventListener("DOMContentLoaded", () => {
  void loadOptions();

  const apiInput = document.getElementById("api-base-url") as HTMLInputElement;
  const statusEl = document.getElementById("save-status") as HTMLElement;

  document.getElementById("preset-local")?.addEventListener("click", () => {
    apiInput.value = "http://localhost:3000";
  });

  document.getElementById("preset-prod")?.addEventListener("click", () => {
    apiInput.value = "https://sol-shield.xyz";
  });

  document.getElementById("save-btn")?.addEventListener("click", async () => {
    const next: Partial<SolShieldSettings> = {
      apiBaseUrl: apiInput.value.trim() || DEFAULT_SETTINGS.apiBaseUrl,
      network:
        (document.getElementById("network") as HTMLSelectElement).value ===
        "devnet"
          ? "devnet"
          : "mainnet",
      customRpcUrl: (
        document.getElementById("custom-rpc") as HTMLInputElement
      ).value.trim(),
      veniceApiKey: (
        document.getElementById("venice-key") as HTMLInputElement
      ).value.trim(),
      strictMode: (document.getElementById("strict-mode") as HTMLInputElement)
        .checked,
      trustedDomains: parseDomainLines(
        (document.getElementById("trusted-domains") as HTMLTextAreaElement).value
      ),
      blockedDomains: parseDomainLines(
        (document.getElementById("blocked-domains") as HTMLTextAreaElement).value
      ),
    };

    const res = await chrome.runtime.sendMessage<{ ok: boolean }>({
      type: "SOLSHIELD_UPDATE_SETTINGS",
      settings: next,
    });

    statusEl.textContent = res?.ok
      ? "Settings saved cleanly to chrome.storage.local."
      : "Failed to save settings.";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 3500);
  });

  document.getElementById("reset-btn")?.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage<{ ok: boolean }>({
      type: "SOLSHIELD_UPDATE_SETTINGS",
      settings: { ...DEFAULT_SETTINGS },
    });
    if (res?.ok) {
      await loadOptions();
      statusEl.textContent = "Restored default production configuration.";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 3500);
    }
  });
});
