import type { ExtensionRequestKind } from "../../src/lib/extension-verdict";

export const SOLSHIELD_WRAPPED_SYMBOL = Symbol.for("solshield.wrapped.v1");

export interface ProviderWrapResult {
  status: "NOT_PRESENT" | "ALREADY_WRAPPED" | "WRAPPED" | "LIMITED_FROZEN";
  wrappedMethods: string[];
  frozenMethods: string[];
}

export interface InterceptorHooks {
  interceptRequest: (request: {
    walletName: string;
    walletMethod: ExtensionRequestKind;
    base64Transactions?: string[];
    signMessageBytesBase64?: string;
    signMessagePreviewText?: string;
  }) => Promise<{ allow: boolean; reason?: string }>;
  onStatusChange?: () => void;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...sub);
    }
    return globalThis.btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("No base64 encoder available in runtime.");
}

export function decodeUtf8Preview(bytes: Uint8Array): string {
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8", { fatal: false })
        .decode(bytes)
        .slice(0, 260);
    }
  } catch {
    // ignore decode issues
  }
  return "";
}

/**
 * Serializes a Transaction, VersionedTransaction, or Uint8Array without mutating it.
 */
export function serializeTransactionLike(tx: unknown): string | null {
  if (!tx) return null;

  if (tx instanceof Uint8Array) {
    return uint8ArrayToBase64(tx);
  }

  if (ArrayBuffer.isView(tx)) {
    const view = new Uint8Array(tx.buffer, tx.byteOffset, tx.byteLength);
    return uint8ArrayToBase64(view);
  }

  if (typeof tx === "object") {
    const candidate = tx as {
      serialize?: (config?: {
        requireAllSignatures?: boolean;
        verifySignatures?: boolean;
      }) => Uint8Array;
    };

    if (typeof candidate.serialize === "function") {
      const targetForSerialize = (() => {
        const rec = candidate as Record<string, unknown>;
        if (Array.isArray(rec.signatures)) {
          try {
            return Object.assign(
              Object.create(Object.getPrototypeOf(candidate)),
              candidate,
              { signatures: [...rec.signatures] }
            ) as typeof candidate;
          } catch {
            return candidate;
          }
        }
        return candidate;
      })();

      try {
        const bytes = targetForSerialize.serialize!({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        if (bytes instanceof Uint8Array) {
          return uint8ArrayToBase64(bytes);
        }
        if (ArrayBuffer.isView(bytes)) {
          const view = bytes as ArrayBufferView;
          return uint8ArrayToBase64(
            new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
          );
        }
      } catch {
        try {
          const bytes = targetForSerialize.serialize!();
          if (bytes instanceof Uint8Array) {
            return uint8ArrayToBase64(bytes);
          }
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export function createUserRejectedError(message?: string): Error & { code: number } {
  const err = new Error(
    message || "SolShield Guard: Request rejected by user."
  ) as Error & { code: number };
  err.code = 4001;
  return err;
}

function tryMarkWrapped(target: object): boolean {
  try {
    if (Object.isExtensible(target)) {
      Object.defineProperty(target, SOLSHIELD_WRAPPED_SYMBOL, {
        value: true,
        configurable: false,
        enumerable: false,
      });
      return true;
    }
  } catch {
    // ignore non-extensible objects
  }
  return false;
}

function canReplaceProperty(obj: Record<string, unknown>, key: string): boolean {
  if (Object.isFrozen(obj)) return false;
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc) return Object.isExtensible(obj);
  if (desc.configurable) return true;
  if ("writable" in desc && desc.writable) return true;
  return false;
}

function assignMethod(
  obj: Record<string, unknown>,
  key: string,
  fn: unknown
): boolean {
  if (!canReplaceProperty(obj, key)) return false;
  try {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc || desc.configurable) {
      Object.defineProperty(obj, key, {
        value: fn,
        writable: true,
        configurable: true,
        enumerable: desc ? desc.enumerable : true,
      });
      return true;
    }
    obj[key] = fn;
    return obj[key] === fn;
  } catch {
    return false;
  }
}

export function wrapLegacyProvider(
  provider: unknown,
  walletName: string,
  hooks: InterceptorHooks
): ProviderWrapResult {
  if (!provider || (typeof provider !== "object" && typeof provider !== "function")) {
    return { status: "NOT_PRESENT", wrappedMethods: [], frozenMethods: [] };
  }

  const target = provider as Record<string, unknown>;
  if ((target as Record<symbol, unknown>)[SOLSHIELD_WRAPPED_SYMBOL]) {
    return { status: "ALREADY_WRAPPED", wrappedMethods: [], frozenMethods: [] };
  }

  const wrappedMethods: string[] = [];
  const frozenMethods: string[] = [];

  const signingMethods: Array<
    "signTransaction" | "signAndSendTransaction" | "signAllTransactions" | "signMessage" | "connect"
  > = [
    "signTransaction",
    "signAndSendTransaction",
    "signAllTransactions",
    "signMessage",
    "connect",
  ];

  for (const methodName of signingMethods) {
    const orig = target[methodName];
    if (typeof orig !== "function") continue;

    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const invokeCtx = this && this !== globalThis ? this : target;
      let verdictInput: Parameters<InterceptorHooks["interceptRequest"]>[0];

      if (methodName === "signTransaction" || methodName === "signAndSendTransaction") {
        const serialized = serializeTransactionLike(args[0]);
        verdictInput = {
          walletName,
          walletMethod: methodName,
          base64Transactions: serialized ? [serialized] : [],
        };
      } else if (methodName === "signAllTransactions") {
        const txList = Array.isArray(args[0]) ? args[0] : [];
        const serializedList = txList
          .map((item) => serializeTransactionLike(item))
          .filter((item): item is string => typeof item === "string");
        verdictInput = {
          walletName,
          walletMethod: "signAllTransactions",
          base64Transactions: serializedList,
        };
      } else if (methodName === "signMessage") {
        const rawMsg = args[0];
        const msgBytes =
          rawMsg instanceof Uint8Array
            ? rawMsg
            : ArrayBuffer.isView(rawMsg)
            ? new Uint8Array(rawMsg.buffer, rawMsg.byteOffset, rawMsg.byteLength)
            : new Uint8Array(0);
        verdictInput = {
          walletName,
          walletMethod: "signMessage",
          signMessageBytesBase64: uint8ArrayToBase64(msgBytes),
          signMessagePreviewText: decodeUtf8Preview(msgBytes),
        };
      } else {
        verdictInput = {
          walletName,
          walletMethod: "connect",
        };
      }

      const decision = await hooks.interceptRequest(verdictInput);
      if (!decision.allow) {
        throw createUserRejectedError(decision.reason);
      }
      return (orig as (...a: unknown[]) => Promise<unknown>).apply(invokeCtx, args);
    };

    if (assignMethod(target, methodName, wrapped)) {
      wrappedMethods.push(methodName);
    } else {
      frozenMethods.push(methodName);
    }
  }

  // Also wrap EIP-1193 style `.request({ method, params })` when exposed by Phantom/Solflare
  const origRequest = target.request;
  if (typeof origRequest === "function") {
    const wrappedRequest = async function (
      this: unknown,
      payload?: { method?: string; params?: Record<string, unknown> }
    ) {
      const invokeCtx = this && this !== globalThis ? this : target;
      const rpcMethod = payload?.method;
      if (
        rpcMethod === "connect" ||
        rpcMethod === "signTransaction" ||
        rpcMethod === "signAndSendTransaction" ||
        rpcMethod === "signAllTransactions" ||
        rpcMethod === "signMessage"
      ) {
        const msgParam = payload?.params?.message;
        const decision = await hooks.interceptRequest({
          walletName,
          walletMethod: rpcMethod,
          signMessagePreviewText:
            typeof msgParam === "string" ? msgParam.slice(0, 260) : undefined,
        });
        if (!decision.allow) {
          throw createUserRejectedError(decision.reason);
        }
      }
      return (origRequest as (p?: unknown) => Promise<unknown>).call(
        invokeCtx,
        payload
      );
    };
    if (assignMethod(target, "request", wrappedRequest)) {
      wrappedMethods.push("request");
    } else {
      frozenMethods.push("request");
    }
  }

  if (frozenMethods.length > 0 && wrappedMethods.length === 0) {
    return { status: "LIMITED_FROZEN", wrappedMethods, frozenMethods };
  }

  if (wrappedMethods.length > 0) {
    tryMarkWrapped(target);
  }

  return {
    status: frozenMethods.length > 0 ? "LIMITED_FROZEN" : "WRAPPED",
    wrappedMethods,
    frozenMethods,
  };
}

export interface WalletStandardFeatureSet {
  "solana:signTransaction"?: {
    version?: string;
    signTransaction: (...inputs: Array<{ transaction: Uint8Array }>) => Promise<unknown>;
  };
  "solana:signAndSendTransaction"?: {
    version?: string;
    signAndSendTransaction: (
      ...inputs: Array<{ transaction: Uint8Array }>
    ) => Promise<unknown>;
  };
  "solana:signAllTransactions"?: {
    version?: string;
    signAllTransactions?: (
      ...inputs: Array<{ transaction: Uint8Array }>
    ) => Promise<unknown>;
  };
  "solana:signMessage"?: {
    version?: string;
    signMessage: (...inputs: Array<{ message: Uint8Array }>) => Promise<unknown>;
  };
  "standard:connect"?: {
    version?: string;
    connect: (input?: unknown) => Promise<unknown>;
  };
}

export function wrapWalletStandardWallet(
  wallet: unknown,
  hooks: InterceptorHooks
): ProviderWrapResult {
  if (!wallet || typeof wallet !== "object") {
    return { status: "NOT_PRESENT", wrappedMethods: [], frozenMethods: [] };
  }

  const walletObj = wallet as {
    name?: string;
    features?: Record<string, Record<string, unknown>>;
    [SOLSHIELD_WRAPPED_SYMBOL]?: boolean;
  };

  if (walletObj[SOLSHIELD_WRAPPED_SYMBOL]) {
    return { status: "ALREADY_WRAPPED", wrappedMethods: [], frozenMethods: [] };
  }

  const features = walletObj.features;
  if (!features || typeof features !== "object") {
    return { status: "NOT_PRESENT", wrappedMethods: [], frozenMethods: [] };
  }

  const walletName = walletObj.name || "WalletStandard";
  const wrappedMethods: string[] = [];
  const frozenMethods: string[] = [];

  const featureMap: Array<{
    featureKey: string;
    fnKey: string;
    kind: ExtensionRequestKind;
  }> = [
    {
      featureKey: "solana:signTransaction",
      fnKey: "signTransaction",
      kind: "signTransaction",
    },
    {
      featureKey: "solana:signAndSendTransaction",
      fnKey: "signAndSendTransaction",
      kind: "signAndSendTransaction",
    },
    {
      featureKey: "solana:signAllTransactions",
      fnKey: "signAllTransactions",
      kind: "signAllTransactions",
    },
    {
      featureKey: "solana:signMessage",
      fnKey: "signMessage",
      kind: "signMessage",
    },
    {
      featureKey: "standard:connect",
      fnKey: "connect",
      kind: "connect",
    },
  ];

  for (const item of featureMap) {
    const featureObj = features[item.featureKey];
    if (!featureObj || typeof featureObj !== "object") continue;
    const origFn = featureObj[item.fnKey];
    if (typeof origFn !== "function") continue;

    const wrappedFn = async function (this: unknown, ...inputs: unknown[]) {
      const invokeCtx = this && this !== globalThis ? this : featureObj;
      let requestPayload: Parameters<InterceptorHooks["interceptRequest"]>[0];

      if (
        item.kind === "signTransaction" ||
        item.kind === "signAndSendTransaction" ||
        item.kind === "signAllTransactions"
      ) {
        const serializedTxs = inputs
          .map((inp) =>
            inp && typeof inp === "object"
              ? serializeTransactionLike((inp as { transaction?: unknown }).transaction)
              : null
          )
          .filter((b): b is string => typeof b === "string");

        const methodToReport: ExtensionRequestKind =
          item.kind === "signTransaction" && serializedTxs.length > 1
            ? "signAllTransactions"
            : item.kind;

        requestPayload = {
          walletName,
          walletMethod: methodToReport,
          base64Transactions: serializedTxs,
        };
      } else if (item.kind === "signMessage") {
        const firstMsg = (inputs[0] as { message?: unknown } | undefined)?.message;
        const msgBytes =
          firstMsg instanceof Uint8Array
            ? firstMsg
            : new Uint8Array(0);
        requestPayload = {
          walletName,
          walletMethod: "signMessage",
          signMessageBytesBase64: uint8ArrayToBase64(msgBytes),
          signMessagePreviewText: decodeUtf8Preview(msgBytes),
        };
      } else {
        requestPayload = {
          walletName,
          walletMethod: "connect",
        };
      }

      const decision = await hooks.interceptRequest(requestPayload);
      if (!decision.allow) {
        throw createUserRejectedError(decision.reason);
      }

      return (origFn as (...args: unknown[]) => Promise<unknown>).apply(
        invokeCtx,
        inputs
      );
    };

    if (assignMethod(featureObj, item.fnKey, wrappedFn)) {
      wrappedMethods.push(item.featureKey);
    } else {
      frozenMethods.push(item.featureKey);
    }
  }

  if (wrappedMethods.length > 0 && frozenMethods.length === 0) {
    tryMarkWrapped(walletObj);
  }

  if (frozenMethods.length > 0) {
    return { status: "LIMITED_FROZEN", wrappedMethods, frozenMethods };
  }
  if (wrappedMethods.length === 0) {
    return { status: "NOT_PRESENT", wrappedMethods, frozenMethods };
  }
  return { status: "WRAPPED", wrappedMethods, frozenMethods };
}
