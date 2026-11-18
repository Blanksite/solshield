import { normalizeHostname } from "../domain-guard";
import type { ParsedTargetInput } from "./types";

const BASE58_MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40,64}$/i;
const GITHUB_RESERVED_ROOTS = new Set([
  "features",
  "enterprise",
  "marketplace",
  "explore",
  "topics",
  "trending",
  "collections",
  "sponsors",
  "login",
  "signup",
  "settings",
  "orgs",
  "users",
  "issues",
  "pulls",
  "search",
  "about",
  "pricing",
  "security",
  "solutions",
  "resources",
  "advisories",
  "customer-stories",
  "team",
  "why-github",
  "readme",
  "apps",
  "services",
  "site",
  "contact",
  "events",
  "blog",
  "newsroom",
  "education",
  "nonprofit",
  "open-source",
]);

/**
 * Extracts valid `owner/repo` pair from a GitHub URL if present.
 */
export function parseGitHubOwnerRepo(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return null;

    const parts = url.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (GITHUB_RESERVED_ROOTS.has(owner.toLowerCase())) return null;
    if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
      return null;
    }
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

/**
 * Parses an X / Twitter URL into handle and optional status tweet ID.
 */
export function parseXUrl(rawUrl: string): {
  handle?: string;
  tweetId?: string;
  canonicalUrl: string;
} | null {
  try {
    const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host !== "x.com" &&
      host !== "twitter.com" &&
      host !== "mobile.twitter.com" &&
      host !== "fxtwitter.com" &&
      host !== "vxtwitter.com"
    ) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    // Handle https://x.com/i/web/status/<id>
    if (parts[0] === "i" && parts[1] === "web" && parts[2] === "status" && /^\d{10,25}$/.test(parts[3] || "")) {
      return {
        tweetId: parts[3],
        canonicalUrl: `https://x.com/i/status/${parts[3]}`,
      };
    }

    const handle = parts[0].replace(/^@/, "");
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(handle)) return null;

    if (parts[1] === "status" && /^\d{10,25}$/.test(parts[2] || "")) {
      return {
        handle,
        tweetId: parts[2],
        canonicalUrl: `https://x.com/${handle}/status/${parts[2]}`,
      };
    }

    return {
      handle,
      canonicalUrl: `https://x.com/${handle}`,
    };
  } catch {
    return null;
  }
}

/**
 * Classifies universal BuildCheck input (Solana Mint CA, X URL, GitHub URL, or domain/URL).
 */
export function parseBuildCheckInput(raw: string): ParsedTargetInput {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Please paste a token CA (Solana or EVM/Robinhood), X link, GitHub repo, or website URL.");
  }

  // Extract first explicit URL or token if user pasted a multi-word snippet
  const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  const candidateToken = urlMatch ? urlMatch[0] : trimmed.split(/\s+/)[0];

  if (BASE58_MINT_REGEX.test(candidateToken)) {
    return {
      rawInput: trimmed,
      kind: "token_ca",
      mintAddress: candidateToken,
      contractAddress: candidateToken,
      chainFamily: "solana",
      normalizedUrl: `https://dexscreener.com/solana/${candidateToken}`,
      hostname: "dexscreener.com",
    };
  }

  if (EVM_ADDRESS_REGEX.test(candidateToken)) {
    return {
      rawInput: trimmed,
      kind: "evm_contract",
      mintAddress: candidateToken,
      contractAddress: candidateToken,
      chainFamily: "evm",
      normalizedUrl: `https://dexscreener.com/search?q=${candidateToken}`,
      hostname: "dexscreener.com",
    };
  }

  const normalizedHttp = /^https?:\/\//i.test(candidateToken)
    ? candidateToken
    : `https://${candidateToken}`;

  try {
    const candidateUrl = new URL(normalizedHttp);
    const candHost = candidateUrl.hostname.toLowerCase();

    // DexScreener URLs: https://dexscreener.com/<chain>/<address>
    if (candHost.includes("dexscreener.com")) {
      const parts = candidateUrl.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const chainPart = parts[0].toLowerCase();
        const addrPart = parts[1];
        if (chainPart === "solana" || BASE58_MINT_REGEX.test(addrPart)) {
          return {
            rawInput: trimmed,
            kind: "token_ca",
            mintAddress: addrPart,
            contractAddress: addrPart,
            chainFamily: "solana",
            normalizedUrl: `https://dexscreener.com/solana/${addrPart}`,
            hostname: "dexscreener.com",
          };
        }
        if (
          EVM_ADDRESS_REGEX.test(addrPart) ||
          ["robinhood", "ethereum", "eth", "arbitrum", "arb", "base", "polygon", "bsc"].includes(chainPart)
        ) {
          return {
            rawInput: trimmed,
            kind: "evm_contract",
            mintAddress: addrPart,
            contractAddress: addrPart,
            chainFamily: "evm",
            normalizedUrl: `https://dexscreener.com/${chainPart}/${addrPart}`,
            hostname: "dexscreener.com",
          };
        }
      }
    }

    if (candHost.includes("robinhoodchain.blockscout.com")) {
      const parts = candidateUrl.pathname.split("/").filter(Boolean);
      const addr = parts.find((p) => EVM_ADDRESS_REGEX.test(p));
      if (addr) {
        return {
          rawInput: trimmed,
          kind: "evm_contract",
          mintAddress: addr,
          contractAddress: addr,
          chainFamily: "evm",
          normalizedUrl: `https://robinhoodchain.blockscout.com/address/${addr}`,
          hostname: "robinhoodchain.blockscout.com",
        };
      }
    }
  } catch {
    // continue
  }

  const xParsed = parseXUrl(normalizedHttp);
  if (xParsed) {
    return {
      rawInput: trimmed,
      kind: xParsed.tweetId ? "x_post" : "x_profile",
      xHandle: xParsed.handle,
      xTweetId: xParsed.tweetId,
      normalizedUrl: xParsed.canonicalUrl,
      hostname: "x.com",
    };
  }

  const ghRepo = parseGitHubOwnerRepo(normalizedHttp);
  if (ghRepo) {
    return {
      rawInput: trimmed,
      kind: "github_repo",
      githubOwnerRepo: ghRepo,
      normalizedUrl: `https://github.com/${ghRepo}`,
      hostname: "github.com",
    };
  }

  const host = normalizeHostname(normalizedHttp);
  if (!host || !host.includes(".")) {
    throw new Error(
      "Could not recognize a valid token CA, GitHub repo, X link, or public domain."
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedHttp);
  } catch {
    throw new Error("Invalid URL format.");
  }

  return {
    rawInput: trimmed,
    kind: "website",
    normalizedUrl: parsedUrl.toString(),
    hostname: host,
  };
}

const EXCLUDED_WEBSITE_HOSTS = new Set([
  "t.co",
  "github.com",
  "www.github.com",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "pic.x.com",
  "pic.twitter.com",
  "githubcopilot.com",
  "githubstatus.com",
  "github.blog",
  "shields.io",
  "schemas.microsoft.com",
  "fonts.googleapis.com",
]);

const BARE_WEB_TLDS = new Set([
  "com",
  "org",
  "net",
  "io",
  "xyz",
  "ai",
  "app",
  "dev",
  "co",
  "so",
  "gg",
  "me",
  "fun",
  "finance",
  "protocol",
  "network",
  "cloud",
  "tech",
  "build",
  "club",
  "site",
  "online",
  "live",
  "info",
  "vc",
  "money",
  "trade",
  "exchange",
  "tools",
  "ink",
  "bot",
  "run",
  "pro",
  "id",
  "uk",
  "de",
  "eu",
  "ch",
  "sg",
  "jp",
  "ca",
  "au",
  "cc",
  "tv",
  "fm",
  "to",
  "zone",
  "wiki",
  "docs",
  "page",
  "link",
  "labs",
]);

const CODE_FILE_STEMS = new Set([
  "index",
  "main",
  "app",
  "server",
  "client",
  "config",
  "package",
  "tsconfig",
  "vite",
  "next",
  "README",
  "readme",
]);

/**
 * Returns true if the URL/host points to X/Twitter, t.co, GitHub, or build/asset infra rather than a project domain.
 */
export function isExcludedWebsiteHost(urlOrHost: string): boolean {
  const host = normalizeHostname(urlOrHost);
  if (!host) return true;
  if (EXCLUDED_WEBSITE_HOSTS.has(host)) return true;
  return (
    host.endsWith(".githubassets.com") ||
    host.endsWith(".githubusercontent.com") ||
    host.endsWith(".github.com") ||
    host.endsWith(".githubcopilot.com") ||
    host.endsWith(".twimg.com") ||
    host.endsWith(".w3.org") ||
    host.endsWith(".shields.io") ||
    host.endsWith(".x.com") ||
    host.endsWith(".twitter.com")
  );
}

/**
 * Returns true if the URL belongs to X/Twitter (or mirror/shortlink).
 */
export function isSocialXHost(urlOrHost: string): boolean {
  const host = normalizeHostname(urlOrHost);
  if (!host) return false;
  return (
    host === "x.com" ||
    host === "twitter.com" ||
    host === "mobile.twitter.com" ||
    host === "fxtwitter.com" ||
    host === "vxtwitter.com" ||
    host === "t.co" ||
    host === "pic.x.com" ||
    host === "pic.twitter.com" ||
    host.endsWith(".x.com") ||
    host.endsWith(".twitter.com") ||
    host.endsWith(".twimg.com")
  );
}

/**
 * Extracts scheme-less web domain references (e.g. `tryarchivum.com/try`) from X/social copy while filtering filenames and abbreviations.
 */
export function extractBareWebDomainsFromText(text: string): string[] {
  if (!text) return [];
  // Strip explicit http(s):// URLs and emails so we do not partially re-match their paths or domains.
  const scrubbed = text
    .replace(/https?:\/\/[^\s"'<>)\]]+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ");

  const matches =
    scrubbed.match(
      /(?<![/@.\w-])([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.([a-z]{2,12}))(\/[^\s"'<>)\]`,;!?]*)?/gi
    ) ?? [];

  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const clean = raw.replace(/[.,;!?`]+$/, "");
    const slashIdx = clean.indexOf("/");
    const hostPart = (slashIdx >= 0 ? clean.slice(0, slashIdx) : clean).toLowerCase();
    const pathPart = slashIdx >= 0 ? clean.slice(slashIdx) : "";
    const labels = hostPart.split(".");
    if (labels.length < 2) continue;
    const tld = labels[labels.length - 1];
    const stem = labels[labels.length - 2];
    if (!BARE_WEB_TLDS.has(tld)) continue;
    if (labels.length === 2 && !pathPart && CODE_FILE_STEMS.has(stem)) continue;
    // Skip two-letter ccTLD unless paired with a path or non-common-English lookalike? All TLDs in BARE_WEB_TLDS are curated web TLDs; guard `x.to` / `v1.0` (digits-only label already fails [a-z]{2,}).
    if (labels.some((l) => /^\d+$/.test(l)) && !pathPart) continue;
    if (isExcludedWebsiteHost(hostPart)) continue;

    try {
      const normalized = new URL(`https://${hostPart}${pathPart}`).toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        found.push(normalized);
      }
    } catch {
      // ignore invalid domain syntax
    }
  }
  return found.slice(0, 6);
}

/**
 * Extracts npm package names invoked via `npx`, `npm i/install/exec`, `pnpm add/dlx`, `bunx`, or `yarn add/dlx`.
 */
export function extractNpmPackagesFromText(text: string): string[] {
  if (!text) return [];
  const IGNORED_NPM_TOKENS = new Set([
    "init",
    "exec",
    "install",
    "add",
    "dlx",
    "global",
    "yes",
    "latest",
    "canary",
    "beta",
    "next",
    "create",
    "run",
    "help",
  ]);
  const pkgPattern =
    /(?:^|[\s`"'(\[])(?:npx|bunx|npm\s+(?:i|install|exec)|pnpm\s+(?:add|dlx|i|install)|yarn\s+(?:add|dlx))\s+(?:(?:--?[a-z0-9-]+(?:=[^\s`"'()[\]]+)?)\s+)*(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z][a-z0-9._-]{1,63})(?:@[^\s`"')[\]]+)?/gi;

  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(pkgPattern)) {
    const pkg = (match[1] || "").trim().replace(/[.,;!?`]+$/, "");
    if (!pkg || IGNORED_NPM_TOKENS.has(pkg.toLowerCase())) continue;
    if (!seen.has(pkg)) {
      seen.add(pkg);
      found.push(pkg);
    }
  }
  return found.slice(0, 4);
}

/**
 * Extracts outbound GitHub repos, X links, and Solana addresses from arbitrary text.
 */
export function extractEntitiesFromText(text: string): {
  githubRepos: string[];
  xUrls: string[];
  websiteUrls: string[];
  solanaAddresses: string[];
  evmAddresses: string[];
} {
  const githubSet = new Set<string>();
  const xSet = new Set<string>();
  const webSet = new Set<string>();
  const solSet = new Set<string>();
  const evmSet = new Set<string>();

  const urls = text.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];
  for (const rawUrl of urls) {
    const cleanUrl = rawUrl.replace(/[.,;!?]+$/, "");
    const gh = parseGitHubOwnerRepo(cleanUrl);
    if (gh) {
      githubSet.add(gh);
      continue;
    }
    const xp = parseXUrl(cleanUrl);
    if (xp) {
      xSet.add(xp.canonicalUrl);
      continue;
    }
    // Check if URL embeds an EVM contract address (e.g. Blockscout / Etherscan / DexScreener)
    const urlEvm = cleanUrl.match(/\b0x[a-fA-F0-9]{40,64}\b/i);
    if (urlEvm) {
      evmSet.add(urlEvm[0]);
    }
    if (!isExcludedWebsiteHost(cleanUrl)) {
      webSet.add(cleanUrl);
    }
  }

  // Scheme-less github.com/owner/repo references (e.g. X Note Tweets / bios)
  const bareGhMatches =
    text.match(/(?<![/@.\w-])(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/gi) ?? [];
  for (const bareGh of bareGhMatches) {
    const gh = parseGitHubOwnerRepo(bareGh.replace(/[.,;!?`]+$/, ""));
    if (gh) githubSet.add(gh);
  }

  // Scheme-less public project websites (e.g. tryarchivum.com/try)
  for (const bareWeb of extractBareWebDomainsFromText(text)) {
    const bareHost = normalizeHostname(bareWeb);
    const hasSameHost = Array.from(webSet).some((existing) => normalizeHostname(existing) === bareHost);
    if (!webSet.has(bareWeb) && (!hasSameHost || new URL(bareWeb).pathname !== "/")) {
      webSet.add(bareWeb);
    }
  }

  // EVM 0x contract address detection (Robinhood Chain, Ethereum, Arbitrum, Base)
  const evmMatches = text.match(/\b0x[a-fA-F0-9]{40,64}\b/gi) ?? [];
  for (const cand of evmMatches) {
    evmSet.add(cand);
  }

  const solMatches = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) ?? [];
  for (const cand of solMatches) {
    // Filter common hex/words or repeated characters
    if (/[0OlI]/.test(cand)) continue;
    if (new Set(cand).size < 10) continue;
    solSet.add(cand);
  }

  return {
    githubRepos: Array.from(githubSet).slice(0, 4),
    xUrls: Array.from(xSet).slice(0, 4),
    websiteUrls: Array.from(webSet).slice(0, 4),
    solanaAddresses: Array.from(solSet).slice(0, 4),
    evmAddresses: Array.from(evmSet).slice(0, 4),
  };
}

/**
 * Decodes common named and numeric HTML entities into plain UTF-8 characters.
 */
export function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code >= 32 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code >= 32 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : " ";
    });
}

/**
 * Strips scripts, styles, SVGs, comments, and markup tags from HTML to extract readable visible copy.
 */
export function extractVisibleTextFromHtml(rawHtml: string): string {
  const withoutBlocks = rawHtml
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  return decodeHtmlEntities(withoutBlocks.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
