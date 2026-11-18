import { extractEntitiesFromText, parseBuildCheckInput } from "../src/lib/buildcheck/input-parser";
import type { BuildCheckReport } from "../src/lib/buildcheck/types";
import { isValidWatchedChain, type WatchWalletChain } from "../src/lib/wallet-watch-client";
import { formatTokenIdentityLabel } from "./x-client";

const TG_API_BASE = "https://api.telegram.org";
const TG_CAPTION_MAX_LEN = 1024;
const TG_MESSAGE_MAX_LEN = 4096;

const TOKEN_EXPLORER_MINT_RE =
  /^https?:\/\/(?:www\.)?(?:dexscreener\.com\/solana|pump\.fun\/coin|solscan\.io\/token|birdeye\.so\/token|gmgn\.ai\/sol\/token|rugcheck\.xyz\/tokens|jup\.ag\/tokens)\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:[/?#]|$)/i;

const BARE_DOMAIN_DM_RE =
  /\b((?:[a-z0-9-]+\.)+(?:com|io|xyz|ai|fun|org|net|app|dev|so|gg|finance|exchange|network|money|meme|pro)(?:\/[^\s"'<>)\]]*)?)\b/i;

export interface TgBotConfig {
  botToken: string;
  botUsername?: string;
  appPublicUrl: string;
  apiBaseUrl?: string;
}

export interface TgApiTransportOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxRateLimitRetries?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  link_preview_options?: { url?: string };
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface TgInlineKeyboardMarkup {
  inline_keyboard: TgInlineKeyboardButton[][];
}

export class TgApiError extends Error {
  readonly status: number;
  readonly retryAfterSec?: number;
  readonly description?: string;

  constructor(
    message: string,
    status: number,
    retryAfterSec?: number,
    description?: string
  ) {
    super(message);
    this.name = "TgApiError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.description = description;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isEntityParseError(): boolean {
    return (
      this.status === 400 &&
      typeof this.description === "string" &&
      /can't parse entities/i.test(this.description)
    );
  }
}

export function sanitizeTgErrorMessage(raw: string, botToken?: string): string {
  let sanitized = raw;
  if (botToken) {
    sanitized = sanitized.split(botToken).join("[REDACTED_TOKEN]");
  }
  return sanitized.replace(/bot\d{5,}:[A-Za-z0-9_-]{15,}/g, "bot[REDACTED]");
}

export function escapeTgHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Extracts a Solana mint address from common explorer / DEX / launchpad links.
 */
export function extractSolanaMintFromTokenUrl(rawUrl: string): string | null {
  const match = rawUrl.trim().match(TOKEN_EXPLORER_MINT_RE);
  if (!match) return null;
  const candidate = match[1];
  if (/[0OlI]/.test(candidate) || new Set(candidate).size < 10) return null;
  return candidate;
}

function collectMessagePayloadStrings(msg: TgMessage, botUsername?: string): {
  rawText: string;
  urls: string[];
} {
  const textParts = [msg.text || "", msg.caption || ""].filter(Boolean);
  const urlSet = new Set<string>();
  const entities = [...(msg.entities || []), ...(msg.caption_entities || [])];
  for (const entity of entities) {
    if (entity.type === "text_link" && entity.url) {
      urlSet.add(entity.url.trim());
    }
  }
  if (msg.link_preview_options?.url) {
    urlSet.add(msg.link_preview_options.url.trim());
  }

  let rawText = textParts.join("\n").trim();
  if (botUsername) {
    const cleanBot = botUsername.replace(/^@/, "").toLowerCase();
    rawText = rawText.replace(new RegExp(`@${cleanBot}\\b`, "gi"), " ").trim();
  }

  const filteredUrls = Array.from(urlSet).filter((u) => {
    const lower = u.toLowerCase();
    if (botUsername) {
      const cleanBot = botUsername.replace(/^@/, "").toLowerCase();
      if (lower.includes(`t.me/${cleanBot}`) || lower.includes(`telegram.me/${cleanBot}`)) {
        return false;
      }
    }
    return true;
  });

  return { rawText, urls: filteredUrls };
}

function pickBestTargetFromTextAndUrls(
  rawText: string,
  extraUrls: string[],
  allowBareDomain: boolean
): string | null {
  const combined = [rawText, ...extraUrls].filter(Boolean).join("\n").trim();
  if (!combined) return null;

  const entities = extractEntitiesFromText(combined);
  if (entities.solanaAddresses.length > 0) {
    return entities.solanaAddresses[0];
  }
  if (entities.evmAddresses && entities.evmAddresses.length > 0) {
    return entities.evmAddresses[0];
  }

  for (const url of [
    ...extraUrls,
    ...entities.websiteUrls,
    ...entities.xUrls,
  ]) {
    const mintFromUrl = extractSolanaMintFromTokenUrl(url);
    if (mintFromUrl) return mintFromUrl;
  }

  if (entities.githubRepos.length > 0) {
    return `https://github.com/${entities.githubRepos[0]}`;
  }
  if (entities.xUrls.length > 0) {
    return entities.xUrls[0];
  }
  if (entities.websiteUrls.length > 0) {
    return entities.websiteUrls[0];
  }

  if (allowBareDomain) {
    const bareMatch = rawText.match(BARE_DOMAIN_DM_RE);
    const candidate = bareMatch?.[1]?.replace(/[.,;!?]+$/, "");
    if (candidate) {
      try {
        const parsed = parseBuildCheckInput(candidate);
        return (
          parsed.mintAddress ||
          (parsed.githubOwnerRepo
            ? `https://github.com/${parsed.githubOwnerRepo}`
            : null) ||
          parsed.normalizedUrl ||
          candidate
        );
      } catch {
        // Not a valid target
      }
    }
  }

  return null;
}

export type TelegramMessageAction =
  | { kind: "command"; command: "help" | "status" | "watchlist" }
  | {
      kind: "watch_wallet";
      address: string;
      chain?: WatchWalletChain;
      label?: string;
    }
  | { kind: "unwatch_wallet"; address: string }
  | { kind: "scan"; target: string; forceRefresh?: boolean }
  | { kind: "prompt_for_target" }
  | { kind: "ignore"; reason: string };

/**
 * Classifies an incoming Telegram message into a bot action:
 * - Private DMs: accept commands (`/start`, `/help`, `/status`, `/scan`) or any direct CA/link paste.
 * - Group/Supergroup chats: respond only when explicitly invoked via `/command` or `@botUsername`,
 *   supporting both inline arguments and replied-to messages (`reply_to_message`).
 */
export function resolveTelegramMessageAction(
  msg: TgMessage,
  botUsername?: string,
  botUserId?: number
): TelegramMessageAction {
  if (msg.from?.is_bot) {
    return { kind: "ignore", reason: "from_bot" };
  }
  if (msg.chat.type === "channel") {
    return { kind: "ignore", reason: "channel_post" };
  }

  const isPrivate = msg.chat.type === "private";
  const cleanBot = botUsername?.replace(/^@/, "").toLowerCase();
  const body = (msg.text ?? msg.caption ?? "").trim();

  const isReplyToSelfBot = Boolean(
    msg.reply_to_message &&
      ((botUserId && msg.reply_to_message.from?.id === botUserId) ||
        (cleanBot &&
          msg.reply_to_message.from?.username?.toLowerCase() === cleanBot))
  );
  const safeReplyTo = isReplyToSelfBot ? undefined : msg.reply_to_message;

  // 1. Check slash commands (e.g. /scan, /scan@SolShieldBot, /start <deepLinkCA>)
  const cmdMatch = body.match(/^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]+))?$/i);
  if (cmdMatch) {
    const cmd = cmdMatch[1].toLowerCase();
    const targetBot = cmdMatch[2]?.toLowerCase();
    const cmdArg = (cmdMatch[3] || "").trim();

    if (targetBot && cleanBot && targetBot !== cleanBot) {
      return { kind: "ignore", reason: "other_bot_command" };
    }

    if (cmd === "start") {
      if (cmdArg) {
        try {
          const parsed = parseBuildCheckInput(cmdArg);
          return {
            kind: "scan",
            target: parsed.mintAddress || parsed.normalizedUrl || cmdArg,
          };
        } catch {
          // Fall through to help
        }
      }
      return { kind: "command", command: "help" };
    }

    if (cmd === "help") {
      return { kind: "command", command: "help" };
    }

    if (cmd === "status") {
      return { kind: "command", command: "status" };
    }

    if (cmd === "watchlist" || cmd === "watches") {
      return { kind: "command", command: "watchlist" };
    }

    if (cmd === "watch") {
      const tokens = cmdArg.split(/\s+/).filter(Boolean);
      const addrToken = tokens[0] || "";
      const chainAliasMap: Record<string, WatchWalletChain> = {
        sol: "solana",
        solana: "solana",
        rh: "robinhood",
        robinhood: "robinhood",
        hood: "robinhood",
        eth: "ethereum",
        ethereum: "ethereum",
        base: "base",
        arb: "arbitrum",
        arbitrum: "arbitrum",
        op: "optimism",
        optimism: "optimism",
        poly: "polygon",
        polygon: "polygon",
        bsc: "bsc",
      };
      let parsedChain: WatchWalletChain | undefined;
      let labelStartIdx = 1;
      const secondLower = (tokens[1] || "").toLowerCase();
      if (secondLower && (chainAliasMap[secondLower] || isValidWatchedChain(secondLower))) {
        parsedChain = chainAliasMap[secondLower] || (secondLower as WatchWalletChain);
        labelStartIdx = 2;
      }
      const label = tokens.slice(labelStartIdx).join(" ").trim() || undefined;
      if (addrToken) {
        return { kind: "watch_wallet", address: addrToken, chain: parsedChain, label };
      }
      if (safeReplyTo) {
        const replyPayload = collectMessagePayloadStrings(safeReplyTo, botUsername);
        const entities = extractEntitiesFromText(replyPayload.rawText);
        const replyAddr =
          entities.solanaAddresses[0] || entities.evmAddresses?.[0] || "";
        if (replyAddr) {
          return { kind: "watch_wallet", address: replyAddr, chain: parsedChain, label };
        }
      }
      return { kind: "watch_wallet", address: "" };
    }

    if (cmd === "unwatch") {
      const addrToken = cmdArg.split(/\s+/).filter(Boolean)[0] || "";
      return { kind: "unwatch_wallet", address: addrToken };
    }

    if (
      cmd === "scan" ||
      cmd === "check" ||
      cmd === "audit" ||
      cmd === "ca" ||
      cmd === "buildcheck"
    ) {
      if (cmdArg) {
        const directPayload = collectMessagePayloadStrings(
          { ...msg, text: cmdArg, caption: undefined },
          botUsername
        );
        const directTarget = pickBestTargetFromTextAndUrls(
          directPayload.rawText,
          directPayload.urls,
          true
        );
        if (directTarget) {
          return { kind: "scan", target: directTarget };
        }
        try {
          const parsed = parseBuildCheckInput(cmdArg);
          return {
            kind: "scan",
            target: parsed.mintAddress || parsed.normalizedUrl || cmdArg,
          };
        } catch {
          return { kind: "prompt_for_target" };
        }
      }

      if (safeReplyTo) {
        const replyPayload = collectMessagePayloadStrings(
          safeReplyTo,
          botUsername
        );
        const replyTarget = pickBestTargetFromTextAndUrls(
          replyPayload.rawText,
          replyPayload.urls,
          true
        );
        if (replyTarget) {
          return { kind: "scan", target: replyTarget };
        }
      }

      return { kind: "prompt_for_target" };
    }

    return isPrivate
      ? { kind: "prompt_for_target" }
      : { kind: "ignore", reason: "unknown_group_command" };
  }

  // 2. Group chats: require explicit @botUsername mention
  const isMentionedInMsg = Boolean(
    cleanBot && new RegExp(`@${cleanBot}\\b`, "i").test(body)
  );
  if (!isPrivate && !isMentionedInMsg) {
    return { kind: "ignore", reason: "group_chatter" };
  }

  // 3. Extract target from current message, or fall back to reply_to_message
  const msgPayload = collectMessagePayloadStrings(msg, botUsername);
  const directTarget = pickBestTargetFromTextAndUrls(
    msgPayload.rawText,
    msgPayload.urls,
    true
  );
  if (directTarget) {
    return { kind: "scan", target: directTarget };
  }

  if (safeReplyTo) {
    const replyPayload = collectMessagePayloadStrings(
      safeReplyTo,
      botUsername
    );
    const replyTarget = pickBestTargetFromTextAndUrls(
      replyPayload.rawText,
      replyPayload.urls,
      true
    );
    if (replyTarget) {
      return { kind: "scan", target: replyTarget };
    }
  }

  return isPrivate || isMentionedInMsg
    ? { kind: "prompt_for_target" }
    : { kind: "ignore", reason: "no_target" };
}

function formatCompactUsd(val: number | null | undefined): string | null {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return null;
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function truncateLine(raw: string, maxLen: number): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(8, maxLen - 1)).trim()}…`;
}

/**
 * Renders a crisp <= 1024-char Telegram HTML photo caption summarizing the BuildCheck verdict.
 */
export function formatTelegramAuditCaption(
  report: BuildCheckReport,
  appPublicUrl = "https://sol-shield.xyz"
): string {
  const verdictBadge =
    report.verdict === "VERIFIED_BUILD"
      ? "🟢 <b>VERIFIED BUILD</b>"
      : report.verdict === "UNPROVEN_HYPE"
        ? "🟡 <b>UNPROVEN HYPE</b>"
        : "🔴 <b>HIGH FABRICATION RISK</b>";

  const tokenIdentity = formatTokenIdentityLabel(report, 34);
  let targetBlock = "";
  if (report.target.mintAddress) {
    const titlePart = tokenIdentity
      ? `🪙 <b>${escapeTgHtml(tokenIdentity)}</b>\n`
      : "🪙 <b>Solana Token Audit</b>\n";
    targetBlock = `${titlePart}<code>${escapeTgHtml(report.target.mintAddress)}</code>`;
  } else if (report.target.githubOwnerRepo) {
    targetBlock = `💻 <b>${escapeTgHtml(report.target.githubOwnerRepo)}</b>`;
  } else {
    targetBlock = `🌐 <b>${escapeTgHtml(
      report.target.hostname || report.target.normalizedUrl || "Target"
    )}</b>`;
  }

  const fmtScore = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? `${Math.round(n)}` : "N/A";
  const scoresParts = [
    `Code <b>${fmtScore(report.componentScores.codeProof)}</b>`,
    `Chain <b>${fmtScore(report.componentScores.chainProof)}</b>`,
    `Web <b>${fmtScore(report.componentScores.domainProof)}</b>`,
  ];
  if (
    typeof report.componentScores.holdersProof === "number" &&
    Number.isFinite(report.componentScores.holdersProof)
  ) {
    scoresParts.push(
      `Holders <b>${fmtScore(report.componentScores.holdersProof)}</b>`
    );
  }
  const scoresLine = `📊 ${scoresParts.join(" · ")}`;

  let onChainLine = "";
  const tokenReport = report.chain?.tokenReport;
  const market = report.chain?.deep?.market;
  const holders = report.chain?.deep?.holders;
  if (tokenReport || market) {
    const chainStats: string[] = [];
    const mc = formatCompactUsd(market?.marketCapUsd ?? report.chain?.dexPair?.fdv);
    const liq = formatCompactUsd(market?.liquidityUsd ?? report.chain?.dexPair?.liquidityUsd);
    if (mc) chainStats.push(`MC ${mc}`);
    if (liq) chainStats.push(`Liq ${liq}`);
    if (tokenReport) {
      chainStats.push(
        tokenReport.mintAuthority === null ? "Mint Revoked" : "Mint Active ⚠️"
      );
      chainStats.push(
        tokenReport.freezeAuthority === null ? "Freeze Revoked" : "Freeze Active ⚠️"
      );
      chainStats.push(`Top5 ${tokenReport.top5Pct.toFixed(1)}%`);
    }
    if (holders?.distribution && holders.distribution.devPct > 0) {
      chainStats.push(`Dev ${holders.distribution.devPct.toFixed(1)}%`);
    }
    if (chainStats.length > 0) {
      onChainLine = `⛓ ${escapeTgHtml(chainStats.join(" · "))}`;
    }
  }

  const greenLines = report.verifiedSignals
    .slice(0, 2)
    .map((s) => `✅ ${escapeTgHtml(truncateLine(s, 110))}`);
  const redLines = report.keyRedFlags
    .slice(0, 2)
    .map((s) => `🚩 ${escapeTgHtml(truncateLine(s, 110))}`);

  const flagsBlockParts: string[] = [];
  if (greenLines.length > 0) flagsBlockParts.push(greenLines.join("\n"));
  if (redLines.length > 0) flagsBlockParts.push(redLines.join("\n"));

  const cleanDomain = appPublicUrl
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const footerLine =
    report.inferenceMode === "venice-live-api"
      ? `🛡 <i>Venice AI Zero-Retention · ${escapeTgHtml(cleanDomain)}</i>`
      : `🛡 <i>Deterministic Forensics · ${escapeTgHtml(cleanDomain)}</i>`;

  const headerSections = [
    `${verdictBadge} · <b>${report.authenticityScore}/100</b>`,
    targetBlock,
    scoresLine,
    onChainLine,
    `<i>${escapeTgHtml(truncateLine(report.headline, 140))}</i>`,
  ].filter(Boolean);

  // Assemble while staying strictly under Telegram's 1024-char sendPhoto caption cap
  const baseText = `${headerSections.join("\n")}\n\n${footerLine}`;
  const flagsJoined = flagsBlockParts.join("\n");
  if (flagsJoined) {
    const candidate = `${headerSections.join("\n")}\n\n${flagsJoined}\n\n${footerLine}`;
    if (candidate.length <= TG_CAPTION_MAX_LEN) {
      return candidate;
    }
    const singleFlags = [greenLines[0], redLines[0]].filter(Boolean).join("\n");
    if (singleFlags) {
      const compactCandidate = `${headerSections.join("\n")}\n\n${singleFlags}\n\n${footerLine}`;
      if (compactCandidate.length <= TG_CAPTION_MAX_LEN) {
        return compactCandidate;
      }
    }
  }

  if (baseText.length <= TG_CAPTION_MAX_LEN) return baseText;

  // Compact header fallback keeping valid closed HTML tags (never slice mid-tag)
  const minimalSections = [
    `${verdictBadge} · <b>${report.authenticityScore}/100</b>`,
    targetBlock,
    scoresLine,
  ];
  const minimalCandidate = `${minimalSections.join("\n")}\n\n${footerLine}`;
  if (minimalCandidate.length <= TG_CAPTION_MAX_LEN) {
    return minimalCandidate;
  }
  return `${verdictBadge} · <b>${report.authenticityScore}/100</b>\n\n${footerLine}`.slice(
    0,
    TG_CAPTION_MAX_LEN
  );
}

/**
 * Builds contextual action buttons shown below each Telegram audit photo/message.
 */
export function buildTelegramInlineKeyboard(
  report: BuildCheckReport,
  appPublicUrl = "https://sol-shield.xyz",
  callbackToken?: string
): TgInlineKeyboardMarkup {
  const cleanAppUrl = `${appPublicUrl.replace(/\/+$/, "")}/buildcheck`;
  const row1: TgInlineKeyboardButton[] = [];

  if (report.target.mintAddress) {
    const mint = report.target.mintAddress;
    row1.push(
      { text: "Solscan", url: `https://solscan.io/token/${mint}` },
      { text: "DexScreener", url: `https://dexscreener.com/solana/${mint}` }
    );
  } else if (report.target.githubOwnerRepo) {
    row1.push({
      text: "GitHub Repo",
      url: `https://github.com/${report.target.githubOwnerRepo}`,
    });
  } else if (report.target.normalizedUrl) {
    row1.push({ text: "Open Target", url: report.target.normalizedUrl });
  }

  row1.push({ text: "🔍 Web Auditor", url: cleanAppUrl });

  const keyboard: TgInlineKeyboardButton[][] = [row1];

  const directCallback = report.target.mintAddress
    ? `rescan:${report.target.mintAddress}`
    : callbackToken
      ? `rescan_h:${callbackToken}`
      : null;

  if (directCallback && Buffer.byteLength(directCallback, "utf8") <= 64) {
    keyboard.push([{ text: "🔄 Re-scan Live", callback_data: directCallback }]);
  }

  return { inline_keyboard: keyboard };
}

export function formatTelegramHelpText(botUsername?: string): string {
  const handle = botUsername ? `@${botUsername.replace(/^@/, "")}` : "this bot";
  return [
    "🛡 <b>SolShield® BuildCheck Telegram Bot</b>",
    "",
    "Paste any target in DM or use <code>/scan &lt;target&gt;</code> in groups to run a real-time forensic audit (on-chain mint authorities, holder cabals, GitHub velocity, live Chromium check &amp; Venice AI Zero-Retention).",
    "",
    "<b>Supported Targets:</b>",
    "• <b>Solana Token CA</b> — e.g. <code>CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx</code>",
    "• <b>DEX / Launchpad Link</b> — Pump.fun, DexScreener, Solscan, Birdeye, GMGN",
    "• <b>GitHub Repo</b> — <code>https://github.com/Blanksite/solshield</code>",
    "• <b>Website or X Post</b> — <code>https://sol-shield.xyz</code> or <code>https://x.com/...</code>",
    "",
    "<b>Commands:</b>",
    "• <code>/scan &lt;target&gt;</code> — audit a token, repo, website, or X link",
    `• Reply to any message with <code>/scan</code> or <code>${escapeTgHtml(handle)}</code> to audit the target inside it`,
    "• <code>/watch &lt;wallet&gt; [chain] [label]</code> — get live activity alerts for a Solana or EVM wallet",
    "• <code>/watchlist</code> · <code>/unwatch &lt;wallet&gt;</code> — view or remove watched wallets",
    "• <code>/status</code> — check bot health &amp; daily stats",
    "• <code>/help</code> — show this guide",
  ].join("\n");
}

function buildApiUrl(config: TgBotConfig, method: string): string {
  const base = (config.apiBaseUrl || TG_API_BASE).replace(/\/+$/, "");
  return `${base}/bot${config.botToken}/${method}`;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function tgFetchJson<T>(
  config: TgBotConfig,
  method: string,
  buildInit: () => RequestInit,
  transport: TgApiTransportOptions = {}
): Promise<T> {
  const fetchFn = transport.fetchImpl || fetch;
  const sleepFn = transport.sleepImpl || defaultSleep;
  const maxRetries = Math.max(0, transport.maxRateLimitRetries ?? 2);
  const timeoutMs = transport.requestTimeoutMs ?? 15_000;
  const url = buildApiUrl(config, method);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (transport.signal?.aborted) {
      clearTimeout(timer);
      throw new TgApiError(`Telegram ${method} aborted`, 499);
    }
    transport.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let res: Response;
    try {
      res = await fetchFn(url, {
        ...buildInit(),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      transport.signal?.removeEventListener("abort", onExternalAbort);
      if (transport.signal?.aborted) {
        throw new TgApiError(`Telegram ${method} aborted`, 499);
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new TgApiError(
        `Telegram ${method} network error: ${sanitizeTgErrorMessage(rawMsg, config.botToken)}`,
        503
      );
    }
    clearTimeout(timer);
    transport.signal?.removeEventListener("abort", onExternalAbort);

    const parsed = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;

    if (res.ok && parsed?.ok) {
      return parsed.result as T;
    }

    const status = parsed?.error_code ?? res.status;
    const description = parsed?.description || res.statusText || "Telegram API error";
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec =
      typeof parsed?.parameters?.retry_after === "number"
        ? parsed.parameters.retry_after
        : retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
          ? Math.ceil(Number(retryAfterHeader))
          : undefined;

    const isTransient = status === 429 || status === 502 || status === 503 || status === 504;
    if (isTransient && attempt < maxRetries) {
      const backoffMs =
        retryAfterSec !== undefined
          ? Math.min(30_000, Math.max(500, retryAfterSec * 1000))
          : Math.min(10_000, 1000 * 2 ** attempt);
      await sleepFn(backoffMs);
      continue;
    }

    throw new TgApiError(
      sanitizeTgErrorMessage(
        `Telegram ${method} failed (${status}): ${description}`,
        config.botToken
      ),
      status,
      retryAfterSec,
      description
    );
  }

  throw new TgApiError(`Telegram ${method} failed: exhausted retries`, 503);
}

export async function fetchTgBotMe(
  config: TgBotConfig,
  transport?: TgApiTransportOptions
): Promise<TgUser> {
  return tgFetchJson<TgUser>(config, "getMe", () => ({ method: "GET" }), transport);
}

export async function deleteTgWebhook(
  config: TgBotConfig,
  dropPendingUpdates = false,
  transport?: TgApiTransportOptions
): Promise<boolean> {
  return tgFetchJson<boolean>(
    config,
    "deleteWebhook",
    () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: dropPendingUpdates }),
    }),
    transport
  );
}

export async function setTgCommands(
  config: TgBotConfig,
  transport?: TgApiTransportOptions
): Promise<boolean> {
  return tgFetchJson<boolean>(
    config,
    "setMyCommands",
    () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "scan", description: "Audit a token CA, GitHub repo, website, or X link" },
          { command: "watch", description: "Watch a Solana/EVM wallet for live on-chain moves" },
          { command: "watchlist", description: "Show wallets currently watched in this chat" },
          { command: "unwatch", description: "Stop watching a wallet address" },
          { command: "status", description: "Check SolShield bot readiness & daily scan count" },
          { command: "help", description: "Show usage examples and supported targets" },
        ],
      }),
    }),
    transport
  );
}

export async function fetchTgUpdates(
  config: TgBotConfig,
  offset?: number | null,
  timeoutSec = 25,
  transport?: TgApiTransportOptions
): Promise<TgUpdate[]> {
  const payload: Record<string, unknown> = {
    timeout: timeoutSec,
    limit: 25,
    allowed_updates: ["message", "callback_query"],
  };
  if (typeof offset === "number" && Number.isFinite(offset)) {
    payload.offset = offset;
  }
  return tgFetchJson<TgUpdate[]>(
    config,
    "getUpdates",
    () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    {
      ...transport,
      requestTimeoutMs: Math.max(15_000, (timeoutSec + 10) * 1000),
    }
  );
}

export async function sendTgChatAction(
  config: TgBotConfig,
  chatId: number | string,
  action: "typing" | "upload_photo",
  transport?: TgApiTransportOptions
): Promise<void> {
  await tgFetchJson<boolean>(
    config,
    "sendChatAction",
    () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    }),
    transport
  );
}

export async function sendTgTextMessage(
  config: TgBotConfig,
  params: {
    chatId: number | string;
    text: string;
    replyToMessageId?: number;
    parseMode?: "HTML";
    replyMarkup?: TgInlineKeyboardMarkup;
    disableWebPagePreview?: boolean;
  },
  transport?: TgApiTransportOptions
): Promise<TgMessage> {
  const safeText = params.text.slice(0, TG_MESSAGE_MAX_LEN);
  const buildBody = (useHtml: boolean) =>
    JSON.stringify({
      chat_id: params.chatId,
      text: useHtml ? safeText : safeText.replace(/<[^>]+>/g, ""),
      ...(useHtml ? { parse_mode: "HTML" } : {}),
      ...(params.replyToMessageId
        ? {
            reply_parameters: {
              message_id: params.replyToMessageId,
              allow_sending_without_reply: true,
            },
          }
        : {}),
      ...(params.replyMarkup ? { reply_markup: params.replyMarkup } : {}),
      ...(params.disableWebPagePreview
        ? { link_preview_options: { is_disabled: true } }
        : {}),
    });

  try {
    return await tgFetchJson<TgMessage>(
      config,
      "sendMessage",
      () => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildBody(params.parseMode === "HTML"),
      }),
      transport
    );
  } catch (err) {
    if (err instanceof TgApiError && err.isEntityParseError && params.parseMode === "HTML") {
      return tgFetchJson<TgMessage>(
        config,
        "sendMessage",
        () => ({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: buildBody(false),
        }),
        transport
      );
    }
    throw err;
  }
}

export async function deleteTgMessage(
  config: TgBotConfig,
  chatId: number | string,
  messageId: number,
  transport?: TgApiTransportOptions
): Promise<void> {
  try {
    await tgFetchJson<boolean>(
      config,
      "deleteMessage",
      () => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      }),
      transport
    );
  } catch {
    // Best-effort cleanup if bot lacks delete permission in group
  }
}

export async function answerTgCallbackQuery(
  config: TgBotConfig,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
  transport?: TgApiTransportOptions
): Promise<void> {
  await tgFetchJson<boolean>(
    config,
    "answerCallbackQuery",
    () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        ...(text ? { text: text.slice(0, 200) } : {}),
        ...(showAlert ? { show_alert: true } : {}),
      }),
    }),
    transport
  );
}

/**
 * Uploads the rendered Evidence Card PNG along with a Telegram HTML caption and inline buttons.
 * Automatically retries as plain text if Telegram rejects any HTML formatting entity.
 */
export async function sendTgEvidencePhoto(
  config: TgBotConfig,
  params: {
    chatId: number | string;
    pngBuffer: Buffer;
    caption: string;
    replyToMessageId?: number;
    replyMarkup?: TgInlineKeyboardMarkup;
  },
  transport?: TgApiTransportOptions
): Promise<TgMessage> {
  const safeCaption = params.caption.slice(0, TG_CAPTION_MAX_LEN);
  const buildForm = (useHtml: boolean): RequestInit => {
    const form = new FormData();
    form.append("chat_id", String(params.chatId));
    form.append(
      "photo",
      new Blob([new Uint8Array(params.pngBuffer)], { type: "image/png" }),
      "solshield-evidence.png"
    );
    form.append(
      "caption",
      useHtml ? safeCaption : safeCaption.replace(/<[^>]+>/g, "").slice(0, TG_CAPTION_MAX_LEN)
    );
    if (useHtml) {
      form.append("parse_mode", "HTML");
    }
    if (params.replyToMessageId) {
      form.append(
        "reply_parameters",
        JSON.stringify({
          message_id: params.replyToMessageId,
          allow_sending_without_reply: true,
        })
      );
    }
    if (params.replyMarkup) {
      form.append("reply_markup", JSON.stringify(params.replyMarkup));
    }
    return { method: "POST", body: form };
  };

  try {
    return await tgFetchJson<TgMessage>(
      config,
      "sendPhoto",
      () => buildForm(true),
      { ...transport, requestTimeoutMs: transport?.requestTimeoutMs ?? 30_000 }
    );
  } catch (err) {
    if (err instanceof TgApiError && err.isEntityParseError) {
      return tgFetchJson<TgMessage>(
        config,
        "sendPhoto",
        () => buildForm(false),
        { ...transport, requestTimeoutMs: transport?.requestTimeoutMs ?? 30_000 }
      );
    }
    throw err;
  }
}
