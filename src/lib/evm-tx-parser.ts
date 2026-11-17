/**
 * Deterministic EVM Transaction, EIP-712 TypedData, Permit / Permit2 & Seaport Parser
 *
 * Pure zero-dependency TypeScript parser safe for execution inside both Chrome MV3
 * Extension (content / service worker) and Next.js server API routes.
 */

import { isValidEvmAddress, normalizeEvmAddress, PERMIT2_SINGLETON } from "./evm-security";

export type EvmInterceptMethod =
  | "eth_sendTransaction"
  | "wallet_sendCalls"
  | "eth_signTypedData"
  | "eth_signTypedData_v3"
  | "eth_signTypedData_v4"
  | "personal_sign"
  | "eth_sign"
  | "eth_requestAccounts"
  | "wallet_requestPermissions";

export interface EvmTransactionObjectInput {
  from?: string;
  to?: string;
  value?: string;
  data?: string;
  chainId?: string | number;
}

export interface EvmRpcInspectionInput {
  method: EvmInterceptMethod;
  chainId?: string | number;
  transactions?: EvmTransactionObjectInput[];
  typedDataJson?: string;
  messageHexOrText?: string;
  fromAddress?: string;
}

export interface EvmThreatFlag {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  spender?: string;
  tokenContract?: string;
}

export interface EvmDecodedCallSummary {
  to: string | null;
  valueEth: number;
  selector: string | null;
  actionLabel: string;
  spender: string | null;
  isUnlimited: boolean;
}

export interface EvmDeterministicInspection {
  method: EvmInterceptMethod;
  chainIdHex: string | null;
  riskScore: number;
  decodedCalls: EvmDecodedCallSummary[];
  primaryType: string | null;
  verifyingContract: string | null;
  spenderDetected: string | null;
  flags: EvmThreatFlag[];
  reasons: string[];
  summary: string;
}

const UNLIMITED_UINT256_THRESHOLD = BigInt(1) << BigInt(250);
const UNLIMITED_UINT160_THRESHOLD = BigInt(1) << BigInt(155);

const KNOWN_EVM_SELECTORS: Record<string, string> = {
  "095ea7b3": "ERC-20 approve(spender, amount)",
  "39509351": "ERC-20 increaseAllowance(spender, addedValue)",
  a22cb465: "NFT setApprovalForAll(operator, approved)",
  d505accf: "EIP-2612 permit(owner, spender, value, ...)",
  "8fcbaf0c": "DAI-style permit(holder, spender, ...)",
  a9059cbb: "ERC-20 transfer(to, amount)",
  "23b872dd": "ERC-20 transferFrom(from, to, amount)",
  "42842e0e": "ERC-721 safeTransferFrom",
  f242432a: "ERC-1155 safeTransferFrom",
  "3593564c": "Uniswap UniversalRouter execute()",
  "04e45aaf": "Uniswap V3 exactInputSingle()",
};

const PHISHING_TEXT_PATTERNS = [
  /setApprovalForAll/i,
  /unlimited\s+allowance/i,
  /claim\s+(airdrop|reward|allocation|bonus)/i,
  /security\s+(update|migration|verify)/i,
  /authorize\s+(drain|withdrawal)/i,
  /seaport/i,
];

function decodeWordAddress(wordHex: string): string | null {
  if (!wordHex || wordHex.length < 64 || !/^[0-9a-fA-F]+$/.test(wordHex)) {
    return null;
  }
  return `0x${wordHex.slice(24, 64).toLowerCase()}`;
}

function decodeWordUint256(wordHex: string): bigint | null {
  if (!wordHex || wordHex.length < 64 || !/^[0-9a-fA-F]+$/.test(wordHex)) {
    return null;
  }
  try {
    return BigInt(`0x${wordHex.slice(0, 64)}`);
  } catch {
    return null;
  }
}

function decodeHexWeiToEth(hexOrNum?: string): number {
  if (!hexOrNum) return 0;
  try {
    const clean = hexOrNum.trim();
    const wei = clean.startsWith("0x") ? BigInt(clean) : BigInt(clean);
    if (wei <= 0n) return 0;
    return Number((Number(wei) / 1e18).toFixed(6));
  } catch {
    return 0;
  }
}

function decodePersonalSignText(raw: string): {
  text: string;
  looksLikeBlind32ByteHash: boolean;
} {
  const trimmed = raw.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return {
      text: trimmed,
      looksLikeBlind32ByteHash: true,
    };
  }
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    const hexBody = trimmed.slice(2);
    const bytes = new Uint8Array(Math.floor(hexBody.length / 2));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hexBody.slice(i * 2, i * 2 + 2), 16);
    }
    const decoded =
      typeof TextDecoder !== "undefined"
        ? new TextDecoder("utf-8", { fatal: false }).decode(bytes)
        : "";
    return {
      text: decoded || trimmed,
      looksLikeBlind32ByteHash: false,
    };
  }
  return {
    text: trimmed,
    looksLikeBlind32ByteHash: false,
  };
}

function inspectSingleEvmCall(
  tx: EvmTransactionObjectInput,
  index: number
): {
  summary: EvmDecodedCallSummary;
  flags: EvmThreatFlag[];
  riskScore: number;
} {
  const flags: EvmThreatFlag[] = [];
  let riskScore = 10;

  const toAddr =
    tx.to && isValidEvmAddress(tx.to) ? normalizeEvmAddress(tx.to) : null;
  const valueEth = decodeHexWeiToEth(tx.value);
  const rawData = (tx.data || "0x").trim().toLowerCase();
  const cleanData = rawData.startsWith("0x") ? rawData.slice(2) : rawData;

  if (cleanData.length === 0) {
    if (valueEth > 0) {
      riskScore = valueEth >= 1 ? 45 : 22;
      if (valueEth >= 0.5) {
        flags.push({
          code: "EVM_NATIVE_TRANSFER",
          severity: valueEth >= 5 ? "HIGH" : "MEDIUM",
          title: `Native Transfer (${valueEth} ETH/Native)`,
          description: `Sends ${valueEth} native gas token directly to ${toAddr || "recipient"} with empty calldata.`,
        });
      }
    }
    return {
      summary: {
        to: toAddr,
        valueEth,
        selector: null,
        actionLabel:
          valueEth > 0
            ? `Native Transfer (${valueEth} ETH)`
            : "Empty Transaction",
        spender: toAddr,
        isUnlimited: false,
      },
      flags,
      riskScore,
    };
  }

  const selector = cleanData.slice(0, 8);
  const argsHex = cleanData.slice(8);
  const knownAction = KNOWN_EVM_SELECTORS[selector];
  let spender: string | null = null;
  let isUnlimited = false;
  let actionLabel = knownAction || `Contract Call (0x${selector})`;

  if (selector === "095ea7b3" || selector === "39509351") {
    // approve(address spender, uint256 amount) / increaseAllowance
    spender = decodeWordAddress(argsHex.slice(0, 64));
    const amount = decodeWordUint256(argsHex.slice(64, 128));
    if (amount !== null && amount >= UNLIMITED_UINT256_THRESHOLD) {
      isUnlimited = true;
      riskScore = 82;
      flags.push({
        code: "UNLIMITED_ERC20_APPROVAL",
        severity: "CRITICAL",
        title: `Unlimited ERC-20 Token Approval (#${index + 1})`,
        description: `Grants ${spender || "unknown spender"} unlimited spending permission on token ${toAddr || "contract"}.`,
        spender: spender || undefined,
        tokenContract: toAddr || undefined,
      });
    } else if (amount === 0n && selector === "095ea7b3") {
      riskScore = 5;
      actionLabel = "ERC-20 Revoke approve(spender, 0)";
    } else {
      riskScore = 44;
      flags.push({
        code: "ERC20_APPROVAL_REQUEST",
        severity: "MEDIUM",
        title: `ERC-20 Allowance Request (#${index + 1})`,
        description: `Approves ${spender || "spender"} to transfer tokens from ${toAddr || "contract"}.`,
        spender: spender || undefined,
        tokenContract: toAddr || undefined,
      });
    }
  } else if (selector === "a22cb465") {
    // setApprovalForAll(address operator, bool approved)
    spender = decodeWordAddress(argsHex.slice(0, 64));
    const boolVal = decodeWordUint256(argsHex.slice(64, 128));
    if (boolVal !== null && boolVal > 0n) {
      isUnlimited = true;
      riskScore = 88;
      flags.push({
        code: "NFT_SET_APPROVAL_FOR_ALL",
        severity: "CRITICAL",
        title: `Full Collection setApprovalForAll(true) (#${index + 1})`,
        description: `Allows operator ${spender || "unknown"} to transfer ALL NFTs/ERC-1155 balances in ${toAddr || "collection"}.`,
        spender: spender || undefined,
        tokenContract: toAddr || undefined,
      });
    } else {
      actionLabel = "Revoke setApprovalForAll(false)";
    }
  } else if (selector === "d505accf" || selector === "8fcbaf0c") {
    spender = decodeWordAddress(argsHex.slice(64, 128));
    riskScore = 76;
    isUnlimited = true;
    flags.push({
      code: "ONCHAIN_PERMIT_EXECUTION",
      severity: "HIGH",
      title: `On-Chain Permit Submission (#${index + 1})`,
      description: `Submits token permit granting ${spender || "spender"} allowance on ${toAddr || "token"}.`,
      spender: spender || undefined,
      tokenContract: toAddr || undefined,
    });
  } else if (valueEth >= 2) {
    riskScore = 38;
  }

  return {
    summary: {
      to: toAddr,
      valueEth,
      selector: `0x${selector}`,
      actionLabel,
      spender,
      isUnlimited,
    },
    flags,
    riskScore,
  };
}

function inspectEip712TypedData(rawJson: string): {
  primaryType: string | null;
  verifyingContract: string | null;
  spenderDetected: string | null;
  flags: EvmThreatFlag[];
  riskScore: number;
  summary: string;
} {
  const flags: EvmThreatFlag[] = [];
  let riskScore = 18;

  let parsed: {
    primaryType?: string;
    domain?: {
      name?: string;
      chainId?: number | string;
      verifyingContract?: string;
    };
    message?: Record<string, unknown>;
  };

  try {
    parsed = JSON.parse(rawJson) as typeof parsed;
  } catch {
    return {
      primaryType: null,
      verifyingContract: null,
      spenderDetected: null,
      flags: [
        {
          code: "EIP712_MALFORMED_JSON",
          severity: "HIGH",
          title: "Unparseable EIP-712 TypedData Payload",
          description: "Signature payload could not be parsed as standard EIP-712 JSON.",
        },
      ],
      riskScore: 72,
      summary: "Malformed EIP-712 signature payload — inspect carefully before signing.",
    };
  }

  const primaryType =
    typeof parsed.primaryType === "string" ? parsed.primaryType : null;
  const verifyingContract =
    typeof parsed.domain?.verifyingContract === "string" &&
    isValidEvmAddress(parsed.domain.verifyingContract)
      ? normalizeEvmAddress(parsed.domain.verifyingContract)
      : null;
  const msg = parsed.message || {};

  const isPermit2Contract =
    verifyingContract === normalizeEvmAddress(PERMIT2_SINGLETON);

  let spenderDetected: string | null =
    typeof msg.spender === "string" && isValidEvmAddress(msg.spender)
      ? normalizeEvmAddress(msg.spender)
      : typeof msg.operator === "string" && isValidEvmAddress(msg.operator)
        ? normalizeEvmAddress(msg.operator)
        : null;

  // 1. Uniswap Permit2 signatures
  if (
    isPermit2Contract ||
    primaryType === "PermitSingle" ||
    primaryType === "PermitBatch" ||
    primaryType === "PermitTransferFrom" ||
    primaryType === "PermitWitnessTransferFrom"
  ) {
    const details = msg.details as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
    let hasUnlimited = false;
    let tokenContract: string | undefined;

    const inspectDetail = (d: Record<string, unknown>) => {
      if (typeof d.token === "string" && isValidEvmAddress(d.token)) {
        tokenContract = normalizeEvmAddress(d.token);
      }
      if (d.amount !== undefined) {
        try {
          if (BigInt(String(d.amount)) >= UNLIMITED_UINT160_THRESHOLD) {
            hasUnlimited = true;
          }
        } catch {
          // ignore
        }
      }
    };

    if (Array.isArray(details)) details.forEach(inspectDetail);
    else if (details && typeof details === "object") inspectDetail(details);

    riskScore = hasUnlimited || primaryType === "PermitBatch" ? 86 : 64;
    flags.push({
      code:
        primaryType === "PermitBatch"
          ? "PERMIT2_BATCH_SIGNATURE"
          : "PERMIT2_OFFCHAIN_SIGNATURE",
      severity: riskScore >= 75 ? "CRITICAL" : "HIGH",
      title: `Off-Chain Permit2 Signature (${primaryType || parsed.domain?.name || "Permit2"})`,
      description: `Allows spender ${spenderDetected || "unknown"} to pull tokens via Permit2 singleton${
        hasUnlimited ? " with MAX/unlimited allowance" : ""
      } without sending an on-chain approval TX.`,
      spender: spenderDetected || undefined,
      tokenContract,
    });
    return {
      primaryType,
      verifyingContract,
      spenderDetected,
      flags,
      riskScore,
      summary: `Permit2 ${primaryType || "signature"} granting ${
        spenderDetected || "spender"
      } token transfer rights.`,
    };
  }

  // 2. ERC-20 EIP-2612 Permit
  if (primaryType === "Permit") {
    let isUnlimited = false;
    try {
      const valStr = msg.value ?? msg.allowed;
      if (valStr === true) isUnlimited = true;
      else if (valStr !== undefined && BigInt(String(valStr)) >= UNLIMITED_UINT256_THRESHOLD) {
        isUnlimited = true;
      }
    } catch {
      // ignore
    }
    riskScore = isUnlimited ? 84 : 62;
    flags.push({
      code: "EIP2612_PERMIT_SIGNATURE",
      severity: isUnlimited ? "CRITICAL" : "HIGH",
      title: `Gasless ERC-20 Permit Signature${isUnlimited ? " (UNLIMITED)" : ""}`,
      description: `Off-chain Permit signature authorizes ${spenderDetected || "spender"} on token ${
        verifyingContract || parsed.domain?.name || "contract"
      }.`,
      spender: spenderDetected || undefined,
      tokenContract: verifyingContract || undefined,
    });
    return {
      primaryType,
      verifyingContract,
      spenderDetected,
      flags,
      riskScore,
      summary: `EIP-2612 gasless Permit authorizing ${spenderDetected || "spender"}.`,
    };
  }

  // 3. Seaport / Blur NFT Marketplace zero-consideration drain signatures
  if (
    primaryType === "OrderComponents" ||
    primaryType === "BulkOrder" ||
    (parsed.domain?.name || "").toLowerCase().includes("seaport")
  ) {
    const offer = Array.isArray(msg.offer) ? msg.offer : [];
    const consideration = Array.isArray(msg.consideration) ? msg.consideration : [];
    const offerer =
      typeof msg.offerer === "string" && isValidEvmAddress(msg.offerer)
        ? normalizeEvmAddress(msg.offerer)
        : null;
    const recipientMatchesOfferer =
      offerer &&
      consideration.some(
        (c) =>
          c &&
          typeof c === "object" &&
          typeof (c as { recipient?: unknown }).recipient === "string" &&
          normalizeEvmAddress((c as { recipient: string }).recipient) === offerer
      );

    if (offer.length > 0 && (consideration.length === 0 || (offerer && !recipientMatchesOfferer))) {
      riskScore = 95;
      flags.push({
        code: "SEAPORT_ZERO_CONSIDERATION_DRAIN",
        severity: "CRITICAL",
        title: "Seaport Phishing Order Drain Detected",
        description:
          "Marketplace order lists valuable offer items with zero/redirected consideration back to your wallet.",
      });
      return {
        primaryType,
        verifyingContract,
        spenderDetected,
        flags,
        riskScore,
        summary: "CRITICAL: Seaport order drains offered assets with no payment back to offerer.",
      };
    }

    riskScore = 42;
    flags.push({
      code: "SEAPORT_ORDER_SIGNATURE",
      severity: "MEDIUM",
      title: `NFT Marketplace Signature (${primaryType || "Order"})`,
      description: "Verify offer tokens and receiving consideration amounts before signing.",
    });
  }

  return {
    primaryType,
    verifyingContract,
    spenderDetected,
    flags,
    riskScore,
    summary: `EIP-712 TypedData signature (${primaryType || parsed.domain?.name || "Unknown"}) on ${
      verifyingContract || "off-chain domain"
    }.`,
  };
}

/**
 * Deterministically inspects any EVM JSON-RPC wallet request payload before user approval.
 */
export function inspectEvmRpcRequest(
  input: EvmRpcInspectionInput
): EvmDeterministicInspection {
  const chainIdHex =
    typeof input.chainId === "number"
      ? `0x${input.chainId.toString(16)}`
      : typeof input.chainId === "string" && input.chainId.trim()
        ? input.chainId.trim()
        : null;

  if (input.method === "eth_sign") {
    return {
      method: "eth_sign",
      chainIdHex,
      riskScore: 95,
      decodedCalls: [],
      primaryType: null,
      verifyingContract: null,
      spenderDetected: null,
      flags: [
        {
          code: "ETH_SIGN_BLIND_HASH",
          severity: "CRITICAL",
          title: "Legacy Blind eth_sign Hash Request",
          description:
            "eth_sign signs raw opaque 32-byte hashes that can authorize arbitrary transactions or drainers. Almost never used by legitimate modern dApps.",
        },
      ],
      reasons: [
        "[CRITICAL] eth_sign blind hash request detected — classic EVM wallet drainer vector.",
      ],
      summary: "CRITICAL: Legacy eth_sign blind signature blocked.",
    };
  }

  if (input.method === "personal_sign") {
    const rawMsg = input.messageHexOrText || "";
    const decoded = decodePersonalSignText(rawMsg);
    const flags: EvmThreatFlag[] = [];
    let riskScore = 12;

    if (decoded.looksLikeBlind32ByteHash) {
      riskScore = 78;
      flags.push({
        code: "PERSONAL_SIGN_BLIND_HASH",
        severity: "HIGH",
        title: "Opaque 32-Byte Blind Hash in personal_sign",
        description:
          "dApp asked personal_sign to sign a raw 32-byte hex hash instead of readable login text.",
      });
    } else {
      for (const pat of PHISHING_TEXT_PATTERNS) {
        if (pat.test(decoded.text)) {
          riskScore = 52;
          flags.push({
            code: "PHISHING_MESSAGE_WORDING",
            severity: "MEDIUM",
            title: `Suspicious Prompt Wording (${pat.source})`,
            description: "Signed message text resembles common airdrop/approval lure wording.",
          });
          break;
        }
      }
    }

    return {
      method: "personal_sign",
      chainIdHex,
      riskScore,
      decodedCalls: [],
      primaryType: null,
      verifyingContract: null,
      spenderDetected: null,
      flags,
      reasons: flags.map((f) => `[${f.severity}] ${f.title}: ${f.description}`),
      summary:
        flags.length > 0
          ? flags[0].title
          : `Readable personal_sign message (${decoded.text.slice(0, 64)}).`,
    };
  }

  if (
    input.method === "eth_signTypedData" ||
    input.method === "eth_signTypedData_v3" ||
    input.method === "eth_signTypedData_v4"
  ) {
    const typed = inspectEip712TypedData(input.typedDataJson || "{}");
    return {
      method: input.method,
      chainIdHex,
      riskScore: typed.riskScore,
      decodedCalls: [],
      primaryType: typed.primaryType,
      verifyingContract: typed.verifyingContract,
      spenderDetected: typed.spenderDetected,
      flags: typed.flags,
      reasons: typed.flags.map((f) => `[${f.severity}] ${f.title}: ${f.description}`),
      summary: typed.summary,
    };
  }

  if (
    input.method === "eth_requestAccounts" ||
    input.method === "wallet_requestPermissions"
  ) {
    return {
      method: input.method,
      chainIdHex,
      riskScore: 10,
      decodedCalls: [],
      primaryType: null,
      verifyingContract: null,
      spenderDetected: null,
      flags: [],
      reasons: [],
      summary: "EVM wallet connection request.",
    };
  }

  // eth_sendTransaction or wallet_sendCalls
  const txs = input.transactions ?? [];
  const decodedCalls: EvmDecodedCallSummary[] = [];
  const flags: EvmThreatFlag[] = [];
  let maxScore = 10;

  for (let i = 0; i < txs.length; i++) {
    const res = inspectSingleEvmCall(txs[i], i);
    decodedCalls.push(res.summary);
    flags.push(...res.flags);
    maxScore = Math.max(maxScore, res.riskScore);
  }

  if (input.method === "wallet_sendCalls" && txs.length >= 4) {
    maxScore = Math.max(maxScore, 62);
    flags.push({
      code: "EVM_BATCH_CALLS_LARGE",
      severity: "HIGH",
      title: `Large EIP-5792 Batch (${txs.length} calls)`,
      description: `dApp requested bundling ${txs.length} smart account calls at once.`,
    });
  }

  const firstSpender =
    decodedCalls.find((c) => Boolean(c.spender))?.spender || null;
  const firstTo = decodedCalls[0]?.to || null;

  return {
    method: input.method,
    chainIdHex,
    riskScore: maxScore,
    decodedCalls,
    primaryType: null,
    verifyingContract: firstTo,
    spenderDetected: firstSpender,
    flags,
    reasons: flags.map((f) => `[${f.severity}] ${f.title}: ${f.description}`),
    summary:
      decodedCalls[0]?.actionLabel ||
      `EVM transaction request (${txs.length} call(s))`,
  };
}
