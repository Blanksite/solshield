import crypto from "node:crypto";
import { extractEntitiesFromText } from "../src/lib/buildcheck/input-parser";
import { isValidBuildCheckReportId } from "../src/lib/buildcheck/report-store";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";
import { normalizeHostname } from "../src/lib/domain-guard";

export interface XBotAuthConfig {
  botHandle: string;
  bearerToken?: string;
  oauth2UserToken?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
  appPublicUrl: string;
  includeReplyUrl?: boolean;
}

export interface XApiTransportOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxRateLimitRetries?: number;
}

export class XApiError extends Error {
  readonly status: number;
  readonly retryAfterSec?: number;

  constructor(message: string, status: number, retryAfterSec?: number) {
    super(message);
    this.name = "XApiError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isCreditsExhausted(): boolean {
    return this.status === 402;
  }

  get isPermanentRejection(): boolean {
    return (
      this.status === 400 ||
      this.status === 403 ||
      this.status === 404 ||
      this.status === 422
    );
  }
}

export interface XReferencedTweetContext {
  type: "replied_to" | "quoted" | "retweeted";
  id: string;
  authorId?: string;
  text?: string;
  expandedUrls?: string[];
}

export interface XMentionItem {
  id: string;
  text: string;
  authorId?: string;
  authorUsername?: string;
  inReplyToUserId?: string;
  conversationId?: string;
  createdAt?: string;
  expandedUrls: string[];
  referencedTweets: XReferencedTweetContext[];
}

/**
 * RFC 5849 strict percent encoding required for OAuth 1.0a signature base strings.
 */
export function oauthPercentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Signs an X API HTTP request using OAuth 1.0a HMAC-SHA1 without external dependencies.
 */
export function signOAuth1Header(params: {
  method: "GET" | "POST";
  url: string;
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  timestampSec?: string;
  nonce?: string;
}): string {
  const parsedUrl = new URL(params.url);
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: params.apiKey,
    oauth_nonce: params.nonce || crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: params.timestampSec || Math.floor(Date.now() / 1000).toString(),
    oauth_token: params.accessToken,
    oauth_version: "1.0",
  };

  const allEntries: Array<[string, string]> = [];
  parsedUrl.searchParams.forEach((v, k) => {
    allEntries.push([k, v]);
  });
  for (const [k, v] of Object.entries(oauthParams)) {
    allEntries.push([k, v]);
  }

  allEntries.sort(([ak, av], [bk, bv]) =>
    ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)
  );

  const paramString = allEntries
    .map(([k, v]) => `${oauthPercentEncode(k)}=${oauthPercentEncode(v)}`)
    .join("&");

  const signatureBaseString = [
    params.method.toUpperCase(),
    oauthPercentEncode(baseUrl),
    oauthPercentEncode(paramString),
  ].join("&");

  const signingKey = `${oauthPercentEncode(params.apiSecret)}&${oauthPercentEncode(
    params.accessSecret
  )}`;

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBaseString)
    .digest("base64");

  const headerFields: Array<[string, string]> = [
    ...Object.entries(oauthParams),
    ["oauth_signature", signature],
  ];

  return (
    "OAuth " +
    headerFields
      .map(([k, v]) => `${oauthPercentEncode(k)}="${oauthPercentEncode(v)}"`)
      .join(", ")
  );
}

/**
 * Picks the strongest investigation target from an @usesolshield / @SolShieldCheck mention:
 * 1) Explicit repo/mint/website/X-link in the mention tweet itself
 * 2) Explicit repo/mint/website/X-link inside the parent/quoted tweet
 * 3) Direct X status URL of the replied-to/quoted tweet so the agent inspects it live
 */
const AUDIT_INTENT_REGEX =
  /\b(audit|check(?!\s+out\b)|cek|scan|verify|verif|larpcheck|buildcheck|larp|legit|proof|evidence|inspect|analy[sz]e|investigate|real\s+or\s+(?:fake|larp))\b/i;

const X_HOSTNAMES = new Set([
  "x.com",
  "twitter.com",
  "mobile.twitter.com",
  "fxtwitter.com",
  "vxtwitter.com",
]);

const SOLSHIELD_OWN_HOSTS = new Set([
  "sol-shield.xyz",
  "www.sol-shield.xyz",
  "app.sol-shield.xyz",
  "solshield-web-production.up.railway.app",
]);

const X_MEDIA_SUFFIX_REGEX = /^\/(?:[^/]+\/status\/\d+|i\/(?:web\/)?status\/\d+)\/(?:photo|video|analytics|likes|retweets|quotes)(?:\/|$)/i;

/**
 * Filters X auto-generated media/self-status links (`/photo/1`, `/video/1`, `pic.x.com`)
 * so attached screenshots/videos are never mistaken for an external audit target.
 */
export function isXMediaOrInternalUrl(rawUrl: string, ownTweetId?: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("https://twitter.com/i/web")) return true;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host === "pic.x.com" ||
      host === "pic.twitter.com" ||
      host.endsWith(".twimg.com")
    ) {
      return true;
    }
    if (X_HOSTNAMES.has(host)) {
      if (ownTweetId && parsed.pathname.includes(`/status/${ownTweetId}`)) {
        return true;
      }
      if (X_MEDIA_SUFFIX_REGEX.test(parsed.pathname)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function isSolShieldOwnWebsiteUrl(rawUrl: string): boolean {
  const host = normalizeHostname(rawUrl);
  return Boolean(host && SOLSHIELD_OWN_HOSTS.has(host));
}

function analyzeMentionIntent(
  mention: XMentionItem,
  botAliases: string[]
): {
  hasAuditIntent: boolean;
  isBarePoliteOnly: boolean;
  nonBotHandlesCount: number;
  hasSingleLeadingReplyPrefix: boolean;
  canAcceptDirectNonCaTarget: boolean;
  isSummonedForParent: boolean;
} {
  const handles = (mention.text.match(/@[a-z0-9_]+/gi) || []).map((h) =>
    h.slice(1).toLowerCase()
  );
  const nonBotHandles = handles.filter((h) => !botAliases.includes(h));
  const firstHandle = handles[0];
  const hasRepliedTo = mention.referencedTweets.some(
    (r) => r.type === "replied_to"
  );

  const plainBody = mention.text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@[a-z0-9_]+/gi, " ")
    .trim();

  const hasAuditIntent = AUDIT_INTENT_REGEX.test(plainBody);
  const isBarePoliteOnly = /^(?:[?!.,…\s]|pls|plz|please)*$/i.test(plainBody);
  const hasSingleLeadingReplyPrefix =
    hasRepliedTo &&
    nonBotHandles.length === 1 &&
    Boolean(firstHandle && !botAliases.includes(firstHandle));

  // Direct URLs (website, X link, GitHub repo) inside a mention tweet only trigger a scan
  // if the user asked for an audit OR posted a clean command like `@usesolshield <url>`,
  // never when casually sharing a link or photo in conversation.
  const canAcceptDirectNonCaTarget =
    hasAuditIntent ||
    (isBarePoliteOnly &&
      (nonBotHandles.length === 0 || hasSingleLeadingReplyPrefix));

  const isSummonedForParent =
    hasAuditIntent ||
    (isBarePoliteOnly &&
      (nonBotHandles.length === 0
        ? handles.some((h) => botAliases.includes(h))
        : hasSingleLeadingReplyPrefix));

  return {
    hasAuditIntent,
    isBarePoliteOnly,
    nonBotHandlesCount: nonBotHandles.length,
    hasSingleLeadingReplyPrefix,
    canAcceptDirectNonCaTarget,
    isSummonedForParent,
  };
}

export function resolveMentionTarget(
  mention: XMentionItem,
  botHandle = "usesolshield",
  botUserId?: string
): string | null {
  const cleanBot = botHandle.replace(/^@/, "").toLowerCase();
  const botAliases = Array.from(
    new Set([cleanBot, "usesolshield", "solshieldcheck"].filter(Boolean))
  );
  const quotedIds = new Set(
    mention.referencedTweets
      .filter((r) => r.type === "quoted")
      .map((r) => r.id)
  );
  const intent = analyzeMentionIntent(mention, botAliases);

  const pickBestFromSource = (
    text: string,
    expandedUrls: string[] = [],
    opts: {
      ignoreAutoQuotedLinks?: boolean;
      ignoreTweetId?: string;
      allowNonCaTarget?: boolean;
    } = {}
  ): string | null => {
    const ignoreQuoted = Boolean(opts.ignoreAutoQuotedLinks);
    const allowNonCa = opts.allowNonCaTarget ?? true;
    const isIgnoredXUrl = (url: string): boolean => {
      const lower = url.toLowerCase();
      if (isXMediaOrInternalUrl(url, opts.ignoreTweetId)) return true;
      if (ignoreQuoted) {
        for (const qid of quotedIds) {
          if (lower.includes(`/status/${qid}`)) return true;
        }
      }
      return false;
    };

    let cleanedText = text;
    for (const alias of botAliases) {
      cleanedText = cleanedText.replace(new RegExp(`@${alias}\\b`, "gi"), " ");
    }
    const filteredExpanded = expandedUrls.filter((u) => !isIgnoredXUrl(u));
    const combined = `${cleanedText}\n${filteredExpanded.join("\n")}`;
    const entities = extractEntitiesFromText(combined);

    if (entities.solanaAddresses.length > 0) {
      return entities.solanaAddresses[0];
    }
    if (!allowNonCa) {
      return null;
    }
    if (entities.githubRepos.length > 0) {
      return `https://github.com/${entities.githubRepos[0]}`;
    }
    const externalX = entities.xUrls.find((u) => {
      const lower = u.toLowerCase();
      if (botAliases.some((alias) => lower.includes(`/${alias}`))) {
        return false;
      }
      return !isIgnoredXUrl(u);
    });
    if (externalX) return externalX;
    const externalWebsite = entities.websiteUrls.find(
      (u) => !isSolShieldOwnWebsiteUrl(u) && !isXMediaOrInternalUrl(u, opts.ignoreTweetId)
    );
    if (externalWebsite) {
      return externalWebsite;
    }
    return null;
  };

  const direct = pickBestFromSource(mention.text, mention.expandedUrls, {
    ignoreAutoQuotedLinks: true,
    ignoreTweetId: mention.id,
    allowNonCaTarget: intent.canAcceptDirectNonCaTarget,
  });
  if (direct) return direct;

  // Prefer quoted tweet or direct replied_to tweet only when the user actually summoned the bot,
  // never auditing the bot's own tweets or the author's own self-reply thread narration.
  if (!intent.isSummonedForParent) {
    return null;
  }

  const refs = mention.referencedTweets.filter((r) => {
    if (r.type !== "quoted" && r.type !== "replied_to") return false;
    if (
      botUserId &&
      (r.authorId === botUserId ||
        (r.type === "replied_to" && mention.inReplyToUserId === botUserId))
    ) {
      return false;
    }
    if (
      r.type === "replied_to" &&
      mention.authorId &&
      r.authorId &&
      r.authorId === mention.authorId
    ) {
      return false;
    }
    return true;
  });

  for (const ref of refs) {
    if (ref.text || (ref.expandedUrls && ref.expandedUrls.length > 0)) {
      const fromParent = pickBestFromSource(ref.text || "", ref.expandedUrls || [], {
        ignoreTweetId: ref.id,
        allowNonCaTarget: true,
      });
      if (fromParent) return fromParent;
    }
  }

  // Fallback: inspect parent/quoted X post itself in live browser + syndication
  if (refs.length > 0 && /^\d{10,25}$/.test(refs[0].id)) {
    return `https://x.com/i/status/${refs[0].id}`;
  }

  return null;
}

/**
 * Extracts a compact `Name ($SYMBOL)` label from BuildCheck on-chain/DEX metadata.
 */
export function formatTokenIdentityLabel(
  report: BuildCheckReport,
  maxNameLen = 28
): string | null {
  const rawName = (
    report.chain?.deep?.metadata?.name ||
    report.chain?.tokenReport?.name ||
    ""
  ).trim();
  const rawSymbol = (
    report.chain?.deep?.metadata?.symbol ||
    report.chain?.tokenReport?.symbol ||
    ""
  )
    .trim()
    .replace(/^\$+/, "");

  const cleanName =
    rawName.length > maxNameLen
      ? `${rawName.slice(0, maxNameLen - 1).trim()}…`
      : rawName;
  const cleanSymbol = rawSymbol ? `$${rawSymbol.slice(0, 12)}` : "";

  if (cleanName && cleanSymbol) {
    if (rawName.toLowerCase() === rawSymbol.toLowerCase()) {
      return cleanSymbol;
    }
    return `${cleanName} (${cleanSymbol})`;
  }
  return cleanSymbol || cleanName || null;
}

/**
 * Masks un-abbreviated Solana or EVM addresses in reply prose so full CAs stay
 * on the attached Evidence Card PNG instead of triggering X anti-crypto-address filters.
 */
export function maskCryptoAddresses(text: string): string {
  return text
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`)
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (cand) => {
      const hasUpper = /[A-Z]/.test(cand);
      const hasDigitOrLower = /[0-9]/.test(cand) || /[a-z]/.test(cand);
      if (!hasUpper || !hasDigitOrLower || new Set(cand).size < 10) {
        return cand;
      }
      return `${cand.slice(0, 6)}...${cand.slice(-4)}`;
    });
}

/**
 * Formats a concise <= 280 character X reply for SolShield BuildCheck evidence card replies.
 * Set `options.includeUrl = false` to omit external links when optimizing Pay-Per-Use costs
 * (the public URL remains rendered inside the attached Evidence Card PNG).
 */
export function formatBuildCheckReplyTweet(
  report: BuildCheckReport,
  appPublicUrl = "https://sol-shield.xyz",
  options: { includeUrl?: boolean } = {}
): string {
  const verdictTag =
    report.verdict === "VERIFIED_BUILD"
      ? "VERIFIED BUILD"
      : report.verdict === "UNPROVEN_HYPE"
        ? "UNPROVEN HYPE"
        : "HIGH FABRICATION RISK";

  const tokenIdentity = formatTokenIdentityLabel(report, 22);
  const shortMint = report.target.mintAddress
    ? `${report.target.mintAddress.slice(0, 6)}...${report.target.mintAddress.slice(-4)}`
    : null;
  const targetName =
    report.target.githubOwnerRepo ||
    (shortMint && tokenIdentity ? `${tokenIdentity} · ${shortMint}` : shortMint) ||
    report.target.hostname ||
    "target";

  const codeTxt =
    report.componentScores.codeProof !== null
      ? `${report.componentScores.codeProof}`
      : "N/A";
  const chainTxt =
    report.componentScores.chainProof !== null
      ? `${report.componentScores.chainProof}`
      : "N/A";
  const webTxt =
    report.componentScores.domainProof !== null
      ? `${report.componentScores.domainProof}`
      : "N/A";

  const rawLeadFinding =
    report.verdict === "VERIFIED_BUILD"
      ? report.verifiedSignals[0] || report.headline
      : report.keyRedFlags[0] || report.verifiedSignals[0] || report.headline;
  const leadFinding = maskCryptoAddresses(rawLeadFinding);

  const includeUrl = options.includeUrl ?? true;
  const cleanAppUrl = `${appPublicUrl.replace(/\/+$/, "")}/buildcheck`;
  const reportPermalinkUrl = isValidBuildCheckReportId(report.id)
    ? `${cleanAppUrl}?report=${encodeURIComponent(report.id)}`
    : cleanAppUrl;

  const header = `[${verdictTag}] ${report.authenticityScore}/100 — ${targetName}\nCode ${codeTxt} | Chain ${chainTxt} | Web ${webTxt}`;
  const selectedAppUrl =
    header.length + reportPermalinkUrl.length + 28 <= 272
      ? reportPermalinkUrl
      : cleanAppUrl;
  const footerLine = includeUrl
    ? selectedAppUrl
    : "SolShield x Venice AI Zero-Retention Proof Card attached";
  const budgetForFinding = 272 - header.length - footerLine.length - 6;
  const compactFinding =
    budgetForFinding > 24
      ? `${leadFinding.replace(/\s+/g, " ").slice(0, budgetForFinding).trim()}`
      : "";

  const parts = [header];
  if (compactFinding) parts.push(compactFinding);
  parts.push(footerLine);

  return parts.join("\n\n").slice(0, 280);
}

function hasOAuth1Credentials(config: XBotAuthConfig): boolean {
  return Boolean(
    config.apiKey &&
      config.apiSecret &&
      config.accessToken &&
      config.accessSecret
  );
}

export function getReadAuthHeader(
  config: XBotAuthConfig,
  method: "GET" | "POST",
  url: string
): string {
  if (config.bearerToken) {
    return `Bearer ${config.bearerToken}`;
  }
  if (config.oauth2UserToken) {
    return `Bearer ${config.oauth2UserToken}`;
  }
  if (hasOAuth1Credentials(config)) {
    return signOAuth1Header({
      method,
      url,
      apiKey: config.apiKey!,
      apiSecret: config.apiSecret!,
      accessToken: config.accessToken!,
      accessSecret: config.accessSecret!,
    });
  }
  throw new Error(
    "Missing X API read credentials (need X_BEARER_TOKEN, X_OAUTH2_ACCESS_TOKEN, or X OAuth 1.0a keys)."
  );
}

export function getWriteAuthHeader(
  config: XBotAuthConfig,
  method: "GET" | "POST",
  url: string
): string {
  if (hasOAuth1Credentials(config)) {
    return signOAuth1Header({
      method,
      url,
      apiKey: config.apiKey!,
      apiSecret: config.apiSecret!,
      accessToken: config.accessToken!,
      accessSecret: config.accessSecret!,
    });
  }
  if (config.oauth2UserToken) {
    return `Bearer ${config.oauth2UserToken}`;
  }
  throw new Error(
    "Missing X API write credentials (need X OAuth 1.0a keys or X_OAUTH2_ACCESS_TOKEN with tweet.write & media.write)."
  );
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const retryAfterRaw = headers.get("retry-after");
  if (retryAfterRaw) {
    const secs = Number(retryAfterRaw);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.ceil(secs);
    }
  }
  const resetRaw = headers.get("x-rate-limit-reset");
  if (resetRaw) {
    const resetEpochSec = Number(resetRaw);
    if (Number.isFinite(resetEpochSec) && resetEpochSec > 0) {
      const delta = Math.ceil(resetEpochSec - Date.now() / 1000);
      return Math.max(1, delta);
    }
  }
  return undefined;
}

async function fetchWithXRetry(
  url: string,
  buildInit: () => RequestInit,
  errorPrefix: string,
  transport: XApiTransportOptions = {}
): Promise<Response> {
  const fetchFn = transport.fetchImpl || fetch;
  const sleepFn = transport.sleepImpl || defaultSleep;
  const maxRetries = Math.max(0, transport.maxRateLimitRetries ?? 2);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetchFn(url, buildInit());
    if (res.ok) return res;

    const retryAfterSec = parseRetryAfterSeconds(res.headers);
    const body = await res.text().catch(() => "");
    const isTransient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;

    if (isTransient && attempt < maxRetries) {
      const backoffMs =
        retryAfterSec !== undefined
          ? Math.min(30_000, Math.max(500, retryAfterSec * 1000))
          : Math.min(16_000, 1000 * 2 ** attempt);
      await sleepFn(backoffMs);
      continue;
    }

    throw new XApiError(
      `${errorPrefix} (${res.status}): ${body.slice(0, 240)}`,
      res.status,
      retryAfterSec
    );
  }

  throw new XApiError(`${errorPrefix}: exhausted retry attempts`, 503);
}

export async function fetchBotUserId(
  config: XBotAuthConfig,
  transport?: XApiTransportOptions
): Promise<string> {
  const cleanHandle = config.botHandle.replace(/^@/, "");

  // Prefer OAuth user context (/2/users/me): free/zero user-lookup cost and verifies token owner.
  if (hasOAuth1Credentials(config) || config.oauth2UserToken) {
    try {
      const meUrl = "https://api.x.com/2/users/me";
      const meRes = await fetchWithXRetry(
        meUrl,
        () => ({
          headers: {
            Authorization: getWriteAuthHeader(config, "GET", meUrl),
          },
        }),
        "X self-user lookup failed",
        transport
      );
      const meData = (await meRes.json()) as {
        data?: { id?: string; username?: string };
      };
      if (meData?.data?.id) {
        if (
          meData.data.username &&
          meData.data.username.toLowerCase() !== cleanHandle.toLowerCase()
        ) {
          console.warn(
            `[X Auth Warn] Token owner is @${meData.data.username}, expected BOT_X_HANDLE=@${cleanHandle}.`
          );
        } else {
          return meData.data.id;
        }
      }
    } catch {
      // Fall back to username lookup below
    }
  }

  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(cleanHandle)}`;
  const res = await fetchWithXRetry(
    url,
    () => ({
      headers: {
        Authorization: getReadAuthHeader(config, "GET", url),
      },
    }),
    "X user lookup failed",
    transport
  );
  const data = (await res.json()) as { data?: { id?: string } };
  if (!data?.data?.id) {
    throw new Error(`Unable to resolve X user ID for @${cleanHandle}`);
  }
  return data.data.id;
}

interface RawXTweet {
  id: string;
  text: string;
  author_id?: string;
  in_reply_to_user_id?: string;
  conversation_id?: string;
  created_at?: string;
  entities?: {
    urls?: Array<{ expanded_url?: string; unwound_url?: string }>;
  };
  referenced_tweets?: Array<{
    type: "replied_to" | "quoted" | "retweeted";
    id: string;
  }>;
}

export async function fetchBotMentions(
  config: XBotAuthConfig,
  botUserId: string,
  sinceId?: string | null,
  transport?: XApiTransportOptions
): Promise<XMentionItem[]> {
  const qs = new URLSearchParams({
    max_results: "10",
    expansions: "referenced_tweets.id,author_id",
    "tweet.fields":
      "created_at,conversation_id,author_id,in_reply_to_user_id,entities,referenced_tweets",
    "user.fields": "username",
  });
  if (sinceId) {
    qs.set("since_id", sinceId);
  }

  const url = `https://api.x.com/2/users/${encodeURIComponent(
    botUserId
  )}/mentions?${qs.toString()}`;

  const res = await fetchWithXRetry(
    url,
    () => ({
      headers: {
        Authorization: getReadAuthHeader(config, "GET", url),
      },
    }),
    "X mentions fetch failed",
    transport
  );

  const json = (await res.json()) as {
    data?: RawXTweet[];
    includes?: {
      tweets?: RawXTweet[];
      users?: Array<{ id: string; username: string }>;
    };
  };

  if (!Array.isArray(json.data)) return [];

  const refMap = new Map<string, RawXTweet>();
  for (const t of json.includes?.tweets || []) {
    refMap.set(t.id, t);
  }
  const userMap = new Map<string, string>();
  for (const u of json.includes?.users || []) {
    userMap.set(u.id, u.username);
  }

  const extractUrls = (t?: RawXTweet): string[] =>
    (t?.entities?.urls || [])
      .map((u) => u.unwound_url || u.expanded_url || "")
      .filter((u) => Boolean(u) && !isXMediaOrInternalUrl(u, t?.id));

  // Process oldest mentions first so lastMentionId advances monotonically
  const ordered = [...json.data].reverse();
  return ordered.map((t) => ({
    id: t.id,
    text: t.text,
    authorId: t.author_id,
    authorUsername: t.author_id ? userMap.get(t.author_id) : undefined,
    inReplyToUserId: t.in_reply_to_user_id,
    conversationId: t.conversation_id,
    createdAt: t.created_at,
    expandedUrls: extractUrls(t),
    referencedTweets: (t.referenced_tweets || []).map((ref) => {
      const resolved = refMap.get(ref.id);
      return {
        type: ref.type,
        id: ref.id,
        authorId: resolved?.author_id,
        text: resolved?.text,
        expandedUrls: extractUrls(resolved),
      };
    }),
  }));
}

function extractUploadedMediaId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { data?: { id?: unknown }; media_id_string?: unknown };
  if (typeof obj.data?.id === "string" && obj.data.id) return obj.data.id;
  if (typeof obj.media_id_string === "string" && obj.media_id_string) {
    return obj.media_id_string;
  }
  return null;
}

async function uploadMediaChunkedV2(
  config: XBotAuthConfig,
  pngBuffer: Buffer,
  transport?: XApiTransportOptions
): Promise<string> {
  const initUrl = "https://api.x.com/2/media/upload/initialize";
  const initRes = await fetchWithXRetry(
    initUrl,
    () => ({
      method: "POST",
      headers: {
        Authorization: getWriteAuthHeader(config, "POST", initUrl),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media_type: "image/png",
        total_bytes: pngBuffer.byteLength,
        media_category: "tweet_image",
      }),
    }),
    "X media v2 initialize failed",
    transport
  );
  const initJson = (await initRes.json()) as unknown;
  const mediaId = extractUploadedMediaId(initJson);
  if (!mediaId) {
    throw new Error("X media v2 initialize response missing data.id");
  }

  const chunkSize = 2 * 1024 * 1024;
  let segmentIndex = 0;
  for (let offset = 0; offset < pngBuffer.byteLength; offset += chunkSize) {
    const slice = pngBuffer.subarray(offset, offset + chunkSize);
    const appendUrl = `https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/append`;
    await fetchWithXRetry(
      appendUrl,
      () => {
        const form = new FormData();
        form.append("segment_index", String(segmentIndex));
        form.append("media", new Blob([new Uint8Array(slice)], { type: "image/png" }), "buildcheck.png");
        return {
          method: "POST",
          headers: {
            Authorization: getWriteAuthHeader(config, "POST", appendUrl),
          },
          body: form,
        };
      },
      "X media v2 append failed",
      transport
    );
    segmentIndex += 1;
  }

  const finalizeUrl = `https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/finalize`;
  const finalizeRes = await fetchWithXRetry(
    finalizeUrl,
    () => ({
      method: "POST",
      headers: {
        Authorization: getWriteAuthHeader(config, "POST", finalizeUrl),
      },
    }),
    "X media v2 finalize failed",
    transport
  );
  const finalizeJson = (await finalizeRes.json().catch(() => null)) as unknown;
  return extractUploadedMediaId(finalizeJson) || mediaId;
}

/**
 * Uploads an Evidence Card PNG via X API v2 (`POST https://api.x.com/2/media/upload`),
 * automatically falling back to chunked v2 (`initialize` -> `append` -> `finalize`) for large payloads.
 */
export async function uploadEvidencePngToX(
  config: XBotAuthConfig,
  pngBuffer: Buffer,
  transport?: XApiTransportOptions
): Promise<string> {
  if (pngBuffer.byteLength > 4_500_000) {
    return uploadMediaChunkedV2(config, pngBuffer, transport);
  }

  const url = "https://api.x.com/2/media/upload";
  try {
    const res = await fetchWithXRetry(
      url,
      () => {
        const form = new FormData();
        form.append(
          "media",
          new Blob([new Uint8Array(pngBuffer)], { type: "image/png" }),
          "buildcheck.png"
        );
        form.append("media_category", "tweet_image");
        return {
          method: "POST",
          headers: {
            Authorization: getWriteAuthHeader(config, "POST", url),
          },
          body: form,
        };
      },
      "X media v2 upload failed",
      transport
    );

    const json = (await res.json()) as unknown;
    const mediaId = extractUploadedMediaId(json);
    if (!mediaId) {
      throw new Error("X media v2 upload response missing data.id");
    }
    return mediaId;
  } catch (err) {
    const canTryChunkedFallback =
      err instanceof XApiError &&
      (err.status === 400 || err.status === 413 || err.status === 415);
    if (!canTryChunkedFallback) {
      throw err;
    }
    return uploadMediaChunkedV2(config, pngBuffer, transport);
  }
}

export async function postReplyTweetOnX(
  config: XBotAuthConfig,
  params: {
    text: string;
    replyToTweetId: string;
    mediaId?: string;
  },
  transport?: XApiTransportOptions
): Promise<{ tweetId: string }> {
  const url = "https://api.x.com/2/tweets";
  const payload: Record<string, unknown> = {
    text: params.text,
    reply: {
      in_reply_to_tweet_id: params.replyToTweetId,
    },
  };
  if (params.mediaId) {
    payload.media = {
      media_ids: [params.mediaId],
    };
  }

  const res = await fetchWithXRetry(
    url,
    () => ({
      method: "POST",
      headers: {
        Authorization: getWriteAuthHeader(config, "POST", url),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
    "X post reply failed",
    transport
  );

  const data = (await res.json()) as { data?: { id?: string } };
  return { tweetId: data?.data?.id || "unknown" };
}
