/**
 * Anchor Integration Test Suite for `programs/solshield-policy/src/lib.rs`
 * Run with `anchor test` when Solana local validator (`solana-test-validator`) is active.
 */
import { PublicKey } from "@solana/web3.js";
import {
  deriveSecurityPolicyPda,
  SOLSHIELD_PROGRAM_ID,
} from "../src/lib/anchor-idl";

export async function verifyAnchorPolicyPdaLayout() {
  const owner = new PublicKey("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV");
  const { pda, bump } = deriveSecurityPolicyPda(owner);

  return {
    programId: SOLSHIELD_PROGRAM_ID.toBase58(),
    owner: owner.toBase58(),
    securityPolicyPda: pda,
    canonicalBump: bump,
  };
}
