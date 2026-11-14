import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { extractEntitiesFromText } from "./input-parser";
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

export interface BrowserObserveOptions {
  initialUrls: Array<{ url: string; label: string }>;
  maxStops?: number;
  onFrame?: (stop: BrowserStopCapture) => void;
  onNote?: (note: string) => void;
}

/**
 * Runs a real headless Chromium session (local Chromium or remote CDP) to render
 * target sites, track outbound claims/links, observe XHR traffic, and emit live JPEG frames.
 */
export async function runLiveBrowserObservation(
  options: BrowserObserveOptions
): Promise<BrowserRunSummary> {
  const maxStops = options.maxStops ?? 2;
  const stops: BrowserStopCapture[] = [];
  const githubSet = new Set<string>();
  const xSet = new Set<string>();
  const solSet = new Set<string>();
  const webSet = new Set<string>();
  const notes: string[] = [];

  const remoteWs = process.env.BUILDCHECK_BROWSER_WS_ENDPOINT?.trim();
  const localExec = !remoteWs ? findLocalChromiumExecutable() : null;

  if (!remoteWs && !localExec) {
    notes.push(
      "No local Chromium executable or BUILDCHECK_BROWSER_WS_ENDPOINT configured; falling back to API/HTTP collectors."
    );
    return {
      mode: "http-fallback",
      executableLabel: "HTTP Fallback",
      stops,
      discoveredGithubRepos: [],
      discoveredXUrls: [],
      discoveredSolanaAddresses: [],
      discoveredWebsiteUrls: [],
      totalXhrObserved: 0,
      notes,
    };
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

    for (let i = 0; i < Math.min(options.initialUrls.length, maxStops); i += 1) {
      const target = options.initialUrls[i];
      try {
        const { stop, websiteUrls } = await captureStop(page, target.url, target.label);
        stops.push(stop);
        stop.outboundGithub.forEach((g) => githubSet.add(g));
        stop.outboundX.forEach((x) => xSet.add(x));
        stop.outboundSolanaAddresses.forEach((s) => solSet.add(s));
        websiteUrls.forEach((w) => webSet.add(w));
        options.onFrame?.(stop);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Browser stop failed";
        notes.push(`Skipped ${target.url}: ${msg}`);
        options.onNote?.(msg);
      }
    }

    // Opportunistically follow newly discovered GitHub repo or linked project site if under cap
    if (stops.length < maxStops && githubSet.size > 0) {
      const thirdPartyCampaignRepos = new Set([
        "veniceai/builtinvenice",
        "vercel/next.js",
        "solana-labs/solana",
      ]);
      const candidates = Array.from(githubSet).filter(
        (repo) => !stops.some((s) => s.url.toLowerCase().includes(repo.toLowerCase()))
      );
      const nextGh =
        candidates.find((r) => !thirdPartyCampaignRepos.has(r.toLowerCase())) ||
        candidates[0];
      if (nextGh) {
        const ghUrl = `https://github.com/${nextGh}`;
        try {
          const { stop, websiteUrls } = await captureStop(page, ghUrl, `GitHub · ${nextGh}`);
          stops.push(stop);
          websiteUrls.forEach((w) => webSet.add(w));
          options.onFrame?.(stop);
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
          const { stop } = await captureStop(page, nextSite, `Linked Site · ${hostLabel}`);
          stops.push(stop);
          options.onFrame?.(stop);
        } catch (err) {
          notes.push(
            `Could not open linked site ${nextSite}: ${
              err instanceof Error ? err.message : "timeout"
            }`
          );
        }
      }
    }

    await page.close().catch(() => {});

    for (const s of stops) {
      if (s.url.startsWith("http")) webSet.add(s.url);
    }

    return {
      mode: remoteWs ? "remote-cdp" : "local-chromium",
      executableLabel: remoteWs ? "Remote CDP Browser" : localExec?.label || "Chromium",
      stops,
      discoveredGithubRepos: Array.from(githubSet).slice(0, 5),
      discoveredXUrls: Array.from(xSet).slice(0, 5),
      discoveredSolanaAddresses: Array.from(solSet).slice(0, 5),
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
