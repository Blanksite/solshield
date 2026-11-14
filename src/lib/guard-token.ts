export const GUARD_COOKIE_NAME = "solshield_guard";
export const GUARD_TOKEN_TTL_SEC = 12 * 60 * 60; // 12 hours

const textEncoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function getSecretMaterial(): string {
  return (
    process.env.SOLSHIELD_API_SECRET?.trim() ||
    process.env.VENICE_API_KEY?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    "solshield-local-ephemeral-guard-secret"
  );
}

async function importHmacKey(): Promise<CryptoKey> {
  const secretBytes = textEncoder.encode(getSecretMaterial());
  const hashedSecret = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey(
    "raw",
    hashedSecret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Generates an HMAC-SHA256 signed session cookie token using Web Crypto API
 * (compatible with both Next.js Edge middleware and Node.js route handlers).
 */
export async function signGuardToken(
  nowSec = Math.floor(Date.now() / 1000)
): Promise<string> {
  const nonceBytes = new Uint8Array(12);
  crypto.getRandomValues(nonceBytes);
  const nonce = toHex(nonceBytes);
  const payload = `${nowSec}.${nonce}`;

  const key = await importHmacKey();
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(payload)
  );
  const sigHex = toHex(new Uint8Array(sigBuf));
  return `${payload}.${sigHex}`;
}

/**
 * Verifies integrity and expiration of a `solshield_guard` cookie token.
 */
export async function verifyGuardToken(
  token: string | undefined | null,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token || typeof token !== "string") return false;
  const parts = token.trim().split(".");
  if (parts.length !== 3) return false;

  const [issuedRaw, nonce, sigHex] = parts;
  if (!/^\d{9,13}$/.test(issuedRaw) || !/^[0-9a-f]{16,64}$/i.test(nonce)) {
    return false;
  }

  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) return false;
  if (issuedAt > nowSec + 60) return false;
  if (nowSec - issuedAt > GUARD_TOKEN_TTL_SEC) return false;

  const sigBytes = fromHex(sigHex);
  if (!sigBytes || sigBytes.length === 0) return false;

  try {
    const key = await importHmacKey();
    const payloadBytes = textEncoder.encode(`${issuedRaw}.${nonce}`);
    // Ensure plain ArrayBuffer view for strict WebCrypto TS compatibility
    const sigCopy = new Uint8Array(sigBytes.length);
    sigCopy.set(sigBytes);
    return await crypto.subtle.verify("HMAC", key, sigCopy, payloadBytes);
  } catch {
    return false;
  }
}

/**
 * Constant-time SHA-256 digest comparison for `SOLSHIELD_API_SECRET` header tokens.
 */
export async function verifyApiSecretHeader(
  rawHeader: string | null | undefined
): Promise<boolean> {
  const expected = process.env.SOLSHIELD_API_SECRET?.trim();
  if (!expected || !rawHeader) return false;

  const candidate = rawHeader.replace(/^Bearer\s+/i, "").trim();
  if (!candidate) return false;

  const [aBuf, bBuf] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(expected)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(candidate)),
  ]);
  const a = new Uint8Array(aBuf);
  const b = new Uint8Array(bBuf);

  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
