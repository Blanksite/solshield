import { Connection, PublicKey } from "@solana/web3.js";
import { evaluateDomainSafety, normalizeHostname } from "../domain-guard";
import { scanSolanaTokenMint } from "../token-scanner";
import { extractEntitiesFromText, parseXUrl } from "./input-parser";
import { collectTokenDeepIntel } from "./token-forensics";
import type {
  ChainTokenIntelReport,
  DexPairSummary,
  DomainIntelReport,
  GitHubForensicReport,
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

  // Sliding 4-hour window burst detector
  let maxCluster = 0;
  commitTimestamps.sort((a, b) => a - b);
  for (let i = 0; i < commitTimestamps.length; i += 1) {
    let cluster = 0;
    for (let j = i; j < commitTimestamps.length; j += 1) {
      if (commitTimestamps[j] - commitTimestamps[i] <= 4 * 3_600_000) {
        cluster += 1;
      }
    }
    if (cluster > maxCluster) maxCluster = cluster;
  }
  const burstCommitRatio =
    commitTimestamps.length > 0
      ? Number((maxCluster / commitTimestamps.length).toFixed(2))
      : 0;

  const files = Array.isArray(contentsRes.data)
    ? contentsRes.data.map((item) => item.name || "").filter(Boolean)
    : [];
  const lowerFiles = files.map((f) => f.toLowerCase());

  const hasTestsOrCi = lowerFiles.some((f) =>
    ["test", "tests", "__tests__", ".github", "vitest.config.ts", "jest.config.js"].includes(
      f
    )
  );
  const hasPackageManifest = lowerFiles.some((f) =>
    ["package.json", "cargo.toml", "pyproject.toml", "go.mod", "anchor.toml"].includes(f)
  );

  const topLanguages = langsRes.data
    ? Object.entries(langsRes.data)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([lang]) => lang)
    : [];

  const signals: GitHubForensicReport["signals"] = [];
  if (repo.fork) {
    signals.push({
      code: "REPO_IS_FORK",
      severity: "WARNING",
      message: `Repository is forked from ${repo.parent?.full_name || "an upstream repo"}.`,
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
      message: `Repository age is ${ageDays} days with ${commits.length} recent sampled commits.`,
    });
  }
  if (commits.length >= 3 && burstCommitRatio >= 0.85 && (ageDays ?? 0) <= 14) {
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
    fullName: repo.full_name || ownerRepo,
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
    recentCommitCount: commits.length,
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
 * Queries on-chain Solana mint health via `scanSolanaTokenMint`, live DexScreener
 * liquidity/socials, and recent address transaction count.
 */
export async function collectChainTokenIntel(
  mintAddress: string
): Promise<ChainTokenIntelReport> {
  const [tokenRes, dexRes, sigRes] = await Promise.allSettled([
    scanSolanaTokenMint(mintAddress),
    fetchJsonWithTimeout<{
      pairs?: Array<{
        chainId?: string;
        dexId?: string;
        url?: string;
        pairAddress?: string;
        liquidity?: { usd?: number };
        fdv?: number;
        volume?: { h24?: number };
        pairCreatedAt?: number;
        info?: {
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
  if (dexRes.status === "fulfilled" && dexRes.value.ok && dexRes.value.data?.pairs) {
    const solPairs = dexRes.value.data.pairs
      .filter((p) => p.chainId === "solana")
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const top = solPairs[0];
    if (top) {
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

    if (tokenReport) {
      tokenReport.name = tokenReport.name || deep.metadata.name;
      tokenReport.symbol = tokenReport.symbol || deep.metadata.symbol;
    }
  }

  return {
    mintAddress,
    tokenReport,
    dexPair,
    accountRecentTxCount,
    deep,
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

function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collects X/Twitter post text & embedded entities via Twitter syndication / oEmbed
 * endpoints (and enriches with headless browser text when available).
 */
export async function collectXPostIntel(
  xUrl: string,
  browserTextExcerpt?: string
): Promise<XPostIntelReport> {
  const parsed = parseXUrl(xUrl);
  const handle = parsed?.handle ?? null;
  const tweetId = parsed?.tweetId ?? null;
  const canonicalUrl = parsed?.canonicalUrl || xUrl;

  if (tweetId) {
    const synRes = await fetchJsonWithTimeout<{
      text?: string;
      user?: { name?: string; screen_name?: string };
      entities?: {
        urls?: Array<{ expanded_url?: string; url?: string }>;
      };
    }>(
      `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=solshield`,
      {},
      4500
    );

    if (synRes.ok && synRes.data?.text) {
      const expandedUrls = (synRes.data.entities?.urls ?? [])
        .map((u) => u.expanded_url || u.url || "")
        .filter(Boolean);
      const combinedText = `${synRes.data.text}\n${expandedUrls.join(" ")}`;
      const entities = extractEntitiesFromText(combinedText);
      return {
        url: canonicalUrl,
        handle: synRes.data.user?.screen_name || handle,
        tweetId,
        authorName: synRes.data.user?.name || null,
        textContent: synRes.data.text,
        extractedUrls: Array.from(
          new Set([...expandedUrls, ...entities.websiteUrls])
        ).slice(0, 6),
        extractedSolanaAddresses: entities.solanaAddresses,
        extractedGithubRepos: entities.githubRepos,
        methodUsed: "syndication",
      };
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
      const plain = stripHtmlTags(oembedRes.data.html);
      const entities = extractEntitiesFromText(plain);
      return {
        url: canonicalUrl,
        handle,
        tweetId,
        authorName: oembedRes.data.author_name || null,
        textContent: plain,
        extractedUrls: entities.websiteUrls,
        extractedSolanaAddresses: entities.solanaAddresses,
        extractedGithubRepos: entities.githubRepos,
        methodUsed: "oembed",
      };
    }
  }

  if (browserTextExcerpt && browserTextExcerpt.length > 40) {
    const entities = extractEntitiesFromText(browserTextExcerpt);
    return {
      url: canonicalUrl,
      handle,
      tweetId,
      authorName: handle,
      textContent: browserTextExcerpt.slice(0, 1200),
      extractedUrls: entities.websiteUrls,
      extractedSolanaAddresses: entities.solanaAddresses,
      extractedGithubRepos: entities.githubRepos,
      methodUsed: "browser",
    };
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
    methodUsed: "unavailable",
    note: "X blocked anonymous read or required interactive session cookie on this target.",
  };
}
