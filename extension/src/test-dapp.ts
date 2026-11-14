import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const UNKNOWN_HOOK_PROGRAM_ID = new PublicKey(
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
);
const DEMO_WALLET_KP = Keypair.generate();
const ATTACKER_PUBKEY = Keypair.generate().publicKey;
const TOKEN_ACCOUNT_PUBKEY = Keypair.generate().publicKey;
const MINT_PUBKEY = Keypair.generate().publicKey;
const DEMO_BLOCKHASH = Keypair.generate().publicKey.toBase58();

interface WalletStandardDemoWallet {
  name: string;
  version: string;
  chains: string[];
  accounts: Array<{ address: string; publicKey: Uint8Array; chains: string[]; features: string[] }>;
  features: {
    "standard:connect": {
      version: string;
      connect: () => Promise<{ accounts: WalletStandardDemoWallet["accounts"] }>;
    };
    "solana:signTransaction": {
      version: string;
      signTransaction: (
        ...inputs: Array<{ transaction: Uint8Array }>
      ) => Promise<Array<{ signedTransaction: Uint8Array }>>;
    };
    "solana:signAndSendTransaction": {
      version: string;
      signAndSendTransaction: (
        ...inputs: Array<{ transaction: Uint8Array }>
      ) => Promise<Array<{ signature: Uint8Array }>>;
    };
    "solana:signAllTransactions": {
      version: string;
      signAllTransactions: (
        ...inputs: Array<{ transaction: Uint8Array }>
      ) => Promise<Array<{ signedTransaction: Uint8Array }>>;
    };
    "solana:signMessage": {
      version: string;
      signMessage: (
        ...inputs: Array<{ message: Uint8Array }>
      ) => Promise<Array<{ signature: Uint8Array; signedMessage: Uint8Array }>>;
    };
    "solana:signIn"?: {
      version: string;
      signIn: (...inputs: Array<{ domain?: string; statement?: string; uri?: string }>) => Promise<unknown>;
    };
  };
}

let registeredStandardWallet: WalletStandardDemoWallet | null = null;

function appendLog(msg: string) {
  const el = document.getElementById("dapp-log");
  if (!el) return;
  const ts = new Date().toLocaleTimeString();
  el.textContent = `[${ts}] ${msg}\n${el.textContent || ""}`;
}

function setupMockWallets() {
  const win = window as unknown as Record<string, unknown>;

  const mockLegacyProvider = {
    isGlow: true,
    publicKey: DEMO_WALLET_KP.publicKey,
    async connect() {
      return { publicKey: DEMO_WALLET_KP.publicKey };
    },
    async signTransaction(tx: Transaction | VersionedTransaction) {
      return tx;
    },
    async signAndSendTransaction(tx: Transaction | VersionedTransaction) {
      void tx;
      return { signature: `mockSig_${Date.now()}` };
    },
    async signAllTransactions(txs: Array<Transaction | VersionedTransaction>) {
      return txs;
    },
    async signMessage(message: Uint8Array) {
      void message;
      return { signature: new Uint8Array(64).fill(7) };
    },
  };

  if (!win.glow) {
    win.glow = mockLegacyProvider;
  }

  // Expose an Object.freeze() wallet on window.solflare to test ES6 Proxy fallback wrapping
  if (!win.solflare) {
    win.solflare = Object.freeze({
      isSolflare: true,
      publicKey: DEMO_WALLET_KP.publicKey,
      async connect() {
        return { publicKey: DEMO_WALLET_KP.publicKey };
      },
      async signTransaction(tx: Transaction | VersionedTransaction) {
        return tx;
      },
      async signAndSendTransaction() {
        return { signature: `mockFrozenSig_${Date.now()}` };
      },
    });
  }

  const demoStandardWallet: WalletStandardDemoWallet = {
    name: "SolShield Demo Standard",
    version: "1.0.0",
    chains: ["solana:mainnet", "solana:devnet"],
    accounts: [
      {
        address: DEMO_WALLET_KP.publicKey.toBase58(),
        publicKey: DEMO_WALLET_KP.publicKey.toBytes(),
        chains: ["solana:mainnet", "solana:devnet"],
        features: [
          "solana:signTransaction",
          "solana:signAndSendTransaction",
          "solana:signAllTransactions",
          "solana:signMessage",
        ],
      },
    ],
    features: {
      "standard:connect": {
        version: "1.0.0",
        async connect() {
          return { accounts: demoStandardWallet.accounts };
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        async signTransaction(...inputs) {
          return inputs.map((inp) => ({ signedTransaction: inp.transaction }));
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        async signAndSendTransaction(...inputs) {
          void inputs;
          return [{ signature: new Uint8Array(64).fill(9) }];
        },
      },
      "solana:signAllTransactions": {
        version: "1.0.0",
        async signAllTransactions(...inputs) {
          return inputs.map((inp) => ({ signedTransaction: inp.transaction }));
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        async signMessage(...inputs) {
          return inputs.map((inp) => ({
            signature: new Uint8Array(64).fill(5),
            signedMessage: inp.message,
          }));
        },
      },
      "solana:signIn": {
        version: "1.0.0",
        async signIn(...inputs) {
          return inputs.map(() => ({ signature: new Uint8Array(64).fill(6) }));
        },
      },
    },
  };

  const registerApi = {
    register(...wallets: unknown[]) {
      for (const w of wallets) {
        if (w && typeof w === "object" && (w as { name?: string }).name === "SolShield Demo Standard") {
          registeredStandardWallet = w as WalletStandardDemoWallet;
        }
      }
      return () => {};
    },
  };

  window.dispatchEvent(
    new CustomEvent("wallet-standard:app-ready", { detail: registerApi })
  );

  // Trigger register-wallet pathway via our mocked wallet so MAIN inject wraps it cleanly
  const regEvent = new CustomEvent("wallet-standard:register-wallet", {
    detail: (api: { register: (...w: unknown[]) => unknown }) =>
      api.register(demoStandardWallet),
  });
  window.dispatchEvent(regEvent);
  if (typeof regEvent.detail === "function") {
    regEvent.detail(registerApi);
  } else {
    registerApi.register(demoStandardWallet);
  }

  const indicator = document.getElementById("hook-indicator");
  if (indicator) {
    const wrappedStd = Boolean(
      registeredStandardWallet &&
        (registeredStandardWallet as unknown as Record<symbol, unknown>)[
          Symbol.for("solshield.wrapped.v1")
        ]
    );
    const wrappedGlow = Boolean(
      win.glow &&
        (win.glow as Record<symbol, unknown>)[
          Symbol.for("solshield.wrapped.v1")
        ]
    );
    indicator.textContent = `Hooks: Standard=${wrappedStd ? "ON" : "NO"} | Legacy=${
      wrappedGlow ? "ON" : "NO"
    }`;
  }
}

function getSelectedWalletMode(): "standard" | "legacy" | "real" {
  const select = document.getElementById("wallet-mode") as HTMLSelectElement | null;
  const val = select?.value;
  if (val === "legacy" || val === "real") return val;
  return "standard";
}

function buildSafeTransferTx(payer: PublicKey): Transaction {
  const tx = new Transaction({
    feePayer: payer,
    recentBlockhash: DEMO_BLOCKHASH,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 50_000_000,
    })
  );
  return tx;
}

function buildSetAuthorityTx(payer: PublicKey): Transaction {
  // SPL Token SetAuthority opcode = 6, authorityType = 2 (AccountOwner), Some(newAuthority)
  const data = new Uint8Array(35);
  data[0] = 6;
  data[1] = 2;
  data[2] = 1;
  data.set(ATTACKER_PUBKEY.toBytes(), 3);

  const ix = new TransactionInstruction({
    programId: SPL_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: TOKEN_ACCOUNT_PUBKEY, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction({
    feePayer: payer,
    recentBlockhash: DEMO_BLOCKHASH,
  });
  tx.add(ix);
  return tx;
}

function buildUnlimitedApproveTx(payer: PublicKey): Transaction {
  // SPL Token Approve opcode = 4 + u64::MAX (0xff * 8)
  const data = new Uint8Array(9);
  data[0] = 4;
  data.fill(0xff, 1, 9);

  const ix = new TransactionInstruction({
    programId: SPL_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: TOKEN_ACCOUNT_PUBKEY, isSigner: false, isWritable: true },
      { pubkey: ATTACKER_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction({
    feePayer: payer,
    recentBlockhash: DEMO_BLOCKHASH,
  });
  tx.add(ix);
  return tx;
}

function buildToken2022V0Tx(payer: PublicKey): VersionedTransaction {
  const token2022Ix = new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: TOKEN_ACCOUNT_PUBKEY, isSigner: false, isWritable: true },
      { pubkey: MINT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: ATTACKER_PUBKEY, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: UNKNOWN_HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([12, 100, 0, 0, 0, 0, 0, 0, 0, 6]),
  });

  const hookIx = new TransactionInstruction({
    programId: UNKNOWN_HOOK_PROGRAM_ID,
    keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
    data: Buffer.from([1, 2, 3, 4]),
  });

  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: DEMO_BLOCKHASH,
    instructions: [token2022Ix, hookIx],
  }).compileToV0Message();

  return new VersionedTransaction(msg);
}

async function resolveActiveSignerPubkey(): Promise<PublicKey> {
  const mode = getSelectedWalletMode();
  if (mode === "real") {
    const sol = (window as unknown as { solana?: { publicKey?: PublicKey; connect: () => Promise<{ publicKey: PublicKey }> } }).solana;
    if (!sol) {
      throw new Error("Real window.solana wallet not detected in this browser.");
    }
    if (!sol.publicKey) {
      const connected = await sol.connect();
      return connected.publicKey;
    }
    return sol.publicKey;
  }
  return DEMO_WALLET_KP.publicKey;
}

async function dispatchScenario(
  label: string,
  action: (payer: PublicKey, mode: "standard" | "legacy" | "real") => Promise<unknown>
) {
  const mode = getSelectedWalletMode();
  appendLog(`Starting [${label}] via ${mode} channel...`);
  try {
    const payer = await resolveActiveSignerPubkey();
    const result = await action(payer, mode);
    appendLog(`SUCCESS [${label}]: ${JSON.stringify(result).slice(0, 180)}`);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`REJECTED/ERROR [${label}] code=${String(code ?? "none")}: ${message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupMockWallets();

  const serializeTx = (tx: Transaction | VersionedTransaction): Uint8Array =>
    tx instanceof VersionedTransaction
      ? tx.serialize()
      : tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  const invokeSingle = async (
    mode: "standard" | "legacy" | "real",
    method: "signTransaction" | "signAndSendTransaction",
    tx: Transaction | VersionedTransaction
  ) => {
    if (mode === "standard") {
      if (!registeredStandardWallet) throw new Error("Standard wallet unavailable");
      if (method === "signAndSendTransaction") {
        return registeredStandardWallet.features["solana:signAndSendTransaction"].signAndSendTransaction({
          transaction: serializeTx(tx),
        });
      }
      return registeredStandardWallet.features["solana:signTransaction"].signTransaction({
        transaction: serializeTx(tx),
      });
    }
    const win = window as unknown as {
      glow?: Record<string, (t: unknown) => Promise<unknown>>;
      solana?: Record<string, (t: unknown) => Promise<unknown>>;
    };
    const provider = mode === "real" ? win.solana : win.glow;
    if (!provider) throw new Error(`Legacy provider (${mode}) unavailable`);
    return provider[method](tx);
  };

  document.getElementById("btn-safe-transfer")?.addEventListener("click", () => {
    void dispatchScenario("Safe SOL Transfer", (payer, mode) =>
      invokeSingle(mode, "signTransaction", buildSafeTransferTx(payer))
    );
  });

  document.getElementById("btn-set-authority")?.addEventListener("click", () => {
    void dispatchScenario("SetAuthority Drainer", (payer, mode) =>
      invokeSingle(mode, "signAndSendTransaction", buildSetAuthorityTx(payer))
    );
  });

  document.getElementById("btn-token2022-v0")?.addEventListener("click", () => {
    void dispatchScenario("Token-2022 V0 Hook", (payer, mode) =>
      invokeSingle(mode, "signTransaction", buildToken2022V0Tx(payer))
    );
  });

  document
    .getElementById("btn-unlimited-approve")
    ?.addEventListener("click", () => {
      void dispatchScenario("Unlimited Approve", (payer, mode) =>
        invokeSingle(mode, "signTransaction", buildUnlimitedApproveTx(payer))
      );
    });

  document.getElementById("btn-batch-trap")?.addEventListener("click", () => {
    void dispatchScenario("Batch Drain (5 Txs)", async (payer, mode) => {
      const batch = [
        buildSafeTransferTx(payer),
        buildSafeTransferTx(payer),
        buildSafeTransferTx(payer),
        buildSetAuthorityTx(payer),
        buildSafeTransferTx(payer),
      ];
      if (mode === "standard") {
        if (!registeredStandardWallet) throw new Error("Standard wallet unavailable");
        return registeredStandardWallet.features[
          "solana:signAllTransactions"
        ].signAllTransactions(
          ...batch.map((t) => ({ transaction: serializeTx(t) }))
        );
      }
      const win = window as unknown as {
        glow?: { signAllTransactions: (t: unknown[]) => Promise<unknown> };
        solana?: { signAllTransactions: (t: unknown[]) => Promise<unknown> };
      };
      const provider = mode === "real" ? win.solana : win.glow;
      if (!provider) throw new Error("Legacy provider unavailable");
      return provider.signAllTransactions(batch);
    });
  });

  document.getElementById("btn-sign-message")?.addEventListener("click", () => {
    void dispatchScenario("Phishing signMessage", async (_payer, mode) => {
      const bytes = new TextEncoder().encode(
        "Authorize drain and SetAuthority transfer ownership to claim airdrop reward"
      );
      if (mode === "standard") {
        if (!registeredStandardWallet) throw new Error("Standard wallet unavailable");
        return registeredStandardWallet.features["solana:signMessage"].signMessage({
          message: bytes,
        });
      }
      const win = window as unknown as {
        glow?: { signMessage: (m: Uint8Array) => Promise<unknown> };
        solana?: { signMessage: (m: Uint8Array) => Promise<unknown> };
      };
      const provider = mode === "real" ? win.solana : win.glow;
      if (!provider) throw new Error("Legacy provider unavailable");
      return provider.signMessage(bytes);
    });
  });

  document.getElementById("btn-sign-in-spoof")?.addEventListener("click", () => {
    void dispatchScenario("Cross-Domain SIWS Spoof", async () => {
      if (!registeredStandardWallet?.features["solana:signIn"]) {
        throw new Error("Standard wallet signIn feature unavailable");
      }
      return registeredStandardWallet.features["solana:signIn"].signIn({
        domain: "app.jup.ag",
        statement: "Sign in to claim verified allocation",
        uri: "https://app.jup.ag/claim",
      });
    });
  });

  document.getElementById("btn-frozen-proxy")?.addEventListener("click", () => {
    void dispatchScenario("Frozen Provider SetAuthority", async (payer) => {
      const win = window as unknown as {
        solflare?: { signAndSendTransaction: (t: unknown) => Promise<unknown> };
      };
      if (!win.solflare) throw new Error("Frozen solflare provider unavailable");
      return win.solflare.signAndSendTransaction(buildSetAuthorityTx(payer));
    });
  });

  document.getElementById("btn-clear-log")?.addEventListener("click", () => {
    const el = document.getElementById("dapp-log");
    if (el) el.textContent = "";
  });
});
