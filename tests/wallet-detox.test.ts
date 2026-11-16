import { describe, expect, it } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  auditWalletApprovals,
  buildBatchSplDelegateRevokeTransaction,
  evaluateTokenAccountRisk,
  ParsedTokenAccountInput,
} from "../src/lib/wallet-detox";

describe("Zero-Retention Wallet Health & Approval Detox", () => {
  it("rejects empty or invalid Solana wallet addresses cleanly", async () => {
    await expect(auditWalletApprovals("")).rejects.toThrow(/provide/i);
    await expect(auditWalletApprovals("not-a-valid-pubkey!")).rejects.toThrow(
      /invalid solana/i
    );
  });

  it("audits clean SPL + canonical PYUSD Token-2022 accounts with $0 AI cost", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    let veniceCalled = false;

    const cleanAccounts: ParsedTokenAccountInput[] = [
      {
        tokenAccount: Keypair.generate().publicKey.toBase58(),
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Canonical USDC
        programId: TOKEN_PROGRAM_ID.toBase58(),
        isToken2022: false,
        accountState: "initialized",
        balanceRaw: "500000000",
        balanceUi: 500,
        decimals: 6,
        delegate: null,
        delegatedAmountRaw: null,
        delegatedAmountUi: null,
      },
      {
        tokenAccount: Keypair.generate().publicKey.toBase58(),
        mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // Canonical PYUSD
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        isToken2022: true,
        accountState: "initialized",
        balanceRaw: "250000000",
        balanceUi: 250,
        decimals: 6,
        delegate: null,
        delegatedAmountRaw: null,
        delegatedAmountUi: null,
        permanentDelegate: Keypair.generate().publicKey.toBase58(),
        transferHookProgramId: Keypair.generate().publicKey.toBase58(),
      },
    ];

    const report = await auditWalletApprovals(owner, {
      veniceApiKey: "test-key-should-not-fire-on-clean-wallet",
      fetchImpl: (async () => {
        veniceCalled = true;
        return new Response("{}");
      }) as typeof fetch,
      loadWalletSnapshot: async () => ({
        slot: 312000100,
        solLamports: 2_500_000_000,
        accounts: cleanAccounts,
      }),
    });

    expect(veniceCalled).toBe(false);
    expect(report.walletConnectionRequired).toBe(false);
    expect(report.healthScore).toBe(100);
    expect(report.riskScore).toBe(0);
    expect(report.classification).toBe("SAFE");
    expect(report.findings).toHaveLength(0);
    expect(report.cleanAccounts).toHaveLength(2);
    expect(report.cleanAccounts[1].isCanonicalAsset).toBe(true);
    expect(report.cleanAccounts[1].symbol).toBe("PYUSD");
    expect(report.solBalance).toBe(2.5);
  });

  it("detects unlimited SPL delegates and unverified Token-2022 permanent delegates/hooks", () => {
    const drainerDelegate = Keypair.generate().publicKey.toBase58();
    const unverifiedPerm = Keypair.generate().publicKey.toBase58();
    const unverifiedHook = Keypair.generate().publicKey.toBase58();

    const unlimitedSpl = evaluateTokenAccountRisk({
      tokenAccount: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      programId: TOKEN_PROGRAM_ID.toBase58(),
      isToken2022: false,
      accountState: "initialized",
      balanceRaw: "1000000000",
      balanceUi: 1000,
      decimals: 6,
      delegate: drainerDelegate,
      delegatedAmountRaw: "18446744073709551615",
      delegatedAmountUi: 18446744073709.55,
      symbol: "BONK",
    });

    expect(unlimitedSpl.severity).toBe("CRITICAL");
    expect(unlimitedSpl.isUnlimitedAllowance).toBe(true);
    expect(unlimitedSpl.revocable).toBe(true);
    expect(unlimitedSpl.flags).toContain("ACTIVE_UNLIMITED_DELEGATE");

    const toxicToken2022 = evaluateTokenAccountRisk({
      tokenAccount: Keypair.generate().publicKey.toBase58(),
      mint: Keypair.generate().publicKey.toBase58(),
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      isToken2022: true,
      accountState: "initialized",
      balanceRaw: "500000",
      balanceUi: 500,
      decimals: 3,
      delegate: null,
      delegatedAmountRaw: null,
      delegatedAmountUi: null,
      permanentDelegate: unverifiedPerm,
      transferHookProgramId: unverifiedHook,
      symbol: "SCAM22",
    });

    expect(toxicToken2022.severity).toBe("CRITICAL");
    expect(toxicToken2022.revocable).toBe(false);
    expect(toxicToken2022.flags).toContain("TOKEN_2022_PERMANENT_DELEGATE");
    expect(toxicToken2022.flags).toContain("TOKEN_2022_UNVERIFIED_TRANSFER_HOOK");
  });

  it("calls Venice AI with zero-data-retention and strips raw owner wallet address", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const attacker = Keypair.generate().publicKey.toBase58();
    let capturedBody = "";

    const report = await auditWalletApprovals(owner, {
      veniceApiKey: "vn_test_secret",
      fetchImpl: (async (_url, init) => {
        capturedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            model: "llama-3.3-70b",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    veniceSummary:
                      "One unlimited SPL delegate threatens your BONK balance.",
                    veniceActionPlan: [
                      "Sign Instruction Tag 5 Revoke immediately.",
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch,
      loadWalletSnapshot: async () => ({
        slot: 312000222,
        solLamports: 1_000_000_000,
        accounts: [
          {
            tokenAccount: Keypair.generate().publicKey.toBase58(),
            mint: Keypair.generate().publicKey.toBase58(),
            programId: TOKEN_PROGRAM_ID.toBase58(),
            isToken2022: false,
            accountState: "initialized",
            balanceRaw: "50000000",
            balanceUi: 50,
            decimals: 6,
            delegate: attacker,
            delegatedAmountRaw: "18446744073709551615",
            delegatedAmountUi: 18446744073709.55,
            symbol: "BONK",
          },
        ],
      }),
    });

    const parsedPayload = JSON.parse(capturedBody);
    expect(parsedPayload.venice_parameters).toEqual({
      include_venice_system_prompt: false,
    });
    // Privacy defense-in-depth: never send raw wallet address in Venice prompt
    expect(capturedBody).not.toContain(owner);
    expect(capturedBody).not.toContain(attacker);

    expect(report.inferenceMode).toBe("venice-live-api");
    expect(report.veniceSummary).toContain("BONK");
    expect(report.veniceActionPlan[0]).toContain("Revoke");
    expect(report.classification).toBe("CRITICAL");
    expect(report.revocableAccountCount).toBe(1);
  });

  it("constructs valid atomic batch Revoke transactions mixing SPL Token and Token-2022", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const splAta = Keypair.generate().publicKey.toBase58();
    const t22Ata = Keypair.generate().publicKey.toBase58();

    const artifact = await buildBatchSplDelegateRevokeTransaction({
      owner,
      cluster: "mainnet",
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      targets: [
        { tokenAccount: splAta, isToken2022: false },
        { tokenAccount: t22Ata, isToken2022: true },
      ],
    });

    expect(artifact.instructionCount).toBe(2);
    expect(artifact.tokenAccounts).toEqual([splAta, t22Ata]);

    const decoded = Transaction.from(
      Buffer.from(artifact.transactionBase64, "base64")
    );
    expect(decoded.instructions).toHaveLength(2);
    expect(decoded.instructions[0].programId.toBase58()).toBe(
      TOKEN_PROGRAM_ID.toBase58()
    );
    expect(decoded.instructions[0].data[0]).toBe(5); // SPL Instruction Tag 5 = Revoke
    expect(decoded.instructions[1].programId.toBase58()).toBe(
      TOKEN_2022_PROGRAM_ID.toBase58()
    );
    expect(decoded.instructions[1].data[0]).toBe(5); // Token-2022 Instruction Tag 5 = Revoke
  });
});
