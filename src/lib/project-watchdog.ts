import { assertSafePublicHttpUrl } from "./buildcheck/url-safety";
import { evaluateDomainSafety, normalizeHostname } from "./domain-guard";
import {
  inspectEvmContractSecurity,
  isValidEvmAddress,
  normalizeEvmAddress,
  resolveEvmChainKey,
} from "./evm-security";
import { scanSolanaTokenMint } from "./token-scanner";
import {
  isValidWatchedChain,
  type WatchWalletChain,
} from "./wallet-watch-client";
import { normalizeWatchedAddress } from "./wallet-watch-tracker";

export type ProjectWatchStatus = "INTACT" | "SHIPPING" | "GHOSTING" | "MUTATED";

export type ProjectMutationCode =
  | "PROXY_UPGRADED"
  | "HONEYPOT_ACTIVATED"
  | "SELL_TAX_SPIKED"
  | "ADMIN_BACKDOOR_ADDED"
  | "SOLANA_AUTHORITY_MUTATED"
  | "LP_DRAINED"
  | "WEBSITE_OFFLINE"
  | "WEBSITE_PHISHING_REDIRECT"
  | "GITHUB_PRIVATIZED"
  | "GITHUB_STALE_GHOSTING"
  | "NEW_SHIP_COMMIT";

export interface ProjectMutationEvent {
  code: ProjectMutationCode;
  layer: "onchain" | "web" | "github";
  severity: "CRITICAL" | "WARNING" | "POSITIVE";
  title: string;
  detail: string;
  detectedAt: string;
}

export interface ProjectWatchSnapshot {
  checkedAt: string;
  onchain: {
    queried: boolean;
    chainFamily: "solana" | "evm" | "none";
    networkName: string | null;
    isDeployed: boolean | null;
    isProxy: boolean | null;
    implementationAddress: string | null;
    honeypotStatus: string | null;
    sellTaxPct: number | null;
    blacklistable: boolean | null;
    mintable: boolean | null;
    solMintAuthority: string | null;
    solFreezeAuthority: string | null;
    liquidityUsd: number | null;
    riskScore: number | null;
    error?: string | null;
  };
  web: {
    queried: boolean;
    url: string | null;
    online: boolean | null;
    httpStatus: number | null;
    finalHostname: string | null;
    domainStatus: string | null;
    title: string | null;
    error?: string | null;
  };
  github: {
    queried: boolean;
    repo: string | null;
    accessible: boolean | null;
    httpStatus: number | null;
    stars: number | null;
    pushedAt: string | null;
    daysSincePush: number | null;
    error?: string | null;
  };
}

export interface WatchedProjectRecord {
  id: string;
  label: string;
  contractAddress: string | null;
  chain: WatchWalletChain;
  websiteUrl: string | null;
  githubRepo: string | null;
  reportId: string | null;
  addedAt: string;
  status: ProjectWatchStatus;
  baseline: ProjectWatchSnapshot;
  latest: ProjectWatchSnapshot;
  mutations: ProjectMutationEvent[];
}

export interface ProbeProjectTarget {
  contractAddress?: string | null;
  chain?: string | null;
  websiteUrl?: string | null;
  githubRepo?: string | null;
}

const GITHUB_REPO_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export function normalizeGithubRepoSlug(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(
    /github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i
  );
  const candidate = (urlMatch ? urlMatch[1] : trimmed)
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  return GITHUB_REPO_RE.test(candidate) ? candidate : null;
}

export function normalizeWebsiteTarget(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function makeWatchedProjectId(target: {
  contractAddress?: string | null;
  chain?: string | null;
  websiteUrl?: string | null;
  githubRepo?: string | null;
}): string {
  const addr = target.contractAddress?.trim().toLowerCase();
  if (addr) {
    const ch = (target.chain || (addr.startsWith("0x") ? "robinhood" : "solana")).toLowerCase();
    return `proj_${ch}_${addr.slice(0, 20)}`;
  }
  const repo = normalizeGithubRepoSlug(target.githubRepo);
  if (repo) {
    return `proj_gh_${repo.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 28)}`;
  }
  const host = normalizeHostname(target.websiteUrl || "") || "unknown";
  return `proj_web_${host.replace(/[^a-z0-9]/g, "_").slice(0, 28)}`;
}

async function fetchDexLiquidityUsd(
  contractAddress: string,
  fetchImpl: typeof fetch
): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const res = await fetchImpl(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(contractAddress)}`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      pairs?: Array<{ liquidity?: { usd?: number } }>;
    };
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    let best = 0;
    for (const p of pairs) {
      const usd = Number(p?.liquidity?.usd ?? 0);
      if (Number.isFinite(usd) && usd > best) best = usd;
    }
    return best > 0 ? Math.round(best) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes all 3 Proof-of-Ship layers (On-Chain Bytecode/LP, Live Web HTTP/Domain,
 * and GitHub Repo visibility/commit freshness) in parallel with strict SSRF & timeout guards.
 */
export async function probeProjectWatchdogSnapshot(
  target: ProbeProjectTarget,
  options?: { fetchImpl?: typeof fetch }
): Promise<ProjectWatchSnapshot> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const checkedAt = new Date().toISOString();

  const rawAddr = target.contractAddress?.trim() || "";
  const rawChain =
    target.chain && isValidWatchedChain(target.chain)
      ? target.chain
      : undefined;
  const normAddr = rawAddr ? normalizeWatchedAddress(rawAddr, rawChain) : null;
  const websiteUrl = normalizeWebsiteTarget(target.websiteUrl);
  const githubRepo = normalizeGithubRepoSlug(target.githubRepo);

  const onchainPromise = (async (): Promise<ProjectWatchSnapshot["onchain"]> => {
    if (!normAddr || !normAddr.valid) {
      return {
        queried: false,
        chainFamily: "none",
        networkName: null,
        isDeployed: null,
        isProxy: null,
        implementationAddress: null,
        honeypotStatus: null,
        sellTaxPct: null,
        blacklistable: null,
        mintable: null,
        solMintAuthority: null,
        solFreezeAuthority: null,
        liquidityUsd: null,
        riskScore: null,
      };
    }

    if (isValidEvmAddress(normAddr.address)) {
      const evmChain = resolveEvmChainKey(normAddr.chain);
      try {
        const [evm, liqUsd] = await Promise.all([
          inspectEvmContractSecurity(normalizeEvmAddress(normAddr.address), evmChain, {
            timeoutMs: 4200,
            fetchImpl,
          }),
          fetchDexLiquidityUsd(normAddr.address, fetchImpl),
        ]);
        return {
          queried: true,
          chainFamily: "evm",
          networkName: evm.networkName,
          isDeployed: evm.isDeployed,
          isProxy: evm.isProxy,
          implementationAddress: evm.implementationAddress,
          honeypotStatus: evm.honeypotStatus,
          sellTaxPct: evm.sellTaxPct,
          blacklistable: evm.capabilities.blacklistable,
          mintable: evm.capabilities.mintable,
          solMintAuthority: null,
          solFreezeAuthority: null,
          liquidityUsd: liqUsd,
          riskScore: evm.riskScore,
        };
      } catch (err) {
        return {
          queried: true,
          chainFamily: "evm",
          networkName: evmChain,
          isDeployed: null,
          isProxy: null,
          implementationAddress: null,
          honeypotStatus: null,
          sellTaxPct: null,
          blacklistable: null,
          mintable: null,
          solMintAuthority: null,
          solFreezeAuthority: null,
          liquidityUsd: null,
          riskScore: null,
          error: err instanceof Error ? err.message : "EVM probe error",
        };
      }
    }

    try {
      const [sol, liqUsd] = await Promise.all([
        scanSolanaTokenMint(normAddr.address),
        fetchDexLiquidityUsd(normAddr.address, fetchImpl),
      ]);
      return {
        queried: true,
        chainFamily: "solana",
        networkName: "Solana Mainnet",
        isDeployed: true,
        isProxy: false,
        implementationAddress: null,
        honeypotStatus: sol.freezeAuthority ? "FREEZE_ACTIVE" : "CLEAN",
        sellTaxPct: 0,
        blacklistable: sol.freezeAuthority !== null,
        mintable: sol.mintAuthority !== null,
        solMintAuthority: sol.mintAuthority,
        solFreezeAuthority: sol.freezeAuthority,
        liquidityUsd: liqUsd,
        riskScore: sol.riskScore,
      };
    } catch (err) {
      return {
        queried: true,
        chainFamily: "solana",
        networkName: "Solana Mainnet",
        isDeployed: null,
        isProxy: null,
        implementationAddress: null,
        honeypotStatus: null,
        sellTaxPct: null,
        blacklistable: null,
        mintable: null,
        solMintAuthority: null,
        solFreezeAuthority: null,
        liquidityUsd: null,
        riskScore: null,
        error: err instanceof Error ? err.message : "Solana probe error",
      };
    }
  })();

  const webPromise = (async (): Promise<ProjectWatchSnapshot["web"]> => {
    if (!websiteUrl) {
      return {
        queried: false,
        url: null,
        online: null,
        httpStatus: null,
        finalHostname: null,
        domainStatus: null,
        title: null,
      };
    }

    try {
      const safeUrl = await assertSafePublicHttpUrl(websiteUrl);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500);
      try {
        const res = await fetchImpl(safeUrl.toString(), {
          method: "GET",
          redirect: "follow",
          signal: ctrl.signal,
          headers: { "User-Agent": "SolShieldWatchdog/1.0" },
        });
        const finalUrl = res.url || safeUrl.toString();
        const domEval = evaluateDomainSafety(finalUrl);
        const bodyText = await res.text().catch(() => "");
        const titleMatch = bodyText.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
        return {
          queried: true,
          url: safeUrl.toString(),
          online: res.status >= 200 && res.status < 400,
          httpStatus: res.status,
          finalHostname: domEval.hostname,
          domainStatus: domEval.status,
          title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : null,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const domEval = evaluateDomainSafety(websiteUrl);
      return {
        queried: true,
        url: websiteUrl,
        online: false,
        httpStatus: null,
        finalHostname: domEval.hostname,
        domainStatus: domEval.status,
        title: null,
        error: err instanceof Error ? err.message : "Website unreachable",
      };
    }
  })();

  const githubPromise = (async (): Promise<ProjectWatchSnapshot["github"]> => {
    if (!githubRepo) {
      return {
        queried: false,
        repo: null,
        accessible: null,
        httpStatus: null,
        stars: null,
        pushedAt: null,
        daysSincePush: null,
      };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "SolShieldWatchdog/1.0",
      };
      if (process.env.GITHUB_TOKEN?.trim()) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
      }
      const res = await fetchImpl(`https://api.github.com/repos/${githubRepo}`, {
        signal: ctrl.signal,
        headers,
      });
      if (!res.ok) {
        return {
          queried: true,
          repo: githubRepo,
          accessible: false,
          httpStatus: res.status,
          stars: null,
          pushedAt: null,
          daysSincePush: null,
          error: res.status === 404 ? "Repository deleted or made private (404)" : `HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as {
        stargazers_count?: number;
        pushed_at?: string;
      };
      const pushedAt = typeof data.pushed_at === "string" ? data.pushed_at : null;
      const daysSincePush = pushedAt
        ? Math.max(
            0,
            Math.floor((Date.now() - Date.parse(pushedAt)) / (1000 * 60 * 60 * 24))
          )
        : null;
      return {
        queried: true,
        repo: githubRepo,
        accessible: true,
        httpStatus: res.status,
        stars: typeof data.stargazers_count === "number" ? data.stargazers_count : null,
        pushedAt,
        daysSincePush,
      };
    } catch (err) {
      return {
        queried: true,
        repo: githubRepo,
        accessible: null,
        httpStatus: null,
        stars: null,
        pushedAt: null,
        daysSincePush: null,
        error: err instanceof Error ? err.message : "GitHub probe failed",
      };
    } finally {
      clearTimeout(timer);
    }
  })();

  const [onchain, web, github] = await Promise.all([
    onchainPromise,
    webPromise,
    githubPromise,
  ]);

  return { checkedAt, onchain, web, github };
}

/**
 * Compares a baseline Proof-of-Ship snapshot against a newly probed snapshot
 * and emits typed CRITICAL / WARNING / POSITIVE mutation events.
 */
export function detectProjectMutations(
  prev: ProjectWatchSnapshot,
  next: ProjectWatchSnapshot
): ProjectMutationEvent[] {
  const events: ProjectMutationEvent[] = [];
  const detectedAt = next.checkedAt || new Date().toISOString();

  // 1. On-Chain mutations
  if (prev.onchain.queried && next.onchain.queried) {
    if (
      prev.onchain.implementationAddress &&
      next.onchain.implementationAddress &&
      prev.onchain.implementationAddress.toLowerCase() !==
        next.onchain.implementationAddress.toLowerCase()
    ) {
      events.push({
        code: "PROXY_UPGRADED",
        layer: "onchain",
        severity: "CRITICAL",
        title: "EIP-1967 Proxy Implementation Changed",
        detail: `Implementation rotated from ${prev.onchain.implementationAddress.slice(0, 10)}... to ${next.onchain.implementationAddress.slice(0, 10)}.... Re-audit immediately before interacting.`,
        detectedAt,
      });
    } else if (prev.onchain.isProxy === false && next.onchain.isProxy === true) {
      events.push({
        code: "PROXY_UPGRADED",
        layer: "onchain",
        severity: "CRITICAL",
        title: "Proxy Delegate Pattern Detected Post-Baseline",
        detail: "Contract now resolves through an upgradeable proxy slot.",
        detectedAt,
      });
    }

    if (
      prev.onchain.honeypotStatus !== "HONEYPOT" &&
      next.onchain.honeypotStatus === "HONEYPOT"
    ) {
      events.push({
        code: "HONEYPOT_ACTIVATED",
        layer: "onchain",
        severity: "CRITICAL",
        title: "Honeypot Activated Post-Launch",
        detail: "Simulated exit trade now reverts or is blocked on-chain.",
        detectedAt,
      });
    }

    if (
      typeof prev.onchain.sellTaxPct === "number" &&
      typeof next.onchain.sellTaxPct === "number" &&
      (next.onchain.sellTaxPct - prev.onchain.sellTaxPct >= 10 ||
        (prev.onchain.sellTaxPct < 25 && next.onchain.sellTaxPct >= 25))
    ) {
      events.push({
        code: "SELL_TAX_SPIKED",
        layer: "onchain",
        severity: "CRITICAL",
        title: `Sell Tax Spiked (${prev.onchain.sellTaxPct}% -> ${next.onchain.sellTaxPct}%)`,
        detail: "Contract exit tax jumped materially compared to the monitored baseline.",
        detectedAt,
      });
    }

    if (
      (prev.onchain.blacklistable === false && next.onchain.blacklistable === true) ||
      (prev.onchain.mintable === false && next.onchain.mintable === true)
    ) {
      events.push({
        code: "ADMIN_BACKDOOR_ADDED",
        layer: "onchain",
        severity: "CRITICAL",
        title: "Privileged Admin Selector Appeared",
        detail: "Contract capabilities now expose blacklist() or mint() control.",
        detectedAt,
      });
    }

    if (
      prev.onchain.chainFamily === "solana" &&
      ((prev.onchain.solFreezeAuthority !== next.onchain.solFreezeAuthority &&
        next.onchain.solFreezeAuthority !== null) ||
        (prev.onchain.solMintAuthority !== next.onchain.solMintAuthority &&
          next.onchain.solMintAuthority !== null))
    ) {
      events.push({
        code: "SOLANA_AUTHORITY_MUTATED",
        layer: "onchain",
        severity: "CRITICAL",
        title: "Solana Mint/Freeze Authority Rotated",
        detail: "Active authority state mutated compared to baseline.",
        detectedAt,
      });
    }

    if (
      typeof prev.onchain.liquidityUsd === "number" &&
      typeof next.onchain.liquidityUsd === "number" &&
      prev.onchain.liquidityUsd >= 2000 &&
      next.onchain.liquidityUsd < prev.onchain.liquidityUsd * 0.5
    ) {
      const dropPct = Math.round(
        ((prev.onchain.liquidityUsd - next.onchain.liquidityUsd) /
          prev.onchain.liquidityUsd) *
          100
      );
      events.push({
        code: "LP_DRAINED",
        layer: "onchain",
        severity: "CRITICAL",
        title: `DEX Liquidity Dropped -${dropPct}%`,
        detail: `Pool depth fell from $${prev.onchain.liquidityUsd.toLocaleString()} to $${next.onchain.liquidityUsd.toLocaleString()}.`,
        detectedAt,
      });
    }
  }

  // 2. Live Web mutations
  if (prev.web.queried && next.web.queried) {
    if (prev.web.online === true && next.web.online === false) {
      events.push({
        code: "WEBSITE_OFFLINE",
        layer: "web",
        severity: "CRITICAL",
        title: "Live Website Went Offline",
        detail: `${next.web.url || "Project site"} returned ${next.web.httpStatus ? `HTTP ${next.web.httpStatus}` : next.web.error || "unreachable"}.`,
        detectedAt,
      });
    }

    if (
      next.web.domainStatus === "TYPOSQUAT_CRITICAL" ||
      (prev.web.finalHostname &&
        next.web.finalHostname &&
        prev.web.finalHostname !== next.web.finalHostname &&
        next.web.domainStatus !== "VERIFIED")
    ) {
      events.push({
        code: "WEBSITE_PHISHING_REDIRECT",
        layer: "web",
        severity: "CRITICAL",
        title: "Suspicious Domain Redirect Detected",
        detail: `Destination shifted from ${prev.web.finalHostname} to ${next.web.finalHostname} (${next.web.domainStatus}).`,
        detectedAt,
      });
    }
  }

  // 3. GitHub Code mutations
  if (prev.github.queried && next.github.queried) {
    if (prev.github.accessible === true && next.github.accessible === false) {
      events.push({
        code: "GITHUB_PRIVATIZED",
        layer: "github",
        severity: "CRITICAL",
        title: "GitHub Repository Made Private or Deleted",
        detail: `${next.github.repo} is no longer publicly accessible (${next.github.httpStatus || "404"}).`,
        detectedAt,
      });
    } else if (
      typeof next.github.daysSincePush === "number" &&
      next.github.daysSincePush >= 14 &&
      (prev.github.daysSincePush === null || prev.github.daysSincePush < 14)
    ) {
      events.push({
        code: "GITHUB_STALE_GHOSTING",
        layer: "github",
        severity: "WARNING",
        title: `Repository Inactive (${next.github.daysSincePush}d Without Commits)`,
        detail: `${next.github.repo} has had zero commits pushed for ${next.github.daysSincePush} days.`,
        detectedAt,
      });
    } else if (
      prev.github.pushedAt &&
      next.github.pushedAt &&
      Date.parse(next.github.pushedAt) > Date.parse(prev.github.pushedAt)
    ) {
      events.push({
        code: "NEW_SHIP_COMMIT",
        layer: "github",
        severity: "POSITIVE",
        title: "New Ship Activity Detected on GitHub",
        detail: `${next.github.repo} pushed fresh commits at ${new Date(next.github.pushedAt).toUTCString()}.`,
        detectedAt,
      });
    }
  }

  return events;
}

export function deriveWatchdogStatus(
  snapshot: ProjectWatchSnapshot,
  mutations: ProjectMutationEvent[]
): ProjectWatchStatus {
  if (mutations.some((m) => m.severity === "CRITICAL")) {
    return "MUTATED";
  }
  if (
    mutations.some((m) => m.severity === "WARNING") ||
    snapshot.web.online === false ||
    snapshot.github.accessible === false ||
    (typeof snapshot.github.daysSincePush === "number" &&
      snapshot.github.daysSincePush >= 21)
  ) {
    return "GHOSTING";
  }
  if (mutations.some((m) => m.severity === "POSITIVE")) {
    return "SHIPPING";
  }
  return "INTACT";
}
