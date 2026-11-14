import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  buildExtensionVerdict,
  inspectOffchainSignMessage,
} from "../src/lib/extension-verdict";
import { analyzeMintState } from "../src/lib/token-scanner";
import { TX_TEST_FIXTURES } from "./fixtures/tx-payloads";

function getPresetBase64(id: string): string {
  const found = TX_TEST_FIXTURES.find((p) => p.id === id);
  if (!found) throw new Error(`Preset ${id} not found`);
  return found.base64Transaction;
}

describe("M1/M2/M3 Merged Extension Verdict Engine", () => {
  it("returns SAFE for clean Jupiter swap on verified jup.ag when server verified", () => {
    const safeB64 = getPresetBase64("safe-jupiter-swap");
    const verdict = buildExtensionVerdict({
      walletMethod: "signTransaction",
      hostname: "app.jup.ag",
      base64Transactions: [safeB64],
      remote: {
        attempted: true,
        verified: true,
        timedOutOrError: null,
        veniceAudit: null,
        rpcSimulation: null,
        domainReputation: null,
      },
    });

    expect(verdict.decision).toBe("SAFE");
    expect(verdict.requiresTypedConfirmation).toBe(false);
    expect(verdict.timeoutUnverified).toBe(false);
  });

  it("returns BLOCK with requiresTypedConfirmation=true for SetAuthority drainer or typosquat", () => {
    const drainerB64 = getPresetBase64("drainer-set-authority");
    const drainVerdict = buildExtensionVerdict({
      walletMethod: "signAndSendTransaction",
      hostname: "app.jup.ag",
      base64Transactions: [drainerB64],
    });
    expect(drainVerdict.decision).toBe("BLOCK");
    expect(drainVerdict.requiresTypedConfirmation).toBe(true);

    const safeB64 = getPresetBase64("safe-jupiter-swap");
    const spoofVerdict = buildExtensionVerdict({
      walletMethod: "signTransaction",
      hostname: "jup.ag.claim-airdrop.xyz",
      base64Transactions: [safeB64],
    });
    expect(spoofVerdict.decision).toBe("BLOCK");
    expect(spoofVerdict.domainEvaluation.status).toBe("TYPOSQUAT_CRITICAL");
    expect(spoofVerdict.requiresTypedConfirmation).toBe(true);
  });

  it("never degrades silently on remote server timeout (surfaces WARNING / STRICT BLOCK)", () => {
    const safeB64 = getPresetBase64("safe-jupiter-swap");

    const warnVerdict = buildExtensionVerdict({
      walletMethod: "signTransaction",
      hostname: "brand-new-dex.xyz",
      base64Transactions: [safeB64],
      strictMode: false,
      remote: {
        attempted: true,
        verified: false,
        timedOutOrError: "AbortError: timeout",
        veniceAudit: null,
        rpcSimulation: null,
        domainReputation: null,
      },
    });

    expect(warnVerdict.timeoutUnverified).toBe(true);
    expect(warnVerdict.apiVerified).toBe(false);
    expect(warnVerdict.decision).toBe("WARNING");
    expect(warnVerdict.reasons.some((r) => r.includes("Belum terverifikasi server"))).toBe(
      true
    );

    const strictVerdict = buildExtensionVerdict({
      walletMethod: "signTransaction",
      hostname: "brand-new-dex.xyz",
      base64Transactions: [safeB64],
      strictMode: true,
      remote: {
        attempted: true,
        verified: false,
        timedOutOrError: "AbortError: timeout",
        veniceAudit: null,
        rpcSimulation: null,
        domainReputation: null,
      },
    });
    expect(strictVerdict.decision).toBe("BLOCK");
    expect(strictVerdict.requiresTypedConfirmation).toBe(true);
  });

  it("flags large signAllTransactions batch requests and suspicious off-chain signMessage payloads", () => {
    const safeB64 = getPresetBase64("safe-jupiter-swap");
    const batchVerdict = buildExtensionVerdict({
      walletMethod: "signAllTransactions",
      hostname: "app.jup.ag",
      base64Transactions: [safeB64, safeB64, safeB64, safeB64, safeB64],
    });
    expect(batchVerdict.txCount).toBe(5);
    expect(batchVerdict.decision).not.toBe("SAFE");

    const msgInspect = inspectOffchainSignMessage(
      new TextEncoder().encode("Authorize drain & SetAuthority allocation now")
    );
    expect(msgInspect.isSuspicious).toBe(true);

    const opaqueBinary = new Uint8Array(80).fill(2);
    const binaryInspect = inspectOffchainSignMessage(opaqueBinary);
    expect(binaryInspect.looksLikeRawTransaction).toBe(true);
    expect(binaryInspect.isSuspicious).toBe(true);

    const spoofSiwsVerdict = buildExtensionVerdict({
      walletMethod: "signIn",
      hostname: "evil-claim.xyz",
      signInInput: {
        domain: "app.jup.ag",
        statement: "Authorize claim airdrop",
      },
    });
    expect(spoofSiwsVerdict.decision).toBe("BLOCK");
    expect(spoofSiwsVerdict.riskScore).toBeGreaterThanOrEqual(92);
    expect(spoofSiwsVerdict.requiresTypedConfirmation).toBe(true);
  });

  it("allows swaps touching canonical USDC while blocking spoofed USDC mints", () => {
    const safeB64 = getPresetBase64("safe-jupiter-swap");

    const usdcAudit = analyzeMintState({
      mint: {
        address: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        mintAuthority: new PublicKey("BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG"),
        supply: BigInt(5_000_000_000) * BigInt(1_000_000),
        decimals: 6,
        isInitialized: true,
        freezeAuthority: new PublicKey("7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar"),
        tlvData: Buffer.alloc(0),
      },
      programOwner: TOKEN_PROGRAM_ID.toBase58(),
      largestAccounts: [],
      slot: 329000010,
      metadata: { name: "USD Coin", symbol: "USDC" },
    });

    const canonicalSwapVerdict = buildExtensionVerdict({
      walletMethod: "signTransaction",
      hostname: "app.jup.ag",
      base64Transactions: [safeB64],
      remote: {
        attempted: true,
        verified: true,
        timedOutOrError: null,
        veniceAudit: null,
        domainReputation: null,
        rpcSimulation: {
          status: "SIMULATED_OK",
          network: "mainnet",
          rpcError: null,
          unitsConsumed: 52000,
          balanceDiffs: [],
          authorityChanges: [],
          hiddenCpiPrograms: [],
          discoveredMints: [usdcAudit.mintAddress],
          tokenAudits: [usdcAudit],
          logsPreview: [],
        },
      },
    });

    expect(canonicalSwapVerdict.decision).toBe("SAFE");
    expect(canonicalSwapVerdict.requiresTypedConfirmation).toBe(false);

    const fakeUsdcAudit = analyzeMintState({
      mint: {
        address: new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
        mintAuthority: new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
        supply: BigInt(1_000_000_000) * BigInt(1_000_000),
        decimals: 6,
        isInitialized: true,
        freezeAuthority: new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
        tlvData: Buffer.alloc(0),
      },
      programOwner: TOKEN_PROGRAM_ID.toBase58(),
      largestAccounts: [],
      slot: 329000011,
      metadata: { name: "USD Coin", symbol: "USDC" },
    });

    const spoofSwapVerdict = buildExtensionVerdict({
      walletMethod: "signTransaction",
      hostname: "app.jup.ag",
      base64Transactions: [safeB64],
      remote: {
        attempted: true,
        verified: true,
        timedOutOrError: null,
        veniceAudit: null,
        domainReputation: null,
        rpcSimulation: {
          status: "SIMULATED_OK",
          network: "mainnet",
          rpcError: null,
          unitsConsumed: 52000,
          balanceDiffs: [],
          authorityChanges: [],
          hiddenCpiPrograms: [],
          discoveredMints: [fakeUsdcAudit.mintAddress],
          tokenAudits: [fakeUsdcAudit],
          logsPreview: [],
        },
      },
    });

    expect(spoofSwapVerdict.decision).toBe("BLOCK");
  });
});
