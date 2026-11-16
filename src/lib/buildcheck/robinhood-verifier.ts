import type { RobinhoodListingStatus, RobinhoodVerificationReport } from "./types";

export interface RobinhoodOfficialAsset {
  symbol: string;
  name: string;
  tradingPair: string;
  chain: "solana" | "ethereum" | "arbitrum" | "native" | "robinhood";
  officialContract?: string;
  assetType: "crypto_token" | "tokenized_rwa" | "layer1_coin";
  isTradable: boolean;
  notes?: string;
}

export const ROBINHOOD_CHAIN_CONFIG = {
  chainId: 4663,
  hexChainId: "0x1237",
  name: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  currency: "ETH",
  stack: "Arbitrum Orbit L2",
} as const;

/**
 * Verified registry of assets officially listed and tradable on Robinhood Crypto.
 * Matched strictly by official contract address or native ticker.
 */
export const ROBINHOOD_OFFICIAL_ASSETS: Record<string, RobinhoodOfficialAsset> = {
  // Solana Official Listings
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
    symbol: "BONK",
    name: "Bonk",
    tradingPair: "BONK-USD",
    chain: "solana",
    officialContract: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Solana SPL Token listed on Robinhood Crypto.",
  },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: {
    symbol: "WIF",
    name: "dogwifhat",
    tradingPair: "WIF-USD",
    chain: "solana",
    officialContract: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Solana SPL Token listed on Robinhood Crypto.",
  },
  So11111111111111111111111111111111111111112: {
    symbol: "SOL",
    name: "Solana",
    tradingPair: "SOL-USD",
    chain: "solana",
    officialContract: "So11111111111111111111111111111111111111112",
    assetType: "layer1_coin",
    isTradable: true,
    notes: "Native Solana coin listed on Robinhood Crypto.",
  },

  // Ethereum / EVM Official Listings
  "0x6982508145454ce325ddbe47a25d4ec3d2311933": {
    symbol: "PEPE",
    name: "Pepe",
    tradingPair: "PEPE-USD",
    chain: "ethereum",
    officialContract: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Ethereum ERC-20 contract listed on Robinhood Crypto.",
  },
  "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce": {
    symbol: "SHIB",
    name: "Shiba Inu",
    tradingPair: "SHIB-USD",
    chain: "ethereum",
    officialContract: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Ethereum ERC-20 contract listed on Robinhood Crypto.",
  },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    symbol: "ETH",
    name: "Wrapped Ether",
    tradingPair: "ETH-USD",
    chain: "ethereum",
    officialContract: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    assetType: "layer1_coin",
    isTradable: true,
    notes: "Canonical Ethereum representation listed on Robinhood Crypto.",
  },
  "0x514910771af9ca656af840dff83e8264ecf986ca": {
    symbol: "LINK",
    name: "Chainlink",
    tradingPair: "LINK-USD",
    chain: "ethereum",
    officialContract: "0x514910771af9ca656af840dff83e8264ecf986ca",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Ethereum ERC-20 contract listed on Robinhood Crypto.",
  },
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
    symbol: "UNI",
    name: "Uniswap",
    tradingPair: "UNI-USD",
    chain: "ethereum",
    officialContract: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Ethereum ERC-20 contract listed on Robinhood Crypto.",
  },
  "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
    symbol: "AAVE",
    name: "Aave",
    tradingPair: "AAVE-USD",
    chain: "ethereum",
    officialContract: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Ethereum ERC-20 contract listed on Robinhood Crypto.",
  },
  "0xc00e94cb662c3520282e6f5717214004a7f26888": {
    symbol: "COMP",
    name: "Compound",
    tradingPair: "COMP-USD",
    chain: "ethereum",
    officialContract: "0xc00e94cb662c3520282e6f5717214004a7f26888",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Ethereum ERC-20 contract listed on Robinhood Crypto.",
  },
  "0x455e53cbb06018322f1a0e697754d2429976939a": {
    symbol: "POL",
    name: "Polygon Ecosystem Token",
    tradingPair: "POL-USD",
    chain: "ethereum",
    officialContract: "0x455e53cbb06018322f1a0e697754d2429976939a",
    assetType: "crypto_token",
    isTradable: true,
    notes: "Official Ethereum ERC-20 contract listed on Robinhood Crypto.",
  },
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
    symbol: "BTC",
    name: "Wrapped BTC",
    tradingPair: "BTC-USD",
    chain: "ethereum",
    officialContract: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    assetType: "layer1_coin",
    isTradable: true,
    notes: "Wrapped Bitcoin representation listed on Robinhood Crypto.",
  },
};

/**
 * Set of tickers officially recognized on Robinhood Crypto.
 */
export const ROBINHOOD_SUPPORTED_TICKERS = new Set<string>([
  "BTC",
  "ETH",
  "SOL",
  "DOGE",
  "SHIB",
  "PEPE",
  "BONK",
  "WIF",
  "AVAX",
  "LINK",
  "UNI",
  "AAVE",
  "COMP",
  "POL",
  "MATIC",
  "LTC",
  "BCH",
  "ETC",
  "XLM",
  "NEAR",
  "SUI",
  "ADA",
  "XRP",
]);

/**
 * Checks whether an EVM address has smart contract bytecode on the live Robinhood Chain mainnet RPC.
 */
export async function verifyRobinhoodChainDeployment(
  address: string,
  fetchTimeoutMs = 3500
): Promise<{
  isDeployed: boolean;
  bytecodeLength: number;
  rpcOk: boolean;
}> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
    return { isDeployed: false, bytecodeLength: 0, rpcOk: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const res = await fetch(ROBINHOOD_CHAIN_CONFIG.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getCode",
        params: [address.trim(), "latest"],
        id: 1,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { isDeployed: false, bytecodeLength: 0, rpcOk: false };
    }

    const json = (await res.json()) as { result?: string };
    const code = json.result || "0x";
    const isDeployed = code.length > 2 && code !== "0x";
    const bytecodeLength = isDeployed ? Math.floor((code.length - 2) / 2) : 0;

    return {
      isDeployed,
      bytecodeLength,
      rpcOk: true,
    };
  } catch {
    return { isDeployed: false, bytecodeLength: 0, rpcOk: false };
  } finally {
    clearTimeout(timer);
  }
}

function decodeAbiString(hex?: string | null): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const raw = hex.replace(/^0x/, "");
    if (raw.length >= 128) {
      const lenHex = raw.substring(64, 128);
      const len = parseInt(lenHex, 16);
      if (len > 0 && len < 256) {
        const strHex = raw.substring(128, 128 + len * 2);
        const buf = Buffer.from(strHex, "hex");
        const str = buf.toString("utf8").replace(/\0/g, "").trim();
        if (str) return str;
      }
    }
    // Fallback for bytes32 representation
    const buf = Buffer.from(raw, "hex");
    const str = buf.toString("utf8").replace(/\0/g, "").trim();
    return str || null;
  } catch {
    return null;
  }
}

/**
 * Queries ERC-20 name(), symbol(), decimals(), and totalSupply() from Robinhood Chain RPC.
 */
export async function fetchRobinhoodChainErc20Metadata(
  address: string,
  fetchTimeoutMs = 3500
): Promise<{
  name: string | null;
  symbol: string | null;
  decimals: number;
  totalSupply: string | null;
}> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
    return { name: null, symbol: null, decimals: 18, totalSupply: null };
  }

  const cleanAddr = address.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);

  const rpcCall = async (data: string) => {
    try {
      const res = await fetch(ROBINHOOD_CHAIN_CONFIG.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{ to: cleanAddr, data }, "latest"],
          id: 1,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { result?: string };
      return json.result || null;
    } catch {
      return null;
    }
  };

  try {
    const [nameHex, symHex, decHex, supHex] = await Promise.all([
      rpcCall("0x06fdde03"), // name()
      rpcCall("0x95d89b41"), // symbol()
      rpcCall("0x313ce567"), // decimals()
      rpcCall("0x18160ddd"), // totalSupply()
    ]);

    const name = decodeAbiString(nameHex);
    const symbol = decodeAbiString(symHex);
    const decimals = decHex && decHex !== "0x" ? parseInt(decHex, 16) : 18;
    let totalSupply: string | null = null;
    if (supHex && supHex !== "0x") {
      try {
        totalSupply = BigInt(supHex).toString();
      } catch {
        // ignore
      }
    }

    return { name, symbol, decimals, totalSupply };
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifyRobinhoodOptions {
  address: string;
  name?: string | null;
  symbol?: string | null;
  chainFamily?: "solana" | "evm" | "unknown";
  metadataText?: string | null;
  isRobinhoodChain?: boolean;
}

/**
 * Performs rigorous forensic verification of a token against the official Robinhood Crypto
 * tradable asset catalog and the Robinhood Chain (Arbitrum Orbit L2).
 */
export async function verifyRobinhoodStatus(
  options: VerifyRobinhoodOptions
): Promise<RobinhoodVerificationReport> {
  const address = options.address.trim();
  const name = options.name?.trim() || "";
  const symbol = (options.symbol?.trim() || "").toUpperCase();
  const metadata = `${name} ${symbol} ${options.metadataText || ""}`.toLowerCase();
  const chainFamily = options.chainFamily || (address.startsWith("0x") ? "evm" : "solana");
  const now = new Date().toISOString();

  // 1. Direct check against verified Robinhood official assets
  const officialAsset =
    ROBINHOOD_OFFICIAL_ASSETS[address] ||
    (address.startsWith("0x")
      ? ROBINHOOD_OFFICIAL_ASSETS[address.toLowerCase()]
      : undefined);

  if (officialAsset) {
    return {
      status: "OFFICIAL_LISTED",
      isListedOnRobinhood: true,
      isRobinhoodChain: false,
      tradingPair: officialAsset.tradingPair,
      assetType: officialAsset.assetType,
      summary: `Verified official ${officialAsset.name} ($${officialAsset.symbol}) listed on Robinhood Crypto with trading pair ${officialAsset.tradingPair}.`,
      officialContract: officialAsset.officialContract || address,
      officialChain: officialAsset.chain,
      impostorRiskScore: 0,
      chainFamily,
      networkName: officialAsset.chain === "solana" ? "Solana Mainnet" : "Ethereum Mainnet",
      verifiedAt: now,
      blockscoutUrl:
        chainFamily === "evm"
          ? `https://etherscan.io/token/${address}`
          : `https://solscan.io/token/${address}`,
    };
  }

  // 2. Robinhood Chain L2 check for EVM addresses
  if (chainFamily === "evm") {
    let isDeployedOnHood = options.isRobinhoodChain ?? false;
    if (!isDeployedOnHood) {
      const hoodDeployCheck = await verifyRobinhoodChainDeployment(address);
      isDeployedOnHood = hoodDeployCheck.isDeployed;
    }

    if (isDeployedOnHood) {
      return {
        status: "ROBINHOOD_CHAIN_NATIVE",
        isListedOnRobinhood: false,
        isRobinhoodChain: true,
        tradingPair: null,
        assetType: "crypto_token",
        summary: `Verified smart contract physically deployed on Robinhood Chain L2 (Chain ID ${ROBINHOOD_CHAIN_CONFIG.chainId} · ${ROBINHOOD_CHAIN_CONFIG.stack}).`,
        impostorRiskScore: 0,
        chainFamily: "evm",
        networkName: ROBINHOOD_CHAIN_CONFIG.name,
        chainId: ROBINHOOD_CHAIN_CONFIG.chainId,
        verifiedAt: now,
        blockscoutUrl: `${ROBINHOOD_CHAIN_CONFIG.explorerUrl}/address/${address}`,
      };
    }
  }

  // 3. Fraud & Impostor Detection (False Robinhood claims or fake $HOOD token)
  const isClaimingHoodBrand =
    symbol === "HOOD" ||
    symbol === "$HOOD" ||
    name.toLowerCase().includes("robinhood") ||
    name.toLowerCase().includes("robin hood") ||
    metadata.includes("official robinhood") ||
    metadata.includes("robinhood token") ||
    metadata.includes("listed on robinhood");

  if (isClaimingHoodBrand) {
    return {
      status: "IMPOSTOR_ALERT",
      isListedOnRobinhood: false,
      isRobinhoodChain: false,
      tradingPair: null,
      assetType: "unlisted",
      summary: `CRITICAL IMPOSTOR ALERT: Token claims Robinhood branding or listing, but has no official affiliation.`,
      warning:
        "CRITICAL IMPOSTOR ALERT: Robinhood (NASDAQ: HOOD) has NOT issued a decentralized meme token on Solana or DEXs. This token is an unverified brand imitation exploiting retail hype. High risk of honeypot or rugpull.",
      impostorRiskScore: 95,
      chainFamily,
      verifiedAt: now,
    };
  }

  // 4. Lookalike Ticker Clone Detection
  // e.g. An unverified token uses $PEPE, $BONK, $WIF, $SHIB, $SOL ticker without matching the official contract
  if (symbol && ROBINHOOD_SUPPORTED_TICKERS.has(symbol)) {
    // Find what the real contract is
    const officialMatch = Object.values(ROBINHOOD_OFFICIAL_ASSETS).find(
      (a) => a.symbol === symbol
    );

    return {
      status: "TICKER_CLONE_WARNING",
      isListedOnRobinhood: false,
      isRobinhoodChain: false,
      tradingPair: null,
      assetType: "unlisted",
      summary: `UNVERIFIED LOOKALIKE: Token uses ticker $${symbol}, but does not match the official contract listed on Robinhood Crypto.`,
      warning: `LOOKALIKE WARNING: This token uses ticker $${symbol}, but its contract (${address}) does NOT match the official asset listed on Robinhood Crypto${
        officialMatch?.officialContract
          ? ` (Official: ${officialMatch.officialContract} on ${officialMatch.chain})`
          : ""
      }. Confirm you are not trading a spoofed honeypot.`,
      officialContract: officialMatch?.officialContract || null,
      officialChain: officialMatch?.chain || null,
      impostorRiskScore: 75,
      chainFamily,
      verifiedAt: now,
    };
  }

  // 5. Standard Unlisted Token
  return {
    status: "NOT_LISTED",
    isListedOnRobinhood: false,
    isRobinhoodChain: false,
    tradingPair: null,
    assetType: "unlisted",
    summary: "Standard unlisted asset. No conflicting Robinhood listing claims detected.",
    impostorRiskScore: 0,
    chainFamily,
    verifiedAt: now,
  };
}
