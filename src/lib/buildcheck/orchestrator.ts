import crypto from "node:crypto";
import { runLiveBrowserObservation } from "./browser-agent";
import {
  collectChainTokenIntel,
  collectDomainIntel,
  collectGitHubForensics,
  collectXPostIntel,
} from "./collectors";
import { extractEntitiesFromText, parseBuildCheckInput } from "./input-parser";
import { TOKEN_EXPLORER_URL_RE } from "../firewall-input";
import type {
  BuildCheckReport,
  BuildCheckStreamEvent,
  ChainTokenIntelReport,
  DomainIntelReport,
  GitHubForensicReport,
  SocialMindshareReport,
  XPostIntelReport,
} from "./types";
import { assertSafePublicHttpUrl } from "./url-safety";
import {
  synthesizeWithVeniceBuildCheck,
  type VeniceBuildCheckOptions,
} from "./venice-buildcheck";
import {
  getCachedEntry,
  recordCoalescedHit,
  setCachedEntry,
} from "../scan-cache";
import { recordScannedToken } from "../scanned-tokens";
import { saveBuildCheckReportPermalink } from "./report-store";
import {
  collectSocialMindshare,
  computeMindshareBuildAlignment,
} from "./x-mindshare";
import {
  computeDualAxisSummary,
  toScannedTokenExtraFromReport,
} from "./war-room-metrics";
import type { ParsedTargetInput } from "./types";

export interface RunBuildCheckOptions extends VeniceBuildCheckOptions {
  enableBrowser?: boolean;
  enableSocial?: boolean;
  forceRefresh?: boolean;
  bypassCache?: boolean;
  onEvent?: (event: BuildCheckStreamEvent) => void;
}

const DEFAULT_BUILDCHECK_CACHE_TTL_MS = 30 * 60_000; // 30 minutes
const DEGRADED_VENICE_CACHE_TTL_MS = 2 * 60_000; // 2 minutes if Venice transiently fell back

interface InFlightBuildCheck {
  promise: Promise<BuildCheckReport>;
  bufferedEvents: BuildCheckStreamEvent[];
  subscribers: Set<(ev: BuildCheckStreamEvent) => void>;
}

function getInFlightMap(): Map<string, InFlightBuildCheck> {
  const g = globalThis as unknown as {
    __solshieldInFlightBuildChecks?: Map<string, InFlightBuildCheck>;
  };
  if (!g.__solshieldInFlightBuildChecks) {
    g.__solshieldInFlightBuildChecks = new Map();
  }
  return g.__solshieldInFlightBuildChecks;
}

function normalizeWebsiteForCacheKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid"]) {
      parsed.searchParams.delete(key);
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "") || "";
    return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${cleanPath}${parsed.search}`.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/**
 * Builds canonical BuildCheck cache keys so equivalent inputs (e.g. bare CA vs
 * DexScreener/Pump.fun link) share stored forensic reports without re-scanning.
 */
export function buildBuildCheckCacheKeys(
  target: ParsedTargetInput,
  enableBrowser: boolean
): { primaryKey: string; fallbackKeys: string[] } {
  let baseKey: string;
  if (target.kind === "token_ca" && target.mintAddress) {
    baseKey = `mint:${target.mintAddress}`;
  } else if (target.kind === "github_repo" && target.githubOwnerRepo) {
    baseKey = `gh:${target.githubOwnerRepo.toLowerCase()}`;
  } else if (target.kind === "x_post") {
    baseKey = `xpost:${target.xTweetId || (target.normalizedUrl || "").toLowerCase()}`;
  } else if (target.kind === "x_profile") {
    baseKey = `xprof:${(target.xHandle || target.normalizedUrl || "").toLowerCase()}`;
  } else {
    const urlStr = target.normalizedUrl || target.rawInput;
    const explorerMatch = urlStr.match(TOKEN_EXPLORER_URL_RE);
    baseKey = explorerMatch
      ? `mint:${explorerMatch[1]}`
      : `web:${normalizeWebsiteForCacheKey(urlStr)}`;
  }

  const primaryKey = `${baseKey}:b${enableBrowser ? "1" : "0"}`;
  const fallbackKeys = enableBrowser ? [] : [`${baseKey}:b1`];
  return { primaryKey, fallbackKeys };
}

/**
 * Checks whether a BuildCheck target already has a stored scan or an active
 * in-flight investigation, allowing routes to skip rate-limit / concurrency
 * charges on cache reuses.
 */
export async function peekBuildCheckReuseState(
  rawInput: string,
  enableBrowser = true
): Promise<{
  target: ParsedTargetInput;
  primaryKey: string;
  cacheHit: boolean;
  inFlight: boolean;
}> {
  const target = parseBuildCheckInput(rawInput);
  const { primaryKey, fallbackKeys } = buildBuildCheckCacheKeys(target, enableBrowser);
  const cached = await getCachedEntry<BuildCheckReport>(
    "buildcheck",
    primaryKey,
    fallbackKeys
  );
  const inFlightMap = getInFlightMap();
  const inFlight = [primaryKey, ...fallbackKeys].some((k) => inFlightMap.has(k));
  return {
    target,
    primaryKey,
    cacheHit: Boolean(cached),
    inFlight,
  };
}

function replayCachedReportEvents(
  report: BuildCheckReport,
  emit: (ev: BuildCheckStreamEvent) => void
): void {
  emit({
    type: "step",
    stepId: "parse",
    elapsedMs: 1,
    phase: "parse",
    title: `Target resolved as ${report.target.kind.replace("_", " ").toUpperCase()}`,
    detail:
      report.target.mintAddress ||
      report.target.githubOwnerRepo ||
      report.target.normalizedUrl ||
      report.target.rawInput,
  });

  emit({
    type: "step",
    stepId: "cache-hit",
    elapsedMs: 4,
    phase: "venice",
    title: "Loaded verified scan from shared cache",
    detail: `Reused existing audit stored at ${report.cache?.cachedAt ?? report.createdAt} — skipped duplicate Chromium, RPC & Venice AI calls.`,
  });

  for (const stop of report.browser.stops) {
    if (stop.screenshotBase64) {
      emit({
        type: "frame",
        elapsedMs: 6,
        url: stop.url,
        title: stop.title,
        stepLabel: stop.stepLabel,
        imageBase64: stop.screenshotBase64,
        xhrCount: stop.xhrCount,
      });
    }
  }

  if (report.chain) {
    const deep = report.chain.deep;
    const cabalTag =
      deep && deep.holders.clusters.length > 0
        ? ` · ${deep.holders.clusters.length} linked cluster(s) · Holders ${deep.holders.score}/100`
        : deep
          ? ` · Holders ${deep.holders.score}/100 (${deep.holders.verdict})`
          : "";
    emit({
      type: "collector",
      elapsedMs: 8,
      collector: "chain",
      status:
        report.chain.tokenReport &&
        report.chain.tokenReport.riskScore < 50 &&
        (!deep || deep.holders.score >= 50)
          ? "ok"
          : "warn",
      summary: report.chain.tokenReport
        ? `${report.chain.tokenReport.symbol || "Token"} · Liq $${(
            report.chain.dexPair?.liquidityUsd ?? 0
          ).toLocaleString("en-US")}${cabalTag}`
        : report.chain.error || "On-chain data cached",
    });
  }

  if (report.github) {
    emit({
      type: "collector",
      elapsedMs: 9,
      collector: "github",
      status: report.github.exists ? "ok" : "warn",
      summary: report.github.exists
        ? `${report.github.fullName} · ${report.github.stars}★ · ${report.github.recentCommitCount} commits`
        : report.github.error || "GitHub cached",
    });
  }

  if (report.domain) {
    emit({
      type: "collector",
      elapsedMs: 10,
      collector: "domain",
      status: report.domain.domainEval.riskLevel === "LOW" ? "ok" : "warn",
      summary: `${report.domain.registrableDomain} · ${report.domain.domainEval.status}${
        report.domain.domainAgeDays !== null ? ` · Age ${report.domain.domainAgeDays}d` : ""
      }`,
    });
  }

  if (report.xPost) {
    emit({
      type: "collector",
      elapsedMs: 11,
      collector: "xpost",
      status: report.xPost.textContent ? "ok" : "warn",
      summary: report.xPost.textContent
        ? `@${report.xPost.handle || "x"} · extracted ${report.xPost.textContent.length} chars via ${report.xPost.methodUsed}`
        : report.xPost.note || "X metadata cached",
    });
  }

  emit({
    type: "verdict",
    elapsedMs: report.elapsedMs,
    report,
  });
}

function selectPrimaryGithubRepo(
  candidates: string[],
  hints: Array<string | null | undefined>
): string | null {
  if (candidates.length === 0) return null;
  const thirdPartyCampaignRepos = new Set([
    "veniceai/builtinvenice",
    "vercel/next.js",
    "solana-labs/solana",
  ]);
  const cleanHints = hints
    .filter((h): h is string => Boolean(h))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const scored = candidates.map((repo, idx) => {
    const lower = repo.toLowerCase();
    const repoName = (lower.split("/")[1] || lower).replace(/[^a-z0-9]/g, "");
    let weight = 0;
    if (!thirdPartyCampaignRepos.has(lower)) weight += 50;
    if (cleanHints && repoName.length >= 4 && cleanHints.includes(repoName)) weight += 40;
    return { repo, score: weight - idx };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.repo || null;
}

/**
 * Orchestrates a complete BuildCheck investigation:
 * 1) Target classification & SSRF gate
 * 2) Initial fast OSINT / RPC / X collectors
 * 3) Live headless Chromium observation & screenshot streaming
 * 4) Secondary discovery collectors (e.g. GitHub repo linked inside website or DexScreener)
 * 5) Zero-Retention Venice AI (Vision + Reasoning) cross-audit
 */
export async function runBuildCheckInvestigation(
  rawInput: string,
  options: RunBuildCheckOptions = {}
): Promise<BuildCheckReport> {
  const enableBrowser = options.enableBrowser !== false;
  const target = parseBuildCheckInput(rawInput);

  if (target.normalizedUrl && target.kind !== "token_ca") {
    await assertSafePublicHttpUrl(target.normalizedUrl);
  }

  const { primaryKey, fallbackKeys } = buildBuildCheckCacheKeys(target, enableBrowser);

  if (!options.forceRefresh && !options.bypassCache) {
    const cached = await getCachedEntry<BuildCheckReport>(
      "buildcheck",
      primaryKey,
      fallbackKeys
    );
    if (cached) {
      const reusedReport: BuildCheckReport = {
        ...cached.value,
        cache: {
          hit: true,
          cachedAt: cached.cachedAt,
          expiresAt: cached.expiresAt,
          cacheKey: cached.cacheKey,
        },
      };
      await saveBuildCheckReportPermalink(reusedReport).catch(() => undefined);
      if (options.onEvent) {
        replayCachedReportEvents(reusedReport, options.onEvent);
      }
      return reusedReport;
    }

    const inFlightMap = getInFlightMap();
    const activeKey = [primaryKey, ...fallbackKeys].find((k) => inFlightMap.has(k));
    const existing = activeKey ? inFlightMap.get(activeKey) : undefined;
    if (existing) {
      recordCoalescedHit();
      const subscriber = options.onEvent;
      if (subscriber) {
        for (const ev of existing.bufferedEvents) {
          subscriber(ev);
        }
        existing.subscribers.add(subscriber);
      }
      try {
        const sharedReport = await existing.promise;
        return {
          ...sharedReport,
          cache: sharedReport.cache
            ? { ...sharedReport.cache, hit: true }
            : undefined,
        };
      } finally {
        if (subscriber) existing.subscribers.delete(subscriber);
      }
    }
  }

  const inFlightMap = getInFlightMap();
  const subscribers = new Set<(ev: BuildCheckStreamEvent) => void>();
  if (options.onEvent) subscribers.add(options.onEvent);
  const bufferedEvents: BuildCheckStreamEvent[] = [];

  const broadcast = (ev: BuildCheckStreamEvent) => {
    if (bufferedEvents.length < 80) {
      bufferedEvents.push(ev);
    }
    for (const sub of Array.from(subscribers)) {
      try {
        sub(ev);
      } catch {
        subscribers.delete(sub);
      }
    }
  };

  const investigationPromise = executeFreshBuildCheckInvestigation(
    rawInput,
    target,
    primaryKey,
    options,
    broadcast
  );

  inFlightMap.set(primaryKey, {
    promise: investigationPromise,
    bufferedEvents,
    subscribers,
  });

  try {
    return await investigationPromise;
  } finally {
    inFlightMap.delete(primaryKey);
    subscribers.clear();
  }
}

async function executeFreshBuildCheckInvestigation(
  rawInput: string,
  target: ParsedTargetInput,
  cacheKey: string,
  options: RunBuildCheckOptions,
  emit: (ev: BuildCheckStreamEvent) => void
): Promise<BuildCheckReport> {
  const startMs = Date.now();
  const id = `bc_${crypto.randomBytes(5).toString("hex")}`;
  const elapsed = () => Date.now() - startMs;

  emit({
    type: "step",
    stepId: "parse",
    elapsedMs: elapsed(),
    phase: "parse",
    title: `Target resolved as ${target.kind.replace("_", " ").toUpperCase()}`,
    detail:
      target.mintAddress ||
      target.githubOwnerRepo ||
      target.normalizedUrl ||
      target.rawInput,
  });

  // Also parse extra entities if user pasted multi-token context around a link
  const inlineEntities = extractEntitiesFromText(rawInput);

  let githubReport: GitHubForensicReport | null = null;
  let chainReport: ChainTokenIntelReport | null = null;
  let domainReport: DomainIntelReport | null = null;
  let xPostReport: XPostIntelReport | null = null;

  const initialMint = target.mintAddress || inlineEntities.solanaAddresses[0];
  const initialGh = target.githubOwnerRepo || inlineEntities.githubRepos[0];
  const initialXUrl =
    target.kind === "x_post" || target.kind === "x_profile"
      ? target.normalizedUrl
      : inlineEntities.xUrls[0];

  emit({
    type: "step",
    stepId: "precollect",
    elapsedMs: elapsed(),
    phase: "collectors",
    title: "Querying initial Chain, X & Code endpoints",
    detail: "Checking RPC mint authorities, DexScreener liquidity, GitHub commits, or X claims...",
  });

  const [chainRes, ghRes, xRes] = await Promise.all([
    initialMint ? collectChainTokenIntel(initialMint) : Promise.resolve(null),
    initialGh ? collectGitHubForensics(initialGh) : Promise.resolve(null),
    initialXUrl ? collectXPostIntel(initialXUrl) : Promise.resolve(null),
  ]);

  chainReport = chainRes;
  githubReport = ghRes;
  xPostReport = xRes;

  if (chainReport) {
    const deep = chainReport.deep;
    const cabalTag =
      deep && deep.holders.clusters.length > 0
        ? ` · ${deep.holders.clusters.length} linked cluster(s) · Holders ${deep.holders.score}/100`
        : deep
          ? ` · Holders ${deep.holders.score}/100 (${deep.holders.verdict})`
          : "";
    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "chain",
      status:
        chainReport.tokenReport &&
        chainReport.tokenReport.riskScore < 50 &&
        (!deep || deep.holders.score >= 50)
          ? "ok"
          : "warn",
      summary: chainReport.tokenReport
        ? `${chainReport.tokenReport.symbol || "Token"} · Liq $${(
            chainReport.dexPair?.liquidityUsd ?? 0
          ).toLocaleString("en-US")}${cabalTag}`
        : chainReport.error || "On-chain data checked",
    });
  }

  if (githubReport) {
    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "github",
      status: githubReport.exists ? "ok" : "warn",
      summary: githubReport.exists
        ? `${githubReport.fullName} · ${githubReport.stars}★ · ${githubReport.recentCommitCount} commits`
        : githubReport.error || "GitHub unreachable",
    });
  }

  if (xPostReport) {
    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "xpost",
      status: xPostReport.textContent ? "ok" : "warn",
      summary: xPostReport.textContent
        ? `@${xPostReport.handle || "x"} · extracted ${xPostReport.textContent.length} chars via ${xPostReport.methodUsed}`
        : xPostReport.note || "X metadata restricted",
    });
  }

  // Decide which public URLs the real Chromium browser should visit visually
  const browserUrls: Array<{ url: string; label: string }> = [];
  if (target.kind === "website" && target.normalizedUrl) {
    browserUrls.push({ url: target.normalizedUrl, label: `Site · ${target.hostname}` });
  } else if (target.kind === "github_repo" && target.normalizedUrl) {
    browserUrls.push({
      url: target.normalizedUrl,
      label: `GitHub · ${target.githubOwnerRepo}`,
    });
  } else if (target.kind === "token_ca") {
    const linkedSite = chainReport?.dexPair?.websites?.[0];
    if (linkedSite) {
      try {
        await assertSafePublicHttpUrl(linkedSite);
        browserUrls.push({ url: linkedSite, label: `Project Site · ${new URL(linkedSite).hostname}` });
      } catch {
        // Ignore unsafe URL in third-party DexScreener/metadata
      }
    }
    if (browserUrls.length === 0 && target.normalizedUrl) {
      browserUrls.push({ url: target.normalizedUrl, label: "DexScreener Live Market" });
    }
  } else if ((target.kind === "x_post" || target.kind === "x_profile") && target.normalizedUrl) {
    const linkedFromTweet = xPostReport?.extractedUrls?.[0];
    if (linkedFromTweet) {
      try {
        await assertSafePublicHttpUrl(linkedFromTweet);
        browserUrls.push({
          url: linkedFromTweet,
          label: `Linked Site · ${new URL(linkedFromTweet).hostname}`,
        });
      } catch {
        // Ignore unsafe URL
      }
    }
    browserUrls.push({ url: target.normalizedUrl, label: "X / Social Source" });
  }

  emit({
    type: "step",
    stepId: "browser",
    elapsedMs: elapsed(),
    phase: "browser",
    title: "Launching real headless browser session",
    detail:
      browserUrls.length > 0
        ? `Opening ${browserUrls[0].url} to observe live DOM, XHR calls & visuals...`
        : "Preparing telemetry inspection...",
  });

  const browserSummary =
    options.enableBrowser === false
      ? {
          mode: "http-fallback" as const,
          executableLabel: "Browser disabled",
          stops: [],
          discoveredGithubRepos: [],
          discoveredXUrls: [],
          discoveredSolanaAddresses: [],
          discoveredWebsiteUrls: [],
          totalXhrObserved: 0,
          notes: [],
        }
      : await runLiveBrowserObservation({
          initialUrls: browserUrls,
          maxStops: 2,
          onFrame: (stop) => {
            emit({
              type: "frame",
              elapsedMs: elapsed(),
              url: stop.url,
              title: stop.title,
              stepLabel: stop.stepLabel,
              imageBase64: stop.screenshotBase64,
              xhrCount: stop.xhrCount,
            });
          },
          onNote: (note) => {
            emit({
              type: "step",
              stepId: "browser-note",
              elapsedMs: elapsed(),
              phase: "browser",
              title: "Browser navigation note",
              detail: note,
            });
          },
        });

  // Follow newly discovered GitHub repo, X post, Mint CA, or Domain from live browser run!
  const allGhCandidates = Array.from(
    new Set([
      ...browserSummary.discoveredGithubRepos,
      ...(xPostReport?.extractedGithubRepos ?? []),
    ])
  );
  const discoveredGh = !githubReport
    ? selectPrimaryGithubRepo(allGhCandidates, [
        target.hostname,
        target.rawInput,
        chainReport?.tokenReport?.name,
        chainReport?.tokenReport?.symbol,
        chainReport?.dexPair?.websites?.[0],
      ])
    : null;

  const discoveredMint =
    !chainReport
      ? browserSummary.discoveredSolanaAddresses[0] ||
        xPostReport?.extractedSolanaAddresses[0]
      : null;

  const primaryDomainHost =
    target.kind === "website"
      ? target.hostname
      : browserSummary.stops.find((s) => !s.url.includes("x.com") && !s.url.includes("github.com") && !s.url.includes("dexscreener.com"))?.url ||
        chainReport?.dexPair?.websites?.[0] ||
        xPostReport?.extractedUrls?.[0] ||
        null;

  emit({
    type: "step",
    stepId: "enrich",
    elapsedMs: elapsed(),
    phase: "collectors",
    title: "Cross-referencing discovered links & RDAP domain age",
    detail: "Running secondary forensic lookups on newly surfaced code, token & domain links...",
  });

  const [secGh, secChain, domRes] = await Promise.all([
    discoveredGh ? collectGitHubForensics(discoveredGh) : Promise.resolve(null),
    discoveredMint ? collectChainTokenIntel(discoveredMint) : Promise.resolve(null),
    primaryDomainHost
      ? collectDomainIntel(
          primaryDomainHost,
          browserSummary.stops[0]?.title || null,
          []
        )
      : Promise.resolve(null),
  ]);

  if (!githubReport && secGh) {
    githubReport = secGh;
    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "github",
      status: secGh.exists ? "ok" : "warn",
      summary: secGh.exists
        ? `Discovered ${secGh.fullName} · ${secGh.stars}★ · ${secGh.recentCommitCount} commits`
        : secGh.error || "Discovered GitHub unreachable",
    });
  }

  if (!chainReport && secChain) {
    chainReport = secChain;
    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "chain",
      status: secChain.tokenReport ? "ok" : "warn",
      summary: secChain.tokenReport
        ? `Discovered CA ${secChain.mintAddress.slice(0, 8)}... (${secChain.tokenReport.symbol || "SPL"})`
        : `Checked address ${secChain.mintAddress.slice(0, 8)}...`,
    });
  }

  if (domRes) {
    domainReport = domRes;
    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "domain",
      status: domRes.domainEval.riskLevel === "LOW" ? "ok" : "warn",
      summary: `${domRes.registrableDomain} · ${domRes.domainEval.status}${
        domRes.domainAgeDays !== null ? ` · Age ${domRes.domainAgeDays}d` : ""
      }`,
    });
  }

  // Enrich X post with browser excerpt if syndication/oEmbed couldn't read
  if (xPostReport && !xPostReport.textContent && browserSummary.stops.length > 0) {
    const xStop = browserSummary.stops.find((s) => s.url.includes("x.com"));
    if (xStop) {
      xPostReport = await collectXPostIntel(xPostReport.url, xStop.textExcerpt);
    }
  }

  let socialReport: SocialMindshareReport | null = null;
  if (options.enableSocial) {
    emit({
      type: "step",
      stepId: "social",
      elapsedMs: elapsed(),
      phase: "collectors",
      title: "Scanning X Mindshare & KOL discourse",
      detail: "Measuring real X threads, follower tiers, sentiment & hype alignment",
    });

    socialReport = await collectSocialMindshare({
      target,
      chain: chainReport,
      github: githubReport,
      domain: domainReport,
      xPost: xPostReport,
      browserXUrls: browserSummary.discoveredXUrls,
      veniceApiKey: options.apiKey,
      veniceModel: options.model,
    });

    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "social",
      status:
        socialReport.totalPostsSampled > 0 || socialReport.officialProfile
          ? socialReport.sentimentBreakdown.shillNoisePct >= 50 ||
            socialReport.quadrant === "NARRATIVE_OVERHEAT"
            ? "warn"
            : "ok"
          : socialReport.source === "unavailable"
            ? "warn"
            : "ok",
      summary:
        socialReport.totalPostsSampled > 0
          ? `Mindshare ${socialReport.mindshareScore}/100 · ${socialReport.kolCount} KOLs · ${socialReport.totalPostsSampled} posts`
          : socialReport.officialProfile
            ? `@${socialReport.officialProfile.username} (${socialReport.officialProfile.followersCount.toLocaleString("en-US")} followers) · 0 recent mentions`
            : "Pre-discovery / 0 X mentions",
    });
  } else {
    emit({
      type: "collector",
      elapsedMs: elapsed(),
      collector: "social",
      status: "idle",
      summary: "On-demand · Click to scan X Mindshare",
    });
  }

  emit({
    type: "step",
    stepId: "venice",
    elapsedMs: elapsed(),
    phase: "venice",
    title: "Running Venice AI Zero-Retention audit",
    detail:
      options.apiKey?.trim() || process.env.VENICE_API_KEY?.trim()
        ? "Evaluating live browser screenshot & hard forensic facts via Venice AI..."
        : "Running deterministic proof engine (connect Venice API key in UI or server for LLM Vision + Reasoning)...",
  });

  const finalReport = await synthesizeWithVeniceBuildCheck(
    {
      id,
      createdAt: new Date().toISOString(),
      elapsedMs: elapsed(),
      target,
      browser: browserSummary,
      github: githubReport,
      chain: chainReport,
      domain: domainReport,
      xPost: xPostReport,
    },
    {
      apiKey: options.apiKey,
      model: options.model,
      enableVision: options.enableBrowser !== false,
    }
  );

  if (socialReport) {
    const dualAxis = computeDualAxisSummary(finalReport);
    const refinedAlignment = computeMindshareBuildAlignment({
      mindshareScore: socialReport.mindshareScore,
      organicSignalPct: socialReport.organicSignalPct,
      skepticalPct: socialReport.sentimentBreakdown.skepticalPct,
      shillNoisePct: socialReport.sentimentBreakdown.shillNoisePct,
      totalPostsSampled: socialReport.totalPostsSampled,
      buildIntegrityScore: dualAxis.buildIntegrity.score,
    });
    finalReport.social = {
      ...socialReport,
      quadrant: refinedAlignment.quadrant,
      quadrantLabel: refinedAlignment.quadrantLabel,
      quadrantSummary: refinedAlignment.quadrantSummary,
    };
  } else {
    finalReport.social = null;
  }

  finalReport.elapsedMs = elapsed();

  if (finalReport.chain?.tokenReport) {
    await recordScannedToken(
      finalReport.chain.tokenReport,
      "buildcheck",
      toScannedTokenExtraFromReport(finalReport)
    );
  }

  await saveBuildCheckReportPermalink(finalReport).catch(() => undefined);

  if (!options.bypassCache) {
    const rawTtl = Number(process.env.BUILDCHECK_CACHE_TTL_MS || DEFAULT_BUILDCHECK_CACHE_TTL_MS);
    const baseTtl = Number.isFinite(rawTtl) && rawTtl >= 1000 ? rawTtl : DEFAULT_BUILDCHECK_CACHE_TTL_MS;
    const hadVeniceKey = Boolean(options.apiKey?.trim() || process.env.VENICE_API_KEY?.trim());
    const ttlMs =
      hadVeniceKey && finalReport.inferenceMode === "deterministic-fallback"
        ? Math.min(baseTtl, DEGRADED_VENICE_CACHE_TTL_MS)
        : baseTtl;

    const stored = await setCachedEntry("buildcheck", cacheKey, finalReport, ttlMs);
    finalReport.cache = {
      hit: false,
      cachedAt: stored.cachedAt,
      expiresAt: stored.expiresAt,
      cacheKey,
    };
  }

  emit({
    type: "verdict",
    elapsedMs: finalReport.elapsedMs,
    report: finalReport,
  });

  return finalReport;
}
