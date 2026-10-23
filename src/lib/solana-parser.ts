import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  SystemInstruction,
} from "@solana/web3.js";

export interface DecodedInstructionInfo {
  index: number;
  programId: string;
  programName: string;
  isVerifiedProgram: boolean;
  instructionName: string;
  accounts: {
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
    role?: string;
  }[];
  dataHex: string;
  warnings: string[];
}

export interface BalanceDelta {
  asset: string;
  mint: string;
  deltaUiAmount: number;
  direction: "IN" | "OUT";
  isToken2022?: boolean;
}

export interface ThreatFlag {
  code:
    | "OWNER_AUTHORITY_HIJACK"
    | "UNLIMITED_DELEGATE_APPROVAL"
    | "TOKEN_2022_PERMANENT_DELEGATE"
    | "TOKEN_2022_UNVERIFIED_TRANSFER_HOOK"
    | "UNKNOWN_EXTERNAL_PROGRAM"
    | "SOL_DRAIN_TRANSFER"
    | "BLINK_ENDPOINT_UNVERIFIED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  instructionIndex?: number;
}

export interface DeterministicSimulationReport {
  sourceType: "BASE64_TX" | "BLINK_URL" | "PRESET_SCENARIO" | "INTENT_BUILD";
  feePayer: string;
  recentBlockhash: string;
  instructions: DecodedInstructionInfo[];
  balanceDeltas: BalanceDelta[];
  threatFlags: ThreatFlag[];
  deterministicRiskScore: number;
  deterministicClassification: "SAFE" | "WARNING" | "CRITICAL";
  hasUnverifiedTransferHook: boolean;
  estimatedSpendLamports: number;
}

/**
 * Curated registry of verified Solana mainnet/devnet programs.
 */
export const KNOWN_SOLANA_PROGRAMS: Record<
  string,
  { name: string; verified: boolean; category: string }
> = {
  "11111111111111111111111111111111": {
    name: "System Program",
    verified: true,
    category: "Core",
  },
  ComputeBudget111111111111111111111111111111: {
    name: "Compute Budget Program",
    verified: true,
    category: "Core",
  },
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: {
    name: "SPL Token Program",
    verified: true,
    category: "Token",
  },
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: {
    name: "SPL Token-2022 (Token Extensions)",
    verified: true,
    category: "Token-2022",
  },
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: {
    name: "Associated Token Account Program",
    verified: true,
    category: "Core",
  },
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: {
    name: "Jupiter v6 Aggregator",
    verified: true,
    category: "DeFi",
  },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": {
    name: "Raydium Liquidity Pool V4",
    verified: true,
    category: "DeFi",
  },
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: {
    name: "SPL Memo Program",
    verified: true,
    category: "Utility",
  },
  Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS: {
    name: "SolShield Policy Guard Program (Anchor)",
    verified: true,
    category: "Security",
  },
};

/**
 * Decodes an SPL Token or Token-2022 instruction tag (first byte) into human-readable form
 * and detects high-risk authority / delegate / extension operations.
 */
function inspectSplTokenInstruction(
  programId: string,
  data: Uint8Array,
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[],
  ixIndex: number
): {
  instructionName: string;
  warnings: string[];
  threats: ThreatFlag[];
  hasUnverifiedTransferHook: boolean;
} {
  const warnings: string[] = [];
  const threats: ThreatFlag[] = [];
  let hasUnverifiedTransferHook = false;
  const isToken2022 =
    programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  if (data.length === 0) {
    return {
      instructionName: "UnknownEmptyTokenInstruction",
      warnings,
      threats,
      hasUnverifiedTransferHook,
    };
  }

  const tag = data[0];

  switch (tag) {
    case 3:
    case 12: {
      // Transfer (3) or TransferChecked (12)
      const ixName = tag === 12 ? "TransferChecked" : "Transfer";
      // Check if Token-2022 transfer includes extra accounts (e.g. TransferHook external program)
      if (isToken2022 && accounts.length > 4) {
        const extraProgram = accounts[4]?.pubkey;
        const isKnownHook =
          extraProgram && Boolean(KNOWN_SOLANA_PROGRAMS[extraProgram]?.verified);
        if (!isKnownHook) {
          hasUnverifiedTransferHook = true;
          const warnMsg = `Token-2022 TransferChecked invokes unverified TransferHook program (${extraProgram ?? "unknown"}).`;
          warnings.push(warnMsg);
          threats.push({
            code: "TOKEN_2022_UNVERIFIED_TRANSFER_HOOK",
            severity: "CRITICAL",
            title: "Unverified Token-2022 Transfer Hook CPI",
            description:
              "This Token-2022 transfer executes custom third-party hook code during transfer, which can block sales (honeypot) or manipulate state.",
            instructionIndex: ixIndex,
          });
        }
      }
      return {
        instructionName: isToken2022 ? `Token2022::${ixName}` : `SPL::${ixName}`,
        warnings,
        threats,
        hasUnverifiedTransferHook,
      };
    }

    case 4:
    case 13: {
      // Approve (4) or ApproveChecked (13)
      const delegateAccount = accounts[1]?.pubkey ?? "UnknownDelegate";
      warnings.push(
        `Grants token spending allowance (Delegate) to ${delegateAccount}.`
      );
      threats.push({
        code: "UNLIMITED_DELEGATE_APPROVAL",
        severity: "HIGH",
        title: "Token Delegate Allowance Approval",
        description: `Approves external account (${delegateAccount.slice(0, 8)}...) to spend tokens from your token account without requiring your future signature.`,
        instructionIndex: ixIndex,
      });
      return {
        instructionName:
          tag === 13 ? "ApproveChecked (Delegate)" : "Approve (Delegate)",
        warnings,
        threats,
        hasUnverifiedTransferHook,
      };
    }

    case 6: {
      // SetAuthority (6) — #1 most dangerous silent wallet drainer vector on Solana
      const authorityTypeByte = data[1] ?? 255;
      const authorityTypeNames: Record<number, string> = {
        0: "MintTokens",
        1: "FreezeAccount",
        2: "AccountOwner",
        3: "CloseAccount",
      };
      const authType =
        authorityTypeNames[authorityTypeByte] ?? `Type(${authorityTypeByte})`;
      warnings.push(
        `CRITICAL: Reassigns ${authType} authority of your account to another address!`
      );
      threats.push({
        code: "OWNER_AUTHORITY_HIJACK",
        severity: "CRITICAL",
        title: `Silent Account Authority Hijack (SetAuthority::${authType})`,
        description:
          "This instruction permanently transfers ownership/control of your token account to an external attacker address. Classic Solana wallet drainer pattern.",
        instructionIndex: ixIndex,
      });
      return {
        instructionName: `SetAuthority (${authType})`,
        warnings,
        threats,
        hasUnverifiedTransferHook,
      };
    }

    case 35: {
      // Token-2022 PermanentDelegate extension initialization / invocation
      warnings.push(
        "Token-2022 PermanentDelegate extension detected: issuer can transfer or burn tokens from any holder at any time."
      );
      threats.push({
        code: "TOKEN_2022_PERMANENT_DELEGATE",
        severity: "CRITICAL",
        title: "Token-2022 Permanent Delegate Active",
        description:
          "The token mint configures a Permanent Delegate authority capable of seizing or burning tokens from your wallet unconditionally.",
        instructionIndex: ixIndex,
      });
      return {
        instructionName: "Token2022::PermanentDelegateExtension",
        warnings,
        threats,
        hasUnverifiedTransferHook,
      };
    }

    default:
      return {
        instructionName: isToken2022
          ? `Token2022::Instruction(tag=${tag})`
          : `SPL::Instruction(tag=${tag})`,
        warnings,
        threats,
        hasUnverifiedTransferHook,
      };
  }
}

/**
 * Decodes a Base64-encoded Solana transaction (Legacy or Versioned V0)
 * and runs deterministic threat analysis.
 */
export function analyzeBase64Transaction(
  base64Payload: string
): DeterministicSimulationReport {
  const cleaned = base64Payload.trim();
  const buffer = Buffer.from(cleaned, "base64");

  if (buffer.length < 32) {
    throw new Error(
      "Invalid transaction payload: Base64 buffer is too short to be a valid Solana transaction."
    );
  }

  const instructions: DecodedInstructionInfo[] = [];
  const threatFlags: ThreatFlag[] = [];
  const balanceDeltas: BalanceDelta[] = [];
  let feePayer = "UnknownFeePayer";
  let recentBlockhash = "UnknownBlockhash";
  let hasUnverifiedTransferHook = false;
  let estimatedSpendLamports = 5000; // Base network fee

  try {
    // Attempt Legacy Transaction decode first
    const legacyTx = Transaction.from(buffer);
    feePayer = legacyTx.feePayer?.toBase58() ?? "UnknownFeePayer";
    recentBlockhash = legacyTx.recentBlockhash ?? "UnknownBlockhash";

    legacyTx.instructions.forEach((ix, idx) => {
      const programId = ix.programId.toBase58();
      const known = KNOWN_SOLANA_PROGRAMS[programId];
      const isVerified = Boolean(known?.verified);
      const programName = known?.name ?? "Unverified External Program";
      const warnings: string[] = [];
      let instructionName = "CustomInstruction";

      const accounts = ix.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      }));

      if (programId === SystemProgram.programId.toBase58()) {
        try {
          const sysType = SystemInstruction.decodeInstructionType(ix);
          instructionName = `System::${sysType}`;
          if (sysType === "Transfer") {
            const decodedTransfer = SystemInstruction.decodeTransfer(ix);
            const lamports = Number(decodedTransfer.lamports);
            estimatedSpendLamports += lamports;
            const solAmount = lamports / 1e9;
            balanceDeltas.push({
              asset: "SOL",
              mint: "So11111111111111111111111111111111111111112",
              deltaUiAmount: -solAmount,
              direction: "OUT",
            });
            if (solAmount >= 5) {
              warnings.push(
                `Large native SOL transfer (${solAmount.toFixed(4)} SOL) to ${decodedTransfer.toPubkey.toBase58()}.`
              );
              threatFlags.push({
                code: "SOL_DRAIN_TRANSFER",
                severity: "HIGH",
                title: `Direct Native SOL Transfer (${solAmount.toFixed(2)} SOL)`,
                description: `Transfers ${solAmount.toFixed(4)} SOL directly to recipient ${decodedTransfer.toPubkey.toBase58().slice(0, 8)}... with no escrow or swap return guaranteed.`,
                instructionIndex: idx,
              });
            }
          }
        } catch {
          instructionName = "System::Instruction";
        }
      } else if (
        programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
        programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
      ) {
        const tokenInspect = inspectSplTokenInstruction(
          programId,
          ix.data,
          accounts,
          idx
        );
        instructionName = tokenInspect.instructionName;
        warnings.push(...tokenInspect.warnings);
        threatFlags.push(...tokenInspect.threats);
        if (tokenInspect.hasUnverifiedTransferHook) {
          hasUnverifiedTransferHook = true;
        }
      } else if (
        programId === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
      ) {
        instructionName = "JupiterV6::SharedAccountsRoute";
      } else if (
        programId === "ComputeBudget111111111111111111111111111111"
      ) {
        instructionName = "ComputeBudget::SetComputeUnitPrice";
      } else if (
        programId === "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
      ) {
        instructionName = "SolShieldPolicy::VerifyAndRecordExecution";
      } else if (!isVerified) {
        warnings.push(
          `Invokes unverified external program ${programId}. Verify contract source before signing.`
        );
        threatFlags.push({
          code: "UNKNOWN_EXTERNAL_PROGRAM",
          severity: "MEDIUM",
          title: "Unverified External Program Invocation",
          description: `Instruction #${idx + 1} calls an unverified smart contract (${programId.slice(0, 10)}...) not present in the SolShield trusted program registry.`,
          instructionIndex: idx,
        });
      }

      instructions.push({
        index: idx,
        programId,
        programName,
        isVerifiedProgram: isVerified,
        instructionName,
        accounts,
        dataHex: Buffer.from(ix.data).toString("hex").slice(0, 64),
        warnings,
      });
    });
  } catch {
    // Fallback to VersionedTransaction (V0) deserialization
    const vTx = VersionedTransaction.deserialize(buffer);
    const msg = vTx.message;
    const staticKeys = msg.staticAccountKeys;
    feePayer = staticKeys[0]?.toBase58() ?? "UnknownFeePayer";
    recentBlockhash = msg.recentBlockhash;

    msg.compiledInstructions.forEach((cIx, idx) => {
      const programKey = staticKeys[cIx.programIdIndex];
      const programId = programKey
        ? programKey.toBase58()
        : new PublicKey( new Uint8Array(32) ).toBase58();
      const known = KNOWN_SOLANA_PROGRAMS[programId];
      const isVerified = Boolean(known?.verified);
      const programName = known?.name ?? "Unverified External Program";
      const warnings: string[] = [];
      let instructionName = "VersionedInstruction";

      const accounts = cIx.accountKeyIndexes.map((keyIdx) => {
        const pubkey = staticKeys[keyIdx]?.toBase58() ?? `ALT_Account_${keyIdx}`;
        return {
          pubkey,
          isSigner: msg.isAccountSigner(keyIdx),
          isWritable: msg.isAccountWritable(keyIdx),
        };
      });

      if (
        programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
        programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
      ) {
        const tokenInspect = inspectSplTokenInstruction(
          programId,
          cIx.data,
          accounts,
          idx
        );
        instructionName = tokenInspect.instructionName;
        warnings.push(...tokenInspect.warnings);
        threatFlags.push(...tokenInspect.threats);
        if (tokenInspect.hasUnverifiedTransferHook) {
          hasUnverifiedTransferHook = true;
        }
      } else if (!isVerified) {
        warnings.push(`Invokes unverified program ${programId}.`);
        threatFlags.push({
          code: "UNKNOWN_EXTERNAL_PROGRAM",
          severity: "MEDIUM",
          title: "Unverified External Program Invocation",
          description: `V0 Instruction #${idx + 1} invokes an unverified contract (${programId.slice(0, 10)}...).`,
          instructionIndex: idx,
        });
      }

      instructions.push({
        index: idx,
        programId,
        programName,
        isVerifiedProgram: isVerified,
        instructionName,
        accounts,
        dataHex: Buffer.from(cIx.data).toString("hex").slice(0, 64),
        warnings,
      });
    });
  }

  const { score, classification } = calculateDeterministicScore(threatFlags);

  return {
    sourceType: "BASE64_TX",
    feePayer,
    recentBlockhash,
    instructions,
    balanceDeltas,
    threatFlags,
    deterministicRiskScore: score,
    deterministicClassification: classification,
    hasUnverifiedTransferHook,
    estimatedSpendLamports,
  };
}

/**
 * Computes a deterministic 0-100 risk score and classification from threat flags.
 */
export function calculateDeterministicScore(threats: ThreatFlag[]): {
  score: number;
  classification: "SAFE" | "WARNING" | "CRITICAL";
} {
  if (threats.length === 0) {
    return { score: 8, classification: "SAFE" };
  }

  let total = 10;
  for (const t of threats) {
    if (t.severity === "CRITICAL") total += 75;
    else if (t.severity === "HIGH") total += 45;
    else if (t.severity === "MEDIUM") total += 25;
    else total += 10;
  }

  const score = Math.min(99, total);
  const classification =
    score >= 70 ? "CRITICAL" : score >= 35 ? "WARNING" : "SAFE";

  return { score, classification };
}
