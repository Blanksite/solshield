import type { ExtensionRequestKind } from "../../src/lib/extension-verdict";
import {
  wrapLegacyProvider,
  wrapWalletStandardWallet,
} from "./provider-wrapper";
import type { ProviderProtectionStatus } from "./types";

(() => {
  const WIN = window as unknown as Record<string, unknown>;
  if (WIN.__SOLSHIELD_INJECT_ACTIVE__) return;
  WIN.__SOLSHIELD_INJECT_ACTIVE__ = true;

  // Snapshot native references at t0 before any page script executes
  const nativeDefineProperty = Object.defineProperty.bind(Object);
  const nativeGetOwnPropertyDescriptor =
    Object.getOwnPropertyDescriptor.bind(Object);
  const nativePostMessage = window.postMessage.bind(window);
  const nativeAddEventListener = window.addEventListener.bind(window);
  const nativeDispatchEvent = window.dispatchEvent.bind(window);

  let bridgePort: MessagePort | null = null;
  const queuedMessages: unknown[] = [];
  const pendingDecisions = new Map<
    string,
    { resolve: (decision: { allow: boolean; reason?: string }) => void }
  >();
  let requestSeq = 0;

  const trackedStatus: ProviderProtectionStatus = {
    legacyProvidersWrapped: [],
    walletStandardWrapped: [],
    frozenProviders: [],
    updatedAt: Date.now(),
  };

  function postToBridge(msg: unknown) {
    if (bridgePort) {
      bridgePort.postMessage(msg);
    } else {
      queuedMessages.push(msg);
    }
  }

  function flushQueuedToBridge() {
    if (!bridgePort || queuedMessages.length === 0) return;
    while (queuedMessages.length > 0) {
      const next = queuedMessages.shift();
      bridgePort.postMessage(next);
    }
  }

  function emitStatus() {
    trackedStatus.updatedAt = Date.now();
    postToBridge({
      type: "SOLSHIELD_PROVIDER_STATUS",
      status: {
        legacyProvidersWrapped: [...trackedStatus.legacyProvidersWrapped],
        walletStandardWrapped: [...trackedStatus.walletStandardWrapped],
        frozenProviders: [...trackedStatus.frozenProviders],
        updatedAt: trackedStatus.updatedAt,
      },
    });
  }

  function addUnique(arr: string[], label: string) {
    if (!arr.includes(label)) {
      arr.push(label);
    }
  }

  function interceptRequest(input: {
    walletName: string;
    walletMethod: ExtensionRequestKind;
    base64Transactions?: string[];
    signMessageBytesBase64?: string;
    signMessagePreviewText?: string;
  }): Promise<{ allow: boolean; reason?: string }> {
    const requestId = `solsh-${Date.now()}-${++requestSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pendingDecisions.has(requestId)) {
          pendingDecisions.delete(requestId);
          resolve({
            allow: false,
            reason:
              "SolShield Guard verification timed out waiting for user/extension response.",
          });
        }
      }, 120000);

      pendingDecisions.set(requestId, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
      });

      postToBridge({
        type: "SOLSHIELD_INTERCEPT_REQUEST",
        payload: {
          requestId,
          walletName: input.walletName,
          walletMethod: input.walletMethod,
          originUrl: window.location.href,
          hostname: window.location.hostname,
          base64Transactions: input.base64Transactions,
          signMessageBytesBase64: input.signMessageBytesBase64,
          signMessagePreviewText: input.signMessagePreviewText,
        },
      });
    });
  }

  function attachBridgePort(port: MessagePort) {
    bridgePort = port;
    port.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "SOLSHIELD_INTERCEPT_DECISION") {
        const entry = pendingDecisions.get(data.requestId);
        if (entry) {
          pendingDecisions.delete(data.requestId);
          entry.resolve({
            allow: Boolean(data.allow),
            reason: data.errorMessage || data.verdict?.headline,
          });
        }
      }
    };
    port.postMessage({ type: "SOLSHIELD_PORT_ACK" });
    flushQueuedToBridge();
    emitStatus();
  }

  nativeAddEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    if (
      event.data &&
      event.data.source === "SOLSHIELD_PORT_INIT" &&
      event.ports?.[0] &&
      !bridgePort
    ) {
      attachBridgePort(event.ports[0]);
    }
  });

  // Notify ISOLATED world if MAIN executed before content script installed MessageChannel
  nativePostMessage({ source: "SOLSHIELD_MAIN_READY" }, "*");

  function inspectAndWrapLegacyProviders() {
    let updated = false;
    const candidates: Array<{ name: string; obj: unknown }> = [
      {
        name: "Phantom",
        obj: (WIN.phantom as Record<string, unknown> | undefined)?.solana,
      },
      { name: "Solana", obj: WIN.solana },
      { name: "Solflare", obj: WIN.solflare },
      { name: "Backpack", obj: WIN.backpack },
      { name: "Glow", obj: WIN.glow },
    ];

    for (const candidate of candidates) {
      if (!candidate.obj) continue;
      const res = wrapLegacyProvider(candidate.obj, candidate.name, {
        interceptRequest,
      });
      if (res.status === "WRAPPED") {
        addUnique(trackedStatus.legacyProvidersWrapped, candidate.name);
        updated = true;
      } else if (res.status === "LIMITED_FROZEN") {
        addUnique(
          trackedStatus.frozenProviders,
          `${candidate.name} (Frozen)`
        );
        updated = true;
      }
    }

    if (updated) emitStatus();
  }

  function installConfigurableTrap(propName: string, label: string) {
    const existingDesc = nativeGetOwnPropertyDescriptor(window, propName);
    if (existingDesc && !existingDesc.configurable) {
      inspectAndWrapLegacyProviders();
      return;
    }

    let internalVal = WIN[propName];
    if (internalVal) {
      inspectAndWrapLegacyProviders();
    }

    try {
      nativeDefineProperty(window, propName, {
        configurable: true,
        enumerable: true,
        get() {
          return internalVal;
        },
        set(nextVal: unknown) {
          internalVal = nextVal;
          if (nextVal) {
            if (propName === "phantom") {
              inspectAndWrapLegacyProviders();
            } else {
              const res = wrapLegacyProvider(nextVal, label, {
                interceptRequest,
              });
              if (res.status === "WRAPPED") {
                addUnique(trackedStatus.legacyProvidersWrapped, label);
                emitStatus();
              } else if (res.status === "LIMITED_FROZEN") {
                addUnique(trackedStatus.frozenProviders, `${label} (Frozen)`);
                emitStatus();
              }
            }
          }
        },
      });
    } catch {
      // Ignore if host browser restricts global window trap
    }
  }

  function wrapStandardWalletEntry(wallet: unknown): unknown {
    const res = wrapWalletStandardWallet(wallet, { interceptRequest });
    const walletName =
      wallet && typeof wallet === "object" && "name" in wallet
        ? String((wallet as { name?: string }).name || "WalletStandard")
        : "WalletStandard";

    if (res.status === "WRAPPED") {
      addUnique(trackedStatus.walletStandardWrapped, walletName);
      emitStatus();
    } else if (res.status === "LIMITED_FROZEN") {
      addUnique(
        trackedStatus.frozenProviders,
        `${walletName} (WalletStandard Frozen)`
      );
      emitStatus();
    }
    return wallet;
  }

  const wrappedRegisterApis = new WeakSet<object>();
  function wrapRegisterApi(api: { register?: (...wallets: unknown[]) => unknown }) {
    if (!api || typeof api.register !== "function" || wrappedRegisterApis.has(api)) {
      return api;
    }
    const origRegister = api.register;
    const desc = nativeGetOwnPropertyDescriptor(api, "register");
    if (!desc || desc.configurable || desc.writable) {
      try {
        wrappedRegisterApis.add(api);
        const patchedRegister = function (
          this: unknown,
          ...wallets: unknown[]
        ) {
          const safeWallets = wallets.map((w) => wrapStandardWalletEntry(w));
          return origRegister.apply(this || api, safeWallets);
        };
        if (!desc || desc.configurable) {
          nativeDefineProperty(api, "register", {
            value: patchedRegister,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        } else {
          api.register = patchedRegister;
        }
      } catch {
        // Fallback silently if register API object is frozen
      }
    }
    return api;
  }

  // Hook Wallet Standard event registration paths in MAIN world
  const wrappedCallbacks = new WeakSet<Function>();
  function patchWalletStandardEvent(event: Event): Event {
    const customEvent = event as CustomEvent;
    if (event.type === "wallet-standard:app-ready" && customEvent.detail) {
      if (typeof customEvent.detail === "object") {
        wrapRegisterApi(
          customEvent.detail as { register?: (...w: unknown[]) => unknown }
        );
      }
    } else if (
      event.type === "wallet-standard:register-wallet" &&
      typeof customEvent.detail === "function" &&
      !wrappedCallbacks.has(customEvent.detail)
    ) {
      const origWalletRegisterCb = customEvent.detail as (
        api: { register: (...wallets: unknown[]) => unknown }
      ) => unknown;
      const interceptedCb = function (api: {
        register: (...wallets: unknown[]) => unknown;
      }) {
        wrapRegisterApi(api);
        return origWalletRegisterCb(api);
      };
      wrappedCallbacks.add(interceptedCb);
      const detailDesc = nativeGetOwnPropertyDescriptor(customEvent, "detail");
      if (!detailDesc || detailDesc.configurable) {
        try {
          nativeDefineProperty(customEvent, "detail", {
            value: interceptedCb,
            configurable: true,
          });
        } catch {
          // ignore read-only CustomEvent
        }
      }
    }
    return event;
  }

  try {
    window.dispatchEvent = function (event: Event): boolean {
      patchWalletStandardEvent(event);
      return nativeDispatchEvent(event);
    };
  } catch {
    // ignore if non-writable
  }

  try {
    const origAddListener = nativeAddEventListener;
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      if (!listener) return;
      if (
        type === "wallet-standard:register-wallet" ||
        type === "wallet-standard:app-ready"
      ) {
        const wrappedListener: EventListener = (ev: Event) => {
          patchWalletStandardEvent(ev);
          if (typeof listener === "function") {
            listener.call(window, ev);
          } else {
            listener.handleEvent(ev);
          }
        };
        return origAddListener(type, wrappedListener, options);
      }
      return origAddListener(type, listener, options);
    } as typeof window.addEventListener;
  } catch {
    // ignore if non-writable
  }

  // Install legacy traps and run periodic discovery for wallets injecting via Object.defineProperty
  installConfigurableTrap("solana", "Solana");
  installConfigurableTrap("phantom", "Phantom");
  installConfigurableTrap("solflare", "Solflare");
  installConfigurableTrap("backpack", "Backpack");
  installConfigurableTrap("glow", "Glow");

  inspectAndWrapLegacyProviders();
  let polls = 0;
  const pollTimer = setInterval(() => {
    polls++;
    inspectAndWrapLegacyProviders();
    if (polls >= 40) {
      clearInterval(pollTimer);
    }
  }, 150);

  nativeAddEventListener("DOMContentLoaded", inspectAndWrapLegacyProviders);
  nativeAddEventListener("load", inspectAndWrapLegacyProviders);
})();
