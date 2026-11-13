import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createRevokeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  deriveSecurityPolicyPda,
  SOLSHIELD_PROGRAM_ID,
} from "./anchor-idl";

export const SOLANA_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const ANCHOR_PLACEHOLDER_PROGRAM_ID =
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

export interface SerializedInstructionArtifact {
  programId: string;
  policyPda?: string;
  discriminatorHex: string;
  instructionDataBase64: string;
  instructionDataHex: string;
  transactionBase64: string;
  accountCount: number;
  recentBlockhashUsed: string;
  clusterTarget: "devnet";
}

export interface DevnetPolicyVaultStatus {
  cluster: "devnet";
  rpcUrl: string;
  programId: string;
  isPlaceholderTemplateId: boolean;
  programAccountExists: boolean;
  programExecutable: boolean;
  programDeployedOnDevnet: boolean;
  policyPda: string | null;
  policyInitializedOnDevnet: boolean;
  latestDevnetBlockhash: string | null;
  checkedAt: string;
  error?: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Computes the canonical 8-byte Anchor instruction discriminator:
 * `sha256("global:<instruction_snake_case>")[0..8]`.
 */
export async function computeAnchorInstructionDiscriminator(
  instructionName: string
): Promise<Uint8Array> {
  const preimage = new TextEncoder().encode(`global:${instructionName}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", preimage);
  return new Uint8Array(digest).slice(0, 8);
}

function encodePolicyParamsBorsh(
  discriminator: Uint8Array,
  maxDailySpendLamports: number,
  maxAllowedRiskScore: number,
  blockUnknownTransferHooks: boolean
): Uint8Array {
  const safeLamports = BigInt(
    Math.max(1, Math.round(maxDailySpendLamports))
  );
  const safeRisk = Math.max(0, Math.min(100, Math.round(maxAllowedRiskScore)));
  const payload = new Uint8Array(8 + 8 + 1 + 1);
  payload.set(discriminator, 0);
  const view = new DataView(payload.buffer);
  view.setBigUint64(8, safeLamports, true); // u64 little-endian
  view.setUint8(16, safeRisk); // u8
  view.setUint8(17, blockUnknownTransferHooks ? 1 : 0); // bool
  return payload;
}

function serializeUnsignedLegacyTx(
  feePayer: PublicKey,
  instruction: TransactionInstruction,
  recentBlockhash?: string
): { transactionBase64: string; blockhashUsed: string } {
  const blockhashUsed = recentBlockhash?.trim() || PLACEHOLDER_BLOCKHASH;
  const tx = new Transaction({
    feePayer,
    recentBlockhash: blockhashUsed,
  }).add(instruction);

  const bytes = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    transactionBase64: bytesToBase64(bytes),
    blockhashUsed,
  };
}

/**
 * Builds an Anchor v0.30.1 `initialize_policy` instruction and serialized transaction
 * targeting the derived `["solshield_policy", owner]` PDA.
 */
export async function buildInitializePolicyTransaction(params: {
  owner: string | PublicKey;
  maxDailySpendLamports: number;
  maxAllowedRiskScore: number;
  blockUnknownTransferHooks?: boolean;
  recentBlockhash?: string;
}): Promise<SerializedInstructionArtifact> {
  const ownerKey =
    typeof params.owner === "string"
      ? new PublicKey(params.owner)
      : params.owner;
  const { pda } = deriveSecurityPolicyPda(ownerKey);
  const discriminator = await computeAnchorInstructionDiscriminator(
    "initialize_policy"
  );
  const data = encodePolicyParamsBorsh(
    discriminator,
    params.maxDailySpendLamports,
    params.maxAllowedRiskScore,
    params.blockUnknownTransferHooks ?? true
  );

  const ix = new TransactionInstruction({
    programId: SOLSHIELD_PROGRAM_ID,
    keys: [
      { pubkey: ownerKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(pda), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const { transactionBase64, blockhashUsed } = serializeUnsignedLegacyTx(
    ownerKey,
    ix,
    params.recentBlockhash
  );

  return {
    programId: SOLSHIELD_PROGRAM_ID.toBase58(),
    policyPda: pda,
    discriminatorHex: bytesToHex(discriminator),
    instructionDataBase64: bytesToBase64(data),
    instructionDataHex: bytesToHex(data),
    transactionBase64,
    accountCount: ix.keys.length,
    recentBlockhashUsed: blockhashUsed,
    clusterTarget: "devnet",
  };
}

/**
 * Builds an Anchor v0.30.1 `update_policy` instruction and serialized transaction.
 */
export async function buildUpdatePolicyTransaction(params: {
  owner: string | PublicKey;
  maxDailySpendLamports: number;
  maxAllowedRiskScore: number;
  blockUnknownTransferHooks?: boolean;
  recentBlockhash?: string;
}): Promise<SerializedInstructionArtifact> {
  const ownerKey =
    typeof params.owner === "string"
      ? new PublicKey(params.owner)
      : params.owner;
  const { pda } = deriveSecurityPolicyPda(ownerKey);
  const discriminator = await computeAnchorInstructionDiscriminator(
    "update_policy"
  );
  const data = encodePolicyParamsBorsh(
    discriminator,
    params.maxDailySpendLamports,
    params.maxAllowedRiskScore,
    params.blockUnknownTransferHooks ?? true
  );

  const ix = new TransactionInstruction({
    programId: SOLSHIELD_PROGRAM_ID,
    keys: [
      { pubkey: ownerKey, isSigner: true, isWritable: false },
      { pubkey: new PublicKey(pda), isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });

  const { transactionBase64, blockhashUsed } = serializeUnsignedLegacyTx(
    ownerKey,
    ix,
    params.recentBlockhash
  );

  return {
    programId: SOLSHIELD_PROGRAM_ID.toBase58(),
    policyPda: pda,
    discriminatorHex: bytesToHex(discriminator),
    instructionDataBase64: bytesToBase64(data),
    instructionDataHex: bytesToHex(data),
    transactionBase64,
    accountCount: ix.keys.length,
    recentBlockhashUsed: blockhashUsed,
    clusterTarget: "devnet",
  };
}

/**
 * Builds an Anchor v0.30.1 `set_emergency_lock` circuit-breaker instruction and serialized transaction.
 */
export async function buildSetEmergencyLockTransaction(params: {
  owner: string | PublicKey;
  locked: boolean;
  recentBlockhash?: string;
}): Promise<SerializedInstructionArtifact> {
  const ownerKey =
    typeof params.owner === "string"
      ? new PublicKey(params.owner)
      : params.owner;
  const { pda } = deriveSecurityPolicyPda(ownerKey);
  const discriminator = await computeAnchorInstructionDiscriminator(
    "set_emergency_lock"
  );
  const data = new Uint8Array(9);
  data.set(discriminator, 0);
  data[8] = params.locked ? 1 : 0;

  const ix = new TransactionInstruction({
    programId: SOLSHIELD_PROGRAM_ID,
    keys: [
      { pubkey: ownerKey, isSigner: true, isWritable: false },
      { pubkey: new PublicKey(pda), isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });

  const { transactionBase64, blockhashUsed } = serializeUnsignedLegacyTx(
    ownerKey,
    ix,
    params.recentBlockhash
  );

  return {
    programId: SOLSHIELD_PROGRAM_ID.toBase58(),
    policyPda: pda,
    discriminatorHex: bytesToHex(discriminator),
    instructionDataBase64: bytesToBase64(data),
    instructionDataHex: bytesToHex(data),
    transactionBase64,
    accountCount: ix.keys.length,
    recentBlockhashUsed: blockhashUsed,
    clusterTarget: "devnet",
  };
}

const USDC_MINT_KEY = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

/**
 * Deterministically derives the owner's Associated Token Account (ATA) for USDC.
 */
export function deriveUsdcAssociatedTokenAccount(
  owner: string | PublicKey
): string {
  const ownerKey = typeof owner === "string" ? new PublicKey(owner) : owner;
  return getAssociatedTokenAddressSync(USDC_MINT_KEY, ownerKey).toBase58();
}

/**
 * Decodes a base64-serialized unsigned Legacy transaction and submits it to a
 * connected browser wallet provider (`window.solana.signAndSendTransaction`).
 */
export async function submitDevnetArtifactWithWallet(
  artifact: SerializedInstructionArtifact,
  provider: {
    signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
  }
): Promise<string> {
  const raw = Buffer.from(artifact.transactionBase64, "base64");
  const tx = Transaction.from(raw);
  const res = await provider.signAndSendTransaction(tx);
  return res.signature;
}

/**
 * Constructs a real SPL Token / Token-2022 Instruction Tag 5 (`Revoke`) transaction
 * to clear a delegated spender from an SPL token account.
 */
export function buildSplDelegateRevokeTransaction(params: {
  tokenAccount: string | PublicKey;
  owner: string | PublicKey;
  useToken2022?: boolean;
  recentBlockhash?: string;
}): SerializedInstructionArtifact {
  const tokenAccountKey =
    typeof params.tokenAccount === "string"
      ? new PublicKey(params.tokenAccount)
      : params.tokenAccount;
  const ownerKey =
    typeof params.owner === "string"
      ? new PublicKey(params.owner)
      : params.owner;
  const tokenProgramId = params.useToken2022
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  const ix = createRevokeInstruction(
    tokenAccountKey,
    ownerKey,
    [],
    tokenProgramId
  );

  const { transactionBase64, blockhashUsed } = serializeUnsignedLegacyTx(
    ownerKey,
    ix,
    params.recentBlockhash
  );

  const ixBytes = new Uint8Array(ix.data);
  return {
    programId: tokenProgramId.toBase58(),
    discriminatorHex: bytesToHex(ixBytes),
    instructionDataBase64: bytesToBase64(ixBytes),
    instructionDataHex: bytesToHex(ixBytes),
    transactionBase64,
    accountCount: ix.keys.length,
    recentBlockhashUsed: blockhashUsed,
    clusterTarget: "devnet",
  };
}

/**
 * Probes Solana Devnet RPC to report truthfully whether `SOLSHIELD_PROGRAM_ID`
 * is deployed and executable on-chain (and whether owner's Policy PDA exists).
 */
export async function fetchDevnetPolicyVaultStatus(params?: {
  ownerAddress?: string;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
}): Promise<DevnetPolicyVaultStatus> {
  const fetchImpl = params?.fetchImpl ?? fetch;
  const rpcUrl = params?.rpcUrl ?? SOLANA_DEVNET_RPC_URL;
  const programId = SOLSHIELD_PROGRAM_ID.toBase58();
  const isPlaceholderTemplateId = programId === ANCHOR_PLACEHOLDER_PROGRAM_ID;

  let policyPda: string | null = null;
  if (params?.ownerAddress?.trim()) {
    try {
      policyPda = deriveSecurityPolicyPda(params.ownerAddress.trim()).pda;
    } catch {
      policyPda = null;
    }
  }

  const keysToQuery = policyPda ? [programId, policyPda] : [programId];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const [accountsRes, bhRes] = await Promise.all([
      fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getMultipleAccounts",
          params: [keysToQuery, { encoding: "base64", commitment: "confirmed" }],
        }),
      }),
      fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "getLatestBlockhash",
          params: [{ commitment: "confirmed" }],
        }),
      }),
    ]);

    const accountsJson = (await accountsRes.json().catch(() => null)) as {
      result?: { value?: Array<{ executable?: boolean } | null> };
    } | null;
    const bhJson = (await bhRes.json().catch(() => null)) as {
      result?: { value?: { blockhash?: string } };
    } | null;

    const values = accountsJson?.result?.value ?? [];
    const programInfo = values[0] ?? null;
    const policyInfo = policyPda ? values[1] ?? null : null;

    const programAccountExists = Boolean(programInfo);
    const programExecutable = Boolean(programInfo?.executable);
    const programDeployedOnDevnet =
      programAccountExists && programExecutable && !isPlaceholderTemplateId;

    return {
      cluster: "devnet",
      rpcUrl,
      programId,
      isPlaceholderTemplateId,
      programAccountExists,
      programExecutable,
      programDeployedOnDevnet,
      policyPda,
      policyInitializedOnDevnet: Boolean(policyInfo),
      latestDevnetBlockhash: bhJson?.result?.value?.blockhash ?? null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    return {
      cluster: "devnet",
      rpcUrl,
      programId,
      isPlaceholderTemplateId,
      programAccountExists: false,
      programExecutable: false,
      programDeployedOnDevnet: false,
      policyPda,
      policyInitializedOnDevnet: false,
      latestDevnetBlockhash: null,
      checkedAt: new Date().toISOString(),
      error:
        err instanceof Error
          ? err.message
          : "Unable to reach Solana Devnet RPC.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
