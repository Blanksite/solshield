import { PublicKey } from "@solana/web3.js";
import type { TokenScanReport } from "../token-scanner";
import type {
  DevLaunchedTokenSummary,
  DevTxEntry,
  DevWalletHistory,
  HolderAuditCheckRow,
  HolderCabalCluster,
  HolderClusterNode,
  HolderNodeRole,
  HoldersDeepAnalysis,
  TokenDeepForensics,
  TokenDeepMarketStats,
  TokenDeepMetadata,
} from "./types";
import { assertSafePublicHttpUrl } from "./url-safety";
import {
  buildSolanaWalletsToWatch,
  type SolanaWalletSwapActivityInput,
} from "./wallet-watch";

const METAPLEX_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const SOLANA_HISTORY_RPC =
  process.env.SOLANA_RPC_URL?.trim() || "https://solana-rpc.publicnode.com";

const KNOWN_POOL_AND_LOCK_OWNERS = new Set([
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium Authority V4
  "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh", // Raydium LaunchLab Vault Authority
  "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC", // Meteora DAMM v2 Pool Authority
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL", // Raydium CPMM Vault
]);

const KNOWN_BURN_OWNERS = new Set([
  "11111111111111111111111111111111",
  "1nc1nerator11111111111111111111111111111111",
  "deadbeef11111111111111111111111111111111111",
]);

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

async function rpcCall<T>(
  method: string,
  params: unknown[],
  timeoutMs = 4500,
  rpcUrl = SOLANA_HISTORY_RPC
): Promise<T | null> {
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
    if (!res.ok) return null;
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error || json.result === undefined) return null;
    return json.result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonSafe<T>(url: string, timeoutMs = 5200): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SolShield-BuildCheck/1.0" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeWebUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return null;
}

function normalizeTwitterUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const cleanHandle = trimmed.replace(/^@/, "");
  return cleanHandle ? `https://x.com/${cleanHandle}` : null;
}

async function fetchMetaplexUriMetadata(mintAddress: string): Promise<{
  updateAuthority: string | null;
  name: string | null;
  symbol: string | null;
  description: string | null;
  imageUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}> {
  try {
    const mintPk = new PublicKey(mintAddress);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
      METAPLEX_PROGRAM_ID
    );
    const info = await rpcCall<{ data?: [string, string] }>(
      "getAccountInfo",
      [pda.toBase58(), { encoding: "base64" }],
      4000
    );
    const b64 = info?.data?.[0];
    if (!b64) {
      return {
        updateAuthority: null,
        name: null,
        symbol: null,
        description: null,
        imageUrl: null,
        website: null,
        twitter: null,
        telegram: null,
      };
    }

    const buf = Buffer.from(b64, "base64");
    if (buf.length < 75) {
      return {
        updateAuthority: null,
        name: null,
        symbol: null,
        description: null,
        imageUrl: null,
        website: null,
        twitter: null,
        telegram: null,
      };
    }

    const updateAuthority = new PublicKey(buf.subarray(1, 33)).toBase58();
    let offset = 65;
    const readStr = () => {
      if (offset + 4 > buf.length) return null;
      const len = buf.readUInt32LE(offset);
      offset += 4;
      if (len > 320 || offset + len > buf.length) return null;
      const s = buf.subarray(offset, offset + len).toString("utf8").replace(/\0/g, "").trim();
      offset += len;
      return s || null;
    };

    const name = readStr();
    const symbol = readStr();
    const uri = readStr();

    let description: string | null = null;
    let imageUrl: string | null = null;
    let website: string | null = null;
    let twitter: string | null = null;
    let telegram: string | null = null;

    if (uri && (uri.startsWith("https://") || uri.startsWith("http://"))) {
      try {
        await assertSafePublicHttpUrl(uri);
        const metaJson = await fetchJsonSafe<{
          description?: string;
          image?: string;
          website?: string;
          external_url?: string;
          twitter?: string;
          telegram?: string;
          extensions?: { website?: string; twitter?: string; telegram?: string };
        }>(uri, 4000);
        if (metaJson) {
          description = metaJson.description?.trim() || null;
          imageUrl = metaJson.image?.trim() || null;
          website = normalizeWebUrl(
            metaJson.website || metaJson.external_url || metaJson.extensions?.website
          );
          twitter = normalizeTwitterUrl(metaJson.twitter || metaJson.extensions?.twitter);
          telegram = normalizeWebUrl(metaJson.telegram || metaJson.extensions?.telegram);
        }
      } catch {
        // Ignore unsafe or unreachable metadata URI
      }
    }

    return {
      updateAuthority,
      name,
      symbol,
      description,
      imageUrl,
      website,
      twitter,
      telegram,
    };
  } catch {
    return {
      updateAuthority: null,
      name: null,
      symbol: null,
      description: null,
      imageUrl: null,
      website: null,
      twitter: null,
      telegram: null,
    };
  }
}

interface ParsedRpcTx {
  slot?: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: Array<{
      mint?: string;
      owner?: string;
      uiTokenAmount?: { uiAmount?: number | null };
    }>;
    postTokenBalances?: Array<{
      mint?: string;
      owner?: string;
      uiTokenAmount?: { uiAmount?: number | null };
    }>;
    logMessages?: string[];
    innerInstructions?: Array<{
      instructions?: Array<{
        program?: string;
        programId?: string;
        parsed?: { type?: string; info?: Record<string, unknown> };
      }>;
    }>;
  };
  transaction?: {
    message?: {
      accountKeys?: Array<{ pubkey: string; signer?: boolean } | string>;
      instructions?: Array<{
        program?: string;
        programId?: string;
        parsed?: { type?: string; info?: Record<string, unknown> };
      }>;
    };
  };
}

function extractSolFunderFromTx(
  tx: ParsedRpcTx | null,
  recipientOwner: string
): string | null {
  if (!tx?.transaction?.message) return null;
  const allIxs = [
    ...(tx.transaction.message.instructions || []),
    ...((tx.meta?.innerInstructions || []).flatMap((inIx) => inIx.instructions || [])),
  ];

  for (const ix of allIxs) {
    if (
      ix?.parsed?.type === "transfer" &&
      ix?.parsed?.info?.destination === recipientOwner &&
      typeof ix?.parsed?.info?.lamports === "number" &&
      ix.parsed.info.lamports >= 500_000
    ) {
      const src = ix.parsed.info.source;
      if (typeof src === "string" && src !== recipientOwner) {
        return src;
      }
    }
  }

  const rawKeys = tx.transaction.message.accountKeys || [];
  const keys = rawKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const signers = rawKeys
    .filter((k): k is { pubkey: string; signer?: boolean } => typeof k !== "string" && Boolean(k.signer))
    .map((k) => k.pubkey);

  const pre = tx.meta?.preBalances || [];
  const post = tx.meta?.postBalances || [];
  let maxDropAddr: string | null = null;
  let maxDrop = 0;

  for (let i = 0; i < keys.length; i += 1) {
    const addr = keys[i];
    if (!addr || addr === recipientOwner) continue;
    const drop = (pre[i] || 0) - (post[i] || 0);
    if (drop > maxDrop && drop >= 3_000_000) {
      maxDrop = drop;
      maxDropAddr = addr;
    }
  }

  if (maxDropAddr) return maxDropAddr;
  const nonSelfSigner = signers.find((s) => s !== recipientOwner);
  return nonSelfSigner || null;
}

interface RawHolderRow {
  address: string;
  owner: string;
  pct: number;
  uiAmount: number;
  insider?: boolean;
}

interface RpcSigRow {
  signature: string;
  slot: number;
  blockTime?: number | null;
  err?: unknown;
}

async function sampleSolanaPoolSwapActivity(params: {
  poolAddress: string | null;
  mintAddress: string;
  poolVaultOwners: Set<string>;
}): Promise<Record<string, SolanaWalletSwapActivityInput>> {
  if (!params.poolAddress) return {};
  try {
    const sigs = await rpcCall<RpcSigRow[]>(
      "getSignaturesForAddress",
      [params.poolAddress, { limit: 24 }],
      3600
    );
    const validSigs = (Array.isArray(sigs) ? sigs : [])
      .filter((s) => !s.err && Boolean(s.signature))
      .slice(0, 10);
    if (validSigs.length === 0) return {};

    const txs = await Promise.all(
      validSigs.map((s) =>
        rpcCall<ParsedRpcTx>(
          "getTransaction",
          [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }],
          3600
        )
      )
    );

    const out: Record<string, SolanaWalletSwapActivityInput> = {};
    const poolExclude = new Set([
      ...KNOWN_POOL_AND_LOCK_OWNERS,
      ...KNOWN_BURN_OWNERS,
      ...params.poolVaultOwners,
    ]);

    for (let i = 0; i < validSigs.length; i += 1) {
      const tx = txs[i];
      const slot = validSigs[i].slot;
      if (!tx?.meta || tx.meta.err) continue;

      const deltaByOwner = new Map<string, number>();
      for (const pre of tx.meta.preTokenBalances || []) {
        if (pre.mint !== params.mintAddress || !pre.owner || poolExclude.has(pre.owner)) {
          continue;
        }
        const amt = pre.uiTokenAmount?.uiAmount ?? 0;
        deltaByOwner.set(pre.owner, (deltaByOwner.get(pre.owner) || 0) - amt);
      }
      for (const post of tx.meta.postTokenBalances || []) {
        if (post.mint !== params.mintAddress || !post.owner || poolExclude.has(post.owner)) {
          continue;
        }
        const amt = post.uiTokenAmount?.uiAmount ?? 0;
        deltaByOwner.set(post.owner, (deltaByOwner.get(post.owner) || 0) + amt);
      }

      for (const [owner, delta] of deltaByOwner.entries()) {
        if (Math.abs(delta) < 1e-6) continue;
        const entry = out[owner] || {
          address: owner,
          buyCount: 0,
          sellCount: 0,
          earliestSlot: slot,
        };
        if (delta > 0) entry.buyCount += 1;
        else entry.sellCount += 1;
        entry.earliestSlot =
          entry.earliestSlot != null ? Math.min(entry.earliestSlot, slot) : slot;
        out[owner] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function analyzeHoldersAndCabal(params: {
  rawHolders: RawHolderRow[];
  poolVaultOwners: Set<string>;
  devAddress: string | null;
  totalHolders: number | null;
  lpLockedPct: number | null;
  mintReport: TokenScanReport | null;
  insiderNetworksCount: number;
  swapActivityByWallet?:
    | Record<string, SolanaWalletSwapActivityInput>
    | Promise<Record<string, SolanaWalletSwapActivityInput>>;
}): Promise<HoldersDeepAnalysis> {
  const poolOwners = new Set([...KNOWN_POOL_AND_LOCK_OWNERS, ...params.poolVaultOwners]);

  let poolPct = 0;
  let burnPct = 0;
  let devPct = 0;
  const nonPoolCandidates: RawHolderRow[] = [];

  for (const h of params.rawHolders) {
    if (!h.owner) continue;
    if (KNOWN_BURN_OWNERS.has(h.owner)) {
      burnPct += h.pct;
      continue;
    }
    if (poolOwners.has(h.owner)) {
      poolPct += h.pct;
      continue;
    }
    if (params.devAddress && h.owner === params.devAddress) {
      devPct += h.pct;
    }
    nonPoolCandidates.push(h);
  }

  // Deduplicate by owner (in case one owner holds multiple token accounts)
  const ownerMap = new Map<string, RawHolderRow>();
  for (const h of nonPoolCandidates) {
    const prev = ownerMap.get(h.owner);
    if (prev) {
      prev.pct += h.pct;
      prev.uiAmount += h.uiAmount;
      prev.insider = Boolean(prev.insider || h.insider);
    } else {
      ownerMap.set(h.owner, { ...h });
    }
  }

  const topOwners = Array.from(ownerMap.values())
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);

  // Query funding & earliest slot traces in parallel with bounded concurrency (top 10 wallets)
  const tracedHolders: HolderClusterNode[] = await Promise.all(
    topOwners.map(async (h) => {
      const sigs = await rpcCall<RpcSigRow[]>(
        "getSignaturesForAddress",
        [h.owner, { limit: 60 }],
        3800
      );
      const list = Array.isArray(sigs) ? sigs : [];
      const oldest = list.length > 0 ? list[list.length - 1] : null;
      const isFresh = list.length > 0 && list.length < 60;
      let funder: string | null = null;

      if (oldest?.signature && isFresh) {
        const tx = await rpcCall<ParsedRpcTx>(
          "getTransaction",
          [oldest.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }],
          3800
        );
        funder = extractSolFunderFromTx(tx, h.owner);
      }

      return {
        address: h.owner,
        tokenAccount: h.address,
        pct: Number(h.pct.toFixed(2)),
        uiAmount: h.uiAmount,
        role: (h.insider ? "cabal" : "retail") as HolderNodeRole,
        funder,
        firstSlot: oldest?.slot ?? null,
        isFresh,
        txCount: list.length,
      };
    })
  );

  // Detect Co-Funded Cabal Clusters (same upstream SOL funder)
  const byFunder = new Map<string, HolderClusterNode[]>();
  for (const node of tracedHolders) {
    if (!node.funder) continue;
    const arr = byFunder.get(node.funder) || [];
    arr.push(node);
    byFunder.set(node.funder, arr);
  }

  const clusters: HolderCabalCluster[] = [];
  const cabalAddresses = new Set<string>();
  const sniperAddresses = new Set<string>();

  for (const [funder, group] of byFunder.entries()) {
    if (group.length >= 2) {
      const combinedPct = Number(
        group.reduce((acc, w) => acc + w.pct, 0).toFixed(2)
      );
      group.forEach((w) => {
        w.role = "cabal";
        cabalAddresses.add(w.address);
      });
      clusters.push({
        clusterId: `funder_${funder.slice(0, 6)}`,
        kind: "co_funded",
        label: `Co-funded cluster (${group.length} wallets from ${funder.slice(0, 6)}...)`,
        funder,
        slot: group[0].firstSlot,
        combinedPct,
        wallets: group,
      });
    }
  }

  // Detect Same-Slot / Tight Launch Slot Clusters (<= 4 slots apart among fresh buyers)
  const freshWithSlot = tracedHolders
    .filter((n) => n.isFresh && n.firstSlot !== null)
    .sort((a, b) => (a.firstSlot || 0) - (b.firstSlot || 0));

  for (let i = 0; i < freshWithSlot.length; i += 1) {
    const anchor = freshWithSlot[i];
    if (sniperAddresses.has(anchor.address)) continue;
    const sameWindow = freshWithSlot.filter(
      (cand) =>
        cand.firstSlot !== null &&
        anchor.firstSlot !== null &&
        Math.abs(cand.firstSlot - anchor.firstSlot) <= 4
    );
    if (sameWindow.length >= 2) {
      const nonCabalInWindow = sameWindow.filter((w) => !cabalAddresses.has(w.address));
      if (nonCabalInWindow.length >= 2) {
        const combinedPct = Number(
          sameWindow.reduce((acc, w) => acc + w.pct, 0).toFixed(2)
        );
        sameWindow.forEach((w) => {
          sniperAddresses.add(w.address);
          if (!cabalAddresses.has(w.address)) {
            w.role = "sniper";
          }
        });
        clusters.push({
          clusterId: `slot_${anchor.firstSlot}`,
          kind: "same_slot",
          label: `Same-window launch snipers (slot ~${anchor.firstSlot})`,
          funder: null,
          slot: anchor.firstSlot,
          combinedPct,
          wallets: sameWindow,
        });
      }
    }
  }

  // Also include indexer-flagged insiders if not yet grouped
  const insiderNodes = tracedHolders.filter(
    (n) => n.role === "cabal" && !cabalAddresses.has(n.address)
  );
  if (insiderNodes.length > 0) {
    const combinedPct = Number(
      insiderNodes.reduce((acc, w) => acc + w.pct, 0).toFixed(2)
    );
    insiderNodes.forEach((w) => cabalAddresses.add(w.address));
    clusters.push({
      clusterId: "indexer_insiders",
      kind: "insider_flag",
      label: `Flagged insider wallets (${insiderNodes.length})`,
      funder: null,
      slot: null,
      combinedPct,
      wallets: insiderNodes,
    });
  }

  // Mark Dev role node explicitly
  tracedHolders.forEach((n) => {
    if (params.devAddress && n.address === params.devAddress) {
      n.role = "dev";
    }
  });

  // Add pool & burn anchor nodes so graph can visualize full supply ecology
  const poolAndBurnNodes: HolderClusterNode[] = params.rawHolders
    .filter((h) => poolOwners.has(h.owner) || KNOWN_BURN_OWNERS.has(h.owner))
    .slice(0, 3)
    .map((h) => ({
      address: h.owner,
      tokenAccount: h.address,
      pct: Number(h.pct.toFixed(2)),
      uiAmount: h.uiAmount,
      role: KNOWN_BURN_OWNERS.has(h.owner) ? ("burn" as const) : ("pool" as const),
      funder: null,
      firstSlot: null,
      isFresh: false,
      txCount: 0,
    }));

  const insidersPct = Number(
    tracedHolders
      .filter((n) => cabalAddresses.has(n.address))
      .reduce((acc, n) => acc + n.pct, 0)
      .toFixed(1)
  );
  const snipersPct = Number(
    tracedHolders
      .filter((n) => n.role === "sniper")
      .reduce((acc, n) => acc + n.pct, 0)
      .toFixed(1)
  );
  const freshCount = tracedHolders.filter((n) => n.isFresh).length;
  const freshPct = Number(
    tracedHolders
      .filter((n) => n.isFresh)
      .reduce((acc, n) => acc + n.pct, 0)
      .toFixed(1)
  );
  const top10NonPoolPct = Number(
    tracedHolders.reduce((acc, n) => acc + n.pct, 0).toFixed(1)
  );

  // Count burned/locked supply (explicit burn wallets + locked pool reserve)
  const burnedOrLockedPct = Number(
    Math.min(95, burnPct + (params.lpLockedPct && params.lpLockedPct > 80 ? poolPct : 0)).toFixed(1)
  );
  const retailPct = Number(
    Math.max(0, 100 - insidersPct - snipersPct - burnedOrLockedPct - devPct).toFixed(1)
  );

  // Score calculation (0-100)
  let score = 88;
  const checks: HolderAuditCheckRow[] = [];
  const notes: string[] = [];

  if (clusters.length > 0 || params.insiderNetworksCount > 0) {
    const clusterPenalty = Math.min(34, clusters.length * 14 + insidersPct * 0.8);
    score -= clusterPenalty;
    checks.push({
      label: `${Math.max(clusters.length, params.insiderNetworksCount)} linked / same-slot group(s)`,
      value: `${Math.max(insidersPct, snipersPct).toFixed(1)}%`,
      status: "flag",
    });
    notes.push(
      `Detected ${Math.max(clusters.length, params.insiderNetworksCount)} linked wallet group(s) among top non-pool holders.`
    );
  } else {
    checks.push({ label: "No linked cabal clusters in top holders", status: "clear" });
  }

  if (snipersPct >= 8) {
    score -= Math.min(20, snipersPct * 0.9);
    checks.push({
      label: "Same-window early buyers held",
      value: `${snipersPct}%`,
      status: snipersPct >= 15 ? "flag" : "watch",
    });
  } else {
    checks.push({
      label: "Low launch sniper overlap",
      value: `${snipersPct}%`,
      status: "clear",
    });
  }

  if (freshCount >= 5) {
    score -= 10;
    checks.push({
      label: `Fresh top wallets (<60 txs)`,
      value: `${freshCount}/10 (${freshPct}%)`,
      status: "watch",
    });
  } else {
    checks.push({
      label: "Fresh top wallets (<60 txs)",
      value: `${freshCount}/10`,
      status: "clear",
    });
  }

  if (top10NonPoolPct >= 35) {
    score -= 18;
    checks.push({
      label: "Top 10 non-pool concentration",
      value: `${top10NonPoolPct}%`,
      status: "flag",
    });
    notes.push(`Top 10 non-pool wallets control ${top10NonPoolPct}% of supply.`);
  } else if (top10NonPoolPct >= 22) {
    score -= 7;
    checks.push({
      label: "Top 10 non-pool concentration",
      value: `${top10NonPoolPct}%`,
      status: "watch",
    });
  } else {
    checks.push({
      label: "Top 10 non-pool spread",
      value: `${top10NonPoolPct}%`,
      status: "clear",
    });
  }

  if (devPct >= 5) {
    score -= 14;
    checks.push({ label: "Dev holds supply", value: `${devPct.toFixed(1)}%`, status: "flag" });
  } else {
    checks.push({ label: "Dev holds", value: `${devPct.toFixed(1)}%`, status: "clear" });
  }

  if (params.mintReport) {
    if (params.mintReport.mintAuthority === null && params.mintReport.freezeAuthority === null) {
      checks.push({ label: "Mint & freeze authority revoked", status: "clear" });
    } else if (params.mintReport.verifiedAsset?.custodialIssuerAuthorities) {
      checks.push({
        label: `Issuer authorities (${params.mintReport.verifiedAsset.issuer})`,
        status: "clear",
      });
    } else {
      score -= 26;
      checks.push({ label: "Mint or freeze authority active", status: "flag" });
    }
  }

  if (params.lpLockedPct !== null && params.lpLockedPct >= 80) {
    checks.push({
      label: "Liquidity locked / launch curve",
      value: `${params.lpLockedPct.toFixed(0)}%`,
      status: "clear",
    });
  } else if (poolPct > 0) {
    checks.push({ label: "Liquidity pool detected", value: `${poolPct.toFixed(1)}%`, status: "watch" });
  }

  const resolvedSwapActivity = await Promise.resolve(params.swapActivityByWallet || {});
  const watchSummary = buildSolanaWalletsToWatch({
    tracedNodes: tracedHolders,
    devAddress: params.devAddress,
    swapActivityByWallet: resolvedSwapActivity,
  });

  if (watchSummary.possibleMmCount > 0) {
    checks.push({
      label: "Possible MM / two-way traders",
      value: `${watchSummary.possibleMmCount} wallet(s)`,
      status: "watch",
    });
  }

  const finalScore = Math.max(5, Math.min(100, Math.round(score)));
  const verdict = finalScore >= 68 ? "OK" : finalScore >= 40 ? "SKETCHY" : "RIGGED";

  return {
    score: finalScore,
    verdict,
    totalHolders: params.totalHolders,
    distribution: {
      insidersPct,
      snipersPct,
      burnedOrLockedPct,
      devPct: Number(devPct.toFixed(1)),
      retailPct,
    },
    clusters,
    nodes: [...poolAndBurnNodes, ...tracedHolders],
    checks,
    flagsCount: checks.filter((c) => c.status === "flag").length,
    watchCount: checks.filter((c) => c.status === "watch").length,
    clearCount: checks.filter((c) => c.status === "clear").length,
    notes,
    walletsToWatch: watchSummary.walletsToWatch,
    earlyBuyersCount: watchSummary.earlyBuyersCount,
    possibleMmCount: watchSummary.possibleMmCount,
  };
}

function formatTokenBurnAmount(raw: unknown): string | null {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return Math.round(num).toLocaleString("en-US");
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function classifyDevTx(
  tx: ParsedRpcTx | null,
  devAddress: string
): {
  action: DevTxEntry["action"];
  summary: string;
} {
  if (!tx?.transaction?.message) {
    return { action: "other", summary: "On-chain program interaction" };
  }
  const logs = (tx.meta?.logMessages || []).join(" ");
  const ixs = [
    ...(tx.transaction.message.instructions || []),
    ...((tx.meta?.innerInstructions || []).flatMap((inIx) => inIx.instructions || [])),
  ];

  // 1. Token burns (direct burn / burnChecked or transfers to canonical incinerator addresses)
  for (const ix of ixs) {
    const t = ix?.parsed?.type || "";
    if (t === "burn" || t === "burnChecked") {
      const tokenAmt = ix.parsed?.info?.tokenAmount as
        | { uiAmountString?: string; uiAmount?: number }
        | undefined;
      const amtStr = formatTokenBurnAmount(
        tokenAmt?.uiAmountString ?? tokenAmt?.uiAmount ?? ix.parsed?.info?.amount
      );
      return {
        action: "burn",
        summary: amtStr ? `Burned ${amtStr} tokens permanently` : "SPL Token burn executed",
      };
    }
    if (
      (t === "transfer" || t === "transferChecked") &&
      KNOWN_BURN_OWNERS.has(String(ix?.parsed?.info?.destination || ""))
    ) {
      const tokenAmt = ix.parsed?.info?.tokenAmount as
        | { uiAmountString?: string; uiAmount?: number }
        | undefined;
      const amtStr = formatTokenBurnAmount(tokenAmt?.uiAmountString ?? tokenAmt?.uiAmount);
      return {
        action: "burn",
        summary: amtStr ? `Burned ${amtStr} tokens to incinerator` : "Burned tokens to incinerator",
      };
    }
  }
  if (/Instruction:\s*(Burn|BurnChecked)/i.test(logs)) {
    return { action: "burn", summary: "SPL Token burn transaction" };
  }

  // 2. Creator / launchpad fee claim (check before transfer/withdraw noise)
  if (/Instruction:\s*(ClaimCurveFees|ClaimPlatformFeeFromVault|ClaimCreatorFee|CollectFees)/i.test(logs)) {
    return { action: "claim", summary: "Claimed launchpad creator fees" };
  }

  // 3. Genuine token mint / pool deploy (exclude stake/nonce Initialize+Withdraw helpers)
  const hasWithdraw = /Instruction:\s*Withdraw\b/i.test(logs);
  for (const ix of ixs) {
    const t = ix?.parsed?.type || "";
    if (t === "initializeMint" || t === "initializeMint2") {
      return { action: "deploy", summary: "Initialized SPL Token mint & launch pool" };
    }
  }
  if (!hasWithdraw && /Instruction:\s*(InitializeV2|CreatePool|InitializeMint|InitializePool)/i.test(logs)) {
    return { action: "deploy", summary: "Launched pool or initialized contract" };
  }

  // 4. DEX / Launchpad swaps
  if (/Instruction:\s*(Swap|Swap2|Route|BuyExactIn|SellExactIn)/i.test(logs)) {
    return { action: "swap", summary: "DEX / Launchpad token swap" };
  }

  if (hasWithdraw) {
    return { action: "transfer", summary: "Withdrew SOL / closed program account" };
  }

  // 5. Meaningful native SOL transfers (ignore 0-lamport inner rent/ATA artifacts)
  let bestSolLamports = 0;
  let bestDir = "Sent";
  for (const ix of ixs) {
    if (ix?.parsed?.type === "transfer") {
      const lamports = Number(ix.parsed.info?.lamports || 0);
      if (lamports > bestSolLamports) {
        bestSolLamports = lamports;
        bestDir = ix.parsed.info?.source === devAddress ? "Sent" : "Received";
      }
    }
  }
  if (bestSolLamports > 0) {
    return {
      action: "transfer",
      summary: `${bestDir} ${(bestSolLamports / 1e9).toFixed(4)} SOL`,
    };
  }

  return { action: "other", summary: "Solana program instruction" };
}

async function traceDevWalletHistory(params: {
  devAddress: string | null;
  creatorTokens: Array<{ mint?: string; name?: string | null; symbol?: string | null; createdAt?: string | null }>;
  devMintsCount: number | null;
  devTokenHoldingPct: number;
  mintAddress: string;
}): Promise<DevWalletHistory> {
  if (!params.devAddress) {
    return {
      devAddress: null,
      solBalance: null,
      tokenHoldingPct: params.devTokenHoldingPct,
      coinsLaunchedCount: params.devMintsCount ?? 0,
      flaggedCoinsCount: 0,
      launchedTokens: [],
      recentTxs: [],
    };
  }

  const [balRes, sigRes] = await Promise.all([
    rpcCall<{ value?: number }>("getBalance", [params.devAddress], 3600),
    rpcCall<RpcSigRow[]>(
      "getSignaturesForAddress",
      [params.devAddress, { limit: 60 }],
      4800
    ),
  ]);

  const solBalance =
    typeof balRes?.value === "number"
      ? Number((balRes.value / 1e9).toFixed(4))
      : null;

  const sigRows = Array.isArray(sigRes) ? sigRes : [];
  const sampleSigs = sigRows.slice(0, 50);

  // Fetch parsed transactions in 3 bounded batches of 10 so multi-burn & original deploy are captured without RPC throttling
  const parsedTxs: Array<ParsedRpcTx | null> = [];
  for (let start = 0; start < sampleSigs.length; start += 10) {
    const chunk = sampleSigs.slice(start, start + 10);
    const chunkResults = await Promise.all(
      chunk.map((s) =>
        rpcCall<ParsedRpcTx>(
          "getTransaction",
          [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }],
          3800
        )
      )
    );
    parsedTxs.push(...chunkResults);
  }

  const recentTxs: DevTxEntry[] = sampleSigs.map((s, idx) => {
    const classified = classifyDevTx(parsedTxs[idx], params.devAddress!);
    return {
      signature: s.signature,
      slot: s.slot,
      blockTime: s.blockTime ?? null,
      action: classified.action,
      summary: classified.summary,
      err: Boolean(s.err),
    };
  });

  const launchedTokens: DevLaunchedTokenSummary[] = (params.creatorTokens || [])
    .filter((t) => Boolean(t.mint))
    .slice(0, 12)
    .map((t) => ({
      mint: t.mint!,
      name: t.name ?? null,
      symbol: t.symbol ?? null,
      createdAt: t.createdAt ?? null,
    }));

  if (!launchedTokens.some((t) => t.mint === params.mintAddress)) {
    launchedTokens.unshift({
      mint: params.mintAddress,
      name: null,
      symbol: null,
      createdAt: null,
    });
  }

  return {
    devAddress: params.devAddress,
    solBalance,
    tokenHoldingPct: Number(params.devTokenHoldingPct.toFixed(2)),
    coinsLaunchedCount: Math.max(
      params.devMintsCount ?? 0,
      launchedTokens.length
    ),
    flaggedCoinsCount: 0,
    launchedTokens,
    recentTxs,
  };
}

/**
 * Collects deep Solana token forensics combining Jupiter Tokens v2, RugCheck,
 * GeckoTerminal Pools, Metaplex PDA JSON URI, and direct RPC holder/dev tracing.
 */
export async function collectTokenDeepIntel(
  mintAddress: string,
  mintReport: TokenScanReport | null
): Promise<TokenDeepForensics | null> {
  const [metaPda, jupRes, rcRes, geckoPoolsRes] = await Promise.all([
    fetchMetaplexUriMetadata(mintAddress),
    fetchJsonSafe<
      Array<{
        id?: string;
        name?: string;
        symbol?: string;
        icon?: string;
        twitter?: string;
        website?: string;
        dev?: string;
        launchpad?: string;
        holderCount?: number;
        fdv?: number;
        mcap?: number;
        usdPrice?: number;
        liquidity?: number;
        createdAt?: string;
        stats5m?: { priceChange?: number };
        stats1h?: { priceChange?: number; numBuys?: number; numSells?: number };
        stats6h?: { priceChange?: number };
        stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number };
        audit?: { devMints?: number };
      }>
    >(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mintAddress)}`),
    fetchJsonSafe<{
      creator?: string;
      creatorBalance?: number;
      totalHolders?: number;
      totalMarketLiquidity?: number;
      price?: number;
      graphInsidersDetected?: number;
      creatorTokens?: Array<{ mint?: string; name?: string | null; symbol?: string | null; createdAt?: string | null }>;
      topHolders?: Array<{
        address?: string;
        owner?: string;
        pct?: number;
        uiAmount?: number;
        insider?: boolean;
      }>;
      markets?: Array<{
        pubkey?: string;
        marketType?: string;
        liquidityAAccount?: { owner?: string };
        liquidityBAccount?: { owner?: string };
        lp?: { lpLockedPct?: number; lpLockedUSD?: number };
      }>;
    }>(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mintAddress)}/report`),
    fetchJsonSafe<{
      data?: Array<{
        attributes?: {
          address?: string;
          dex_id?: string;
          pool_created_at?: string;
          token_price_usd?: string;
          fdv_usd?: string;
          reserve_in_usd?: string;
          volume_usd?: { h24?: string };
          price_change_percentage?: { m5?: string; h1?: string; h6?: string; h24?: string };
          transactions?: { h1?: { buys?: number; sells?: number }; h24?: { buys?: number; sells?: number } };
        };
      }>;
    }>(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(mintAddress)}/pools`),
  ]);

  const jup = Array.isArray(jupRes)
    ? jupRes.find((item) => item.id === mintAddress) || jupRes[0] || null
    : null;
  const rc = rcRes || null;
  const geckoPool = geckoPoolsRes?.data?.[0]?.attributes || null;

  const websitesSet = new Set<string>();
  [jup?.website, metaPda.website].forEach((u) => {
    const norm = normalizeWebUrl(u);
    if (norm) websitesSet.add(norm);
  });

  const twitterUrl = normalizeTwitterUrl(jup?.twitter || metaPda.twitter);
  const metadata: TokenDeepMetadata = {
    name: jup?.name || metaPda.name || mintReport?.name || null,
    symbol: jup?.symbol || metaPda.symbol || mintReport?.symbol || null,
    description: metaPda.description || null,
    imageUrl: jup?.icon || metaPda.imageUrl || null,
    websites: Array.from(websitesSet),
    twitterUrl,
    telegramUrl: metaPda.telegram,
    launchpad: jup?.launchpad || rc?.markets?.[0]?.marketType || null,
    createdAt: jup?.createdAt || geckoPool?.pool_created_at || null,
  };

  const primaryMarket = rc?.markets?.[0];
  const lpLockedPct =
    typeof primaryMarket?.lp?.lpLockedPct === "number"
      ? primaryMarket.lp.lpLockedPct
      : null;
  const lpLockedUsd =
    typeof primaryMarket?.lp?.lpLockedUSD === "number"
      ? Math.round(primaryMarket.lp.lpLockedUSD)
      : null;

  const jupVol24 =
    jup?.stats24h &&
    typeof jup.stats24h.buyVolume === "number" &&
    typeof jup.stats24h.sellVolume === "number"
      ? Math.round(jup.stats24h.buyVolume + jup.stats24h.sellVolume)
      : 0;

  const market: TokenDeepMarketStats = {
    poolAddress: geckoPool?.address || primaryMarket?.pubkey || null,
    dexId: geckoPool?.dex_id || primaryMarket?.marketType || jup?.launchpad || null,
    priceUsd:
      typeof jup?.usdPrice === "number"
        ? jup.usdPrice
        : geckoPool?.token_price_usd
          ? Number(geckoPool.token_price_usd)
          : rc?.price ?? null,
    marketCapUsd:
      typeof jup?.mcap === "number"
        ? Math.round(jup.mcap)
        : geckoPool?.fdv_usd
          ? Math.round(Number(geckoPool.fdv_usd))
          : null,
    fdvUsd:
      typeof jup?.fdv === "number"
        ? Math.round(jup.fdv)
        : geckoPool?.fdv_usd
          ? Math.round(Number(geckoPool.fdv_usd))
          : null,
    liquidityUsd: Math.round(
      jup?.liquidity ??
        (geckoPool?.reserve_in_usd ? Number(geckoPool.reserve_in_usd) : 0) ??
        rc?.totalMarketLiquidity ??
        0
    ),
    volume24hUsd:
      jupVol24 ||
      (geckoPool?.volume_usd?.h24 ? Math.round(Number(geckoPool.volume_usd.h24)) : 0),
    priceChange5m: jup?.stats5m?.priceChange ?? (geckoPool?.price_change_percentage?.m5 ? Number(geckoPool.price_change_percentage.m5) : null),
    priceChange1h: jup?.stats1h?.priceChange ?? (geckoPool?.price_change_percentage?.h1 ? Number(geckoPool.price_change_percentage.h1) : null),
    priceChange6h: jup?.stats6h?.priceChange ?? (geckoPool?.price_change_percentage?.h6 ? Number(geckoPool.price_change_percentage.h6) : null),
    priceChange24h: jup?.stats24h?.priceChange ?? (geckoPool?.price_change_percentage?.h24 ? Number(geckoPool.price_change_percentage.h24) : null),
    buys1h: jup?.stats1h?.numBuys ?? geckoPool?.transactions?.h1?.buys ?? null,
    sells1h: jup?.stats1h?.numSells ?? geckoPool?.transactions?.h1?.sells ?? null,
    buys24h: jup?.stats24h?.numBuys ?? geckoPool?.transactions?.h24?.buys ?? null,
    sells24h: jup?.stats24h?.numSells ?? geckoPool?.transactions?.h24?.sells ?? null,
    lpLockedPct,
    lpLockedUsd,
  };

  const devAddress = jup?.dev || rc?.creator || metaPda.updateAuthority || null;

  const poolVaultOwners = new Set<string>();
  for (const m of rc?.markets || []) {
    if (m.liquidityAAccount?.owner) poolVaultOwners.add(m.liquidityAAccount.owner);
    if (m.liquidityBAccount?.owner) poolVaultOwners.add(m.liquidityBAccount.owner);
  }

  const rawHolders: RawHolderRow[] = (rc?.topHolders || [])
    .filter((h) => Boolean(h.owner && typeof h.pct === "number"))
    .map((h) => ({
      address: h.address || h.owner!,
      owner: h.owner!,
      pct: h.pct!,
      uiAmount: h.uiAmount ?? 0,
      insider: Boolean(h.insider),
    }));

  const rawSupplyNum =
    Number(mintReport?.rawSupply || 0) ||
    (mintReport?.supplyUi
      ? mintReport.supplyUi * Math.pow(10, mintReport.decimals ?? 6)
      : 0);
  const devTokenHoldingPct =
    rc?.creatorBalance && rawSupplyNum > 0
      ? Math.min(100, Number(((rc.creatorBalance / rawSupplyNum) * 100).toFixed(2)))
      : rawHolders
          .filter((h) => devAddress && h.owner === devAddress)
          .reduce((acc, h) => acc + h.pct, 0);

  const swapActivityPromise = sampleSolanaPoolSwapActivity({
    poolAddress: market.poolAddress,
    mintAddress,
    poolVaultOwners,
  });

  const [holders, devHistory] = await Promise.all([
    analyzeHoldersAndCabal({
      rawHolders,
      poolVaultOwners,
      devAddress,
      totalHolders: rc?.totalHolders ?? jup?.holderCount ?? null,
      lpLockedPct,
      mintReport,
      insiderNetworksCount: rc?.graphInsidersDetected ?? 0,
      swapActivityByWallet: swapActivityPromise,
    }),
    traceDevWalletHistory({
      devAddress,
      creatorTokens: rc?.creatorTokens || [],
      devMintsCount: jup?.audit?.devMints ?? null,
      devTokenHoldingPct,
      mintAddress,
    }),
  ]);

  return {
    metadata,
    market,
    holders,
    devHistory,
  };
}
