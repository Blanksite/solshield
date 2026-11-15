import type {
  MindshareTopicClusterMeta,
  SocialCohortId,
  SocialMindshareReport,
  XMindsharePost,
} from "./types";

export type TelemetryLensId = "topics" | "accounts" | "drivers" | "cohorts";
export type MindshareTimeframe = "24h" | "72h" | "7d";
export type MindshareWeightMode = "relative" | "posts";

export interface MindshareArchitectureTile {
  id: string;
  title: string;
  description: string;
  tags: string[];
  postIds: string[];
  postCount: number;
  sharePct: number;
  weightTotal: number;
  bullishPct: number;
  skepticalPct: number;
  shillPct: number;
  badgeText: string;
  badgeTone: "bullish" | "mixed" | "skeptical" | "shill";
}

export interface SquarifiedTileRect {
  tile: MindshareArchitectureTile;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

const COHORT_META: Record<
  SocialCohortId,
  { title: string; description: string; tags: string[] }
> = {
  BUILDERS: {
    title: "Builders & Core Devs",
    description: "Devs & official handles shipping code, repos & architecture",
    tags: ["Builders", "Devs"],
  },
  SECURITY: {
    title: "On-Chain Security & Audits",
    description: "Forensic accounts verifying drainers, clusters & contract proof",
    tags: ["Security", "Audit"],
  },
  ALPHA_KOL: {
    title: "KOLs & Alpha Dispatchers",
    description: "High-reach accounts spotlighting narrative, entry & flow",
    tags: ["KOLs", "Alpha"],
  },
  COMMUNITY: {
    title: "DEX Rotators & Community",
    description: "Traders & ecosystem accounts reacting to volume & momentum",
    tags: ["DEX", "Community"],
  },
};

const TOPIC_FALLBACKS: Array<{
  name: string;
  description: string;
  tags: string[];
  pattern: RegExp;
}> = [
  {
    name: "Core Build & AI Stack",
    description: "GitHub shipping, live Chromium XHR, SDKs & agent infrastructure",
    tags: ["Builders", "AI Stack"],
    pattern:
      /\b(github|repo|commit|open\s*source|code|buildcheck|build(?:ing)?|ship(?:ped|ping)?|sdk|api|agent|llm|venice|chromium|extension|chrome|telegram|bot|devnet|mainnet|anchor|architecture)\b/i,
  },
  {
    name: "Market Cap, Flow & Entry",
    description: "Liquidity rotation, market cap sizing, entries & runner catalysts",
    tags: ["Alpha", "DEX"],
    pattern:
      /\b(mcap|mc|market\s*cap|chart|dex|volume|liquidity|buy|buying|sell|pump|dip|entry|accumulate|accumulating|undervalued|runner|catalyst|raydium|jupiter|jup|gem|100x|holders?)\b/i,
  },
  {
    name: "Pre-Sign Security & Privacy",
    description: "Tx firewall, drainer defense, non-custodial zero-log protection",
    tags: ["Security", "Privacy"],
    pattern:
      /\b(firewall|drainer|non-custodial|zero-retention|zero-log|privacy|policy\s*vault|larp|rug|scam|cabal|bundler|sniper|mint|freeze|simulat(?:e|ion)|forensic|audit|auditor)\b/i,
  },
];

const DEFAULT_FALLBACK_TOPIC = {
  name: "Ecosystem & Community Buzz",
  description: "General X mentions, replies & organic project discovery",
  tags: ["Community", "CT"],
};

/**
 * Classifies a sampled X post author into a behavioral CT cohort deterministically
 * from their profile metadata, handle match, and post vocabulary.
 */
export function classifyPostCohort(
  post: Pick<XMindsharePost, "authorCohort" | "authorUsername" | "text" | "isKol">,
  officialHandle?: string | null
): SocialCohortId {
  if (post.authorCohort) return post.authorCohort;

  const handleLower = post.authorUsername.replace(/^@/, "").trim().toLowerCase();
  const officialLower = officialHandle?.replace(/^@/, "").trim().toLowerCase() || "";
  if (officialLower && handleLower === officialLower) {
    return "BUILDERS";
  }

  const text = post.text || "";
  if (
    /\b(firewall|drainer|audit|auditor|verify|verified|non-custodial|zero-retention|privacy|larp|rug|scam|cabal|bundler|sniper|holders?|mint\s+authority|freeze|simulat(?:e|ion)|forensic)\b/i.test(
      text
    )
  ) {
    return "SECURITY";
  }

  if (
    /\b(github|repo|commit|open\s*source|sdk|api|shipped|shipping|architecture|anchor|devnet|mainnet|extension|chromium|code)\b/i.test(
      text
    )
  ) {
    return "BUILDERS";
  }

  if (
    post.isKol ||
    /\b(alpha|conviction|undervalued|runner|accumulat(?:e|ing)|dip|entry|narrative|catalyst|mcap|gem|100x)\b/i.test(
      text
    )
  ) {
    return "ALPHA_KOL";
  }

  return "COMMUNITY";
}

/**
 * Resolves a human-readable topic cluster name, descriptor, and tags for a post,
 * honoring Venice topic assignments when present and falling back deterministically.
 */
export function resolvePostTopic(
  post: Pick<XMindsharePost, "topicName" | "text">,
  topicCatalog?: MindshareTopicClusterMeta[]
): MindshareTopicClusterMeta {
  if (post.topicName) {
    const matched = (topicCatalog ?? []).find(
      (t) => t.name.toLowerCase() === post.topicName!.toLowerCase()
    );
    if (matched) return matched;
    return {
      name: post.topicName,
      description: "Live X discussion sub-theme grouped from recent mentions",
      tags: ["X Theme", "Live"],
    };
  }

  const text = post.text || "";
  for (const rule of TOPIC_FALLBACKS) {
    if (rule.pattern.test(text)) {
      return {
        name: rule.name,
        description: rule.description,
        tags: rule.tags,
      };
    }
  }
  return DEFAULT_FALLBACK_TOPIC;
}

function postWeight(post: XMindsharePost, mode: MindshareWeightMode): number {
  if (mode === "posts") return 1;
  return Math.max(
    10,
    post.engagementScore +
      Math.sqrt(Math.max(0, post.authorFollowers)) * 0.35 +
      (post.isKol ? 25 : 0)
  );
}

function summarizeTileBadge(posts: XMindsharePost[]): {
  bullishPct: number;
  skepticalPct: number;
  shillPct: number;
  badgeText: string;
  badgeTone: "bullish" | "mixed" | "skeptical" | "shill";
} {
  const denom = Math.max(1, posts.length);
  const bull = posts.filter((p) => p.stance === "BULLISH").length;
  const skep = posts.filter((p) => p.stance === "SKEPTICAL").length;
  const shill = posts.filter((p) => p.stance === "SHILL_NOISE").length;

  const bullishPct = Math.round((bull / denom) * 100);
  const skepticalPct = Math.round((skep / denom) * 100);
  const shillPct = Math.round((shill / denom) * 100);

  if (shill > bull && shill > skep) {
    return {
      bullishPct,
      skepticalPct,
      shillPct,
      badgeText: `${shillPct}% Promo`,
      badgeTone: "shill",
    };
  }
  if (skep > bull && skep > 0) {
    return {
      bullishPct,
      skepticalPct,
      shillPct,
      badgeText: `${skepticalPct}% Skep`,
      badgeTone: "skeptical",
    };
  }
  if (bullishPct >= 40 || bull > skep) {
    return {
      bullishPct,
      skepticalPct,
      shillPct,
      badgeText: `${bullishPct}% Bull`,
      badgeTone: "bullish",
    };
  }
  if (bull > 0) {
    return {
      bullishPct,
      skepticalPct,
      shillPct,
      badgeText: `${bullishPct}% Bull`,
      badgeTone: "mixed",
    };
  }
  return {
    bullishPct,
    skepticalPct,
    shillPct,
    badgeText: "Neutral",
    badgeTone: "mixed",
  };
}

/**
 * Filters sampled X posts inside the 7-day search window. Undated fallback posts
 * remain visible in 7D and when all timestamps are absent.
 */
export function filterPostsByTimeframe(
  posts: XMindsharePost[],
  timeframe: MindshareTimeframe,
  nowMs = Date.now()
): XMindsharePost[] {
  if (timeframe === "7d") return posts;
  const windowMs = timeframe === "24h" ? 86_400_000 : 3 * 86_400_000;
  const hasAnyTimestamp = posts.some((p) => Boolean(p.createdAt));
  if (!hasAnyTimestamp) return posts;

  return posts.filter((p) => {
    if (!p.createdAt) return false;
    const ts = Date.parse(p.createdAt);
    if (!Number.isFinite(ts)) return false;
    return nowMs - ts <= windowMs;
  });
}

function finalizeTiles(
  rawBuckets: Array<{
    id: string;
    title: string;
    description: string;
    tags: string[];
    posts: XMindsharePost[];
    weightTotal: number;
  }>,
  searchQuery: string
): MindshareArchitectureTile[] {
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? rawBuckets.filter((b) => {
        if (
          b.title.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.tags.some((t) => t.toLowerCase().includes(q))
        ) {
          return true;
        }
        return b.posts.some(
          (p) =>
            p.authorUsername.toLowerCase().includes(q) ||
            p.authorName.toLowerCase().includes(q) ||
            p.text.toLowerCase().includes(q)
        );
      })
    : rawBuckets;

  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) => b.weightTotal - a.weightTotal);
  const totalWeight = Math.max(
    1,
    sorted.reduce((sum, b) => sum + b.weightTotal, 0)
  );

  // Assign exact 1-decimal percentages and reconcile rounding drift on the top bucket
  const rawShares = sorted.map((b) =>
    Math.round(((b.weightTotal / totalWeight) * 100) * 10) / 10
  );
  const shareSum = rawShares.reduce((s, v) => s + v, 0);
  if (rawShares.length > 0) {
    rawShares[0] = Math.max(
      0.1,
      Math.round((rawShares[0] + (100 - shareSum)) * 10) / 10
    );
  }

  return sorted.map((b, idx) => {
    const stats = summarizeTileBadge(b.posts);
    return {
      id: b.id,
      title: b.title,
      description: b.description,
      tags: b.tags.slice(0, 2),
      postIds: b.posts.map((p) => p.id),
      postCount: b.posts.length,
      sharePct: rawShares[idx],
      weightTotal: Math.round(b.weightTotal),
      ...stats,
    };
  });
}

/**
 * Builds proportional treemap clusters from real X posts across 4 telemetry lenses:
 * Discussion Topics, KOL & Key Accounts, Sentiment Drivers, or Community Cohorts.
 */
export function buildMindshareArchitectureTiles(params: {
  social: SocialMindshareReport;
  lens: TelemetryLensId;
  timeframe: MindshareTimeframe;
  weightMode: MindshareWeightMode;
  searchQuery?: string;
  nowMs?: number;
}): {
  tiles: MindshareArchitectureTile[];
  scopedPosts: XMindsharePost[];
} {
  const { social, lens, timeframe, weightMode, searchQuery = "", nowMs } = params;
  const scopedPosts = filterPostsByTimeframe(social.posts || [], timeframe, nowMs);
  if (scopedPosts.length === 0) {
    return { tiles: [], scopedPosts: [] };
  }

  const officialHandle = social.officialProfile?.username || null;
  const bucketMap = new Map<
    string,
    {
      id: string;
      title: string;
      description: string;
      tags: string[];
      posts: XMindsharePost[];
      weightTotal: number;
    }
  >();

  const pushToBucket = (
    id: string,
    title: string,
    description: string,
    tags: string[],
    post: XMindsharePost
  ) => {
    const w = postWeight(post, weightMode);
    const existing = bucketMap.get(id);
    if (existing) {
      existing.posts.push(post);
      existing.weightTotal += w;
    } else {
      bucketMap.set(id, {
        id,
        title,
        description,
        tags,
        posts: [post],
        weightTotal: w,
      });
    }
  };

  if (lens === "topics") {
    for (const post of scopedPosts) {
      const meta = resolvePostTopic(post, social.topicCatalog);
      const id = `topic:${meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      pushToBucket(id, meta.name, meta.description, meta.tags, post);
    }
  } else if (lens === "cohorts") {
    for (const post of scopedPosts) {
      const cohort = classifyPostCohort(post, officialHandle);
      const meta = COHORT_META[cohort];
      pushToBucket(
        `cohort:${cohort}`,
        meta.title,
        meta.description,
        meta.tags,
        post
      );
    }
  } else if (lens === "drivers") {
    for (const post of scopedPosts) {
      if (post.stance === "BULLISH") {
        const isBuildUtility =
          /\b(github|repo|commit|code|audit|firewall|non-custodial|privacy|shipping|build|venice|live)\b/i.test(
            post.text
          );
        if (isBuildUtility) {
          pushToBucket(
            "driver:utility",
            "Utility & Build Conviction",
            "Supporters citing verifiable tech, code execution & security utility",
            ["Utility", "Build Proof"],
            post
          );
        } else {
          pushToBucket(
            "driver:catalyst",
            "Catalyst & Flow Conviction",
            "Bulls highlighting low cap upside, chart momentum & community growth",
            ["Momentum", "Upside"],
            post
          );
        }
      } else if (post.stance === "SKEPTICAL") {
        pushToBucket(
          "driver:skeptic",
          "Open Questions & Risk Pushback",
          "Accounts flagging gaps, devnet limits, supply or missing proof",
          ["Due Diligence", "Risks"],
          post
        );
      } else if (post.stance === "SHILL_NOISE") {
        pushToBucket(
          "driver:shill",
          "Promo & Shill Noise",
          "Airdrop bait, multi-cashtag spam & promo-flagged mentions",
          ["Noise Filter", "Promo"],
          post
        );
      } else {
        pushToBucket(
          "driver:neutral",
          "Neutral Telemetry & Coverage",
          "Informational recaps, tracker alerts & balanced observations",
          ["Neutral", "Telemetry"],
          post
        );
      }
    }
  } else {
    // KOL & Key Accounts: group by author, keeping top 5 individual voices + pooling the rest
    const byAuthor = new Map<
      string,
      {
        username: string;
        name: string;
        followers: number;
        tier: XMindsharePost["authorTier"];
        verified: boolean;
        posts: XMindsharePost[];
        weightTotal: number;
      }
    >();

    for (const post of scopedPosts) {
      const key = post.authorUsername.toLowerCase();
      const w = postWeight(post, weightMode);
      const existing = byAuthor.get(key);
      if (existing) {
        existing.posts.push(post);
        existing.weightTotal += w;
      } else {
        byAuthor.set(key, {
          username: post.authorUsername,
          name: post.authorName,
          followers: post.authorFollowers,
          tier: post.authorTier,
          verified: post.authorVerified,
          posts: [post],
          weightTotal: w,
        });
      }
    }

    const sortedAuthors = Array.from(byAuthor.values()).sort(
      (a, b) => b.weightTotal - a.weightTotal
    );
    const topAuthors = sortedAuthors.slice(0, 5);
    const tailAuthors = sortedAuthors.slice(5);

    for (const a of topAuthors) {
      const isOfficial =
        officialHandle && a.username.toLowerCase() === officialHandle.toLowerCase();
      const followerTag =
        a.followers >= 1_000
          ? `${(a.followers / 1_000).toFixed(a.followers >= 10_000 ? 0 : 1)}K flw`
          : `${a.followers} flw`;
      const tierTag = isOfficial
        ? "Official"
        : a.tier === "MEGA" || a.tier === "ALPHA"
          ? `${a.tier} KOL`
          : a.tier === "MID"
            ? "KOL"
            : "Voice";
      bucketMap.set(`acc:${a.username.toLowerCase()}`, {
        id: `acc:${a.username.toLowerCase()}`,
        title: `@${a.username}`,
        description: `${a.name}${a.verified ? " · Verified X account" : ""}`,
        tags: [tierTag, followerTag],
        posts: a.posts,
        weightTotal: a.weightTotal,
      });
    }

    if (tailAuthors.length > 0) {
      const restPosts = tailAuthors.flatMap((a) => a.posts);
      const restWeight = tailAuthors.reduce((s, a) => s + a.weightTotal, 0);
      bucketMap.set("acc:other-voices", {
        id: "acc:other-voices",
        title: "Other Community Voices",
        description: `Combined mindshare across ${tailAuthors.length} additional accounts`,
        tags: [`${tailAuthors.length} Accounts`, "Long Tail"],
        posts: restPosts,
        weightTotal: restWeight,
      });
    }
  }

  // Cap topics to 5 named blocks + "Other Topics" so the bento grid stays balanced
  if (lens === "topics" && bucketMap.size > 6) {
    const allTopicBuckets = Array.from(bucketMap.values()).sort(
      (a, b) => b.weightTotal - a.weightTotal
    );
    const head = allTopicBuckets.slice(0, 5);
    const tail = allTopicBuckets.slice(5);
    bucketMap.clear();
    for (const item of head) bucketMap.set(item.id, item);
    bucketMap.set("topic:other", {
      id: "topic:other",
      title: "Other Sub-Narratives",
      description: `Combined ${tail.length} smaller discussion threads`,
      tags: ["Long Tail", "CT"],
      posts: tail.flatMap((t) => t.posts),
      weightTotal: tail.reduce((s, t) => s + t.weightTotal, 0),
    });
  }

  return {
    tiles: finalizeTiles(Array.from(bucketMap.values()), searchQuery),
    scopedPosts,
  };
}

function worstAspect(areas: number[], length: number): number {
  if (areas.length === 0 || length <= 0) return Infinity;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const a of areas) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = sum * sum;
  const l2 = length * length;
  return Math.max((l2 * max) / s2, s2 / (l2 * Math.max(min, 1e-6)));
}

/**
 * Computes normalized (0..100%) squarified treemap coordinates with a readable
 * minimum visual floor per tile while keeping true sharePct values intact.
 */
export function computeSquarifiedTreemap(
  tiles: MindshareArchitectureTile[]
): SquarifiedTileRect[] {
  if (tiles.length === 0) return [];
  if (tiles.length === 1) {
    return [{ tile: tiles[0], xPct: 0, yPct: 0, wPct: 100, hPct: 100 }];
  }

  // Power-dampened visual weight preserves strict monotonic sizing while keeping long-tail tiles legible
  const VIRTUAL_W = 100;
  const VIRTUAL_H = 108;
  const visualWeights = tiles.map((t) => Math.pow(Math.max(t.sharePct, 8), 0.65));
  const totalVisual = visualWeights.reduce((s, v) => s + v, 0);
  const totalArea = VIRTUAL_W * VIRTUAL_H;

  const items = tiles.map((tile, i) => ({
    tile,
    area: (visualWeights[i] / totalVisual) * totalArea,
  }));

  const results: SquarifiedTileRect[] = [];

  const layoutRow = (
    row: typeof items,
    x: number,
    y: number,
    w: number,
    h: number
  ): { x: number; y: number; w: number; h: number } => {
    const rowSum = row.reduce((s, r) => s + r.area, 0);
    if (w <= h) {
      // Lay horizontal strip across full width w
      const stripH = Math.max(0, rowSum / Math.max(w, 1e-6));
      let curX = x;
      for (const item of row) {
        const itemW = item.area / Math.max(stripH, 1e-6);
        results.push({
          tile: item.tile,
          xPct: (curX / VIRTUAL_W) * 100,
          yPct: (y / VIRTUAL_H) * 100,
          wPct: (itemW / VIRTUAL_W) * 100,
          hPct: (stripH / VIRTUAL_H) * 100,
        });
        curX += itemW;
      }
      return { x, y: y + stripH, w, h: Math.max(0, h - stripH) };
    } else {
      // Lay vertical strip along full height h
      const stripW = Math.max(0, rowSum / Math.max(h, 1e-6));
      let curY = y;
      for (const item of row) {
        const itemH = item.area / Math.max(stripW, 1e-6);
        results.push({
          tile: item.tile,
          xPct: (x / VIRTUAL_W) * 100,
          yPct: (curY / VIRTUAL_H) * 100,
          wPct: (stripW / VIRTUAL_W) * 100,
          hPct: (itemH / VIRTUAL_H) * 100,
        });
        curY += itemH;
      }
      return { x: x + stripW, y, w: Math.max(0, w - stripW), h };
    }
  };

  let box = { x: 0, y: 0, w: VIRTUAL_W, h: VIRTUAL_H };
  let row: typeof items = [];

  for (const item of items) {
    const side = Math.min(box.w, box.h);
    const currentAreas = row.map((r) => r.area);
    const nextAreas = [...currentAreas, item.area];
    if (
      row.length === 0 ||
      worstAspect(nextAreas, side) <= worstAspect(currentAreas, side)
    ) {
      row.push(item);
    } else {
      box = layoutRow(row, box.x, box.y, box.w, box.h);
      row = [item];
    }
  }

  if (row.length > 0) {
    layoutRow(row, box.x, box.y, box.w, box.h);
  }

  return results;
}
