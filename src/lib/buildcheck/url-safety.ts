import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
]);

/**
 * Checks whether an IPv4 or IPv6 literal belongs to loopback, link-local,
 * carrier-grade NAT, multicast, or private RFC1918/ULA ranges.
 */
export function isPrivateOrReservedIp(ipRaw: string): boolean {
  const cleanIp = ipRaw.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!net.isIP(cleanIp)) return false;

  if (cleanIp.startsWith("::ffff:")) {
    return isPrivateOrReservedIp(cleanIp.slice(7));
  }

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  // IPv6 loopback, unspecified, link-local, unique-local, multicast
  if (cleanIp === "::" || cleanIp === "::1") return true;
  if (cleanIp.startsWith("fe80:") || cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) {
    return true;
  }
  if (cleanIp.startsWith("ff")) return true;
  return false;
}

/**
 * Validates hostname lexically before DNS lookup.
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost") ||
    host.endsWith(".arpa")
  ) {
    return true;
  }
  if (isPrivateOrReservedIp(host)) return true;
  return false;
}

/**
 * Strictly validates that an arbitrary user URL targets public HTTP/HTTPS hosts
 * and does not resolve to local, loopback, cloud-metadata, or private networks.
 */
export async function assertSafePublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Blocked unsupported URL protocol: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (isBlockedHostname(host)) {
    throw new Error(`Blocked internal/private host: ${host}`);
  }

  // If raw IP literal passed, already checked above
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) {
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      throw new Error(`Unable to resolve DNS for host: ${host}`);
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error(`Blocked SSRF: ${host} resolves to non-public IP ${rec.address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Blocked")) {
      throw err;
    }
    throw new Error(`DNS resolution failed for ${host}.`);
  }

  return parsed;
}
