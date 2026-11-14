import { NextRequest } from "next/server";
import {
  buildGuardErrorResponse,
  runGuardedCachedOperation,
} from "@/lib/api-guard";
import { corsJson, corsOptionsResponse } from "@/lib/cors";
import {
  DomainEvaluation,
  evaluateDomainSafety,
  normalizeHostname,
} from "@/lib/domain-guard";
import { createCacheKeyHash } from "@/lib/scan-cache";
import { DEFAULT_VENICE_MODEL, VENICE_API_BASE_URL } from "@/lib/venice-ai";

interface VeniceDomainCheckResult {
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string;
  sources: string[];
  inferenceMode: "venice-live-api" | "deterministic-fallback";
}

function clampRisk(score: number): number {
  return Math.max(0, Math.min(99, Math.round(score)));
}

function scoreToRiskLevel(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 70) return "CRITICAL";
  if (score >= 45) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

async function queryVeniceDomainReputation(
  hostname: string,
  domainEvaluation: DomainEvaluation,
  apiKey?: string
): Promise<VeniceDomainCheckResult> {
  const effectiveKey = apiKey?.trim() || process.env.VENICE_API_KEY?.trim();

  if (domainEvaluation.isAllowlisted || domainEvaluation.status === "DEV_LOCAL") {
    return {
      riskScore: domainEvaluation.riskScore,
      riskLevel: domainEvaluation.riskLevel,
      summary:
        domainEvaluation.status === "DEV_LOCAL"
          ? `Local development host "${hostname}" allowed for local testing.`
          : `Verified Solana ecosystem domain "${hostname}" (${domainEvaluation.closestVerifiedBrand ?? "Trusted"}).`,
      sources: [],
      inferenceMode: "deterministic-fallback",
    };
  }

  if (!effectiveKey) {
    return {
      riskScore: domainEvaluation.riskScore,
      riskLevel: domainEvaluation.riskLevel,
      summary:
        domainEvaluation.reasons[0] ||
        `No Venice API key configured; relying on deterministic Domain Guard checks for "${hostname}".`,
      sources: [],
      inferenceMode: "deterministic-fallback",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3200);

  try {
    const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_VENICE_MODEL,
        temperature: 0.1,
        max_tokens: 320,
        venice_parameters: {
          include_venice_system_prompt: false,
          enable_web_search: "on",
          enable_web_citations: true,
        },
        messages: [
          {
            role: "system",
            content:
              "You are a Solana Web3 security analyst checking ONLY a bare hostname for phishing, drainer reports, typosquatting, or malicious impersonation. Respond ONLY with valid JSON: { \"riskScore\": number (0-99), \"riskLevel\": \"LOW\"|\"MEDIUM\"|\"HIGH\"|\"CRITICAL\", \"summary\": string (max 220 chars), \"sources\": string[] (up to 3 URLs or source names) }.",
          },
          {
            role: "user",
            content: JSON.stringify({
              hostname,
              localStatus: domainEvaluation.status,
              localScore: domainEvaluation.riskScore,
              localReasons: domainEvaluation.reasons,
              task: "Search recent web intelligence and scam/phishing reports for this Solana domain hostname only.",
            }),
          },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Venice web search returned HTTP ${res.status}`);
    }

    const payload = await res.json();
    const rawContent: string = payload?.choices?.[0]?.message?.content ?? "";
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Venice web search response was not JSON");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const parsedScore =
      typeof parsed.riskScore === "number"
        ? clampRisk(parsed.riskScore)
        : domainEvaluation.riskScore;
    const mergedScore = Math.max(domainEvaluation.riskScore, parsedScore);
    const sources: string[] = Array.isArray(parsed.sources)
      ? parsed.sources
          .filter((item: unknown): item is string => typeof item === "string")
          .slice(0, 3)
      : [];

    return {
      riskScore: mergedScore,
      riskLevel: scoreToRiskLevel(mergedScore),
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 240)
          : domainEvaluation.reasons[0] || `Venice checked reputation for ${hostname}.`,
      sources,
      inferenceMode: "venice-live-api",
    };
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Venice web search unavailable";
    return {
      riskScore: domainEvaluation.riskScore,
      riskLevel: domainEvaluation.riskLevel,
      summary: `${domainEvaluation.reasons[0] || `Unverified domain "${hostname}".`} (${reason})`,
      sources: [],
      inferenceMode: "deterministic-fallback",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "extension");
}

/**
 * Dual-Lane Privacy endpoint: accepts ONLY a bare ASCII hostname (+ local allow/block lists & optional key).
 * Never stores browsing history and intentionally ignores any wallet address or transaction payload.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawHostname =
      typeof body?.hostname === "string"
        ? body.hostname
        : typeof body?.domain === "string"
        ? body.domain
        : typeof body?.url === "string"
        ? body.url
        : "";

    const hostname = normalizeHostname(rawHostname);
    if (!hostname) {
      return corsJson(
        {
          ok: false,
          error: "Invalid or missing hostname parameter.",
        },
        { status: 400, req, policy: "extension" }
      );
    }

    const trustedDomains: string[] = Array.isArray(body?.trustedDomains)
      ? body.trustedDomains.filter(
          (item: unknown): item is string => typeof item === "string"
        )
      : [];
    const blockedDomains: string[] = Array.isArray(body?.blockedDomains)
      ? body.blockedDomains.filter(
          (item: unknown): item is string => typeof item === "string"
        )
      : [];

    const veniceApiKey =
      typeof body?.veniceApiKey === "string" ? body.veniceApiKey : undefined;

    const listsHash = createCacheKeyHash(
      JSON.stringify({
        trusted: [...trustedDomains].sort(),
        blocked: [...blockedDomains].sort(),
      })
    ).slice(0, 16);

    const guarded = await runGuardedCachedOperation(
      req,
      {
        profile: "extension-hybrid",
        byokKey: veniceApiKey,
        namespace: "domain-reputation",
        cacheKey: `${hostname}:${listsHash}`,
        ttlMs: 30 * 60_000,
        forceRefresh: body?.forceRefresh === true,
      },
      async () => {
        const domainEvaluation = evaluateDomainSafety(hostname, {
          trustedDomains,
          blockedDomains,
        });
        const reputation = await queryVeniceDomainReputation(
          hostname,
          domainEvaluation,
          veniceApiKey
        );
        return {
          domainEvaluation,
          reputation,
        };
      }
    );

    if (!guarded.ok) {
      return buildGuardErrorResponse(guarded);
    }

    const { domainEvaluation, reputation } = guarded.value;

    return corsJson(
      {
        ok: true,
        cached: guarded.cached,
        cachedAt: guarded.cachedAt,
        hostname,
        domainEvaluation,
        riskScore: reputation.riskScore,
        riskLevel: reputation.riskLevel,
        summary: reputation.summary,
        sources: reputation.sources,
        inferenceMode: reputation.inferenceMode,
        privacyAttestation:
          "Zero-Retention Hostname Check: Only the bare ASCII hostname was inspected; no wallet addresses, paths, or transactions were transmitted.",
      },
      { req, policy: "extension", headers: guarded.headers }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to evaluate domain reputation.";
    return corsJson({ ok: false, error: message }, { status: 400, req, policy: "extension" });
  }
}
