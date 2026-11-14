export interface UpstashRestConfig {
  url: string;
  token: string;
}

const textEncoder = new TextEncoder();

/**
 * Resolves shared Upstash / Vercel KV REST credentials from environment variables.
 * Supports both native Upstash and Vercel Marketplace KV naming conventions.
 */
export function getUpstashConfig(): UpstashRestConfig | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    "";
  if (!url || !token || !/^https?:\/\//i.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/**
 * Executes a single Upstash Redis REST command array (e.g. `["INCR", key]`).
 * Returns `null` when Redis is unconfigured or momentarily unreachable.
 */
export async function runUpstashCommand<T = unknown>(
  command: (string | number)[],
  timeoutMs = 2500
): Promise<T | null> {
  const cfg = getUpstashConfig();
  if (!cfg) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { result?: T; error?: string };
    if (payload.error) return null;
    return payload.result === undefined ? (null as T | null) : payload.result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes multiple Upstash Redis REST commands in a single `/pipeline` round-trip.
 */
export async function runUpstashPipeline(
  commands: (string | number)[][],
  timeoutMs = 2500
): Promise<unknown[] | null> {
  const cfg = getUpstashConfig();
  if (!cfg || commands.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(payload)) return null;
    return payload.map((item) => (item && !item.error ? item.result ?? null : null));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Privacy-preserving SHA-256 hex digest helper (Web Crypto compatible across Node & Edge).
 */
export async function sha256HexPrefix(
  input: string,
  hexLength = 16
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < hexLength; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out.slice(0, hexLength);
}
