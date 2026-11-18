import { PublicKey } from "@solana/web3.js";
import { classifyDevTx } from "./buildcheck/token-forensics";
import { EVM_CHAINS } from "./evm-security";
import {
  getChainDisplayName,
  getWatchedWalletExplorerUrl,
  isValidWatchedChain,
  type WatchedWalletActivityEvent,
  type WatchedWalletActivitySnapshot,
  type WatchWalletChain,
} from "./wallet-watch-client";

export * from "./wallet-watch-client";

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const SOLANA_HISTORY_RPC =
  process.env.SOLANA_RPC_URL?.trim() || "https://solana-rpc.publicnode.com";

export function normalizeWatchedAddress(
  rawAddress: string,
  chainHint?: string | null
): { valid: boolean; address: string; chain: WatchWalletChain; error?: string } {
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    return { valid: false, address: "", chain: "solana", error: "Wallet address is required." };
  }

  if (/^0x[a-f0-9]{40}$/i.test(trimmed)) {
    const cleanHint = (chainHint || "").trim().toLowerCase();
    const chain: WatchWalletChain =
      cleanHint && cleanHint !== "solana" && isValidWatchedChain(cleanHint)
        ? cleanHint
        : "robinhood";
    return { valid: true, address: trimmed.toLowerCase(), chain };
  }

  try {
    const pk = new PublicKey(trimmed);
    return { valid: true, address: pk.toBase58(), chain: "solana" };
  } catch {
    return {
      valid: false,
      address: trimmed,
      chain: "solana",
      error: "Invalid Solana (Base58) or EVM (0x...) wallet address.",
    };
  }
}

async function rpcJsonCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = 4200
): Promise<{ result?: T; error?: string }> {
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
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) return { error: json.error.message || "RPC error" };
    return { result: json.result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "RPC request failed" };
  } finally {
    clearTimeout(timer);
  }
}

function padEvmTopicAddress(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function formatHexWeiToEth(hexBalance: string | undefined, symbol: string): string | null {
  if (!hexBalance || !hexBalance.startsWith("0x")) return null;
  try {
    const wei = BigInt(hexBalance);
    const whole = wei / BigInt("1000000000000000000");
    const rem = Number((wei % BigInt("1000000000000000000")) / BigInt("100000000000000"));
    return `${whole.toString()}.${String(rem).padStart(4, "0")} ${symbol}`;
  } catch {
    return null;
  }
}

/**
 * Fetches live recent transactions, balance, and optional token-specific
 * inflow/outflow activity for a watched Solana or EVM wallet.
 */
export async function fetchWatchedWalletActivity(params: {
  address: string;
  chain: WatchWalletChain;
  tokenAddress?: string | null;
}): Promise<WatchedWalletActivitySnapshot> {
  const checkedAt = new Date().toISOString();
  const normalized = normalizeWatchedAddress(params.address, params.chain);
  if (!normalized.valid) {
    return {
      address: params.address,
      chain: params.chain,
      networkName: getChainDisplayName(params.chain),
      nativeBalance: null,
      nonce: null,
      tokenBalancePct: null,
      latestTxHash: null,
      latestSummary: null,
      latestTimestamp: null,
      explorerUrl: getWatchedWalletExplorerUrl(params.address, params.chain),
      events: [],
      checkedAt,
      error: normalized.error || "Invalid address",
    };
  }

  if (normalized.chain === "solana") {
    const [balRes, sigRes] = await Promise.all([
      rpcJsonCall<{ value?: number }>(SOLANA_HISTORY_RPC, "getBalance", [normalized.address], 3600),
      rpcJsonCall<Array<{ signature: string; slot: number; blockTime?: number | null; err?: unknown }>>(
        SOLANA_HISTORY_RPC,
        "getSignaturesForAddress",
        [normalized.address, { limit: 6 }],
        4000
      ),
    ]);

    const nativeBalance =
      typeof balRes.result?.value === "number"
        ? `${(balRes.result.value / 1e9).toFixed(4)} SOL`
        : null;

    const sigs = (Array.isArray(sigRes.result) ? sigRes.result : []).slice(0, 5);
    const parsedTxs = await Promise.all(
      sigs.slice(0, 3).map((s) =>
        rpcJsonCall<Parameters<typeof classifyDevTx>[0]>(
          SOLANA_HISTORY_RPC,
          "getTransaction",
          [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }],
          3600
        )
      )
    );

    const events: WatchedWalletActivityEvent[] = sigs.map((s, idx) => {
      const tx = parsedTxs[idx]?.result || null;
      const classified = tx
        ? classifyDevTx(tx, normalized.address)
        : { action: "other" as const, summary: s.err ? "Failed transaction" : "Solana transaction" };
      return {
        txHash: s.signature,
        action: classified.action,
        summary: s.err ? `${classified.summary} (Failed)` : classified.summary,
        timestamp: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
        slotOrBlock: s.slot,
        explorerUrl: `https://solscan.io/tx/${s.signature}`,
      };
    });

    return {
      address: normalized.address,
      chain: "solana",
      networkName: "Solana",
      nativeBalance,
      nonce: null,
      tokenBalancePct: null,
      latestTxHash: events[0]?.txHash || null,
      latestSummary:
        events[0]?.summary ||
        (balRes.error ? `RPC wait: ${balRes.error}` : "No recent transactions"),
      latestTimestamp: events[0]?.timestamp || null,
      explorerUrl: getWatchedWalletExplorerUrl(normalized.address, "solana"),
      events,
      checkedAt,
      error: sigRes.error && events.length === 0 ? sigRes.error : null,
    };
  }

  const chainCfg = EVM_CHAINS[normalized.chain];
  if (!chainCfg || chainCfg.rpcUrls.length === 0) {
    return {
      address: normalized.address,
      chain: normalized.chain,
      networkName: getChainDisplayName(normalized.chain),
      nativeBalance: null,
      nonce: null,
      tokenBalancePct: null,
      latestTxHash: null,
      latestSummary: null,
      latestTimestamp: null,
      explorerUrl: getWatchedWalletExplorerUrl(normalized.address, normalized.chain),
      events: [],
      checkedAt,
      error: "Unsupported EVM chain",
    };
  }

  let activeRpc = chainCfg.rpcUrls[0];
  let balHex: string | undefined;
  let nonceHex: string | undefined;
  let blockHex: string | undefined;

  for (const rpcUrl of chainCfg.rpcUrls) {
    const [bRes, nRes, blkRes] = await Promise.all([
      rpcJsonCall<string>(rpcUrl, "eth_getBalance", [normalized.address, "latest"], 3600),
      rpcJsonCall<string>(rpcUrl, "eth_getTransactionCount", [normalized.address, "latest"], 3600),
      rpcJsonCall<string>(rpcUrl, "eth_blockNumber", [], 3600),
    ]);
    if (bRes.result || nRes.result) {
      activeRpc = rpcUrl;
      balHex = bRes.result;
      nonceHex = nRes.result;
      blockHex = blkRes.result;
      break;
    }
  }

  const nativeBalance = formatHexWeiToEth(balHex, chainCfg.nativeSymbol);
  const nonce = nonceHex ? Number.parseInt(nonceHex, 16) : null;
  const latestBlock = blockHex ? Number.parseInt(blockHex, 16) : 0;

  let tokenBalancePct: number | null = null;
  const events: WatchedWalletActivityEvent[] = [];
  const paddedWallet = padEvmTopicAddress(normalized.address);

  if (
    params.tokenAddress &&
    /^0x[a-f0-9]{40}$/i.test(params.tokenAddress.trim()) &&
    latestBlock > 0
  ) {
    const cleanToken = params.tokenAddress.trim().toLowerCase();
    const span =
      normalized.chain === "robinhood" ||
      normalized.chain === "base" ||
      normalized.chain === "arbitrum" ||
      normalized.chain === "optimism"
        ? 300_000
        : 45_000;
    const fromBlock = `0x${Math.max(0, latestBlock - span).toString(16)}`;
    const walletDataArg = normalized.address.replace(/^0x/, "").padStart(64, "0");

    const [balTokenRes, supplyTokenRes, outLogsRes, inLogsRes] = await Promise.all([
      rpcJsonCall<string>(
        activeRpc,
        "eth_call",
        [{ to: cleanToken, data: `0x70a08231${walletDataArg}` }, "latest"],
        3200
      ),
      rpcJsonCall<string>(
        activeRpc,
        "eth_call",
        [{ to: cleanToken, data: "0x18160ddd" }, "latest"],
        3200
      ),
      rpcJsonCall<Array<{ transactionHash: string; blockNumber: string; data: string }>>(
        activeRpc,
        "eth_getLogs",
        [{ address: cleanToken, topics: [ERC20_TRANSFER_TOPIC, paddedWallet], fromBlock, toBlock: blockHex }],
        4200
      ),
      rpcJsonCall<Array<{ transactionHash: string; blockNumber: string; data: string }>>(
        activeRpc,
        "eth_getLogs",
        [{ address: cleanToken, topics: [ERC20_TRANSFER_TOPIC, null, paddedWallet], fromBlock, toBlock: blockHex }],
        4200
      ),
    ]);

    let supplyRaw = BigInt(0);
    try {
      if (supplyTokenRes.result && supplyTokenRes.result.length > 2) {
        supplyRaw = BigInt(supplyTokenRes.result);
      }
      if (balTokenRes.result && balTokenRes.result.length > 2 && supplyRaw > BigInt(0)) {
        const balRaw = BigInt(balTokenRes.result);
        tokenBalancePct = Number(((Number((balRaw * BigInt(10000)) / supplyRaw)) / 100).toFixed(2));
      }
    } catch {
      // Ignore parse error
    }

    const rawEvents: Array<{ txHash: string; blockNum: number; action: "token_out" | "token_in"; valRaw: bigint }> = [];
    for (const log of outLogsRes.result || []) {
      const blk = Number.parseInt(log.blockNumber, 16) || 0;
      let val = BigInt(0);
      try {
        val = BigInt(log.data);
      } catch {
        // ignore
      }
      rawEvents.push({ txHash: log.transactionHash, blockNum: blk, action: "token_out", valRaw: val });
    }
    for (const log of inLogsRes.result || []) {
      const blk = Number.parseInt(log.blockNumber, 16) || 0;
      let val = BigInt(0);
      try {
        val = BigInt(log.data);
      } catch {
        // ignore
      }
      rawEvents.push({ txHash: log.transactionHash, blockNum: blk, action: "token_in", valRaw: val });
    }

    rawEvents
      .sort((a, b) => b.blockNum - a.blockNum)
      .slice(0, 6)
      .forEach((ev) => {
        const pctStr =
          supplyRaw > BigInt(0) && ev.valRaw > BigInt(0)
            ? ` (${(Number((ev.valRaw * BigInt(10000)) / supplyRaw) / 100).toFixed(2)}% supply)`
            : "";
        events.push({
          txHash: ev.txHash,
          action: ev.action,
          summary:
            ev.action === "token_out"
              ? `Sent / sold token${pctStr} at blk #${ev.blockNum}`
              : `Received / bought token${pctStr} at blk #${ev.blockNum}`,
          timestamp: null,
          slotOrBlock: ev.blockNum,
          explorerUrl: `${chainCfg.explorerUrl}/tx/${ev.txHash}`,
        });
      });
  }

  const latestSummary =
    events[0]?.summary ||
    (nonce !== null
      ? `Nonce #${nonce}${nativeBalance ? ` · ${nativeBalance}` : ""} on ${chainCfg.shortName}`
      : nativeBalance
        ? `Balance ${nativeBalance} on ${chainCfg.shortName}`
        : "RPC snapshot unavailable");

  return {
    address: normalized.address,
    chain: normalized.chain,
    networkName: chainCfg.shortName,
    nativeBalance,
    nonce,
    tokenBalancePct,
    latestTxHash: events[0]?.txHash || (nonce !== null ? `nonce:${nonce}` : null),
    latestSummary,
    latestTimestamp: null,
    explorerUrl: getWatchedWalletExplorerUrl(normalized.address, normalized.chain),
    events,
    checkedAt,
  };
}
