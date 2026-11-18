import type { WalletWatchCategory } from "./buildcheck/types";

export type WatchWalletChain =
  | "solana"
  | "robinhood"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "bsc";

export interface WatchChainMeta {
  key: WatchWalletChain;
  shortName: string;
  explorerUrl: string;
}

export const WATCH_CHAIN_META: Record<WatchWalletChain, WatchChainMeta> = {
  solana: {
    key: "solana",
    shortName: "Solana",
    explorerUrl: "https://solscan.io",
  },
  robinhood: {
    key: "robinhood",
    shortName: "Robinhood L2",
    explorerUrl: "https://robinhoodchain.blockscout.com",
  },
  ethereum: {
    key: "ethereum",
    shortName: "Ethereum",
    explorerUrl: "https://etherscan.io",
  },
  base: {
    key: "base",
    shortName: "Base",
    explorerUrl: "https://basescan.org",
  },
  arbitrum: {
    key: "arbitrum",
    shortName: "Arbitrum",
    explorerUrl: "https://arbiscan.io",
  },
  optimism: {
    key: "optimism",
    shortName: "Optimism",
    explorerUrl: "https://optimistic.etherscan.io",
  },
  polygon: {
    key: "polygon",
    shortName: "Polygon",
    explorerUrl: "https://polygonscan.com",
  },
  bsc: {
    key: "bsc",
    shortName: "BSC",
    explorerUrl: "https://bscscan.com",
  },
};

export interface TrackedWalletItem {
  id: string;
  address: string;
  chain: WatchWalletChain;
  label: string;
  tag: WalletWatchCategory | "custom";
  tokenSymbol?: string | null;
  tokenAddress?: string | null;
  addedAt: string;
  lastCheckedAt?: string | null;
  lastTxHash?: string | null;
  lastTxSummary?: string | null;
  lastNativeBalance?: string | null;
  lastNonce?: number | null;
}

export interface WatchedWalletActivityEvent {
  txHash: string;
  action: "swap" | "transfer" | "burn" | "claim" | "deploy" | "token_in" | "token_out" | "other";
  summary: string;
  timestamp: string | null;
  slotOrBlock: number | null;
  explorerUrl: string;
}

export interface WatchedWalletActivitySnapshot {
  address: string;
  chain: WatchWalletChain;
  networkName: string;
  nativeBalance: string | null;
  nonce: number | null;
  tokenBalancePct: number | null;
  latestTxHash: string | null;
  latestSummary: string | null;
  latestTimestamp: string | null;
  explorerUrl: string;
  events: WatchedWalletActivityEvent[];
  checkedAt: string;
  error?: string | null;
}

export const LOCAL_WATCHED_WALLETS_KEY = "solshield_watched_wallets_v1";
export const LOCAL_WATCHLIST_SYNC_KEY = "solshield_watchlist_sync_key_v1";
export const MAX_LOCAL_WATCHED_WALLETS = 30;
export const WATCHLIST_CHANGED_EVENT = "solshield:watchlist-changed";

const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidWatchedChain(raw: string): raw is WatchWalletChain {
  return raw in WATCH_CHAIN_META;
}

export function normalizeWatchedAddressClient(
  rawAddress: string,
  chainHint?: string | null
): { valid: boolean; address: string; chain: WatchWalletChain; error?: string } {
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    return { valid: false, address: "", chain: "solana", error: "Wallet address is required." };
  }

  if (/^0x[a-f0-9]{40}$/i.test(trimmed)) {
    const cleanHint = (chainHint || "").trim().toLowerCase();
    const chain: WatchWalletChain =
      cleanHint && cleanHint !== "solana" && isValidWatchedChain(cleanHint)
        ? cleanHint
        : "robinhood";
    return { valid: true, address: trimmed.toLowerCase(), chain };
  }

  if (SOLANA_BASE58_RE.test(trimmed)) {
    return { valid: true, address: trimmed, chain: "solana" };
  }

  return {
    valid: false,
    address: trimmed,
    chain: "solana",
    error: "Invalid Solana (Base58) or EVM (0x...) wallet address.",
  };
}

export function makeWatchedWalletId(address: string, chain: WatchWalletChain): string {
  const norm = chain === "solana" ? address.trim() : address.trim().toLowerCase();
  return `${chain}:${norm}`;
}

export function getChainDisplayName(chain: WatchWalletChain): string {
  return WATCH_CHAIN_META[chain]?.shortName || chain.toUpperCase();
}

export function getWatchedWalletExplorerUrl(
  address: string,
  chain: WatchWalletChain
): string {
  const meta = WATCH_CHAIN_META[chain];
  if (chain === "solana" || !address.startsWith("0x")) {
    return `https://solscan.io/account/${address}`;
  }
  return `${meta?.explorerUrl || "https://etherscan.io"}/address/${address}`;
}

export function readLocalWatchedWallets(): TrackedWalletItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_WATCHED_WALLETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TrackedWalletItem =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as TrackedWalletItem).address === "string" &&
            typeof (item as TrackedWalletItem).chain === "string" &&
            isValidWatchedChain((item as TrackedWalletItem).chain)
        )
    );
  } catch {
    return [];
  }
}

export function saveLocalWatchedWallets(items: TrackedWalletItem[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = items.slice(0, MAX_LOCAL_WATCHED_WALLETS);
    window.localStorage.setItem(LOCAL_WATCHED_WALLETS_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent(WATCHLIST_CHANGED_EVENT, { detail: trimmed }));
  } catch {
    // Ignore storage restriction
  }
}

export function getOrCreateLocalWatchlistSyncKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(LOCAL_WATCHLIST_SYNC_KEY);
    if (existing && /^[a-f0-9]{16,48}$/i.test(existing)) return existing;
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const created = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    window.localStorage.setItem(LOCAL_WATCHLIST_SYNC_KEY, created);
    return created;
  } catch {
    return "";
  }
}

export function syncWatchlistToServerBackground(items: TrackedWalletItem[]): void {
  if (typeof window === "undefined") return;
  const syncKey = getOrCreateLocalWatchlistSyncKey();
  if (!syncKey) return;
  void fetch("/api/wallet-tracker", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", syncKey, wallets: items }),
  }).catch(() => {});
}

export function addOrUpdateLocalWatchedWallet(input: {
  address: string;
  chain: WatchWalletChain;
  label?: string;
  tag?: TrackedWalletItem["tag"];
  tokenSymbol?: string | null;
  tokenAddress?: string | null;
}): TrackedWalletItem[] {
  const id = makeWatchedWalletId(input.address, input.chain);
  const current = readLocalWatchedWallets();
  const existing = current.find((w) => w.id === id);
  const defaultTagLabel =
    input.tag === "possible_mm"
      ? "Possible MM"
      : input.tag === "early_buyer"
        ? "Early Buyer"
        : input.tag === "cabal_linked"
          ? "Cabal Wallet"
          : input.tag === "dev_linked"
            ? "Dev Wallet"
            : input.tag === "top_holder"
              ? "Top Holder"
              : "Watched Wallet";

  const nextEntry: TrackedWalletItem = {
    id,
    address: input.chain === "solana" ? input.address.trim() : input.address.trim().toLowerCase(),
    chain: input.chain,
    label:
      input.label?.trim() ||
      existing?.label ||
      `${input.tokenSymbol ? `${input.tokenSymbol} · ` : ""}${defaultTagLabel}`,
    tag: input.tag || existing?.tag || "custom",
    tokenSymbol: input.tokenSymbol ?? existing?.tokenSymbol ?? null,
    tokenAddress: input.tokenAddress ?? existing?.tokenAddress ?? null,
    addedAt: existing?.addedAt || new Date().toISOString(),
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    lastTxHash: existing?.lastTxHash ?? null,
    lastTxSummary: existing?.lastTxSummary ?? null,
    lastNativeBalance: existing?.lastNativeBalance ?? null,
    lastNonce: existing?.lastNonce ?? null,
  };

  const nextList = [nextEntry, ...current.filter((w) => w.id !== id)].slice(
    0,
    MAX_LOCAL_WATCHED_WALLETS
  );
  saveLocalWatchedWallets(nextList);
  syncWatchlistToServerBackground(nextList);
  return nextList;
}

export function removeLocalWatchedWallet(
  address: string,
  chain: WatchWalletChain
): TrackedWalletItem[] {
  const id = makeWatchedWalletId(address, chain);
  const nextList = readLocalWatchedWallets().filter((w) => w.id !== id);
  saveLocalWatchedWallets(nextList);
  syncWatchlistToServerBackground(nextList);
  return nextList;
}
