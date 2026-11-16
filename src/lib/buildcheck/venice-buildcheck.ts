import { DEFAULT_VENICE_MODEL, VENICE_API_BASE_URL } from "../venice-ai";
import type {
  BrowserRunSummary,
  BuildCheckComponentScores,
  BuildCheckReport,
  BuildCheckVerdict,
  ChainTokenIntelReport,
  ClaimVsProofRow,
  DomainIntelReport,
  GitHubForensicReport,
  ParsedTargetInput,
  XPostIntelReport,
} from "./types";

export const VENICE_VISION_MODEL = "qwen3-vl-235b-a22b";

export interface VeniceBuildCheckInput {
  id: string;
  createdAt: string;
  elapsedMs: number;
  target: ParsedTargetInput;
  browser: BrowserRunSummary;
  github: GitHubForensicReport | null;
  chain: ChainTokenIntelReport | null;
  domain: DomainIntelReport | null;
  xPost: XPostIntelReport | null;
}

export interface VeniceBuildCheckOptions {
  apiKey?: string;
  model?: string;
  enableVision?: boolean;
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function deriveVerdict(score: number): BuildCheckVerdict {
  if (score >= 70) return "VERIFIED_BUILD";
  if (score >= 42) return "UNPROVEN_HYPE";
  return "HIGH_FABRICATION_RISK";
}

interface ContradictionRule {
  claimLabel: string;
  pattern: RegExp;
  penalty: number;
  check: (ctx: {
    input: VeniceBuildCheckInput;
    matchingStop: VeniceBuildCheckInput["browser"]["stops"][number] | undefined;
  }) => string | null;
}

const MARKETING_CONTRADICTION_RULES: ContradictionRule[] = [
  {
    claimLabel: "Open-source engineering claim",
    pattern:
      /\b(100%\s*open[- ]?source|open[- ]?source\s+(?:protocol|infra|ai|codebase)|public\s+github)\b/i,
    penalty: 12,
    check: ({ input }) => {
      const gh = input.github;
      if (!gh || !gh.exists) {
        return "Copy advertises open-source engineering, yet no public non-fork GitHub repository was found.";
      }
      if (gh.isFork && gh.stars < 15 && gh.recentCommitCount <= 3) {
        return `Copy claims original open-source build, yet ${gh.fullName} is a low-activity fork (${gh.recentCommitCount} commits).`;
      }
      return null;
    },
  },
  {
    claimLabel: "Live AI / working app claim",
    pattern:
      /\b(live\s+(?:ai|agent|app|terminal|api|swap|dex)|autonomous\s+ai|ai[- ]?powered\s+(?:infra|engine|agent)|realtime\s+api)\b/i,
    penalty: 12,
    check: ({ input, matchingStop }) => {
      if (matchingStop?.hasPlaceholderCopy) {
        return "Copy promotes a live AI/product experience while rendered site contains placeholder/Coming Soon copy.";
      }
      if (
        matchingStop &&
        matchingStop.xhrCount === 0 &&
        !input.github?.exists &&
        input.domain?.domainAgeDays !== null &&
        input.domain !== null &&
        input.domain.domainAgeDays <= 14
      ) {
        return `Copy pitches live AI/API utility, yet ${input.domain.registrableDomain} (${input.domain.domainAgeDays}d old) logged 0 live XHR calls with no repo.`;
      }
      return null;
    },
  },
  {
    claimLabel: "Security audit claim",
    pattern:
      /\b(audited\s+by|certik|hacken|ottersec|neodyme|zellic|security\s+audited)\b/i,
    penalty: 12,
    check: ({ input }) => {
      const tok = input.chain?.tokenReport;
      const holders = input.chain?.deep?.holders;
      if (
        tok &&
        (tok.mintAuthority !== null ||
          tok.freezeAuthority !== null ||
          tok.riskScore >= 55)
      ) {
        return `Copy highlights a third-party audit while Solana mint/freeze authorities or risk (${tok.riskScore}/100) remain flagged.`;
      }
      if (holders && holders.score < 45) {
        return `Copy claims audited safety, yet on-chain holder hygiene scored ${holders.score}/100.`;
      }
      return null;
    },
  },
  {
    claimLabel: "Fair launch / decentralization claim",
    pattern:
      /\b(fair\s*launch|no\s+team\s+tokens|0%\s*dev|100%\s*community|anti[- ]?whale)\b/i,
    penalty: 12,
    check: ({ input }) => {
      const deep = input.chain?.deep;
      if (!deep) return null;
      const { devHistory, holders } = deep;
      if (
        devHistory.tokenHoldingPct >= 5 ||
        holders.distribution.insidersPct >= 20 ||
        holders.distribution.snipersPct >= 20 ||
        holders.clusters.length >= 2
      ) {
        return `Copy pitches fair/0%-dev distribution while on-chain trace shows Dev ${devHistory.tokenHoldingPct.toFixed(1)}%, Insiders ${holders.distribution.insidersPct.toFixed(1)}%, and Snipers ${holders.distribution.snipersPct.toFixed(1)}%.`;
      }
      return null;
    },
  },
  {
    claimLabel: "Revoked token authorities claim",
    pattern:
      /\b(mint\s+(?:is\s+)?revoked|freeze\s+(?:is\s+)?revoked|renounced\s+authorities)\b/i,
    penalty: 15,
    check: ({ input }) => {
      const tok = input.chain?.tokenReport;
      if (!tok) return null;
      if (tok.mintAuthority !== null || tok.freezeAuthority !== null) {
        return `Marketing claims revoked authorities while on-chain MintAuth=${tok.mintAuthority ? "ACTIVE" : "Null"} / FreezeAuth=${tok.freezeAuthority ? "ACTIVE" : "Null"}.`;
      }
      return null;
    },
  },
];

function evaluateMarketingContradictions(
  input: VeniceBuildCheckInput,
  combinedCopy: string,
  matchingStop: VeniceBuildCheckInput["browser"]["stops"][number] | undefined
): {
  rows: ClaimVsProofRow[];
  redFlags: string[];
  penalty: number;
} {
  if (!combinedCopy.trim()) {
    return { rows: [], redFlags: [], penalty: 0 };
  }
  const hasCopySource =
    input.browser.stops.length > 0 || input.xPost !== null;
  if (!hasCopySource) {
    return { rows: [], redFlags: [], penalty: 0 };
  }

  const rows: ClaimVsProofRow[] = [];
  const redFlags: string[] = [];
  let penalty = 0;

  for (const rule of MARKETING_CONTRADICTION_RULES) {
    if (!rule.pattern.test(combinedCopy)) continue;
    const mismatch = rule.check({ input, matchingStop });
    if (!mismatch) continue;
    rows.push({
      claim: rule.claimLabel,
      status: "CONTRADICTED",
      evidence: mismatch,
    });
    redFlags.push(`Contradiction: ${mismatch}`);
    penalty += rule.penalty;
  }

  return { rows, redFlags, penalty: Math.min(20, penalty) };
}

function deriveContradictionCalloutFromRows(
  rows: ClaimVsProofRow[],
  fallbackFlags: string[] = []
): string | null {
  const topContradicted = rows.find((r) => r.status === "CONTRADICTED");
  if (topContradicted) {
    return topContradicted.evidence;
  }
  const apiFlag = fallbackFlags.find((f) =>
    f.startsWith("API contradiction:") || f.startsWith("Contradiction:")
  );
  return apiFlag || null;
}

/**
 * Computes transparent deterministic scores & claims-vs-proof rows directly
 * from collected GitHub, On-Chain, Domain, and Browser evidence.
 */
export function buildDeterministicBuildCheck(
  input: VeniceBuildCheckInput
): Omit<BuildCheckReport, "modelsUsed" | "visionSummary" | "inferenceMode"> {
  const verifiedSignals: string[] = [];
  const keyRedFlags: string[] = [];
  const claimsVsProof: ClaimVsProofRow[] = [];

  // 1. Code Proof Score
  let codeProof: number | null = null;
  if (input.github) {
    if (!input.github.exists) {
      codeProof = 18;
      keyRedFlags.push(`GitHub target ${input.github.fullName} unreachable or missing.`);
      claimsVsProof.push({
        claim: `Open-source repository (${input.github.fullName})`,
        status: "CONTRADICTED",
        evidence: input.github.error || "Repository could not be verified.",
      });
    } else {
      let s = 55;
      if (input.github.ageDays !== null && input.github.ageDays >= 30) s += 16;
      else if (input.github.ageDays !== null && input.github.ageDays <= 7) s -= 18;
      if (input.github.hasPackageManifest) s += 10;
      else s -= 24;
      if (input.github.hasTestsOrCi) s += 10;
      if (input.github.stars >= 25) s += 8;
      if (input.github.uniqueAuthorCount >= 2) s += 6;
      if (input.github.isFork) s -= 16;
      if (input.github.burstCommitRatio >= 0.85 && (input.github.ageDays ?? 0) <= 14) {
        s -= 25;
      }
      codeProof = clampScore(s);

      for (const sig of input.github.signals) {
        if (sig.severity === "CRITICAL" || sig.severity === "WARNING") {
          keyRedFlags.push(sig.message);
        } else {
          verifiedSignals.push(sig.message);
        }
      }

      claimsVsProof.push({
        claim: `Active codebase (${input.github.fullName})`,
        status:
          codeProof >= 68 ? "VERIFIED" : codeProof >= 40 ? "MIXED" : "CONTRADICTED",
        evidence: `${input.github.stars} stars · ${input.github.recentCommitCount} recent commits · ${
          input.github.hasPackageManifest ? "build manifest present" : "no build manifest"
        }${input.github.isFork ? ` · fork of ${input.github.forkParent || "upstream"}` : ""}`,
      });
    }
  }

  // 2. Chain & Token Proof Score
  let chainProof: number | null = null;
  if (input.chain) {
    let s = 72;
    const tok = input.chain.tokenReport;
    if (tok) {
      s = Math.max(10, 100 - tok.riskScore);
      if (tok.verifiedAsset) {
        verifiedSignals.push(
          `Canonical verified asset (${tok.symbol || tok.mintAddress.slice(0, 8)} issued by ${tok.verifiedAsset.issuer}).`
        );
      } else if (tok.mintAuthority === null && tok.freezeAuthority === null) {
        verifiedSignals.push(
          `Token mint & freeze authorities are revoked (${tok.symbol || tok.mintAddress.slice(0, 8)}).`
        );
      }
      for (const flag of tok.flags) {
        if (flag.severity === "CRITICAL" || flag.severity === "HIGH") {
          keyRedFlags.push(`${flag.title}: ${flag.description}`);
        }
      }
    } else if (input.chain.error) {
      s = 40;
      keyRedFlags.push(`On-chain lookup issue: ${input.chain.error}`);
    }

    if (input.chain.dexPair) {
      const liq = input.chain.dexPair.liquidityUsd;
      if (liq >= 25_000) {
        s = Math.min(100, s + 8);
        verifiedSignals.push(
          `Live DEX liquidity $${liq.toLocaleString("en-US")} on ${input.chain.dexPair.dexId}.`
        );
      } else if (liq < 2_500) {
        s = Math.max(5, s - 16);
        keyRedFlags.push(
          `Very thin DEX liquidity ($${liq.toLocaleString("en-US")}) observed on ${input.chain.dexPair.dexId}.`
        );
      }
    }

    chainProof = clampScore(s);
    claimsVsProof.push({
      claim: `On-chain Solana Mint (${input.chain.mintAddress.slice(0, 8)}...)`,
      status:
        chainProof >= 68 ? "VERIFIED" : chainProof >= 40 ? "MIXED" : "CONTRADICTED",
      evidence: tok
        ? tok.verifiedAsset
          ? `${tok.tokenProgram} · Canonical ${tok.verifiedAsset.issuer} ${tok.symbol || "asset"} · Regulated/verified authorities`
          : `${tok.tokenProgram} · MintAuth=${tok.mintAuthority ? "ACTIVE" : "Null"} · FreezeAuth=${
              tok.freezeAuthority ? "ACTIVE" : "Null"
            } · Top5=${tok.top5Pct.toFixed(1)}%`
        : input.chain.error || "Unable to verify SPL mint structure.",
    });
  }

  // 3. Domain & Live Browser Proof Score
  let domainProof: number | null = null;
  if (input.domain) {
    let s = 100 - input.domain.domainEval.riskScore;
    if (input.domain.domainAgeDays !== null) {
      if (input.domain.domainAgeDays >= 90) {
        s += 10;
        verifiedSignals.push(
          `Domain ${input.domain.registrableDomain} registered ${input.domain.domainAgeDays} days ago.`
        );
      } else if (input.domain.domainAgeDays <= 14) {
        s -= 22;
        keyRedFlags.push(
          `Fresh domain registration: ${input.domain.registrableDomain} is only ${input.domain.domainAgeDays} day(s) old.`
        );
      }
    }
    if (input.domain.domainEval.reasons.length > 0 && s < 65) {
      keyRedFlags.push(...input.domain.domainEval.reasons);
    }
    const matchingStop = input.browser.stops.find((st) =>
      st.url.includes(input.domain?.hostname || "")
    );
    if (matchingStop?.hasPlaceholderCopy) {
      s -= 24;
      keyRedFlags.push(
        "Rendered DOM contains placeholder or demo-only copy (e.g. Coming Soon / Lorem Ipsum)."
      );
    }
    if (matchingStop && matchingStop.xhrCount > 0) {
      verifiedSignals.push(
        `Observed ${matchingStop.xhrCount} live network API call(s) during browser execution.`
      );
    }
    if ((matchingStop?.consoleErrors?.length ?? 0) > 0) {
      s -= Math.min(14, (matchingStop!.consoleErrors!.length) * 5);
      keyRedFlags.push(
        `Rendered site threw ${matchingStop!.consoleErrors!.length} browser console/runtime error(s) on load.`
      );
    }
    domainProof = clampScore(s);

    claimsVsProof.push({
      claim: `Web infrastructure (${input.domain.hostname})`,
      status:
        domainProof >= 68 ? "VERIFIED" : domainProof >= 40 ? "MIXED" : "CONTRADICTED",
      evidence: `Status ${input.domain.domainEval.status}${
        input.domain.domainAgeDays !== null
          ? ` · Registered ${input.domain.domainAgeDays}d ago`
          : " · RDAP age unknown"
      }`,
    });
  }

  // 4. Deep Holders, Cabal Clusters & API Payload Truth Checks
  let holdersProof: number | null = null;
  const deepChain = input.chain?.deep;
  if (deepChain) {
    holdersProof = deepChain.holders.score;
    for (const cluster of deepChain.holders.clusters) {
      keyRedFlags.push(
        `${cluster.label} holds ${cluster.combinedPct.toFixed(1)}% of supply.`
      );
    }
    if (deepChain.holders.distribution.snipersPct >= 15) {
      keyRedFlags.push(
        `Same-window launch snipers still hold ${deepChain.holders.distribution.snipersPct.toFixed(1)}% of supply.`
      );
    }
    if (deepChain.holders.clusters.length > 0 || deepChain.holders.distribution.snipersPct >= 15) {
      claimsVsProof.push({
        claim: `Token holder distribution (${deepChain.holders.verdict})`,
        status: deepChain.holders.score >= 68 ? "VERIFIED" : deepChain.holders.score >= 40 ? "MIXED" : "CONTRADICTED",
        evidence: `Score ${deepChain.holders.score}/100 · Cabal/Insiders ${deepChain.holders.distribution.insidersPct}% · Snipers ${deepChain.holders.distribution.snipersPct}% · Dev ${deepChain.devHistory.tokenHoldingPct}%`,
      });
    } else if (deepChain.holders.score >= 70) {
      verifiedSignals.push(
        `Holder distribution scored ${deepChain.holders.score}/100 (${deepChain.holders.verdict}) with Dev holding ${deepChain.devHistory.tokenHoldingPct}%.`
      );
    }
  }

  // Inspect live browser XHR JSON payloads vs surface claims
  const allApiPayloads =
    input.browser.inspectedApiPayloads ||
    input.browser.stops.flatMap((st) => st.apiPayloads || []);
  const combinedCopy = [
    ...input.browser.stops.map((st) => st.textExcerpt),
    input.xPost?.textContent || "",
  ]
    .join(" ")
    .toLowerCase();

  let apiPenalty = 0;
  const seenApiPaths = new Set<string>();
  let flaggedDevnetMismatch = false;
  let flaggedFallbackMode = false;

  for (const payload of allApiPayloads) {
    const endpointPath = (() => {
      try {
        return new URL(payload.url).pathname;
      } catch {
        return payload.url;
      }
    })();
    if (seenApiPaths.has(endpointPath)) continue;
    seenApiPaths.add(endpointPath);

    const bodyLower = payload.jsonExcerpt.toLowerCase();
    const mentionsMainnet = /solana mainnet|live on mainnet|mainnet firewall/i.test(combinedCopy);
    const reportsDevnet = /"cluster"\s*:\s*"devnet"/i.test(bodyLower);
    const explicitlyDevnet = /devnet policy vault|policy vault \(devnet\)/i.test(combinedCopy);
    if (mentionsMainnet && reportsDevnet && !explicitlyDevnet && !flaggedDevnetMismatch) {
      flaggedDevnetMismatch = true;
      apiPenalty += 16;
      keyRedFlags.push(
        `API contradiction: endpoint ${endpointPath} reports cluster "devnet" while public copy claims Mainnet.`
      );
      claimsVsProof.push({
        claim: `Endpoint state (${endpointPath})`,
        status: "CONTRADICTED",
        evidence: `JSON payload reports cluster="devnet" vs Mainnet claim in rendered text.`,
      });
    }
    if (/"inferencemode"\s*:\s*"deterministic-fallback"/i.test(bodyLower) && /venice ai/i.test(combinedCopy) && !flaggedFallbackMode) {
      flaggedFallbackMode = true;
      apiPenalty += 6;
      keyRedFlags.push(
        `Observed ${endpointPath} returning deterministic-fallback instead of live Venice AI inference.`
      );
    }
  }
  apiPenalty = Math.min(22, apiPenalty);

  // Cross-check surface marketing claims (web DOM + X post) against hard code, browser & chain telemetry
  const primaryStopForClaims =
    (input.domain
      ? input.browser.stops.find((st) =>
          st.url.includes(input.domain?.hostname || "")
        )
      : undefined) || input.browser.stops[0];
  const claimAudit = evaluateMarketingContradictions(
    input,
    combinedCopy,
    primaryStopForClaims
  );
  if (claimAudit.rows.length > 0) {
    // Surface direct contradictions first so they are preserved within the 6-row dispatch budget
    claimsVsProof.unshift(...claimAudit.rows);
    keyRedFlags.unshift(...claimAudit.redFlags);
  }

  if (input.xPost) {
    claimsVsProof.push({
      claim: `X claim source (${input.xPost.handle ? `@${input.xPost.handle}` : input.xPost.url})`,
      status: input.xPost.textContent ? "MIXED" : "UNVERIFIED",
      evidence: input.xPost.textContent
        ? `Extracted ${input.xPost.textContent.length} chars via ${input.xPost.methodUsed}; ${input.xPost.extractedUrls.length} link(s) audited.`
        : input.xPost.note || "X post text blocked without active session.",
    });
  }

  // Weighted average across observed pillars (including Holders/Cabal proof when available)
  const activeScores = [codeProof, chainProof, domainProof, holdersProof].filter(
    (v): v is number => v !== null
  );
  let baseScore =
    activeScores.length > 0
      ? activeScores.reduce((acc, cur) => acc + cur, 0) / activeScores.length
      : 45;

  baseScore -= apiPenalty + claimAudit.penalty;

  // Guardrail 1: Zero verifiable code AND zero verifiable chain proof cannot hit VERIFIED_BUILD
  if (codeProof === null && chainProof === null) {
    baseScore = Math.min(baseScore, 62);
    keyRedFlags.push("No verifiable GitHub repository or Solana Mint CA discovered on target.");
  }

  // Guardrail 2: Bare Token CA with zero verifiable codebase AND zero verifiable website cannot score > 64
  if (codeProof === null && domainProof === null && chainProof !== null) {
    baseScore = Math.min(baseScore, 64);
    keyRedFlags.push(
      "Token CA has no verified project website or open-source GitHub repo attached yet."
    );
  }

  const authenticityScore = clampScore(baseScore);
  const verdict = deriveVerdict(authenticityScore);
  const headline =
    verdict === "VERIFIED_BUILD"
      ? "Evidence aligns across verified code, infrastructure, or on-chain telemetry."
      : verdict === "UNPROVEN_HYPE"
        ? "Partial signals verified, but key claims lack independent technical or on-chain proof."
        : "Significant contradictions or fabrication indicators detected across collected evidence.";

  const componentScores: BuildCheckComponentScores = {
    codeProof,
    chainProof,
    domainProof,
    holdersProof,
    claimAlignment: authenticityScore,
  };

  const trimmedClaims = claimsVsProof.slice(0, 6);
  const trimmedRedFlags = Array.from(new Set(keyRedFlags)).slice(0, 6);
  const contradictionCallout = deriveContradictionCalloutFromRows(
    trimmedClaims,
    trimmedRedFlags
  );

  return {
    id: input.id,
    createdAt: input.createdAt,
    elapsedMs: input.elapsedMs,
    target: input.target,
    authenticityScore,
    verdict,
    headline,
    contradictionCallout,
    executiveSummary: `${headline} Analyzed via ${input.browser.mode} (${input.browser.stops.length} live capture stop(s)).`,
    privacyAttestation:
      "Audited under Zero Data Retention · No wallet keys or visitor identity logged.",
    componentScores,
    claimsVsProof: trimmedClaims,
    verifiedSignals: Array.from(new Set(verifiedSignals)).slice(0, 6),
    keyRedFlags: trimmedRedFlags,
    browser: input.browser,
    github: input.github,
    chain: input.chain,
    domain: input.domain,
    xPost: input.xPost,
  };
}

async function analyzeScreenshotWithVeniceVision(
  screenshotBase64: string,
  targetUrl: string,
  apiKey: string
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: VENICE_VISION_MODEL,
        temperature: 0.1,
        max_tokens: 240,
        venice_parameters: { include_venice_system_prompt: false },
        messages: [
          {
            role: "system",
            content:
              "You are a forensic Web3 UI auditor. Inspect this browser screenshot objectively in 2 concise sentences: describe what is actually shown, whether it looks like an operational application/explorer/product UI or a placeholder/broken page (note that real web3 apps often route interactive tools under tabs or subpages below the hero), and note any suspicious visual claims.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Captured live browser view of ${targetUrl}` },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesizes final Proof Score and Claims-vs-Reality verdict using Venice AI
 * private inference (+ optional Venice Vision inspection of live Chromium screenshot),
 * falling back deterministically if VENICE_API_KEY is unset or unavailable.
 */
export async function synthesizeWithVeniceBuildCheck(
  input: VeniceBuildCheckInput,
  options: VeniceBuildCheckOptions = {}
): Promise<BuildCheckReport> {
  const baseline = buildDeterministicBuildCheck(input);
  const apiKey =
    options.apiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
  const textModel = options.model?.trim() || DEFAULT_VENICE_MODEL;

  if (!apiKey) {
    return {
      ...baseline,
      inferenceMode: "deterministic-fallback",
      modelsUsed: ["deterministic-forensic-v1"],
      visionSummary: null,
    };
  }

  let visionSummary: string | null = null;
  const modelsUsed: string[] = [];

  // Run Vision pre-pass on primary captured Chromium frame if enabled
  const primaryStop = input.browser.stops[0];
  if ((options.enableVision ?? true) && primaryStop?.screenshotBase64) {
    visionSummary = await analyzeScreenshotWithVeniceVision(
      primaryStop.screenshotBase64,
      primaryStop.url,
      apiKey
    );
    if (visionSummary) {
      modelsUsed.push(VENICE_VISION_MODEL);
    }
  }

  const evidencePayload = {
    target: input.target,
    deterministicBaselineScore: baseline.authenticityScore,
    deterministicComponentScores: baseline.componentScores,
    deterministicVerifiedSignals: baseline.verifiedSignals,
    deterministicRedFlags: baseline.keyRedFlags,
    visionSummary,
    browserStops: input.browser.stops.map((s) => ({
      url: s.url,
      title: s.title,
      xhrCount: s.xhrCount,
      networkHosts: s.networkHosts,
      hasPlaceholderCopy: s.hasPlaceholderCopy,
      consoleErrors: s.consoleErrors || [],
      apiPayloads: s.apiPayloads || [],
      textExcerpt: s.textExcerpt.slice(0, 1200),
    })),
    github: input.github
      ? {
          fullName: input.github.fullName,
          exists: input.github.exists,
          description: input.github.description,
          isFork: input.github.isFork,
          forkParent: input.github.forkParent,
          stars: input.github.stars,
          ageDays: input.github.ageDays,
          ownerAccountAgeDays: input.github.ownerAccountAgeDays,
          recentCommitCount: input.github.recentCommitCount,
          uniqueAuthorCount: input.github.uniqueAuthorCount,
          burstCommitRatio: input.github.burstCommitRatio,
          hasTestsOrCi: input.github.hasTestsOrCi,
          hasPackageManifest: input.github.hasPackageManifest,
          topLanguages: input.github.topLanguages,
          topLevelFiles: input.github.topLevelFiles.slice(0, 20),
          signals: input.github.signals,
        }
      : null,
    chain: input.chain
      ? {
          mintAddress: input.chain.mintAddress,
          verifiedAsset: input.chain.tokenReport?.verifiedAsset ?? null,
          tokenProgram: input.chain.tokenReport?.tokenProgram,
          mintAuthority: input.chain.tokenReport?.mintAuthority,
          freezeAuthority: input.chain.tokenReport?.freezeAuthority,
          top5Pct: input.chain.tokenReport?.top5Pct,
          riskScore: input.chain.tokenReport?.riskScore,
          flags: input.chain.tokenReport?.flags.map((f) => f.title),
          dexPair: input.chain.dexPair,
          holders: input.chain.deep?.holders
            ? {
                score: input.chain.deep.holders.score,
                verdict: input.chain.deep.holders.verdict,
                distribution: input.chain.deep.holders.distribution,
                clustersCount: input.chain.deep.holders.clusters.length,
                notes: input.chain.deep.holders.notes,
              }
            : null,
          devHistory: input.chain.deep?.devHistory
            ? {
                devAddress: input.chain.deep.devHistory.devAddress,
                solBalance: input.chain.deep.devHistory.solBalance,
                tokenHoldingPct: input.chain.deep.devHistory.tokenHoldingPct,
                coinsLaunchedCount: input.chain.deep.devHistory.coinsLaunchedCount,
              }
            : null,
        }
      : null,
    domain: input.domain
      ? {
          hostname: input.domain.hostname,
          status: input.domain.domainEval.status,
          domainAgeDays: input.domain.domainAgeDays,
          rdapCreatedAt: input.domain.rdapCreatedAt,
        }
      : null,
    xPost: input.xPost,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: textModel,
        temperature: 0.1,
        max_tokens: 800,
        venice_parameters: { include_venice_system_prompt: false },
        messages: [
          {
            role: "system",
            content: `You are SolShield BuildCheck, a calibrated, unfiltered Web3 proof-of-build forensic auditor running on Zero-Retention Venice AI.
Compare claimed capabilities in rendered web copy / X posts against ONLY the concrete evidence provided (GitHub metrics & topLevelFiles/description, Solana on-chain authorities/liquidity/holders, domain age, live browser DOM/XHR telemetry, deterministicComponentScores, and Vision notes). Never invent claims or demand proof on the homepage hero when the verified open-source repository and live API XHR telemetry already prove real engineering.
Calibration & Unfiltered Contradiction rules:
- Anchor near deterministicBaselineScore unless concrete contradictions (missing/fake/forked/single-burst repo vs open-source claims, Coming Soon/placeholder DOM vs live product claims, active mint/freeze authority or severe cabal exposure vs audited/fair-launch claims, or API cluster contradiction) justify deviating.
- When concrete contradictions exist, call them out bluntly without PR hedging in "contradictionCallout" (1 crisp sentence contrasting claim vs hard metric). Return null for "contradictionCallout" when no verified contradiction exists.
- A recently launched authentic build (young domainAgeDays/pairAgeHours) with an active non-fork repo (hasPackageManifest + hasTestsOrCi + commits), revoked authorities (mintAuthority=null, freezeAuthority=null), and operational app telemetry (xhrCount>0, zero console errors, !hasPlaceholderCopy) is a legitimate verified build — do NOT mark product features implemented in the verified repo as CONTRADICTED just because the landing page hero does not show every sub-page above the fold.
Respond ONLY with valid JSON:
{
  "authenticityScore": <integer 0-100 where 100 is completely proven authentic build and 0 is fabricated/fake>,
  "headline": "<sharp 1-sentence conclusion>",
  "contradictionCallout": <string 1 blunt claim-vs-proof contradiction sentence OR null>,
  "executiveSummary": "<2-3 factual plain-English sentences summarizing findings>",
  "claimsVsProof": [
    { "claim": "<short claim>", "status": "VERIFIED" | "MIXED" | "CONTRADICTED" | "UNVERIFIED", "evidence": "<exact metric or observation>" }
  ],
  "verifiedSignals": ["<concrete green fact>"],
  "keyRedFlags": ["<concrete contradiction or risk>"]
}`,
          },
          {
            role: "user",
            content: JSON.stringify(evidencePayload),
          },
        ],
      }),
    });

    if (!res.ok) {
      return {
        ...baseline,
        inferenceMode: visionSummary ? "venice-live-api" : "deterministic-fallback",
        modelsUsed:
          modelsUsed.length > 0 ? modelsUsed : ["deterministic-forensic-v1"],
        visionSummary,
      };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Non-JSON Venice response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      authenticityScore?: number;
      headline?: string;
      contradictionCallout?: string | null;
      executiveSummary?: string;
      claimsVsProof?: ClaimVsProofRow[];
      verifiedSignals?: string[];
      keyRedFlags?: string[];
    };

    modelsUsed.push(textModel);

    // Monotonic guardrails:
    // 1) If deterministic rules spotted critical contradiction (< 40), prevent prompt injection from inflating above 55.
    // 2) If all hard deterministic pillars confirm an authentic non-fork open-source build with clean on-chain & web telemetry (>= 70),
    //    prevent subjective hero-screenshot misreads from slashing the score below VERIFIED_BUILD.
    const rawAiScore =
      typeof parsed.authenticityScore === "number"
        ? clampScore(parsed.authenticityScore)
        : baseline.authenticityScore;

    const hasVerifiedCodeBuild = Boolean(
      input.github?.exists &&
        input.github.hasPackageManifest &&
        input.github.hasTestsOrCi &&
        !input.github.isFork &&
        input.github.burstCommitRatio < 0.85
    );
    const hasCleanLiveWeb =
      !input.browser.stops.some((st) => st.hasPlaceholderCopy) &&
      (baseline.componentScores.domainProof === null ||
        baseline.componentScores.domainProof >= 60);
    const hasCriticalRugOrContradiction =
      Boolean(
        input.chain?.tokenReport?.flags.some((f) => f.severity === "CRITICAL")
      ) ||
      baseline.keyRedFlags.some(
        (f) => f.startsWith("API contradiction:") || f.startsWith("Contradiction:")
      );

    const finalScore =
      baseline.authenticityScore < 40
        ? Math.min(rawAiScore, 55)
        : baseline.authenticityScore >= 70 &&
            hasVerifiedCodeBuild &&
            hasCleanLiveWeb &&
            !hasCriticalRugOrContradiction
          ? Math.max(rawAiScore, Math.max(70, baseline.authenticityScore - 6))
          : rawAiScore;

    const finalClaims =
      Array.isArray(parsed.claimsVsProof) && parsed.claimsVsProof.length > 0
        ? parsed.claimsVsProof.slice(0, 6)
        : baseline.claimsVsProof;
    const finalRedFlags =
      Array.isArray(parsed.keyRedFlags) && parsed.keyRedFlags.length > 0
        ? parsed.keyRedFlags.slice(0, 6)
        : baseline.keyRedFlags;
    const hasVerifiedCleanShield =
      finalScore >= 70 &&
      hasVerifiedCodeBuild &&
      hasCleanLiveWeb &&
      !hasCriticalRugOrContradiction &&
      !finalClaims.some((r) => r.status === "CONTRADICTED");
    const aiCallout =
      typeof parsed.contradictionCallout === "string" &&
      parsed.contradictionCallout.trim().length > 0
        ? parsed.contradictionCallout.trim()
        : null;
    const finalCallout = hasVerifiedCleanShield
      ? null
      : aiCallout ||
        baseline.contradictionCallout ||
        deriveContradictionCalloutFromRows(finalClaims, finalRedFlags);

    return {
      ...baseline,
      authenticityScore: finalScore,
      verdict: deriveVerdict(finalScore),
      headline: parsed.headline?.trim() || baseline.headline,
      contradictionCallout: finalCallout,
      executiveSummary: parsed.executiveSummary?.trim() || baseline.executiveSummary,
      claimsVsProof: finalClaims,
      verifiedSignals:
        Array.isArray(parsed.verifiedSignals) && parsed.verifiedSignals.length > 0
          ? parsed.verifiedSignals.slice(0, 6)
          : baseline.verifiedSignals,
      keyRedFlags: finalRedFlags,
      inferenceMode: "venice-live-api",
      modelsUsed,
      visionSummary,
    };
  } catch {
    return {
      ...baseline,
      inferenceMode: visionSummary ? "venice-live-api" : "deterministic-fallback",
      modelsUsed:
        modelsUsed.length > 0 ? modelsUsed : ["deterministic-forensic-v1"],
      visionSummary,
    };
  } finally {
    clearTimeout(timer);
  }
}
