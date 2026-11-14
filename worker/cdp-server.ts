import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { findLocalChromiumExecutable } from "../src/lib/buildcheck/browser-agent";
import { loadLocalEnvFiles } from "./env-loader";

loadLocalEnvFiles();

const CDP_HOST = process.env.CDP_HOST?.trim() || "127.0.0.1";
const CDP_PORT = Number(process.env.CDP_PORT || "3001") || 3001;
const CDP_AUTH_TOKEN = process.env.CDP_AUTH_TOKEN?.trim() || "";

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function timingSafeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractRequestToken(req: http.IncomingMessage): string {
  const authHeader = req.headers.authorization || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  try {
    const parsed = new URL(req.url || "/", "http://localhost");
    return parsed.searchParams.get("token")?.trim() || "";
  } catch {
    return "";
  }
}

async function launchBackingBrowser(): Promise<Browser> {
  const exec = findLocalChromiumExecutable();
  if (!exec) {
    throw new Error("No local Chromium executable found for CDP server.");
  }

  const browser = await puppeteer.launch({
    executablePath: exec.path,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
    ],
  });
  console.log(`[CDP Server] Backing Chromium ready (${exec.label})`);
  return browser;
}

async function main(): Promise<void> {
  if (!isLoopbackHost(CDP_HOST) && !CDP_AUTH_TOKEN) {
    console.error(
      "[CDP Server] Refusing to bind non-loopback address without CDP_AUTH_TOKEN set!"
    );
    process.exit(1);
  }

  let browser = await launchBackingBrowser();

  const ensureBrowser = async (): Promise<Browser> => {
    if (!browser.connected) {
      console.warn("[CDP Server] Backing Chromium disconnected; relaunching...");
      browser = await launchBackingBrowser();
    }
    return browser;
  };

  browser.on("disconnected", () => {
    console.warn("[CDP Server] Chromium process closed; will relaunch on demand.");
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          connected: browser.connected,
        })
      );
      return;
    }

    res.writeHead(426, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: "Connect via WebSocket for Chromium CDP.",
      })
    );
  });

  server.on("upgrade", async (req, clientSocket, head) => {
    if (CDP_AUTH_TOKEN) {
      const provided = extractRequestToken(req);
      if (!provided || !timingSafeMatch(provided, CDP_AUTH_TOKEN)) {
        clientSocket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        clientSocket.destroy();
        return;
      }
    }

    try {
      const activeBrowser = await ensureBrowser();
      const internalWsUrl = new URL(activeBrowser.wsEndpoint());
      const upstreamPort = Number(internalWsUrl.port);
      const upstreamPath = internalWsUrl.pathname;

      const upstreamSocket = net.connect(upstreamPort, "127.0.0.1", () => {
        const wsHeaders = [
          `GET ${upstreamPath} HTTP/1.1`,
          `Host: 127.0.0.1:${upstreamPort}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${req.headers["sec-websocket-key"] || ""}`,
          `Sec-WebSocket-Version: ${req.headers["sec-websocket-version"] || "13"}`,
        ];
        if (req.headers["sec-websocket-extensions"]) {
          wsHeaders.push(
            `Sec-WebSocket-Extensions: ${req.headers["sec-websocket-extensions"]}`
          );
        }
        upstreamSocket.write(`${wsHeaders.join("\r\n")}\r\n\r\n`);
        if (head.length > 0) upstreamSocket.write(head);

        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      });

      upstreamSocket.on("error", () => {
        clientSocket.destroy();
      });
      clientSocket.on("error", () => {
        upstreamSocket.destroy();
      });
    } catch (err) {
      console.error("[CDP Upgrade Error]", err);
      clientSocket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      clientSocket.destroy();
    }
  });

  const shutdown = async () => {
    console.log("\n[CDP Server] Shutting down...");
    server.close();
    if (browser.connected) {
      await browser.close().catch(() => {});
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(CDP_PORT, CDP_HOST, () => {
    console.log(`[CDP Server] Listening at ws://${CDP_HOST}:${CDP_PORT}`);
    console.log(
      `[CDP Server] Auth: ${CDP_AUTH_TOKEN ? "Token protected (?token=***)" : "Local loopback unauthenticated"}`
    );
  });
}

main().catch((err) => {
  console.error("[CDP Server Fatal]", err);
  process.exit(1);
});
