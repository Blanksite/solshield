export type DomainGuardStatus =
  | "VERIFIED"
  | "DEV_LOCAL"
  | "UNVERIFIED"
  | "SUSPICIOUS"
  | "TYPOSQUAT_CRITICAL";

export interface VerifiedDappEntry {
  domain: string;
  brand: string;
  aliases?: string[];
  category: string;
}

export interface DomainEvaluation {
  hostname: string;
  status: DomainGuardStatus;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isAllowlisted: boolean;
  isPunycode: boolean;
  closestVerifiedBrand: string | null;
  matchedVerifiedDomain: string | null;
  reasons: string[];
}

export const VERIFIED_SOLANA_DAPPS: VerifiedDappEntry[] = [
  { domain: "sol-shield.xyz", brand: "SolShield", aliases: ["solshield"], category: "Security" },
  { domain: "jup.ag", brand: "Jupiter", aliases: ["jupiter", "jup"], category: "DEX" },
  { domain: "raydium.io", brand: "Raydium", aliases: ["raydium"], category: "DEX" },
  { domain: "orca.so", brand: "Orca", aliases: ["orca"], category: "DEX" },
  { domain: "pump.fun", brand: "Pump.fun", aliases: ["pumpfun", "pump"], category: "Launchpad" },
  { domain: "meteora.ag", brand: "Meteora", aliases: ["meteora"], category: "DeFi" },
  { domain: "magiceden.io", brand: "Magic Eden", aliases: ["magiceden"], category: "NFT" },
  { domain: "tensor.trade", brand: "Tensor", aliases: ["tensor"], category: "NFT" },
  { domain: "kamino.finance", brand: "Kamino", aliases: ["kamino"], category: "DeFi" },
  { domain: "marginfi.com", brand: "Marginfi", aliases: ["marginfi"], category: "DeFi" },
  { domain: "drift.trade", brand: "Drift", aliases: ["drift"], category: "Perps" },
  { domain: "jito.network", brand: "Jito", aliases: ["jito"], category: "Staking" },
  { domain: "marinade.finance", brand: "Marinade", aliases: ["marinade"], category: "Staking" },
  { domain: "sanctum.so", brand: "Sanctum", aliases: ["sanctum"], category: "LST" },
  { domain: "squads.so", brand: "Squads", aliases: ["squads"], category: "Multisig" },
  { domain: "phantom.app", brand: "Phantom", aliases: ["phantom"], category: "Wallet" },
  { domain: "solflare.com", brand: "Solflare", aliases: ["solflare"], category: "Wallet" },
  { domain: "backpack.app", brand: "Backpack", aliases: ["backpack"], category: "Wallet" },
  { domain: "solscan.io", brand: "Solscan", aliases: ["solscan"], category: "Explorer" },
  { domain: "explorer.solana.com", brand: "Solana Explorer", aliases: ["solana"], category: "Explorer" },
  { domain: "solana.com", brand: "Solana", aliases: ["solana"], category: "Official" },
  { domain: "solana.fm", brand: "SolanaFM", aliases: ["solanafm"], category: "Explorer" },
  { domain: "dial.to", brand: "Dialect Blinks", aliases: ["dialect"], category: "Blinks" },
  { domain: "birdeye.so", brand: "Birdeye", aliases: ["birdeye"], category: "Analytics" },
  { domain: "dexscreener.com", brand: "DexScreener", aliases: ["dexscreener"], category: "Analytics" },
  { domain: "venice.ai", brand: "Venice AI", aliases: ["venice"], category: "AI" },
  { domain: "builtinvenice.ai", brand: "Built in Venice", aliases: ["builtinvenice"], category: "Ecosystem" },
];

const PHISHING_KEYWORDS = [
  "airdrop",
  "claim",
  "reward",
  "rewards",
  "bonus",
  "drainer",
  "verify-wallet",
  "verifywallet",
  "connect-wallet",
  "rectify",
  "allocation",
  "free-mint",
  "freemint",
  "revoke-check",
];

const RISKY_TLDS = new Set([
  "top",
  "click",
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "buzz",
  "cfd",
  "icu",
  "pw",
  "support",
  "loan",
]);

/**
 * Strips protocol, auth, port, path, query string, and hash so ONLY the ASCII
 * hostname leaves the user's device during dual-lane reputation checks.
 */
export function normalizeHostname(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 253 || /\s/.test(trimmed)) {
    return null;
  }

  try {
    const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    if (!host || host.length > 253) return null;
    if (!/^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/i.test(host)) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

export function isDomainMatch(hostname: string, targetDomain: string): boolean {
  const cleanTarget = targetDomain.toLowerCase().replace(/^\.+|\.+$/g, "");
  return hostname === cleanTarget || hostname.endsWith(`.${cleanTarget}`);
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function getRegistrableStem(hostname: string): { sld: string; tld: string; fullBare: string } {
  const parts = hostname.split(".").filter(Boolean);
  const tld = parts.length > 1 ? parts[parts.length - 1] : "";
  const sld = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? hostname;
  return { sld, tld, fullBare: parts.join(".") };
}

function foldHomoglyphs(input: string): string {
  return input
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w");
}

export function evaluateDomainSafety(
  rawUrlOrHostname: string,
  options?: {
    trustedDomains?: string[];
    blockedDomains?: string[];
  }
): DomainEvaluation {
  const hostname = normalizeHostname(rawUrlOrHostname);
  if (!hostname) {
    return {
      hostname: rawUrlOrHostname.trim() || "unknown",
      status: "SUSPICIOUS",
      riskScore: 60,
      riskLevel: "HIGH",
      isAllowlisted: false,
      isPunycode: false,
      closestVerifiedBrand: null,
      matchedVerifiedDomain: null,
      reasons: ["Malformed or missing origin hostname."],
    };
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return {
      hostname,
      status: "DEV_LOCAL",
      riskScore: 10,
      riskLevel: "LOW",
      isAllowlisted: false,
      isPunycode: false,
      closestVerifiedBrand: null,
      matchedVerifiedDomain: null,
      reasons: ["Local development origin (127.0.0.1 / localhost)."],
    };
  }

  // User custom blocklist takes highest precedence
  for (const blocked of options?.blockedDomains ?? []) {
    const cleanBlocked = normalizeHostname(blocked);
    if (cleanBlocked && isDomainMatch(hostname, cleanBlocked)) {
      return {
        hostname,
        status: "TYPOSQUAT_CRITICAL",
        riskScore: 95,
        riskLevel: "CRITICAL",
        isAllowlisted: false,
        isPunycode: hostname.includes("xn--"),
        closestVerifiedBrand: null,
        matchedVerifiedDomain: null,
        reasons: [`Explicitly blocked in your custom blocklist (${cleanBlocked}).`],
      };
    }
  }

  // Curated verified allowlist
  const verifiedMatch = VERIFIED_SOLANA_DAPPS.find((entry) =>
    isDomainMatch(hostname, entry.domain)
  );
  if (verifiedMatch) {
    return {
      hostname,
      status: "VERIFIED",
      riskScore: 0,
      riskLevel: "LOW",
      isAllowlisted: true,
      isPunycode: false,
      closestVerifiedBrand: verifiedMatch.brand,
      matchedVerifiedDomain: verifiedMatch.domain,
      reasons: [
        `Verified Solana ecosystem domain (${verifiedMatch.brand} · ${verifiedMatch.category}).`,
      ],
    };
  }

  // User custom trusted allowlist
  for (const custom of options?.trustedDomains ?? []) {
    const cleanTrusted = normalizeHostname(custom);
    if (cleanTrusted && isDomainMatch(hostname, cleanTrusted)) {
      return {
        hostname,
        status: "VERIFIED",
        riskScore: 0,
        riskLevel: "LOW",
        isAllowlisted: true,
        isPunycode: hostname.includes("xn--"),
        closestVerifiedBrand: null,
        matchedVerifiedDomain: cleanTrusted,
        reasons: [`Trusted by your custom extension allowlist (${cleanTrusted}).`],
      };
    }
  }

  const reasons: string[] = [];
  let riskScore = 22; // Baseline unverified origin score
  const isPunycode = hostname.split(".").some((label) => label.startsWith("xn--"));
  if (isPunycode) {
    riskScore += 58;
    reasons.push("Internationalized punycode (`xn--`) domain detected — common homograph phishing vector.");
  }

  const { sld, tld } = getRegistrableStem(hostname);
  const foldedSld = foldHomoglyphs(sld);
  const foldedHost = foldHomoglyphs(hostname);

  let closestVerifiedBrand: string | null = null;
  let typosquatDetected = false;

  for (const entry of VERIFIED_SOLANA_DAPPS) {
    const entryStem = entry.domain.split(".")[0];
    const candidates = [entryStem, ...(entry.aliases ?? [])];

    for (const candidate of candidates) {
      if (candidate.length < 3) continue;

      const maxEdit = candidate.length <= 4 ? 1 : 2;
      const distRaw = levenshteinDistance(sld, candidate);
      const distFolded = levenshteinDistance(foldedSld, candidate);
      const minDist = Math.min(distRaw, distFolded);

      // Direct subdomain spoofing (e.g. jup.ag.claim-airdrop.xyz) or brand+hyphens (jupiter-airdrop.xyz)
      const spoofedDomainEmbed = hostname.includes(`${entry.domain}.`);
      const brandPrefixHybrid =
        (sld.includes(candidate) || foldedHost.includes(candidate)) &&
        candidate.length >= 4 &&
        sld !== candidate;

      if (minDist <= maxEdit || spoofedDomainEmbed || brandPrefixHybrid) {
        closestVerifiedBrand = entry.brand;
        typosquatDetected = true;
        riskScore += 55;
        reasons.push(
          `Resembles verified Solana domain ${entry.domain} (${entry.brand}) without matching its real root domain.`
        );
        break;
      }
    }
    if (typosquatDetected) break;
  }

  const matchedKeyword = PHISHING_KEYWORDS.find((kw) => hostname.includes(kw));
  if (matchedKeyword) {
    riskScore += 35;
    reasons.push(`Contains high-risk phishing keyword ("${matchedKeyword}") in hostname.`);
  }

  if (RISKY_TLDS.has(tld)) {
    riskScore += 20;
    reasons.push(`Uses elevated-risk top-level domain (.${tld}) frequently abused by drainer campaigns.`);
  }

  if (reasons.length === 0) {
    reasons.push("Origin is not in the curated verified Solana dApp allowlist.");
  }

  riskScore = Math.min(99, riskScore);
  const status: DomainGuardStatus = typosquatDetected || isPunycode || riskScore >= 70
    ? "TYPOSQUAT_CRITICAL"
    : riskScore >= 40
    ? "SUSPICIOUS"
    : "UNVERIFIED";

  const riskLevel: DomainEvaluation["riskLevel"] =
    riskScore >= 75
      ? "CRITICAL"
      : riskScore >= 50
      ? "HIGH"
      : riskScore >= 25
      ? "MEDIUM"
      : "LOW";

  return {
    hostname,
    status,
    riskScore,
    riskLevel,
    isAllowlisted: false,
    isPunycode,
    closestVerifiedBrand,
    matchedVerifiedDomain: null,
    reasons,
  };
}
