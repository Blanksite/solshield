import crypto from "node:crypto";
import { extractEntitiesFromText } from "../src/lib/buildcheck/input-parser";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";

export interface XBotAuthConfig {
  botHandle: string;
  bearerToken?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
  appPublicUrl: string;
}

export interface XReferencedTweetContext {
  type: "replied_to" | "quoted" | "retweeted";
  id: string;
  text?: string;
  expandedUrls?: string[];
}

export interface XMentionItem {
  id: string;
  text: string;
  authorId?: string;
  authorUsername?: string;
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
 * Picks the strongest investigation target from an @SolShieldCheck mention:
 * 1) Explicit repo/mint/website/X-link in the mention tweet itself
 * 2) Explicit repo/mint/website/X-link inside the parent/quoted tweet
 * 3) Direct X status URL of the replied-to/quoted tweet so the agent inspects it live
 */
export function resolveMentionTarget(
  mention: XMentionItem,
  botHandle = "SolShieldCheck"
): string | null {
  const cleanBot = botHandle.replace(/^@/, "").toLowerCase();

  const pickBestFromSource = (
    text: string,
    expandedUrls: string[] = []
  ): string | null => {
    const cleanedText = text.replace(new RegExp(`@${cleanBot}\\b`, "gi"), " ");
    const combined = `${cleanedText}\n${expandedUrls.join("\n")}`;
    const entities = extractEntitiesFromText(combined);

    if (entities.solanaAddresses.length > 0) {
      return entities.solanaAddresses[0];
    }
    if (entities.githubRepos.length > 0) {
      return `https://github.com/${entities.githubRepos[0]}`;
    }
    const externalX = entities.xUrls.find(
      (u) => !u.toLowerCase().includes(`/${cleanBot}`)
    );
    if (externalX) return externalX;
    if (entities.websiteUrls.length > 0) {
      return entities.websiteUrls[0];
    }
    return null;
  };

  const direct = pickBestFromSource(mention.text, mention.expandedUrls);
  if (direct) return direct;

  // Prefer quoted tweet or direct replied_to tweet
  const refs = mention.referencedTweets.filter(
    (r) => r.type === "quoted" || r.type === "replied_to"
  );
  for (const ref of refs) {
    if (ref.text || (ref.expandedUrls && ref.expandedUrls.length > 0)) {
      const fromParent = pickBestFromSource(ref.text || "", ref.expandedUrls || []);
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
 * Formats a concise <= 280 character X reply for @SolShieldCheck evidence card replies.
 */
export function formatBuildCheckReplyTweet(
  report: BuildCheckReport,
  appPublicUrl = "https://sol-shield.xyz"
): string {
  const verdictTag =
    report.verdict === "VERIFIED_BUILD"
      ? "VERIFIED BUILD"
      : report.verdict === "UNPROVEN_HYPE"
        ? "UNPROVEN HYPE"
        : "HIGH FABRICATION RISK";

  const targetName =
    report.target.githubOwnerRepo ||
    (report.target.mintAddress
      ? `${report.target.mintAddress.slice(0, 6)}...${report.target.mintAddress.slice(-4)}`
      : null) ||
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

  const leadFinding =
    report.verdict === "VERIFIED_BUILD"
      ? report.verifiedSignals[0] || report.headline
      : report.keyRedFlags[0] || report.verifiedSignals[0] || report.headline;

  const cleanAppUrl = `${appPublicUrl.replace(/\/+$/, "")}/buildcheck`;
  const header = `[${verdictTag}] ${report.authenticityScore}/100 — ${targetName}\nCode ${codeTxt} | Chain ${chainTxt} | Web ${webTxt}`;
  const budgetForFinding = 272 - header.length - cleanAppUrl.length - 6;
  const compactFinding =
    budgetForFinding > 24
      ? `${leadFinding.replace(/\s+/g, " ").slice(0, budgetForFinding).trim()}`
      : "";

  const parts = [header];
  if (compactFinding) parts.push(compactFinding);
  parts.push(cleanAppUrl);

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

function getReadAuthHeader(
  config: XBotAuthConfig,
  method: "GET" | "POST",
  url: string
): string {
  if (config.bearerToken) {
    return `Bearer ${config.bearerToken}`;
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
    "Missing X API credentials (need X_BEARER_TOKEN or X OAuth 1.0a keys)."
  );
}

export async function fetchBotUserId(config: XBotAuthConfig): Promise<string> {
  const cleanHandle = config.botHandle.replace(/^@/, "");
  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(cleanHandle)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: getReadAuthHeader(config, "GET", url),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X user lookup failed (${res.status}): ${body.slice(0, 240)}`);
  }
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
  sinceId?: string | null
): Promise<XMentionItem[]> {
  const qs = new URLSearchParams({
    max_results: "10",
    expansions: "referenced_tweets.id,author_id",
    "tweet.fields": "created_at,conversation_id,entities,referenced_tweets",
    "user.fields": "username",
  });
  if (sinceId) {
    qs.set("since_id", sinceId);
  }

  const url = `https://api.x.com/2/users/${encodeURIComponent(
    botUserId
  )}/mentions?${qs.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: getReadAuthHeader(config, "GET", url),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X mentions fetch failed (${res.status}): ${body.slice(0, 240)}`);
  }

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
      .filter((u) => Boolean(u) && !u.startsWith("https://twitter.com/i/web"));

  // Process oldest mentions first so lastMentionId advances monotonically
  const ordered = [...json.data].reverse();
  return ordered.map((t) => ({
    id: t.id,
    text: t.text,
    authorId: t.author_id,
    authorUsername: t.author_id ? userMap.get(t.author_id) : undefined,
    conversationId: t.conversation_id,
    createdAt: t.created_at,
    expandedUrls: extractUrls(t),
    referencedTweets: (t.referenced_tweets || []).map((ref) => {
      const resolved = refMap.get(ref.id);
      return {
        type: ref.type,
        id: ref.id,
        text: resolved?.text,
        expandedUrls: extractUrls(resolved),
      };
    }),
  }));
}

export async function uploadEvidencePngToX(
  config: XBotAuthConfig,
  pngBuffer: Buffer
): Promise<string> {
  if (!hasOAuth1Credentials(config)) {
    throw new Error(
      "OAuth 1.0a credentials (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET) are required to upload media."
    );
  }

  const url = "https://upload.twitter.com/1.1/media/upload.json";
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(pngBuffer)], { type: "image/png" }), "buildcheck.png");

  const authHeader = signOAuth1Header({
    method: "POST",
    url,
    apiKey: config.apiKey!,
    apiSecret: config.apiSecret!,
    accessToken: config.accessToken!,
    accessSecret: config.accessSecret!,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X media upload failed (${res.status}): ${body.slice(0, 240)}`);
  }

  const data = (await res.json()) as { media_id_string?: string };
  if (!data?.media_id_string) {
    throw new Error("X media upload response missing media_id_string");
  }
  return data.media_id_string;
}

export async function postReplyTweetOnX(
  config: XBotAuthConfig,
  params: {
    text: string;
    replyToTweetId: string;
    mediaId?: string;
  }
): Promise<{ tweetId: string }> {
  if (!hasOAuth1Credentials(config)) {
    throw new Error(
      "OAuth 1.0a credentials (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET) are required to post replies."
    );
  }

  const url = "https://api.x.com/2/tweets";
  const authHeader = signOAuth1Header({
    method: "POST",
    url,
    apiKey: config.apiKey!,
    apiSecret: config.apiSecret!,
    accessToken: config.accessToken!,
    accessSecret: config.accessSecret!,
  });

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

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X post reply failed (${res.status}): ${body.slice(0, 240)}`);
  }

  const data = (await res.json()) as { data?: { id?: string } };
  return { tweetId: data?.data?.id || "unknown" };
}
