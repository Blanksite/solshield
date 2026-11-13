import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  Mint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransferFeeConfigLayout,
  PermanentDelegateLayout,
  TransferHookLayout,
} from "@solana/spl-token";
import {
  analyzeMintState,
  parseMetaplexMetadataNameSymbol,
} from "../src/lib/token-scanner";

const SAMPLE_MINT_PUMP = new PublicKey(
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
);
const SAMPLE_AUTH = new PublicKey(
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
);
const SAMPLE_HOOK = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);

function buildTlvEntry(type: ExtensionType, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

describe("SolShield SPL & Token-2022 Audit Engine", () => {
  it("marks a revoked-authority SPL Mint with distributed holders as SAFE", () => {
    const cleanMint: Mint = {
      address: SAMPLE_MINT_PUMP,
      mintAuthority: null,
      supply: BigInt(1_000_000_000) * BigInt(1_000_000),
      decimals: 6,
      isInitialized: true,
      freezeAuthority: null,
      tlvData: Buffer.alloc(0),
    };

    const report = analyzeMintState({
      mint: cleanMint,
      programOwner: TOKEN_PROGRAM_ID.toBase58(),
      largestAccounts: [
        { address: "Pool111111111111111111111111111111111111111", uiAmount: 120_000_000 },
        { address: "Hold222222222222222222222222222222222222222", uiAmount: 50_000_000 },
        { address: "Hold333333333333333333333333333333333333333", uiAmount: 40_000_000 },
      ],
      slot: 328500111,
      metadata: { name: "Safe Token", symbol: "SAFE" },
    });

    expect(report.classification).toBe("SAFE");
    expect(report.recommendedAction).toBe("VERIFIED_SAFE");
    expect(report.riskScore).toBe(0);
    expect(report.mintAuthority).toBeNull();
    expect(report.freezeAuthority).toBeNull();
    expect(report.top5Pct).toBe(21);
    expect(report.name).toBe("Safe Token");
    expect(report.symbol).toBe("SAFE");
  });

  it("flags active Mint Authority and Freeze Authority as CRITICAL rug risk", () => {
    const riskyMint: Mint = {
      address: SAMPLE_MINT_PUMP,
      mintAuthority: SAMPLE_AUTH,
      supply: BigInt(1_000_000) * BigInt(1_000_000),
      decimals: 6,
      isInitialized: true,
      freezeAuthority: SAMPLE_AUTH,
      tlvData: Buffer.alloc(0),
    };

    const report = analyzeMintState({
      mint: riskyMint,
      programOwner: TOKEN_PROGRAM_ID.toBase58(),
    });

    expect(report.classification).toBe("CRITICAL");
    expect(report.recommendedAction).toBe("HIGH_RUG_RISK");
    expect(report.riskScore).toBeGreaterThanOrEqual(75);
    expect(report.flags.some((f) => f.code === "MINT_AUTHORITY_ACTIVE")).toBe(
      true
    );
    expect(report.flags.some((f) => f.code === "FREEZE_AUTHORITY_ACTIVE")).toBe(
      true
    );
  });

  it("extracts Token-2022 PermanentDelegate, TransferHook, and TransferFeeConfig from TLV buffer", () => {
    const feeBuf = Buffer.alloc(TransferFeeConfigLayout.span);
    TransferFeeConfigLayout.encode(
      {
        transferFeeConfigAuthority: SAMPLE_AUTH,
        withdrawWithheldAuthority: SAMPLE_AUTH,
        withheldAmount: BigInt(0),
        olderTransferFee: {
          epoch: BigInt(0),
          maximumFee: BigInt(1_000_000_000),
          transferFeeBasisPoints: 1000,
        },
        newerTransferFee: {
          epoch: BigInt(0),
          maximumFee: BigInt(1_000_000_000),
          transferFeeBasisPoints: 1000, // 10%
        },
      },
      feeBuf
    );

    const permBuf = Buffer.alloc(PermanentDelegateLayout.span);
    PermanentDelegateLayout.encode({ delegate: SAMPLE_AUTH }, permBuf);

    const hookBuf = Buffer.alloc(TransferHookLayout.span);
    TransferHookLayout.encode(
      { authority: SAMPLE_AUTH, programId: SAMPLE_HOOK },
      hookBuf
    );

    const tlvData = Buffer.concat([
      buildTlvEntry(ExtensionType.TransferFeeConfig, feeBuf),
      buildTlvEntry(ExtensionType.PermanentDelegate, permBuf),
      buildTlvEntry(ExtensionType.TransferHook, hookBuf),
    ]);

    const extMint: Mint = {
      address: SAMPLE_MINT_PUMP,
      mintAuthority: null,
      supply: BigInt(1_000_000_000) * BigInt(1_000_000),
      decimals: 6,
      isInitialized: true,
      freezeAuthority: null,
      tlvData,
    };

    const report = analyzeMintState({
      mint: extMint,
      programOwner: TOKEN_2022_PROGRAM_ID.toBase58(),
    });

    expect(report.isToken2022).toBe(true);
    expect(report.transferFeeBps).toBe(1000);
    expect(report.permanentDelegate).toBe(SAMPLE_AUTH.toBase58());
    expect(report.transferHookProgramId).toBe(SAMPLE_HOOK.toBase58());
    expect(report.classification).toBe("CRITICAL");
    expect(
      report.flags.some((f) => f.code === "TOKEN_2022_PERMANENT_DELEGATE")
    ).toBe(true);
    expect(report.flags.some((f) => f.code === "TOKEN_2022_TRANSFER_HOOK")).toBe(
      true
    );
    expect(report.flags.some((f) => f.code === "TOKEN_2022_TRANSFER_FEE")).toBe(
      true
    );
  });

  it("flags extreme top-5 holder concentration accurately", () => {
    const concentratedMint: Mint = {
      address: SAMPLE_MINT_PUMP,
      mintAuthority: null,
      supply: BigInt(1000) * BigInt(1_000_000),
      decimals: 6,
      isInitialized: true,
      freezeAuthority: null,
      tlvData: Buffer.alloc(0),
    };

    const report = analyzeMintState({
      mint: concentratedMint,
      programOwner: TOKEN_PROGRAM_ID.toBase58(),
      largestAccounts: [
        { address: "Whale1111111111111111111111111111111111111", uiAmount: 600 },
        { address: "Whale2222222222222222222222222222222222222", uiAmount: 250 },
      ],
    });

    expect(report.top5Pct).toBe(85);
    expect(
      report.flags.some((f) => f.code === "HIGH_TOP5_CONCENTRATION")
    ).toBe(true);
  });

  it("parses Borsh-padded Metaplex name and symbol buffers safely", () => {
    const header = Buffer.alloc(65, 1);
    const nameStr = Buffer.from("SolShield Guard\0\0\0");
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32LE(nameStr.length, 0);

    const symStr = Buffer.from("SHIELD\0\0");
    const symLen = Buffer.alloc(4);
    symLen.writeUInt32LE(symStr.length, 0);

    const buf = Buffer.concat([header, nameLen, nameStr, symLen, symStr]);
    const parsed = parseMetaplexMetadataNameSymbol(buf);

    expect(parsed.name).toBe("SolShield Guard");
    expect(parsed.symbol).toBe("SHIELD");
    expect(parseMetaplexMetadataNameSymbol(Buffer.from([1, 2]))).toEqual({
      name: null,
      symbol: null,
    });
  });
});
