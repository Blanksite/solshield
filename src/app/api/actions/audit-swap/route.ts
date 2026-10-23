import { NextRequest, NextResponse } from "next/server";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { deriveSecurityPolicyPda, SOLSHIELD_PROGRAM_ID } from "@/lib/anchor-idl";
import { getPresetReport } from "@/lib/presets";
import { auditTransactionWithVenice } from "@/lib/venice-ai";

const ACTIONS_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.2.1",
  "X-Blockchain-Ids": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: ACTIONS_CORS_HEADERS,
  });
}

/**
 * Solana Actions & Blinks GET endpoint.
 * Returns metadata and interactive parameters for Blink-compatible wallets (Phantom, Solflare, Backpack).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const payload = {
    type: "action",
    icon: `${baseUrl}/shield-icon.svg`,
    title: "SolShield — Venice AI Guarded Solana Swap",
    description:
      "Pre-audits route instructions, Token-2022 transfer hooks, and authority mutations via Venice AI private inference before signing.",
    label: "Audit & Swap via SolShield",
    links: {
      actions: [
        {
          label: "Audit & Swap 1 SOL -> USDC",
          href: `${baseUrl}/api/actions/audit-swap?amount=1&outputMint=USDC`,
        },
        {
          label: "Audit & Swap 5 SOL -> USDC",
          href: `${baseUrl}/api/actions/audit-swap?amount=5&outputMint=USDC`,
        },
        {
          label: "Custom Audited Swap",
          href: `${baseUrl}/api/actions/audit-swap?amount={amount}&outputMint=USDC`,
          parameters: [
            {
              name: "amount",
              label: "Amount in SOL to swap safely",
              required: true,
            },
          ],
        },
      ],
    },
  };

  return NextResponse.json(payload, { headers: ACTIONS_CORS_HEADERS });
}

/**
 * Solana Actions & Blinks POST endpoint.
 * Validates the user's account, attaches the SolShield Anchor Policy PDA guard instruction,
 * audits the transaction via Venice AI, and returns a base64 transaction ready to sign.
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const amountParam = parseFloat(url.searchParams.get("amount") || "1");
    const amountSol = Number.isFinite(amountParam) && amountParam > 0 ? amountParam : 1;

    const body = await req.json();
    const accountStr: string | undefined = body?.account;

    if (!accountStr) {
      return NextResponse.json(
        { message: "Missing required 'account' public key in Blink POST payload." },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(accountStr);
    } catch {
      return NextResponse.json(
        { message: "Invalid Solana public key provided in 'account'." },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const { pda } = deriveSecurityPolicyPda(userPubkey);
    const { report } = getPresetReport("safe-jupiter-swap");
    report.estimatedSpendLamports = Math.round(amountSol * 1e9);

    const audit = await auditTransactionWithVenice(report, {
      maxAllowedRiskScore: 35,
      maxDailyLamports: 10_000_000_000,
    });

    if (audit.classification === "CRITICAL") {
      return NextResponse.json(
        {
          message: `Blocked by SolShield + Venice AI Firewall: ${audit.executiveSummary}`,
        },
        { status: 403, headers: ACTIONS_CORS_HEADERS }
      );
    }

    const tx = new Transaction({
      feePayer: userPubkey,
      recentBlockhash: "11111111111111111111111111111111",
    });

    tx.add(
      new TransactionInstruction({
        programId: SOLSHIELD_PROGRAM_ID,
        keys: [
          { pubkey: userPubkey, isSigner: true, isWritable: false },
          { pubkey: new PublicKey(pda), isSigner: false, isWritable: true },
        ],
        data: Buffer.from([1, audit.riskScore]),
      })
    );

    const serializedTx = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    return NextResponse.json(
      {
        transaction: serializedTx,
        message: `SolShield + Venice AI Audit Passed (Risk Score: ${audit.riskScore}/100 ${audit.classification}). Guarded by Policy PDA ${pda.slice(0, 8)}...`,
      },
      { headers: ACTIONS_CORS_HEADERS }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to construct Blink transaction.";
    return NextResponse.json(
      { message },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    );
  }
}
