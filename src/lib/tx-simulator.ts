import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { KNOWN_SOLANA_PROGRAMS } from "./solana-parser";
import { scanSolanaTokenMint, TokenScanReport } from "./token-scanner";

const MAINNET_RPC_URLS = [
  process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

export interface JsonParsedAccountSnapshot {
  lamports: number;
  owner: string;
  executable?: boolean;
  data?:
    | {
        program?: string;
        parsed?: {
          type?: string;
          info?: {
            mint?: string;
            owner?: string;
            delegate?: string;
            delegatedAmount?: { uiAmount?: number | null; amount?: string };
            tokenAmount?: { uiAmount?: number | null; amount?: string; decimals?: number };
          };
        };
      }
    | [string, string]
    | null;
}

export interface SimulatedBalanceDiff {
  address: string;
  asset: string;
  mint: string;
  deltaUiAmount: number;
  direction: "IN" | "OUT";
  isToken2022: boolean;
}

export interface SimulationAuthorityChange {
  account: string;
  mint: string;
  changeType: "OWNER_CHANGED" | "DELEGATE_GRANTED";
  before: string | null;
  after: string;
}

export interface RpcTxSimulationReport {
  status: "SIMULATED_OK" | "SIMULATED_ERROR" | "RPC_UNAVAILABLE";
  network: "mainnet" | "devnet" | "custom";
  rpcError: string | null;
  unitsConsumed: number | null;
  balanceDiffs: SimulatedBalanceDiff[];
  authorityChanges: SimulationAuthorityChange[];
  hiddenCpiPrograms: { programId: string; depth: number; verified: boolean }[];
  discoveredMints: string[];
  tokenAudits: TokenScanReport[];
  logsPreview: string[];
}

function decodeBase64Bytes(base64: string): Uint8Array {
  const cleaned = base64.trim();
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(cleaned);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return Uint8Array.from(Buffer.from(cleaned, "base64"));
}

/**
 * Extracts unique writable / signer account addresses and feePayer from a serialized Solana tx.
 */
export function extractCandidateSimulationAddresses(base64Payload: string): {
  feePayer: string | null;
  addresses: string[];
} {
  const bytes = decodeBase64Bytes(base64Payload);
  const seen = new Set<string>();
  let feePayer: string | null = null;

  try {
    const legacy = Transaction.from(bytes);
    if (legacy.feePayer) {
      feePayer = legacy.feePayer.toBase58();
      seen.add(feePayer);
    }
    for (const ix of legacy.instructions) {
      for (const k of ix.keys) {
        if (k.isWritable || k.isSigner) {
          seen.add(k.pubkey.toBase58());
        }
      }
    }
  } catch {
    try {
      const v0 = VersionedTransaction.deserialize(bytes);
      const keys = v0.message.staticAccountKeys;
      if (keys[0]) {
        feePayer = keys[0].toBase58();
        seen.add(feePayer);
      }
      keys.forEach((key, idx) => {
        if (v0.message.isAccountWritable(idx) || v0.message.isAccountSigner(idx)) {
          seen.add(key.toBase58());
        }
      });
    } catch {
      return { feePayer: null, addresses: [] };
    }
  }

  return {
    feePayer,
    addresses: Array.from(seen).slice(0, 24),
  };
}

/**
 * Extracts invoked Solana program IDs and call depths from simulation logs (`Program <ID> invoke [N]`).
 */
export function extractInvokedProgramsFromLogs(
  logs: string[] | null | undefined
): { programId: string; depth: number; verified: boolean }[] {
  if (!logs || logs.length === 0) return [];
  const found = new Map<string, number>();

  for (const line of logs) {
    const match = line.match(
      /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]/
    );
    if (!match) continue;
    const programId = match[1];
    const depth = Number(match[2]);
    const prev = found.get(programId);
    if (prev === undefined || depth < prev) {
      found.set(programId, depth);
    }
  }

  return Array.from(found.entries()).map(([programId, depth]) => ({
    programId,
    depth,
    verified: Boolean(KNOWN_SOLANA_PROGRAMS[programId]?.verified),
  }));
}

function getParsedTokenInfo(snapshot: JsonParsedAccountSnapshot | null | undefined) {
  if (!snapshot?.data || Array.isArray(snapshot.data)) return null;
  const info = snapshot.data.parsed?.info;
  if (!info || typeof info.mint !== "string") return null;
  const isToken2022 =
    snapshot.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ||
    snapshot.data.program === "spl-token-2022";
  const uiAmount =
    typeof info.tokenAmount?.uiAmount === "number"
      ? info.tokenAmount.uiAmount
      : Number(info.tokenAmount?.amount || 0) /
        Math.pow(10, info.tokenAmount?.decimals ?? 0);

  return {
    mint: info.mint,
    owner: info.owner ?? null,
    delegate: info.delegate ?? null,
    uiAmount: Number.isFinite(uiAmount) ? uiAmount : 0,
    isToken2022,
  };
}

/**
 * Pure diff calculator comparing pre-transaction and post-simulation account snapshots.
 */
export function computeSimulationDiffs(params: {
  addresses: string[];
  feePayer: string | null;
  preAccounts: (JsonParsedAccountSnapshot | null)[];
  postAccounts: (JsonParsedAccountSnapshot | null)[];
  logs: string[] | null | undefined;
}): {
  balanceDiffs: SimulatedBalanceDiff[];
  authorityChanges: SimulationAuthorityChange[];
  hiddenCpiPrograms: { programId: string; depth: number; verified: boolean }[];
  discoveredMints: string[];
} {
  const balanceDiffs: SimulatedBalanceDiff[] = [];
  const authorityChanges: SimulationAuthorityChange[] = [];
  const mintSet = new Set<string>();

  for (let i = 0; i < params.addresses.length; i++) {
    const addr = params.addresses[i];
    const pre = params.preAccounts[i] ?? null;
    const post = params.postAccounts[i] ?? null;

    if (pre && post) {
      const lamportDelta = (post.lamports ?? 0) - (pre.lamports ?? 0);
      if (Math.abs(lamportDelta) >= 1 && (addr === params.feePayer || lamportDelta !== 0)) {
        const solDelta = Number((lamportDelta / 1e9).toFixed(6));
        if (solDelta !== 0) {
          balanceDiffs.push({
            address: addr,
            asset: "SOL",
            mint: WSOL_MINT,
            deltaUiAmount: solDelta,
            direction: solDelta > 0 ? "IN" : "OUT",
            isToken2022: false,
          });
        }
      }
    }

    const preTok = getParsedTokenInfo(pre);
    const postTok = getParsedTokenInfo(post);

    const mint = postTok?.mint ?? preTok?.mint;
    if (mint && mint !== WSOL_MINT) {
      mintSet.add(mint);
    }

    if (preTok && postTok && mint) {
      const tokenDelta = Number((postTok.uiAmount - preTok.uiAmount).toFixed(6));
      if (tokenDelta !== 0) {
        balanceDiffs.push({
          address: addr,
          asset: `${mint.slice(0, 4)}..${mint.slice(-4)}`,
          mint,
          deltaUiAmount: tokenDelta,
          direction: tokenDelta > 0 ? "IN" : "OUT",
          isToken2022: postTok.isToken2022 || preTok.isToken2022,
        });
      }

      if (preTok.owner && postTok.owner && preTok.owner !== postTok.owner) {
        authorityChanges.push({
          account: addr,
          mint,
          changeType: "OWNER_CHANGED",
          before: preTok.owner,
          after: postTok.owner,
        });
      }

      if (postTok.delegate && postTok.delegate !== preTok.delegate) {
        authorityChanges.push({
          account: addr,
          mint,
          changeType: "DELEGATE_GRANTED",
          before: preTok.delegate,
          after: postTok.delegate,
        });
      }
    }
  }

  const allCpis = extractInvokedProgramsFromLogs(params.logs);
  const hiddenCpiPrograms = allCpis.filter((p) => p.depth >= 2 && !p.verified);

  return {
    balanceDiffs,
    authorityChanges,
    hiddenCpiPrograms,
    discoveredMints: Array.from(mintSet),
  };
}

async function rpcJsonCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`RPC HTTP ${res.status}`);
    }
    const payload = await res.json();
    if (payload.error) {
      throw new Error(payload.error.message || "RPC returned error");
    }
    return payload.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs live Solana RPC pre-sign simulation (`sigVerify: false`, `replaceRecentBlockhash: true`),
 * computes real balance diffs & hidden CPI/authority shifts, and scans discovered token mints.
 */
export async function simulateSolanaTransactionRpc(
  base64Payload: string,
  options?: {
    network?: "mainnet" | "devnet";
    rpcUrl?: string;
    veniceApiKey?: string;
    inspectTokens?: boolean;
    timeoutMs?: number;
  }
): Promise<RpcTxSimulationReport> {
  const networkLabel: RpcTxSimulationReport["network"] = options?.rpcUrl?.trim()
    ? "custom"
    : options?.network === "devnet"
    ? "devnet"
    : "mainnet";

  const candidateRpcs = options?.rpcUrl?.trim()
    ? [options.rpcUrl.trim()]
    : networkLabel === "devnet"
    ? [DEVNET_RPC_URL]
    : MAINNET_RPC_URLS;

  const { feePayer, addresses } = extractCandidateSimulationAddresses(base64Payload);
  const timeoutMs = options?.timeoutMs ?? 2800;

  let lastError = "RPC request failed";

  for (const rpcUrl of candidateRpcs) {
    try {
      const [preRes, simRes] = await Promise.all([
        addresses.length > 0
          ? rpcJsonCall<{ value: (JsonParsedAccountSnapshot | null)[] }>(
              rpcUrl,
              "getMultipleAccounts",
              [addresses, { encoding: "jsonParsed", commitment: "confirmed" }],
              timeoutMs
            )
          : Promise.resolve({ value: [] as (JsonParsedAccountSnapshot | null)[] }),
        rpcJsonCall<{
          value: {
            err: unknown;
            logs: string[] | null;
            unitsConsumed?: number;
            accounts?: (JsonParsedAccountSnapshot | null)[] | null;
          };
        }>(
          rpcUrl,
          "simulateTransaction",
          [
            base64Payload.trim(),
            {
              encoding: "base64",
              sigVerify: false,
              replaceRecentBlockhash: true,
              commitment: "confirmed",
              ...(addresses.length > 0
                ? {
                    accounts: {
                      encoding: "jsonParsed",
                      addresses,
                    },
                  }
                : {}),
            },
          ],
          timeoutMs
        ),
      ]);

      const simVal = simRes?.value;
      if (!simVal) {
        lastError = "Empty simulation result from RPC.";
        continue;
      }

      const postAccounts = simVal.accounts ?? [];
      const diff = computeSimulationDiffs({
        addresses,
        feePayer,
        preAccounts: preRes?.value ?? [],
        postAccounts,
        logs: simVal.logs,
      });

      let tokenAudits: TokenScanReport[] = [];
      if (options?.inspectTokens !== false && diff.discoveredMints.length > 0) {
        const mintsToScan = diff.discoveredMints.slice(0, 2);
        const settled = await Promise.allSettled(
          mintsToScan.map((mint) =>
            Promise.race([
              scanSolanaTokenMint(mint, {
                rpcUrl,
                veniceApiKey: options?.veniceApiKey,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Token scan timeout")), 2500)
              ),
            ])
          )
        );
        tokenAudits = settled
          .filter(
            (r): r is PromiseFulfilledResult<TokenScanReport> =>
              r.status === "fulfilled"
          )
          .map((r) => r.value);
      }

      return {
        status: simVal.err ? "SIMULATED_ERROR" : "SIMULATED_OK",
        network: networkLabel,
        rpcError: simVal.err ? JSON.stringify(simVal.err) : null,
        unitsConsumed:
          typeof simVal.unitsConsumed === "number" ? simVal.unitsConsumed : null,
        balanceDiffs: diff.balanceDiffs,
        authorityChanges: diff.authorityChanges,
        hiddenCpiPrograms: diff.hiddenCpiPrograms,
        discoveredMints: diff.discoveredMints,
        tokenAudits,
        logsPreview: (simVal.logs ?? []).slice(0, 12),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "RPC simulation failed";
    }
  }

  return {
    status: "RPC_UNAVAILABLE",
    network: networkLabel,
    rpcError: lastError,
    unitsConsumed: null,
    balanceDiffs: [],
    authorityChanges: [],
    hiddenCpiPrograms: [],
    discoveredMints: [],
    tokenAudits: [],
    logsPreview: [],
  };
}
