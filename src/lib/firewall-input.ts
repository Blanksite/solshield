export const SOLANA_MINT_CA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const TOKEN_EXPLORER_URL_RE =
  /^https?:\/\/(?:www\.)?(?:dexscreener\.com\/solana|pump\.fun\/coin|solscan\.io\/token|birdeye\.so\/token|gmgn\.ai\/sol\/token)\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:[/?#]|$)/i;

/**
 * Extracts a Solana token mint address when a user pastes a bare base58 CA or
 * common token explorer link (DexScreener, Pump.fun, Solscan, Birdeye, GMGN)
 * instead of a serialized Base64 transaction or Blink URL.
 */
export function extractSolanaMintFromFirewallInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (SOLANA_MINT_CA_RE.test(trimmed)) return trimmed;
  const explorerMatch = trimmed.match(TOKEN_EXPLORER_URL_RE);
  return explorerMatch ? explorerMatch[1] : null;
}

/**
 * Builds an HTTPS Solana Action (Blink) URL for SolShield's live swap endpoint.
 * Falls back to `https://sol-shield.xyz` on non-HTTPS origins (e.g. local dev) so
 * server-side SSRF validation in `inspectLiveBlinkUrl` succeeds out of the box.
 */
export function getLiveAuditSwapBlinkUrl(
  amount: string,
  origin?: string
): string {
  const amt = encodeURIComponent(amount.trim() || "0.5");
  const resolvedOrigin =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  if (resolvedOrigin.startsWith("https://")) {
    return `${resolvedOrigin.replace(/\/+$/, "")}/api/actions/audit-swap?amount=${amt}`;
  }
  return `https://sol-shield.xyz/api/actions/audit-swap?amount=${amt}`;
}
