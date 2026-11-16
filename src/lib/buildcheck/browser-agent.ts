import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import {
  decodeHtmlEntities,
  extractEntitiesFromText,
  extractVisibleTextFromHtml,
} from "./input-parser";
import type {
  BrowserRunSummary,
  BrowserStopCapture,
  InspectedApiPayload,
} from "./types";
import { assertSafePublicHttpUrl, isBlockedHostname } from "./url-safety";

const PLACEHOLDER_RE =
  /lorem ipsum|coming soon|replace_me|example\.com|todo:|sample dashboard|demo only/i;

/**
 * Searches known OS Chrome, Edge, and Playwright Chromium cache paths without
 * requiring an extra Chromium binary download inside node_modules.
 */
export function findLocalChromiumExecutable(): {
  path: string;
  label: string;
} | null {
  const explicit =
    process.env.BUILDCHECK_CHROME_PATH?.trim() || process.env.CHROME_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return { path: explicit, label: path.basename(explicit) };
  }

  // Inspect Playwright Chromium cache directory first (most reliable for headless)
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const pwRoots = [
    path.join(localAppData, "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ];
  for (const root of pwRoots) {
    try {
      if (!fs.existsSync(root)) continue;
      const dirs = fs
        .readdirSync(root)
        .filter((d) => d.startsWith("chromium-"))
        .sort()
        .reverse();
      for (const d of dirs) {
        const candidates = [
          path.join(root, d, "chrome-win64", "chrome.exe"),
          path.join(root, d, "chrome-linux", "chrome"),
          path.join(root, d, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            return { path: c, label: `Chromium (${d})` };
          }
        }
      }
    } catch {
      // Ignore permission errors scanning cache
    }
  }

  const staticCandidates = [
    { path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", label: "Google Chrome" },
    { path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", label: "Microsoft Edge" },
    { path: "/usr/bin/google-chrome", label: "Google Chrome" },
    { path: "/usr/bin/chromium", label: "Chromium" },
    { path: "/usr/bin/chromium-browser", label: "Chromium" },
    {
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      label: "Google Chrome",
    },
  ];
  for (const cand of staticCandidates) {
    if (fs.existsSync(cand.path)) {
      return cand;
    }
  }

  return null;
}

async function openGuardedPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
  );
  await page.setRequestInterception(true);
  return page;
}

async function captureStop(
  page: Page,
  targetUrl: string,
  stepLabel: string
): Promise<{ stop: BrowserStopCapture; websiteUrls: string[] }> {
  const startMs = Date.now();
  await assertSafePublicHttpUrl(targetUrl);

  const networkHosts = new Set<string>();
  const consoleErrors: string[] = [];
  const apiPayloads: InspectedApiPayload[] = [];
  let xhrCount = 0;

  const targetHost = new URL(targetUrl).hostname.toLowerCase();

  const onConsole = (msg: import("puppeteer-core").ConsoleMessage) => {
    if (msg.type() === "error") {
      const txt = msg.text().trim();
      if (txt && consoleErrors.length < 8) {
        consoleErrors.push(txt.slice(0, 260));
      }
    }
  };

  const onPageError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg && consoleErrors.length < 8) {
      consoleErrors.push(`PageError: ${msg.slice(0, 240)}`);
    }
  };

  const onResponse = async (res: import("puppeteer-core").HTTPResponse) => {
    try {
      const req = res.request();
      const rType = req.resourceType();
      if (rType !== "xhr" && rType !== "fetch") return;
      const resUrl = res.url();
      const resHost = new URL(resUrl).hostname.toLowerCase();
      // Inspect project API JSON responses (same host, subdomains, or /api/ routes)
      const isProjectApi =
        resHost === targetHost ||
        resHost.endsWith(`.${targetHost}`) ||
        resUrl.includes("/api/");
      if (!isProjectApi || apiPayloads.length >= 8) return;
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json") && !ct.includes("+json")) return;
      const rawText = await res.text();
      if (!rawText || rawText.length > 80_000) return;
      apiPayloads.push({
        url: resUrl,
        status: res.status(),
        jsonExcerpt: rawText.slice(0, 1400),
      });
    } catch {
      // Response body already disposed or preflight opaque
    }
  };

  const onRequest = (req: import("puppeteer-core").HTTPRequest) => {
    const reqUrl = req.url();
    if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:") || reqUrl === "about:blank") {
      void req.continue();
      return;
    }
    try {
      const parsed = new URL(reqUrl);
      if (isBlockedHostname(parsed.hostname)) {
        void req.abort("blockedbyclient");
        return;
      }
      const rType = req.resourceType();
      if (rType === "media") {
        void req.abort("blockedbyclient");
        return;
      }
      if (rType === "xhr" || rType === "fetch" || rType === "websocket") {
        xhrCount += 1;
        networkHosts.add(parsed.hostname);
      }
    } catch {
      void req.abort("blockedbyclient");
      return;
    }
    void req.continue();
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 14000,
    });
    await new Promise((r) => setTimeout(r, 1350));

    // Re-check final navigated URL after client/server redirects for SSRF defense
    const finalUrl = page.url();
    if (finalUrl.startsWith("http")) {
      await assertSafePublicHttpUrl(finalUrl);
    }

    const domData = await page.evaluate(() => {
      const title = document.title || "";
      const mainEl = document.querySelector('main, article, [role="main"], .markdown-body') as HTMLElement | null;
      const bodyText = ((mainEl || document.body)?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();

      // Inside github.com/x.com, skip global navigation chrome; on project sites include header/footer repo/social links
      const isCodeOrSocialHost =
        location.hostname.includes("github.com") || location.hostname === "x.com" || location.hostname === "twitter.com";
      const primaryAnchors = mainEl
        ? Array.from(mainEl.querySelectorAll("a[href]"))
        : [];
      const fallbackAnchors = Array.from(document.querySelectorAll("a[href]")).filter(
        (a) => !isCodeOrSocialHost || !a.closest("header, nav, footer")
      );
      const allProjectLinks = isCodeOrSocialHost
        ? []
        : Array.from(document.querySelectorAll('a[href*="github.com/"], a[href*="x.com/"], a[href*="twitter.com/"]'));

      const sourceAnchors = Array.from(
        new Set([
          ...allProjectLinks,
          ...(primaryAnchors.length > 0 ? primaryAnchors : fallbackAnchors),
        ])
      );

      const anchors = sourceAnchors
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => h.startsWith("http"));
      return {
        title,
        textExcerpt: bodyText.slice(0, 3200),
        anchors: anchors.slice(0, 60),
      };
    });

    const screenshotRaw = await page.screenshot({
      type: "jpeg",
      quality: 74,
    });
    const screenshotBase64 = Buffer.from(screenshotRaw).toString("base64");
    const entities = extractEntitiesFromText(
      `${domData.textExcerpt}\n${domData.anchors.join(" ")}`
    );

    return {
      stop: {
        url: finalUrl || targetUrl,
        title: domData.title,
        stepLabel,
        screenshotBase64,
        textExcerpt: domData.textExcerpt,
        outboundGithub: entities.githubRepos,
        outboundX: entities.xUrls,
        outboundSolanaAddresses: entities.solanaAddresses,
        outboundEvmAddresses: entities.evmAddresses,
        networkHosts: Array.from(networkHosts).slice(0, 8),
        xhrCount,
        loadTimeMs: Date.now() - startMs,
        hasPlaceholderCopy: PLACEHOLDER_RE.test(domData.textExcerpt),
        consoleErrors,
        apiPayloads,
      },
      websiteUrls: entities.websiteUrls,
    };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

const THIRD_PARTY_CAMPAIGN_REPOS = new Set([
  "veniceai/builtinvenice",
  "vercel/next.js",
  "solana-labs/solana",
]);

const STATIC_ASSET_EXT_RE =
  /\.(css|js|mjs|cjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|map)(\?|#|$)/i;

function extractMetaDescription(html: string): string {
  const metaMatches = html.matchAll(/<meta\b([^>]+)>/gi);
  for (const m of metaMatches) {
    const attrs = m[1];
    const keyMatch = attrs.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
    const key = keyMatch?.[1]?.trim().toLowerCase();
    if (key !== "description" && key !== "og:description") continue;
    const contentMatch = attrs.match(/content\s*=\s*["']([^"']*)["']/i);
    if (contentMatch?.[1]) {
      return decodeHtmlEntities(contentMatch[1]).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

/**
 * Extracts title, human-readable text, and prioritized outbound links from raw SSR HTML
 * so HTTP fallback yields accurate repository, X, and copy telemetry without Chromium.
 */
export function extractHtmlStopSignals(
  html: string,
  baseUrl: string
): {
  title: string;
  textExcerpt: string;
  hasPlaceholderCopy: boolean;
  outboundGithub: string[];
  outboundX: string[];
  outboundSolanaAddresses: string[];
  websiteUrls: string[];
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim()
    : "";

  const metaDescription = extractMetaDescription(html);

  const priorityLinks = new Set<string>();
  const generalLinks = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const rawHref = match[1].trim();
    if (
      !rawHref ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:") ||
      rawHref.startsWith("javascript:")
    ) {
      continue;
    }
    try {
      const resolved = new URL(rawHref, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      const hrefStr = resolved.toString();
      const host = resolved.hostname.toLowerCase();
      if (
        host === "github.com" ||
        host === "www.github.com" ||
        host === "x.com" ||
        host === "www.x.com" ||
        host === "twitter.com" ||
        host === "www.twitter.com"
      ) {
        priorityLinks.add(hrefStr);
      } else if (!STATIC_ASSET_EXT_RE.test(resolved.pathname)) {
        generalLinks.add(hrefStr);
      }
    } catch {
      // Ignore malformed relative href
    }
  }

  const bodyText = extractVisibleTextFromHtml(html);
  const combinedCopy =
    metaDescription && !bodyText.toLowerCase().includes(metaDescription.toLowerCase().slice(0, 48))
      ? `${metaDescription} ${bodyText}`.trim()
      : bodyText;
  const textExcerpt = combinedCopy.slice(0, 3200);

  const orderedLinks = [
    ...Array.from(priorityLinks).slice(0, 24),
    ...Array.from(generalLinks).slice(0, 36),
  ];
  const entities = extractEntitiesFromText(`${orderedLinks.join(" ")}\n${textExcerpt}`);

  return {
    title,
    textExcerpt,
    hasPlaceholderCopy: PLACEHOLDER_RE.test(textExcerpt),
    outboundGithub: entities.githubRepos,
    outboundX: entities.xUrls,
    outboundSolanaAddresses: entities.solanaAddresses,
    websiteUrls: entities.websiteUrls,
  };
}

async function readResponseTextCapped(res: Response, maxChars = 600_000): Promise<string> {
  if (!res.body) {
    return (await res.text()).slice(0, maxChars);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  try {
    while (result.length < maxChars) {
      const { value, done } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return result.slice(0, maxChars);
}

async function captureHttpStop(
  targetUrl: string,
  stepLabel: string,
  timeoutMs = 6800
): Promise<{ stop: BrowserStopCapture; websiteUrls: string[] }> {
  const startMs = Date.now();
  let currentUrl = (await assertSafePublicHttpUrl(targetUrl)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= 3; hop += 1) {
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "SolShield-BuildCheck/1.0",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) {
          throw new Error(`HTTP ${res.status} redirect without Location header`);
        }
        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = (await assertSafePublicHttpUrl(nextUrl)).toString();
        continue;
      }
      break;
    }

    if (!res) {
      throw new Error("HTTP request failed without response");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`Unsupported HTTP content-type: ${contentType}`);
    }

    const html = await readResponseTextCapped(res, 600_000);
    const extracted = extractHtmlStopSignals(html, currentUrl);
    const host = new URL(currentUrl).hostname.toLowerCase();

    return {
      stop: {
        url: currentUrl,
        title: extracted.title,
        stepLabel,
        screenshotBase64: "",
        textExcerpt: extracted.textExcerpt,
        outboundGithub: extracted.outboundGithub,
        outboundX: extracted.outboundX,
        outboundSolanaAddresses: extracted.outboundSolanaAddresses,
        networkHosts: host ? [host] : [],
        xhrCount: 0,
        loadTimeMs: Date.now() - startMs,
        hasPlaceholderCopy: extracted.hasPlaceholderCopy,
        consoleErrors: [],
        apiPayloads: [],
      },
      websiteUrls: extracted.websiteUrls,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeStopPlan(
  options: BrowserObserveOptions,
  notes: string[],
  fetchStop: (
    url: string,
    stepLabel: string
  ) => Promise<{ stop: BrowserStopCapture; websiteUrls: string[] }>
): Promise<Omit<BrowserRunSummary, "mode" | "executableLabel">> {
  const maxStops = options.maxStops ?? 2;
  const stops: BrowserStopCapture[] = [];
  const githubSet = new Set<string>();
  const xSet = new Set<string>();
  const solSet = new Set<string>();
  const evmSet = new Set<string>();
  const webSet = new Set<string>();

  const recordStop = (stop: BrowserStopCapture) => {
    stops.push(stop);
    if (stop.screenshotBase64) {
      options.onFrame?.(stop);
    } else {
      options.onNote?.(
        `HTTP inspected ${stop.url} (${stop.textExcerpt.length} chars, ${stop.outboundGithub.length} repo link(s))`
      );
    }
  };

  for (let i = 0; i < Math.min(options.initialUrls.length, maxStops); i += 1) {
    const target = options.initialUrls[i];
    try {
      const { stop, websiteUrls } = await fetchStop(target.url, target.label);
      recordStop(stop);
      stop.outboundGithub.forEach((g) => githubSet.add(g));
      stop.outboundX.forEach((x) => xSet.add(x));
      stop.outboundSolanaAddresses.forEach((s) => solSet.add(s));
      stop.outboundEvmAddresses?.forEach((e) => evmSet.add(e));
      websiteUrls.forEach((w) => webSet.add(w));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stop fetch failed";
      notes.push(`Skipped ${target.url}: ${msg}`);
      options.onNote?.(msg);
    }
  }

  // Opportunistically follow newly discovered GitHub repo or linked project site if under cap
  if (stops.length < maxStops && githubSet.size > 0) {
    const candidates = Array.from(githubSet).filter(
      (repo) => !stops.some((s) => s.url.toLowerCase().includes(repo.toLowerCase()))
    );
    const nextGh =
      candidates.find((r) => !THIRD_PARTY_CAMPAIGN_REPOS.has(r.toLowerCase())) ||
      candidates[0];
    if (nextGh) {
      const ghUrl = `https://github.com/${nextGh}`;
      try {
        const { stop, websiteUrls } = await fetchStop(ghUrl, `GitHub · ${nextGh}`);
        recordStop(stop);
        websiteUrls.forEach((w) => webSet.add(w));
      } catch (err) {
        notes.push(
          `Could not open linked GitHub repo ${nextGh}: ${
            err instanceof Error ? err.message : "timeout"
          }`
        );
      }
    }
  }

  if (stops.length < maxStops && webSet.size > 0) {
    const nextSite = Array.from(webSet).find((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase();
        return !stops.some((s) => s.url.toLowerCase().includes(h));
      } catch {
        return false;
      }
    });
    if (nextSite) {
      try {
        const hostLabel = new URL(nextSite).hostname;
        const { stop } = await fetchStop(nextSite, `Linked Site · ${hostLabel}`);
        recordStop(stop);
      } catch (err) {
        notes.push(
          `Could not open linked site ${nextSite}: ${
            err instanceof Error ? err.message : "timeout"
          }`
        );
      }
    }
  }

  for (const s of stops) {
    if (s.url.startsWith("http")) webSet.add(s.url);
  }

  return {
    stops,
    discoveredGithubRepos: Array.from(githubSet).slice(0, 5),
    discoveredXUrls: Array.from(xSet).slice(0, 5),
    discoveredSolanaAddresses: Array.from(solSet).slice(0, 5),
    discoveredEvmAddresses: Array.from(evmSet).slice(0, 5),
    discoveredWebsiteUrls: Array.from(webSet).slice(0, 5),
    totalXhrObserved: stops.reduce((sum, s) => sum + s.xhrCount, 0),
    pageErrorsCount: stops.reduce(
      (sum, s) => sum + (s.consoleErrors?.length ?? 0),
      0
    ),
    inspectedApiPayloads: stops
      .flatMap((s) => s.apiPayloads || [])
      .slice(0, 12),
    notes,
  };
}

export interface BrowserObserveOptions {
  initialUrls: Array<{ url: string; label: string }>;
  maxStops?: number;
  onFrame?: (stop: BrowserStopCapture) => void;
  onNote?: (note: string) => void;
}

/**
 * SSRF-guarded HTTP HTML & outbound entity fallback used when headless Chromium
 * or a remote CDP endpoint is unavailable (e.g. serverless deployments).
 */
export async function runHttpFallbackObservation(
  options: BrowserObserveOptions
): Promise<BrowserRunSummary> {
  const notes = [
    "No local Chromium executable or BUILDCHECK_BROWSER_WS_ENDPOINT configured; running SSRF-guarded HTTP HTML & entity fallback.",
  ];
  const summary = await executeStopPlan(options, notes, (url, label) =>
    captureHttpStop(url, label)
  );
  return {
    mode: "http-fallback",
    executableLabel: "HTTP Fallback",
    ...summary,
  };
}

/**
 * Runs a headless Chromium session (local Chromium or remote CDP) or SSRF-guarded
 * HTTP HTML fallback to inspect target pages, extract outbound repo/social claims,
 * observe XHR payloads, and emit live JPEG frames when Chromium is present.
 */
export async function runLiveBrowserObservation(
  options: BrowserObserveOptions
): Promise<BrowserRunSummary> {
  const notes: string[] = [];

  const remoteWs = process.env.BUILDCHECK_BROWSER_WS_ENDPOINT?.trim();
  const localExec = !remoteWs ? findLocalChromiumExecutable() : null;

  if (!remoteWs && !localExec) {
    return runHttpFallbackObservation(options);
  }

  let browser: Browser | null = null;
  let ownsBrowser = false;

  try {
    if (remoteWs) {
      browser = await puppeteer.connect({ browserWSEndpoint: remoteWs });
    } else if (localExec) {
      browser = await puppeteer.launch({
        executablePath: localExec.path,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--hide-scrollbars",
        ],
      });
      ownsBrowser = true;
    }

    if (!browser) {
      throw new Error("Browser initialization returned null");
    }

    const page = await openGuardedPage(browser);
    try {
      const summary = await executeStopPlan(options, notes, (url, label) =>
        captureStop(page, url, label)
      );
      return {
        mode: remoteWs ? "remote-cdp" : "local-chromium",
        executableLabel: remoteWs ? "Remote CDP Browser" : localExec?.label || "Chromium",
        ...summary,
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (browser) {
      if (ownsBrowser) {
        await browser.close().catch(() => {});
      } else {
        await browser.disconnect().catch(() => {});
      }
    }
  }
}
