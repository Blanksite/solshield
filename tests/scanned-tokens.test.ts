import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TokenScanReport } from "../src/lib/token-scanner";
import {
  clearLocalScannedTokens,
  mergeScannedTokenLists,
  readLocalScannedTokens,
  saveLocalScannedToken,
  SCANNED_TOKENS_STORAGE_KEY,
  tokenReportToSummary,
} from "../src/lib/scanned-token-types";
import {
  clearScannedTokens,
  listScannedTokens,
  recordScannedToken,
  recordScannedTokenSummary,
} from "../src/lib/scanned-tokens";

function makeSampleTokenReport(
  overrides: Partial<TokenScanReport> = {}
): TokenScanReport {
  return {
    mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenProgram: "SPL Token",
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    isToken2022: false,
    isPumpFunSuffix: false,
    verifiedAsset: null,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    rawSupply: "1000000000",
    supplyUi: 1000,
    mintAuthority: null,
    freezeAuthority: null,
    extensions: [],
    transferFeeBps: null,
    permanentDelegate: null,
    transferHookProgramId: null,
    defaultAccountState: null,
    topHolders: [],
    top5Pct: 0,
    top10Pct: 0,
    riskScore: 0,
    classification: "SAFE",
    recommendedAction: "VERIFIED_SAFE",
    executiveSummary: "Verified SPL token.",
    flags: [],
    slot: 330000000,
    latencyMs: 42,
    inferenceMode: "deterministic-fallback",
    privacyAttestation: "Zero-retention check",
    ...overrides,
  };
}

describe("Recently Scanned Tokens Ledger & Persistence", () => {
  let tempDir: string;
  let prevCacheDir: string | undefined;

  beforeEach(async () => {
    prevCacheDir = process.env.SOLSHIELD_CACHE_DIR;
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "solshield-scanned-test-")
    );
    process.env.SOLSHIELD_CACHE_DIR = tempDir;
    await clearScannedTokens();
  });

  afterEach(async () => {
    await clearScannedTokens();
    if (prevCacheDir === undefined) {
      delete process.env.SOLSHIELD_CACHE_DIR;
    } else {
      process.env.SOLSHIELD_CACHE_DIR = prevCacheDir;
    }
    delete (globalThis as Record<string, unknown>).window;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("starts empty with zero dummy tokens when nothing has been audited", async () => {
    const initial = await listScannedTokens(20);
    expect(initial).toEqual([]);
  });

  it("records audited tokens, increments scanCount on repeat audits, and keeps newest first", async () => {
    const first = makeSampleTokenReport({
      mintAddress: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
      name: "Wrapped SOL",
    });
    const second = makeSampleTokenReport({
      mintAddress: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      symbol: "PYUSD",
      name: "PayPal USD",
      tokenProgram: "Token-2022",
      isToken2022: true,
      riskScore: 15,
    });

    const entry1 = await recordScannedToken(first, "token-xray");
    expect(entry1.scanCount).toBe(1);
    expect(entry1.source).toBe("token-xray");

    await new Promise((r) => setTimeout(r, 15));
    await recordScannedToken(second, "buildcheck");

    await new Promise((r) => setTimeout(r, 15));
    const entry1Again = await recordScannedToken(first, "tx-firewall");
    expect(entry1Again.scanCount).toBe(2);
    expect(entry1Again.source).toBe("tx-firewall");

    const all = await listScannedTokens(20);
    expect(all).toHaveLength(2);
    expect(all[0].mintAddress).toBe(first.mintAddress);
    expect(all[0].scanCount).toBe(2);
    expect(all[1].mintAddress).toBe(second.mintAddress);
    expect(all[1].scanCount).toBe(1);
  });

  it("persists audited tokens to disk and reloads cleanly after in-memory reset", async () => {
    await recordScannedToken(
      makeSampleTokenReport({
        mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        verifiedAsset: {
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          symbol: "USDC",
          name: "USD Coin",
          issuer: "Circle",
          category: "REGULATED_STABLECOIN",
          custodialIssuerAuthorities: true,
          custodyNote: "Canonical Circle mint",
        },
      }),
      "token-xray"
    );

    // Simulate process restart by resetting the global in-memory ledger
    delete (globalThis as Record<string, unknown>).__solshieldScannedTokensStore;

    const reloaded = await listScannedTokens(20);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].symbol).toBe("USDC");
    expect(reloaded[0].verifiedIssuer).toBe("Circle");
  });

  it("merges local and server scanned token lists while deduplicating by mintAddress", () => {
    const older = tokenReportToSummary(
      makeSampleTokenReport({
        mintAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        symbol: "JUP",
      }),
      "token-xray",
      "2026-11-14T01:00:00.000Z"
    );
    older.scanCount = 3;

    const newerSameMint = tokenReportToSummary(
      makeSampleTokenReport({
        mintAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        symbol: "JUP",
        riskScore: 5,
      }),
      "buildcheck",
      "2026-11-14T02:00:00.000Z"
    );
    newerSameMint.scanCount = 1;

    const another = tokenReportToSummary(
      makeSampleTokenReport({
        mintAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        symbol: "BONK",
      }),
      "token-xray",
      "2026-11-14T01:30:00.000Z"
    );

    const merged = mergeScannedTokenLists([newerSameMint], [older, another], 10);
    expect(merged).toHaveLength(2);
    expect(merged[0].mintAddress).toBe("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
    expect(merged[0].source).toBe("buildcheck");
    expect(merged[0].scanCount).toBe(3);
    expect(merged[1].symbol).toBe("BONK");
  });

  it("stores, increments, and clears browser localStorage scanned tokens safely", () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    };

    expect(readLocalScannedTokens()).toEqual([]);

    const usdc = makeSampleTokenReport();
    const afterFirst = saveLocalScannedToken(usdc, "token-xray");
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].scanCount).toBe(1);

    const afterSecond = saveLocalScannedToken(usdc, "buildcheck");
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].scanCount).toBe(2);
    expect(store.has(SCANNED_TOKENS_STORAGE_KEY)).toBe(true);

    clearLocalScannedTokens();
    expect(readLocalScannedTokens()).toEqual([]);
  });

  it("picks up cross-process disk updates via mtime and syncs summary payloads", async () => {
    const initial = await listScannedTokens(20);
    expect(initial).toEqual([]);

    const externalSummary = tokenReportToSummary(
      makeSampleTokenReport({
        mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
        symbol: "SHIELD",
        name: "SolShield",
      }),
      "buildcheck",
      "2026-11-14T13:00:00.000Z"
    );

    const histPath = path.join(tempDir, "scanned-tokens_history.json");
    await new Promise((r) => setTimeout(r, 25));
    await fs.promises.writeFile(histPath, JSON.stringify([externalSummary]), "utf8");

    // Existing process memory already had loadedFromDisk=true, yet sees the external update immediately
    const reloaded = await listScannedTokens(20);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].mintAddress).toBe("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");
    expect(reloaded[0].symbol).toBe("SHIELD");

    const pushed = await recordScannedTokenSummary({
      ...externalSummary,
      scannedAt: "2026-11-14T13:05:00.000Z",
    });
    expect(pushed.scanCount).toBe(2);
  });

  it("reads and writes Vercel KV / Upstash REST commands with single JSON array encoding", async () => {
    const prevUrl = process.env.KV_REST_API_URL;
    const prevToken = process.env.KV_REST_API_TOKEN;
    const prevFetch = globalThis.fetch;
    const kvState = new Map<string, string>();
    const recordedBodies: string[] = [];

    process.env.KV_REST_API_URL = "https://example-upstash.upstash.io";
    process.env.KV_REST_API_TOKEN = "test-kv-token";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") {
        const rawBody = String(init.body || "");
        const cmd = JSON.parse(rawBody) as [string, string, string?];
        if (cmd[0] === "SET" && typeof cmd[2] === "string") {
          recordedBodies.push(rawBody);
          kvState.set(cmd[1], cmd[2]);
          return new Response(JSON.stringify({ result: "OK" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (cmd[0] === "GET") {
          return new Response(
            JSON.stringify({ result: kvState.get(cmd[1]) ?? null }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
      }
      const key = decodeURIComponent(url.split("/get/")[1] || "");
      return new Response(JSON.stringify({ result: kvState.get(key) ?? null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const entry = tokenReportToSummary(
        makeSampleTokenReport({
          mintAddress: "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx",
          symbol: "SHIELD",
          name: "SolShield",
        }),
        "buildcheck",
        "2026-11-14T13:45:00.000Z"
      );

      await recordScannedTokenSummary(entry);
      expect(recordedBodies).toHaveLength(1);
      const sentCommand = JSON.parse(recordedBodies[0]) as unknown[];
      expect(sentCommand[0]).toBe("SET");
      expect(sentCommand[1]).toBe("solshield:scanned_tokens:v1");
      expect(typeof sentCommand[2]).toBe("string");
      expect(Array.isArray(JSON.parse(sentCommand[2] as string))).toBe(true);

      // Simulate cold serverless instance reading back solely from KV
      delete (globalThis as Record<string, unknown>).__solshieldScannedTokensStore;
      await fs.promises
        .unlink(path.join(tempDir, "scanned-tokens_history.json"))
        .catch(() => undefined);

      const hydrated = await listScannedTokens(10);
      expect(hydrated).toHaveLength(1);
      expect(hydrated[0].mintAddress).toBe("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");
      expect(hydrated[0].symbol).toBe("SHIELD");
    } finally {
      globalThis.fetch = prevFetch;
      if (prevUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = prevUrl;
      if (prevToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = prevToken;
    }
  });

  it("preserves Robinhood Chain L2 & ERC-20 tokenProgram and auto-heals legacy SPL mislabels on 0x contracts", () => {
    const hoodSummary = makeSampleTokenReport({
      mintAddress: "0xb9434fE38b47F1525b7b16A57cD2b2820BABE341",
      symbol: "HOOD",
      name: "Hood Asset",
      tokenProgram: "Robinhood Chain L2" as TokenScanReport["tokenProgram"],
    });
    const converted = tokenReportToSummary(hoodSummary, "buildcheck");
    expect(converted.tokenProgram).toBe("Robinhood Chain L2");

    const legacyMislabelled = {
      ...converted,
      tokenProgram: "SPL Token" as const,
    };
    const normalized = mergeScannedTokenLists([legacyMislabelled], [], 10);
    expect(normalized[0].tokenProgram).toBe("ERC-20");
  });
});
