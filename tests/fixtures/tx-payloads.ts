import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  DeterministicSimulationReport,
  analyzeBase64Transaction,
} from "../../src/lib/solana-parser";

export interface TxTestFixture {
  id: string;
  name: string;
  subtitle: string;
  badge: "SAFE" | "WARNING" | "CRITICAL";
  blinkActionUrl: string;
  base64Transaction: string;
  simulatedBalanceDeltas: {
    asset: string;
    mint: string;
    deltaUiAmount: number;
    direction: "IN" | "OUT";
    isToken2022?: boolean;
  }[];
  contextNotes: string;
}

const TEST_WALLET = new PublicKey(
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
);
const TEST_ATTACKER = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);
const TEST_HOOK_PROGRAM = new PublicKey(
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
);
const SPL_TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const JUPITER_V6_PROGRAM = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);
const COMPUTE_BUDGET_PROGRAM = new PublicKey(
  "ComputeBudget111111111111111111111111111111"
);
const SOLSHIELD_POLICY_PROGRAM = new PublicKey(
  "ByiifxwsDxRwMDiZU7TYceFsxT9XawGqffS5oTocwHE4"
);
const TEST_BLOCKHASH = "11111111111111111111111111111111";

function buildSafeJupiterSwapBase64(): string {
  const tx = new Transaction({
    feePayer: TEST_WALLET,
    recentBlockhash: TEST_BLOCKHASH,
  });

  tx.add(
    new TransactionInstruction({
      programId: COMPUTE_BUDGET_PROGRAM,
      keys: [],
      data: Buffer.from([3, 16, 39, 0, 0, 0, 0, 0, 0]),
    })
  );

  tx.add(
    new TransactionInstruction({
      programId: SOLSHIELD_POLICY_PROGRAM,
      keys: [
        { pubkey: TEST_WALLET, isSigner: true, isWritable: false },
        { pubkey: SOLSHIELD_POLICY_PROGRAM, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([1, 0, 200, 10]),
    })
  );

  tx.add(
    new TransactionInstruction({
      programId: JUPITER_V6_PROGRAM,
      keys: [
        { pubkey: TEST_WALLET, isSigner: true, isWritable: true },
        { pubkey: SPL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([193, 32, 155, 51, 65, 214, 156, 129, 50, 0]),
    })
  );

  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

function buildSetAuthorityDrainerBase64(): string {
  const tx = new Transaction({
    feePayer: TEST_WALLET,
    recentBlockhash: TEST_BLOCKHASH,
  });

  const setAuthData = Buffer.concat([
    Buffer.from([6, 2, 1]),
    TEST_ATTACKER.toBuffer(),
  ]);

  tx.add(
    new TransactionInstruction({
      programId: SPL_TOKEN_PROGRAM,
      keys: [
        { pubkey: TEST_WALLET, isSigner: false, isWritable: true },
        { pubkey: TEST_WALLET, isSigner: true, isWritable: false },
        { pubkey: TEST_ATTACKER, isSigner: false, isWritable: false },
      ],
      data: setAuthData,
    })
  );

  tx.add(
    SystemProgram.transfer({
      fromPubkey: TEST_WALLET,
      toPubkey: TEST_ATTACKER,
      lamports: 12_500_000_000,
    })
  );

  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

function buildToken2022MaliciousHookBase64(): string {
  const tx = new Transaction({
    feePayer: TEST_WALLET,
    recentBlockhash: TEST_BLOCKHASH,
  });

  tx.add(
    new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM,
      keys: [
        { pubkey: TEST_WALLET, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TEST_ATTACKER, isSigner: false, isWritable: true },
        { pubkey: TEST_WALLET, isSigner: true, isWritable: false },
        { pubkey: TEST_HOOK_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([12, 0, 225, 245, 5, 0, 0, 0, 0, 9]),
    })
  );

  tx.add(
    new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM,
      keys: [
        { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: true },
        { pubkey: TEST_ATTACKER, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([35, 1]),
    })
  );

  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

function buildUnlimitedApproveBlinkBase64(): string {
  const tx = new Transaction({
    feePayer: TEST_WALLET,
    recentBlockhash: TEST_BLOCKHASH,
  });

  tx.add(
    new TransactionInstruction({
      programId: SPL_TOKEN_PROGRAM,
      keys: [
        { pubkey: TEST_WALLET, isSigner: false, isWritable: true },
        { pubkey: TEST_HOOK_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TEST_WALLET, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([13, 255, 255, 255, 255, 255, 255, 255, 255, 6]),
    })
  );

  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

export const TX_TEST_FIXTURES: TxTestFixture[] = [
  {
    id: "safe-jupiter-swap",
    name: "Safe Jupiter v6 Swap (SOL -> USDC)",
    subtitle: "Verified aggregator route guarded by SolShield Anchor Policy PDA",
    badge: "SAFE",
    blinkActionUrl:
      "solana-action:https://sol-shield.xyz/api/actions/audit-swap?inputMint=SOL&outputMint=USDC&amount=1.5",
    base64Transaction: buildSafeJupiterSwapBase64(),
    simulatedBalanceDeltas: [
      {
        asset: "SOL",
        mint: "So11111111111111111111111111111111111111112",
        deltaUiAmount: -1.5,
        direction: "OUT",
      },
      {
        asset: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        deltaUiAmount: 279.45,
        direction: "IN",
      },
    ],
    contextNotes:
      "Standard Jupiter v6 swap with ComputeBudget priority fee and SolShield Policy PDA verification.",
  },
  {
    id: "drainer-set-authority",
    name: "Phishing Blink: SPL SetAuthority + SOL Drainer",
    subtitle:
      "Disguised as 'Free Airdrop Claim' Blink — silently hijacks USDC ATA ownership",
    badge: "CRITICAL",
    blinkActionUrl:
      "solana-action:https://claim-bonk-reward-drop.xyz/api/actions/claim",
    base64Transaction: buildSetAuthorityDrainerBase64(),
    simulatedBalanceDeltas: [
      {
        asset: "SOL",
        mint: "So11111111111111111111111111111111111111112",
        deltaUiAmount: -12.5,
        direction: "OUT",
      },
      {
        asset: "USDC (Authority Lost)",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        deltaUiAmount: -4250.0,
        direction: "OUT",
      },
    ],
    contextNotes:
      "Attacker uses SPL Token SetAuthority (AuthorityType::AccountOwner) to permanently seize the user's token account.",
  },
  {
    id: "token2022-malicious-hook",
    name: "Token-2022 Honeypot: Unverified TransferHook + PermanentDelegate",
    subtitle:
      "Token Extensions mint with hidden clawback delegate & custom transfer hook CPI",
    badge: "CRITICAL",
    blinkActionUrl:
      "solana-action:https://sol-shield.xyz/api/actions/audit-swap?mint=TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    base64Transaction: buildToken2022MaliciousHookBase64(),
    simulatedBalanceDeltas: [
      {
        asset: "RWA-X (Token-2022)",
        mint: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        deltaUiAmount: -100.0,
        direction: "OUT",
        isToken2022: true,
      },
    ],
    contextNotes:
      "Uses SPL Token-2022 extensions: invokes an unverified TransferHook program and enables PermanentDelegate clawback.",
  },
  {
    id: "warning-unlimited-approve",
    name: "DeFi Yield Blink: Unlimited Token Delegate Approval",
    subtitle:
      "Requests u64::MAX spending allowance via SPL ApproveChecked to unverified vault",
    badge: "WARNING",
    blinkActionUrl:
      "solana-action:https://yield-farm-booster.io/api/actions/stake-usdc",
    base64Transaction: buildUnlimitedApproveBlinkBase64(),
    simulatedBalanceDeltas: [
      {
        asset: "USDC Allowance (Unlimited)",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        deltaUiAmount: -999999,
        direction: "OUT",
      },
    ],
    contextNotes:
      "Grants persistent token delegate authority to an external address without scoping the allowance amount.",
  },
];

export function getTestFixtureReport(fixtureId: string): {
  fixture: TxTestFixture;
  report: DeterministicSimulationReport;
} {
  const fixture =
    TX_TEST_FIXTURES.find((p) => p.id === fixtureId) ?? TX_TEST_FIXTURES[0];
  const report = analyzeBase64Transaction(fixture.base64Transaction);
  report.sourceType = "TEST_FIXTURE";
  if (fixture.simulatedBalanceDeltas.length > 0) {
    report.balanceDeltas = fixture.simulatedBalanceDeltas;
  }
  return { fixture, report };
}
