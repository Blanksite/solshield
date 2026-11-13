import { describe, it, expect } from "vitest";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  buildAuditedJupiterBlinkSwap,
  inspectSerializedTransactionHeader,
  JUPITER_V6_PROGRAM_ID,
  PLACEHOLDER_BLOCKHASH,
  resolveTokenSpec,
  SOL_MINT,
  USDC_MINT,
} from "../src/lib/jupiter-blink";

function buildMockVersionedJupiterSwapTx(
  payer: PublicKey,
  blockhash: string,
  programIds: PublicKey[]
): string {
  const instructions = programIds.map((programId) => {
    if (programId.equals(SystemProgram.programId)) {
      return SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: payer,
        lamports: 1_000_000,
      });
    }
    return new TransactionInstruction({
      programId,
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
      data: Buffer.from([1, 2, 3]),
    });
  });

  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const vtx = new VersionedTransaction(msg);
  return Buffer.from(vtx.serialize()).toString("base64");
}

function makeMockFetch(swapTxBase64: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/quote")) {
      return new Response(
        JSON.stringify({
          inputMint: SOL_MINT,
          inAmount: "1000000000",
          outputMint: USDC_MINT,
          outAmount: "82500000",
          routePlan: [{ swapInfo: { label: "Raydium CLMM" }, percent: 100 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ swapTransaction: swapTxBase64 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("SolShield Jupiter Blink Builder & Pre-Sign Audit", () => {
  const realBlockhash = Keypair.generate().publicKey.toBase58();
  const payer = Keypair.generate().publicKey;

  it("resolves known symbols and Base58 custom output mints safely", () => {
    expect(resolveTokenSpec("usdc", "USDC")).toMatchObject({
      mint: USDC_MINT,
      symbol: "USDC",
      decimals: 6,
    });
    const customMint = Keypair.generate().publicKey.toBase58();
    expect(resolveTokenSpec(customMint, "USDC")).toMatchObject({
      mint: customMint,
      decimals: null,
    });
  });

  it("builds and approves a live Versioned V0 Jupiter v6 swap with a non-placeholder blockhash", async () => {
    const mockTx = buildMockVersionedJupiterSwapTx(payer, realBlockhash, [
      SystemProgram.programId,
      new PublicKey(JUPITER_V6_PROGRAM_ID),
    ]);

    const res = await buildAuditedJupiterBlinkSwap({
      account: payer.toBase58(),
      amountUi: 1,
      outputMintRaw: "USDC",
      fetchImpl: makeMockFetch(mockTx),
    });

    const header = inspectSerializedTransactionHeader(res.transactionBase64);
    expect(header.recentBlockhash).toBe(realBlockhash);
    expect(header.recentBlockhash).not.toBe(PLACEHOLDER_BLOCKHASH);
    expect(header.programIds).toContain(JUPITER_V6_PROGRAM_ID);
    expect(res.outAmountUi).toBeCloseTo(82.5, 4);
    expect(res.routeLabels).toEqual(["Raydium CLMM"]);
    expect(res.audit.classification).toBe("SAFE");
    expect(res.audit.policyGuardVerdict.passesPolicy).toBe(true);
  });

  it("rejects transactions returned with the 1111... placeholder blockhash", async () => {
    const badTx = buildMockVersionedJupiterSwapTx(payer, PLACEHOLDER_BLOCKHASH, [
      new PublicKey(JUPITER_V6_PROGRAM_ID),
    ]);

    await expect(
      buildAuditedJupiterBlinkSwap({
        account: payer.toBase58(),
        amountUi: 1,
        fetchImpl: makeMockFetch(badTx),
      })
    ).rejects.toThrow("valid live Mainnet blockhash");
  });

  it("rejects transactions missing Jupiter v6 Aggregator instruction", async () => {
    const noJupTx = buildMockVersionedJupiterSwapTx(payer, realBlockhash, [
      SystemProgram.programId,
    ]);

    await expect(
      buildAuditedJupiterBlinkSwap({
        account: payer.toBase58(),
        amountUi: 1,
        fetchImpl: makeMockFetch(noJupTx),
      })
    ).rejects.toThrow("Jupiter v6 program missing");
  });

  it("blocks a V0 swap tx injected with SPL SetAuthority hijack", async () => {
    const attackerIx = new TransactionInstruction({
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
      data: Buffer.from([6, 2]), // SetAuthority(AccountOwner)
    });
    const jupIx = new TransactionInstruction({
      programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
      data: Buffer.from([1]),
    });
    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: realBlockhash,
      instructions: [jupIx, attackerIx],
    }).compileToV0Message();
    const evilTx = Buffer.from(new VersionedTransaction(msg).serialize()).toString(
      "base64"
    );

    await expect(
      buildAuditedJupiterBlinkSwap({
        account: payer.toBase58(),
        amountUi: 1,
        fetchImpl: makeMockFetch(evilTx),
      })
    ).rejects.toThrow("Blocked by SolShield + Venice AI Firewall");
  });

  it("enforces the 10 SOL guardrail on excessive Blink swap amounts", async () => {
    const mockTx = buildMockVersionedJupiterSwapTx(payer, realBlockhash, [
      new PublicKey(JUPITER_V6_PROGRAM_ID),
    ]);

    await expect(
      buildAuditedJupiterBlinkSwap({
        account: payer.toBase58(),
        amountUi: 12,
        fetchImpl: makeMockFetch(mockTx),
      })
    ).rejects.toThrow("DailySpendLimitExceeded");
  });
});
