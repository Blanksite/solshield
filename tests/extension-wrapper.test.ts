import { describe, it, expect, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  createFrozenProviderProxy,
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

  it("reports LIMITED_FROZEN instead of throwing when a provider object is frozen", async () => {
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

    const proxySpy = vi.fn(
      async (_req: { base64Transactions?: string[] }) => ({
        allow: false,
        reason: "Proxy blocked",
      })
    );
    const proxied = createFrozenProviderProxy(frozenProvider, "FrozenWallet", {
      interceptRequest: proxySpy,
    });
    await expect(proxied.signTransaction(makeSampleTx().tx)).rejects.toMatchObject({
      code: 4001,
    });
    expect(proxySpy).toHaveBeenCalledTimes(1);
    expect(proxySpy.mock.calls[0]?.[0]?.base64Transactions).toHaveLength(1);
  });

  it("extracts base58 transactions from EIP-1193 request() and inspects solana:signIn", async () => {
    const { tx } = makeSampleTx();
    const rawBytes = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const base58Tx = bs58.encode(rawBytes);

    const requestSpy = vi.fn(
      async (_req: { base64Transactions?: string[] }) => ({ allow: true })
    );
    const provider = {
      async request(payload: { method: string; params?: Record<string, unknown> }) {
        return payload.method;
      },
    };
    wrapLegacyProvider(provider, "Phantom", { interceptRequest: requestSpy });

    await provider.request({
      method: "signTransaction",
      params: { message: base58Tx },
    });
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy.mock.calls[0]?.[0]?.base64Transactions?.[0]).toBeTruthy();

    const siwsSpy = vi.fn(
      async (_req: { walletMethod?: string; signInInput?: { domain?: string } }) => ({
        allow: false,
        reason: "Cross-domain SIWS",
      })
    );
    const stdWallet = {
      name: "Backpack",
      features: {
        "solana:signIn": {
          version: "1.0.0",
          async signIn(..._inputs: Array<{ domain?: string; statement?: string }>) {
            return [];
          },
        },
      },
    };
    wrapWalletStandardWallet(stdWallet, { interceptRequest: siwsSpy });
    await expect(
      stdWallet.features["solana:signIn"].signIn({
        domain: "app.jup.ag",
        statement: "Sign in",
      })
    ).rejects.toMatchObject({ code: 4001 });
    expect(siwsSpy.mock.calls[0]?.[0]?.walletMethod).toBe("signIn");
    expect(siwsSpy.mock.calls[0]?.[0]?.signInInput?.domain).toBe("app.jup.ag");
  });
});
