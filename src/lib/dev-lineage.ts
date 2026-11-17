/**
 * Dev Lineage & Cabal Tree — Rugpuller Wallet Forensics
 *
 * Traces the funding lineage of any Solana wallet (typically a token deployer)
 * to expose:
 * - Serial rugpullers that create multiple tokens and drain liquidity
 * - Cabal wallets that fund deployers from a shared treasury/mixer
 * - Funding chains that link seemingly-independent projects
 *
 * All analysis is read-only via Solana RPC. Venice AI provides zero-retention
 * narrative synthesis. No wallet connection required.
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";
import { DEFAULT_VENICE_MODEL, VENICE_API_BASE_URL } from "./venice-ai";

/* ── Constants ─────────────────────────────────────────────── */

const SOLANA_MAINNET_RPC =
  process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
const FALLBACK_SOLANA_RPC = "https://solana-rpc.publicnode.com";

/** Max ancestor hops to trace (prevents exponential branching on circular/deep chains) */
const MAX_LINEAGE_DEPTH = 3;
/** Hard cap on visited wallets & recursive time budget to stay fast on serverless RPCs */
const MAX_WALLETS_TO_TRACE = 10;
const MAX_PARENTS_PER_WALLET = 2;
const LINEAGE_TIME_BUDGET_MS = 20_000;
/** Max signatures fetched per wallet to reach initial funding & launch transactions */
const MAX_TXS_PER_WALLET = 100;
/** Supports legacy, v0, and v1 Solana transactions on modern mainnet RPCs */
const SUPPORTED_TX_VERSION = 1 as unknown as 0;
const RAYDIUM_LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const NON_FUNDING_DEX_PROGRAMS = new Set([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // Pump.fun
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  RAYDIUM_LAUNCHLAB_PROGRAM,
  JUPITER_V6_PROGRAM,
]);
/** Max deployed tokens to discover per wallet */
const MAX_DEPLOYED_TOKENS = 20;
/** Min SOL amount to consider a transfer as "funding" (not dust) */
const MIN_FUNDING_SOL = 0.01;
/** Known exchange/CEX hot wallets (partial list) */
const KNOWN_CEX_WALLETS: Record<string, string> = {
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance Hot Wallet 1",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance Hot Wallet 2",
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance Withdrawal",
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ": "Bybit Hot Wallet",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": "Coinbase Custody",
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE": "Coinbase Hot Wallet",
  "4SnheqadxzFonpJCpz2BLo7EYXE1eFqrBagwMPMfdsHT": "Gate.io",
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": "Kraken Hot Wallet",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "KuCoin Hot Wallet",
  "5VCwKtCXgCJ6kit5FybXjvFnyKMRnVnSS5eFn1MgQWyh": "OKX Hot Wallet",
  "CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq": "Phantom Swapper",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter Aggregator",
};

/** Known program IDs for token creation */
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const METAPLEX_TOKEN_METADATA = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/* Pump.fun and Raydium program IDs */
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_CLMM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";

/* ── Types ─────────────────────────────────────────────────── */

export interface FundingEdge {
  from: string;
  to: string;
  amountSol: number;
  amountLamports: number;
  txSignature: string;
  slot: number;
  blockTime: number | null;
  isCex: boolean;
  cexLabel: string | null;
}

export interface DeployedTokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  deploySlot: number;
  deployTxSignature: string;
  deployBlockTime: number | null;
  /** Whether initial liquidity was added then removed (rug pattern) */
  liquidityEventDetected: boolean;
  deployPlatform: "SPL" | "Token-2022" | "Pump.fun" | "Raydium" | "Unknown";
}

export interface LineageNode {
  wallet: string;
  depth: number;
  isCex: boolean;
  cexLabel: string | null;
  isKnownProgram: boolean;
  deployedTokens: DeployedTokenInfo[];
  totalDeployedTokenCount: number;
  fundedBy: FundingEdge[];
  fundedWallets: FundingEdge[];
  solBalanceLamports: number;
  solBalance: number;
  firstSeenSlot: number | null;
  firstSeenTimestamp: number | null;
  isSerialDeployer: boolean;
}

export type LineageRiskLevel = "CLEAN" | "SUSPICIOUS" | "HIGH_RISK" | "SERIAL_RUGPULLER";

export interface DevLineageReport {
  targetWallet: string;
  cluster: "mainnet-beta" | "devnet";
  lineageNodes: LineageNode[];
  fundingEdges: FundingEdge[];
  totalUniqueWallets: number;
  totalDeployedTokens: number;
  maxDepthReached: number;
  serialDeployerCount: number;
  cabalDetected: boolean;
  cabalHubWallet: string | null;
  riskLevel: LineageRiskLevel;
  riskScore: number;
  verdictLabel: string;
  veniceSummary: string;
  veniceRecommendations: string[];
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  modelUsed: string;
  privacyAttestation: string;
  latencyMs: number;
  slot: number;
  rpcDegraded?: boolean;
  rpcWarning?: string | null;
}

/* ── Helpers ───────────────────────────────────────────────── */

function getConnection(): Connection {
  return new Connection(SOLANA_MAINNET_RPC, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    httpHeaders: { "User-Agent": "SolShield-DevLineage/1.0" },
  });
}

function getFallbackConnection(): Connection {
  return new Connection(FALLBACK_SOLANA_RPC, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    httpHeaders: { "User-Agent": "SolShield-DevLineage/1.0" },
  });
}

type SigInfo = { signature: string; slot: number; blockTime: number | null };

async function withFallbackRpc<T>(
  primary: Connection,
  fallback: Connection,
  fn: (conn: Connection) => Promise<T>,
  defaultValue: T,
  tracker?: { degraded: boolean }
): Promise<T> {
  try {
    return await fn(primary);
  } catch {
    try {
      return await fn(fallback);
    } catch {
      if (tracker) tracker.degraded = true;
      return defaultValue;
    }
  }
}

async function safeGetBalance(
  conn: Connection,
  pubkey: PublicKey,
  fallbackConn?: Connection,
  tracker?: { degraded: boolean }
): Promise<number> {
  return withFallbackRpc(
    conn,
    fallbackConn || getFallbackConnection(),
    (c) => c.getBalance(pubkey),
    0,
    tracker
  );
}

async function safeGetSignatures(
  conn: Connection,
  pubkey: PublicKey,
  limit: number,
  fallbackConn?: Connection,
  tracker?: { degraded: boolean }
): Promise<SigInfo[]> {
  return withFallbackRpc(
    conn,
    fallbackConn || getFallbackConnection(),
    async (c) => {
      const sigs = await c.getSignaturesForAddress(pubkey, { limit });
      return sigs.map((s) => ({
        signature: s.signature,
        slot: s.slot,
        blockTime: s.blockTime ?? null,
      }));
    },
    [],
    tracker
  );
}

async function fetchParsedTransactionsBatch(
  primary: Connection,
  fallback: Connection,
  signatures: string[],
  tracker?: { degraded: boolean }
): Promise<Map<string, ParsedTransactionWithMeta>> {
  const result = new Map<string, ParsedTransactionWithMeta>();
  if (signatures.length === 0) return result;

  // Prefer fast JSON-RPC batching with v1 support; automatically fall back to fallbackConn
  // and bounded single-tx waves if a public RPC endpoint rejects batch arrays.
  const CHUNK_SIZE = 25;
  for (let i = 0; i < signatures.length; i += CHUNK_SIZE) {
    const chunk = signatures.slice(i, i + CHUNK_SIZE);
    let batchOk = false;
    for (const conn of [primary, fallback]) {
      try {
        const txs = await conn.getParsedTransactions(chunk, {
          maxSupportedTransactionVersion: SUPPORTED_TX_VERSION,
        });
        chunk.forEach((sig, idx) => {
          const parsed = txs[idx];
          if (parsed) result.set(sig, parsed);
        });
        batchOk = true;
        break;
      } catch {
        // Try next RPC or single-tx wave fallback below
      }
    }
    if (batchOk) continue;

    const SINGLE_CONCURRENCY = 2;
    for (let j = 0; j < chunk.length; j += SINGLE_CONCURRENCY) {
      const wave = chunk.slice(j, j + SINGLE_CONCURRENCY);
      await Promise.all(
        wave.map(async (sig) => {
          try {
            const tx = await primary.getParsedTransaction(sig, {
              maxSupportedTransactionVersion: SUPPORTED_TX_VERSION,
            });
            if (tx) result.set(sig, tx);
          } catch {
            try {
              const tx = await fallback.getParsedTransaction(sig, {
                maxSupportedTransactionVersion: SUPPORTED_TX_VERSION,
              });
              if (tx) result.set(sig, tx);
            } catch {
              if (tracker) tracker.degraded = true;
            }
          }
        })
      );
      if (j + SINGLE_CONCURRENCY < chunk.length) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  }

  return result;
}

/* ── Core: Funding Source Tracer ────────────────────────────── */

function extractFundingEdgesFromTxs(
  wallet: string,
  oldestSigs: SigInfo[],
  txMap: Map<string, ParsedTransactionWithMeta>
): FundingEdge[] {
  const edges: FundingEdge[] = [];
  const seenSenders = new Set<string>();

  for (const sigInfo of oldestSigs) {
    if (edges.length >= MAX_PARENTS_PER_WALLET) break;

    const tx = txMap.get(sigInfo.signature);
    if (!tx?.meta || tx.meta.err) continue;

    const accounts = tx.transaction.message.accountKeys;
    const feePayer = accounts[0]?.pubkey?.toBase58?.() || "";
    const topInstructions = tx.transaction.message.instructions;
    const innerInstructions = (tx.meta.innerInstructions || []).flatMap(
      (g) => g.instructions
    );
    const allInstructions = [...topInstructions, ...innerInstructions];

    // Ignore DEX swaps / token trades (wallet receives SOL from selling tokens or closing pools)
    const touchesDexOrTokenSwap = allInstructions.some((ix) => {
      if ("programId" in ix) {
        const pid = (ix as { programId?: { toBase58?: () => string } }).programId?.toBase58?.() || "";
        if (NON_FUNDING_DEX_PROGRAMS.has(pid)) return true;
      }
      if ("parsed" in ix) {
        const prog = (ix as { program?: string }).program;
        if (prog === "spl-token" || prog === "spl-token-2022") return true;
      }
      return false;
    });
    if (touchesDexOrTokenSwap) continue;

    // Prefer explicit SystemProgram transfer/createAccount instructions funding `wallet`
    let matchedTransfer = false;
    for (const ix of allInstructions) {
      if (!("parsed" in ix)) continue;
      const parsedIx = ix as {
        program?: string;
        parsed?: {
          type?: string;
          info?: {
            source?: string;
            destination?: string;
            newAccount?: string;
            lamports?: number;
          };
        };
      };
      if (parsedIx.program !== "system") continue;
      const tType = parsedIx.parsed?.type;
      if (tType !== "transfer" && tType !== "transferWithSeed" && tType !== "createAccount") {
        continue;
      }
      const dest = parsedIx.parsed?.info?.destination || parsedIx.parsed?.info?.newAccount;
      const source = parsedIx.parsed?.info?.source;
      const lamports = Number(parsedIx.parsed?.info?.lamports ?? 0);
      if (
        dest === wallet &&
        source &&
        source !== wallet &&
        lamports >= MIN_FUNDING_SOL * 1e9 &&
        !seenSenders.has(source)
      ) {
        seenSenders.add(source);
        const isCex = source in KNOWN_CEX_WALLETS;
        edges.push({
          from: source,
          to: wallet,
          amountSol: lamports / 1e9,
          amountLamports: lamports,
          txSignature: sigInfo.signature,
          slot: sigInfo.slot,
          blockTime: sigInfo.blockTime,
          isCex,
          cexLabel: isCex ? KNOWN_CEX_WALLETS[source] : null,
        });
        matchedTransfer = true;
        break;
      }
    }
    if (matchedTransfer) continue;

    // Fallback when funding used an external relay/bridge and sender paid the tx fee
    if (feePayer && feePayer !== wallet && !seenSenders.has(feePayer)) {
      const preBalances = tx.meta.preBalances;
      const postBalances = tx.meta.postBalances;
      const walletIdx = accounts.findIndex((a) => a.pubkey.toBase58() === wallet);
      const payerIdx = 0;
      if (walletIdx > 0) {
        const received = postBalances[walletIdx] - preBalances[walletIdx];
        const sent = preBalances[payerIdx] - postBalances[payerIdx];
        if (received >= MIN_FUNDING_SOL * 1e9 && sent > 0) {
          seenSenders.add(feePayer);
          const isCex = feePayer in KNOWN_CEX_WALLETS;
          edges.push({
            from: feePayer,
            to: wallet,
            amountSol: received / 1e9,
            amountLamports: received,
            txSignature: sigInfo.signature,
            slot: sigInfo.slot,
            blockTime: sigInfo.blockTime,
            isCex,
            cexLabel: isCex ? KNOWN_CEX_WALLETS[feePayer] : null,
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Discovers who funded a wallet by scanning its earliest transactions
 * for incoming SOL transfers above the dust threshold.
 */
export async function traceFundingSources(
  conn: Connection,
  wallet: string,
  fallbackConn?: Connection,
  tracker?: { degraded: boolean }
): Promise<FundingEdge[]> {
  const fb = fallbackConn || getFallbackConnection();
  const pubkey = new PublicKey(wallet);
  const sigs = await safeGetSignatures(conn, pubkey, MAX_TXS_PER_WALLET, fb, tracker);
  if (sigs.length === 0) return [];

  const oldestSigs = [...sigs].reverse().slice(0, 15);
  const txMap = await fetchParsedTransactionsBatch(
    conn,
    fb,
    oldestSigs.map((s) => s.signature),
    tracker
  );
  return extractFundingEdgesFromTxs(wallet, oldestSigs, txMap);
}

/* ── Core: Token Deployment Detector ───────────────────────── */

function extractDeployedTokensFromTxs(
  wallet: string,
  sigs: SigInfo[],
  txMap: Map<string, ParsedTransactionWithMeta>
): DeployedTokenInfo[] {
  const tokens: DeployedTokenInfo[] = [];

  for (const sigInfo of sigs) {
    if (tokens.length >= MAX_DEPLOYED_TOKENS) break;

    const tx = txMap.get(sigInfo.signature);
    if (!tx?.meta || tx.meta.err) continue;

    const topInstructions = tx.transaction.message.instructions;
    const innerInstructions = (tx.meta.innerInstructions || []).flatMap(
      (group) => group.instructions
    );
    const allInstructions = [...topInstructions, ...innerInstructions];
    const feePayer = tx.transaction.message.accountKeys[0]?.pubkey?.toBase58?.() || "";
    const usesLaunchpad = allInstructions.some((ix) => {
      const progId =
        "programId" in ix
          ? (ix as { programId?: { toBase58?: () => string } }).programId?.toBase58?.() || ""
          : "";
      return progId === PUMP_FUN_PROGRAM || progId === RAYDIUM_LAUNCHLAB_PROGRAM;
    });
    const isRaydiumLaunch = allInstructions.some((ix) => {
      const progId =
        "programId" in ix
          ? (ix as { programId?: { toBase58?: () => string } }).programId?.toBase58?.() || ""
          : "";
      return progId === RAYDIUM_LAUNCHLAB_PROGRAM;
    });
    const isPumpLaunch = allInstructions.some((ix) => {
      const progId =
        "programId" in ix
          ? (ix as { programId?: { toBase58?: () => string } }).programId?.toBase58?.() || ""
          : "";
      return progId === PUMP_FUN_PROGRAM;
    });

    for (const ix of allInstructions) {
      if (!("parsed" in ix)) continue;
      const parsed = ix as {
        program?: string;
        parsed?: {
          type?: string;
          info?: { mintAuthority?: string; mint?: string };
        };
      };

      // Detect direct or CPI SPL Token InitializeMint / InitializeMint2 initiated by this deployer
      if (
        (parsed.program === "spl-token" || parsed.program === "spl-token-2022") &&
        (parsed.parsed?.type === "initializeMint" ||
          parsed.parsed?.type === "initializeMint2")
      ) {
        const mintAuthority = parsed.parsed?.info?.mintAuthority;
        if (mintAuthority === wallet || (feePayer === wallet && usesLaunchpad)) {
          const mint = parsed.parsed?.info?.mint;
          if (mint && !tokens.find((t) => t.mint === mint)) {
            tokens.push({
              mint,
              name: null,
              symbol: null,
              deploySlot: sigInfo.slot,
              deployTxSignature: sigInfo.signature,
              deployBlockTime: sigInfo.blockTime,
              liquidityEventDetected: false,
              deployPlatform: isPumpLaunch
                ? "Pump.fun"
                : isRaydiumLaunch
                  ? "Raydium"
                  : parsed.program === "spl-token-2022"
                    ? "Token-2022"
                    : "SPL",
            });
          }
        }
      }
    }

    // Legacy fallback: direct top-level Pump.fun interaction when CPI mint wasn't parsed
    for (const ix of topInstructions) {
      if ("programId" in ix) {
        const ixObj = ix as {
          programId?: { toBase58?: () => string };
          accounts?: Array<{ toBase58?: () => string }>;
        };
        const progId = ixObj.programId?.toBase58?.() || "";
        if (progId === PUMP_FUN_PROGRAM && feePayer === wallet) {
          const accounts = ixObj.accounts || [];
          if (accounts.length > 0) {
            const potentialMint = accounts[0]?.toBase58?.() || "";
            if (potentialMint && !tokens.find((t) => t.mint === potentialMint)) {
              tokens.push({
                mint: potentialMint,
                name: null,
                symbol: null,
                deploySlot: sigInfo.slot,
                deployTxSignature: sigInfo.signature,
                deployBlockTime: sigInfo.blockTime,
                liquidityEventDetected: false,
                deployPlatform: "Pump.fun",
              });
            }
          }
        }
      }
    }
  }

  return tokens;
}

/**
 * Scans a wallet's transaction history for token creation events
 * (InitializeMint, CreateMetadataAccount, Pump.fun launches, etc.)
 */
export async function discoverDeployedTokens(
  conn: Connection,
  wallet: string,
  fallbackConn?: Connection,
  tracker?: { degraded: boolean }
): Promise<DeployedTokenInfo[]> {
  const fb = fallbackConn || getFallbackConnection();
  const pubkey = new PublicKey(wallet);
  const sigs = await safeGetSignatures(conn, pubkey, MAX_TXS_PER_WALLET, fb, tracker);
  if (sigs.length === 0) return [];

  const scanSigs = sigs.slice(0, 30);
  const txMap = await fetchParsedTransactionsBatch(
    conn,
    fb,
    scanSigs.map((s) => s.signature),
    tracker
  );
  return extractDeployedTokensFromTxs(wallet, scanSigs, txMap);
}

/* ── Core: Recursive Lineage Builder ───────────────────────── */

/**
 * Builds a full lineage tree by recursively tracing funding sources
 * up to MAX_LINEAGE_DEPTH hops. Detects cabal patterns (multiple deployers
 * funded by the same hub wallet).
 */
export async function buildLineageTree(
  targetWallet: string,
  maxDepth: number = MAX_LINEAGE_DEPTH
): Promise<{
  nodes: LineageNode[];
  edges: FundingEdge[];
  rpcDegraded: boolean;
}> {
  const treeStartMs = Date.now();
  const conn = getConnection();
  const fallbackConn = getFallbackConnection();
  const tracker = { degraded: false };
  const visited = new Set<string>();
  const allNodes: LineageNode[] = [];
  const allEdges: FundingEdge[] = [];
  const seenEdgeKeys = new Set<string>();

  async function traceWallet(wallet: string, depth: number): Promise<void> {
    if (
      depth > maxDepth ||
      visited.has(wallet) ||
      visited.size >= MAX_WALLETS_TO_TRACE ||
      Date.now() - treeStartMs > LINEAGE_TIME_BUDGET_MS
    ) {
      return;
    }
    visited.add(wallet);

    const pubkey = new PublicKey(wallet);
    const isCex = wallet in KNOWN_CEX_WALLETS;
    const isKnownProgram = [
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      METAPLEX_TOKEN_METADATA,
      PUMP_FUN_PROGRAM,
      RAYDIUM_AMM_V4,
      RAYDIUM_CLMM,
    ].includes(wallet);

    // Don't trace into CEX wallets or known programs
    if (isCex || isKnownProgram) {
      allNodes.push({
        wallet,
        depth,
        isCex,
        cexLabel: KNOWN_CEX_WALLETS[wallet] || null,
        isKnownProgram,
        deployedTokens: [],
        totalDeployedTokenCount: 0,
        fundedBy: [],
        fundedWallets: [],
        solBalanceLamports: 0,
        solBalance: 0,
        firstSeenSlot: null,
        firstSeenTimestamp: null,
        isSerialDeployer: false,
      });
      return;
    }

    // Fetch balance and signatures once per wallet, then batch-parse needed txs
    const [balanceLamports, sigs] = await Promise.all([
      safeGetBalance(conn, pubkey, fallbackConn, tracker),
      safeGetSignatures(conn, pubkey, MAX_TXS_PER_WALLET, fallbackConn, tracker),
    ]);

    const oldestSigs = [...sigs].reverse().slice(0, 12);
    const recentDeploySigs = sigs.slice(0, depth === 0 ? 13 : 10);
    const uniqueSigList = Array.from(
      new Set([
        ...oldestSigs.map((s) => s.signature),
        ...recentDeploySigs.map((s) => s.signature),
      ])
    );

    const txMap = await fetchParsedTransactionsBatch(
      conn,
      fallbackConn,
      uniqueSigList,
      tracker
    );

    const scannedSigs = sigs.filter((s) => txMap.has(s.signature));
    const fundingEdges = extractFundingEdgesFromTxs(wallet, oldestSigs, txMap);
    const allTokens = extractDeployedTokensFromTxs(wallet, scannedSigs, txMap);
    const isSerialDeployer = allTokens.length >= 3;

    const node: LineageNode = {
      wallet,
      depth,
      isCex: false,
      cexLabel: null,
      isKnownProgram: false,
      deployedTokens: allTokens,
      totalDeployedTokenCount: allTokens.length,
      fundedBy: fundingEdges,
      fundedWallets: [],
      solBalanceLamports: balanceLamports,
      solBalance: balanceLamports / 1e9,
      firstSeenSlot: fundingEdges[0]?.slot ?? null,
      firstSeenTimestamp: fundingEdges[0]?.blockTime ?? null,
      isSerialDeployer,
    };

    allNodes.push(node);
    for (const edge of fundingEdges) {
      const edgeKey = `${edge.from}->${edge.to}`;
      if (!seenEdgeKeys.has(edgeKey)) {
        seenEdgeKeys.add(edgeKey);
        allEdges.push(edge);
      }
    }

    // Recursively trace funding sources (but not CEX wallets)
    for (const edge of fundingEdges) {
      if (!visited.has(edge.from) && !(edge.from in KNOWN_CEX_WALLETS)) {
        await traceWallet(edge.from, depth + 1);
      }
    }
  }

  await traceWallet(targetWallet, 0);

  return { nodes: allNodes, edges: allEdges, rpcDegraded: tracker.degraded };
}

/* ── Risk Scoring ──────────────────────────────────────────── */

export function computeLineageRisk(
  nodes: LineageNode[],
  edges: FundingEdge[]
): {
  riskLevel: LineageRiskLevel;
  riskScore: number;
  verdictLabel: string;
  cabalDetected: boolean;
  cabalHubWallet: string | null;
  serialDeployerCount: number;
} {
  let riskScore = 0;
  let serialDeployerCount = 0;
  let cabalDetected = false;
  let cabalHubWallet: string | null = null;

  // 1. Count serial deployers
  for (const node of nodes) {
    if (node.isSerialDeployer) {
      serialDeployerCount++;
      riskScore += 40;
    }
    if (node.totalDeployedTokenCount >= 5) {
      riskScore += 30; // Prolific deployer bonus (70+ = SERIAL_RUGPULLER)
    }
  }

  // 2. Check for cabal pattern: one wallet funds multiple deployers
  const funderCounts: Record<string, string[]> = {};
  for (const edge of edges) {
    if (!funderCounts[edge.from]) funderCounts[edge.from] = [];
    if (!funderCounts[edge.from].includes(edge.to)) {
      funderCounts[edge.from].push(edge.to);
    }
  }

  for (const [funder, recipients] of Object.entries(funderCounts)) {
    const recipientDeployers = recipients.filter((r) =>
      nodes.find((n) => n.wallet === r && n.totalDeployedTokenCount > 0)
    );
    if (recipientDeployers.length >= 2) {
      cabalDetected = true;
      cabalHubWallet = funder;
      riskScore += 40;
    }
  }

  // 3. Deep lineage (many hops = likely obfuscation)
  const maxDepth = Math.max(...nodes.map((n) => n.depth), 0);
  if (maxDepth >= 3) riskScore += 15;

  // 4. Non-CEX initial funding (funded by anon wallet = suspicious)
  const rootNode = nodes.find((n) => n.depth === 0);
  if (rootNode) {
    const nonCexFunding = rootNode.fundedBy.filter((e) => !e.isCex);
    if (nonCexFunding.length > 0 && rootNode.fundedBy.every((e) => !e.isCex)) {
      riskScore += 10; // All funding from anon wallets
    }
  }

  // 5. Cap at 100
  riskScore = Math.min(100, riskScore);

  // 6. Classify
  let riskLevel: LineageRiskLevel;
  let verdictLabel: string;
  if (riskScore >= 70) {
    riskLevel = "SERIAL_RUGPULLER";
    verdictLabel = "Serial Rugpuller Detected";
  } else if (riskScore >= 40) {
    riskLevel = "HIGH_RISK";
    verdictLabel = "High Risk — Multi-Token Deployer with Suspicious Lineage";
  } else if (riskScore >= 15) {
    riskLevel = "SUSPICIOUS";
    verdictLabel = "Suspicious — Investigate Further";
  } else {
    riskLevel = "CLEAN";
    verdictLabel = "Clean Lineage — No Red Flags Detected";
  }

  return {
    riskLevel,
    riskScore,
    verdictLabel,
    cabalDetected,
    cabalHubWallet,
    serialDeployerCount,
  };
}

/* ── Venice AI Synthesis ───────────────────────────────────── */

const LINEAGE_ANALYST_PROMPT = `You are SolShield Lineage Analyst, an elite blockchain forensics engine running on Venice AI zero-retention private inference.
You analyze wallet funding lineage trees to identify serial rugpullers, cabal treasury wallets, and suspicious funding patterns on Solana.
Rules:
- Base EVERY finding strictly on the lineage data provided.
- Never mention or speculate about the raw wallet address — it has been stripped for privacy.
- Focus on: funding chains, token deployment patterns, timing correlations, cabal structures.
- If the lineage is clean, say so clearly and concisely.
- Output format: 1) Executive Summary (2-3 sentences), 2) Key Findings (bullet list), 3) Recommendations (bullet list).
- Language: English, concise, no filler.`;

export async function synthesizeLineageWithVenice(
  nodes: LineageNode[],
  edges: FundingEdge[],
  riskScore: number,
  riskLevel: LineageRiskLevel,
  options?: { apiKey?: string; model?: string }
): Promise<{
  summary: string;
  recommendations: string[];
  inferenceMode: "venice-live-api" | "deterministic-fallback";
  modelUsed: string;
}> {
  const apiKey = options?.apiKey || process.env.VENICE_API_KEY || "";
  const model = options?.model || DEFAULT_VENICE_MODEL;

  if (!apiKey) {
    return {
      summary: buildDeterministicSummary(nodes, edges, riskScore, riskLevel),
      recommendations: buildDeterministicRecommendations(riskLevel),
      inferenceMode: "deterministic-fallback",
      modelUsed: "deterministic-engine",
    };
  }

  // Build anonymized telemetry (strip raw addresses)
  const anonymizedNodes = nodes.map((n, i) => ({
    nodeId: `wallet_${i}`,
    depth: n.depth,
    isCex: n.isCex,
    cexLabel: n.cexLabel,
    isSerialDeployer: n.isSerialDeployer,
    deployedTokenCount: n.totalDeployedTokenCount,
    solBalance: n.solBalance,
    fundedByCount: n.fundedBy.length,
    hasCexFunding: n.fundedBy.some((e) => e.isCex),
  }));

  const anonymizedEdges = edges.map((e) => ({
    fromNodeId: `wallet_${nodes.findIndex((n) => n.wallet === e.from)}`,
    toNodeId: `wallet_${nodes.findIndex((n) => n.wallet === e.to)}`,
    amountSol: e.amountSol,
    isCex: e.isCex,
    cexLabel: e.cexLabel,
  }));

  try {
    const res = await fetch(`${VENICE_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(18_000),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: LINEAGE_ANALYST_PROMPT },
          {
            role: "user",
            content: `Analyze this wallet funding lineage tree:\n\nRisk Score: ${riskScore}/100\nRisk Level: ${riskLevel}\n\nLineage Nodes:\n${JSON.stringify(anonymizedNodes, null, 2)}\n\nFunding Edges:\n${JSON.stringify(anonymizedEdges, null, 2)}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 600,
        venice_parameters: {
          include_venice_system_prompt: false,
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Venice API ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    if (!text) {
      throw new Error("Empty Venice response");
    }

    // Parse recommendations from Venice response
    const lines = text.split("\n").filter((l: string) => l.trim());
    const recoStart = lines.findIndex((l: string) =>
      l.toLowerCase().includes("recommend")
    );
    const recommendations =
      recoStart >= 0
        ? lines
            .slice(recoStart + 1)
            .filter((l: string) => l.startsWith("-") || l.startsWith("•") || l.startsWith("*"))
            .map((l: string) => l.replace(/^[-•*]\s*/, "").trim())
            .slice(0, 5)
        : buildDeterministicRecommendations(riskLevel);

    return {
      summary: text,
      recommendations: recommendations.length > 0
        ? recommendations
        : buildDeterministicRecommendations(riskLevel),
      inferenceMode: "venice-live-api",
      modelUsed: model,
    };
  } catch {
    return {
      summary: buildDeterministicSummary(nodes, edges, riskScore, riskLevel),
      recommendations: buildDeterministicRecommendations(riskLevel),
      inferenceMode: "deterministic-fallback",
      modelUsed: "deterministic-engine",
    };
  }
}

export function buildDeterministicSummary(
  nodes: LineageNode[],
  edges: FundingEdge[],
  riskScore: number,
  riskLevel: LineageRiskLevel
): string {
  const rootNode = nodes.find((n) => n.depth === 0);
  const totalTokens = nodes.reduce((sum, n) => sum + n.totalDeployedTokenCount, 0);
  const serialCount = nodes.filter((n) => n.isSerialDeployer).length;
  const cexFunded = edges.some((e) => e.isCex);

  const parts: string[] = [];

  if (riskLevel === "SERIAL_RUGPULLER") {
    parts.push(
      `CRITICAL: This wallet lineage tree shows strong indicators of serial rug-pull operations. ${totalTokens} token deployment(s) detected across ${nodes.length} linked wallet(s).`
    );
  } else if (riskLevel === "HIGH_RISK") {
    parts.push(
      `HIGH RISK: Suspicious multi-token deployment pattern detected. ${totalTokens} token(s) deployed with ${serialCount} serial deployer(s) in the funding chain.`
    );
  } else if (riskLevel === "SUSPICIOUS") {
    parts.push(
      `SUSPICIOUS: Some anomalies detected in the funding lineage. ${totalTokens} token deployment(s) found. Further investigation recommended.`
    );
  } else {
    parts.push(
      `CLEAN: No significant red flags detected in the wallet funding lineage. ${totalTokens} token deployment(s) found.`
    );
  }

  if (cexFunded) {
    parts.push("Initial funding traced to a recognized CEX hot wallet.");
  } else if (rootNode && rootNode.fundedBy.length > 0) {
    parts.push("Initial funding came from anonymous wallet(s) — not linked to any known exchange.");
  }

  parts.push(`Overall Risk Score: ${riskScore}/100.`);

  return parts.join(" ");
}

export function buildDeterministicRecommendations(riskLevel: LineageRiskLevel): string[] {
  switch (riskLevel) {
    case "SERIAL_RUGPULLER":
      return [
        "Do NOT invest in any token associated with this deployer.",
        "Cross-reference linked wallets for active positions and exit immediately.",
        "Report this wallet cluster to community watchdog channels.",
        "Check if any of your holdings share mint authority with this deployer.",
      ];
    case "HIGH_RISK":
      return [
        "Exercise extreme caution with any token deployed by this wallet.",
        "Verify lock status of liquidity pools before investing.",
        "Monitor the deployer's wallet for sudden large withdrawals.",
      ];
    case "SUSPICIOUS":
      return [
        "Investigate the deployer's token history before investing.",
        "Cross-check with on-chain liquidity lock contracts.",
        "Look for community reviews and audits of associated projects.",
      ];
    default:
      return [
        "Lineage appears clean. Standard due diligence still recommended.",
        "Verify token contract source code and liquidity lock status.",
      ];
  }
}

/* ── Main Entry Point ──────────────────────────────────────── */

export async function analyzeDevLineage(
  targetWallet: string,
  options?: { apiKey?: string; model?: string }
): Promise<DevLineageReport> {
  const startMs = Date.now();
  const conn = getConnection();
  const fallbackConn = getFallbackConnection();
  const slot = await withFallbackRpc(
    conn,
    fallbackConn,
    (c) => c.getSlot(),
    0
  );

  // Build full lineage tree
  const { nodes, edges, rpcDegraded } = await buildLineageTree(targetWallet);

  // Compute risk
  const risk = computeLineageRisk(nodes, edges);

  // Get Venice AI synthesis
  const venice = await synthesizeLineageWithVenice(
    nodes,
    edges,
    risk.riskScore,
    risk.riskLevel,
    options
  );

  const totalDeployedTokens = nodes.reduce(
    (sum, n) => sum + n.totalDeployedTokenCount,
    0
  );

  return {
    targetWallet,
    cluster: "mainnet-beta",
    lineageNodes: nodes,
    fundingEdges: edges,
    totalUniqueWallets: nodes.length,
    totalDeployedTokens,
    maxDepthReached: Math.max(...nodes.map((n) => n.depth), 0),
    serialDeployerCount: risk.serialDeployerCount,
    cabalDetected: risk.cabalDetected,
    cabalHubWallet: risk.cabalHubWallet,
    riskLevel: risk.riskLevel,
    riskScore: risk.riskScore,
    verdictLabel: risk.verdictLabel,
    veniceSummary: venice.summary,
    veniceRecommendations: venice.recommendations,
    inferenceMode: venice.inferenceMode,
    modelUsed: venice.modelUsed,
    privacyAttestation:
      "SolShield Dev Lineage uses Venice AI zero-retention inference. No wallet addresses are stored or logged. Addresses are anonymized before AI synthesis.",
    latencyMs: Date.now() - startMs,
    slot,
    rpcDegraded,
    rpcWarning: rpcDegraded
      ? "One or more Solana RPC calls hit rate limits; results may be partial."
      : null,
  };
}
