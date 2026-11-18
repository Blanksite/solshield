import { Connection, PublicKey } from "@solana/web3.js";
import { evaluateDomainSafety, normalizeHostname } from "../domain-guard";
import { inspectEvmContractSecurity, type EvmChainKey } from "../evm-security";
import { scanSolanaTokenMint } from "../token-scanner";
import {
  decodeHtmlEntities,
  extractEntitiesFromText,
  extractNpmPackagesFromText,
  extractVisibleTextFromHtml,
  isExcludedWebsiteHost,
  parseGitHubOwnerRepo,
  parseXUrl,
} from "./input-parser";
import { collectTokenDeepIntel } from "./token-forensics";
import { collectEvmWalletsToWatch } from "./wallet-watch";
import {
  fetchRobinhoodChainErc20Metadata,
  verifyRobinhoodChainDeployment,
  verifyRobinhoodStatus,
} from "./robinhood-verifier";
import type {
  ChainTokenIntelReport,
  DexPairSummary,
  DomainIntelReport,
  GitHubForensicReport,
  HolderAuditCheckRow,
  HoldersDeepAnalysis,
  XPostIntelReport,
} from "./types";

const SOLANA_MAINNET_RPC =
  process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5500
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "SolShield-BuildCheck/1.0",
        ...headers,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs = 5500
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, status: res.status, text: "" };
    }
    const text = await res.text();
    return { ok: true, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

function finalizeGitHubForensicReport(params: {
  ownerRepo: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  isFork: boolean;
  forkParent: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  ageDays: number | null;
  ownerAccountAgeDays: number | null;
  commitTimestamps: number[];
  authors: Set<string>;
  files: string[];
  topLanguages: string[];
  extraSignals?: GitHubForensicReport["signals"];
}): GitHubForensicReport {
  const {
    ownerRepo,
    url,
    description,
    stars,
    forks,
    openIssues,
    isFork,
    forkParent,
    createdAt,
    updatedAt,
    ageDays,
    ownerAccountAgeDays,
    commitTimestamps,
    authors,
    files,
    topLanguages,
    extraSignals = [],
  } = params;

  // Sliding 4-hour window burst detector
  let maxCluster = 0;
  const sortedTimestamps = [...commitTimestamps].sort((a, b) => a - b);
  for (let i = 0; i < sortedTimestamps.length; i += 1) {
    let cluster = 0;
    for (let j = i; j < sortedTimestamps.length; j += 1) {
      if (sortedTimestamps[j] - sortedTimestamps[i] <= 4 * 3_600_000) {
        cluster += 1;
      }
    }
    if (cluster > maxCluster) maxCluster = cluster;
  }
  const burstCommitRatio =
    sortedTimestamps.length > 0
      ? Number((maxCluster / sortedTimestamps.length).toFixed(2))
      : 0;

  const lowerFiles = files.map((f) => f.toLowerCase());
  const hasTestsOrCi = lowerFiles.some((f) =>
    ["test", "tests", "__tests__", ".github", "vitest.config.ts", "jest.config.js"].includes(
      f
    )
  );
  const hasPackageManifest = lowerFiles.some((f) =>
    ["package.json", "cargo.toml", "pyproject.toml", "go.mod", "anchor.toml"].includes(f)
  );

  const signals: GitHubForensicReport["signals"] = [...extraSignals];
  if (isFork) {
    signals.push({
      code: "REPO_IS_FORK",
      severity: "WARNING",
      message: `Repository is forked from ${forkParent || "an upstream repo"}.`,
    });
  }
  if (ageDays !== null && ageDays <= 7) {
    signals.push({
      code: "BRAND_NEW_REPO",
      severity: "WARNING",
      message: `Repository was created only ${ageDays} day(s) ago.`,
    });
  } else if (ageDays !== null && ageDays >= 30) {
    signals.push({
      code: "ESTABLISHED_REPO_AGE",
      severity: "INFO",
      message: `Repository age is ${ageDays} days with ${sortedTimestamps.length} recent sampled commits.`,
    });
  }
  if (sortedTimestamps.length >= 3 && burstCommitRatio >= 0.85 && (ageDays ?? 0) <= 14) {
    signals.push({
      code: "SINGLE_BURST_PUSH",
      severity: "CRITICAL",
      message: `${Math.round(burstCommitRatio * 100)}% of sampled commits landed in a single 4-hour window on a fresh repo.`,
    });
  }
  if (!hasPackageManifest && files.length <= 4) {
    signals.push({
      code: "README_OR_STUB_ONLY",
      severity: "CRITICAL",
      message: `Only ${files.length} top-level entry(s) and no build manifest (package.json / Cargo.toml / pyproject.toml).`,
    });
  }
  if (hasTestsOrCi) {
    signals.push({
      code: "TESTS_OR_CI_PRESENT",
      severity: "INFO",
      message: "Repository contains automated test suites or CI configuration.",
    });
  }
  if (ownerAccountAgeDays !== null && ownerAccountAgeDays <= 14) {
    signals.push({
      code: "FRESH_GITHUB_OWNER",
      severity: "WARNING",
      message: `GitHub owner account is only ${ownerAccountAgeDays} day(s) old.`,
    });
  }

  return {
    queried: true,
    exists: true,
    fullName: ownerRepo,
    url,
    description,
    stars,
    forks,
    openIssues,
    isFork,
    forkParent,
    createdAt,
    updatedAt,
    ageDays,
    ownerAccountAgeDays,
    recentCommitCount: sortedTimestamps.length,
    uniqueAuthorCount: authors.size,
    burstCommitRatio,
    topLanguages,
    topLevelFiles: files.slice(0, 14),
    hasTestsOrCi,
    hasPackageManifest,
    signals,
  };
}

/**
 * Fallback verifier used ONLY when GitHub REST API is rate-limited (403/429)
 * or transiently unreachable from shared egress IPs.
 */
async function collectGitHubFromPublicWeb(
  ownerRepo: string
): Promise<GitHubForensicReport | null> {
  const repoUrl = `https://github.com/${ownerRepo}`;
  const [htmlRes, atomRes] = await Promise.all([
    fetchTextWithTimeout(repoUrl),
    fetchTextWithTimeout(`${repoUrl}/commits.atom`),
  ]);

  if (!htmlRes.ok || !htmlRes.text) {
    return null;
  }

  const html = htmlRes.text;
  const escapedOwnerRepo = ownerRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileHrefRe = new RegExp(
    `href=["']\\/${escapedOwnerRepo}\\/(?:blob|tree)\\/[^/"']+\\/([^/"'?#]+)["']`,
    "gi"
  );
  const filesSet = new Set<string>();
  for (const m of html.matchAll(fileHrefRe)) {
    try {
      const name = decodeURIComponent(m[1]).trim();
      if (name) filesSet.add(name);
    } catch {
      // Ignore malformed path segment
    }
  }

  const ogDescMatch = html.match(
    /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i
  );
  const rawDesc = ogDescMatch?.[1] ? decodeHtmlEntities(ogDescMatch[1]).trim() : null;
  const description =
    rawDesc && !rawDesc.startsWith("Contribute to ") ? rawDesc : null;

  const forkMatch = html.match(/forked from\s*<a[^>]*href=["']\/([^"']+)["']/i);
  const isFork = Boolean(forkMatch);
  const forkParent = forkMatch?.[1] || null;

  const starsMatch =
    html.match(/id=["']repo-stars-counter-star["'][^>]*>([\d,.kKmM]+)</i) ||
    html.match(/title=["']([\d,]+)["'][^>]*id=["']repo-stars-counter-star["']/i);
  const parseCompactCount = (raw?: string) => {
    if (!raw) return 0;
    const cleaned = raw.trim().toLowerCase().replace(/,/g, "");
    if (cleaned.endsWith("k")) return Math.round(Number.parseFloat(cleaned) * 1000) || 0;
    if (cleaned.endsWith("m")) return Math.round(Number.parseFloat(cleaned) * 1_000_000) || 0;
    return Number.parseInt(cleaned, 10) || 0;
  };

  const langSet = new Set<string>();
  for (const m of html.matchAll(
    /(?:itemprop=["']programmingLanguage["']|color-fg-default text-bold mr-1["'])[^>]*>([^<]+)</gi
  )) {
    const lang = decodeHtmlEntities(m[1]).trim();
    if (lang && lang.length <= 32) langSet.add(lang);
  }

  const authors = new Set<string>();
  const commitTimestamps: number[] = [];
  let updatedAt: string | null = null;
  if (atomRes.ok && atomRes.text) {
    for (const entry of atomRes.text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
      const block = entry[1];
      const upd = block.match(/<updated>([^<]+)<\/updated>/i)?.[1];
      if (upd) {
        if (!updatedAt) updatedAt = upd;
        const ms = Date.parse(upd);
        if (Number.isFinite(ms)) commitTimestamps.push(ms);
      }
      const author = block.match(/<author>\s*<name>([^<]+)<\/name>/i)?.[1]?.trim();
      if (author) authors.add(author.toLowerCase());
    }
  }

  return finalizeGitHubForensicReport({
    ownerRepo,
    url: repoUrl,
    description,
    stars: parseCompactCount(starsMatch?.[1]),
    forks: 0,
    openIssues: 0,
    isFork,
    forkParent,
    createdAt: null,
    updatedAt,
    ageDays: null,
    ownerAccountAgeDays: null,
    commitTimestamps,
    authors,
    files: Array.from(filesSet),
    topLanguages: Array.from(langSet).slice(0, 4),
    extraSignals: [
      {
        code: "GITHUB_PUBLIC_WEB_FALLBACK",
        severity: "INFO",
        message:
          "Verified repository tree & recent commits via public GitHub HTML/Atom fallback (REST API rate-limited).",
      },
    ],
  });
}

/**
 * Inspects a GitHub repository's age, fork lineage, commit timing bursts,
 * unique authors, language mix, and structural presence of tests/CI.
 */
export async function collectGitHubForensics(
  ownerRepo: string
): Promise<GitHubForensicReport> {
  const [owner] = ownerRepo.split("/");
  const ghHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  if (ghToken) {
    ghHeaders.Authorization = `Bearer ${ghToken}`;
  }

  const baseUrl = `https://api.github.com/repos/${ownerRepo}`;
  const [repoRes, commitsRes, contentsRes, langsRes, userRes] = await Promise.all([
    fetchJsonWithTimeout<{
      full_name?: string;
      html_url?: string;
      description?: string | null;
      stargazers_count?: number;
      forks_count?: number;
      open_issues_count?: number;
      fork?: boolean;
      parent?: { full_name?: string };
      created_at?: string;
      pushed_at?: string;
    }>(baseUrl, ghHeaders),
    fetchJsonWithTimeout<
      Array<{
        commit?: {
          author?: { name?: string; email?: string; date?: string };
        };
        author?: { login?: string } | null;
      }>
    >(`${baseUrl}/commits?per_page=30`, ghHeaders),
    fetchJsonWithTimeout<Array<{ name?: string; type?: string }>>(
      `${baseUrl}/contents`,
      ghHeaders
    ),
    fetchJsonWithTimeout<Record<string, number>>(`${baseUrl}/languages`, ghHeaders),
    fetchJsonWithTimeout<{ created_at?: string }>(
      `https://api.github.com/users/${encodeURIComponent(owner)}`,
      ghHeaders
    ),
  ]);

  if (!repoRes.ok || !repoRes.data) {
    if (repoRes.status === 403 || repoRes.status === 429 || repoRes.status === 0) {
      const publicWebReport = await collectGitHubFromPublicWeb(ownerRepo);
      if (publicWebReport) {
        return publicWebReport;
      }
    }

    return {
      queried: true,
      exists: false,
      fullName: ownerRepo,
      url: `https://github.com/${ownerRepo}`,
      description: null,
      stars: 0,
      forks: 0,
      openIssues: 0,
      isFork: false,
      forkParent: null,
      createdAt: null,
      updatedAt: null,
      ageDays: null,
      ownerAccountAgeDays: null,
      recentCommitCount: 0,
      uniqueAuthorCount: 0,
      burstCommitRatio: 0,
      topLanguages: [],
      topLevelFiles: [],
      hasTestsOrCi: false,
      hasPackageManifest: false,
      signals: [
        {
          code: "REPO_NOT_FOUND_OR_RATE_LIMITED",
          severity: "WARNING",
          message:
            repoRes.status === 404
              ? `GitHub repository ${ownerRepo} does not exist or is private.`
              : `GitHub API returned HTTP ${repoRes.status || "timeout"} for ${ownerRepo}.`,
        },
      ],
      error: `GitHub HTTP ${repoRes.status || "timeout"}`,
    };
  }

  const repo = repoRes.data;
  const nowMs = Date.now();
  const createdMs = repo.created_at ? Date.parse(repo.created_at) : NaN;
  const ownerCreatedMs = userRes.data?.created_at
    ? Date.parse(userRes.data.created_at)
    : NaN;
  const ageDays = Number.isFinite(createdMs)
    ? Math.max(0, Math.round((nowMs - createdMs) / 86_400_000))
    : null;
  const ownerAccountAgeDays = Number.isFinite(ownerCreatedMs)
    ? Math.max(0, Math.round((nowMs - ownerCreatedMs) / 86_400_000))
    : null;

  const commits = Array.isArray(commitsRes.data) ? commitsRes.data : [];
  const authors = new Set<string>();
  const commitTimestamps: number[] = [];

  for (const c of commits) {
    const login =
      c.author?.login || c.commit?.author?.email || c.commit?.author?.name || "unknown";
    authors.add(login.toLowerCase());
    const ts = c.commit?.author?.date ? Date.parse(c.commit.author.date) : NaN;
    if (Number.isFinite(ts)) commitTimestamps.push(ts);
  }

  const files = Array.isArray(contentsRes.data)
    ? contentsRes.data.map((item) => item.name || "").filter(Boolean)
    : [];
  const topLanguages = langsRes.data
    ? Object.entries(langsRes.data)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([lang]) => lang)
    : [];

  return finalizeGitHubForensicReport({
    ownerRepo: repo.full_name || ownerRepo,
    url: repo.html_url || `https://github.com/${ownerRepo}`,
    description: repo.description ?? null,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    openIssues: repo.open_issues_count ?? 0,
    isFork: Boolean(repo.fork),
    forkParent: repo.parent?.full_name ?? null,
    createdAt: repo.created_at ?? null,
    updatedAt: repo.pushed_at ?? null,
    ageDays,
    ownerAccountAgeDays,
    commitTimestamps,
    authors,
    files,
    topLanguages,
  });
}

function normalizeXProfileAvatar(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.includes("_normal.") ? trimmed.replace("_normal.", "_400x400.") : trimmed;
}

const ALERT_BOT_ACCOUNT_RE = /\b(alerts?|bots?|signals?|calls?|scanner|snipers?|trackers?)\b/i;

/**
 * Discovers official token socials, avatar image, website, and GitHub by querying X API
 * using contract address as search query, rejecting retweets, alert bots, and unmatched random users.
 */
async function discoverTokenSocialsFromX(
  contractAddress: string,
  symbol?: string
): Promise<{
  imageUrl: string | null;
  twitterUrl: string | null;
  websiteUrl: string | null;
  githubUrl: string | null;
}> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return { imageUrl: null, twitterUrl: null, websiteUrl: null, githubUrl: null };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(
      `${contractAddress} -is:retweet`
    )}&tweet.fields=text,entities,author_id&expansions=author_id&user.fields=name,username,profile_image_url,description,entities`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { imageUrl: null, twitterUrl: null, websiteUrl: null, githubUrl: null };

    const data = (await res.json()) as {
      data?: Array<{
        author_id?: string;
        text?: string;
        entities?: { urls?: Array<{ expanded_url?: string }> };
      }>;
      includes?: {
        users?: Array<{
          id?: string;
          name?: string;
          username?: string;
          profile_image_url?: string;
          description?: string;
          entities?: { url?: { urls?: Array<{ expanded_url?: string }> } };
        }>;
      };
    };

    const users = data.includes?.users || [];
    const tweets = data.data || [];
    const caPrefix = contractAddress.toLowerCase().slice(0, 12);
    const cleanSym = (symbol || "").trim().replace(/^\$+/, "").toLowerCase();

    // Only accept users whose profile/bio explicitly ties them to this CA or $SYMBOL and are not alert/call bots
    const eligibleUsers = users.filter(
      (u) => !ALERT_BOT_ACCOUNT_RE.test(`${u.username || ""} ${u.name || ""} ${u.description || ""}`)
    );

    const bestUser = eligibleUsers.find((u) => {
      const desc = (u.description || "").toLowerCase();
      const uname = (u.username || "").toLowerCase();
      const cleanUname = uname.replace(/^(use|try|get)[_-]?/, "");
      const hasDollarSymbol =
        cleanSym.length >= 2 &&
        new RegExp(`(^|[^a-z0-9])\\$${cleanSym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i").test(
          desc
        );
      return (
        desc.includes(caPrefix) ||
        hasDollarSymbol ||
        (cleanSym.length >= 3 && (uname === cleanSym || cleanUname === cleanSym))
      );
    });

    if (!bestUser) return { imageUrl: null, twitterUrl: null, websiteUrl: null, githubUrl: null };

    const avatar = normalizeXProfileAvatar(bestUser.profile_image_url);
    const twitterUrl = bestUser.username ? `https://x.com/${bestUser.username}` : null;
    const rawProfileSite = bestUser.entities?.url?.urls?.[0]?.expanded_url || null;
    let websiteUrl =
      rawProfileSite && !/t\.me|telegram\.me|discord\.gg/i.test(rawProfileSite)
        ? rawProfileSite
        : null;
    let githubUrl: string | null = null;

    for (const tw of tweets.filter((t) => t.author_id === bestUser.id)) {
      if (tw.entities?.urls) {
        for (const u of tw.entities.urls) {
          const exp = u.expanded_url || "";
          if (exp.includes("github.com") && !githubUrl) {
            githubUrl = exp;
          }
          if (
            !websiteUrl &&
            exp &&
            !isExcludedWebsiteHost(exp) &&
            !/t\.me|telegram\.me|discord\.gg|dexscreener\.com|geckoterminal\.com|blockscout\.com/i.test(
              exp
            )
          ) {
            websiteUrl = exp;
          }
        }
      }
    }

    return { imageUrl: avatar, twitterUrl, websiteUrl, githubUrl };
  } catch {
    return { imageUrl: null, twitterUrl: null, websiteUrl: null, githubUrl: null };
  }
}

/**
 * Queries on-chain Solana mint health via `scanSolanaTokenMint`, live DexScreener
 * liquidity/socials, and recent address transaction count.
 */
export async function collectChainTokenIntel(
  mintAddress: string
): Promise<ChainTokenIntelReport> {
  const isEvm = mintAddress.startsWith("0x");

  if (isEvm) {
    let dexData: {
      pairs?: Array<{
        chainId?: string;
        dexId?: string;
        url?: string;
        pairAddress?: string;
        baseToken?: { address?: string; name?: string; symbol?: string };
        quoteToken?: { address?: string; name?: string; symbol?: string };
        liquidity?: { usd?: number };
        fdv?: number;
        volume?: { h24?: number };
        pairCreatedAt?: number;
        info?: {
          imageUrl?: string;
          websites?: Array<{ url?: string }>;
          socials?: Array<{ type?: string; url?: string }>;
        };
      }>;
    } | null = null;

    const [dexTokenRes, hoodDeploy] = await Promise.allSettled([
      fetchJsonWithTimeout<{
        pairs?: Array<{
          chainId?: string;
          dexId?: string;
          url?: string;
          pairAddress?: string;
          baseToken?: { address?: string; name?: string; symbol?: string };
          quoteToken?: { address?: string; name?: string; symbol?: string };
          liquidity?: { usd?: number };
          fdv?: number;
          volume?: { h24?: number };
          pairCreatedAt?: number;
          info?: {
            imageUrl?: string;
            websites?: Array<{ url?: string }>;
            socials?: Array<{ type?: string; url?: string }>;
          };
        }>;
      }>(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mintAddress)}`),
      verifyRobinhoodChainDeployment(mintAddress),
    ]);

    let isDeployedOnHood =
      hoodDeploy.status === "fulfilled" && hoodDeploy.value.isDeployed;
    let geckoPriceUsd: number | null = null;
    let geckoTxStats: {
      buys1h?: number | null;
      sells1h?: number | null;
      buys24h?: number | null;
      sells24h?: number | null;
    } = {};

    if (dexTokenRes.status === "fulfilled" && dexTokenRes.value.ok && dexTokenRes.value.data?.pairs?.length) {
      dexData = dexTokenRes.value.data;
    } else {
      // Fallback search: resolves pair addresses, pool hashes, or tickers
      const dexSearchRes = await fetchJsonWithTimeout<{
        pairs?: Array<{
          chainId?: string;
          dexId?: string;
          url?: string;
          pairAddress?: string;
          baseToken?: { address?: string; name?: string; symbol?: string };
          quoteToken?: { address?: string; name?: string; symbol?: string };
          liquidity?: { usd?: number };
          fdv?: number;
          volume?: { h24?: number };
          pairCreatedAt?: number;
          info?: {
            imageUrl?: string;
            websites?: Array<{ url?: string }>;
            socials?: Array<{ type?: string; url?: string }>;
          };
        }>;
      }>(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(mintAddress)}`);
      if (dexSearchRes.ok && dexSearchRes.data?.pairs?.length) {
        dexData = dexSearchRes.data;
      } else {
        // Fallback 2: GeckoTerminal pool lookup (direct Robinhood L2 token pools + global search)
        type GeckoPoolItem = {
          id?: string;
          attributes?: {
            address?: string;
            name?: string;
            pool_created_at?: string;
            base_token_price_usd?: string | null;
            fdv_usd?: string | null;
            reserve_in_usd?: string | null;
            volume_usd?: { h24?: string | null };
            transactions?: {
              h1?: { buys?: number; sells?: number };
              h24?: { buys?: number; sells?: number };
            };
          };
          relationships?: {
            base_token?: { data?: { id?: string } };
            quote_token?: { data?: { id?: string } };
            dex?: { data?: { id?: string } };
          };
        };
        const geckoHeaders = { Accept: "application/json;version=20230302" };
        const geckoQueries = [
          fetchJsonWithTimeout<{ data?: GeckoPoolItem[] }>(
            `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(mintAddress)}`,
            geckoHeaders,
            7500
          ),
          ...(isDeployedOnHood
            ? [
                fetchJsonWithTimeout<{ data?: GeckoPoolItem[] }>(
                  `https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${encodeURIComponent(
                    mintAddress.toLowerCase()
                  )}/pools`,
                  geckoHeaders,
                  7500
                ),
              ]
            : []),
        ];
        const geckoSettled = await Promise.allSettled(geckoQueries);
        const pools: GeckoPoolItem[] = [];
        for (const r of geckoSettled) {
          if (r.status === "fulfilled" && r.value.ok && Array.isArray(r.value.data?.data)) {
            pools.push(...r.value.data.data);
          }
        }
        if (pools.length > 0) {
          const sortedPools = [...pools].sort(
            (a, b) => Number(b.attributes?.reserve_in_usd || 0) - Number(a.attributes?.reserve_in_usd || 0)
          );
          const topPool = sortedPools[0];
          if (topPool) {
            const rawId = topPool.id || "";
            const underscoreIdx = rawId.indexOf("_");
            const networkId = underscoreIdx > 0 ? rawId.slice(0, underscoreIdx) : "ethereum";
            const poolAddress =
              topPool.attributes?.address || (underscoreIdx > 0 ? rawId.slice(underscoreIdx + 1) : "");
            const baseTokenRawId = topPool.relationships?.base_token?.data?.id || "";
            const baseAddrMatch = baseTokenRawId.match(/0x[a-fA-F0-9]{40}/i);
            const baseTokenAddress = baseAddrMatch ? baseAddrMatch[0] : mintAddress;
            const pairTitleParts = (topPool.attributes?.name || "")
              .split("/")
              .map((p) => p.trim())
              .filter(Boolean);
            const createdMs = topPool.attributes?.pool_created_at
              ? Date.parse(topPool.attributes.pool_created_at)
              : NaN;
            const parsedPrice = Number(topPool.attributes?.base_token_price_usd || "");
            if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
              geckoPriceUsd = parsedPrice;
            }
            geckoTxStats = {
              buys1h: topPool.attributes?.transactions?.h1?.buys ?? null,
              sells1h: topPool.attributes?.transactions?.h1?.sells ?? null,
              buys24h: topPool.attributes?.transactions?.h24?.buys ?? null,
              sells24h: topPool.attributes?.transactions?.h24?.sells ?? null,
            };
            dexData = {
              pairs: [
                {
                  chainId: networkId,
                  dexId: topPool.relationships?.dex?.data?.id || `${networkId}-dex`,
                  url: poolAddress
                    ? `https://www.geckoterminal.com/${networkId}/pools/${poolAddress}`
                    : undefined,
                  pairAddress: poolAddress,
                  baseToken: {
                    address: baseTokenAddress,
                    symbol: pairTitleParts[0] || undefined,
                  },
                  quoteToken: {
                    symbol: pairTitleParts[1] || undefined,
                  },
                  liquidity: {
                    usd: Number(topPool.attributes?.reserve_in_usd || 0) || 0,
                  },
                  fdv: topPool.attributes?.fdv_usd ? Number(topPool.attributes.fdv_usd) : undefined,
                  volume: {
                    h24: Number(topPool.attributes?.volume_usd?.h24 || 0) || 0,
                  },
                  pairCreatedAt: Number.isFinite(createdMs) ? createdMs : undefined,
                },
              ],
            };
          }
        }
      }
    }

    let dexPair: DexPairSummary | null = null;
    let tokenName = "EVM Token";
    let tokenSymbol = "EVM";
    let topPairChain = isDeployedOnHood ? "robinhood" : "ethereum";
    let resolvedContractAddress = mintAddress;

    if (dexData?.pairs && dexData.pairs.length > 0) {
      const pairs = [...dexData.pairs].sort(
        (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
      );
      const top = pairs[0];
      if (top) {
        if (top.baseToken?.name) tokenName = top.baseToken.name;
        if (top.baseToken?.symbol) tokenSymbol = top.baseToken.symbol;
        if (top.baseToken?.address) resolvedContractAddress = top.baseToken.address;
        if (top.chainId) {
          topPairChain = top.chainId;
          if (top.chainId.toLowerCase() === "robinhood") {
            isDeployedOnHood = true;
          }
        }
        const createdMs = top.pairCreatedAt ?? null;
        const ageHours = createdMs
          ? Number(((Date.now() - createdMs) / 3_600_000).toFixed(1))
          : null;
        dexPair = {
          dexId: top.dexId || `${topPairChain}-dex`,
          pairAddress: top.pairAddress || "",
          pairUrl: top.url || `https://dexscreener.com/${topPairChain}/${resolvedContractAddress}`,
          liquidityUsd: Math.round(top.liquidity?.usd ?? 0),
          fdv: top.fdv ? Math.round(top.fdv) : null,
          volume24hUsd: Math.round(top.volume?.h24 ?? 0),
          pairCreatedAt: createdMs ? new Date(createdMs).toISOString() : null,
          pairAgeHours: ageHours,
          websites: (top.info?.websites ?? [])
            .map((w) => w.url || "")
            .filter(Boolean),
          socials: (top.info?.socials ?? [])
            .map((s) => ({ type: s.type || "social", url: s.url || "" }))
            .filter((s) => Boolean(s.url)),
          baseSymbol: tokenSymbol,
          quoteSymbol: top.quoteToken?.symbol || (isDeployedOnHood ? "ETH" : "USD"),
          imageUrl: top.info?.imageUrl?.trim() || null,
        };
      }
    }

    if (!isDeployedOnHood && resolvedContractAddress !== mintAddress) {
      const checkBase = await verifyRobinhoodChainDeployment(resolvedContractAddress);
      if (checkBase.isDeployed) isDeployedOnHood = true;
    }

    let onChainSupply: string = "0";
    let onChainDecimals: number = 18;
    if (isDeployedOnHood && (tokenName === "EVM Token" || !dexPair)) {
      try {
        const onChainMeta = await fetchRobinhoodChainErc20Metadata(resolvedContractAddress);
        if (onChainMeta.name) tokenName = onChainMeta.name;
        if (onChainMeta.symbol) tokenSymbol = onChainMeta.symbol;
        if (onChainMeta.decimals) onChainDecimals = onChainMeta.decimals;
        if (onChainMeta.totalSupply) onChainSupply = onChainMeta.totalSupply;
      } catch {
        // fallback to defaults
      }
    }

    let xSocials: {
      imageUrl: string | null;
      twitterUrl: string | null;
      websiteUrl: string | null;
      githubUrl: string | null;
    } | null = null;

    if (!dexPair?.imageUrl) {
      xSocials = await discoverTokenSocialsFromX(resolvedContractAddress, tokenSymbol);
      if (xSocials?.imageUrl) {
        if (!dexPair) {
          dexPair = {
            dexId: `${topPairChain}-dex`,
            pairAddress: "",
            pairUrl: `https://dexscreener.com/${topPairChain}/${resolvedContractAddress}`,
            liquidityUsd: 0,
            fdv: null,
            volume24hUsd: 0,
            pairCreatedAt: null,
            pairAgeHours: null,
            websites: xSocials.websiteUrl ? [xSocials.websiteUrl] : [],
            socials: [
              ...(xSocials.twitterUrl ? [{ type: "twitter", url: xSocials.twitterUrl }] : []),
              ...(xSocials.githubUrl ? [{ type: "github", url: xSocials.githubUrl }] : []),
            ],
            baseSymbol: tokenSymbol,
            quoteSymbol: isDeployedOnHood ? "ETH" : "USD",
            imageUrl: xSocials.imageUrl,
          };
        } else {
          dexPair.imageUrl = xSocials.imageUrl;
          if (xSocials.websiteUrl && dexPair.websites.length === 0) {
            dexPair.websites.push(xSocials.websiteUrl);
          }
          if (xSocials.twitterUrl && !dexPair.socials.some((s) => s.type === "twitter")) {
            dexPair.socials.push({ type: "twitter", url: xSocials.twitterUrl });
          }
          if (xSocials.githubUrl && !dexPair.socials.some((s) => s.type === "github")) {
            dexPair.socials.push({ type: "github", url: xSocials.githubUrl });
          }
        }
      }
    }

    const targetChainForSecurity = isDeployedOnHood ? "robinhood" : topPairChain;
    const [robinhoodReport, evmSecurity] = await Promise.all([
      verifyRobinhoodStatus({
        address: resolvedContractAddress,
        name: tokenName,
        symbol: tokenSymbol,
        chainFamily: "evm",
        isRobinhoodChain: isDeployedOnHood,
      }),
      inspectEvmContractSecurity(resolvedContractAddress, targetChainForSecurity),
    ]);

    const evmWatch = await collectEvmWalletsToWatch({
      chainKey: targetChainForSecurity as EvmChainKey,
      tokenAddress: resolvedContractAddress,
      totalSupplyRaw:
        onChainSupply !== "0" && /^\d+$/.test(onChainSupply)
          ? BigInt(onChainSupply)
          : undefined,
      pairAddress: dexPair?.pairAddress || null,
      creatorAddress: evmSecurity.creatorAddress ?? null,
      ownerAddress: evmSecurity.ownerAddress ?? null,
      goPlusHolders: evmSecurity.topHolders,
    }).catch(() => null);

    const combinedRisk = Math.min(
      99,
      Math.max(
        robinhoodReport.impostorRiskScore,
        evmSecurity.riskScore,
        isDeployedOnHood || robinhoodReport.impostorRiskScore >= 70 ? 10 : 12
      )
    );
    const isHighRisk = combinedRisk >= 70;
    const isCautionRisk = !isHighRisk && combinedRisk >= 35;

    const mergedFlags = [
      ...(robinhoodReport.warning
        ? [
            {
              code: "ROBINHOOD_WARNING",
              severity: robinhoodReport.impostorRiskScore >= 70 ? "HIGH" : "MEDIUM",
              title: "Robinhood Asset Warning",
              description: robinhoodReport.warning,
            },
          ]
        : []),
      ...evmSecurity.flags,
    ];

    const syntheticTokenReport: any = {
      mintAddress,
      tokenProgram: isDeployedOnHood
        ? "Robinhood Chain L2 (ERC-20)"
        : `${topPairChain.toUpperCase()} ERC-20`,
      programId: isDeployedOnHood ? "ROBINHOOD_CHAIN_L2" : "EVM_ERC20",
      isToken2022: false,
      isPumpFunSuffix: false,
      name: tokenName,
      symbol: tokenSymbol,
      decimals: onChainDecimals,
      rawSupply: onChainSupply,
      supplyUi: (() => {
        try {
          if (onChainSupply === "0") return 0;
          const clampedDecimals = Math.max(0, Math.min(77, Math.trunc(onChainDecimals || 0)));
          const divisor = BigInt(10) ** BigInt(clampedDecimals);
          return Number(BigInt(onChainSupply) / divisor);
        } catch {
          return 0;
        }
      })(),
      mintAuthority: null,
      freezeAuthority: null,
      extensions: isDeployedOnHood
        ? [
            "Robinhood Chain Arbitrum Orbit",
            ...(evmSecurity.isProxy ? [`${evmSecurity.proxyType || "Proxy"} Contract`] : []),
          ]
        : evmSecurity.isProxy
          ? [`${evmSecurity.proxyType || "Proxy"} Contract`]
          : [],
      transferFeeBps:
        evmSecurity.sellTaxPct !== null ? Math.round(evmSecurity.sellTaxPct * 100) : null,
      permanentDelegate: null,
      transferHookProgramId: null,
      defaultAccountState: null,
      topHolders: evmWatch
        ? evmWatch.nodes
            .filter((n) => n.role !== "pool" && n.role !== "burn")
            .slice(0, 10)
            .map((n) => ({
              address: n.address,
              uiAmount: n.uiAmount,
              pctOfSupply: n.pct,
            }))
        : [],
      top5Pct: evmWatch
        ? Number(
            evmWatch.nodes
              .filter((n) => n.role !== "pool" && n.role !== "burn")
              .slice(0, 5)
              .reduce((acc, n) => acc + n.pct, 0)
              .toFixed(1)
          )
        : 0,
      top10Pct: evmWatch ? evmWatch.topHoldersPct : 0,
      riskScore: combinedRisk,
      classification: isHighRisk ? "CRITICAL" : isCautionRisk ? "CAUTION" : "SAFE",
      recommendedAction: isHighRisk
        ? "HIGH_RUG_RISK"
        : isCautionRisk
          ? "CAUTION_REVIEW"
          : "VERIFIED_SAFE",
      executiveSummary:
        robinhoodReport.impostorRiskScore >= 70
          ? robinhoodReport.summary
          : evmSecurity.summary,
      flags: mergedFlags,
    };

    const evmHolderChecks: HolderAuditCheckRow[] = [
      {
        label: "Honeypot / sellability check",
        value: evmSecurity.honeypotStatus,
        status: evmSecurity.honeypotStatus === "HONEYPOT" ? "flag" : "clear",
      },
      {
        label: "Contract ownership & proxy",
        value: evmSecurity.isProxy
          ? `${evmSecurity.proxyType || "Proxy"}`
          : evmSecurity.ownerAddress
            ? `Owner ${evmSecurity.ownerAddress.slice(0, 8)}...`
            : "Non-Proxy · No owner()",
        status: evmSecurity.isProxy ? "watch" : "clear",
      },
      {
        label: "Source verification",
        value: evmSecurity.verifiedSource || "unverified",
        status: evmSecurity.verifiedSource !== "unverified" ? "clear" : "watch",
      },
      {
        label: "Indexed DEX liquidity",
        value:
          dexPair && dexPair.liquidityUsd > 0
            ? `$${dexPair.liquidityUsd.toLocaleString("en-US")}`
            : "Unindexed",
        status: dexPair && dexPair.liquidityUsd > 0 ? "clear" : "watch",
      },
    ];

    const mergedEvmChecks = [
      ...evmHolderChecks,
      ...(evmWatch?.checks || []),
    ];

    let evmHolderScore = evmSecurity.honeypotStatus === "HONEYPOT" ? 10 : 85;
    if (evmSecurity.honeypotStatus !== "HONEYPOT" && evmWatch) {
      if (evmWatch.clusters.length > 0) {
        const insidersPct = evmWatch.distribution.insidersPct;
        const bundlePenalty =
          insidersPct >= 10
            ? Math.min(28, evmWatch.clusters.length * 14)
            : insidersPct >= 3
              ? Math.min(14, evmWatch.clusters.length * 5)
              : Math.min(6, evmWatch.clusters.length * 2);
        evmHolderScore -= bundlePenalty;
      }
      if (evmWatch.distribution.snipersPct >= 15) evmHolderScore -= 16;
      if (evmWatch.topHoldersPct >= 40) evmHolderScore -= 14;
      else if (evmWatch.topHoldersPct >= 25) evmHolderScore -= 6;
      evmHolderScore = Math.max(20, Math.min(96, Math.round(evmHolderScore)));
    }
    const evmHolderVerdict: HoldersDeepAnalysis["verdict"] =
      evmHolderScore >= 68 ? "OK" : evmHolderScore >= 40 ? "SKETCHY" : "RIGGED";

    const evmHoldersAnalysis: HoldersDeepAnalysis = {
      totalHolders: evmSecurity.holderCount,
      nodes: evmWatch?.nodes || [],
      clusters: evmWatch?.clusters || [],
      score: evmHolderScore,
      verdict: evmHolderVerdict,
      distribution: evmWatch?.distribution || {
        insidersPct: 0,
        snipersPct: 0,
        burnedOrLockedPct: 0,
        devPct: 0,
        retailPct: 100,
      },
      checks: mergedEvmChecks,
      flagsCount: mergedEvmChecks.filter((c) => c.status === "flag").length,
      watchCount: mergedEvmChecks.filter((c) => c.status === "watch").length,
      clearCount: mergedEvmChecks.filter((c) => c.status === "clear").length,
      notes: [
        isDeployedOnHood
          ? "Contract audited via Robinhood Chain L2 RPC bytecode inspection."
          : "Contract audited via EVM RPC bytecode inspection.",
        ...(evmWatch?.notes || []),
      ],
      walletsToWatch: evmWatch?.walletsToWatch || [],
      earlyBuyersCount: evmWatch?.earlyBuyersCount || 0,
      possibleMmCount: evmWatch?.possibleMmCount || 0,
    };

    const syntheticDeep: any = {
      mintAddress: resolvedContractAddress,
      metadata: {
        name: tokenName,
        symbol: tokenSymbol,
        description: null,
        imageUrl: dexPair?.imageUrl || xSocials?.imageUrl || null,
        websites: dexPair?.websites?.length
          ? dexPair.websites
          : xSocials?.websiteUrl
            ? [xSocials.websiteUrl]
            : [],
        twitterUrl:
          dexPair?.socials?.find((s) => s.type === "twitter" || s.url?.includes("x.com"))?.url ||
          xSocials?.twitterUrl ||
          null,
        telegramUrl:
          dexPair?.socials?.find((s) => s.type === "telegram" || s.url?.includes("t.me"))?.url ||
          null,
        launchpad: isDeployedOnHood ? "Robinhood Chain L2" : null,
        createdAt: dexPair?.pairCreatedAt || null,
      },
      market: {
        poolAddress: dexPair?.pairAddress || null,
        dexId: dexPair?.dexId || `${topPairChain}-dex`,
        priceUsd: geckoPriceUsd,
        marketCapUsd: dexPair?.fdv || null,
        fdvUsd: dexPair?.fdv || null,
        liquidityUsd: dexPair?.liquidityUsd || 0,
        volume24hUsd: dexPair?.volume24hUsd || 0,
        priceChange5m: null,
        priceChange1h: null,
        priceChange6h: null,
        priceChange24h: null,
        buys1h: geckoTxStats.buys1h ?? null,
        sells1h: geckoTxStats.sells1h ?? null,
        buys24h: geckoTxStats.buys24h ?? null,
        sells24h: geckoTxStats.sells24h ?? null,
      },
      holders: evmHoldersAnalysis,
      devHistory: {
        devAddress: evmSecurity.creatorAddress || evmSecurity.ownerAddress || null,
        solBalance: null,
        tokenHoldingPct: evmHoldersAnalysis.distribution.devPct,
        coinsLaunchedCount: 0,
        flaggedCoinsCount: 0,
        launchedTokens: [],
        recentTxs: [],
      },
    };

    return {
      mintAddress: resolvedContractAddress,
      tokenReport: syntheticTokenReport,
      dexPair,
      accountRecentTxCount: null,
      deep: syntheticDeep,
      robinhood: robinhoodReport,
      evmSecurity,
      chainFamily: "evm",
      networkName: isDeployedOnHood ? "Robinhood Chain" : evmSecurity.networkName || `${topPairChain.toUpperCase()} Network`,
    };
  }

  const [tokenRes, dexRes, sigRes] = await Promise.allSettled([
    scanSolanaTokenMint(mintAddress),
    fetchJsonWithTimeout<{
      pairs?: Array<{
        chainId?: string;
        dexId?: string;
        url?: string;
        pairAddress?: string;
        baseToken?: { symbol?: string };
        quoteToken?: { symbol?: string };
        liquidity?: { usd?: number };
        fdv?: number;
        volume?: { h24?: number };
        pairCreatedAt?: number;
        info?: {
          imageUrl?: string;
          websites?: Array<{ url?: string }>;
          socials?: Array<{ type?: string; url?: string }>;
        };
      }>;
    }>(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mintAddress)}`),
    (async () => {
      const conn = new Connection(SOLANA_MAINNET_RPC, { commitment: "confirmed" });
      return conn.getSignaturesForAddress(new PublicKey(mintAddress), { limit: 20 });
    })(),
  ]);

  let tokenReport = null;
  let errorMsg: string | undefined;
  if (tokenRes.status === "fulfilled") {
    tokenReport = tokenRes.value;
  } else {
    errorMsg =
      tokenRes.reason instanceof Error
        ? tokenRes.reason.message
        : "Mint telemetry unavailable";
  }

  let dexPair: DexPairSummary | null = null;
  let dexImageUrl: string | null = null;
  if (dexRes.status === "fulfilled" && dexRes.value.ok && dexRes.value.data?.pairs) {
    const solPairs = dexRes.value.data.pairs
      .filter((p) => p.chainId === "solana")
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const top = solPairs[0];
    if (top) {
      dexImageUrl = top.info?.imageUrl?.trim() || null;
      const createdMs = top.pairCreatedAt ?? null;
      const ageHours = createdMs
        ? Number(((Date.now() - createdMs) / 3_600_000).toFixed(1))
        : null;
      dexPair = {
        dexId: top.dexId || "solana-dex",
        pairAddress: top.pairAddress || "",
        pairUrl: top.url || `https://dexscreener.com/solana/${mintAddress}`,
        liquidityUsd: Math.round(top.liquidity?.usd ?? 0),
        fdv: top.fdv ? Math.round(top.fdv) : null,
        volume24hUsd: Math.round(top.volume?.h24 ?? 0),
        pairCreatedAt: createdMs ? new Date(createdMs).toISOString() : null,
        pairAgeHours: ageHours,
        websites: (top.info?.websites ?? [])
          .map((w) => w.url || "")
          .filter(Boolean),
        socials: (top.info?.socials ?? [])
          .map((s) => ({ type: s.type || "social", url: s.url || "" }))
          .filter((s) => Boolean(s.url)),
        baseSymbol: top.baseToken?.symbol || null,
        quoteSymbol: top.quoteToken?.symbol || "SOL",
        imageUrl: dexImageUrl,
      };
    }
  }

  const accountRecentTxCount =
    sigRes.status === "fulfilled" ? sigRes.value.length : null;

  const deep = await collectTokenDeepIntel(mintAddress, tokenReport).catch(() => null);

  if (deep) {
    // Merge websites & socials discovered from Jupiter v2 / Metaplex URI / GeckoTerminal
    const mergedWebsites = Array.from(
      new Set([...(dexPair?.websites ?? []), ...deep.metadata.websites])
    );
    const mergedSocials = [...(dexPair?.socials ?? [])];
    if (
      deep.metadata.twitterUrl &&
      !mergedSocials.some((s) => s.type === "twitter" || s.url.includes("x.com"))
    ) {
      mergedSocials.push({ type: "twitter", url: deep.metadata.twitterUrl });
    }

    if (!dexPair && (deep.market.poolAddress || mergedWebsites.length > 0 || deep.market.liquidityUsd > 0)) {
      const createdMs = deep.metadata.createdAt ? Date.parse(deep.metadata.createdAt) : NaN;
      dexPair = {
        dexId: deep.market.dexId || deep.metadata.launchpad || "solana-dex",
        pairAddress: deep.market.poolAddress || "",
        pairUrl: `https://dexscreener.com/solana/${mintAddress}`,
        liquidityUsd: deep.market.liquidityUsd,
        fdv: deep.market.fdvUsd,
        volume24hUsd: deep.market.volume24hUsd,
        pairCreatedAt: deep.metadata.createdAt,
        pairAgeHours: Number.isFinite(createdMs)
          ? Number(((Date.now() - createdMs) / 3_600_000).toFixed(1))
          : null,
        websites: mergedWebsites,
        socials: mergedSocials,
      };
    } else if (dexPair) {
      dexPair.websites = mergedWebsites;
      dexPair.socials = mergedSocials;
      if (!dexPair.liquidityUsd && deep.market.liquidityUsd > 0) {
        dexPair.liquidityUsd = deep.market.liquidityUsd;
      }
      if (!dexPair.volume24hUsd && deep.market.volume24hUsd > 0) {
        dexPair.volume24hUsd = deep.market.volume24hUsd;
      }
      if (!dexPair.fdv && deep.market.fdvUsd) {
        dexPair.fdv = deep.market.fdvUsd;
      }
    }

    // Backfill topHolders concentration when public Solana RPC rate-limits getTokenLargestAccounts
    if (tokenReport && tokenReport.topHolders.length === 0 && deep.holders.nodes.length > 0) {
      const nonPool = deep.holders.nodes.filter((n) => n.role !== "pool" && n.role !== "burn");
      if (nonPool.length > 0) {
        tokenReport.topHolders = nonPool.slice(0, 10).map((n) => ({
          address: n.address,
          uiAmount: n.uiAmount,
          pctOfSupply: n.pct,
        }));
        tokenReport.top5Pct = Number(
          nonPool
            .slice(0, 5)
            .reduce((acc, n) => acc + n.pct, 0)
            .toFixed(1)
        );
        tokenReport.top10Pct = Number(
          nonPool
            .slice(0, 10)
            .reduce((acc, n) => acc + n.pct, 0)
            .toFixed(1)
        );
      }
    }

    if (!deep.metadata.imageUrl && dexImageUrl) {
      deep.metadata.imageUrl = dexImageUrl;
    }

    if (!deep.metadata.imageUrl) {
      try {
        const xSocials = await discoverTokenSocialsFromX(
          mintAddress,
          tokenReport?.symbol || deep.metadata.symbol || undefined
        );
        if (xSocials?.imageUrl) {
          deep.metadata.imageUrl = xSocials.imageUrl;
          if (dexPair) dexPair.imageUrl = xSocials.imageUrl;
          if (xSocials.websiteUrl && deep.metadata.websites.length === 0) {
            deep.metadata.websites.push(xSocials.websiteUrl);
          }
          if (xSocials.twitterUrl && !deep.metadata.twitterUrl) {
            deep.metadata.twitterUrl = xSocials.twitterUrl;
          }
        }
      } catch {
        // non-blocking
      }
    }

    if (tokenReport) {
      tokenReport.name = tokenReport.name || deep.metadata.name;
      tokenReport.symbol = tokenReport.symbol || deep.metadata.symbol;
    }
  }

  const robinhoodReport = await verifyRobinhoodStatus({
    address: mintAddress,
    name: tokenReport?.name || null,
    symbol: tokenReport?.symbol || null,
    chainFamily: "solana",
    metadataText: deep?.metadata?.description || null,
  });

  return {
    mintAddress,
    tokenReport,
    dexPair,
    accountRecentTxCount,
    deep,
    robinhood: robinhoodReport,
    chainFamily: "solana",
    networkName: "Solana Mainnet",
    error: errorMsg,
  };
}

function toRegistrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return hostname.toLowerCase();
  const sldSecond = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
  if (
    parts.length >= 3 &&
    parts[parts.length - 1].length === 2 &&
    sldSecond.has(parts[parts.length - 2])
  ) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/**
 * Evaluates domain typosquatting risks via SolShield Domain Guard plus live RDAP age lookup.
 */
export async function collectDomainIntel(
  rawUrlOrHost: string,
  pageTitle: string | null = null,
  generatorHints: string[] = []
): Promise<DomainIntelReport | null> {
  const host = normalizeHostname(rawUrlOrHost);
  if (!host) return null;

  const domainEval = evaluateDomainSafety(host);
  const registrableDomain = toRegistrableDomain(host);
  let rdapCreatedAt: string | null = null;
  let domainAgeDays: number | null = null;

  const rdapRes = await fetchJsonWithTimeout<{
    events?: Array<{ eventAction?: string; eventDate?: string }>;
  }>(`https://rdap.org/domain/${encodeURIComponent(registrableDomain)}`, {}, 5000);

  if (rdapRes.ok && Array.isArray(rdapRes.data?.events)) {
    const reg = rdapRes.data.events.find(
      (ev) => ev.eventAction === "registration" && ev.eventDate
    );
    if (reg?.eventDate) {
      rdapCreatedAt = reg.eventDate;
      const ms = Date.parse(reg.eventDate);
      if (Number.isFinite(ms)) {
        domainAgeDays = Math.max(0, Math.round((Date.now() - ms) / 86_400_000));
      }
    }
  }

  return {
    hostname: host,
    domainEval,
    rdapCreatedAt,
    domainAgeDays,
    registrableDomain,
    pageTitle,
    generatorHints,
  };
}

function normalizeNpmRepoUrl(rawUrl: string): string {
  return rawUrl
    .trim()
    .replace(/^git\+/i, "")
    .replace(/^git:\/\//i, "https://")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/^git@github\.com:/i, "https://github.com/");
}

/**
 * Resolves GitHub `owner/repo` and public homepage URLs from npm package names (e.g. `npx archivums init`).
 */
export async function discoverGithubRepoFromNpmPackages(packages: string[]): Promise<{
  githubRepos: string[];
  websiteUrls: string[];
  matchedPackages: Array<{ name: string; repo: string | null; homepage: string | null }>;
}> {
  const uniquePkgs = Array.from(new Set(packages.map((p) => p.trim()).filter(Boolean))).slice(0, 3);
  if (uniquePkgs.length === 0) {
    return { githubRepos: [], websiteUrls: [], matchedPackages: [] };
  }

  const githubSet = new Set<string>();
  const webSet = new Set<string>();
  const matchedPackages: Array<{ name: string; repo: string | null; homepage: string | null }> = [];

  const settled = await Promise.allSettled(
    uniquePkgs.map(async (pkg) => {
      const registryPath = pkg.startsWith("@")
        ? `@${encodeURIComponent(pkg.slice(1)).replace(/%2F/i, "/")}`
        : encodeURIComponent(pkg);
      const res = await fetchJsonWithTimeout<{
        name?: string;
        repository?: string | { url?: string };
        homepage?: string;
        bugs?: string | { url?: string };
      }>(`https://registry.npmjs.org/${registryPath}`, {}, 3800);
      return { pkg, res };
    })
  );

  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    const { pkg, res } = item.value;
    const data = res.data;
    if (!res.ok || !data) continue;
    const rawRepo =
      typeof data.repository === "string" ? data.repository : data.repository?.url || "";
    const normalizedRepo = rawRepo ? normalizeNpmRepoUrl(rawRepo) : "";
    const homepage = typeof data.homepage === "string" ? data.homepage.trim() : "";
    const bugsUrl =
      typeof data.bugs === "string" ? data.bugs : data.bugs?.url || "";

    const gh =
      (normalizedRepo ? parseGitHubOwnerRepo(normalizedRepo) : null) ||
      (homepage ? parseGitHubOwnerRepo(homepage) : null) ||
      (bugsUrl ? parseGitHubOwnerRepo(bugsUrl) : null);

    if (gh) githubSet.add(gh);
    if (
      homepage &&
      /^https?:\/\//i.test(homepage) &&
      !isExcludedWebsiteHost(homepage) &&
      !parseGitHubOwnerRepo(homepage)
    ) {
      webSet.add(homepage.replace(/#.*$/, ""));
    }
    matchedPackages.push({
      name: data.name || pkg,
      repo: gh,
      homepage: homepage || null,
    });
  }

  return {
    githubRepos: Array.from(githubSet).slice(0, 4),
    websiteUrls: Array.from(webSet).slice(0, 4),
    matchedPackages,
  };
}

function buildXPostReportFromCorpus(params: {
  url: string;
  handle: string | null;
  tweetId: string | null;
  authorName: string | null;
  authorImageUrl?: string | null;
  displayText: string;
  extraUrls?: string[];
  extraCorpus?: string;
  methodUsed: XPostIntelReport["methodUsed"];
}): XPostIntelReport {
  const safeExtraUrls = (params.extraUrls ?? []).filter(Boolean);
  const fullCorpus = [params.displayText, params.extraCorpus || "", ...safeExtraUrls]
    .filter(Boolean)
    .join("\n");
  const entities = extractEntitiesFromText(fullCorpus);
  const npmPackages = extractNpmPackagesFromText(fullCorpus);
  const externalExpandedUrls = safeExtraUrls.filter(
    (u) => /^https?:\/\//i.test(u) && !isExcludedWebsiteHost(u) && !parseGitHubOwnerRepo(u)
  );
  return {
    url: params.url,
    handle: params.handle,
    tweetId: params.tweetId,
    authorName: params.authorName,
    authorImageUrl: params.authorImageUrl ?? null,
    textContent: params.displayText,
    extractedUrls: Array.from(new Set([...externalExpandedUrls, ...entities.websiteUrls])).slice(0, 6),
    extractedSolanaAddresses: entities.solanaAddresses,
    extractedGithubRepos: entities.githubRepos,
    extractedEvmAddresses: entities.evmAddresses,
    extractedNpmPackages: npmPackages,
    methodUsed: params.methodUsed,
  };
}

/**
 * Collects X/Twitter post text & embedded entities via Twitter syndication, X API v2 Note Tweets,
 * oEmbed endpoints (and enriches with headless browser text when available).
 */
export async function collectXPostIntel(
  xUrl: string,
  browserTextExcerpt?: string
): Promise<XPostIntelReport> {
  const parsed = parseXUrl(xUrl);
  const handle = parsed?.handle ?? null;
  const tweetId = parsed?.tweetId ?? null;
  const canonicalUrl = parsed?.canonicalUrl || xUrl;
  const bearerToken = process.env.X_BEARER_TOKEN?.trim() || "";

  if (tweetId) {
    const synRes = await fetchJsonWithTimeout<{
      text?: string;
      note_tweet?: { id?: string; text?: string };
      user?: { name?: string; screen_name?: string };
      entities?: {
        urls?: Array<{ expanded_url?: string; url?: string }>;
      };
    }>(
      `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=solshield`,
      {},
      4500
    );

    const synOk = Boolean(synRes.ok && synRes.data?.text);
    const synText = synRes.data?.text || "";
    const synExpandedUrls = (synRes.data?.entities?.urls ?? [])
      .map((u) => u.expanded_url || u.url || "")
      .filter(Boolean);
    const synPrelimEntities = synOk
      ? extractEntitiesFromText([synText, ...synExpandedUrls, browserTextExcerpt || ""].join("\n"))
      : null;

    const shouldTryXApiV2 =
      Boolean(bearerToken) &&
      (!synOk ||
        Boolean(synRes.data?.note_tweet) ||
        synText.length >= 230 ||
        (synPrelimEntities !== null &&
          synPrelimEntities.websiteUrls.length === 0 &&
          synPrelimEntities.githubRepos.length === 0 &&
          synPrelimEntities.solanaAddresses.length === 0 &&
          synPrelimEntities.evmAddresses.length === 0));

    if (shouldTryXApiV2) {
      const apiRes = await fetchJsonWithTimeout<{
        data?: {
          text?: string;
          author_id?: string;
          note_tweet?: {
            text?: string;
            entities?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
          };
          entities?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
        };
        includes?: {
          users?: Array<{
            id?: string;
            name?: string;
            username?: string;
            profile_image_url?: string;
            description?: string;
            url?: string;
            entities?: {
              url?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
              description?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
            };
          }>;
        };
      }>(
        `https://api.x.com/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=text,note_tweet,entities,author_id&expansions=author_id&user.fields=name,username,description,entities,url,profile_image_url`,
        { Authorization: `Bearer ${bearerToken}` },
        5000
      );

      const tweetData = apiRes.data?.data;
      if (apiRes.ok && tweetData) {
        const author = apiRes.data?.includes?.users?.[0];
        const fullTweetText = tweetData.note_tweet?.text || tweetData.text || synText;
        const collectedUrls = [
          ...(tweetData.note_tweet?.entities?.urls ?? []),
          ...(tweetData.entities?.urls ?? []),
          ...(author?.entities?.url?.urls ?? []),
          ...(author?.entities?.description?.urls ?? []),
        ]
          .map((u) => u.unwound_url || u.expanded_url || u.url || "")
          .filter(Boolean);

        return buildXPostReportFromCorpus({
          url: canonicalUrl,
          handle: author?.username || synRes.data?.user?.screen_name || handle,
          tweetId,
          authorName: author?.name || synRes.data?.user?.name || null,
          authorImageUrl: normalizeXProfileAvatar(author?.profile_image_url),
          displayText: fullTweetText,
          extraUrls: Array.from(new Set([...collectedUrls, ...synExpandedUrls])),
          extraCorpus: [author?.description || "", author?.url || "", browserTextExcerpt || ""]
            .filter(Boolean)
            .join("\n"),
          methodUsed: "x-api-v2",
        });
      }
    }

    if (synOk) {
      return buildXPostReportFromCorpus({
        url: canonicalUrl,
        handle: synRes.data?.user?.screen_name || handle,
        tweetId,
        authorName: synRes.data?.user?.name || null,
        displayText: synText,
        extraUrls: synExpandedUrls,
        extraCorpus: browserTextExcerpt || "",
        methodUsed: "syndication",
      });
    }

    const oembedRes = await fetchJsonWithTimeout<{
      author_name?: string;
      html?: string;
    }>(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonicalUrl)}`,
      {},
      4500
    );
    if (oembedRes.ok && oembedRes.data?.html) {
      const plain = extractVisibleTextFromHtml(oembedRes.data.html);
      return buildXPostReportFromCorpus({
        url: canonicalUrl,
        handle,
        tweetId,
        authorName: oembedRes.data.author_name || null,
        displayText: plain,
        extraCorpus: browserTextExcerpt || "",
        methodUsed: "oembed",
      });
    }
  } else if (handle && bearerToken) {
    const userRes = await fetchJsonWithTimeout<{
      data?: {
        id?: string;
        name?: string;
        username?: string;
        profile_image_url?: string;
        description?: string;
        url?: string;
        entities?: {
          url?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
          description?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
        };
      };
    }>(
      `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=name,username,description,entities,url,profile_image_url`,
      { Authorization: `Bearer ${bearerToken}` },
      4500
    );
    const u = userRes.data?.data;
    if (userRes.ok && u) {
      const profileUrls = [
        ...(u.entities?.url?.urls ?? []),
        ...(u.entities?.description?.urls ?? []),
      ]
        .map((item) => item.unwound_url || item.expanded_url || item.url || "")
        .filter(Boolean);
      return buildXPostReportFromCorpus({
        url: canonicalUrl,
        handle: u.username || handle,
        tweetId: null,
        authorName: u.name || null,
        authorImageUrl: normalizeXProfileAvatar(u.profile_image_url),
        displayText: u.description || "",
        extraUrls: profileUrls,
        extraCorpus: [u.url || "", browserTextExcerpt || ""].filter(Boolean).join("\n"),
        methodUsed: "x-api-v2",
      });
    }
  }

  if (browserTextExcerpt && browserTextExcerpt.length > 40) {
    return buildXPostReportFromCorpus({
      url: canonicalUrl,
      handle,
      tweetId,
      authorName: handle,
      displayText: browserTextExcerpt.slice(0, 1600),
      methodUsed: "browser",
    });
  }

  return {
    url: canonicalUrl,
    handle,
    tweetId,
    authorName: null,
    textContent: null,
    extractedUrls: [],
    extractedSolanaAddresses: [],
    extractedGithubRepos: [],
    extractedEvmAddresses: [],
    extractedNpmPackages: [],
    methodUsed: "unavailable",
    note: "X blocked anonymous read or required interactive session cookie on this target.",
  };
}
