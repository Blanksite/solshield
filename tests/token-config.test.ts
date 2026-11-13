import { describe, it, expect } from "vitest";
import { SOLSHIELD_PROGRAM_ID } from "../src/lib/anchor-idl";
import {
  formatShortAddress,
  getSolShieldTokenConfig,
  normalizeTickerSymbol,
  validateSolanaMintAddress,
} from "../src/lib/token-config";

describe("Token Launch Config (Pre-Launch & Live CA)", () => {
  it("stays cleanly in pre-launch mode when no CA or an invalid CA is configured", () => {
    const emptyCfg = getSolShieldTokenConfig({ ca: "" });
    expect(emptyCfg.isLive).toBe(false);
    expect(emptyCfg.ca).toBe("");
    expect(emptyCfg.shortCa).toBeNull();
    expect(emptyCfg.symbol).toBe("$SHIELD");
    expect(emptyCfg.links.pumpfun).toBeNull();
    expect(emptyCfg.links.dexscreener).toBeNull();
    expect(emptyCfg.links.solscan).toBeNull();
    expect(emptyCfg.links.devnetProgram).toBe(
      `https://explorer.solana.com/address/${SOLSHIELD_PROGRAM_ID.toBase58()}?cluster=devnet`
    );

    const invalidCfg = getSolShieldTokenConfig({ ca: "not-a-valid-ca!" });
    expect(invalidCfg.isLive).toBe(false);
    expect(validateSolanaMintAddress("0OIl_invalid_chars")).toBeNull();
  });

  it("activates live CA metadata and derived links for a valid Solana Mint CA", () => {
    const validMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const liveCfg = getSolShieldTokenConfig({
      ca: `  ${validMint}  `,
      symbol: "shield",
    });

    expect(liveCfg.isLive).toBe(true);
    expect(liveCfg.ca).toBe(validMint);
    expect(liveCfg.shortCa).toBe(formatShortAddress(validMint));
    expect(liveCfg.symbol).toBe("$SHIELD");
    expect(liveCfg.tickerBare).toBe("SHIELD");
    expect(liveCfg.links.pumpfun).toBe(`https://pump.fun/coin/${validMint}`);
    expect(liveCfg.links.dexscreener).toBe(
      `https://dexscreener.com/solana/${validMint}`
    );
    expect(liveCfg.links.solscan).toBe(`https://solscan.io/token/${validMint}`);
    expect(liveCfg.links.jupiter).toBe(`https://jup.ag/tokens/${validMint}`);
    expect(normalizeTickerSymbol("$solshield")).toBe("$SOLSHIELD");
  });

  it("loads the default live SolShield CA from repository configuration", () => {
    const expectedCa = "CMYb1BRKQyJBVRkrFdATB14PM62JbULzHsgbozGs2Sqx";
    const defaultCfg = getSolShieldTokenConfig();
    expect(defaultCfg.isLive).toBe(true);
    expect(defaultCfg.ca).toBe(expectedCa);
    expect(defaultCfg.shortCa).toBe("CMYb1B...2Sqx");
    expect(defaultCfg.symbol).toBe("$SHIELD");
    expect(defaultCfg.links.pumpfun).toBe(
      `https://pump.fun/coin/${expectedCa}`
    );
  });
});
