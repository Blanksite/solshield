/**
 * Shared Multi-Chain EVM Security Engine
 *
 * Provides deterministic RPC + bytecode forensics (EIP-1967/1167 proxy slots,
 * opcode-safe PUSH4 dangerous admin selector detection, owner() check),
 * Sourcify v2 open-source verification, and GoPlus / Honeypot.is buy/sell tax
 * and honeypot simulation across Ethereum, Base, Arbitrum, Optimism, Polygon,
 * BSC, and Robinhood Chain L2 (Chain ID 4663).
 */

export type EvmChainKey =
  | "robinhood"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "bsc";

export interface EvmChainConfig {
  key: EvmChainKey;
  chainId: number;
  chainIdHex: string;
  name: string;
  shortName: string;
  nativeSymbol: string;
  rpcUrls: string[];
  explorerUrl: string;
  geckoNetwork: string;
  permit2Address: string;
  goPlusSupported: boolean;
  honeypotSupported: boolean;
  popularSpenders: Array<{ address: string; label: string; trusted: boolean }>;
  canonicalTokens: Array<{ address: string; symbol: string; name: string }>;
}

export const PERMIT2_SINGLETON =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const EVM_CHAINS: Record<EvmChainKey, EvmChainConfig> = {
  robinhood: {
    key: "robinhood",
    chainId: 4663,
    chainIdHex: "0x1237",
    name: "Robinhood Chain L2",
    shortName: "Robinhood L2",
    nativeSymbol: "ETH",
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    explorerUrl: "https://robinhoodchain.blockscout.com",
    geckoNetwork: "robinhood",
    permit2Address: PERMIT2_SINGLETON,
    goPlusSupported: false,
    honeypotSupported: false,
    popularSpenders: [
      {
        address: PERMIT2_SINGLETON,
        label: "Uniswap Permit2 Singleton",
        trusted: true,
      },
    ],
    canonicalTokens: [
      {
        address: "0xb934cabf87781f7eb13265de4cb2ce090d00c4e3",
        symbol: "SURPLUS",
        name: "SURPLUS",
      },
      {
        address: "0xE1838f0dFF03a9327DeA87B2a2285850791297EC",
        symbol: "SURPLUS",
        name: "SURPLUS",
      },
    ],
  },
  ethereum: {
    key: "ethereum",
    chainId: 1,
    chainIdHex: "0x1",
    name: "Ethereum Mainnet",
    shortName: "Ethereum",
    nativeSymbol: "ETH",
    rpcUrls: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
    ],
    explorerUrl: "https://etherscan.io",
    geckoNetwork: "eth",
    permit2Address: PERMIT2_SINGLETON,
    goPlusSupported: true,
    honeypotSupported: true,
    popularSpenders: [
      { address: PERMIT2_SINGLETON, label: "Uniswap Permit2", trusted: true },
      {
        address: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        label: "Uniswap Universal Router",
        trusted: true,
      },
      {
        address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        label: "Uniswap V2 Router",
        trusted: true,
      },
      {
        address: "0x111111125421cA6dc452d289314280a0f8842A65",
        label: "1inch Aggregation Router v6",
        trusted: true,
      },
    ],
    canonicalTokens: [
      {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        name: "USD Coin",
      },
      {
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        symbol: "USDT",
        name: "Tether USD",
      },
      {
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        symbol: "WETH",
        name: "Wrapped Ether",
      },
      {
        address: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
        symbol: "PEPE",
        name: "Pepe",
      },
      {
        address: "0x514910771af9ca656af840dff83e8264ecf986ca",
        symbol: "LINK",
        name: "Chainlink",
      },
    ],
  },
  base: {
    key: "base",
    chainId: 8453,
    chainIdHex: "0x2105",
    name: "Base",
    shortName: "Base",
    nativeSymbol: "ETH",
    rpcUrls: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
    explorerUrl: "https://basescan.org",
    geckoNetwork: "base",
    permit2Address: PERMIT2_SINGLETON,
    goPlusSupported: true,
    honeypotSupported: true,
    popularSpenders: [
      { address: PERMIT2_SINGLETON, label: "Uniswap Permit2", trusted: true },
      {
        address: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        label: "Uniswap Universal Router",
        trusted: true,
      },
      {
        address: "0x2626664c2603336E57B271c5C0b26F421741e481",
        label: "Uniswap V3 SwapRouter02",
        trusted: true,
      },
      {
        address: "0x111111125421cA6dc452d289314280a0f8842A65",
        label: "1inch Aggregation Router v6",
        trusted: true,
      },
    ],
    canonicalTokens: [
      {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        name: "USD Coin",
      },
      {
        address: "0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        name: "Wrapped Ether",
      },
    ],
  },
  arbitrum: {
    key: "arbitrum",
    chainId: 42161,
    chainIdHex: "0xa4b1",
    name: "Arbitrum One",
    shortName: "Arbitrum",
    nativeSymbol: "ETH",
    rpcUrls: [
      "https://arbitrum-one-rpc.publicnode.com",
      "https://arb1.arbitrum.io/rpc",
    ],
    explorerUrl: "https://arbiscan.io",
    geckoNetwork: "arbitrum",
    permit2Address: PERMIT2_SINGLETON,
    goPlusSupported: true,
    honeypotSupported: true,
    popularSpenders: [
      { address: PERMIT2_SINGLETON, label: "Uniswap Permit2", trusted: true },
      {
        address: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        label: "Uniswap Universal Router",
        trusted: true,
      },
      {
        address: "0x111111125421cA6dc452d289314280a0f8842A65",
        label: "1inch Aggregation Router v6",
        trusted: true,
      },
    ],
    canonicalTokens: [
      {
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        symbol: "USDC",
        name: "USD Coin",
      },
      {
        address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        symbol: "WETH",
        name: "Wrapped Ether",
      },
    ],
  },
  optimism: {
    key: "optimism",
    chainId: 10,
    chainIdHex: "0xa",
    name: "Optimism",
    shortName: "Optimism",
    nativeSymbol: "ETH",
    rpcUrls: [
      "https://optimism-rpc.publicnode.com",
      "https://mainnet.optimism.io",
    ],
    explorerUrl: "https://optimistic.etherscan.io",
    geckoNetwork: "optimism",
    permit2Address: PERMIT2_SINGLETON,
    goPlusSupported: true,
    honeypotSupported: true,
    popularSpenders: [
      { address: PERMIT2_SINGLETON, label: "Uniswap Permit2", trusted: true },
      {
        address: "0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8",
        label: "Uniswap Universal Router",
        trusted: true,
      },
    ],
    canonicalTokens: [
      {
        address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        symbol: "USDC",
        name: "USD Coin",
      },
      {
        address: "0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        name: "Wrapped Ether",
      },
    ],
  },
  polygon: {
    key: "polygon",
    chainId: 137,
    chainIdHex: "0x89",
    name: "Polygon PoS",
    shortName: "Polygon",
    nativeSymbol: "POL",
    rpcUrls: [
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon-rpc.com",
    ],
    explorerUrl: "https://polygonscan.com",
    geckoNetwork: "polygon_pos",
    permit2Address: PERMIT2_SINGLETON,
    goPlusSupported: true,
    honeypotSupported: true,
    popularSpenders: [
      { address: PERMIT2_SINGLETON, label: "Uniswap Permit2", trusted: true },
      {
        address: "0x111111125421cA6dc452d289314280a0f8842A65",
        label: "1inch Aggregation Router v6",
        trusted: true,
      },
    ],
    canonicalTokens: [
      {
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        symbol: "USDC",
        name: "USD Coin",
      },
    ],
  },
  bsc: {
    key: "bsc",
    chainId: 56,
    chainIdHex: "0x38",
    name: "BNB Smart Chain",
    shortName: "BSC",
    nativeSymbol: "BNB",
    rpcUrls: [
      "https://bsc-rpc.publicnode.com",
      "https://bsc-dataseed.binance.org",
    ],
    explorerUrl: "https://bscscan.com",
    geckoNetwork: "bsc",
    permit2Address: PERMIT2_SINGLETON,
    goPlusSupported: true,
    honeypotSupported: true,
    popularSpenders: [
      { address: PERMIT2_SINGLETON, label: "Uniswap Permit2", trusted: true },
      {
        address: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
        label: "PancakeSwap V2 Router",
        trusted: true,
      },
      {
        address: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
        label: "PancakeSwap SmartRouter V3",
        trusted: true,
      },
    ],
    canonicalTokens: [
      {
        address: "0x55d398326f99059fF775485246999027B3197955",
        symbol: "USDT",
        name: "Tether USD",
      },
      {
        address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        symbol: "WBNB",
        name: "Wrapped BNB",
      },
    ],
  },
};

export interface EvmContractCapabilities {
  mintable: boolean;
  pausable: boolean;
  blacklistable: boolean;
  feeModifiable: boolean;
  maxTxModifiable: boolean;
  hasDelegatecall: boolean;
  hasSelfDestruct: boolean;
  cannotSellAll: boolean;
  transferPausable: boolean;
}

export interface EvmSecurityFlag {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
}

export type EvmHoneypotStatus =
  | "SELLABLE"
  | "HONEYPOT"
  | "HIGH_TAX"
  | "UNVERIFIED";

export interface EvmContractSecurityReport {
  chainKey: EvmChainKey;
  chainId: number;
  networkName: string;
  address: string;
  standard: "ERC-20";
  isDeployed: boolean;
  bytecodeBytes: number;
  isProxy: boolean;
  proxyType: "EIP-1967" | "EIP-1967-BEACON" | "EIP-1167" | "GOPLUS-PROXY" | null;
  implementationAddress: string | null;
  ownerAddress: string | null;
  ownershipRenounced: boolean | null;
  verifiedSource: "sourcify-full" | "sourcify-partial" | "goplus-open-source" | "unverified";
  honeypotStatus: EvmHoneypotStatus;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  transferTaxPct: number | null;
  holderCount: number | null;
  creatorAddress?: string | null;
  topHolders?: Array<{
    address: string;
    tag: string | null;
    isContract: boolean;
    balance: string | null;
    pct: number;
    isLocked: boolean;
  }>;
  capabilities: EvmContractCapabilities;
  detectedSelectors: string[];
  riskScore: number;
  verdict: "SAFE" | "CAUTION" | "CRITICAL";
  flags: EvmSecurityFlag[];
  verificationBasis: string;
  summary: string;
}

export const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";

// EIP-1967 standardized storage slots
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const ADMIN_SELECTOR_MAP: Record<
  string,
  { name: string; cap: keyof EvmContractCapabilities | "ownership" }
> = {
  "40c10f19": { name: "mint(address,uint256)", cap: "mintable" },
  a0712d68: { name: "mint(uint256)", cap: "mintable" },
  "4e6ec247": { name: "mint(address,uint256)", cap: "mintable" },
  "8456cb59": { name: "pause()", cap: "pausable" },
  "3f4ba83a": { name: "unpause()", cap: "pausable" },
  "5c975abb": { name: "paused()", cap: "pausable" },
  f9f92be4: { name: "blacklist(address)", cap: "blacklistable" },
  "44337ea1": { name: "blacklistAddress(address,bool)", cap: "blacklistable" },
  "0ecb93c0": { name: "addToBlackList(address[])", cap: "blacklistable" },
  "404e5129": { name: "addBot(address)", cap: "blacklistable" },
  e47d6060: { name: "isBlackListed(address)", cap: "blacklistable" },
  c0246668: { name: "excludeFromFees(address,bool)", cap: "feeModifiable" },
  e57f14e1: { name: "setFees(uint256,uint256)", cap: "feeModifiable" },
  "69fe0e2d": { name: "setFee(uint256)", cap: "feeModifiable" },
  afa4f3b2: { name: "setTaxFeePercent(uint256)", cap: "feeModifiable" },
  "8ee88c53": { name: "setLiquidityFeePercent(uint256)", cap: "feeModifiable" },
  ec28438a: { name: "setMaxTxAmount(uint256)", cap: "maxTxModifiable" },
  e99c9d09: { name: "setMaxTxPercent(uint256)", cap: "maxTxModifiable" },
  b9e93700: { name: "setMaxWallet(uint256)", cap: "maxTxModifiable" },
  c9567bf9: { name: "openTrading()", cap: "transferPausable" },
  "8a8c523c": { name: "enableTrading()", cap: "transferPausable" },
  "715018a6": { name: "renounceOwnership()", cap: "ownership" },
  f2fde38b: { name: "transferOwnership(address)", cap: "ownership" },
  "8da5cb5b": { name: "owner()", cap: "ownership" },
};

export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

export function normalizeEvmAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function resolveEvmChainKey(raw?: string | number | null): EvmChainKey {
  if (typeof raw === "number") {
    const match = Object.values(EVM_CHAINS).find((c) => c.chainId === raw);
    if (match) return match.key;
  }
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "ethereum";
  if (s === "4663" || s === "0x1237" || s.includes("robinhood")) return "robinhood";
  if (s === "8453" || s === "0x2105" || s === "base") return "base";
  if (s === "42161" || s === "0xa4b1" || s.includes("arb")) return "arbitrum";
  if (s === "10" || s === "0xa" || s.includes("opt")) return "optimism";
  if (s === "137" || s === "0x89" || s.includes("poly") || s === "matic") return "polygon";
  if (s === "56" || s === "0x38" || s === "bsc" || s.includes("bnb")) return "bsc";
  if (s === "1" || s === "0x1" || s === "eth" || s.includes("ethereum")) return "ethereum";
  return "ethereum";
}

export function resolveEvmChainConfig(raw?: string | number | null): EvmChainConfig {
  return EVM_CHAINS[resolveEvmChainKey(raw)];
}

export function padAddress32(address: string): string {
  return normalizeEvmAddress(address).replace(/^0x/, "").padStart(64, "0");
}

export function padUint32(value: bigint | number): string {
  const bi = typeof value === "bigint" ? value : BigInt(Math.max(0, Math.trunc(value)));
  return bi.toString(16).padStart(64, "0");
}

/**
 * Encodes standard ERC-20 approve(address spender, uint256 amount = 0) calldata.
 */
export function encodeErc20ApproveZero(spender: string): string {
  return `0x095ea7b3${padAddress32(spender)}${padUint32(0n)}`;
}

/**
 * Encodes Uniswap Permit2 `lockdown((address token, address spender)[])` (selector 0xcc53287f).
 */
export function encodePermit2Lockdown(
  approvals: Array<{ token: string; spender: string }>
): string {
  if (approvals.length === 0) {
    throw new Error("At least one Permit2 (token, spender) tuple is required.");
  }
  const offsetWord = padUint32(32n);
  const lengthWord = padUint32(BigInt(approvals.length));
  const tuples = approvals
    .map((item) => `${padAddress32(item.token)}${padAddress32(item.spender)}`)
    .join("");
  return `0xcc53287f${offsetWord}${lengthWord}${tuples}`;
}

export function decodeAbiUint256(hex?: string | null): bigint | null {
  if (!hex || hex === "0x" || !hex.startsWith("0x")) return null;
  const clean = hex.slice(2);
  if (!clean || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  try {
    return BigInt(`0x${clean.slice(0, 64)}`);
  } catch {
    return null;
  }
}

export function decodeAbiAddressSlot(hex?: string | null): string | null {
  if (!hex || hex === "0x" || !hex.startsWith("0x")) return null;
  const clean = hex.slice(2).padStart(64, "0");
  if (clean.length < 64 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const addr = `0x${clean.slice(-40).toLowerCase()}`;
  if (addr === ZERO_EVM_ADDRESS) return null;
  return addr;
}

export function decodeAbiString(hex?: string | null): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const raw = hex.replace(/^0x/, "");
    if (raw.length >= 128) {
      const len = parseInt(raw.substring(64, 128), 16);
      if (len > 0 && len < 256) {
        const strHex = raw.substring(128, 128 + len * 2);
        const bytes = new Uint8Array(
          strHex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []
        );
        const str = new TextDecoder("utf-8", { fatal: false })
          .decode(bytes)
          .replace(/\0/g, "")
          .trim();
        if (str) return str;
      }
    }
    const bytes = new Uint8Array(
      raw.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []
    );
    const fallback = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes)
      .replace(/\0/g, "")
      .trim();
    return fallback || null;
  } catch {
    return null;
  }
}

export async function evmRpcCall<T = unknown>(
  rpcUrls: string[],
  method: string,
  params: unknown[],
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<T | null> {
  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4000;

  for (const rpcUrl of rpcUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: T; error?: unknown };
      if (json && json.error === undefined && json.result !== undefined) {
        return json.result;
      }
    } catch {
      // try next RPC
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Opcode-aware EVM bytecode scanner:
 * walks EVM instructions sequentially, jumping over PUSH1..PUSH32 immediate literals
 * so arbitrary data bytes never produce false-positive SELFDESTRUCT / DELEGATECALL
 * hits, while cleanly extracting PUSH4 (0x63) function selectors and EIP-1167 clones.
 */
export function parseEvmBytecodeCapabilities(bytecodeHex: string): {
  bytecodeBytes: number;
  isEip1167MinimalProxy: boolean;
  minimalProxyTarget: string | null;
  hasDelegatecall: boolean;
  hasSelfDestruct: boolean;
  detectedSelectors: string[];
  capabilities: Pick<
    EvmContractCapabilities,
    "mintable" | "pausable" | "blacklistable" | "feeModifiable" | "maxTxModifiable" | "hasDelegatecall" | "hasSelfDestruct"
  >;
} {
  const clean = bytecodeHex.startsWith("0x")
    ? bytecodeHex.slice(2).toLowerCase()
    : bytecodeHex.toLowerCase();
  const bytecodeBytes = Math.floor(clean.length / 2);

  // EIP-1167 runtime clone: 363d3d373d3d3d363d73<20-byte-address>5af43d82803e903d91602b57fd5bf3
  const eip1167Match = clean.match(/^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e/);
  const isEip1167MinimalProxy = Boolean(eip1167Match);
  const minimalProxyTarget = eip1167Match ? `0x${eip1167Match[1]}` : null;

  let hasDelegatecall = false;
  let hasSelfDestruct = false;
  const selectorSet = new Set<string>();
  const caps = {
    mintable: false,
    pausable: false,
    blacklistable: false,
    feeModifiable: false,
    maxTxModifiable: false,
    hasDelegatecall: false,
    hasSelfDestruct: false,
  };

  let pc = 0;
  while (pc < bytecodeBytes) {
    const opcode = parseInt(clean.slice(pc * 2, pc * 2 + 2), 16);
    if (Number.isNaN(opcode)) break;

    if (opcode === 0x63 && pc + 5 <= bytecodeBytes) {
      // PUSH4 selector
      const sel = clean.slice((pc + 1) * 2, (pc + 5) * 2);
      const match = ADMIN_SELECTOR_MAP[sel];
      if (match) {
        selectorSet.add(match.name);
        if (match.cap === "mintable") caps.mintable = true;
        else if (match.cap === "pausable") caps.pausable = true;
        else if (match.cap === "blacklistable") caps.blacklistable = true;
        else if (match.cap === "feeModifiable") caps.feeModifiable = true;
        else if (match.cap === "maxTxModifiable") caps.maxTxModifiable = true;
      }
      pc += 5;
      continue;
    }

    if (opcode >= 0x60 && opcode <= 0x7f) {
      // PUSH1 (0x60) .. PUSH32 (0x7f)
      const pushLen = opcode - 0x5f;
      pc += 1 + pushLen;
      continue;
    }

    if (opcode === 0xf4) hasDelegatecall = true;
    else if (opcode === 0xff) hasSelfDestruct = true;

    pc += 1;
  }

  caps.hasDelegatecall = hasDelegatecall;
  caps.hasSelfDestruct = hasSelfDestruct;

  return {
    bytecodeBytes,
    isEip1167MinimalProxy,
    minimalProxyTarget,
    hasDelegatecall,
    hasSelfDestruct,
    detectedSelectors: Array.from(selectorSet),
    capabilities: caps,
  };
}

interface GoPlusTokenRecord {
  is_honeypot?: string;
  honeypot_with_same_creator?: string;
  buy_tax?: string;
  sell_tax?: string;
  transfer_pausable?: string;
  is_mintable?: string;
  is_proxy?: string;
  is_open_source?: string;
  is_blacklisted?: string;
  cannot_sell_all?: string;
  slippage_modifiable?: string;
  owner_address?: string;
  creator_address?: string;
  holder_count?: string;
  holders?: Array<{
    address?: string;
    tag?: string;
    is_contract?: number;
    balance?: string;
    percent?: string;
    is_locked?: number;
  }>;
}

interface HoneypotIsResponse {
  summary?: { risk?: string; riskLevel?: number };
  simulationSuccess?: boolean;
  honeypotResult?: { isHoneypot?: boolean; honeypotReason?: string };
  simulationResult?: {
    buyTax?: number;
    sellTax?: number;
    transferTax?: number;
  };
  token?: { totalHolders?: number };
}

async function fetchJsonSafe<T>(
  url: string,
  timeoutMs = 3800,
  fetchImpl: typeof fetch = fetch
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
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

export interface InspectEvmContractOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  overrideRpcUrls?: string[];
}

/**
 * Inspects an EVM smart contract across RPC bytecode/storage, Sourcify v2 source verification,
 * and GoPlus / Honeypot.is trade simulation when the chain is indexed.
 */
export async function inspectEvmContractSecurity(
  address: string,
  chainKeyOrId?: string | number | null,
  options: InspectEvmContractOptions = {}
): Promise<EvmContractSecurityReport> {
  const chain = resolveEvmChainConfig(chainKeyOrId);
  const cleanAddr = isValidEvmAddress(address)
    ? normalizeEvmAddress(address)
    : address.trim();
  const rpcUrls =
    options.overrideRpcUrls && options.overrideRpcUrls.length > 0
      ? options.overrideRpcUrls
      : chain.rpcUrls;
  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4200;

  const emptyReport = (reason: string): EvmContractSecurityReport => ({
    chainKey: chain.key,
    chainId: chain.chainId,
    networkName: chain.name,
    address: cleanAddr,
    standard: "ERC-20",
    isDeployed: false,
    bytecodeBytes: 0,
    isProxy: false,
    proxyType: null,
    implementationAddress: null,
    ownerAddress: null,
    ownershipRenounced: null,
    verifiedSource: "unverified",
    honeypotStatus: "UNVERIFIED",
    buyTaxPct: null,
    sellTaxPct: null,
    transferTaxPct: null,
    holderCount: null,
    capabilities: {
      mintable: false,
      pausable: false,
      blacklistable: false,
      feeModifiable: false,
      maxTxModifiable: false,
      hasDelegatecall: false,
      hasSelfDestruct: false,
      cannotSellAll: false,
      transferPausable: false,
    },
    detectedSelectors: [],
    riskScore: 45,
    verdict: "CAUTION",
    flags: [
      {
        code: "EVM_NO_CODE",
        severity: "MEDIUM",
        title: "No Contract Bytecode Found",
        description: reason,
      },
    ],
    verificationBasis: "rpc-bytecode",
    summary: reason,
  });

  if (!isValidEvmAddress(cleanAddr)) {
    return emptyReport("Provided address is not a valid 20-byte 0x EVM address.");
  }

  const rpcOpts = { timeoutMs, fetchImpl: fetcher };
  const [
    codeHex,
    implSlotHex,
    beaconSlotHex,
    ownerHex,
    sourcifyJson,
    goPlusJson,
    honeypotJson,
  ] = await Promise.all([
    evmRpcCall<string>(rpcUrls, "eth_getCode", [cleanAddr, "latest"], rpcOpts),
    evmRpcCall<string>(rpcUrls, "eth_getStorageAt", [cleanAddr, EIP1967_IMPL_SLOT, "latest"], rpcOpts),
    evmRpcCall<string>(rpcUrls, "eth_getStorageAt", [cleanAddr, EIP1967_BEACON_SLOT, "latest"], rpcOpts),
    evmRpcCall<string>(rpcUrls, "eth_call", [{ to: cleanAddr, data: "0x8da5cb5b" }, "latest"], rpcOpts),
    fetchJsonSafe<{ match?: string | null; runtimeMatch?: string | null }>(
      `https://sourcify.dev/server/v2/contract/${chain.chainId}/${cleanAddr}`,
      timeoutMs,
      fetcher
    ),
    chain.goPlusSupported
      ? fetchJsonSafe<{ code?: number; result?: Record<string, GoPlusTokenRecord> }>(
          `https://api.gopluslabs.io/api/v1/token_security/${chain.chainId}?contract_addresses=${cleanAddr}`,
          timeoutMs,
          fetcher
        )
      : Promise.resolve(null),
    chain.honeypotSupported
      ? fetchJsonSafe<HoneypotIsResponse>(
          `https://api.honeypot.is/v2/IsHoneypot?address=${cleanAddr}&chainID=${chain.chainId}`,
          timeoutMs,
          fetcher
        )
      : Promise.resolve(null),
  ]);

  const code = codeHex || "0x";
  if (code.length <= 2 || code === "0x") {
    return emptyReport(
      `No contract bytecode found at ${cleanAddr} on ${chain.name} (Chain ID ${chain.chainId}).`
    );
  }

  let parsed = parseEvmBytecodeCapabilities(code);
  const eip1967Impl = decodeAbiAddressSlot(implSlotHex);
  const eip1967Beacon = decodeAbiAddressSlot(beaconSlotHex);
  const goPlusRec =
    goPlusJson?.result?.[cleanAddr] ??
    goPlusJson?.result?.[Object.keys(goPlusJson?.result || {})[0] || ""] ??
    null;

  let isProxy = parsed.isEip1167MinimalProxy || Boolean(eip1967Impl || eip1967Beacon);
  let proxyType: EvmContractSecurityReport["proxyType"] = eip1967Impl
    ? "EIP-1967"
    : eip1967Beacon
      ? "EIP-1967-BEACON"
      : parsed.isEip1167MinimalProxy
        ? "EIP-1167"
        : null;
  let implementationAddress = eip1967Impl || parsed.minimalProxyTarget || eip1967Beacon || null;

  if (!isProxy && goPlusRec?.is_proxy === "1") {
    isProxy = true;
    proxyType = "GOPLUS-PROXY";
  }

  // Inspect proxy implementation bytecode too when resolved
  if (implementationAddress && isValidEvmAddress(implementationAddress)) {
    const implCode = await evmRpcCall<string>(
      rpcUrls,
      "eth_getCode",
      [implementationAddress, "latest"],
      rpcOpts
    );
    if (implCode && implCode.length > 2 && implCode !== "0x") {
      const implParsed = parseEvmBytecodeCapabilities(implCode);
      parsed = {
        bytecodeBytes: parsed.bytecodeBytes + implParsed.bytecodeBytes,
        isEip1167MinimalProxy: parsed.isEip1167MinimalProxy,
        minimalProxyTarget: parsed.minimalProxyTarget,
        hasDelegatecall: parsed.hasDelegatecall || implParsed.hasDelegatecall,
        hasSelfDestruct: parsed.hasSelfDestruct || implParsed.hasSelfDestruct,
        detectedSelectors: Array.from(
          new Set([...parsed.detectedSelectors, ...implParsed.detectedSelectors])
        ),
        capabilities: {
          mintable: parsed.capabilities.mintable || implParsed.capabilities.mintable,
          pausable: parsed.capabilities.pausable || implParsed.capabilities.pausable,
          blacklistable:
            parsed.capabilities.blacklistable || implParsed.capabilities.blacklistable,
          feeModifiable:
            parsed.capabilities.feeModifiable || implParsed.capabilities.feeModifiable,
          maxTxModifiable:
            parsed.capabilities.maxTxModifiable || implParsed.capabilities.maxTxModifiable,
          hasDelegatecall:
            parsed.capabilities.hasDelegatecall || implParsed.capabilities.hasDelegatecall,
          hasSelfDestruct:
            parsed.capabilities.hasSelfDestruct || implParsed.capabilities.hasSelfDestruct,
        },
      };
    }
  }

  const cleanOwnerHex = ownerHex?.trim() || "";
  const rawOwner = /^0x[0-9a-fA-F]{64,}$/.test(cleanOwnerHex)
    ? `0x${cleanOwnerHex.slice(2, 66).slice(-40).toLowerCase()}`
    : null;
  const goPlusOwner =
    goPlusRec?.owner_address && isValidEvmAddress(goPlusRec.owner_address)
      ? goPlusRec.owner_address.toLowerCase()
      : null;
  const resolvedOwner = rawOwner || goPlusOwner || null;
  const ownershipRenounced = resolvedOwner
    ? resolvedOwner === ZERO_EVM_ADDRESS
    : null;

  const verifiedSource: EvmContractSecurityReport["verifiedSource"] =
    sourcifyJson?.match === "match" || sourcifyJson?.runtimeMatch === "match"
      ? "sourcify-full"
      : sourcifyJson?.match === "partial_match"
        ? "sourcify-partial"
        : goPlusRec?.is_open_source === "1"
          ? "goplus-open-source"
          : "unverified";

  // Tax & Honeypot parsing
  const parsePct = (val?: string | number | null): number | null => {
    if (val === undefined || val === null || val === "") return null;
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    return Number((n <= 1 && typeof val === "string" ? n * 100 : n).toFixed(2));
  };

  const hpBuyTax =
    typeof honeypotJson?.simulationResult?.buyTax === "number"
      ? Number(honeypotJson.simulationResult.buyTax.toFixed(2))
      : null;
  const hpSellTax =
    typeof honeypotJson?.simulationResult?.sellTax === "number"
      ? Number(honeypotJson.simulationResult.sellTax.toFixed(2))
      : null;
  const hpTransferTax =
    typeof honeypotJson?.simulationResult?.transferTax === "number"
      ? Number(honeypotJson.simulationResult.transferTax.toFixed(2))
      : null;

  const gpBuyTax = parsePct(goPlusRec?.buy_tax);
  const gpSellTax = parsePct(goPlusRec?.sell_tax);

  const buyTaxPct = hpBuyTax ?? gpBuyTax;
  const sellTaxPct = hpSellTax ?? gpSellTax;
  const transferTaxPct = hpTransferTax;

  const isHoneypotFlag =
    honeypotJson?.honeypotResult?.isHoneypot === true ||
    goPlusRec?.is_honeypot === "1" ||
    goPlusRec?.cannot_sell_all === "1";

  const maxTax = Math.max(buyTaxPct ?? 0, sellTaxPct ?? 0, transferTaxPct ?? 0);
  const honeypotStatus: EvmHoneypotStatus = isHoneypotFlag
    ? "HONEYPOT"
    : maxTax >= 15
      ? "HIGH_TAX"
      : honeypotJson?.simulationSuccess === true || (goPlusRec && goPlusRec.is_honeypot === "0")
        ? "SELLABLE"
        : "UNVERIFIED";

  const capabilities: EvmContractCapabilities = {
    mintable: parsed.capabilities.mintable || goPlusRec?.is_mintable === "1",
    pausable: parsed.capabilities.pausable || goPlusRec?.transfer_pausable === "1",
    blacklistable: parsed.capabilities.blacklistable || goPlusRec?.is_blacklisted === "1",
    feeModifiable: parsed.capabilities.feeModifiable || goPlusRec?.slippage_modifiable === "1",
    maxTxModifiable: parsed.capabilities.maxTxModifiable,
    hasDelegatecall: parsed.capabilities.hasDelegatecall,
    hasSelfDestruct: parsed.capabilities.hasSelfDestruct,
    cannotSellAll: goPlusRec?.cannot_sell_all === "1",
    transferPausable: goPlusRec?.transfer_pausable === "1",
  };

  const holderCountRaw =
    honeypotJson?.token?.totalHolders ??
    (goPlusRec?.holder_count ? Number(goPlusRec.holder_count) : null);
  const holderCount =
    typeof holderCountRaw === "number" && Number.isFinite(holderCountRaw)
      ? holderCountRaw
      : null;

  const flags: EvmSecurityFlag[] = [];
  let riskScore = 8;

  if (honeypotStatus === "HONEYPOT") {
    riskScore = 96;
    flags.push({
      code: "EVM_HONEYPOT",
      severity: "CRITICAL",
      title: "Honeypot / Cannot-Sell Trap",
      description:
        honeypotJson?.honeypotResult?.honeypotReason ||
        "Simulated swap or GoPlus telemetry indicates holders cannot sell tokens.",
    });
  } else if (honeypotStatus === "HIGH_TAX") {
    riskScore = Math.max(riskScore, 72);
    flags.push({
      code: "EVM_HIGH_TAX",
      severity: "HIGH",
      title: `Excessive Trade Tax (${buyTaxPct ?? "?"}% buy / ${sellTaxPct ?? "?"}% sell)`,
      description: "Token applies >= 15% tax on buys, sells, or transfers.",
    });
  }

  if (capabilities.hasSelfDestruct) {
    riskScore = Math.max(riskScore, 90);
    flags.push({
      code: "EVM_SELFDESTRUCT",
      severity: "CRITICAL",
      title: "Contract Contains SELFDESTRUCT Opcode",
      description: "Privileged call could destroy contract bytecode and break token transfers.",
    });
  }

  if (isProxy && ownershipRenounced === false) {
    riskScore = Math.max(riskScore, 62);
    flags.push({
      code: "EVM_UPGRADEABLE_PROXY",
      severity: "HIGH",
      title: `Upgradeable ${proxyType || "Proxy"} Contract`,
      description: `Proxy points to ${implementationAddress || "external logic"} with active owner.`,
    });
  } else if (isProxy) {
    riskScore = Math.max(riskScore, 34);
    flags.push({
      code: "EVM_PROXY_DETECTED",
      severity: "MEDIUM",
      title: `${proxyType || "Proxy"} Pattern Detected`,
      description: `Delegates execution via ${implementationAddress || "implementation slot"}.`,
    });
  }

  if (capabilities.blacklistable && ownershipRenounced !== true) {
    riskScore += 18;
    flags.push({
      code: "EVM_BLACKLIST_SELECTOR",
      severity: "HIGH",
      title: "Blacklist / Anti-Bot Selector in Bytecode",
      description: "Contract contains blacklist or address-blocking logic.",
    });
  }

  if (capabilities.mintable && ownershipRenounced !== true) {
    riskScore += 16;
    flags.push({
      code: "EVM_MINTABLE_SUPPLY",
      severity: "MEDIUM",
      title: "Mint Function Detected in Bytecode",
      description: "Supply can potentially be inflated by privileged roles unless renounced.",
    });
  }

  if (capabilities.feeModifiable && ownershipRenounced !== true) {
    riskScore += 14;
    flags.push({
      code: "EVM_MODIFIABLE_TAX",
      severity: "MEDIUM",
      title: "Modifiable Fee / Tax Selectors",
      description: "Bytecode exposes fee setter functions that can raise taxes after launch.",
    });
  }

  if (capabilities.pausable && ownershipRenounced !== true) {
    riskScore += 12;
    flags.push({
      code: "EVM_PAUSABLE_TRANSFERS",
      severity: "MEDIUM",
      title: "Pausable Transfer Logic",
      description: "Owner can pause token transfers on-chain.",
    });
  }

  if (ownershipRenounced === true) {
    riskScore = Math.max(4, riskScore - 6);
  }

  riskScore = Math.min(99, Math.max(5, Math.round(riskScore)));
  const verdict: EvmContractSecurityReport["verdict"] =
    riskScore >= 70 ? "CRITICAL" : riskScore >= 35 ? "CAUTION" : "SAFE";

  const basisParts = ["rpc-bytecode"];
  if (sourcifyJson?.match) basisParts.push("sourcify-v2");
  if (goPlusRec) basisParts.push("goplus");
  if (honeypotJson?.simulationSuccess !== undefined) basisParts.push("honeypot.is");

  const summary =
    honeypotStatus === "HONEYPOT"
      ? `CRITICAL: Token failed sellability check on ${chain.name} — probable honeypot.`
      : `${chain.name} ERC-20 (${parsed.bytecodeBytes}B bytecode): ${
          ownershipRenounced === true
            ? "ownership renounced"
            : ownershipRenounced === false
              ? `active owner ${resolvedOwner?.slice(0, 8)}...`
              : "no public owner() getter"
        }, ${isProxy ? `${proxyType} proxy` : "non-proxy implementation"}, Sourcify=${verifiedSource}.`;

  const creatorAddress =
    goPlusRec?.creator_address && /^0x[a-f0-9]{40}$/i.test(goPlusRec.creator_address)
      ? goPlusRec.creator_address
      : null;

  const topHolders = Array.isArray(goPlusRec?.holders)
    ? goPlusRec.holders
        .filter((h) => Boolean(h?.address && /^0x[a-f0-9]{40}$/i.test(h.address)))
        .slice(0, 15)
        .map((h) => {
          const pctRaw = Number(h.percent || "0");
          const pct = Number.isFinite(pctRaw) ? Number((pctRaw * 100).toFixed(2)) : 0;
          return {
            address: h.address!,
            tag: h.tag?.trim() ? h.tag.trim() : null,
            isContract: h.is_contract === 1,
            balance: h.balance ?? null,
            pct,
            isLocked: h.is_locked === 1,
          };
        })
    : undefined;

  return {
    chainKey: chain.key,
    chainId: chain.chainId,
    networkName: chain.name,
    address: cleanAddr,
    standard: "ERC-20",
    isDeployed: true,
    bytecodeBytes: parsed.bytecodeBytes,
    isProxy,
    proxyType,
    implementationAddress,
    ownerAddress: resolvedOwner,
    creatorAddress,
    ownershipRenounced,
    verifiedSource,
    honeypotStatus,
    buyTaxPct,
    sellTaxPct,
    transferTaxPct,
    holderCount,
    topHolders,
    capabilities,
    detectedSelectors: parsed.detectedSelectors,
    riskScore,
    verdict,
    flags,
    verificationBasis: basisParts.join("+"),
    summary,
  };
}
