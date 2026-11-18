import { EVM_CHAINS, type EvmChainKey, ZERO_EVM_ADDRESS } from "../evm-security";
import type {
  HolderAuditCheckRow,
  HolderCabalCluster,
  HolderClusterNode,
  HoldersDeepAnalysis,
  WalletToWatchEntry,
  WalletWatchCategory,
} from "./types";

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const EVM_BURN_ADDRESSES = new Set([
  ZERO_EVM_ADDRESS,
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000001",
  "0xdead000000000000000042069420694206942069",
]);

const KNOWN_EVM_INFRA_ADDRESSES = new Set([
  "0x000000000022d473030f116ddee9f6b43ac78ba3", // Permit2
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap Universal Router
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2 Router
  "0x2626664c2603336e57b271c5c0b26f421741e481", // Uniswap V3 SwapRouter02
  "0x111111125421ca6dc452d289314280a0f8842a65", // 1inch v6
  "0x10ed43c718714eb63d5aa57b78b54704e256024e", // PancakeSwap V2
  "0x13f4ea83d0bd40e75c8222255bc855a974568dd4", // PancakeSwap V3
]);

export interface RawEvmTransferLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash?: string;
}

export interface EvmGoPlusHolderInput {
  address: string;
  tag: string | null;
  isContract: boolean;
  balance: string | null;
  pct: number;
  isLocked: boolean;
}

export interface EvmTransferForensicsResult {
  walletsToWatch: WalletToWatchEntry[];
  nodes: HolderClusterNode[];
  clusters: HolderCabalCluster[];
  checks: HolderAuditCheckRow[];
  distribution: HoldersDeepAnalysis["distribution"];
  earlyBuyersCount: number;
  possibleMmCount: number;
  detectedPairAddress: string | null;
  launchBlock: number | null;
  totalLogsAnalyzed: number;
  topHoldersPct: number;
  notes: string[];
}

export function getWalletExplorerUrl(
  address: string,
  chain: string = "solana"
): string {
  const lowerChain = chain.toLowerCase();
  if (lowerChain === "solana" || !address.startsWith("0x")) {
    return `https://solscan.io/account/${address}`;
  }
  const cfg = EVM_CHAINS[lowerChain as EvmChainKey];
  const base = cfg?.explorerUrl || "https://etherscan.io";
  return `${base}/address/${address}`;
}

function topicToEvmAddress(topic: string | undefined): string | null {
  if (!topic || typeof topic !== "string") return null;
  const clean = topic.toLowerCase();
  if (!clean.startsWith("0x") || clean.length < 42) return null;
  return `0x${clean.slice(-40)}`;
}

function parseHexBigInt(raw: string | undefined): bigint {
  if (!raw || typeof raw !== "string") return BigInt(0);
  try {
    const clean = raw.startsWith("0x") ? raw : `0x${raw}`;
    return clean === "0x" ? BigInt(0) : BigInt(clean);
  } catch {
    return BigInt(0);
  }
}

function parseHexBlockNumber(raw: string | undefined): number {
  if (!raw || typeof raw !== "string") return 0;
  const parsed = Number.parseInt(raw, 16);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeBigIntRatioPct(part: bigint, total: bigint): number {
  if (total <= BigInt(0) || part <= BigInt(0)) return 0;
  // Multiply before integer division to keep 2 decimal places safely without floating overflow
  const scaledBps = Number((part * BigInt(10000)) / total);
  return Number(Math.min(100, Math.max(0, scaledBps / 100)).toFixed(2));
}

function categorySortWeight(cat: WalletWatchCategory): number {
  switch (cat) {
    case "cabal_linked":
      return 0;
    case "possible_mm":
      return 1;
    case "early_buyer":
      return 2;
    case "dev_linked":
      return 3;
    case "top_holder":
    default:
      return 4;
  }
}

function isL2ChainKey(chainKey: EvmChainKey): boolean {
  return (
    chainKey === "robinhood" ||
    chainKey === "base" ||
    chainKey === "arbitrum" ||
    chainKey === "optimism"
  );
}

/**
 * Deterministically analyzes raw ERC-20 `Transfer` logs plus optional GoPlus
 * holder snapshots and live `balanceOf` readings to surface:
 * - Possible Market Maker (two-way high-churn) wallets
 * - Possible Early Buyer wallets (entry block offset + hold vs exit ratio)
 * - Co-timed block bundle clusters & Top Holders
 */
export function analyzeEvmTransferLogsForWalletsToWatch(params: {
  chainKey: EvmChainKey;
  tokenAddress: string;
  logs: RawEvmTransferLog[];
  totalSupplyRaw?: bigint;
  pairAddress?: string | null;
  creatorAddress?: string | null;
  ownerAddress?: string | null;
  goPlusHolders?: EvmGoPlusHolderInput[];
  liveBalancesByAddress?: Record<string, bigint>;
  contractAddresses?: Record<string, boolean>;
}): EvmTransferForensicsResult {
  const explorerBase = EVM_CHAINS[params.chainKey]?.explorerUrl || "https://etherscan.io";
  const tokenLower = params.tokenAddress.toLowerCase();
  const explicitPairLower = params.pairAddress?.toLowerCase() || null;
  const creatorLower = params.creatorAddress?.toLowerCase() || null;
  const ownerLower = params.ownerAddress?.toLowerCase() || null;

  interface AddressStats {
    address: string;
    inFromPool: bigint;
    outToPool: bigint;
    totalIn: bigint;
    totalOut: bigint;
    netDelta: bigint;
    inCount: number;
    outCount: number;
    firstBlock: number;
    firstBuyBlock: number | null;
    lastBlock: number;
    seenWithAddresses: Set<string>;
    isContractHint: boolean;
    goPlusTag: string | null;
    goPlusPct: number | null;
    isLocked: boolean;
  }

  const statsMap = new Map<string, AddressStats>();
  const ensure = (addr: string): AddressStats => {
    const existing = statsMap.get(addr);
    if (existing) return existing;
    const created: AddressStats = {
      address: addr,
      inFromPool: BigInt(0),
      outToPool: BigInt(0),
      totalIn: BigInt(0),
      totalOut: BigInt(0),
      netDelta: BigInt(0),
      inCount: 0,
      outCount: 0,
      firstBlock: Number.MAX_SAFE_INTEGER,
      firstBuyBlock: null,
      lastBlock: 0,
      seenWithAddresses: new Set(),
      isContractHint: KNOWN_EVM_INFRA_ADDRESSES.has(addr) || addr === tokenLower,
      goPlusTag: null,
      goPlusPct: null,
      isLocked: false,
    };
    statsMap.set(addr, created);
    return created;
  };

  let launchMintBlock: number | null = null;
  let earliestNonZeroBlock: number | null = null;
  let mintedSupplyObserved = BigInt(0);

  const sortedLogs = [...params.logs].sort(
    (a, b) => parseHexBlockNumber(a.blockNumber) - parseHexBlockNumber(b.blockNumber)
  );

  for (const log of sortedLogs) {
    if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
    const from = topicToEvmAddress(log.topics[1]);
    const to = topicToEvmAddress(log.topics[2]);
    if (!from || !to) continue;
    const value = parseHexBigInt(log.data);
    if (value <= BigInt(0)) continue;

    const blockNum = parseHexBlockNumber(log.blockNumber);
    if (blockNum > 0 && (earliestNonZeroBlock === null || blockNum < earliestNonZeroBlock)) {
      earliestNonZeroBlock = blockNum;
    }

    if (from === ZERO_EVM_ADDRESS) {
      mintedSupplyObserved += value;
      if (blockNum > 0 && launchMintBlock === null) {
        launchMintBlock = blockNum;
      }
    }

    const fromStats = ensure(from);
    const toStats = ensure(to);

    if (!EVM_BURN_ADDRESSES.has(from)) {
      fromStats.outCount += 1;
      fromStats.totalOut += value;
      fromStats.netDelta -= value;
      if (blockNum > 0) {
        fromStats.firstBlock = Math.min(fromStats.firstBlock, blockNum);
        fromStats.lastBlock = Math.max(fromStats.lastBlock, blockNum);
      }
      fromStats.seenWithAddresses.add(to);
    }

    if (!EVM_BURN_ADDRESSES.has(to)) {
      toStats.inCount += 1;
      toStats.totalIn += value;
      toStats.netDelta += value;
      if (blockNum > 0) {
        toStats.firstBlock = Math.min(toStats.firstBlock, blockNum);
        toStats.lastBlock = Math.max(toStats.lastBlock, blockNum);
        if (from !== ZERO_EVM_ADDRESS && toStats.firstBuyBlock === null) {
          toStats.firstBuyBlock = blockNum;
        }
      }
      toStats.seenWithAddresses.add(from);
    }
  }

  for (const gp of params.goPlusHolders || []) {
    const addr = gp.address.toLowerCase();
    const s = ensure(addr);
    s.isContractHint = s.isContractHint || gp.isContract;
    s.goPlusTag = gp.tag || s.goPlusTag;
    s.goPlusPct = gp.pct;
    s.isLocked = gp.isLocked;
  }

  for (const [addrRaw, isContract] of Object.entries(params.contractAddresses || {})) {
    if (!isContract) continue;
    const s = statsMap.get(addrRaw.toLowerCase());
    if (s) s.isContractHint = true;
  }

  // Infer the dominant AMM pair/pool address if DEX aggregator did not supply it
  let detectedPairLower = explicitPairLower;
  if (!detectedPairLower) {
    let bestScore = 0;
    let bestCandidate: string | null = null;
    for (const s of statsMap.values()) {
      if (
        EVM_BURN_ADDRESSES.has(s.address) ||
        KNOWN_EVM_INFRA_ADDRESSES.has(s.address) ||
        s.address === tokenLower ||
        s.address === creatorLower
      ) {
        continue;
      }
      // Liquidity pool pair interacts with many unique counterparties both ways (mint/add/buy/sell)
      const counterpartyBreadth = s.seenWithAddresses.size;
      if (counterpartyBreadth >= 5 && s.inCount >= 3 && s.outCount >= 3) {
        const candidateScore = counterpartyBreadth * 3 + Math.min(s.inCount, s.outCount);
        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestCandidate = s.address;
        }
      }
    }
    detectedPairLower = bestCandidate;
  }

  // Second pass with known pool address to split pool buys vs pool sells precisely
  for (const log of sortedLogs) {
    if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
    const from = topicToEvmAddress(log.topics[1]);
    const to = topicToEvmAddress(log.topics[2]);
    if (!from || !to) continue;
    const value = parseHexBigInt(log.data);
    if (value <= BigInt(0)) continue;
    if (detectedPairLower) {
      if (from === detectedPairLower && !EVM_BURN_ADDRESSES.has(to)) {
        const st = statsMap.get(to);
        if (st) st.inFromPool += value;
      }
      if (to === detectedPairLower && !EVM_BURN_ADDRESSES.has(from)) {
        const st = statsMap.get(from);
        if (st) st.outToPool += value;
      }
    }
  }

  // Determine effective supply denominator
  let effectiveSupply = params.totalSupplyRaw && params.totalSupplyRaw > BigInt(0)
    ? params.totalSupplyRaw
    : mintedSupplyObserved;
  if (effectiveSupply <= BigInt(0)) {
    let positiveSum = BigInt(0);
    for (const s of statsMap.values()) {
      const live = params.liveBalancesByAddress?.[s.address];
      const bal = live !== undefined ? live : s.netDelta;
      if (bal > BigInt(0)) positiveSum += bal;
    }
    effectiveSupply = positiveSum;
  }

  const getCurrentHoldingPct = (s: AddressStats): number => {
    const live = params.liveBalancesByAddress?.[s.address];
    if (live !== undefined && effectiveSupply > BigInt(0)) {
      return safeBigIntRatioPct(live, effectiveSupply);
    }
    if (typeof s.goPlusPct === "number" && Number.isFinite(s.goPlusPct)) {
      return Number(s.goPlusPct.toFixed(2));
    }
    if (launchMintBlock !== null && effectiveSupply > BigInt(0) && s.netDelta > BigInt(0)) {
      return safeBigIntRatioPct(s.netDelta, effectiveSupply);
    }
    return 0;
  };

  // Detect same-block bundle groups among initial buyers
  const launchAnchorBlock = launchMintBlock ?? earliestNonZeroBlock;
  const earlyWindowBlocks = isL2ChainKey(params.chainKey) ? 160 : 30;
  const buyersByBlock = new Map<number, AddressStats[]>();

  for (const s of statsMap.values()) {
    if (
      EVM_BURN_ADDRESSES.has(s.address) ||
      KNOWN_EVM_INFRA_ADDRESSES.has(s.address) ||
      s.address === detectedPairLower ||
      s.address === tokenLower ||
      s.address === creatorLower ||
      s.isContractHint
    ) {
      continue;
    }
    if (s.firstBuyBlock !== null && launchAnchorBlock !== null) {
      const offset = s.firstBuyBlock - launchAnchorBlock;
      if (offset >= 0 && offset <= earlyWindowBlocks) {
        const group = buyersByBlock.get(s.firstBuyBlock) || [];
        group.push(s);
        buyersByBlock.set(s.firstBuyBlock, group);
      }
    }
  }

  const clusterAddresses = new Set<string>();
  const clusters: HolderCabalCluster[] = [];
  const minBundleWallets = isL2ChainKey(params.chainKey) ? 3 : 2;
  for (const [blk, group] of buyersByBlock.entries()) {
    if (group.length >= minBundleWallets) {
      const combinedPct = Number(
        group.reduce((acc, s) => acc + getCurrentHoldingPct(s), 0).toFixed(2)
      );
      group.forEach((s) => clusterAddresses.add(s.address));
      clusters.push({
        clusterId: `blk_${blk}`,
        kind: "same_slot",
        label: `Same-block bundle (${group.length} buyers @ blk #${blk})`,
        funder: null,
        slot: blk,
        combinedPct,
        wallets: group.slice(0, 6).map((s) => ({
          address: s.address,
          tokenAccount: s.address,
          pct: getCurrentHoldingPct(s),
          uiAmount: 0,
          role: "sniper",
          funder: null,
          firstSlot: blk,
          isFresh: false,
          txCount: s.inCount + s.outCount,
        })),
      });
    }
  }

  // Classify each candidate address into Wallets to Watch
  const watchMap = new Map<string, WalletToWatchEntry>();
  let earlyBuyersCount = 0;
  let possibleMmCount = 0;

  for (const s of statsMap.values()) {
    if (
      EVM_BURN_ADDRESSES.has(s.address) ||
      KNOWN_EVM_INFRA_ADDRESSES.has(s.address) ||
      s.address === tokenLower ||
      s.address === detectedPairLower ||
      s.isLocked
    ) {
      continue;
    }

    const holdingPct = getCurrentHoldingPct(s);
    const acquiredPct =
      effectiveSupply > BigInt(0) && s.totalIn > BigInt(0)
        ? safeBigIntRatioPct(s.totalIn, effectiveSupply)
        : null;
    const soldPct =
      effectiveSupply > BigInt(0) && s.totalOut > BigInt(0)
        ? safeBigIntRatioPct(s.totalOut, effectiveSupply)
        : null;
    const entryOffset =
      launchAnchorBlock !== null && s.firstBuyBlock !== null
        ? Math.max(0, s.firstBuyBlock - launchAnchorBlock)
        : null;

    const isDevOrCreator =
      s.address === creatorLower ||
      s.address === ownerLower ||
      (launchMintBlock !== null && s.firstBlock === launchMintBlock && s.totalOut > s.totalIn * BigInt(2));

    // Heuristic 1: Possible MM / Two-Way Liquidity Trader
    // Require >= 3 buys AND >= 3 sells with symmetrical turnover on non-contract EOAs
    const minCount = Math.min(s.inCount, s.outCount);
    const maxCount = Math.max(s.inCount, s.outCount);
    const countSymmetry = maxCount > 0 ? minCount / maxCount : 0;
    const twoWayBalanced =
      s.totalIn > BigInt(0) &&
      s.totalOut > BigInt(0) &&
      s.totalOut * BigInt(100) >= s.totalIn * BigInt(35) &&
      s.totalOut * BigInt(100) <= s.totalIn * BigInt(220);

    const isPossibleMm =
      !isDevOrCreator &&
      !s.isContractHint &&
      s.inCount >= 3 &&
      s.outCount >= 3 &&
      (countSymmetry >= 0.4 || twoWayBalanced);

    // Heuristic 2: Possible Early Buyer
    const isEarlyBuyer =
      !isDevOrCreator &&
      !s.isContractHint &&
      s.firstBuyBlock !== null &&
      entryOffset !== null &&
      entryOffset <= earlyWindowBlocks &&
      (acquiredPct === null || acquiredPct >= 0.05 || holdingPct >= 0.05);

    const isCabalBundled = clusterAddresses.has(s.address);

    if (!isDevOrCreator && !isPossibleMm && !isEarlyBuyer && !isCabalBundled && holdingPct < 0.4) {
      continue;
    }

    const tags: string[] = [];
    let category: WalletWatchCategory = "top_holder";
    let confidence: WalletToWatchEntry["confidence"] = "MEDIUM";
    let reason = `Holds ${holdingPct.toFixed(2)}% supply`;

    if (isCabalBundled) {
      category = "cabal_linked";
      confidence = "HIGH";
      tags.push(`Block Bundle #${s.firstBuyBlock}`);
      reason = `Entered block #${s.firstBuyBlock} alongside other buyers (${s.inCount} buys / ${s.outCount} sells)`;
    }

    if (isPossibleMm) {
      possibleMmCount += 1;
      tags.push(`Possible MM (${s.inCount}B/${s.outCount}S)`);
      if (category === "top_holder") {
        category = "possible_mm";
        confidence = s.inCount >= 4 && s.outCount >= 4 ? "MEDIUM" : "HEURISTIC";
        reason = `Two-way swap cycling: ${s.inCount} buys / ${s.outCount} sells${
          acquiredPct !== null && soldPct !== null
            ? ` (in ${acquiredPct}% · out ${soldPct}%)`
            : ""
        }`;
      }
    }

    if (isEarlyBuyer) {
      earlyBuyersCount += 1;
      const offsetLabel = entryOffset === 0 ? "Genesis blk" : `+${entryOffset} blk`;
      tags.push(`Early Buyer (${offsetLabel})`);
      if (holdingPct >= 0.1 && soldPct !== null && soldPct <= (acquiredPct ?? 0) * 0.25) {
        tags.push("Holding");
      } else if (holdingPct < 0.05 && soldPct !== null && soldPct > 0.1) {
        tags.push("Exited");
      }
      if (category === "top_holder") {
        category = "early_buyer";
        confidence = launchMintBlock !== null ? "HIGH" : "HEURISTIC";
        reason =
          holdingPct >= 0.05
            ? `Entered ${offsetLabel} after launch · holds ${holdingPct.toFixed(2)}%${
                acquiredPct !== null ? ` (acquired ${acquiredPct}%)` : ""
              }`
            : `Entered ${offsetLabel} after launch and exited most holdings (sold ${soldPct ?? 0}%)`;
      }
    }

    if (isDevOrCreator) {
      category = "dev_linked";
      confidence = "HIGH";
      tags.push("Creator / Deployer");
      reason = `Contract creator / initial supply distributor · currently holds ${holdingPct.toFixed(2)}%`;
    }

    if (s.goPlusTag) {
      tags.push(s.goPlusTag);
    }

    if (category === "top_holder") {
      tags.push(`Top Holder (${holdingPct.toFixed(2)}%)`);
      if (s.isContractHint) tags.push("Contract");
    }

    watchMap.set(s.address, {
      address: s.address,
      chainFamily: "evm",
      chainKey: params.chainKey,
      category,
      tags,
      holdingPct,
      acquiredPct,
      soldPct,
      buyCount: s.inCount,
      sellCount: s.outCount,
      firstSeenSlotOrBlock: s.firstBuyBlock ?? (s.firstBlock < Number.MAX_SAFE_INTEGER ? s.firstBlock : null),
      entryOffset,
      txCount: s.inCount + s.outCount,
      isFresh: false,
      funder: null,
      confidence,
      reason,
      explorerUrl: `${explorerBase}/address/${s.address}`,
    });
  }

  const walletsToWatch = Array.from(watchMap.values())
    .sort((a, b) => {
      const catDiff = categorySortWeight(a.category) - categorySortWeight(b.category);
      if (catDiff !== 0) return catDiff;
      if (b.holdingPct !== a.holdingPct) return b.holdingPct - a.holdingPct;
      return (b.txCount || 0) - (a.txCount || 0);
    })
    .slice(0, 20);

  // Build graph nodes for SniperCabalGraph on EVM
  const nonPoolSorted = Array.from(statsMap.values())
    .filter(
      (s) =>
        !EVM_BURN_ADDRESSES.has(s.address) &&
        !KNOWN_EVM_INFRA_ADDRESSES.has(s.address) &&
        s.address !== tokenLower &&
        s.address !== detectedPairLower
    )
    .map((s) => ({
      stats: s,
      pct: getCurrentHoldingPct(s),
    }))
    .filter((item) => item.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  const burnPct = Number(
    Array.from(statsMap.values())
      .filter((s) => EVM_BURN_ADDRESSES.has(s.address))
      .reduce((acc, s) => acc + getCurrentHoldingPct(s), 0)
      .toFixed(1)
  );
  const topHoldersPct = Number(
    nonPoolSorted
      .slice(0, 10)
      .reduce((acc, item) => acc + item.pct, 0)
      .toFixed(1)
  );

  const nodes: HolderClusterNode[] = [];
  if (detectedPairLower) {
    const lpStats = statsMap.get(detectedPairLower);
    if (lpStats) {
      nodes.push({
        address: lpStats.address,
        tokenAccount: lpStats.address,
        pct: getCurrentHoldingPct(lpStats),
        uiAmount: 0,
        role: "pool",
        funder: null,
        firstSlot: lpStats.firstBlock < Number.MAX_SAFE_INTEGER ? lpStats.firstBlock : null,
        isFresh: false,
        txCount: lpStats.inCount + lpStats.outCount,
      });
    }
  }

  for (const item of nonPoolSorted.slice(0, 12)) {
    const watchItem = watchMap.get(item.stats.address);
    const role: HolderClusterNode["role"] =
      watchItem?.category === "dev_linked"
        ? "dev"
        : watchItem?.category === "cabal_linked"
          ? "cabal"
          : watchItem?.category === "early_buyer"
            ? "sniper"
            : "retail";
    nodes.push({
      address: item.stats.address,
      tokenAccount: item.stats.address,
      pct: item.pct,
      uiAmount: 0,
      role,
      funder: null,
      firstSlot:
        item.stats.firstBuyBlock ??
        (item.stats.firstBlock < Number.MAX_SAFE_INTEGER ? item.stats.firstBlock : null),
      isFresh: false,
      txCount: item.stats.inCount + item.stats.outCount,
    });
  }

  const insidersPct = Number(
    nonPoolSorted
      .filter((i) => clusterAddresses.has(i.stats.address))
      .reduce((acc, i) => acc + i.pct, 0)
      .toFixed(1)
  );
  const snipersPct = Number(
    walletsToWatch
      .filter((w) => w.category === "early_buyer")
      .reduce((acc, w) => acc + w.holdingPct, 0)
      .toFixed(1)
  );
  const devPct = Number(
    walletsToWatch
      .filter((w) => w.category === "dev_linked")
      .reduce((acc, w) => acc + w.holdingPct, 0)
      .toFixed(1)
  );
  const retailPct = Number(
    Math.max(0, 100 - insidersPct - snipersPct - burnPct - devPct).toFixed(1)
  );

  const checks: HolderAuditCheckRow[] = [];
  if (earlyBuyersCount > 0) {
    checks.push({
      label: "Early buyer wallets traced",
      value: `${earlyBuyersCount} (${snipersPct}% still held)`,
      status: snipersPct >= 15 ? "flag" : "watch",
    });
  } else {
    checks.push({
      label: "Early buyer concentration",
      value: sortedLogs.length > 0 ? "Low / Exited" : "No logs sampled",
      status: "clear",
    });
  }

  if (possibleMmCount > 0) {
    checks.push({
      label: "Possible MM / two-way traders",
      value: `${possibleMmCount} wallet(s)`,
      status: "watch",
    });
  } else {
    checks.push({
      label: "Two-way MM churn wallets",
      value: "None detected in sample",
      status: "clear",
    });
  }

  if (topHoldersPct >= 35) {
    checks.push({
      label: "Top 10 non-pool concentration",
      value: `${topHoldersPct}%`,
      status: "flag",
    });
  } else if (topHoldersPct > 0) {
    checks.push({
      label: "Top 10 non-pool concentration",
      value: `${topHoldersPct}%`,
      status: topHoldersPct >= 25 ? "watch" : "clear",
    });
  }

  const notes: string[] = [];
  if (sortedLogs.length > 0) {
    notes.push(
      `Reconstructed ${sortedLogs.length} ERC-20 Transfer events${
        launchMintBlock ? ` starting from genesis mint block #${launchMintBlock}` : ""
      }.`
    );
  }
  if (possibleMmCount > 0) {
    notes.push(
      `Identified ${possibleMmCount} probable two-way MM / liquidity router wallet(s) with repeated buy+sell cycling.`
    );
  }
  if (earlyBuyersCount > 0) {
    notes.push(
      `Flagged ${earlyBuyersCount} early buyer wallet(s) entering within +${earlyWindowBlocks} blocks (${snipersPct}% supply currently held).`
    );
  }

  return {
    walletsToWatch,
    nodes,
    clusters,
    checks,
    distribution: {
      insidersPct,
      snipersPct,
      burnedOrLockedPct: burnPct,
      devPct,
      retailPct,
    },
    earlyBuyersCount,
    possibleMmCount,
    detectedPairAddress: detectedPairLower,
    launchBlock: launchAnchorBlock,
    totalLogsAnalyzed: sortedLogs.length,
    topHoldersPct,
    notes,
  };
}

async function evmRpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = 4500
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
    return { error: err instanceof Error ? err.message : "RPC failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchErc20TotalSupply(
  rpcUrl: string,
  tokenAddress: string
): Promise<bigint | undefined> {
  const res = await evmRpcCall<string>(
    rpcUrl,
    "eth_call",
    [{ to: tokenAddress, data: "0x18160ddd" }, "latest"],
    3000
  );
  if (res.result && res.result.startsWith("0x") && res.result.length > 2) {
    const val = parseHexBigInt(res.result);
    return val > BigInt(0) ? val : undefined;
  }
  return undefined;
}

async function fetchErc20BalanceOfBatch(
  rpcUrl: string,
  tokenAddress: string,
  holders: string[]
): Promise<{
  balances: Record<string, bigint>;
  contractAddresses: Record<string, boolean>;
}> {
  const balances: Record<string, bigint> = {};
  const contractAddresses: Record<string, boolean> = {};
  const subset = holders.slice(0, 14);
  await Promise.all(
    subset.map(async (addr) => {
      const lower = addr.toLowerCase();
      const clean = lower.replace(/^0x/, "").padStart(64, "0");
      const [balRes, codeRes] = await Promise.all([
        evmRpcCall<string>(
          rpcUrl,
          "eth_call",
          [{ to: tokenAddress, data: `0x70a08231${clean}` }, "latest"],
          3000
        ),
        evmRpcCall<string>(rpcUrl, "eth_getCode", [lower, "latest"], 3000),
      ]);
      if (balRes.result && balRes.result.startsWith("0x") && balRes.result.length > 2) {
        balances[lower] = parseHexBigInt(balRes.result);
      }
      if (codeRes.result && codeRes.result !== "0x" && codeRes.result.length > 4) {
        contractAddresses[lower] = true;
      }
    })
  );
  return { balances, contractAddresses };
}

/**
 * Queries live EVM RPC (`eth_getLogs` + `balanceOf`) across supported chains
 * and runs ERC-20 transfer/holder/MM/early-buyer forensics.
 */
export async function collectEvmWalletsToWatch(params: {
  chainKey: EvmChainKey;
  tokenAddress: string;
  totalSupplyRaw?: bigint;
  pairAddress?: string | null;
  creatorAddress?: string | null;
  ownerAddress?: string | null;
  goPlusHolders?: EvmGoPlusHolderInput[];
}): Promise<EvmTransferForensicsResult | null> {
  const chainCfg = EVM_CHAINS[params.chainKey];
  if (!chainCfg || chainCfg.rpcUrls.length === 0) return null;

  const lookbackSteps = isL2ChainKey(params.chainKey)
    ? [300_000, 75_000, 15_000]
    : [50_000, 10_000, 2_500];

  let activeRpcUrl = chainCfg.rpcUrls[0];
  let logs: RawEvmTransferLog[] = [];

  for (const rpcUrl of chainCfg.rpcUrls) {
    const blkRes = await evmRpcCall<string>(rpcUrl, "eth_blockNumber", [], 3500);
    if (!blkRes.result) continue;
    const latestBlock = parseHexBlockNumber(blkRes.result);
    if (latestBlock <= 0) continue;

    activeRpcUrl = rpcUrl;
    for (const span of lookbackSteps) {
      const fromBlock = `0x${Math.max(0, latestBlock - span).toString(16)}`;
      const logRes = await evmRpcCall<RawEvmTransferLog[]>(
        rpcUrl,
        "eth_getLogs",
        [
          {
            address: params.tokenAddress,
            topics: [ERC20_TRANSFER_TOPIC],
            fromBlock,
            toBlock: blkRes.result,
          },
        ],
        5200
      );
      if (Array.isArray(logRes.result)) {
        logs = logRes.result;
        break;
      }
    }
    if (logs.length > 0) break;
  }

  const detectedTotalSupply =
    params.totalSupplyRaw && params.totalSupplyRaw > BigInt(0)
      ? params.totalSupplyRaw
      : await fetchErc20TotalSupply(activeRpcUrl, params.tokenAddress);

  // First pass without live balanceOf so we find candidate addresses quickly
  const initialPass = analyzeEvmTransferLogsForWalletsToWatch({
    ...params,
    totalSupplyRaw: detectedTotalSupply,
    logs,
  });

  // Query live balanceOf & eth_getCode for top candidate wallets (filters smart contract routers cleanly)
  const balanceQueryAddrs = Array.from(
    new Set([
      ...initialPass.walletsToWatch.map((w) => w.address),
      ...(params.goPlusHolders || []).slice(0, 6).map((h) => h.address.toLowerCase()),
    ])
  ).slice(0, 14);

  const probe =
    balanceQueryAddrs.length > 0
      ? await fetchErc20BalanceOfBatch(activeRpcUrl, params.tokenAddress, balanceQueryAddrs)
      : { balances: {}, contractAddresses: {} };

  return analyzeEvmTransferLogsForWalletsToWatch({
    ...params,
    totalSupplyRaw: detectedTotalSupply,
    logs,
    liveBalancesByAddress: probe.balances,
    contractAddresses: probe.contractAddresses,
  });
}

export interface SolanaWalletSwapActivityInput {
  address: string;
  buyCount: number;
  sellCount: number;
  earliestSlot?: number | null;
}

/**
 * Deterministically builds the Solana "Wallets to Watch" list from analyzed
 * top holder cluster nodes, optional recent pool two-way swapper telemetry,
 * and creator address.
 */
export function buildSolanaWalletsToWatch(params: {
  tracedNodes: HolderClusterNode[];
  devAddress?: string | null;
  swapActivityByWallet?: Record<string, SolanaWalletSwapActivityInput>;
}): {
  walletsToWatch: WalletToWatchEntry[];
  earlyBuyersCount: number;
  possibleMmCount: number;
} {
  const nonPool = params.tracedNodes.filter(
    (n) => n.role !== "pool" && n.role !== "burn"
  );

  // Earliest observed slot across traced holders helps spot early launch buyers
  const slotCandidates = nonPool
    .map((n) => n.firstSlot)
    .filter((s): s is number => typeof s === "number" && s > 0)
    .sort((a, b) => a - b);
  const earliestSlot = slotCandidates[0] ?? null;

  const watchMap = new Map<string, WalletToWatchEntry>();

  for (const node of nonPool) {
    const swapStats = params.swapActivityByWallet?.[node.address];
    const buys = swapStats?.buyCount ?? 0;
    const sells = swapStats?.sellCount ?? 0;
    const slotOffset =
      earliestSlot !== null && node.firstSlot !== null
        ? Math.max(0, node.firstSlot - earliestSlot)
        : null;

    const isTwoWayMm =
      (buys >= 2 && sells >= 2) ||
      (buys >= 1 && sells >= 1 && node.txCount >= 55 && node.role !== "dev");

    const isEarlySlot =
      node.role === "sniper" ||
      (node.role !== "dev" && node.isFresh && slotOffset !== null && slotOffset <= 25);

    const tags: string[] = [];
    let category: WalletWatchCategory = "top_holder";
    let confidence: WalletToWatchEntry["confidence"] = "MEDIUM";
    let reason = `Holds ${node.pct.toFixed(2)}% supply`;

    if (node.role === "cabal") {
      category = "cabal_linked";
      confidence = "HIGH";
      tags.push(node.funder ? `Co-Funded (${node.funder.slice(0, 6)}...)` : "Clustered Insider");
      reason = node.funder
        ? `Shares upstream SOL funder ${node.funder.slice(0, 8)}... · holds ${node.pct.toFixed(2)}%`
        : `Flagged in linked insider cluster · holds ${node.pct.toFixed(2)}%`;
    } else if (node.role === "dev" || (params.devAddress && node.address === params.devAddress)) {
      category = "dev_linked";
      confidence = "HIGH";
      tags.push("Creator / Dev");
      reason = `Mint creator / authority holding ${node.pct.toFixed(2)}% supply`;
    }

    if (isTwoWayMm) {
      tags.push(`Possible MM (${buys}B/${sells}S)`);
      if (category === "top_holder") {
        category = "possible_mm";
        confidence = buys >= 2 && sells >= 2 ? "MEDIUM" : "HEURISTIC";
        reason = `Active two-way swaps detected (${buys} buys / ${sells} sells on recent pool flow) · holds ${node.pct.toFixed(2)}%`;
      }
    }

    if (isEarlySlot) {
      const slotLabel =
        slotOffset !== null && slotOffset <= 25
          ? `Slot +${slotOffset}`
          : node.firstSlot
            ? `Slot #${node.firstSlot}`
            : "Early Window";
      tags.push(`Early Buyer (${slotLabel})`);
      if (category === "top_holder") {
        category = "early_buyer";
        confidence = node.role === "sniper" ? "HIGH" : "MEDIUM";
        reason = `Early fresh buyer (${slotLabel}, ${node.txCount} txs) still holding ${node.pct.toFixed(2)}%`;
      }
    }

    if (node.isFresh && !tags.some((t) => t.includes("Fresh"))) {
      tags.push(`Fresh (${node.txCount} txs)`);
    }

    if (category === "top_holder") {
      tags.push(`Top Holder (${node.pct.toFixed(2)}%)`);
    }

    watchMap.set(node.address, {
      address: node.address,
      chainFamily: "solana",
      chainKey: "solana",
      category,
      tags,
      holdingPct: Number(node.pct.toFixed(2)),
      acquiredPct: null,
      soldPct: null,
      buyCount: buys > 0 ? buys : undefined,
      sellCount: sells > 0 ? sells : undefined,
      firstSeenSlotOrBlock: node.firstSlot,
      entryOffset: slotOffset,
      txCount: node.txCount,
      isFresh: node.isFresh,
      funder: node.funder,
      confidence,
      reason,
      explorerUrl: getWalletExplorerUrl(node.address, "solana"),
    });
  }

  // Also include active non-top-10 pool two-way swappers (Possible MM / Active Bot Traders)
  for (const swap of Object.values(params.swapActivityByWallet || {})) {
    if (watchMap.has(swap.address)) continue;
    const isMm = swap.buyCount >= 2 && swap.sellCount >= 2;
    if (!isMm) continue;
    watchMap.set(swap.address, {
      address: swap.address,
      chainFamily: "solana",
      chainKey: "solana",
      category: "possible_mm",
      tags: [`Possible MM (${swap.buyCount}B/${swap.sellCount}S)`, "Pool Churn"],
      holdingPct: 0,
      acquiredPct: null,
      soldPct: null,
      buyCount: swap.buyCount,
      sellCount: swap.sellCount,
      firstSeenSlotOrBlock: swap.earliestSlot ?? null,
      entryOffset: null,
      txCount: swap.buyCount + swap.sellCount,
      isFresh: false,
      funder: null,
      confidence: swap.buyCount >= 3 && swap.sellCount >= 3 ? "MEDIUM" : "HEURISTIC",
      reason: `Repeated two-way pool swaps detected (${swap.buyCount} buys / ${swap.sellCount} sells in recent window)`,
      explorerUrl: getWalletExplorerUrl(swap.address, "solana"),
    });
  }

  const walletsToWatch = Array.from(watchMap.values())
    .sort((a, b) => {
      const catDiff = categorySortWeight(a.category) - categorySortWeight(b.category);
      if (catDiff !== 0) return catDiff;
      return b.holdingPct - a.holdingPct;
    })
    .slice(0, 20);

  return {
    walletsToWatch,
    earlyBuyersCount: walletsToWatch.filter((w) => w.category === "early_buyer").length,
    possibleMmCount: walletsToWatch.filter((w) => w.category === "possible_mm").length,
  };
}
