import { Connection, PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  Mint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getDefaultAccountState,
  getExtensionTypes,
  getPausableConfig,
  getPermanentDelegate,
  getTokenMetadata,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from "@solana/spl-token";
import { DEFAULT_VENICE_MODEL, VENICE_API_BASE_URL } from "./venice-ai";

const SOLANA_MAINNET_RPC =
  process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const FALLBACK_SOLANA_RPC = "https://solana-rpc.publicnode.com";

const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export interface TokenRiskFlag {
  code:
    | "MINT_AUTHORITY_ACTIVE"
    | "FREEZE_AUTHORITY_ACTIVE"
    | "TOKEN_2022_PERMANENT_DELEGATE"
    | "TOKEN_2022_TRANSFER_HOOK"
    | "TOKEN_2022_TRANSFER_FEE"
    | "TOKEN_2022_NON_TRANSFERABLE"
    | "TOKEN_2022_DEFAULT_FROZEN"
    | "TOKEN_2022_PAUSABLE"
    | "TOKEN_2022_MINT_CLOSE_AUTHORITY"
    | "HIGH_TOP5_CONCENTRATION"
    | "MODERATE_TOP5_CONCENTRATION"
    | "ZERO_SUPPLY";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
}

export interface TopHolderEntry {
  address: string;
  uiAmount: number;
  pctOfSupply: number;
}

export interface TokenScanReport {
  mintAddress: string;
  tokenProgram: "SPL Token" | "Token-2022";
  programId: string;
  isToken2022: boolean;
  isPumpFunSuffix: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number;
  rawSupply: string;
  supplyUi: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: string[];
  transferFeeBps: number | null;
  permanentDelegate: string | null;
  transferHookProgramId: string | null;
  defaultAccountState: string | null;
  topHolders: TopHolderEntry[];
  top5Pct: number;
  top10Pct: number;
  riskScore: number;
  classification: "SAFE" | "CAUTION" | "CRITICAL";
  recommendedAction: "VERIFIED_SAFE" | "DYOR_CAUTION" | "HIGH_RUG_RISK";
  executiveSummary: string;
  flags: TokenRiskFlag[];
  slot: number;
  latencyMs: number;
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  privacyAttestation: string;
}

const EXTENSION_LABELS: Record<number, string> = {
  [ExtensionType.TransferFeeConfig]: "TransferFeeConfig",
  [ExtensionType.MintCloseAuthority]: "MintCloseAuthority",
  [ExtensionType.ConfidentialTransferMint]: "ConfidentialTransferMint",
  [ExtensionType.DefaultAccountState]: "DefaultAccountState",
  [ExtensionType.ImmutableOwner]: "ImmutableOwner",
  [ExtensionType.NonTransferable]: "NonTransferable",
  [ExtensionType.InterestBearingConfig]: "InterestBearingConfig",
  [ExtensionType.PermanentDelegate]: "PermanentDelegate",
  [ExtensionType.TransferHook]: "TransferHook",
  16: "ConfidentialTransferFee",
  17: "ConfidentialTransferFeeAmount",
  [ExtensionType.MetadataPointer]: "MetadataPointer",
  [ExtensionType.TokenMetadata]: "TokenMetadata",
  [ExtensionType.GroupPointer]: "GroupPointer",
  [ExtensionType.TokenGroup]: "TokenGroup",
  [ExtensionType.GroupMemberPointer]: "GroupMemberPointer",
  [ExtensionType.TokenGroupMember]: "TokenGroupMember",
  24: "ConfidentialMintBurn",
  [ExtensionType.ScaledUiAmountConfig]: "ScaledUiAmountConfig",
  [ExtensionType.PausableConfig]: "PausableConfig",
};

/**
 * Safely extracts `name` and `symbol` from a Metaplex Metadata PDA account buffer.
 */
export function parseMetaplexMetadataNameSymbol(
  data: Buffer | Uint8Array | null | undefined
): { name: string | null; symbol: string | null } {
  if (!data || data.length < 75) {
    return { name: null, symbol: null };
  }

  try {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    // Offset 65 skips key (1) + updateAuthority (32) + mint (32)
    let offset = 65;

    const readBorshString = (): string | null => {
      if (offset + 4 > buf.length) return null;
      const len = buf.readUInt32LE(offset);
      offset += 4;
      if (len > 256 || offset + len > buf.length) return null;
      const raw = buf
        .subarray(offset, offset + len)
        .toString("utf8")
        .replace(/\0/g, "")
        .trim();
      offset += len;
      return raw || null;
    };

    const name = readBorshString();
    const symbol = readBorshString();
    return { name, symbol };
  } catch {
    return { name: null, symbol: null };
  }
}

/**
 * Computes a deterministic on-chain Rug-Shield risk report from an unpacked SPL/Token-2022 Mint
 * and optional largest-accounts concentration data.
 */
export function analyzeMintState(params: {
  mint: Mint;
  programOwner: string;
  largestAccounts?: { address: string; uiAmount: number }[];
  slot?: number;
  metadata?: { name?: string | null; symbol?: string | null };
  latencyMs?: number;
}): TokenScanReport {
  const { mint, programOwner } = params;
  const mintAddress = mint.address.toBase58();
  const isToken2022 = programOwner === TOKEN_2022_PROGRAM_ID.toBase58();
  const isPumpFunSuffix = mintAddress.endsWith("pump");
  const flags: TokenRiskFlag[] = [];
  let riskScore = 0;

  const divisor = Math.pow(10, mint.decimals);
  const supplyUi =
    divisor > 0 ? Number(mint.supply) / divisor : Number(mint.supply);

  if (mint.supply === BigInt(0)) {
    flags.push({
      code: "ZERO_SUPPLY",
      severity: "MEDIUM",
      title: "Zero Circulating Supply",
      description:
        "Mint currently reports 0 total supply on-chain (either pre-minted or fully burned).",
    });
    riskScore += 15;
  }

  if (mint.mintAuthority) {
    flags.push({
      code: "MINT_AUTHORITY_ACTIVE",
      severity: "CRITICAL",
      title: "Mint Authority Still Active",
      description: `Authority ${mint.mintAuthority.toBase58()} can mint unlimited new tokens and dilute holders at any time.`,
    });
    riskScore += 35;
  }

  if (mint.freezeAuthority) {
    flags.push({
      code: "FREEZE_AUTHORITY_ACTIVE",
      severity: "CRITICAL",
      title: "Freeze Authority Active (Blacklist Risk)",
      description: `Authority ${mint.freezeAuthority.toBase58()} can freeze buyer token accounts and block selling.`,
    });
    riskScore += 40;
  }

  const extensions: string[] = [];
  let transferFeeBps: number | null = null;
  let permanentDelegate: string | null = null;
  let transferHookProgramId: string | null = null;
  let defaultAccountState: string | null = null;

  if (isToken2022 && mint.tlvData.length > 0) {
    const extTypes = getExtensionTypes(mint.tlvData);
    for (const ext of extTypes) {
      extensions.push(EXTENSION_LABELS[ext] || `Extension(${ext})`);
    }

    const permDelegate = getPermanentDelegate(mint);
    if (
      permDelegate &&
      permDelegate.delegate &&
      !permDelegate.delegate.equals(PublicKey.default)
    ) {
      permanentDelegate = permDelegate.delegate.toBase58();
      flags.push({
        code: "TOKEN_2022_PERMANENT_DELEGATE",
        severity: "CRITICAL",
        title: "Token-2022 Permanent Delegate Enabled",
        description: `Delegate ${permanentDelegate} has protocol-level clawback authority to burn or transfer tokens directly out of any holder wallet.`,
      });
      riskScore += 45;
    }

    const hook = getTransferHook(mint);
    if (
      hook &&
      hook.programId &&
      !hook.programId.equals(PublicKey.default)
    ) {
      transferHookProgramId = hook.programId.toBase58();
      flags.push({
        code: "TOKEN_2022_TRANSFER_HOOK",
        severity: "HIGH",
        title: "Token-2022 Custom TransferHook Program",
        description: `Every buy/sell executes custom CPI logic in ${transferHookProgramId}, which can restrict or block transfers.`,
      });
      riskScore += 30;
    }

    const feeConfig = getTransferFeeConfig(mint);
    if (feeConfig) {
      transferFeeBps = feeConfig.newerTransferFee.transferFeeBasisPoints;
      if (transferFeeBps > 0) {
        flags.push({
          code: "TOKEN_2022_TRANSFER_FEE",
          severity: transferFeeBps >= 500 ? "HIGH" : "MEDIUM",
          title: `Transfer Fee Tax (${(transferFeeBps / 100).toFixed(2)}%)`,
          description: `Token-2022 automatically deducts ${(
            transferFeeBps / 100
          ).toFixed(2)}% on every transfer.`,
        });
        riskScore += transferFeeBps >= 500 ? 25 : 10;
      }
    }

    const defState = getDefaultAccountState(mint);
    if (defState) {
      defaultAccountState =
        defState.state === 2 ? "Frozen" : defState.state === 1 ? "Initialized" : "Uninitialized";
      if (defState.state === 2) {
        flags.push({
          code: "TOKEN_2022_DEFAULT_FROZEN",
          severity: "CRITICAL",
          title: "New Holder Accounts Default to Frozen",
          description:
            "Every newly created token account starts frozen, preventing transfers unless thawed by the authority.",
        });
        riskScore += 40;
      }
    }

    if (extTypes.includes(ExtensionType.NonTransferable)) {
      flags.push({
        code: "TOKEN_2022_NON_TRANSFERABLE",
        severity: "CRITICAL",
        title: "Non-Transferable Token Extension",
        description:
          "Holders cannot transfer or sell this token on decentralized exchanges.",
      });
      riskScore += 50;
    }

    if (extTypes.includes(ExtensionType.MintCloseAuthority)) {
      flags.push({
        code: "TOKEN_2022_MINT_CLOSE_AUTHORITY",
        severity: "LOW",
        title: "Mint Close Authority Present",
        description:
          "Configured authority can close the mint account once supply reaches zero.",
      });
      riskScore += 5;
    }

    const pausableConfig = getPausableConfig(mint);
    if (
      pausableConfig &&
      (pausableConfig.paused ||
        !pausableConfig.authority.equals(PublicKey.default))
    ) {
      flags.push({
        code: "TOKEN_2022_PAUSABLE",
        severity: pausableConfig.paused ? "CRITICAL" : "HIGH",
        title: pausableConfig.paused
          ? "Token-2022 Transfers Currently PAUSED"
          : "Token-2022 Pausable Authority Active",
        description: `Authority ${pausableConfig.authority.toBase58()} can halt all buys, sells, and transfers at any time.`,
      });
      riskScore += pausableConfig.paused ? 50 : 30;
    }
  }

  const rawHolders = params.largestAccounts || [];
  const topHolders: TopHolderEntry[] = rawHolders.slice(0, 10).map((h) => {
    const pct = supplyUi > 0 ? (h.uiAmount / supplyUi) * 100 : 0;
    return {
      address: h.address,
      uiAmount: h.uiAmount,
      pctOfSupply: Number(pct.toFixed(2)),
    };
  });

  const top5Pct = Number(
    topHolders
      .slice(0, 5)
      .reduce((acc, item) => acc + item.pctOfSupply, 0)
      .toFixed(2)
  );
  const top10Pct = Number(
    topHolders
      .slice(0, 10)
      .reduce((acc, item) => acc + item.pctOfSupply, 0)
      .toFixed(2)
  );

  // Exclude single LP / bonding curve nuance transparently in notes, only add risk above thresholds
  if (top5Pct >= 80 && topHolders.length >= 2) {
    flags.push({
      code: "HIGH_TOP5_CONCENTRATION",
      severity: "HIGH",
      title: `High Top-5 Concentration (${top5Pct}%)`,
      description:
        "Top 5 token accounts hold >= 80% of supply (verify whether the #1 account is a Raydium/Orca LP or liquidity vault before interacting).",
    });
    riskScore += 18;
  } else if (top5Pct >= 55 && topHolders.length >= 2) {
    flags.push({
      code: "MODERATE_TOP5_CONCENTRATION",
      severity: "MEDIUM",
      title: `Elevated Top-5 Concentration (${top5Pct}%)`,
      description:
        "Top 5 accounts hold more than 55% of supply — inspect holder #1 to confirm it belongs to an LP/bonding pool.",
    });
    riskScore += 8;
  }

  const cappedScore = Math.min(100, Math.max(0, riskScore));
  const classification: "SAFE" | "CAUTION" | "CRITICAL" =
    cappedScore >= 55 ? "CRITICAL" : cappedScore >= 20 ? "CAUTION" : "SAFE";
  const recommendedAction: "VERIFIED_SAFE" | "DYOR_CAUTION" | "HIGH_RUG_RISK" =
    classification === "CRITICAL"
      ? "HIGH_RUG_RISK"
      : classification === "CAUTION"
      ? "DYOR_CAUTION"
      : "VERIFIED_SAFE";

  let executiveSummary =
    "Clean mint telemetry: both Mint Authority and Freeze Authority are revoked, with no malicious Token-2022 clawback extensions detected.";

  if (classification === "CRITICAL") {
    const criticalTitles = flags
      .filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH")
      .map((f) => f.title)
      .slice(0, 2)
      .join(" & ");
    executiveSummary = `HIGH RUG / HONEYPOT RISK DETECTED: ${criticalTitles}. Exercise extreme caution before buying or interacting with this token.`;
  } else if (classification === "CAUTION") {
    executiveSummary = `Moderate caution: Mint/Freeze safety checks passed or partial warnings flagged (${
      flags[0]?.title || "inspect top holder distribution"
    }). Verify if the #1 account belongs to a decentralized liquidity pool.`;
  }

  return {
    mintAddress,
    tokenProgram: isToken2022 ? "Token-2022" : "SPL Token",
    programId: programOwner,
    isToken2022,
    isPumpFunSuffix,
    name: params.metadata?.name ?? null,
    symbol: params.metadata?.symbol ?? null,
    decimals: mint.decimals,
    rawSupply: mint.supply.toString(),
    supplyUi,
    mintAuthority: mint.mintAuthority ? mint.mintAuthority.toBase58() : null,
    freezeAuthority: mint.freezeAuthority
      ? mint.freezeAuthority.toBase58()
      : null,
    extensions,
    transferFeeBps,
    permanentDelegate,
    transferHookProgramId,
    defaultAccountState,
    topHolders,
    top5Pct,
    top10Pct,
    riskScore: cappedScore,
    classification,
    recommendedAction,
    executiveSummary,
    flags,
    slot: params.slot ?? 0,
    latencyMs: params.latencyMs ?? 0,
    inferenceMode: "deterministic-fallback",
    privacyAttestation:
      "Analyzed live from Solana Mainnet RPC + Deterministic On-Chain Token Audit Engine (Zero Wallet Tracking).",
  };
}

/**
 * Fetches live Mainnet Mint account data, Metaplex metadata, largest token holders,
 * and optional Venice AI zero-retention security verdict.
 */
export async function scanSolanaTokenMint(
  mintAddress: string,
  options?: { veniceApiKey?: string; rpcUrl?: string }
): Promise<TokenScanReport> {
  const startedAt = Date.now();
  const trimmed = mintAddress.trim();
  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(trimmed);
  } catch {
    throw new Error(
      "Invalid Solana Token Mint address. Please paste a valid base58 SPL or Token-2022 CA."
    );
  }

  const rpcUrl = options?.rpcUrl?.trim() || SOLANA_MAINNET_RPC;
  let connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
      mintPubkey.toBuffer(),
    ],
    METAPLEX_METADATA_PROGRAM_ID
  );

  let accountResults: (import("@solana/web3.js").AccountInfo<Buffer> | null)[];
  let slot = 0;

  try {
    [accountResults, slot] = await Promise.all([
      connection.getMultipleAccountsInfo([mintPubkey, metadataPda]),
      connection.getSlot().catch(() => 0),
    ]);
  } catch (primaryErr) {
    if (!options?.rpcUrl && rpcUrl !== FALLBACK_SOLANA_RPC) {
      connection = new Connection(FALLBACK_SOLANA_RPC, {
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
      });
      [accountResults, slot] = await Promise.all([
        connection.getMultipleAccountsInfo([mintPubkey, metadataPda]),
        connection.getSlot().catch(() => 0),
      ]);
    } else {
      throw primaryErr;
    }
  }

  const mintAccountInfo = accountResults[0];
  const metadataAccountInfo = accountResults[1];

  if (!mintAccountInfo) {
    throw new Error(
      `Account ${trimmed} was not found on Solana Mainnet (it may not exist yet or lives on Devnet).`
    );
  }

  const ownerStr = mintAccountInfo.owner.toBase58();
  const splStandard = TOKEN_PROGRAM_ID.toBase58();
  const spl2022 = TOKEN_2022_PROGRAM_ID.toBase58();

  if (ownerStr !== splStandard && ownerStr !== spl2022) {
    throw new Error(
      `Address ${trimmed} is owned by ${ownerStr}, not an SPL Token or Token-2022 Mint account. Paste a Token CA rather than a personal wallet.`
    );
  }

  const programId = ownerStr === spl2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const unpackedMint = unpackMint(mintPubkey, mintAccountInfo, programId);
  const metadata = parseMetaplexMetadataNameSymbol(metadataAccountInfo?.data);

  if (ownerStr === spl2022 && (!metadata.name || !metadata.symbol)) {
    try {
      const extMeta = await getTokenMetadata(
        connection,
        mintPubkey,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      if (extMeta) {
        metadata.name = metadata.name || extMeta.name?.trim() || null;
        metadata.symbol = metadata.symbol || extMeta.symbol?.trim() || null;
      }
    } catch {
      // Optional Token-2022 embedded metadata
    }
  }

  let largestAccounts: { address: string; uiAmount: number }[] = [];
  try {
    const largestRes = await Promise.race([
      connection.getTokenLargestAccounts(mintPubkey),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2200)),
    ]);
    if (largestRes && "value" in largestRes) {
      largestAccounts = (largestRes.value || []).map((entry) => ({
        address: entry.address.toBase58(),
        uiAmount:
          entry.uiAmount !== null && entry.uiAmount !== undefined
            ? entry.uiAmount
            : Number(entry.amount) / Math.pow(10, unpackedMint.decimals),
      }));
    }
  } catch {
    // Public RPC occasionally rate-limits getTokenLargestAccounts
  }

  const report = analyzeMintState({
    mint: unpackedMint,
    programOwner: ownerStr,
    largestAccounts,
    slot,
    metadata,
    latencyMs: Date.now() - startedAt,
  });

  const apiKey =
    options?.veniceApiKey?.trim() || process.env.VENICE_API_KEY?.trim() || "";
  if (apiKey) {
    try {
      const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_VENICE_MODEL,
          temperature: 0.1,
          max_tokens: 220,
          venice_parameters: { include_venice_system_prompt: false },
          messages: [
            {
              role: "system",
              content:
                "You are SolShield Token Auditor running on Venice AI zero-retention inference. Summarize the on-chain risk of this Solana token in 1-2 crisp, objective sentences for traders. Mention Mint/Freeze authorities, Token-2022 hooks/fees if any, and top holder concentration.",
            },
            {
              role: "user",
              content: JSON.stringify({
                mint: report.mintAddress,
                name: report.name,
                symbol: report.symbol,
                tokenProgram: report.tokenProgram,
                mintAuthorityRevoked: report.mintAuthority === null,
                freezeAuthorityRevoked: report.freezeAuthority === null,
                extensions: report.extensions,
                transferFeeBps: report.transferFeeBps,
                permanentDelegate: report.permanentDelegate,
                transferHookProgramId: report.transferHookProgramId,
                top5Pct: report.top5Pct,
                riskScore: report.riskScore,
              }),
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const summary = data?.choices?.[0]?.message?.content?.trim();
        if (summary) {
          report.executiveSummary = summary;
          report.inferenceMode = "venice-live-api";
          report.privacyAttestation =
            "Verified via Solana Mainnet RPC + Venice AI Zero-Retention Inference (`llama-3.3-70b`).";
        }
      }
    } catch {
      // Deterministic summary already populated
    }
  }

  return report;
}
