import { describe, it, expect } from "vitest";
import { getPresetReport } from "../src/lib/presets";
import { deriveSecurityPolicyPda } from "../src/lib/anchor-idl";
import {
  auditTransactionWithVenice,
  parseDeFiIntentWithVenice,
} from "../src/lib/venice-ai";

describe("SolShield Transaction Firewall & Venice AI Security Engine", () => {
  it("approves a valid Jupiter v6 swap guarded by SolShield Policy PDA", async () => {
    const { report } = getPresetReport("safe-jupiter-swap");

    expect(report.deterministicClassification).toBe("SAFE");
    expect(report.deterministicRiskScore).toBeLessThan(20);
    expect(report.threatFlags).toHaveLength(0);
    expect(report.hasUnverifiedTransferHook).toBe(false);

    const audit = await auditTransactionWithVenice(report, {
      maxAllowedRiskScore: 35,
      maxDailyLamports: 5_000_000_000,
      blockUnknownTransferHooks: true,
    });

    expect(audit.classification).toBe("SAFE");
    expect(audit.recommendedAction).toBe("ALLOW_SIGNING");
    expect(audit.policyGuardVerdict.passesPolicy).toBe(true);
  });

  it("detects and blocks an SPL SetAuthority (AccountOwner) wallet drainer Blink", async () => {
    const { report } = getPresetReport("drainer-set-authority");

    expect(report.deterministicClassification).toBe("CRITICAL");
    expect(report.deterministicRiskScore).toBeGreaterThanOrEqual(85);
    expect(
      report.threatFlags.some((f) => f.code === "OWNER_AUTHORITY_HIJACK")
    ).toBe(true);
    expect(
      report.threatFlags.some((f) => f.code === "SOL_DRAIN_TRANSFER")
    ).toBe(true);

    const audit = await auditTransactionWithVenice(report, {
      maxAllowedRiskScore: 35,
      maxDailyLamports: 5_000_000_000,
    });

    expect(audit.classification).toBe("CRITICAL");
    expect(audit.recommendedAction).toBe("BLOCK_IMMEDIATELY");
    expect(audit.policyGuardVerdict.passesPolicy).toBe(false);
  });

  it("detects and blocks Token-2022 unverified TransferHook and PermanentDelegate extensions", async () => {
    const { report } = getPresetReport("token2022-malicious-hook");

    expect(report.hasUnverifiedTransferHook).toBe(true);
    expect(
      report.threatFlags.some(
        (f) => f.code === "TOKEN_2022_UNVERIFIED_TRANSFER_HOOK"
      )
    ).toBe(true);
    expect(
      report.threatFlags.some(
        (f) => f.code === "TOKEN_2022_PERMANENT_DELEGATE"
      )
    ).toBe(true);

    const audit = await auditTransactionWithVenice(report, {
      maxAllowedRiskScore: 50,
      blockUnknownTransferHooks: true,
    });

    expect(audit.classification).toBe("CRITICAL");
    expect(audit.policyGuardVerdict.passesPolicy).toBe(false);
    expect(audit.policyGuardVerdict.reason).toContain(
      "UnverifiedTransferHookBlocked"
    );
  });

  it("flags unlimited SPL ApproveChecked delegate allowance and enforces policy threshold", async () => {
    const { report } = getPresetReport("warning-unlimited-approve");

    expect(
      report.threatFlags.some((f) => f.code === "UNLIMITED_DELEGATE_APPROVAL")
    ).toBe(true);
    expect(report.deterministicRiskScore).toBeGreaterThanOrEqual(50);

    const strictAudit = await auditTransactionWithVenice(report, {
      maxAllowedRiskScore: 35,
    });
    expect(strictAudit.policyGuardVerdict.passesPolicy).toBe(false);
  });

  it("enforces 24h rolling daily lamport spend limit in Anchor Policy evaluation", async () => {
    const { report } = getPresetReport("safe-jupiter-swap");
    report.estimatedSpendLamports = 8_000_000_000; // 8 SOL spend

    const audit = await auditTransactionWithVenice(report, {
      maxAllowedRiskScore: 35,
      maxDailyLamports: 5_000_000_000, // 5 SOL daily cap
    });

    expect(audit.policyGuardVerdict.passesPolicy).toBe(false);
    expect(audit.policyGuardVerdict.reason).toContain(
      "DailySpendLimitExceeded"
    );
  });

  it("deterministically derives the canonical SecurityPolicy PDA", () => {
    const wallet = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const first = deriveSecurityPolicyPda(wallet);
    const second = deriveSecurityPolicyPda(wallet);

    expect(first.pda).toBe(second.pda);
    expect(first.bump).toBe(second.bump);
    expect(first.pda.length).toBeGreaterThan(30);
  });

  it("parses natural-language Solana DeFi intents accurately", async () => {
    const parsed = await parseDeFiIntentWithVenice(
      "Swap 3.25 SOL to USDC via Jupiter with 0.4% max slippage"
    );
    expect(parsed.action).toBe("SWAP");
    expect(parsed.amount).toBe(3.25);
    expect(parsed.inputToken).toBe("SOL");
    expect(parsed.outputToken).toBe("USDC");
    expect(parsed.maxSlippageBps).toBe(40);
  });
});
