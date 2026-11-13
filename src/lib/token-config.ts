import { PublicKey } from "@solana/web3.js";
import { SOLSHIELD_PROGRAM_ID } from "./anchor-idl";

/**
 * Official SolShield Token Contract Address (Solana Mint).
 * Can be overridden at build time via `NEXT_PUBLIC_TOKEN_CA`.
 */
export const DEFAULT_TOKEN_CA = "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx";

export const DEFAULT_TOKEN_SYMBOL = "$SHIELD";
export const DEFAULT_X_HANDLE = "@usesolshield";
export const DEFAULT_X_URL = "https://x.com/usesolshield";
export const GITHUB_REPO_URL = "https://github.com/Blanksite/solshield";

export interface SolShieldTokenConfig {
  symbol: string;
  tickerBare: string;
  ca: string;
  shortCa: string | null;
  isLive: boolean;
  xHandle: string;
  links: {
    x: string;
    github: string;
    devnetProgram: string;
    pumpfun: string | null;
    dexscreener: string | null;
    solscan: string | null;
    jupiter: string | null;
  };
}

export function normalizeTickerSymbol(raw?: string | null): string {
  const cleaned = (raw ?? "").trim().replace(/^\$+/, "").toUpperCase();
  return cleaned ? `$${cleaned}` : DEFAULT_TOKEN_SYMBOL;
}

export function validateSolanaMintAddress(raw?: string | null): string | null {
  const candidate = (raw ?? "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate)) {
    return null;
  }
  try {
    return new PublicKey(candidate).toBase58();
  } catch {
    return null;
  }
}

export function formatShortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Resolves token launch configuration strictly from build-time env variables
 * or repo constants (never from client URL query params to prevent CA spoofing).
 */
export function getSolShieldTokenConfig(overrides?: {
  ca?: string;
  symbol?: string;
  xUrl?: string;
  pumpfunUrl?: string;
  dexscreenerUrl?: string;
}): SolShieldTokenConfig {
  const rawCa =
    overrides?.ca ??
    (process.env.NEXT_PUBLIC_TOKEN_CA?.trim() || DEFAULT_TOKEN_CA);
  const validatedCa = validateSolanaMintAddress(rawCa);
  const symbol = normalizeTickerSymbol(
    overrides?.symbol ?? process.env.NEXT_PUBLIC_TOKEN_SYMBOL
  );
  const tickerBare = symbol.slice(1);
  const isLive = validatedCa !== null;
  const ca = validatedCa ?? "";

  const xUrl =
    (overrides?.xUrl ?? process.env.NEXT_PUBLIC_X_URL)?.trim() || DEFAULT_X_URL;
  const customPump =
    (overrides?.pumpfunUrl ?? process.env.NEXT_PUBLIC_PUMPFUN_URL)?.trim() ||
    null;
  const customDex =
    (
      overrides?.dexscreenerUrl ?? process.env.NEXT_PUBLIC_DEXSCREENER_URL
    )?.trim() || null;

  return {
    symbol,
    tickerBare,
    ca,
    shortCa: isLive ? formatShortAddress(ca) : null,
    isLive,
    xHandle: DEFAULT_X_HANDLE,
    links: {
      x: xUrl,
      github: GITHUB_REPO_URL,
      devnetProgram: `https://explorer.solana.com/address/${SOLSHIELD_PROGRAM_ID.toBase58()}?cluster=devnet`,
      pumpfun: isLive ? customPump || `https://pump.fun/coin/${ca}` : null,
      dexscreener: isLive
        ? customDex || `https://dexscreener.com/solana/${ca}`
        : null,
      solscan: isLive ? `https://solscan.io/token/${ca}` : null,
      jupiter: isLive ? `https://jup.ag/tokens/${ca}` : null,
    },
  };
}
