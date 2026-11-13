import { describe, it, expect, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  wrapLegacyProvider,
  wrapWalletStandardWallet,
} from "../extension/src/provider-wrapper";

function makeSampleTx() {
  const payer = Keypair.generate().publicKey;
  const to = Keypair.generate().publicKey;
  const blockhash = Keypair.generate().publicKey.toBase58();
  const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: 1000 })
  );
  return { payer, to, blockhash, tx };
}

describe("M0 Legacy & Wallet Standard Provider Interception", () => {
  it("intercepts legacy provider methods without mutating transaction and preserves this binding", async () => {
    const { tx } = makeSampleTx();
    const internalToken = "phantom-internal-ok";
    const mockProvider = {
      secretState: internalToken,
      async signTransaction(passedTx: Transaction) {
        expect(this.secretState).toBe(internalToken);
        return passedTx;
      },
      async signAndSendTransaction(_passedTx: Transaction) {
        return { signature: "5abc" };
      },
      async signAllTransactions(txs: Transaction[]) {
        return txs;
      },
      async signMessage(bytes: Uint8Array) {
        return { signature: bytes };
      },
    };

    const interceptSpy = vi.fn(
      async (_req: { base64Transactions?: string[] }) => ({ allow: true })
    );
    const res = wrapLegacyProvider(mockProvider, "Phantom", {
      interceptRequest: interceptSpy,
    });

    expect(res.status).toBe("WRAPPED");
    expect(res.wrappedMethods).toContain("signTransaction");

    // Idempotent second wrap
    const second = wrapLegacyProvider(mockProvider, "Phantom", {
      interceptRequest: interceptSpy,
    });
    expect(second.status).toBe("ALREADY_WRAPPED");

    const sigCountBefore = tx.signatures.length;
    const out = await mockProvider.signTransaction(tx);
    expect(out).toBe(tx);
    expect(tx.signatures.length).toBe(sigCountBefore);
    expect(interceptSpy).toHaveBeenCalledTimes(1);
    const firstArg = interceptSpy.mock.calls[0]?.[0];
    expect(firstArg?.base64Transactions).toHaveLength(1);
  });

  it("throws EIP-1193 code 4001 when user rejects a transaction on legacy or Wallet Standard", async () => {
    const { payer, to, blockhash } = makeSampleTx();
    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: 5000 }),
      ],
    }).compileToV0Message();
    const v0 = new VersionedTransaction(msg);
    const v0Bytes = v0.serialize();

    const stdWallet = {
      name: "Backpack",
      features: {
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          async signAndSendTransaction(...inputs: Array<{ transaction: Uint8Array }>) {
            return inputs.map(() => ({ signature: new Uint8Array(64) }));
          },
        },
        "solana:signMessage": {
          version: "1.0.0",
          async signMessage(...inputs: Array<{ message: Uint8Array }>) {
            return inputs.map((i) => ({ signature: i.message }));
          },
        },
      },
    };

    const wrapRes = wrapWalletStandardWallet(stdWallet, {
      interceptRequest: async () => ({
        allow: false,
        reason: "Blocked SetAuthority drainer",
      }),
    });

    expect(wrapRes.status).toBe("WRAPPED");

    await expect(
      stdWallet.features["solana:signAndSendTransaction"].signAndSendTransaction({
        transaction: v0Bytes,
      })
    ).rejects.toMatchObject({ code: 4001 });
  });

  it("reports LIMITED_FROZEN instead of throwing when a provider object is frozen", () => {
    const frozenProvider = Object.freeze({
      async signTransaction(tx: unknown) {
        return tx;
      },
      async signMessage(m: Uint8Array) {
        return m;
      },
    });

    const res = wrapLegacyProvider(frozenProvider, "FrozenWallet", {
      interceptRequest: async () => ({ allow: true }),
    });

    expect(res.status).toBe("LIMITED_FROZEN");
    expect(res.frozenMethods).toEqual(
      expect.arrayContaining(["signTransaction", "signMessage"])
    );
  });
});
