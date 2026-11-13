import { describe, it, expect } from "vitest";
import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  computeSimulationDiffs,
  extractCandidateSimulationAddresses,
  extractInvokedProgramsFromLogs,
  simulateSolanaTransactionRpc,
} from "../src/lib/tx-simulator";

describe("M3 Pre-Sign RPC Simulation Diffs & Log CPI Inspector", () => {
  it("computes SOL, SPL, and Token-2022 balance deltas plus authority hijacks", () => {
    const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const mint2022 = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";

    const diff = computeSimulationDiffs({
      addresses: ["WalletPayer1111111111111111111111111111111", "AtaUsdc111111111111111111111111111111111", "Ata2022_11111111111111111111111111111111"],
      feePayer: "WalletPayer1111111111111111111111111111111",
      preAccounts: [
        { lamports: 2_000_000_000, owner: "11111111111111111111111111111111" },
        {
          lamports: 2_039_280,
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          data: {
            program: "spl-token",
            parsed: {
              info: {
                mint: mintA,
                owner: "WalletPayer1111111111111111111111111111111",
                tokenAmount: { uiAmount: 500, decimals: 6 },
              },
            },
          },
        },
        {
          lamports: 2_039_280,
          owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          data: {
            program: "spl-token-2022",
            parsed: {
              info: {
                mint: mint2022,
                owner: "WalletPayer1111111111111111111111111111111",
                tokenAmount: { uiAmount: 0, decimals: 6 },
              },
            },
          },
        },
      ],
      postAccounts: [
        { lamports: 1_500_000_000, owner: "11111111111111111111111111111111" },
        {
          lamports: 2_039_280,
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          data: {
            program: "spl-token",
            parsed: {
              info: {
                mint: mintA,
                owner: "AttackerWallet999999999999999999999999999",
                delegate: "DrainerSpender88888888888888888888888888",
                tokenAmount: { uiAmount: 100, decimals: 6 },
              },
            },
          },
        },
        {
          lamports: 2_039_280,
          owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          data: {
            program: "spl-token-2022",
            parsed: {
              info: {
                mint: mint2022,
                owner: "WalletPayer1111111111111111111111111111111",
                tokenAmount: { uiAmount: 42.5, decimals: 6 },
              },
            },
          },
        },
      ],
      logs: [
        "Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [1]",
        "Program 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin invoke [2]",
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]",
      ],
    });

    expect(diff.balanceDiffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asset: "SOL", deltaUiAmount: -0.5, direction: "OUT" }),
        expect.objectContaining({ mint: mintA, deltaUiAmount: -400, direction: "OUT", isToken2022: false }),
        expect.objectContaining({ mint: mint2022, deltaUiAmount: 42.5, direction: "IN", isToken2022: true }),
      ])
    );

    expect(diff.authorityChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ changeType: "OWNER_CHANGED" }),
        expect.objectContaining({ changeType: "DELEGATE_GRANTED" }),
      ])
    );

    expect(diff.hiddenCpiPrograms).toHaveLength(1);
    expect(diff.hiddenCpiPrograms[0]).toMatchObject({
      programId: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      depth: 2,
      verified: false,
    });
    expect(diff.discoveredMints).toEqual([mintA, mint2022]);
  });

  it("extracts writable/signer accounts from both Legacy and Versioned V0 transactions", () => {
    const payer = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const blockhash = Keypair.generate().publicKey.toBase58();

    const ix = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: recipient,
      lamports: 1_000_000,
    });

    const legacyTx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(ix);
    const legacyB64 = legacyTx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    const extractedLegacy = extractCandidateSimulationAddresses(legacyB64);
    expect(extractedLegacy.feePayer).toBe(payer.toBase58());
    expect(extractedLegacy.addresses).toContain(recipient.toBase58());

    const v0Msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const v0B64 = Buffer.from(new VersionedTransaction(v0Msg).serialize()).toString("base64");

    const extractedV0 = extractCandidateSimulationAddresses(v0B64);
    expect(extractedV0.feePayer).toBe(payer.toBase58());
    expect(extractedV0.addresses).toContain(recipient.toBase58());
  });

  it("parses simulation log CPIs and fails gracefully to RPC_UNAVAILABLE when RPC is unreachable", async () => {
    const cpis = extractInvokedProgramsFromLogs([
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program BadHookProgram111111111111111111111111111 invoke [3]",
    ]);
    expect(cpis).toHaveLength(2);
    expect(cpis[1].depth).toBe(3);

    const payer = Keypair.generate().publicKey;
    const tx = new Transaction({
      feePayer: payer,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    );
    const b64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    const report = await simulateSolanaTransactionRpc(b64, {
      rpcUrl: "http://127.0.0.1:59999/unreachable-rpc",
      inspectTokens: false,
      timeoutMs: 300,
    });

    expect(report.status).toBe("RPC_UNAVAILABLE");
    expect(report.rpcError).toBeTruthy();
  });
});
