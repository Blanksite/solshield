import type { DomainEvaluation } from "../domain-guard";
import type { TokenScanReport } from "../token-scanner";

export type BuildCheckTargetKind =
  | "token_ca"
  | "x_post"
  | "x_profile"
  | "github_repo"
  | "website";

export interface ParsedTargetInput {
  rawInput: string;
  kind: BuildCheckTargetKind;
  mintAddress?: string;
  githubOwnerRepo?: string;
  xHandle?: string;
  xTweetId?: string;
  normalizedUrl?: string;
  hostname?: string;
}

export interface InspectedApiPayload {
  url: string;
  status: number;
  jsonExcerpt: string;
}

export interface BrowserStopCapture {
  url: string;
  title: string;
  stepLabel: string;
  screenshotBase64: string;
  textExcerpt: string;
  outboundGithub: string[];
  outboundX: string[];
  outboundSolanaAddresses: string[];
  networkHosts: string[];
  xhrCount: number;
  loadTimeMs: number;
  hasPlaceholderCopy: boolean;
  consoleErrors?: string[];
  apiPayloads?: InspectedApiPayload[];
}

export interface BrowserRunSummary {
  mode: "local-chromium" | "remote-cdp" | "http-fallback";
  executableLabel: string;
  stops: BrowserStopCapture[];
  discoveredGithubRepos: string[];
  discoveredXUrls: string[];
  discoveredSolanaAddresses: string[];
  discoveredWebsiteUrls: string[];
  totalXhrObserved: number;
  pageErrorsCount?: number;
  inspectedApiPayloads?: InspectedApiPayload[];
  notes: string[];
}

export interface GitHubForensicReport {
  queried: boolean;
  exists: boolean;
  fullName: string;
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
  recentCommitCount: number;
  uniqueAuthorCount: number;
  burstCommitRatio: number;
  topLanguages: string[];
  topLevelFiles: string[];
  hasTestsOrCi: boolean;
  hasPackageManifest: boolean;
  signals: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
  }>;
  error?: string;
}

export interface DexPairSummary {
  dexId: string;
  pairAddress: string;
  pairUrl: string;
  liquidityUsd: number;
  fdv: number | null;
  volume24hUsd: number;
  pairCreatedAt: string | null;
  pairAgeHours: number | null;
  websites: string[];
  socials: Array<{ type: string; url: string }>;
}

export interface TokenDeepMetadata {
  name: string | null;
  symbol: string | null;
  description: string | null;
  imageUrl: string | null;
  websites: string[];
  twitterUrl: string | null;
  telegramUrl: string | null;
  launchpad: string | null;
  createdAt: string | null;
}

export interface TokenDeepMarketStats {
  poolAddress: string | null;
  dexId: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange5m: number | null;
  priceChange1h: number | null;
  priceChange6h: number | null;
  priceChange24h: number | null;
  buys1h: number | null;
  sells1h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  lpLockedPct: number | null;
  lpLockedUsd: number | null;
}

export type HolderNodeRole =
  | "pool"
  | "burn"
  | "dev"
  | "cabal"
  | "sniper"
  | "retail";

export interface HolderClusterNode {
  address: string;
  tokenAccount: string;
  pct: number;
  uiAmount: number;
  role: HolderNodeRole;
  funder: string | null;
  firstSlot: number | null;
  isFresh: boolean;
  txCount: number;
}

export interface HolderCabalCluster {
  clusterId: string;
  kind: "co_funded" | "same_slot" | "insider_flag";
  label: string;
  funder: string | null;
  slot: number | null;
  combinedPct: number;
  wallets: HolderClusterNode[];
}

export interface HolderAuditCheckRow {
  label: string;
  value?: string;
  status: "flag" | "watch" | "clear";
}

export interface HoldersDeepAnalysis {
  score: number;
  verdict: "OK" | "SKETCHY" | "RIGGED";
  totalHolders: number | null;
  distribution: {
    insidersPct: number;
    snipersPct: number;
    burnedOrLockedPct: number;
    devPct: number;
    retailPct: number;
  };
  clusters: HolderCabalCluster[];
  nodes: HolderClusterNode[];
  checks: HolderAuditCheckRow[];
  flagsCount: number;
  watchCount: number;
  clearCount: number;
  notes: string[];
}

export interface DevTxEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  action: "burn" | "claim" | "swap" | "transfer" | "deploy" | "other";
  summary: string;
  err: boolean;
}

export interface DevLaunchedTokenSummary {
  mint: string;
  name: string | null;
  symbol: string | null;
  createdAt: string | null;
}

export interface DevWalletHistory {
  devAddress: string | null;
  solBalance: number | null;
  tokenHoldingPct: number;
  coinsLaunchedCount: number;
  flaggedCoinsCount: number;
  launchedTokens: DevLaunchedTokenSummary[];
  recentTxs: DevTxEntry[];
}

export interface TokenDeepForensics {
  metadata: TokenDeepMetadata;
  market: TokenDeepMarketStats;
  holders: HoldersDeepAnalysis;
  devHistory: DevWalletHistory;
}

export interface ChainTokenIntelReport {
  mintAddress: string;
  tokenReport: TokenScanReport | null;
  dexPair: DexPairSummary | null;
  accountRecentTxCount: number | null;
  deep?: TokenDeepForensics | null;
  error?: string;
}

export interface DomainIntelReport {
  hostname: string;
  domainEval: DomainEvaluation;
  rdapCreatedAt: string | null;
  domainAgeDays: number | null;
  registrableDomain: string;
  pageTitle: string | null;
  generatorHints: string[];
}

export interface XPostIntelReport {
  url: string;
  handle: string | null;
  tweetId: string | null;
  authorName: string | null;
  textContent: string | null;
  extractedUrls: string[];
  extractedSolanaAddresses: string[];
  extractedGithubRepos: string[];
  methodUsed: "browser" | "syndication" | "oembed" | "unavailable";
  note?: string;
}

export type ClaimStatus = "VERIFIED" | "MIXED" | "CONTRADICTED" | "UNVERIFIED";

export interface ClaimVsProofRow {
  claim: string;
  status: ClaimStatus;
  evidence: string;
}

export type BuildCheckVerdict =
  | "VERIFIED_BUILD"
  | "UNPROVEN_HYPE"
  | "HIGH_FABRICATION_RISK";

export interface BuildCheckComponentScores {
  codeProof: number | null;
  chainProof: number | null;
  domainProof: number | null;
  holdersProof?: number | null;
  claimAlignment: number;
}

export interface BuildCheckReport {
  id: string;
  createdAt: string;
  elapsedMs: number;
  target: ParsedTargetInput;
  cache?: {
    hit: boolean;
    cachedAt: string;
    expiresAt: string;
    cacheKey: string;
  };
  authenticityScore: number;
  verdict: BuildCheckVerdict;
  headline: string;
  contradictionCallout?: string | null;
  executiveSummary: string;
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  modelsUsed: string[];
  visionSummary: string | null;
  privacyAttestation: string;
  componentScores: BuildCheckComponentScores;
  claimsVsProof: ClaimVsProofRow[];
  verifiedSignals: string[];
  keyRedFlags: string[];
  browser: BrowserRunSummary;
  github: GitHubForensicReport | null;
  chain: ChainTokenIntelReport | null;
  domain: DomainIntelReport | null;
  xPost: XPostIntelReport | null;
  social?: SocialMindshareReport | null;
}

export type MindshareStance = "BULLISH" | "NEUTRAL" | "SKEPTICAL" | "SHILL_NOISE";
export type KolTier = "MEGA" | "ALPHA" | "MID" | "MICRO";
export type MindshareMomentum = "SURGING" | "ACTIVE" | "EARLY" | "QUIET";
export type SocialCohortId =
  | "BUILDERS"
  | "SECURITY"
  | "ALPHA_KOL"
  | "COMMUNITY";
export type HypeBuildQuadrant =
  | "CONVICTION_RUNNER"
  | "UNDERVALUED_BUILDER"
  | "NARRATIVE_OVERHEAT"
  | "CONTESTED_DISCOURSE"
  | "PRE_DISCOVERY";

export interface MindshareTopicClusterMeta {
  name: string;
  description: string;
  tags: string[];
}

export interface XKolAuthorProfile {
  id: string;
  username: string;
  name: string;
  verified: boolean;
  verifiedType: string | null;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  listedCount: number;
  createdAt: string | null;
  accountAgeDays: number | null;
  tier: KolTier;
  profileImageUrl: string | null;
  description: string | null;
}

export interface XMindsharePost {
  id: string;
  url: string;
  text: string;
  createdAt: string | null;
  authorUsername: string;
  authorName: string;
  authorVerified: boolean;
  authorVerifiedType: string | null;
  authorFollowers: number;
  authorTier: KolTier;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
  impressionCount: number;
  engagementScore: number;
  stance: MindshareStance;
  stanceReason: string | null;
  shillFlags: string[];
  isKol: boolean;
  topicName?: string | null;
  authorCohort?: SocialCohortId | null;
}

export interface MindshareBucket {
  date: string;
  postCount: number;
  uniqueAuthors: number;
  kolCount: number;
  engagementTotal: number;
}

export interface SocialMindshareReport {
  source: "x-api-v2" | "venice-x-search" | "hybrid" | "unavailable";
  fetchedAt: string;
  queriesUsed: string[];
  officialProfile: XKolAuthorProfile | null;
  mindshareScore: number;
  momentum: MindshareMomentum;
  quadrant: HypeBuildQuadrant;
  quadrantLabel: string;
  quadrantSummary: string;
  totalPostsSampled: number;
  uniqueAuthors: number;
  kolCount: number;
  totalImpressions: number;
  totalEngagement: number;
  organicSignalPct: number;
  sentimentBreakdown: {
    bullishPct: number;
    neutralPct: number;
    skepticalPct: number;
    shillNoisePct: number;
  };
  consensusSummary: string;
  bullThemes: string[];
  skepticQuestions: string[];
  topicCatalog?: MindshareTopicClusterMeta[];
  topVoices: XMindsharePost[];
  posts: XMindsharePost[];
  dailyBuckets: MindshareBucket[];
  errorNote: string | null;
}

export type BuildCheckStreamEvent =
  | {
      type: "step";
      stepId: string;
      elapsedMs: number;
      title: string;
      detail: string;
      phase: "parse" | "browser" | "collectors" | "venice" | "done";
    }
  | {
      type: "frame";
      elapsedMs: number;
      url: string;
      title: string;
      stepLabel: string;
      imageBase64: string;
      xhrCount: number;
    }
  | {
      type: "collector";
      elapsedMs: number;
      collector: "github" | "chain" | "domain" | "xpost" | "social";
      status: "ok" | "warn" | "error" | "idle";
      summary: string;
    }
  | {
      type: "verdict";
      elapsedMs: number;
      report: BuildCheckReport;
    }
  | {
      type: "error";
      elapsedMs: number;
      message: string;
    };
