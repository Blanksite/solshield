import type {
  EvmInterceptMethod,
  EvmRpcInspectionInput,
  EvmTransactionObjectInput,
} from "../../src/lib/evm-tx-parser";
import type {
  ExtensionRequestKind,
  SignInInspectionInput,
} from "../../src/lib/extension-verdict";

export const SOLSHIELD_WRAPPED_SYMBOL = Symbol.for("solshield.wrapped.v1");

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
    evmRequest?: EvmRpcInspectionInput;
    signMessageBytesBase64?: string;
    signMessagePreviewText?: string;
    signInInput?: SignInInspectionInput;
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

function decodeBase58ToBytes(encoded: string): Uint8Array | null {
  if (!encoded || encoded.length < 32) return null;
  const bytes: number[] = [0];
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i];
    const val = BASE58_ALPHABET.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < encoded.length && encoded[i] === "1"; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function extractTxAsBase64(candidate: unknown): string | null {
  if (!candidate) return null;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    const b58 = decodeBase58ToBytes(trimmed);
    if (b58 && b58.length > 0) {
      return uint8ArrayToBase64(b58);
    }
    // Check base64 fallback
    if (/^[A-Za-z0-9+/=]{32,}$/.test(trimmed)) {
      return trimmed;
    }
    return null;
  }
  return serializeTransactionLike(candidate);
}

function extractSignInInput(raw: unknown): SignInInspectionInput | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const input: SignInInspectionInput = {};
  if (typeof rec.domain === "string") input.domain = rec.domain;
  if (typeof rec.statement === "string") input.statement = rec.statement;
  if (typeof rec.uri === "string") input.uri = rec.uri;
  return input.domain || input.statement || input.uri ? input : undefined;
}

type LegacySignMethod =
  | "signTransaction"
  | "signAndSendTransaction"
  | "signAllTransactions"
  | "signMessage"
  | "signIn"
  | "connect";

function buildLegacyInterceptInput(
  walletName: string,
  methodName: LegacySignMethod,
  args: unknown[]
): Parameters<InterceptorHooks["interceptRequest"]>[0] {
  if (methodName === "signTransaction" || methodName === "signAndSendTransaction") {
    const serialized = serializeTransactionLike(args[0]);
    return {
      walletName,
      walletMethod: methodName,
      base64Transactions: serialized ? [serialized] : [],
    };
  }
  if (methodName === "signAllTransactions") {
    const txList = Array.isArray(args[0]) ? args[0] : [];
    const serializedList = txList
      .map((item) => serializeTransactionLike(item))
      .filter((item): item is string => typeof item === "string");
    return {
      walletName,
      walletMethod: "signAllTransactions",
      base64Transactions: serializedList,
    };
  }
  if (methodName === "signMessage") {
    const rawMsg = args[0];
    const msgBytes =
      rawMsg instanceof Uint8Array
        ? rawMsg
        : ArrayBuffer.isView(rawMsg)
        ? new Uint8Array(rawMsg.buffer, rawMsg.byteOffset, rawMsg.byteLength)
        : new Uint8Array(0);
    return {
      walletName,
      walletMethod: "signMessage",
      signMessageBytesBase64: uint8ArrayToBase64(msgBytes),
      signMessagePreviewText: decodeUtf8Preview(msgBytes),
    };
  }
  if (methodName === "signIn") {
    return {
      walletName,
      walletMethod: "signIn",
      signInInput: extractSignInInput(args[0]),
    };
  }
  return {
    walletName,
    walletMethod: "connect",
  };
}

function buildRpcRequestInterceptInput(
  walletName: string,
  rpcMethod: LegacySignMethod,
  params?: Record<string, unknown>
): Parameters<InterceptorHooks["interceptRequest"]>[0] {
  if (rpcMethod === "signTransaction" || rpcMethod === "signAndSendTransaction") {
    const txRaw = params?.transaction ?? params?.message;
    const b64 = extractTxAsBase64(txRaw);
    return {
      walletName,
      walletMethod: rpcMethod,
      base64Transactions: b64 ? [b64] : [],
    };
  }
  if (rpcMethod === "signAllTransactions") {
    const rawList = Array.isArray(params?.transactions)
      ? params.transactions
      : Array.isArray(params?.message)
      ? params.message
      : [];
    const serialized = rawList
      .map((item) => extractTxAsBase64(item))
      .filter((item): item is string => typeof item === "string");
    return {
      walletName,
      walletMethod: "signAllTransactions",
      base64Transactions: serialized,
    };
  }
  if (rpcMethod === "signMessage") {
    const msgParam = params?.message;
    if (msgParam instanceof Uint8Array) {
      return {
        walletName,
        walletMethod: "signMessage",
        signMessageBytesBase64: uint8ArrayToBase64(msgParam),
        signMessagePreviewText: decodeUtf8Preview(msgParam),
      };
    }
    return {
      walletName,
      walletMethod: "signMessage",
      signMessagePreviewText:
        typeof msgParam === "string" ? msgParam.slice(0, 260) : undefined,
    };
  }
  if (rpcMethod === "signIn") {
    return {
      walletName,
      walletMethod: "signIn",
      signInInput: extractSignInInput(params),
    };
  }
  return {
    walletName,
    walletMethod: "connect",
  };
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

  const signingMethods: LegacySignMethod[] = [
    "signTransaction",
    "signAndSendTransaction",
    "signAllTransactions",
    "signMessage",
    "signIn",
    "connect",
  ];

  for (const methodName of signingMethods) {
    const orig = target[methodName];
    if (typeof orig !== "function") continue;

    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const invokeCtx = this && this !== globalThis ? this : target;
      const verdictInput = buildLegacyInterceptInput(walletName, methodName, args);

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
        rpcMethod === "signMessage" ||
        rpcMethod === "signIn"
      ) {
        const decision = await hooks.interceptRequest(
          buildRpcRequestInterceptInput(walletName, rpcMethod, payload?.params)
        );
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

const INTERCEPTED_LEGACY_METHOD_SET = new Set<LegacySignMethod>([
  "signTransaction",
  "signAndSendTransaction",
  "signAllTransactions",
  "signMessage",
  "signIn",
  "connect",
]);

/**
 * Creates a transparent ES6 Proxy around an Object.freeze()'d legacy wallet provider
 * so configurable window/phantom properties still enforce SolShield pre-sign checks.
 */
export function createFrozenProviderProxy<T extends object>(
  provider: T,
  walletName: string,
  hooks: InterceptorHooks
): T {
  const cachedWrappers = new Map<string | symbol, unknown>();
  // Use a clean mutable shell as Proxy target so Object.freeze() invariants on
  // `provider` do not reject intercepted method replacements on the `get` trap.
  const proxyShell = {} as T;

  return new Proxy(proxyShell, {
    get(_target, prop) {
      if (prop === SOLSHIELD_WRAPPED_SYMBOL) {
        return true;
      }

      if (cachedWrappers.has(prop)) {
        return cachedWrappers.get(prop);
      }

      const rawVal = Reflect.get(provider, prop, provider);

      if (
        typeof prop === "string" &&
        INTERCEPTED_LEGACY_METHOD_SET.has(prop as LegacySignMethod) &&
        typeof rawVal === "function"
      ) {
        const methodName = prop as LegacySignMethod;
        const wrapped = async function (...args: unknown[]) {
          const decision = await hooks.interceptRequest(
            buildLegacyInterceptInput(walletName, methodName, args)
          );
          if (!decision.allow) {
            throw createUserRejectedError(decision.reason);
          }
          return (rawVal as (...a: unknown[]) => Promise<unknown>).apply(
            provider,
            args
          );
        };
        cachedWrappers.set(prop, wrapped);
        return wrapped;
      }

      if (prop === "request" && typeof rawVal === "function") {
        const wrappedRequest = async function (payload?: {
          method?: string;
          params?: Record<string, unknown>;
        }) {
          const rpcMethod = payload?.method;
          if (
            rpcMethod &&
            INTERCEPTED_LEGACY_METHOD_SET.has(rpcMethod as LegacySignMethod)
          ) {
            const decision = await hooks.interceptRequest(
              buildRpcRequestInterceptInput(
                walletName,
                rpcMethod as LegacySignMethod,
                payload?.params
              )
            );
            if (!decision.allow) {
              throw createUserRejectedError(decision.reason);
            }
          }
          return (rawVal as (p?: unknown) => Promise<unknown>).call(
            provider,
            payload
          );
        };
        cachedWrappers.set(prop, wrappedRequest);
        return wrappedRequest;
      }

      if (typeof rawVal === "function") {
        const bound = (rawVal as (...a: unknown[]) => unknown).bind(provider);
        cachedWrappers.set(prop, bound);
        return bound;
      }

      return rawVal;
    },
    set(_target, prop, value) {
      return Reflect.set(provider, prop, value, provider);
    },
    has(_target, prop) {
      return Reflect.has(provider, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(provider);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(provider, prop);
      return desc ? { ...desc, configurable: true } : undefined;
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(provider);
    },
  });
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
  "solana:signIn"?: {
    version?: string;
    signIn: (...inputs: unknown[]) => Promise<unknown>;
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
      featureKey: "solana:signIn",
      fnKey: "signIn",
      kind: "signIn",
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
      } else if (item.kind === "signIn") {
        requestPayload = {
          walletName,
          walletMethod: "signIn",
          signInInput: extractSignInInput(inputs[0]),
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

const INTERCEPTED_EVM_METHOD_SET = new Set<EvmInterceptMethod>([
  "eth_sendTransaction",
  "wallet_sendCalls",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "personal_sign",
  "eth_sign",
  "eth_requestAccounts",
  "wallet_requestPermissions",
]);

function isEvmAddressHex(val: unknown): val is string {
  return typeof val === "string" && /^0x[a-fA-F0-9]{40}$/.test(val.trim());
}

export function buildEvmRpcInterceptInput(
  walletName: string,
  method: EvmInterceptMethod,
  params: unknown,
  chainIdHint?: unknown
): Parameters<InterceptorHooks["interceptRequest"]>[0] {
  const arr = Array.isArray(params) ? params : [];
  let evmRequest: EvmRpcInspectionInput = {
    method,
    chainId:
      typeof chainIdHint === "string" || typeof chainIdHint === "number"
        ? chainIdHint
        : undefined,
  };

  if (method === "eth_sendTransaction") {
    const rawTx = (arr[0] && typeof arr[0] === "object"
      ? arr[0]
      : {}) as EvmTransactionObjectInput;
    evmRequest = {
      ...evmRequest,
      chainId: rawTx.chainId ?? evmRequest.chainId,
      fromAddress: typeof rawTx.from === "string" ? rawTx.from : undefined,
      transactions: [rawTx],
    };
  } else if (method === "wallet_sendCalls") {
    const batch = (arr[0] && typeof arr[0] === "object" ? arr[0] : {}) as {
      chainId?: string | number;
      from?: string;
      calls?: EvmTransactionObjectInput[];
    };
    evmRequest = {
      ...evmRequest,
      chainId: batch.chainId ?? evmRequest.chainId,
      fromAddress: typeof batch.from === "string" ? batch.from : undefined,
      transactions: Array.isArray(batch.calls) ? batch.calls : [],
    };
  } else if (
    method === "eth_signTypedData" ||
    method === "eth_signTypedData_v3" ||
    method === "eth_signTypedData_v4"
  ) {
    let fromAddr: string | undefined;
    let typedPayload: unknown;
    if (isEvmAddressHex(arr[0]) && arr[1] !== undefined) {
      fromAddr = arr[0];
      typedPayload = arr[1];
    } else if (isEvmAddressHex(arr[1]) && arr[0] !== undefined) {
      fromAddr = arr[1];
      typedPayload = arr[0];
    } else {
      typedPayload = arr[1] ?? arr[0];
    }
    const typedDataJson =
      typeof typedPayload === "string"
        ? typedPayload
        : typedPayload && typeof typedPayload === "object"
          ? JSON.stringify(typedPayload)
          : "{}";
    evmRequest = {
      ...evmRequest,
      fromAddress: fromAddr,
      typedDataJson,
    };
  } else if (method === "personal_sign") {
    let msgCandidate: unknown = arr[0];
    let fromAddr: string | undefined;
    if (isEvmAddressHex(arr[0]) && typeof arr[1] === "string") {
      fromAddr = arr[0];
      msgCandidate = arr[1];
    } else if (isEvmAddressHex(arr[1])) {
      fromAddr = arr[1];
    }
    evmRequest = {
      ...evmRequest,
      fromAddress: fromAddr,
      messageHexOrText:
        typeof msgCandidate === "string" ? msgCandidate : String(msgCandidate ?? ""),
    };
  } else if (method === "eth_sign") {
    evmRequest = {
      ...evmRequest,
      fromAddress: isEvmAddressHex(arr[0]) ? arr[0] : undefined,
      messageHexOrText:
        typeof arr[1] === "string"
          ? arr[1]
          : typeof arr[0] === "string"
            ? arr[0]
            : undefined,
    };
  }

  return {
    walletName,
    walletMethod: method,
    evmRequest,
  };
}

/**
 * Wraps an EIP-1193 Ethereum provider's `.request()` and legacy `.sendAsync()` / `.send()`
 * methods so EVM swaps, ERC-20 approvals, Permit/Permit2 signatures, Seaport drains,
 * and blind `eth_sign` calls are audited before wallet execution.
 */
export function wrapEthereumProvider(
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

  const origRequest = target.request;
  if (typeof origRequest === "function") {
    const wrappedRequest = async function (
      this: unknown,
      payload?: { method?: string; params?: unknown }
    ) {
      const invokeCtx = this && this !== globalThis ? this : target;
      const rpcMethod = payload?.method;
      if (
        typeof rpcMethod === "string" &&
        INTERCEPTED_EVM_METHOD_SET.has(rpcMethod as EvmInterceptMethod)
      ) {
        const decision = await hooks.interceptRequest(
          buildEvmRpcInterceptInput(
            walletName,
            rpcMethod as EvmInterceptMethod,
            payload?.params,
            target.chainId
          )
        );
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

  const origSendAsync = target.sendAsync;
  if (typeof origSendAsync === "function") {
    const wrappedSendAsync = function (
      this: unknown,
      payload: { method?: string; params?: unknown },
      cb: (err: unknown, res?: unknown) => void
    ) {
      const invokeCtx = this && this !== globalThis ? this : target;
      const rpcMethod = payload?.method;
      if (
        typeof rpcMethod === "string" &&
        INTERCEPTED_EVM_METHOD_SET.has(rpcMethod as EvmInterceptMethod)
      ) {
        void hooks
          .interceptRequest(
            buildEvmRpcInterceptInput(
              walletName,
              rpcMethod as EvmInterceptMethod,
              payload?.params,
              target.chainId
            )
          )
          .then((decision) => {
            if (!decision.allow) {
              cb(createUserRejectedError(decision.reason));
              return;
            }
            (origSendAsync as (p: unknown, c: unknown) => void).call(
              invokeCtx,
              payload,
              cb
            );
          })
          .catch((err) => cb(err));
        return;
      }
      (origSendAsync as (p: unknown, c: unknown) => void).call(
        invokeCtx,
        payload,
        cb
      );
    };
    if (assignMethod(target, "sendAsync", wrappedSendAsync)) {
      wrappedMethods.push("sendAsync");
    } else {
      frozenMethods.push("sendAsync");
    }
  }

  if (frozenMethods.length > 0 && wrappedMethods.length === 0) {
    return { status: "LIMITED_FROZEN", wrappedMethods, frozenMethods };
  }
  if (wrappedMethods.length > 0) {
    tryMarkWrapped(target);
  }
  if (wrappedMethods.length === 0) {
    return { status: "NOT_PRESENT", wrappedMethods, frozenMethods };
  }
  return {
    status: frozenMethods.length > 0 ? "LIMITED_FROZEN" : "WRAPPED",
    wrappedMethods,
    frozenMethods,
  };
}

/**
 * ES6 Proxy wrapper around Object.freeze()'d EIP-1193 Ethereum providers.
 */
export function createFrozenEthereumProxy<T extends object>(
  provider: T,
  walletName: string,
  hooks: InterceptorHooks
): T {
  const cachedWrappers = new Map<string | symbol, unknown>();
  const proxyShell = {} as T;

  return new Proxy(proxyShell, {
    get(_target, prop) {
      if (prop === SOLSHIELD_WRAPPED_SYMBOL) return true;
      if (cachedWrappers.has(prop)) return cachedWrappers.get(prop);

      const rawVal = Reflect.get(provider, prop, provider);

      if (prop === "request" && typeof rawVal === "function") {
        const wrappedRequest = async function (payload?: {
          method?: string;
          params?: unknown;
        }) {
          const rpcMethod = payload?.method;
          if (
            typeof rpcMethod === "string" &&
            INTERCEPTED_EVM_METHOD_SET.has(rpcMethod as EvmInterceptMethod)
          ) {
            const chainHint = Reflect.get(provider, "chainId", provider);
            const decision = await hooks.interceptRequest(
              buildEvmRpcInterceptInput(
                walletName,
                rpcMethod as EvmInterceptMethod,
                payload?.params,
                chainHint
              )
            );
            if (!decision.allow) {
              throw createUserRejectedError(decision.reason);
            }
          }
          return (rawVal as (p?: unknown) => Promise<unknown>).call(
            provider,
            payload
          );
        };
        cachedWrappers.set(prop, wrappedRequest);
        return wrappedRequest;
      }

      if (typeof rawVal === "function") {
        const bound = (rawVal as (...a: unknown[]) => unknown).bind(provider);
        cachedWrappers.set(prop, bound);
        return bound;
      }
      return rawVal;
    },
    set(_target, prop, value) {
      return Reflect.set(provider, prop, value, provider);
    },
    has(_target, prop) {
      return Reflect.has(provider, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(provider);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(provider, prop);
      return desc ? { ...desc, configurable: true } : undefined;
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(provider);
    },
  });
}
