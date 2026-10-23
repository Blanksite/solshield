import { PublicKey } from "@solana/web3.js";

export const SOLSHIELD_PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

export const SOLSHIELD_POLICY_SEED = "solshield_policy";

/**
 * Deterministically derives the `SecurityPolicy` PDA address and canonical bump seed
 * for a given wallet owner public key.
 */
export function deriveSecurityPolicyPda(ownerPubkey: string | PublicKey): {
  pda: string;
  bump: number;
} {
  const ownerKey =
    typeof ownerPubkey === "string"
      ? new PublicKey(ownerPubkey)
      : ownerPubkey;

  const [pdaKey, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(SOLSHIELD_POLICY_SEED, "utf-8"), ownerKey.toBuffer()],
    SOLSHIELD_PROGRAM_ID
  );

  return {
    pda: pdaKey.toBase58(),
    bump,
  };
}

export const SOLSHIELD_IDL_SUMMARY = {
  version: "0.1.0",
  name: "solshield_policy",
  programId: SOLSHIELD_PROGRAM_ID.toBase58(),
  instructions: [
    {
      name: "initialize_policy",
      args: [
        "max_daily_spend_lamports: u64",
        "max_allowed_risk_score: u8",
        "block_unknown_transfer_hooks: bool",
      ],
      pdaSeeds: '["solshield_policy", owner.key().as_ref()]',
    },
    {
      name: "update_policy",
      args: [
        "max_daily_spend_lamports: u64",
        "max_allowed_risk_score: u8",
        "block_unknown_transfer_hooks: bool",
      ],
      securityChecks: ["has_one = owner", "Signer<'info>", "!emergency_locked"],
    },
    {
      name: "manage_whitelist",
      args: ["target_program: Pubkey", "allow: bool"],
      securityChecks: ["MAX_WHITELISTED_PROGRAMS <= 16", "has_one = owner"],
    },
    {
      name: "set_emergency_lock",
      args: ["locked: bool"],
      securityChecks: ["Instant circuit-breaker by owner Signer"],
    },
    {
      name: "verify_and_record_execution",
      args: [
        "target_program: Pubkey",
        "spend_lamports: u64",
        "venice_risk_score: u8",
        "has_unverified_transfer_hook: bool",
        "intent_digest: [u8; 32]",
      ],
      securityChecks: [
        "24h rolling window reset via Clock::get()?.unix_timestamp",
        "checked_add / checked_sub overflow protection",
        "venice_risk_score <= policy.max_allowed_risk_score",
      ],
    },
  ],
};
