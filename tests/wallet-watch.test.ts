import { describe, expect, it } from "vitest";
import { compactReportForLocalCache } from "../src/lib/buildcheck/local-report-cache";
import { compactBuildCheckReportWithinBudget } from "../src/lib/buildcheck/report-store";
import {
  analyzeEvmTransferLogsForWalletsToWatch,
  buildSolanaWalletsToWatch,
  type RawEvmTransferLog,
} from "../src/lib/buildcheck/wallet-watch";
import { buildDeterministicBuildCheck } from "../src/lib/buildcheck/venice-buildcheck";
import { normalizeWatchedAddress } from "../src/lib/wallet-watch-tracker";
import {
  getChainDisplayName,
  getWatchedWalletExplorerUrl,
  makeWatchedWalletId,
  normalizeWatchedAddressClient,
} from "../src/lib/wallet-watch-client";

function padAddr(addr: string): string {
  return `0x${addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function encodeUint256(val: bigint): string {
  return `0x${val.toString(16).padStart(64, "0")}`;
}

describe("SolShield Wallets to Watch Forensics Engine", () => {
  it("reconstructs EVM ERC-20 transfers to detect Early Buyers, Possible MMs, and Same-Block Bundles", () => {
    const token = "0xda4283f14b487034b90d865aac489994f2c680c4";
    const zero = "0x0000000000000000000000000000000000000000";
    const creator = "0x9db7a7d4a7a2e737fc18d2c4eb7f7a61602bc68f";
    const pool = "0xfcd0c0cd1a1b71e0969fd66957138b272276a4f3";
    const earlyDiamond = "0x1111111111111111111111111111111111111111";
    const bundleA = "0x2222222222222222222222222222222222222222";
    const bundleB = "0x3333333333333333333333333333333333333333";
    const bundleC = "0x5555555555555555555555555555555555555555";
    const mmWallet = "0x4444444444444444444444444444444444444444";
    const routerContract = "0x6666666666666666666666666666666666666666";

    const supply = BigInt("1000000000000000000000"); // 1000 * 1e18

    const logs: RawEvmTransferLog[] = [
      // Mint 1000 tokens to creator at blk 1000
      {
        blockNumber: "0x3e8",
        topics: ["0xddf", padAddr(zero), padAddr(creator)],
        data: encodeUint256(supply),
      },
      // Add 900 to LP pool at blk 1001
      {
        blockNumber: "0x3e9",
        topics: ["0xddf", padAddr(creator), padAddr(pool)],
        data: encodeUint256(BigInt("900000000000000000000")),
      },
      // Early Buyer holds 30 tokens (+2 blk)
      {
        blockNumber: "0x3ea",
        topics: ["0xddf", padAddr(pool), padAddr(earlyDiamond)],
        data: encodeUint256(BigInt("30000000000000000000")),
      },
      // Three wallets buy in identical block 1004 (same-block bundle on L2)
      {
        blockNumber: "0x3ec",
        topics: ["0xddf", padAddr(pool), padAddr(bundleA)],
        data: encodeUint256(BigInt("25000000000000000000")),
      },
      {
        blockNumber: "0x3ec",
        topics: ["0xddf", padAddr(pool), padAddr(bundleB)],
        data: encodeUint256(BigInt("25000000000000000000")),
      },
      {
        blockNumber: "0x3ec",
        topics: ["0xddf", padAddr(pool), padAddr(bundleC)],
        data: encodeUint256(BigInt("25000000000000000000")),
      },
      // Possible MM performs repeated two-way buys and sells across blocks (3B / 3S)
      {
        blockNumber: "0x450",
        topics: ["0xddf", padAddr(pool), padAddr(mmWallet)],
        data: encodeUint256(BigInt("40000000000000000000")),
      },
      {
        blockNumber: "0x452",
        topics: ["0xddf", padAddr(mmWallet), padAddr(pool)],
        data: encodeUint256(BigInt("20000000000000000000")),
      },
      {
        blockNumber: "0x455",
        topics: ["0xddf", padAddr(pool), padAddr(mmWallet)],
        data: encodeUint256(BigInt("35000000000000000000")),
      },
      {
        blockNumber: "0x458",
        topics: ["0xddf", padAddr(mmWallet), padAddr(pool)],
        data: encodeUint256(BigInt("38000000000000000000")),
      },
      {
        blockNumber: "0x460",
        topics: ["0xddf", padAddr(pool), padAddr(mmWallet)],
        data: encodeUint256(BigInt("25000000000000000000")),
      },
      {
        blockNumber: "0x462",
        topics: ["0xddf", padAddr(mmWallet), padAddr(pool)],
        data: encodeUint256(BigInt("22000000000000000000")),
      },
      // Smart-contract router should NOT be misclassified as Possible MM or early buyer
      {
        blockNumber: "0x463",
        topics: ["0xddf", padAddr(pool), padAddr(routerContract)],
        data: encodeUint256(BigInt("10000000000000000000")),
      },
      {
        blockNumber: "0x464",
        topics: ["0xddf", padAddr(routerContract), padAddr(pool)],
        data: encodeUint256(BigInt("10000000000000000000")),
      },
      {
        blockNumber: "0x465",
        topics: ["0xddf", padAddr(pool), padAddr(routerContract)],
        data: encodeUint256(BigInt("10000000000000000000")),
      },
      {
        blockNumber: "0x466",
        topics: ["0xddf", padAddr(routerContract), padAddr(pool)],
        data: encodeUint256(BigInt("10000000000000000000")),
      },
      {
        blockNumber: "0x467",
        topics: ["0xddf", padAddr(pool), padAddr(routerContract)],
        data: encodeUint256(BigInt("10000000000000000000")),
      },
      {
        blockNumber: "0x468",
        topics: ["0xddf", padAddr(routerContract), padAddr(pool)],
        data: encodeUint256(BigInt("10000000000000000000")),
      },
    ];

    const res = analyzeEvmTransferLogsForWalletsToWatch({
      chainKey: "robinhood",
      tokenAddress: token,
      logs,
      totalSupplyRaw: supply,
      pairAddress: pool,
      creatorAddress: creator,
      contractAddresses: { [routerContract]: true },
    });

    expect(res.launchBlock).toBe(1000);
    expect(res.possibleMmCount).toBe(1);
    expect(res.earlyBuyersCount).toBeGreaterThanOrEqual(1);
    expect(res.clusters.length).toBe(1);
    expect(res.clusters[0].slot).toBe(1004);
    expect(res.walletsToWatch.some((w) => w.address === routerContract)).toBe(false);

    const mm = res.walletsToWatch.find((w) => w.address === mmWallet);
    expect(mm).toBeDefined();
    expect(mm?.category).toBe("possible_mm");
    expect(mm?.buyCount).toBe(3);
    expect(mm?.sellCount).toBe(3);

    const early = res.walletsToWatch.find((w) => w.address === earlyDiamond);
    expect(early).toBeDefined();
    expect(early?.category).toBe("early_buyer");
    expect(early?.entryOffset).toBe(2);
    expect(early?.holdingPct).toBeCloseTo(3, 1);

    const cabalA = res.walletsToWatch.find((w) => w.address === bundleA);
    expect(cabalA?.category).toBe("cabal_linked");
  });

  it("classifies Solana holders and recent pool two-way swappers accurately", () => {
    const res = buildSolanaWalletsToWatch({
      devAddress: "Dev11111111111111111111111111111111111111111",
      tracedNodes: [
        {
          address: "Cab11111111111111111111111111111111111111111",
          tokenAccount: "Ata1",
          pct: 4.5,
          uiAmount: 45_000_000,
          role: "cabal",
          funder: "Funder99999999999999999999999999999999999999",
          firstSlot: 400_005,
          isFresh: true,
          txCount: 12,
        },
        {
          address: "Snip1111111111111111111111111111111111111111",
          tokenAccount: "Ata2",
          pct: 3.1,
          uiAmount: 31_000_000,
          role: "sniper",
          funder: null,
          firstSlot: 400_002,
          isFresh: true,
          txCount: 8,
        },
        {
          address: "BotMM111111111111111111111111111111111111111",
          tokenAccount: "Ata3",
          pct: 2.2,
          uiAmount: 22_000_000,
          role: "retail",
          funder: null,
          firstSlot: 400_250,
          isFresh: false,
          txCount: 60,
        },
      ],
      swapActivityByWallet: {
        BotMM111111111111111111111111111111111111111: {
          address: "BotMM111111111111111111111111111111111111111",
          buyCount: 4,
          sellCount: 3,
          earliestSlot: 400_900,
        },
        ActiveMM222222222222222222222222222222222222: {
          address: "ActiveMM222222222222222222222222222222222222",
          buyCount: 2,
          sellCount: 2,
          earliestSlot: 400_920,
        },
      },
    });

    expect(res.possibleMmCount).toBe(2);
    expect(res.earlyBuyersCount).toBe(1);
    expect(res.walletsToWatch.find((w) => w.address.startsWith("Cab"))?.category).toBe(
      "cabal_linked"
    );
    expect(res.walletsToWatch.find((w) => w.address.startsWith("Snip"))?.category).toBe(
      "early_buyer"
    );
    expect(res.walletsToWatch.find((w) => w.address.startsWith("BotMM"))?.category).toBe(
      "possible_mm"
    );
    expect(res.walletsToWatch.find((w) => w.address.startsWith("ActiveMM"))?.category).toBe(
      "possible_mm"
    );
  });

  it("validates Solana & EVM wallet addresses and formats chain explorer links cleanly", () => {
    const solNorm = normalizeWatchedAddress("CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx");
    expect(solNorm.valid).toBe(true);
    expect(solNorm.chain).toBe("solana");

    const evmNorm = normalizeWatchedAddressClient(
      "0x9dB7A7D4a7A2E737FC18d2c4EB7F7A61602Bc68F",
      "base"
    );
    expect(evmNorm.valid).toBe(true);
    expect(evmNorm.chain).toBe("base");
    expect(evmNorm.address).toBe("0x9db7a7d4a7a2e737fc18d2c4eb7f7a61602bc68f");
    expect(makeWatchedWalletId(evmNorm.address, evmNorm.chain)).toBe(
      "base:0x9db7a7d4a7a2e737fc18d2c4eb7f7a61602bc68f"
    );
    expect(getChainDisplayName("robinhood")).toBe("Robinhood L2");
    expect(getWatchedWalletExplorerUrl(evmNorm.address, "base")).toBe(
      "https://basescan.org/address/0x9db7a7d4a7a2e737fc18d2c4eb7f7a61602bc68f"
    );

    expect(normalizeWatchedAddress("not-a-valid-wallet").valid).toBe(false);
  });

  it("preserves walletsToWatch cleanly across Redis permalink and local cache compaction", () => {
    const baseReport = buildDeterministicBuildCheck({
      id: "bc_watch_test_1",
      createdAt: new Date().toISOString(),
      elapsedMs: 500,
      target: {
        rawInput: "0xda4283f14b487034b90d865aac489994f2c680c4",
        kind: "token_ca",
        mintAddress: "0xda4283f14b487034b90d865aac489994f2c680c4",
      },
      browser: {
        mode: "http-fallback",
        executableLabel: "HTTP",
        stops: [],
        discoveredGithubRepos: [],
        discoveredXUrls: [],
        discoveredSolanaAddresses: [],
        discoveredWebsiteUrls: [],
        totalXhrObserved: 0,
        notes: [],
      },
      github: null,
      chain: {
        mintAddress: "0xda4283f14b487034b90d865aac489994f2c680c4",
        tokenReport: null,
        dexPair: null,
        accountRecentTxCount: null,
        deep: {
          metadata: {
            name: "Archivum",
            symbol: "ARCH",
            description: null,
            imageUrl: null,
            websites: [],
            twitterUrl: null,
            telegramUrl: null,
            launchpad: "Robinhood Chain L2",
            createdAt: null,
          },
          market: {
            poolAddress: null,
            dexId: null,
            priceUsd: null,
            marketCapUsd: null,
            fdvUsd: null,
            liquidityUsd: 0,
            volume24hUsd: 0,
            priceChange5m: null,
            priceChange1h: null,
            priceChange6h: null,
            priceChange24h: null,
            buys1h: null,
            sells1h: null,
            buys24h: null,
            sells24h: null,
            lpLockedPct: null,
            lpLockedUsd: null,
          },
          holders: {
            score: 85,
            verdict: "OK",
            totalHolders: 120,
            distribution: {
              insidersPct: 0,
              snipersPct: 3,
              burnedOrLockedPct: 0,
              devPct: 1,
              retailPct: 96,
            },
            clusters: [],
            nodes: [],
            checks: [],
            flagsCount: 0,
            watchCount: 1,
            clearCount: 2,
            notes: [],
            walletsToWatch: [
              {
                address: "0x4444444444444444444444444444444444444444",
                chainFamily: "evm",
                chainKey: "robinhood",
                category: "possible_mm",
                tags: ["Possible MM (4B/4S)"],
                holdingPct: 1.5,
                buyCount: 4,
                sellCount: 4,
                confidence: "MEDIUM",
                reason: "Two-way swap cycling detected",
                explorerUrl:
                  "https://robinhoodchain.blockscout.com/address/0x4444444444444444444444444444444444444444",
              },
            ],
            earlyBuyersCount: 0,
            possibleMmCount: 1,
          },
          devHistory: {
            devAddress: null,
            solBalance: null,
            tokenHoldingPct: 0,
            coinsLaunchedCount: 0,
            flaggedCoinsCount: 0,
            launchedTokens: [],
            recentTxs: [],
          },
        },
      },
      domain: null,
      xPost: null,
    });

    const fullReport = {
      ...baseReport,
      inferenceMode: "deterministic-fallback" as const,
      modelsUsed: [],
      visionSummary: null,
    };

    const redisCompact = compactBuildCheckReportWithinBudget(fullReport);
    const localCompact = compactReportForLocalCache(fullReport);

    expect(redisCompact.chain?.deep?.holders.walletsToWatch).toHaveLength(1);
    expect(localCompact.chain?.deep?.holders.walletsToWatch?.[0]?.category).toBe(
      "possible_mm"
    );
  });
});
