import { NextResponse } from "next/server";

export type CorsPolicy = "web" | "extension" | "actions";

const BASE_ALLOWED_WEB_HOSTS = new Set(["sol-shield.xyz", "www.sol-shield.xyz"]);

function extractHost(rawUrlOrHost: string | undefined | null): string | null {
  if (!rawUrlOrHost) return null;
  const trimmed = rawUrlOrHost.trim();
  if (!trimmed) return null;
  try {
    const parsed = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function isTrustedDeployHostSuffix(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() || "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "sol-shield.xyz" ||
    hostname.endsWith(".sol-shield.xyz") ||
    hostname.endsWith(".up.railway.app") ||
    (hostname.endsWith(".vercel.app") &&
      (hostname.includes("solshield") || hostname.includes("sol-shield")))
  );
}

export function getTrustedWebHosts(req?: Request): Set<string> {
  const hosts = new Set<string>(BASE_ALLOWED_WEB_HOSTS);

  const envHosts = [
    extractHost(process.env.NEXT_PUBLIC_APP_URL),
    extractHost(process.env.RAILWAY_PUBLIC_DOMAIN),
    extractHost(process.env.VERCEL_URL),
    ...(process.env.SOLSHIELD_ALLOWED_HOSTS || "")
      .split(",")
      .map((item) => extractHost(item)),
  ];
  for (const h of envHosts) {
    if (h) hosts.add(h);
  }

  if (req) {
    // Never trust arbitrary X-Forwarded-Host / Host headers outside verified deploy suffixes
    // or explicit request-URL canonical hosts configured in trusted environments.
    const reqUrlHost = extractHost(req.url);
    if (reqUrlHost && (isTrustedDeployHostSuffix(reqUrlHost) || hosts.has(reqUrlHost))) {
      hosts.add(reqUrlHost);
    }
    const headerHost = extractHost(req.headers.get("host"));
    if (headerHost && (isTrustedDeployHostSuffix(headerHost) || hosts.has(headerHost))) {
      hosts.add(headerHost);
    }
  }

  return hosts;
}

/**
 * Checks if a browser Origin header matches a trusted SolShield frontend host or localhost.
 */
export function isAllowedWebOrigin(origin: string, req?: Request): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }

  const host = parsed.host.toLowerCase();
  return getTrustedWebHosts(req).has(host);
}

/**
 * Checks if an Origin belongs to a valid Chromium browser extension (`chrome-extension://<32-char-id>`).
 * When `SOLSHIELD_ALLOWED_EXTENSION_IDS` is set, only explicitly allowlisted extension IDs are accepted.
 */
export function isExtensionOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const match = origin.trim().match(/^chrome-extension:\/\/([a-p]{32})$/i);
  if (!match) return false;

  const allowlistRaw = process.env.SOLSHIELD_ALLOWED_EXTENSION_IDS?.trim();
  if (!allowlistRaw) return true;

  const allowedIds = allowlistRaw
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  if (allowedIds.length === 0) return true;
  return allowedIds.includes(match[1].toLowerCase());
}

export function buildCorsHeaders(
  req?: Request,
  policy: CorsPolicy = "web"
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-SolShield-Api-Key",
    Vary: "Origin",
  };

  if (policy === "actions") {
    headers["Access-Control-Allow-Origin"] = "*";
    return headers;
  }

  const origin = req?.headers.get("origin")?.trim();
  if (origin) {
    if (
      isAllowedWebOrigin(origin, req) ||
      (policy === "extension" && isExtensionOrigin(origin))
    ) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
  }

  return headers;
}

export function corsOptionsResponse(
  req?: Request,
  policy: CorsPolicy = "web"
): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(req, policy),
  });
}

export function corsJson(
  payload: unknown,
  init?: {
    status?: number;
    req?: Request;
    policy?: CorsPolicy;
    headers?: Record<string, string>;
  }
): NextResponse {
  const corsHeaders = buildCorsHeaders(init?.req, init?.policy ?? "web");
  return NextResponse.json(payload, {
    status: init?.status ?? 200,
    headers: {
      ...corsHeaders,
      ...(init?.headers ?? {}),
    },
  });
}
