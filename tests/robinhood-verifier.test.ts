import { describe, it, expect } from "vitest";
import {
  verifyRobinhoodStatus,
  ROBINHOOD_OFFICIAL_ASSETS,
  ROBINHOOD_CHAIN_CONFIG,
} from "../src/lib/buildcheck/robinhood-verifier";
import { parseBuildCheckInput } from "../src/lib/buildcheck/input-parser";

describe("Robinhood Token Forensics & Verifier", () => {
  it("correctly identifies official Solana listings (BONK and WIF)", async () => {
    const bonk = await verifyRobinhoodStatus({
      address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      symbol: "BONK",
      name: "Bonk",
    });

    expect(bonk.status).toBe("OFFICIAL_LISTED");
    expect(bonk.isListedOnRobinhood).toBe(true);
    expect(bonk.tradingPair).toBe("BONK-USD");
    expect(bonk.impostorRiskScore).toBe(0);
    expect(bonk.officialChain).toBe("solana");

    const wif = await verifyRobinhoodStatus({
      address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
      symbol: "WIF",
      name: "dogwifhat",
    });

    expect(wif.status).toBe("OFFICIAL_LISTED");
    expect(wif.isListedOnRobinhood).toBe(true);
    expect(wif.tradingPair).toBe("WIF-USD");
  });

  it("correctly identifies official EVM listings (PEPE and SHIB)", async () => {
    const pepe = await verifyRobinhoodStatus({
      address: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
      symbol: "PEPE",
      name: "Pepe",
      chainFamily: "evm",
    });

    expect(pepe.status).toBe("OFFICIAL_LISTED");
    expect(pepe.isListedOnRobinhood).toBe(true);
    expect(pepe.tradingPair).toBe("PEPE-USD");
    expect(pepe.impostorRiskScore).toBe(0);
    expect(pepe.officialChain).toBe("ethereum");

    const shib = await verifyRobinhoodStatus({
      address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
      symbol: "SHIB",
      name: "Shiba Inu",
      chainFamily: "evm",
    });

    expect(shib.status).toBe("OFFICIAL_LISTED");
    expect(shib.isListedOnRobinhood).toBe(true);
    expect(shib.tradingPair).toBe("SHIB-USD");
  });

  it("triggers CRITICAL IMPOSTOR ALERT for tokens falsely claiming Robinhood brand or HOOD ticker", async () => {
    const fakeHood = await verifyRobinhoodStatus({
      address: "FakeMintAddress11111111111111111111111111111",
      symbol: "HOOD",
      name: "Robinhood Meme Token",
      metadataText: "Official Robinhood token on Solana",
    });

    expect(fakeHood.status).toBe("IMPOSTOR_ALERT");
    expect(fakeHood.isListedOnRobinhood).toBe(false);
    expect(fakeHood.impostorRiskScore).toBe(95);
    expect(fakeHood.warning).toContain("CRITICAL IMPOSTOR ALERT");
    expect(fakeHood.warning).toContain("Robinhood (NASDAQ: HOOD) has NOT issued a decentralized meme token");
  });

  it("triggers LOOKALIKE WARNING when an unverified token steals an official Robinhood ticker", async () => {
    const fakePepe = await verifyRobinhoodStatus({
      address: "FakePepeAddress22222222222222222222222222222",
      symbol: "PEPE",
      name: "Pepe The Frog",
    });

    expect(fakePepe.status).toBe("TICKER_CLONE_WARNING");
    expect(fakePepe.isListedOnRobinhood).toBe(false);
    expect(fakePepe.impostorRiskScore).toBe(75);
    expect(fakePepe.officialContract).toBe("0x6982508145454ce325ddbe47a25d4ec3d2311933");
    expect(fakePepe.warning).toContain("LOOKALIKE WARNING");
  });

  it("classifies standard unlisted token as NOT_LISTED with zero risk penalty", async () => {
    const randomCleanToken = await verifyRobinhoodStatus({
      address: "RandomCleanTokenAddress333333333333333333333",
      symbol: "CLEAN",
      name: "Clean Token Protocol",
    });

    expect(randomCleanToken.status).toBe("NOT_LISTED");
    expect(randomCleanToken.isListedOnRobinhood).toBe(false);
    expect(randomCleanToken.impostorRiskScore).toBe(0);
    expect(randomCleanToken.warning).toBeUndefined();
  });

  it("verifies Robinhood Chain L2 configuration parameters", () => {
    expect(ROBINHOOD_CHAIN_CONFIG.chainId).toBe(4663);
    expect(ROBINHOOD_CHAIN_CONFIG.hexChainId).toBe("0x1237");
    expect(ROBINHOOD_CHAIN_CONFIG.rpcUrl).toBe("https://rpc.mainnet.chain.robinhood.com");
    expect(ROBINHOOD_CHAIN_CONFIG.explorerUrl).toBe("https://robinhoodchain.blockscout.com");
  });

  it("parses EVM 0x contract addresses in parseBuildCheckInput", () => {
    const parsed = parseBuildCheckInput("0x6982508145454ce325ddbe47a25d4ec3d2311933");
    expect(parsed.kind).toBe("evm_contract");
    expect(parsed.chainFamily).toBe("evm");
    expect(parsed.contractAddress).toBe("0x6982508145454ce325ddbe47a25d4ec3d2311933");
  });

  it("parses Robinhood Chain Blockscout URLs in parseBuildCheckInput", () => {
    const parsed = parseBuildCheckInput(
      "https://robinhoodchain.blockscout.com/address/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    );
    expect(parsed.kind).toBe("evm_contract");
    expect(parsed.chainFamily).toBe("evm");
    expect(parsed.contractAddress).toBe("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    expect(parsed.hostname).toBe("robinhoodchain.blockscout.com");
  });
});
