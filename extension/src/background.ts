import {
  evaluateDomainSafety,
  normalizeHostname,
} from "../../src/lib/domain-guard";
import {
  buildExtensionVerdict,
  inspectOffchainSignMessage,
  RemoteAuditSnapshot,
} from "../../src/lib/extension-verdict";
import { analyzeBase64Transaction } from "../../src/lib/solana-parser";
import {
  DEFAULT_SETTINGS,
  InterceptRequestPayload,
  PopupStateSnapshot,
  ProviderProtectionStatus,
  SolShieldSettings,
  VerdictHistoryEntry,
} from "./types";

const SETTINGS_KEY = "solshield_settings";
const HISTORY_KEY = "solshield_history";
const MAX_HISTORY_ENTRIES = 20;
const DOMAIN_CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedDomainReputation {
  expiresAt: number;
  data: NonNullable<RemoteAuditSnapshot["domainReputation"]>;
}

const domainRepCache = new Map<string, CachedDomainReputation>();
const tabProviderStatus = new Map<number, ProviderProtectionStatus>();

function base64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

async function getSettings(): Promise<SolShieldSettings> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  const raw = stored[SETTINGS_KEY] as Partial<SolShieldSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...(raw || {}),
    trustedDomains: Array.isArray(raw?.trustedDomains)
      ? raw.trustedDomains
      : DEFAULT_SETTINGS.trustedDomains,
    blockedDomains: Array.isArray(raw?.blockedDomains)
      ? raw.blockedDomains
      : DEFAULT_SETTINGS.blockedDomains,
  };
}

async function saveSettings(partial: Partial<SolShieldSettings>): Promise<SolShieldSettings> {
  const current = await getSettings();
  const next: SolShieldSettings = {
    ...current,
    ...partial,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  domainRepCache.clear();
  return next;
}

async function getHistory(): Promise<VerdictHistoryEntry[]> {
  const stored = await chrome.storage.local.get([HISTORY_KEY]);
  const arr = stored[HISTORY_KEY];
  return Array.isArray(arr) ? (arr as VerdictHistoryEntry[]).slice(0, MAX_HISTORY_ENTRIES) : [];
}

async function appendHistory(entry: VerdictHistoryEntry): Promise<void> {
  const existing = await getHistory();
  const next = [entry, ...existing].slice(0, MAX_HISTORY_ENTRIES);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

async function fetchJsonWithTimeout(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function selectPrimaryTxForDeepAudit(txs: string[]): string | null {
  if (txs.length === 0) return null;
  if (txs.length === 1) return txs[0];
  let bestTx = txs[0];
  let bestScore = -1;
  for (const tx of txs) {
    try {
      const rep = analyzeBase64Transaction(tx);
      if (rep.deterministicRiskScore > bestScore) {
        bestScore = rep.deterministicRiskScore;
        bestTx = tx;
      }
    } catch {
      return tx;
    }
  }
  return bestTx;
}

async function runAudit(payload: InterceptRequestPayload) {
  const settings = await getSettings();
  const normalizedHost =
    normalizeHostname(payload.hostname || payload.originUrl) || "unknown.invalid";

  if (!settings.enabled) {
    const fallbackVerdict = buildExtensionVerdict({
      walletMethod: payload.walletMethod,
      hostname: normalizedHost,
      base64Transactions: payload.base64Transactions,
      evmRequest: payload.evmRequest,
      trustedDomains: settings.trustedDomains,
      blockedDomains: settings.blockedDomains,
      strictMode: false,
    });
    return { ok: true, bypass: true, verdict: fallbackVerdict };
  }

  const domainEval = evaluateDomainSafety(normalizedHost, {
    trustedDomains: settings.trustedDomains,
    blockedDomains: settings.blockedDomains,
  });

  const txs = payload.base64Transactions ?? [];
  const messageInspection =
    payload.walletMethod === "signMessage"
      ? inspectOffchainSignMessage(
          base64ToBytes(payload.signMessageBytesBase64 || ""),
          payload.signMessagePreviewText
        )
      : null;

  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, "");

  const needDomainLookup =
    !domainEval.isAllowlisted && domainEval.status !== "DEV_LOCAL";
  const cachedDomainRep = domainRepCache.get(normalizedHost);
  const hasFreshDomainCache =
    cachedDomainRep && cachedDomainRep.expiresAt > Date.now();

  const deepTx = selectPrimaryTxForDeepAudit(txs);
  const needEvmAudit =
    Boolean(payload.evmRequest) &&
    payload.walletMethod !== "eth_requestAccounts" &&
    payload.walletMethod !== "wallet_requestPermissions";
  const needTxAudit = Boolean(deepTx);

  let attempted = false;
  let domainLookupOk = !needDomainLookup || Boolean(hasFreshDomainCache);
  let txAuditOk = !needTxAudit && !needEvmAudit;
  let timedOutOrError: string | null = null;
  let domainReputation: RemoteAuditSnapshot["domainReputation"] =
    hasFreshDomainCache ? cachedDomainRep.data : null;
  let veniceAudit: RemoteAuditSnapshot["veniceAudit"] = null;
  let rpcSimulation: RemoteAuditSnapshot["rpcSimulation"] = null;
  let evmContractWarning: string | null = null;
  let evmContractRiskScore: number | null = null;

  const promises: Promise<void>[] = [];

  if (needDomainLookup && !hasFreshDomainCache) {
    attempted = true;
    promises.push(
      fetchJsonWithTimeout(
        `${baseUrl}/api/domain-reputation`,
        {
          // Dual-Lane Privacy: transmit ONLY bare ASCII hostname
          hostname: normalizedHost,
          trustedDomains: settings.trustedDomains,
          blockedDomains: settings.blockedDomains,
          veniceApiKey: settings.veniceApiKey || undefined,
        },
        3200
      )
        .then((res) => {
          if (res.ok) {
            domainReputation = {
              riskLevel:
                (res.riskLevel as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") ??
                "MEDIUM",
              riskScore: typeof res.riskScore === "number" ? res.riskScore : 35,
              summary: typeof res.summary === "string" ? res.summary : "",
              sources: Array.isArray(res.sources)
                ? (res.sources as string[])
                : [],
              inferenceMode:
                res.inferenceMode === "venice-live-api"
                  ? "venice-live-api"
                  : "deterministic-fallback",
            };
            domainRepCache.set(normalizedHost, {
              expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS,
              data: domainReputation,
            });
            domainLookupOk = true;
          } else {
            timedOutOrError =
              timedOutOrError ?? "Domain reputation API returned non-ok status";
          }
        })
        .catch((err) => {
          timedOutOrError =
            timedOutOrError ??
            (err instanceof Error
              ? err.message
              : "Domain reputation API unreachable");
        })
    );
  }

  if (needTxAudit && deepTx) {
    attempted = true;
    promises.push(
      fetchJsonWithTimeout(
        `${baseUrl}/api/audit`,
        {
          base64Transaction: deepTx,
          simulateRpc: true,
          network: settings.network,
          rpcUrl: settings.customRpcUrl.trim() || undefined,
          inspectTokens: true,
          veniceApiKey: settings.veniceApiKey.trim() || undefined,
        },
        4500
      )
        .then((res) => {
          if (res.ok) {
            veniceAudit =
              (res.veniceAudit as RemoteAuditSnapshot["veniceAudit"]) ?? null;
            rpcSimulation =
              (res.rpcSimulation as RemoteAuditSnapshot["rpcSimulation"]) ??
              null;
            txAuditOk = true;
          } else {
            timedOutOrError =
              timedOutOrError ?? "Tx audit/simulation API returned non-ok status";
          }
        })
        .catch((err) => {
          timedOutOrError =
            timedOutOrError ??
            (err instanceof Error
              ? err.message
              : "Tx audit/simulation API unreachable");
        })
    );
  }

  if (needEvmAudit && payload.evmRequest) {
    attempted = true;
    promises.push(
      fetchJsonWithTimeout(
        `${baseUrl}/api/audit`,
        {
          evmRequest: payload.evmRequest,
          veniceApiKey: settings.veniceApiKey.trim() || undefined,
        },
        4200
      )
        .then((res) => {
          if (res.ok) {
            evmContractWarning =
              typeof res.evmContractWarning === "string"
                ? res.evmContractWarning
                : null;
            evmContractRiskScore =
              typeof res.evmContractRiskScore === "number"
                ? res.evmContractRiskScore
                : null;
            txAuditOk = true;
          } else {
            timedOutOrError =
              timedOutOrError ?? "EVM contract audit API returned non-ok status";
          }
        })
        .catch((err) => {
          timedOutOrError =
            timedOutOrError ??
            (err instanceof Error
              ? err.message
              : "EVM audit API unreachable");
        })
    );
  }

  if (promises.length > 0) {
    await Promise.all(promises);
  }

  const verified = domainLookupOk && txAuditOk;

  const verdict = buildExtensionVerdict({
    walletMethod: payload.walletMethod,
    hostname: normalizedHost,
    base64Transactions: txs,
    evmRequest: payload.evmRequest,
    messageInspection,
    signInInput: payload.signInInput ?? null,
    trustedDomains: settings.trustedDomains,
    blockedDomains: settings.blockedDomains,
    strictMode: settings.strictMode,
    remote: {
      attempted,
      verified,
      timedOutOrError,
      veniceAudit,
      rpcSimulation,
      domainReputation,
      evmContractWarning,
      evmContractRiskScore,
    },
  });

  return { ok: true, bypass: false, verdict };
}

async function getPopupState(): Promise<PopupStateSnapshot> {
  const [settings, history, tabs] = await Promise.all([
    getSettings(),
    getHistory(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  const activeTab = tabs[0];
  const tabId = typeof activeTab?.id === "number" ? activeTab.id : null;
  const hostname = activeTab?.url ? normalizeHostname(activeTab.url) : null;
  const domainEvaluation = hostname
    ? evaluateDomainSafety(hostname, {
        trustedDomains: settings.trustedDomains,
        blockedDomains: settings.blockedDomains,
      })
    : null;
  const providerStatus =
    tabId !== null ? tabProviderStatus.get(tabId) ?? null : null;

  return {
    settings,
    history,
    activeTab: {
      tabId,
      hostname,
      domainEvaluation,
      providerStatus,
    },
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as Record<string, unknown>;

  if (msg?.type === "SOLSHIELD_PROVIDER_STATUS") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && msg.status) {
      tabProviderStatus.set(tabId, msg.status as ProviderProtectionStatus);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "SOLSHIELD_RUN_AUDIT") {
    runAudit(msg.payload as InterceptRequestPayload)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : "Audit handler failure",
        })
      );
    return true;
  }

  if (msg?.type === "SOLSHIELD_RECORD_HISTORY" && msg.entry) {
    appendHistory(msg.entry as VerdictHistoryEntry)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg?.type === "SOLSHIELD_GET_POPUP_STATE") {
    getPopupState()
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : "Popup state error",
        })
      );
    return true;
  }

  if (msg?.type === "SOLSHIELD_UPDATE_SETTINGS" && msg.settings) {
    saveSettings(msg.settings as Partial<SolShieldSettings>)
      .then((updated) => sendResponse({ ok: true, settings: updated }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : "Failed to save settings",
        })
      );
    return true;
  }

  if (msg?.type === "SOLSHIELD_CLEAR_HISTORY") {
    chrome.storage.local
      .set({ [HISTORY_KEY]: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
