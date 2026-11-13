import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { parseDeFiIntentWithVenice } from "../src/lib/venice-ai";
import { compileDeFiIntentWithJupiter } from "../src/lib/intent-builder";
import {
  JUPITER_V6_PROGRAM_ID,
  KNOWN_BLINK_TOKENS,
  PLACEHOLDER_BLOCKHASH,
  SOL_MINT,
} from "../src/lib/jupiter-blink";
import {
  inspectLiveBlinkUrl,
  isPrivateOrReservedIp,
  parseSafeBlinkActionUrl,
} from "../src/lib/blink-inspector";
import {
  ANCHOR_PLACEHOLDER_PROGRAM_ID,
  buildInitializePolicyTransaction,
  buildSetEmergencyLockTransaction,
  buildSplDelegateRevokeTransaction,
  computeAnchorInstructionDiscriminator,
  deriveUsdcAssociatedTokenAccount,
  fetchDevnetPolicyVaultStatus,
} from "../src/lib/anchor-vault";
import { SOLSHIELD_PROGRAM_ID } from "../src/lib/anchor-idl";
import { analyzeBase64Transaction } from "../src/lib/solana-parser";

function buildMockV0Tx(
  payer: PublicKey,
  blockhash: string,
  instructions: TransactionInstruction[]
): string {
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

describe("Multi-Token DeFi Intent Parser & Live Jupiter Compiler", () => {
  const payer = Keypair.generate().publicKey;
  const realBlockhash = Keypair.generate().publicKey.toBase58();

  it("parses diverse SPL pairs (BONK, JitoSOL, USDC, JUP) accurately without defaulting output to USDC", async () => {
    const bonkIntent = await parseDeFiIntentWithVenice(
      "Swap 12 SOL to BONK (Test Daily Spend Cap)"
    );
    expect(bonkIntent.inputToken).toBe("SOL");
    expect(bonkIntent.outputToken).toBe("BONK");
    expect(bonkIntent.amount).toBe(12);
    expect(bonkIntent.maxSlippageBps).toBe(50);

    const jitoIntent = await parseDeFiIntentWithVenice(
      "Convert 0.5 SOL to JitoSOL safely"
    );
    expect(jitoIntent.inputToken).toBe("SOL");
    expect(jitoIntent.outputToken).toBe("JitoSOL");
    expect(jitoIntent.amount).toBe(0.5);

    const reverseIntent = await parseDeFiIntentWithVenice(
      "Swap 100 USDC to SOL with 0.3% slippage"
    );
    expect(reverseIntent.inputToken).toBe("USDC");
    expect(reverseIntent.outputToken).toBe("SOL");
    expect(reverseIntent.amount).toBe(100);
    expect(reverseIntent.maxSlippageBps).toBe(30);

    const buyWithIntent = await parseDeFiIntentWithVenice(
      "Buy 50 JUP with 10 USDC"
    );
    expect(buyWithIntent.inputToken).toBe("USDC");
    expect(buyWithIntent.outputToken).toBe("JUP");
  });

  it("compiles a live Jupiter V0 intent swap and flags cap violations while preserving live BONK quote", async () => {
    const jupIx = new TransactionInstruction({
      programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
      data: Buffer.from([1, 2, 3]),
    });
    const mockTx = buildMockV0Tx(payer, realBlockhash, [jupIx]);

    const mockFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/quote")) {
        return new Response(
          JSON.stringify({
            inputMint: SOL_MINT,
            inAmount: "12000000000",
            outputMint: KNOWN_BLINK_TOKENS.BONK.mint,
            outAmount: "8500000000000", // 85,000,000 BONK (5 decimals)
            priceImpactPct: "0.02",
            routePlan: [{ swapInfo: { label: "Whirlpool" }, percent: 100 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ swapTransaction: mockTx }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const compiled = await compileDeFiIntentWithJupiter({
      prompt: "Swap 12 SOL to BONK (Test Daily Spend Cap)",
      maxDailySol: 5,
      fetchImpl: mockFetch,
    });

    expect(compiled.ok).toBe(true);
    expect(compiled.intent.outputToken).toBe("BONK");
    expect(compiled.quote.quoteMode).toBe("jupiter-v1-live");
    expect(compiled.quote.outAmountUi).toBeCloseTo(85_000_000, 1);
    expect(compiled.quote.routeLabels).toEqual(["Whirlpool"]);
    expect(compiled.recentBlockhash).toBe(realBlockhash);
    expect(compiled.recentBlockhash).not.toBe(PLACEHOLDER_BLOCKHASH);
    expect(compiled.veniceAudit.policyGuardVerdict.passesPolicy).toBe(false);
    expect(compiled.veniceAudit.policyGuardVerdict.reason).toContain(
      "DailySpendLimitExceeded"
    );
  });

  it("reports jupiter-unavailable honestly without fabricating hardcoded exchange rates when upstream fails", async () => {
    const failingFetch: typeof fetch = (async () =>
      new Response("Service Unavailable", { status: 503 })) as typeof fetch;

    const compiled = await compileDeFiIntentWithJupiter({
      prompt: "Convert 0.5 SOL to JitoSOL",
      maxDailySol: 5,
      fetchImpl: failingFetch,
    });

    expect(compiled.ok).toBe(true);
    expect(compiled.quote.quoteMode).toBe("jupiter-unavailable");
    expect(compiled.quote.outAmountUi).toBeNull();
    expect(compiled.base64Transaction).toBeNull();
    expect(compiled.quote.error).toContain("503");
  });
});

describe("SSRF-Guarded Blink Action URL Inspector", () => {
  const payer = Keypair.generate().publicKey;
  const realBlockhash = Keypair.generate().publicKey.toBase58();

  it("rejects non-HTTPS, localhost, RFC1918, and cloud metadata SSRF targets", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);

    expect(() =>
      parseSafeBlinkActionUrl("http://sol-shield.xyz/api/actions/audit-swap")
    ).toThrow("Only HTTPS");
    expect(() =>
      parseSafeBlinkActionUrl("https://localhost:3000/api/actions")
    ).toThrow("SSRF policy");
    expect(() =>
      parseSafeBlinkActionUrl("https://169.254.169.254/latest/meta-data")
    ).toThrow("SSRF policy");

    const unwrapped = parseSafeBlinkActionUrl(
      "solana-action:https://sol-shield.xyz/api/actions/audit-swap?amount=1"
    );
    expect(unwrapped.toString()).toBe(
      "https://sol-shield.xyz/api/actions/audit-swap?amount=1"
    );

    const dialUnwrapped = parseSafeBlinkActionUrl(
      "https://dial.to/?action=solana-action:https://sol-shield.xyz/api/actions/audit-swap"
    );
    expect(dialUnwrapped.hostname).toBe("sol-shield.xyz");
  });

  it("fetches Action GET+POST live and detects SetAuthority drainer inside returned transaction", async () => {
    const evilIx = new TransactionInstruction({
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
      data: Buffer.from([6, 2]), // SetAuthority(AccountOwner)
    });
    const evilTx = buildMockV0Tx(payer, realBlockhash, [evilIx]);

    const mockActionFetch: typeof fetch = (async (_url, init) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(
          JSON.stringify({
            title: "Claim Bonus Airdrop",
            label: "Claim",
            description: "Test Blink",
            links: { actions: [{ label: "Claim Now", href: "/api/claim" }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ transaction: evilTx }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const inspected = await inspectLiveBlinkUrl({
      blinkUrl: "solana-action:https://example-blink.org/action",
      fetchImpl: mockActionFetch,
      skipDnsCheck: true,
    });

    expect(inspected.blinkMeta.inspectionMode).toBe("live-action-tx-audited");
    expect(inspected.report.sourceType).toBe("BLINK_URL");
    expect(inspected.report.deterministicClassification).toBe("CRITICAL");
    expect(
      inspected.report.threatFlags.some(
        (t) => t.code === "OWNER_AUTHORITY_HIJACK"
      )
    ).toBe(true);
  });

  it("flags unreachable Action domains as elevated risk instead of defaulting SAFE", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("ENOTFOUND");
    }) as typeof fetch;

    const inspected = await inspectLiveBlinkUrl({
      blinkUrl: "solana-action:https://offline-claim.invalid/claim",
      fetchImpl: failingFetch,
      skipDnsCheck: true,
    });

    expect(inspected.blinkMeta.inspectionMode).toBe("live-action-unreachable");
    expect(inspected.report.deterministicClassification).not.toBe("SAFE");
    expect(inspected.report.threatFlags[0].code).toBe(
      "BLINK_ENDPOINT_UNVERIFIED"
    );
  });
});

describe("Anchor Policy Vault Borsh Serializer, Devnet Probe & SPL Tag 5 Revoke", () => {
  const owner = Keypair.generate().publicKey;

  it("matches exact Anchor v0.30.1 SHA-256 discriminators and Borsh arg layouts", async () => {
    const disc = await computeAnchorInstructionDiscriminator("initialize_policy");
    const expected = createHash("sha256")
      .update("global:initialize_policy")
      .digest()
      .subarray(0, 8);
    expect(Buffer.from(disc).toString("hex")).toBe(expected.toString("hex"));

    const artifact = await buildInitializePolicyTransaction({
      owner,
      maxDailySpendLamports: 5_000_000_000,
      maxAllowedRiskScore: 30,
      blockUnknownTransferHooks: true,
    });
    expect(artifact.programId).toBe(SOLSHIELD_PROGRAM_ID.toBase58());
    expect(artifact.programId).toBe("ByiifxwsDxRwMDiZU7TYceFsxT9XawGqffS5oTocwHE4");
    expect(artifact.programId).not.toBe(ANCHOR_PLACEHOLDER_PROGRAM_ID);
    expect(artifact.accountCount).toBe(3);
    expect(Buffer.from(artifact.instructionDataHex, "hex").length).toBe(18);

    const lockArtifact = await buildSetEmergencyLockTransaction({
      owner,
      locked: true,
    });
    expect(Buffer.from(lockArtifact.instructionDataHex, "hex").length).toBe(9);
    expect(Buffer.from(lockArtifact.instructionDataHex, "hex")[8]).toBe(1);
  });

  it("constructs real SPL Token Instruction Tag 5 (Revoke) decodable by SolShield parser", () => {
    const ata = deriveUsdcAssociatedTokenAccount(owner);
    const revokeArtifact = buildSplDelegateRevokeTransaction({
      tokenAccount: ata,
      owner,
    });

    expect(revokeArtifact.instructionDataHex).toBe("05");
    const parsed = analyzeBase64Transaction(revokeArtifact.transactionBase64);
    expect(parsed.instructions[0].programName).toBe("SPL Token Program");
    expect(parsed.instructions[0].instructionName).toContain("Revoke");
  });

  it("reports Devnet deployment status truthfully for live Devnet Program ID", async () => {
    const buildMockRpc =
      (programAccountValue: { executable: boolean } | null): typeof fetch =>
      (async (_url, init) => {
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
        };
        if (parsedBody.method === "getMultipleAccounts") {
          return new Response(
            JSON.stringify({ result: { value: [programAccountValue] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            result: { value: { blockhash: Keypair.generate().publicKey.toBase58() } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

    const deployedStatus = await fetchDevnetPolicyVaultStatus({
      ownerAddress: owner.toBase58(),
      fetchImpl: buildMockRpc({ executable: true }),
    });
    expect(deployedStatus.isPlaceholderTemplateId).toBe(false);
    expect(deployedStatus.programDeployedOnDevnet).toBe(true);
    expect(deployedStatus.latestDevnetBlockhash).toBeTruthy();

    const missingStatus = await fetchDevnetPolicyVaultStatus({
      ownerAddress: owner.toBase58(),
      fetchImpl: buildMockRpc(null),
    });
    expect(missingStatus.isPlaceholderTemplateId).toBe(false);
    expect(missingStatus.programDeployedOnDevnet).toBe(false);
  });
});
