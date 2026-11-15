import {
  classifyPostCohort,
  resolvePostTopic,
} from "./mindshare-architecture";
import { parseXUrl } from "./input-parser";
import type {
  ChainTokenIntelReport,
  DomainIntelReport,
  GitHubForensicReport,
  HypeBuildQuadrant,
  KolTier,
  MindshareBucket,
  MindshareMomentum,
  MindshareStance,
  MindshareTopicClusterMeta,
  ParsedTargetInput,
  SocialCohortId,
  SocialMindshareReport,
  XKolAuthorProfile,
  XMindsharePost,
  XPostIntelReport,
} from "./types";
import { DEFAULT_VENICE_MODEL, VENICE_API_BASE_URL } from "../venice-ai";

const X_API_BASE = "https://api.x.com/2";

const GENERIC_X_HANDLES = new Set([
  "x",
  "twitter",
  "i",
  "intent",
  "share",
  "home",
  "explore",
  "search",
  "solana",
  "pumpdotfun",
  "pumpfun",
  "dexscreener",
  "raydiumprotocol",
  "raydium",
  "jupiterexchange",
  "jup_ag",
  "birdeye_so",
  "phantom",
  "solscan",
  "github",
]);

const GENERIC_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "github.com",
  "pump.fun",
  "dexscreener.com",
  "birdeye.so",
  "jup.ag",
  "raydium.io",
  "solscan.io",
  "solana.com",
  "t.me",
  "telegram.org",
  "discord.gg",
  "discord.com",
  "medium.com",
  "notion.so",
  "linktr.ee",
]);

const AMBIGUOUS_TICKERS = new Set([
  "AI",
  "SOL",
  "BTC",
  "ETH",
  "USDC",
  "USDT",
  "SHIELD",
  "GUARD",
  "BOT",
  "MEME",
  "COIN",
  "TOKEN",
  "CASH",
  "GOLD",
  "FIRE",
  "MOON",
  "STAR",
  "KING",
  "GOD",
  "CAT",
  "DOG",
  "APE",
  "PEPE",
  "TECH",
  "CORE",
  "BASE",
  "PRO",
  "ONE",
  "ZERO",
  "LIFE",
  "LOVE",
  "TEST",
  "APP",
  "WEB",
  "DEV",
  "LIVE",
  "NOW",
]);

export interface SocialMindshareInput {
  target: ParsedTargetInput;
  chain?: ChainTokenIntelReport | null;
  github?: GitHubForensicReport | null;
  domain?: DomainIntelReport | null;
  xPost?: XPostIntelReport | null;
  browserXUrls?: string[];
  veniceApiKey?: string;
  veniceModel?: string;
  buildIntegrityScore?: number | null;
  timeoutMs?: number;
}

export interface ProjectSocialAnchors {
  mintAddress: string | null;
  symbol: string | null;
  name: string | null;
  officialHandle: string | null;
  domain: string | null;
  githubRepo: string | null;
}

interface RawXApiUser {
  id?: string;
  username?: string;
  name?: string;
  verified?: boolean;
  verified_type?: string;
  created_at?: string;
  description?: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
  };
}

interface RawXApiTweet {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  note_tweet?: { text?: string };
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
  };
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function sanitizeQueryToken(raw: string): string {
  return raw.replace(/["\\()\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyKolTier(followersCount: number): KolTier {
  const f = Number.isFinite(followersCount) ? followersCount : 0;
  if (f >= 50_000) return "MEGA";
  if (f >= 10_000) return "ALPHA";
  if (f >= 2_000) return "MID";
  return "MICRO";
}

export function detectShillSignals(text: string, duplicateAuthorsCount = 1): string[] {
  const flags: string[] = [];
  const raw = text || "";

  const cashtags = Array.from(
    new Set((raw.match(/\$[A-Za-z][A-Za-z0-9_]{1,12}/g) ?? []).map((t) => t.toUpperCase()))
  );
  if (cashtags.length >= 3) {
    flags.push("MULTI_CASHTAG_SPAM");
  }

  if (
    /\b(claim\s+(your\s+)?airdrop|free\s+airdrop|airdrop\s+(is\s+)?live|connect\s+wallet\s+to\s+claim)\b/i.test(
      raw
    )
  ) {
    flags.push("AIRDROP_BAIT");
  }

  if (/\b(dm\s+(for|me)\s+(promo|collab|listing|marketing)|paid\s+promo)\b/i.test(raw)) {
    flags.push("PROMO_SOLICITATION");
  }

  if (/\b(100x|1000x|next\s+100x\s+gem|guaranteed\s+moon|don'?t\s+miss\s+this\s+gem)\b/i.test(raw)) {
    flags.push("SHILL_CLICHE");
  }

  if (/\b(drop\s+(your\s+)?sol(\s+address)?|send\s+\d+(\.\d+)?\s*sol)\b/i.test(raw)) {
    flags.push("WALLET_DROP_SPAM");
  }

  const mentions = raw.match(/@[A-Za-z0-9_]{2,30}/g) ?? [];
  if (mentions.length >= 5) {
    flags.push("MENTION_SPRAY");
  }

  if (duplicateAuthorsCount >= 2) {
    flags.push("COORDINATED_DUPLICATE");
  }

  return flags;
}

function cleanXHandle(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const cleaned = candidate.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,30}$/.test(cleaned)) return null;
  if (GENERIC_X_HANDLES.has(cleaned.toLowerCase())) return null;
  return cleaned;
}

export function extractProjectSocialAnchors(
  input: Pick<
    SocialMindshareInput,
    "target" | "chain" | "github" | "domain" | "xPost" | "browserXUrls"
  >
): ProjectSocialAnchors {
  const mintAddress = input.chain?.mintAddress || input.target.mintAddress || null;
  const rawSymbol =
    input.chain?.tokenReport?.symbol ||
    input.chain?.deep?.metadata?.symbol ||
    null;
  const symbol = rawSymbol
    ? rawSymbol.replace(/^\$/, "").trim().toUpperCase().slice(0, 14) || null
    : null;
  const name =
    input.chain?.tokenReport?.name?.trim() ||
    input.chain?.deep?.metadata?.name?.trim() ||
    null;

  const candidateHandles: Array<string | null> = [
    input.xPost?.handle ?? null,
    parseXUrl(input.xPost?.url || "")?.handle ?? null,
    input.target.kind === "x_post" || input.target.kind === "x_profile"
      ? parseXUrl(input.target.normalizedUrl || "")?.handle ?? null
      : null,
    input.chain?.deep?.metadata?.twitterUrl
      ? parseXUrl(input.chain.deep.metadata.twitterUrl)?.handle ?? null
      : null,
  ];

  for (const s of input.chain?.dexPair?.socials ?? []) {
    if (
      s.type.toLowerCase() === "twitter" ||
      s.type.toLowerCase() === "x" ||
      /x\.com|twitter\.com/i.test(s.url)
    ) {
      candidateHandles.push(parseXUrl(s.url)?.handle ?? null);
    }
  }

  for (const u of input.browserXUrls ?? []) {
    candidateHandles.push(parseXUrl(u)?.handle ?? null);
  }

  let officialHandle: string | null = null;
  for (const h of candidateHandles) {
    const valid = cleanXHandle(h);
    if (valid) {
      officialHandle = valid;
      break;
    }
  }

  const rawDomain = input.domain?.registrableDomain?.toLowerCase() || null;
  const domain = rawDomain && !GENERIC_HOSTS.has(rawDomain) ? rawDomain : null;
  const githubRepo = input.github?.fullName || input.target.githubOwnerRepo || null;

  return {
    mintAddress,
    symbol,
    name,
    officialHandle,
    domain,
    githubRepo,
  };
}

/**
 * Constructs surgical X API v2 recent search queries using unambiguous token/project
 * identifiers first, then disambiguated cashtags so generic tickers avoid noise.
 */
export function buildXMindshareQueries(anchors: ProjectSocialAnchors): string[] {
  const queries: string[] = [];

  const exactClauses: string[] = [];
  if (anchors.mintAddress) {
    exactClauses.push(anchors.mintAddress);
  }
  if (anchors.officialHandle) {
    exactClauses.push(`@${anchors.officialHandle}`);
    exactClauses.push(`from:${anchors.officialHandle}`);
  }
  if (anchors.githubRepo) {
    exactClauses.push(`"${sanitizeQueryToken(anchors.githubRepo)}"`);
  }
  if (anchors.domain) {
    exactClauses.push(`"${sanitizeQueryToken(anchors.domain)}"`);
  }

  if (exactClauses.length > 0) {
    const q1 = `(${exactClauses.join(" OR ")}) -is:retweet`;
    if (q1.length <= 490) {
      queries.push(q1);
    } else if (anchors.mintAddress) {
      queries.push(`${anchors.mintAddress} -is:retweet`);
    }
  }

  if (anchors.symbol && /^[A-Z0-9_]{2,12}$/.test(anchors.symbol)) {
    const isAmbiguous =
      AMBIGUOUS_TICKERS.has(anchors.symbol) || anchors.symbol.length <= 3;

    const contextTerms: string[] = ["solana", "pump.fun", "dexscreener", "raydium", "jupiter"];
    if (!isAmbiguous) {
      contextTerms.push("sol", "token", "dev", "github");
      if (anchors.name) {
        const cleanName = sanitizeQueryToken(anchors.name);
        if (
          cleanName.length >= 3 &&
          cleanName.length <= 26 &&
          cleanName.toUpperCase() !== anchors.symbol
        ) {
          contextTerms.push(`"${cleanName}"`);
        }
      }
    }
    if (anchors.officialHandle) {
      contextTerms.push(`@${anchors.officialHandle}`);
    }
    if (anchors.domain) {
      contextTerms.push(`"${sanitizeQueryToken(anchors.domain)}"`);
    }

    const dedupContext = Array.from(new Set(contextTerms)).slice(0, 8);
    const q2 = `($${anchors.symbol} (${dedupContext.join(" OR ")})) -is:retweet`;
    if (q2.length <= 490) {
      queries.push(q2);
    }
  }

  return Array.from(new Set(queries)).slice(0, 2);
}

function isTweetRelevantToProject(
  text: string,
  authorUsername: string,
  anchors: ProjectSocialAnchors
): boolean {
  const lower = text.toLowerCase();
  const handleLower = authorUsername.toLowerCase();

  if (anchors.mintAddress && lower.includes(anchors.mintAddress.toLowerCase())) {
    return true;
  }
  if (anchors.officialHandle) {
    const targetH = anchors.officialHandle.toLowerCase();
    if (handleLower === targetH || lower.includes(`@${targetH}`)) {
      return true;
    }
  }
  if (anchors.githubRepo && lower.includes(anchors.githubRepo.toLowerCase())) {
    return true;
  }
  if (anchors.domain && lower.includes(anchors.domain.toLowerCase())) {
    return true;
  }

  if (anchors.symbol && lower.includes(`$${anchors.symbol.toLowerCase()}`)) {
    // Reject obvious EVM-only spam if no Solana cue is present
    const hasEvmCa = /\b0x[a-f0-9]{40}\b/i.test(text);
    const hasSolCue = /\b(sol|solana|pump|raydium|jupiter|jup|dexscreener)\b/i.test(text);
    if (hasEvmCa && !hasSolCue) {
      return false;
    }
    return true;
  }

  if (anchors.name && anchors.name.length >= 4 && lower.includes(anchors.name.toLowerCase())) {
    const hasCryptoCue = /\b(sol|solana|token|coin|ca|dex|dev|github|launch|pump)\b/i.test(
      text
    );
    return hasCryptoCue;
  }

  return false;
}

async function fetchXApiJson<T>(
  url: string,
  bearerToken: string,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
        "User-Agent": "SolShield-Mindshare/1.0",
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

function mapRawUserProfile(user: RawXApiUser): XKolAuthorProfile | null {
  if (!user.username) return null;
  const followers = Math.max(0, Number(user.public_metrics?.followers_count ?? 0));
  const createdMs = user.created_at ? Date.parse(user.created_at) : NaN;
  const accountAgeDays = Number.isFinite(createdMs)
    ? Math.max(0, Math.round((Date.now() - createdMs) / 86_400_000))
    : null;

  return {
    id: user.id || user.username,
    username: user.username,
    name: user.name || user.username,
    verified: Boolean(user.verified || user.verified_type),
    verifiedType: user.verified_type || null,
    followersCount: followers,
    followingCount: Math.max(0, Number(user.public_metrics?.following_count ?? 0)),
    tweetCount: Math.max(0, Number(user.public_metrics?.tweet_count ?? 0)),
    listedCount: Math.max(0, Number(user.public_metrics?.listed_count ?? 0)),
    createdAt: user.created_at || null,
    accountAgeDays,
    tier: classifyKolTier(followers),
    profileImageUrl: user.profile_image_url || null,
    description: user.description ? user.description.slice(0, 260) : null,
  };
}

async function fetchOfficialXProfile(
  handle: string,
  bearerToken: string,
  timeoutMs: number
): Promise<XKolAuthorProfile | null> {
  const url = `${X_API_BASE}/users/by/username/${encodeURIComponent(
    handle
  )}?user.fields=created_at,description,public_metrics,verified,verified_type,profile_image_url`;
  const res = await fetchXApiJson<{ data?: RawXApiUser }>(url, bearerToken, timeoutMs);
  if (!res.ok || !res.data?.data) return null;
  return mapRawUserProfile(res.data.data);
}

async function fetchXRecentSearchQuery(
  query: string,
  bearerToken: string,
  timeoutMs: number
): Promise<{
  ok: boolean;
  status: number;
  tweets: RawXApiTweet[];
  usersById: Map<string, RawXApiUser>;
}> {
  const baseParams = new URLSearchParams({
    query,
    max_results: "25",
    "tweet.fields": "created_at,public_metrics,author_id,lang,note_tweet",
    expansions: "author_id",
    "user.fields": "username,name,verified,verified_type,public_metrics,profile_image_url",
  });

  // Prefer relevancy to surface top KOL & engaged voices first; fall back to default order if unsupported.
  const urlWithRelevancy = `${X_API_BASE}/tweets/search/recent?${baseParams.toString()}&sort_order=relevancy`;
  let res = await fetchXApiJson<{
    data?: RawXApiTweet[];
    includes?: { users?: RawXApiUser[] };
  }>(urlWithRelevancy, bearerToken, timeoutMs);

  if (!res.ok && res.status === 400) {
    const fallbackUrl = `${X_API_BASE}/tweets/search/recent?${baseParams.toString()}`;
    res = await fetchXApiJson<{
      data?: RawXApiTweet[];
      includes?: { users?: RawXApiUser[] };
    }>(fallbackUrl, bearerToken, timeoutMs);
  }

  const usersById = new Map<string, RawXApiUser>();
  for (const u of res.data?.includes?.users ?? []) {
    if (u.id) usersById.set(u.id, u);
  }

  return {
    ok: res.ok,
    status: res.status,
    tweets: Array.isArray(res.data?.data) ? res.data.data : [],
    usersById,
  };
}

function computeEngagementScore(
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    bookmarks: number;
    impressions: number;
  },
  isKol: boolean
): number {
  const weighted =
    metrics.likes * 1.5 +
    metrics.retweets * 3 +
    metrics.replies * 2.5 +
    metrics.quotes * 3.5 +
    metrics.bookmarks * 3 +
    Math.min(250, metrics.impressions * 0.015) +
    (isKol ? 35 : 0);
  return Math.round(weighted);
}

function isAutomatedBotUsername(username: string): boolean {
  const clean = username.replace(/^@/, "").trim().toLowerCase();
  return (
    /(?:^|_)(?:bot|scanner|alerts?)$/i.test(clean) ||
    clean.endsWith("bot") ||
    clean === "grok"
  );
}

function classifyTweetStanceDeterministic(
  text: string,
  shillFlags: string[],
  username = ""
): { stance: MindshareStance; reason: string } {
  if (shillFlags.length >= 2) {
    return {
      stance: "SHILL_NOISE",
      reason: `Flagged promo pattern (${shillFlags.slice(0, 2).join(", ")})`,
    };
  }
  if (username && isAutomatedBotUsername(username)) {
    return {
      stance: "NEUTRAL",
      reason: "Automated scanner/bot reply",
    };
  }

  const skepticalHits = (
    text.match(
      /\b(scam|rug|larp|fake|honeypot|drain|sketchy|suspicious|farm|cabals?|bundled|insider|dump(?:ing|ed)?|red\s*flag|careful|avoid|vaporware|dead\s+repo|copy\s*paste)\b/gi
    ) ?? []
  ).length;
  const bullishHits = (
    text.match(
      /\b(shipped|shipping|keeps?\s+shipping|actually\s+building|real\s+(?:tech|code|product|build|utility)|legit|clean|based|bullish|accumulating|undervalued|solid|impressive|verified|open\s*source|audit|working\s+app)\b/gi
    ) ?? []
  ).length;

  if (shillFlags.length === 1 && bullishHits === 0) {
    return {
      stance: "SHILL_NOISE",
      reason: `Promo signal (${shillFlags[0]})`,
    };
  }
  if (skepticalHits > bullishHits) {
    return {
      stance: "SKEPTICAL",
      reason: "Raises risk, skepticism, or verification concern",
    };
  }
  if (bullishHits > skepticalHits) {
    return {
      stance: "BULLISH",
      reason: "Highlights product execution, code, or conviction",
    };
  }
  return {
    stance: "NEUTRAL",
    reason: "Informational discussion or commentary",
  };
}

function summarizePostsDeterministically(
  posts: XMindsharePost[],
  anchors: ProjectSocialAnchors,
  omittedSelfCount = 0
): {
  consensusSummary: string;
  bullThemes: string[];
  skepticQuestions: string[];
} {
  if (posts.length === 0) {
    const label = anchors.symbol ? `$${anchors.symbol}` : anchors.githubRepo || anchors.domain || "this target";
    return {
      consensusSummary: `No recent X posts matched ${label} in the current search window.`,
      bullThemes: [],
      skepticQuestions: [],
    };
  }

  const humanPosts = posts.filter((p) => !isAutomatedBotUsername(p.authorUsername));
  const themePool = humanPosts.length > 0 ? humanPosts : posts;
  const organic = posts.filter((p) => p.stance !== "SHILL_NOISE");
  const bullish = themePool.filter((p) => p.stance === "BULLISH");
  const skeptical = themePool.filter((p) => p.stance === "SKEPTICAL");
  const kolAuthors = new Set(posts.filter((p) => p.isKol).map((p) => p.authorUsername.toLowerCase()));

  const label = anchors.symbol ? `$${anchors.symbol}` : anchors.domain || anchors.githubRepo || "Target";
  const kolClause =
    kolAuthors.size > 0
      ? `with ${kolAuthors.size} KOL account${kolAuthors.size === 1 ? "" : "s"} (>=2K followers) weighing in`
      : "driven mainly by smaller/emerging accounts";
  const selfNote =
    omittedSelfCount > 0
      ? ` (${omittedSelfCount} official @${anchors.officialHandle} post${omittedSelfCount === 1 ? "" : "s"} excluded from sentiment)`
      : "";

  const consensusSummary = `Sampled ${posts.length} independent X post${
    posts.length === 1 ? "" : "s"
  }${selfNote} referencing ${label} ${kolClause}: ${bullish.length} constructive/bullish, ${
    skeptical.length
  } skeptical, and ${posts.length - organic.length} promotional/shill-flagged.`;

  const bullThemes = bullish
    .slice(0, 3)
    .map((p) => `@${p.authorUsername}: ${p.text.replace(/\s+/g, " ").slice(0, 120)}${p.text.length > 120 ? "..." : ""}`);

  const skepticQuestions = skeptical
    .slice(0, 3)
    .map((p) => `@${p.authorUsername}: ${p.text.replace(/\s+/g, " ").slice(0, 120)}${p.text.length > 120 ? "..." : ""}`);

  return { consensusSummary, bullThemes, skepticQuestions };
}

async function synthesizeSocialDiscourseWithVenice(
  posts: XMindsharePost[],
  anchors: ProjectSocialAnchors,
  apiKey: string,
  model: string,
  timeoutMs: number
): Promise<{
  consensusSummary?: string;
  bullThemes?: string[];
  skepticQuestions?: string[];
  topicCatalog?: MindshareTopicClusterMeta[];
  postStances?: Map<string, { stance: MindshareStance; reason: string }>;
  postMeta?: Map<string, { topicName?: string; cohort?: SocialCohortId }>;
} | null> {
  if (!apiKey || posts.length === 0) return null;

  const nonBotPosts = posts.filter((p) => !isAutomatedBotUsername(p.authorUsername));
  const chosen = (nonBotPosts.length > 0 ? nonBotPosts : posts).slice(0, 12);

  const sample = chosen.map((p, idx) => ({
    i: idx,
    author: `@${p.authorUsername}`,
    followers: p.authorFollowers,
    likes: p.likeCount,
    text: p.text.replace(/\s+/g, " ").slice(0, 240),
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 580,
        venice_parameters: { include_venice_system_prompt: false },
        messages: [
          {
            role: "system",
            content: `Analyze real X (Twitter) posts about one project. Use ONLY the provided posts; never invent handles or facts.
Output raw minified JSON ONLY (no markdown, no commentary):
{"consensusSummary":"<max 2 short factual sentences>","bullThemes":["<up to 3 short specific positive points>"],"skepticQuestions":["<up to 3 short specific concerns/pushbacks, or empty []>"],"topics":[{"n":"<2-4 word narrative theme>","d":"<max 8 word theme summary>","g":["Tag1","Tag2"]}],"stances":{"0":"B"},"meta":{"0":{"t":0,"c":"SEC"}}}
Codes: stances B=BULLISH, N=NEUTRAL, S=SKEPTICAL, H=SHILL_NOISE ("not a rug"=B); topics up to 4 real themes; meta t=topic index, c=DEV(builders/devs)|SEC(security/audits)|ALPHA(KOLs/alpha callers)|TRAD(traders/community).`,
          },
          {
            role: "user",
            content: JSON.stringify({
              project: anchors.symbol || anchors.officialHandle || anchors.domain,
              posts: sample,
            }),
          },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as {
      consensusSummary?: string;
      bullThemes?: string[];
      skepticQuestions?: string[];
      topics?: Array<{ n?: string; name?: string; d?: string; description?: string; g?: string[]; tags?: string[] }>;
      stances?: Record<string, string>;
      meta?: Record<string, { t?: number; c?: string }>;
      postStances?: Array<{ id?: string; stance?: string; reason?: string }>;
    };

    const stanceMap = new Map<string, { stance: MindshareStance; reason: string }>();
    const postMetaMap = new Map<string, { topicName?: string; cohort?: SocialCohortId }>();
    const normalizeStance = (raw: string | undefined): MindshareStance | null => {
      const up = (raw || "").trim().toUpperCase();
      if (up === "B" || up === "BULLISH") return "BULLISH";
      if (up === "S" || up === "SKEPTICAL") return "SKEPTICAL";
      if (up === "H" || up === "SHILL" || up === "SHILL_NOISE") return "SHILL_NOISE";
      if (up === "N" || up === "NEUTRAL") return "NEUTRAL";
      return null;
    };
    const normalizeCohort = (raw: string | undefined): SocialCohortId | undefined => {
      const up = (raw || "").trim().toUpperCase();
      if (up === "DEV" || up === "BUILDERS") return "BUILDERS";
      if (up === "SEC" || up === "SECURITY") return "SECURITY";
      if (up === "ALPHA" || up === "ALPHA_KOL") return "ALPHA_KOL";
      if (up === "TRAD" || up === "COMMUNITY") return "COMMUNITY";
      return undefined;
    };

    const topicCatalog: MindshareTopicClusterMeta[] = [];
    for (const rawTopic of (parsed.topics ?? []).slice(0, 5)) {
      const name = String(rawTopic?.n || rawTopic?.name || "").trim().slice(0, 48);
      if (!name) continue;
      const description = String(rawTopic?.d || rawTopic?.description || "")
        .trim()
        .slice(0, 110);
      const tags = Array.isArray(rawTopic?.g || rawTopic?.tags)
        ? (rawTopic?.g || rawTopic?.tags)!
            .map((tag) => String(tag).trim().slice(0, 20))
            .filter(Boolean)
            .slice(0, 2)
        : [];
      topicCatalog.push({
        name,
        description: description || "Live X narrative sub-theme",
        tags: tags.length > 0 ? tags : ["X Theme"],
      });
    }

    if (parsed.stances && typeof parsed.stances === "object") {
      for (const [k, v] of Object.entries(parsed.stances)) {
        const idx = Number(k);
        const targetPost = Number.isInteger(idx) && chosen[idx] ? chosen[idx] : null;
        const st = normalizeStance(v);
        if (targetPost && st) {
          stanceMap.set(targetPost.id, {
            stance: st,
            reason: `Venice AI context (${st.toLowerCase()})`,
          });
        }
      }
    }

    if (parsed.meta && typeof parsed.meta === "object") {
      for (const [k, v] of Object.entries(parsed.meta)) {
        const idx = Number(k);
        const targetPost = Number.isInteger(idx) && chosen[idx] ? chosen[idx] : null;
        if (!targetPost || !v) continue;
        const tIdx = typeof v.t === "number" && Number.isInteger(v.t) ? v.t : -1;
        const topicName = tIdx >= 0 && topicCatalog[tIdx] ? topicCatalog[tIdx].name : undefined;
        const cohort = normalizeCohort(v.c);
        if (topicName || cohort) {
          postMetaMap.set(targetPost.id, { topicName, cohort });
        }
      }
    }

    for (const item of parsed.postStances ?? []) {
      const st = normalizeStance(item.stance);
      if (item.id && st) {
        stanceMap.set(item.id, {
          stance: st,
          reason: (item.reason || "").slice(0, 100),
        });
      }
    }

    return {
      consensusSummary: parsed.consensusSummary?.trim() || undefined,
      bullThemes: Array.isArray(parsed.bullThemes)
        ? parsed.bullThemes.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
        : undefined,
      skepticQuestions: Array.isArray(parsed.skepticQuestions)
        ? parsed.skepticQuestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
        : undefined,
      topicCatalog: topicCatalog.length > 0 ? topicCatalog : undefined,
      postStances: stanceMap,
      postMeta: postMetaMap,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVeniceXSearchFallback(
  anchors: ProjectSocialAnchors,
  apiKey: string,
  model: string,
  timeoutMs: number
): Promise<{
  posts: XMindsharePost[];
  consensusSummary: string | null;
  bullThemes: string[];
  skepticQuestions: string[];
}> {
  if (!apiKey) {
    return { posts: [], consensusSummary: null, bullThemes: [], skepticQuestions: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 800,
        venice_parameters: {
          include_venice_system_prompt: false,
          enable_x_search: true,
          enable_web_citations: true,
        },
        messages: [
          {
            role: "system",
            content: `Search X strictly for recent discussions matching this SPECIFIC project (${
              anchors.symbol ? `$${anchors.symbol}` : ""
            } ${anchors.mintAddress || ""} ${
              anchors.officialHandle ? `@${anchors.officialHandle}` : ""
            } ${anchors.githubRepo || ""} ${anchors.domain || ""}).
CRITICAL RULES:
- Include ONLY real X status URLs returned by search (https://x.com/<handle>/status/<numeric_id>) that explicitly discuss this specific project.
- Do NOT pad with generic Solana market tweets or unrelated coins. If zero verified matches appear, return "posts": [].
Respond ONLY with strict JSON:
{
  "consensusSummary": "<factual 1-2 sentence summary or 'No verified X discussion found.'>",
  "bullThemes": ["<specific point>"],
  "skepticQuestions": ["<specific skepticism>"],
  "posts": [
    {
      "url": "https://x.com/user/status/1234567890",
      "authorUsername": "user",
      "text": "<exact snippet>",
      "stance": "BULLISH" | "NEUTRAL" | "SKEPTICAL" | "SHILL_NOISE",
      "reason": "<short stance note>"
    }
  ]
}`,
          },
          {
            role: "user",
            content: JSON.stringify(anchors),
          },
        ],
      }),
    });

    if (!res.ok) {
      return { posts: [], consensusSummary: null, bullThemes: [], skepticQuestions: [] };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return { posts: [], consensusSummary: null, bullThemes: [], skepticQuestions: [] };
    }

    const parsed = JSON.parse(match[0]) as {
      consensusSummary?: string;
      bullThemes?: string[];
      skepticQuestions?: string[];
      posts?: Array<{
        url?: string;
        authorUsername?: string;
        text?: string;
        stance?: MindshareStance;
        reason?: string;
      }>;
    };

    const validPosts: XMindsharePost[] = [];
    const seenIds = new Set<string>();
    for (const item of parsed.posts ?? []) {
      const parsedUrl = parseXUrl(item.url || "");
      if (!parsedUrl?.tweetId || !parsedUrl.handle) continue;
      if (seenIds.has(parsedUrl.tweetId)) continue;
      const text = (item.text || "").trim();
      if (!text || !isTweetRelevantToProject(text, parsedUrl.handle, anchors)) continue;

      seenIds.add(parsedUrl.tweetId);
      const shillFlags = detectShillSignals(text, 1);
      const fallbackStance = classifyTweetStanceDeterministic(text, shillFlags);
      validPosts.push({
        id: parsedUrl.tweetId,
        url: parsedUrl.canonicalUrl,
        text: text.slice(0, 500),
        createdAt: null,
        authorUsername: parsedUrl.handle,
        authorName: parsedUrl.handle,
        authorVerified: false,
        authorVerifiedType: null,
        authorFollowers: 0,
        authorTier: "MICRO",
        likeCount: 0,
        retweetCount: 0,
        replyCount: 0,
        quoteCount: 0,
        bookmarkCount: 0,
        impressionCount: 0,
        engagementScore: 10,
        stance:
          shillFlags.length >= 2
            ? "SHILL_NOISE"
            : item.stance || fallbackStance.stance,
        stanceReason: item.reason?.slice(0, 100) || fallbackStance.reason,
        shillFlags,
        isKol: false,
      });
    }

    return {
      posts: validPosts.slice(0, 12),
      consensusSummary:
        validPosts.length > 0 ? parsed.consensusSummary?.trim() || null : null,
      bullThemes: validPosts.length > 0 ? (parsed.bullThemes ?? []).slice(0, 4) : [],
      skepticQuestions:
        validPosts.length > 0 ? (parsed.skepticQuestions ?? []).slice(0, 4) : [],
    };
  } catch {
    return { posts: [], consensusSummary: null, bullThemes: [], skepticQuestions: [] };
  } finally {
    clearTimeout(timer);
  }
}

export function computeMindshareBuildAlignment(params: {
  mindshareScore: number;
  organicSignalPct: number;
  skepticalPct: number;
  shillNoisePct: number;
  totalPostsSampled: number;
  buildIntegrityScore: number | null;
}): {
  quadrant: HypeBuildQuadrant;
  quadrantLabel: string;
  quadrantSummary: string;
} {
  const {
    mindshareScore,
    organicSignalPct,
    skepticalPct,
    shillNoisePct,
    totalPostsSampled,
    buildIntegrityScore,
  } = params;

  if (totalPostsSampled === 0 || mindshareScore < 18) {
    return {
      quadrant: "PRE_DISCOVERY",
      quadrantLabel: "PRE-DISCOVERY ON X",
      quadrantSummary:
        buildIntegrityScore !== null && buildIntegrityScore >= 65
          ? "Strong verified build with minimal X chatter so far — early discovery zone before broader timeline attention."
          : "Very low recent X mindshare and limited community conversation detected.",
    };
  }

  if (skepticalPct >= 40) {
    return {
      quadrant: "CONTESTED_DISCOURSE",
      quadrantLabel: "CONTESTED DISCOURSE",
      quadrantSummary:
        "Substantial skepticism or open red-flag questions across recent X threads — inspect skeptic pushbacks alongside hard proof.",
    };
  }

  if (
    mindshareScore >= 52 &&
    ((buildIntegrityScore !== null && buildIntegrityScore < 50) || shillNoisePct >= 45)
  ) {
    return {
      quadrant: "NARRATIVE_OVERHEAT",
      quadrantLabel: "NARRATIVE OVERHEAT",
      quadrantSummary:
        shillNoisePct >= 45
          ? "Elevated promo/cashtag noise dominates recent X mentions relative to organic technical discussion."
          : "Loud X timeline mindshare outpacing currently verified code, domain, and product proof.",
    };
  }

  if (
    (buildIntegrityScore === null || buildIntegrityScore >= 65) &&
    mindshareScore >= 52 &&
    organicSignalPct >= 50
  ) {
    return {
      quadrant: "CONVICTION_RUNNER",
      quadrantLabel: "CONVICTION ALIGNMENT",
      quadrantSummary:
        "High organic X mindshare and KOL participation aligned with solid build proof.",
    };
  }

  if (buildIntegrityScore !== null && buildIntegrityScore >= 60) {
    return {
      quadrant: "UNDERVALUED_BUILDER",
      quadrantLabel: "QUIET BUILDER",
      quadrantSummary:
        "Verified build signals lead ahead of moderate X mindshare — organic awareness still forming.",
    };
  }

  if (mindshareScore >= 50) {
    return {
      quadrant: "NARRATIVE_OVERHEAT",
      quadrantLabel: "HYPE AHEAD OF PROOF",
      quadrantSummary:
        "Active X attention while technical build proof remains partial or unconfirmed.",
    };
  }

  return {
    quadrant: "CONTESTED_DISCOURSE",
    quadrantLabel: "EARLY / MIXED SIGNAL",
    quadrantSummary:
      "Moderate X chatter with mixed build proof — monitor KOL engagement and shipped updates.",
  };
}

function buildDailyBuckets(posts: XMindsharePost[]): MindshareBucket[] {
  const map = new Map<
    string,
    { postCount: number; authors: Set<string>; kolAuthors: Set<string>; engagementTotal: number }
  >();

  for (const p of posts) {
    if (!p.createdAt) continue;
    const ms = Date.parse(p.createdAt);
    if (!Number.isFinite(ms)) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    const cur = map.get(day) ?? {
      postCount: 0,
      authors: new Set<string>(),
      kolAuthors: new Set<string>(),
      engagementTotal: 0,
    };
    cur.postCount += 1;
    cur.authors.add(p.authorUsername.toLowerCase());
    if (p.isKol) cur.kolAuthors.add(p.authorUsername.toLowerCase());
    cur.engagementTotal += p.likeCount + p.retweetCount + p.replyCount + p.quoteCount;
    map.set(day, cur);
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([date, agg]) => ({
      date,
      postCount: agg.postCount,
      uniqueAuthors: agg.authors.size,
      kolCount: agg.kolAuthors.size,
      engagementTotal: agg.engagementTotal,
    }));
}

/**
 * Collects real X (Twitter) discourse, KOL participation, sentiment breakdown,
 * and computes Mindshare Pulse + Hype-vs-Build divergence for a BuildCheck target.
 */
export async function collectSocialMindshare(
  input: SocialMindshareInput
): Promise<SocialMindshareReport> {
  const fetchedAt = new Date().toISOString();
  const anchors = extractProjectSocialAnchors(input);
  const queries = buildXMindshareQueries(anchors);
  const bearerToken = process.env.X_BEARER_TOKEN?.trim() || "";
  const veniceKey = input.veniceApiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
  const veniceModel = input.veniceModel?.trim() || DEFAULT_VENICE_MODEL;
  const timeoutMs = input.timeoutMs ?? 6000;

  let officialProfile: XKolAuthorProfile | null = null;
  const rawTweetMap = new Map<string, RawXApiTweet>();
  const usersById = new Map<string, RawXApiUser>();
  let xApiWorked = false;
  let errorNote: string | null = null;

  if (bearerToken && (anchors.officialHandle || queries.length > 0)) {
    const profilePromise = anchors.officialHandle
      ? fetchOfficialXProfile(anchors.officialHandle, bearerToken, Math.min(timeoutMs, 4500))
      : Promise.resolve(null);
    const searchPromises = queries.map((q) =>
      fetchXRecentSearchQuery(q, bearerToken, timeoutMs)
    );

    const [profileRes, ...searchResults] = await Promise.all([
      profilePromise,
      ...searchPromises,
    ]);
    officialProfile = profileRes;

    for (const sr of searchResults) {
      if (sr.ok) xApiWorked = true;
      else if (sr.status && !errorNote) {
        errorNote =
          sr.status === 402
            ? "X API v2 search quota/credits depleted."
            : sr.status === 429
              ? "X API v2 rate-limited; partial/cached coverage."
              : `X API v2 returned HTTP ${sr.status}.`;
      }
      for (const [uid, u] of sr.usersById.entries()) {
        usersById.set(uid, u);
      }
      for (const tw of sr.tweets) {
        if (tw.id && !rawTweetMap.has(tw.id)) {
          rawTweetMap.set(tw.id, tw);
        }
      }
    }
  } else if (!bearerToken) {
    errorNote = "X API Bearer Token not configured in this environment.";
  }

  // Convert raw X API v2 tweets -> relevant normalized XMindsharePost list
  const candidateEntries: Array<{
    id: string;
    url: string;
    text: string;
    createdAt: string | null;
    user: XKolAuthorProfile | null;
    username: string;
    displayName: string;
    verified: boolean;
    verifiedType: string | null;
    followers: number;
    metrics: {
      likes: number;
      retweets: number;
      replies: number;
      quotes: number;
      bookmarks: number;
      impressions: number;
    };
  }> = [];

  for (const tw of rawTweetMap.values()) {
    const id = tw.id;
    const rawText = (tw.note_tweet?.text || tw.text || "").trim();
    if (!id || !rawText) continue;

    const rawUser = tw.author_id ? usersById.get(tw.author_id) : undefined;
    const mappedUser = rawUser ? mapRawUserProfile(rawUser) : null;
    const username = mappedUser?.username || tw.author_id || "unknown";

    if (!isTweetRelevantToProject(rawText, username, anchors)) continue;

    candidateEntries.push({
      id,
      url:
        username !== "unknown" && !/^\d+$/.test(username)
          ? `https://x.com/${username}/status/${id}`
          : `https://x.com/i/status/${id}`,
      text: rawText.slice(0, 600),
      createdAt: tw.created_at || null,
      user: mappedUser,
      username,
      displayName: mappedUser?.name || username,
      verified: mappedUser?.verified || false,
      verifiedType: mappedUser?.verifiedType || null,
      followers: mappedUser?.followersCount ?? 0,
      metrics: {
        likes: Math.max(0, Number(tw.public_metrics?.like_count ?? 0)),
        retweets: Math.max(0, Number(tw.public_metrics?.retweet_count ?? 0)),
        replies: Math.max(0, Number(tw.public_metrics?.reply_count ?? 0)),
        quotes: Math.max(0, Number(tw.public_metrics?.quote_count ?? 0)),
        bookmarks: Math.max(0, Number(tw.public_metrics?.bookmark_count ?? 0)),
        impressions: Math.max(0, Number(tw.public_metrics?.impression_count ?? 0)),
      },
    });
  }

  // Count near-duplicate copy across distinct accounts for coordinated shill detection
  const copyAuthors = new Map<string, Set<string>>();
  for (const c of candidateEntries) {
    const key = c.text.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 110);
    if (key.length < 24) continue;
    const set = copyAuthors.get(key) ?? new Set<string>();
    set.add(c.username.toLowerCase());
    copyAuthors.set(key, set);
  }

  let posts: XMindsharePost[] = candidateEntries.map((c) => {
    const copyKey = c.text.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 110);
    const dupCount = copyAuthors.get(copyKey)?.size ?? 1;
    const shillFlags = detectShillSignals(c.text, dupCount);
    const isKol = c.followers >= 2_000;
    const detStance = classifyTweetStanceDeterministic(c.text, shillFlags, c.username);

    return {
      id: c.id,
      url: c.url,
      text: c.text,
      createdAt: c.createdAt,
      authorUsername: c.username,
      authorName: c.displayName,
      authorVerified: c.verified,
      authorVerifiedType: c.verifiedType,
      authorFollowers: c.followers,
      authorTier: classifyKolTier(c.followers),
      likeCount: c.metrics.likes,
      retweetCount: c.metrics.retweets,
      replyCount: c.metrics.replies,
      quoteCount: c.metrics.quotes,
      bookmarkCount: c.metrics.bookmarks,
      impressionCount: c.metrics.impressions,
      engagementScore: computeEngagementScore(c.metrics, isKol),
      stance: detStance.stance,
      stanceReason: detStance.reason,
      shillFlags,
      isKol,
    };
  });

  posts.sort((a, b) => b.engagementScore - a.engagementScore);
  posts = posts.slice(0, 25);

  let source: SocialMindshareReport["source"] = xApiWorked
    ? "x-api-v2"
    : "unavailable";
  let consensusSummary = "";
  let bullThemes: string[] = [];
  let skepticQuestions: string[] = [];
  let topicCatalog: MindshareTopicClusterMeta[] = [];

  // Distinguish third-party community/KOL posts from the project's own brand tweets
  const officialHandleLower = anchors.officialHandle?.toLowerCase() || null;
  const externalPosts = officialHandleLower
    ? posts.filter((p) => p.authorUsername.toLowerCase() !== officialHandleLower)
    : posts;
  const analysisPosts = externalPosts.length > 0 ? externalPosts : posts;
  const onlySelfPosts = Boolean(
    officialHandleLower && externalPosts.length === 0 && posts.length > 0
  );

  // If X API v2 is unconfigured/failing and returned 0 posts, optionally fall back to scoped Venice X Search
  if (posts.length === 0 && !xApiWorked && veniceKey && (queries.length > 0 || anchors.officialHandle)) {
    const veniceFallback = await fetchVeniceXSearchFallback(
      anchors,
      veniceKey,
      veniceModel,
      Math.min(timeoutMs + 1500, 7500)
    );
    if (veniceFallback.posts.length > 0) {
      posts = veniceFallback.posts;
      source = "venice-x-search";
      consensusSummary = veniceFallback.consensusSummary || "";
      bullThemes = veniceFallback.bullThemes;
      skepticQuestions = veniceFallback.skepticQuestions;
      errorNote = errorNote
        ? `${errorNote} Supplemented via Venice X Search.`
        : "Using Venice X Search fallback (no X Bearer token).";
    }
  } else if (analysisPosts.length > 0 && veniceKey) {
    const synthesis = await synthesizeSocialDiscourseWithVenice(
      analysisPosts,
      anchors,
      veniceKey,
      veniceModel,
      Math.max(timeoutMs + 9000, 15_000)
    );
    if (synthesis) {
      source = "hybrid";
      if (synthesis.consensusSummary) consensusSummary = synthesis.consensusSummary;
      if (synthesis.bullThemes) bullThemes = synthesis.bullThemes;
      if (synthesis.skepticQuestions) skepticQuestions = synthesis.skepticQuestions;
      if (synthesis.topicCatalog) topicCatalog = synthesis.topicCatalog;
      if (synthesis.postStances || synthesis.postMeta) {
        posts = posts.map((p) => {
          const override = synthesis.postStances?.get(p.id);
          const metaOverride = synthesis.postMeta?.get(p.id);
          const preserveDet = p.shillFlags.length >= 2 || isAutomatedBotUsername(p.authorUsername);
          return {
            ...p,
            stance: override && !preserveDet ? override.stance : p.stance,
            stanceReason: override && !preserveDet ? override.reason || p.stanceReason : p.stanceReason,
            topicName: metaOverride?.topicName || p.topicName,
            authorCohort: metaOverride?.cohort || p.authorCohort,
          };
        });
      }
    }
  }

  // Enrich any remaining unannotated posts deterministically so every treemap lens populates cleanly
  const seenCatalogTopics = new Map<string, MindshareTopicClusterMeta>(
    topicCatalog.map((t) => [t.name.toLowerCase(), t])
  );
  posts = posts.map((p) => {
    const resolvedTopic = resolvePostTopic(p, topicCatalog);
    if (!seenCatalogTopics.has(resolvedTopic.name.toLowerCase())) {
      seenCatalogTopics.set(resolvedTopic.name.toLowerCase(), resolvedTopic);
    }
    return {
      ...p,
      topicName: p.topicName || resolvedTopic.name,
      authorCohort: p.authorCohort || classifyPostCohort(p, anchors.officialHandle),
    };
  });
  topicCatalog = Array.from(seenCatalogTopics.values()).slice(0, 6);

  const finalExternalPosts = officialHandleLower
    ? posts.filter((p) => p.authorUsername.toLowerCase() !== officialHandleLower)
    : posts;
  const scoringPosts = finalExternalPosts.length > 0 ? finalExternalPosts : posts;
  const omittedSelfCount = finalExternalPosts.length > 0 ? posts.length - finalExternalPosts.length : 0;

  if (!consensusSummary) {
    const det = summarizePostsDeterministically(scoringPosts, anchors, omittedSelfCount);
    consensusSummary = onlySelfPosts
      ? `Only @${anchors.officialHandle} brand posts appeared in the recent search window; awaiting independent trader & KOL discussion.`
      : det.consensusSummary;
    if (bullThemes.length === 0) bullThemes = onlySelfPosts ? [] : det.bullThemes;
    if (skepticQuestions.length === 0) skepticQuestions = det.skepticQuestions;
  }

  // Compute sentiment breakdown & mindshare score from scoringPosts (so brand self-tweets don't spoof CT conviction)
  const totalPostsSampled = posts.length;
  const scoringDenom = Math.max(1, scoringPosts.length);
  const organicPosts = scoringPosts.filter((p) => p.stance !== "SHILL_NOISE");
  const uniqueAuthorSet = new Set(scoringPosts.map((p) => p.authorUsername.toLowerCase()));
  const uniqueOrganicAuthors = new Set(
    organicPosts.map((p) => p.authorUsername.toLowerCase())
  );
  const kolAuthors = new Set(
    scoringPosts.filter((p) => p.isKol).map((p) => p.authorUsername.toLowerCase())
  );

  let bullCount = 0;
  let neuCount = 0;
  let skepCount = 0;
  let shillCount = 0;
  let totalImpressions = 0;
  let totalEngagement = 0;
  let organicEngagement = 0;

  for (const p of posts) {
    totalImpressions += p.impressionCount;
    totalEngagement +=
      p.likeCount + p.retweetCount + p.replyCount + p.quoteCount + p.bookmarkCount;
  }

  for (const p of scoringPosts) {
    const eng = p.likeCount + p.retweetCount + p.replyCount + p.quoteCount + p.bookmarkCount;
    if (p.stance === "BULLISH") {
      bullCount += 1;
      organicEngagement += eng;
    } else if (p.stance === "SKEPTICAL") {
      skepCount += 1;
      organicEngagement += eng;
    } else if (p.stance === "SHILL_NOISE") {
      shillCount += 1;
    } else {
      neuCount += 1;
      organicEngagement += eng;
    }
  }

  const bullishPct =
    scoringPosts.length > 0 && !onlySelfPosts
      ? clampPct((bullCount / scoringDenom) * 100)
      : 0;
  const skepticalPct =
    scoringPosts.length > 0 && !onlySelfPosts
      ? clampPct((skepCount / scoringDenom) * 100)
      : 0;
  const shillNoisePct =
    scoringPosts.length > 0 ? clampPct((shillCount / scoringDenom) * 100) : 0;
  const neutralPct =
    scoringPosts.length > 0
      ? Math.max(0, 100 - bullishPct - skepticalPct - shillNoisePct)
      : 0;
  const organicSignalPct =
    scoringPosts.length > 0 ? clampPct(100 - shillNoisePct) : 0;

  // Mindshare Score (0-100)
  const uniqueKols = new Map<string, KolTier>();
  for (const p of scoringPosts) {
    if (p.isKol) uniqueKols.set(p.authorUsername.toLowerCase(), p.authorTier);
  }
  let kolPts = 0;
  for (const tier of uniqueKols.values()) {
    if (tier === "MEGA") kolPts += 9;
    else if (tier === "ALPHA") kolPts += 5;
    else if (tier === "MID") kolPts += 2.5;
  }
  kolPts = Math.min(25, kolPts);

  const authorPts = Math.min(35, uniqueOrganicAuthors.size * 2.4);
  const engagementPts =
    scoringPosts.length > 0
      ? Math.min(
          30,
          Math.log10(1 + organicEngagement + totalImpressions * 0.05) * 6.5
        )
      : 0;
  const officialPts = officialProfile
    ? officialProfile.followersCount >= 10_000
      ? 10
      : officialProfile.followersCount >= 1_000
        ? 6
        : 3
    : 0;
  const shillPenalty =
    shillNoisePct > 30 ? Math.min(22, Math.round((shillNoisePct - 30) * 0.35)) : 0;

  let mindshareScore =
    totalPostsSampled === 0
      ? Math.min(10, officialPts)
      : onlySelfPosts
        ? Math.min(16, clampPct(officialPts + Math.min(10, engagementPts * 0.35)))
        : clampPct(authorPts + kolPts + engagementPts + officialPts - shillPenalty);

  const nowMs = Date.now();
  const posts24h = scoringPosts.filter(
    (p) => p.createdAt && nowMs - Date.parse(p.createdAt) <= 86_400_000
  ).length;

  const momentum: MindshareMomentum =
    totalPostsSampled === 0 || onlySelfPosts
      ? onlySelfPosts
        ? "EARLY"
        : "QUIET"
      : posts24h >= 10 || (mindshareScore >= 65 && totalEngagement >= 200)
        ? "SURGING"
        : scoringPosts.length >= 5 || mindshareScore >= 35
          ? "ACTIVE"
          : "EARLY";

  const alignment = computeMindshareBuildAlignment({
    mindshareScore,
    organicSignalPct,
    skepticalPct,
    shillNoisePct,
    totalPostsSampled: onlySelfPosts ? finalExternalPosts.length : totalPostsSampled,
    buildIntegrityScore: input.buildIntegrityScore ?? null,
  });

  // Top Voices: prioritize external voices with highest impact, then backfill with other sampled posts
  const topVoices: XMindsharePost[] = [];
  const seenVoiceAuthors = new Set<string>();
  for (const p of scoringPosts) {
    if (p.stance === "SHILL_NOISE") continue;
    const key = p.authorUsername.toLowerCase();
    if (!seenVoiceAuthors.has(key)) {
      seenVoiceAuthors.add(key);
      topVoices.push(p);
      if (topVoices.length >= 8) break;
    }
  }
  if (topVoices.length < 6) {
    for (const p of posts) {
      if (!topVoices.some((tv) => tv.id === p.id)) {
        topVoices.push(p);
        if (topVoices.length >= 8) break;
      }
    }
  }

  return {
    source,
    fetchedAt,
    queriesUsed: queries,
    officialProfile,
    mindshareScore,
    momentum,
    quadrant: alignment.quadrant,
    quadrantLabel: alignment.quadrantLabel,
    quadrantSummary: alignment.quadrantSummary,
    totalPostsSampled,
    uniqueAuthors: uniqueAuthorSet.size,
    kolCount: kolAuthors.size,
    totalImpressions,
    totalEngagement,
    organicSignalPct,
    sentimentBreakdown: {
      bullishPct,
      neutralPct,
      skepticalPct,
      shillNoisePct,
    },
    consensusSummary,
    bullThemes,
    skepticQuestions,
    topicCatalog,
    topVoices,
    posts,
    dailyBuckets: buildDailyBuckets(posts),
    errorNote,
  };
}
