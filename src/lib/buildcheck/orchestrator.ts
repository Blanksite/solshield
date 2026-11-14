import crypto from "node:crypto";
import { runLiveBrowserObservation } from "./browser-agent";
import {
  collectChainTokenIntel,
  collectDomainIntel,
  collectGitHubForensics,
  collectXPostIntel,
} from "./collectors";
import { extractEntitiesFromText, parseBuildCheckInput } from "./input-parser";
import type {
  BuildCheckReport,
  BuildCheckStreamEvent,
  ChainTokenIntelReport,
  DomainIntelReport,
  GitHubForensicReport,
  XPostIntelReport,
} from "./types";
import { assertSafePublicHttpUrl } from "./url-safety";
import {
  synthesizeWithVeniceBuildCheck,
  type VeniceBuildCheckOptions,
} from "./venice-buildcheck";

export interface RunBuildCheckOptions extends VeniceBuildCheckOptions {
  enableBrowser?: boolean;
  onEvent?: (event: BuildCheckStreamEvent) => void;
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
  const startMs = Date.now();
  const id = `bc_${crypto.randomBytes(5).toString("hex")}`;
  const emit = (ev: BuildCheckStreamEvent) => options.onEvent?.(ev);
  const elapsed = () => Date.now() - startMs;

  const target = parseBuildCheckInput(rawInput);

  if (target.normalizedUrl && target.kind !== "token_ca") {
    await assertSafePublicHttpUrl(target.normalizedUrl);
  }

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

  finalReport.elapsedMs = elapsed();

  emit({
    type: "verdict",
    elapsedMs: finalReport.elapsedMs,
    report: finalReport,
  });

  return finalReport;
}
