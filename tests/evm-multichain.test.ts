import { describe, expect, it, vi } from "vitest";
import {
  encodeErc20ApproveZero,
  encodePermit2Lockdown,
  inspectEvmContractSecurity,
  parseEvmBytecodeCapabilities,
  PERMIT2_SINGLETON,
  ZERO_EVM_ADDRESS,
} from "../src/lib/evm-security";
import {
  auditEvmWalletApprovals,
  buildEvmRevokeTransactions,
  evaluateEvmAllowanceRisk,
} from "../src/lib/evm-detox";
import { inspectEvmRpcRequest } from "../src/lib/evm-tx-parser";
import { buildExtensionVerdict } from "../src/lib/extension-verdict";
import {
  createFrozenEthereumProxy,
  wrapEthereumProvider,
} from "../extension/src/provider-wrapper";

describe("Multi-Chain EVM Security, Bytecode & Honeypot Simulator", () => {
  it("walks opcodes skipping PUSH32 literals (no false SELFDESTRUCT) while catching real admin selectors", () => {
    // PUSH32 containing 32 bytes of 0xff (must NOT trigger SELFDESTRUCT!)
    // followed by PUSH4 mint(address,uint256) (40c10f19) + PUSH4 pause() (8456cb59) + STOP (00)
    const cleanWithHashLiteral =
      "0x7f" +
      "ff".repeat(32) +
      "6340c10f19" +
      "638456cb59" +
      "00";

    const parsedClean = parseEvmBytecodeCapabilities(cleanWithHashLiteral);
    expect(parsedClean.hasSelfDestruct).toBe(false);
    expect(parsedClean.hasDelegatecall).toBe(false);
    expect(parsedClean.capabilities.mintable).toBe(true);
    expect(parsedClean.capabilities.pausable).toBe(true);
    expect(parsedClean.detectedSelectors).toContain("mint(address,uint256)");
    expect(parsedClean.detectedSelectors).toContain("pause()");

    // Real trailing SELFDESTRUCT opcode (0xff) outside PUSH payload + EIP-1167 minimal proxy
    const impl = "1111111111111111111111111111111111111111";
    const proxyBytes = `0x363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3ff`;
    const parsedProxy = parseEvmBytecodeCapabilities(proxyBytes);
    expect(parsedProxy.isEip1167MinimalProxy).toBe(true);
    expect(parsedProxy.minimalProxyTarget).toBe(`0x${impl}`);
    expect(parsedProxy.hasSelfDestruct).toBe(true);
    expect(parsedProxy.hasDelegatecall).toBe(true);
  });

  it("evaluates EIP-1967 proxies, Sourcify match, GoPlus honeypot & ownership cleanly", async () => {
    const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const implAddr = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("sourcify.dev")) {
        return new Response(JSON.stringify({ match: "match" }), { status: 200 });
      }
      if (url.includes("gopluslabs.io")) {
        return new Response(
          JSON.stringify({
            code: 1,
            result: {
              [token]: {
                is_honeypot: "1",
                buy_tax: "0.05",
                sell_tax: "0.99",
                is_open_source: "1",
                is_mintable: "1",
                holder_count: "420",
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("honeypot.is")) {
        return new Response(
          JSON.stringify({
            simulationSuccess: true,
            honeypotResult: {
              isHoneypot: true,
              honeypotReason: "Transfer reverted on sell route",
            },
            simulationResult: { buyTax: 5, sellTax: 99, transferTax: 0 },
            token: { totalHolders: 420 },
          }),
          { status: 200 }
        );
      }

      const rpcBody = JSON.parse(String(init?.body || "{}"));
      if (rpcBody.method === "eth_getCode") {
        // Proxy bytecode + PUSH4 blacklist
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x63f9f92be400" })
        );
      }
      if (rpcBody.method === "eth_getStorageAt") {
        const slot = rpcBody.params[1] as string;
        const val = slot.startsWith("0x3608")
          ? `0x000000000000000000000000${implAddr.slice(2)}`
          : `0x${"0".repeat(64)}`;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: val }));
      }
      if (rpcBody.method === "eth_call") {
        // Non-zero active owner
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc`,
          })
        );
      }
      return new Response("{}", { status: 404 });
    };

    const report = await inspectEvmContractSecurity(token, "base", {
      fetchImpl: mockFetch,
    });

    expect(report.isDeployed).toBe(true);
    expect(report.chainId).toBe(8453);
    expect(report.isProxy).toBe(true);
    expect(report.proxyType).toBe("EIP-1967");
    expect(report.implementationAddress).toBe(implAddr);
    expect(report.ownershipRenounced).toBe(false);
    expect(report.verifiedSource).toBe("sourcify-full");
    expect(report.honeypotStatus).toBe("HONEYPOT");
    expect(report.sellTaxPct).toBe(99);
    expect(report.holderCount).toBe(420);
    expect(report.capabilities.blacklistable).toBe(true);
    expect(report.capabilities.mintable).toBe(true);
    expect(report.verdict).toBe("CRITICAL");
    expect(report.riskScore).toBeGreaterThanOrEqual(90);
  });

  it("handles non-Ownable '0x' owner() result cleanly as null rather than renounced zero address", async () => {
    const token = "0xb934cabf87781f7eb13265de4cb2ce090d00c4e3";
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("sourcify.dev")) {
        return new Response(JSON.stringify({ match: null }), { status: 200 });
      }
      const rpcBody = JSON.parse(String(init?.body || "{}"));
      if (rpcBody.method === "eth_getCode") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x608060405200" }));
      }
      if (rpcBody.method === "eth_getStorageAt") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${"0".repeat(64)}` })
        );
      }
      if (rpcBody.method === "eth_call") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }));
      }
      return new Response("{}", { status: 404 });
    };

    const report = await inspectEvmContractSecurity(token, "robinhood", {
      fetchImpl: mockFetch,
    });

    expect(report.chainId).toBe(4663);
    expect(report.ownerAddress).toBeNull();
    expect(report.ownershipRenounced).toBeNull();
    expect(report.isProxy).toBe(false);
    expect(report.verdict).toBe("SAFE");
  });
});

describe("Multi-Chain EVM Wallet Detox & Permit2 Lockdown Builder", () => {
  it("encodes valid ERC-20 approve(0) and batched Permit2 lockdown calldata", () => {
    const spender = "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad";
    const approveZero = encodeErc20ApproveZero(spender);
    expect(approveZero.startsWith("0x095ea7b3")).toBe(true);
    expect(approveZero).toHaveLength(2 + 8 + 64 + 64);

    const lockdown = encodePermit2Lockdown([
      { token: "0xb934cabf87781f7eb13265de4cb2ce090d00c4e3", spender },
      { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender: "0x111111125421ca6dc452d289314280a0f8842a65" },
    ]);
    expect(lockdown.startsWith("0xcc53287f")).toBe(true);
    // selector (4B) + offset (32B) + length (32B) + 2 tuples * 2 addresses * 32B
    expect(lockdown).toHaveLength(2 + 8 + 64 + 64 + 2 * 2 * 64);
  });

  it("audits clean and risky EVM/Permit2 allowances and generates revoke specs", async () => {
    const owner = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const eoaAttacker = "0x9999999999999999999999999999999999999999";
    const token = "0xb934cabf87781f7eb13265de4cb2ce090d00c4e3";

    await expect(auditEvmWalletApprovals("not-hex")).rejects.toThrow(/Invalid EVM/i);

    const cleanReport = await auditEvmWalletApprovals(owner, {
      chain: "robinhood",
      loadEvmSnapshot: async () => ({
        blockNumber: 116720000,
        nativeBalanceWei: 2_000_000_000_000_000_000n,
        allowances: [],
        scannedTokens: [{ tokenAddress: token, symbol: "SURPLUS", name: "SURPLUS", decimals: 18, balanceUi: 500 }],
      }),
    });
    expect(cleanReport.chainId).toBe(4663);
    expect(cleanReport.healthScore).toBe(100);
    expect(cleanReport.classification).toBe("SAFE");

    const maxUint256 = (BigInt(1) << BigInt(256)) - 1n;
    const maxUint160 = (BigInt(1) << BigInt(160)) - 1n;
    const dirtyReport = await auditEvmWalletApprovals(owner, {
      chain: "robinhood",
      loadEvmSnapshot: async () => ({
        blockNumber: 116720000,
        nativeBalanceWei: 1_000_000_000_000_000_000n,
        allowances: [
          {
            kind: "erc20",
            tokenAddress: token,
            spenderAddress: eoaAttacker,
            allowanceRaw: maxUint256.toString(),
            decimals: 18,
            symbol: "SURPLUS",
            spenderIsContract: false,
            spenderTrusted: false,
          },
          {
            kind: "permit2",
            tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            spenderAddress: "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
            allowanceRaw: maxUint160.toString(),
            decimals: 6,
            symbol: "USDC",
            spenderLabel: "Uniswap Universal Router",
            spenderTrusted: true,
            spenderIsContract: true,
          },
        ],
      }),
    });

    expect(dirtyReport.classification).toBe("CRITICAL");
    expect(dirtyReport.eoaSpenderCount).toBe(1);
    expect(dirtyReport.permit2ApprovalCount).toBe(1);
    expect(dirtyReport.unlimitedApprovalCount).toBe(2);
    expect(dirtyReport.findings[0].flags).toContain("EOA_SPENDER_APPROVAL");

    const artifact = buildEvmRevokeTransactions({
      owner,
      chain: "robinhood",
      targets: dirtyReport.findings.map((f) => ({
        kind: f.kind,
        tokenAddress: f.tokenAddress,
        spenderAddress: f.spenderAddress,
      })),
    });
    expect(artifact.chainId).toBe(4663);
    expect(artifact.txCount).toBe(2);
    expect(artifact.transactions[0].to).toBe(token);
    expect(artifact.transactions[1].to).toBe(PERMIT2_SINGLETON);

    const riskSingle = evaluateEvmAllowanceRisk({
      kind: "permit2",
      tokenAddress: token,
      spenderAddress: ZERO_EVM_ADDRESS,
      allowanceRaw: "1000000",
      decimals: 6,
      spenderTrusted: true,
      spenderIsContract: true,
    });
    expect(riskSingle.isUnlimited).toBe(false);
    expect(riskSingle.flags).toContain("PERMIT2_ACTIVE_ALLOWANCE");
  });
});

describe("EVM Phishing & EIP-1193 Provider Interception", () => {
  it("blocks unlimited ERC-20 approve, Permit2 PermitBatch, Seaport zero-consideration drain & blind eth_sign", () => {
    const spender = "0xdead00000000000000000000000000000000beef";
    const approveData = `0x095ea7b3000000000000000000000000${spender.slice(2)}${"f".repeat(64)}`;

    const approveVerdict = buildExtensionVerdict({
      walletMethod: "eth_sendTransaction",
      hostname: "app.uniswap.org",
      evmRequest: {
        method: "eth_sendTransaction",
        chainId: "0x1",
        transactions: [{ to: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", data: approveData, value: "0x0" }],
      },
      remote: {
        attempted: true,
        verified: true,
        timedOutOrError: null,
        veniceAudit: null,
        rpcSimulation: null,
        domainReputation: null,
      },
    });
    expect(approveVerdict.decision).toBe("BLOCK");
    expect(approveVerdict.requiresTypedConfirmation).toBe(true);
    expect(approveVerdict.evmReport?.spenderDetected).toBe(spender);

    const seaportPayload = JSON.stringify({
      primaryType: "OrderComponents",
      domain: { name: "Seaport", verifyingContract: "0x00000000000000adc04c56bf30ac9d3c0aaf14dc" },
      message: {
        offerer: "0x1111111111111111111111111111111111111111",
        offer: [{ token: "0xabc" }],
        consideration: [{ recipient: spender }],
      },
    });
    const seaportAudit = inspectEvmRpcRequest({
      method: "eth_signTypedData_v4",
      typedDataJson: seaportPayload,
    });
    expect(seaportAudit.riskScore).toBe(95);
    expect(seaportAudit.flags[0].code).toBe("SEAPORT_ZERO_CONSIDERATION_DRAIN");

    const blindEthSign = inspectEvmRpcRequest({
      method: "eth_sign",
      messageHexOrText: `0x${"ab".repeat(32)}`,
    });
    expect(blindEthSign.riskScore).toBe(95);
    expect(blindEthSign.flags[0].code).toBe("ETH_SIGN_BLIND_HASH");

    const permit2Typed = inspectEvmRpcRequest({
      method: "eth_signTypedData_v4",
      typedDataJson: JSON.stringify({
        primaryType: "PermitSingle",
        domain: { name: "Permit2", verifyingContract: PERMIT2_SINGLETON },
        message: {
          spender,
          details: { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: ((1n << 160n) - 1n).toString() },
        },
      }),
    });
    expect(permit2Typed.riskScore).toBeGreaterThanOrEqual(80);
    expect(permit2Typed.flags[0].code).toBe("PERMIT2_OFFCHAIN_SIGNATURE");
  });

  it("wraps EIP-1193 and frozen Ethereum providers, passing read calls & rejecting blocked signing requests", async () => {
    const provider = {
      chainId: "0x1237",
      tag: "metamask-ctx",
      async request(payload: { method: string; params?: unknown[] }) {
        expect(this.tag).toBe("metamask-ctx");
        if (payload.method === "eth_chainId") return "0x1237";
        return "0xtxhash";
      },
    };

    const interceptSpy = vi.fn(async (req: { walletMethod: string }) => {
      if (req.walletMethod === "eth_sign") {
        return { allow: false, reason: "Blocked eth_sign blind hash" };
      }
      return { allow: true };
    });

    const wrapRes = wrapEthereumProvider(provider, "MetaMask", {
      interceptRequest: interceptSpy,
    });
    expect(wrapRes.status).toBe("WRAPPED");

    // Read-only RPC passes without interruption
    const chainId = await provider.request({ method: "eth_chainId" });
    expect(chainId).toBe("0x1237");
    expect(interceptSpy).toHaveBeenCalledTimes(0);

    // Unsafe eth_sign rejects with EIP-1193 code 4001
    await expect(
      provider.request({
        method: "eth_sign",
        params: ["0x1111111111111111111111111111111111111111", `0x${"12".repeat(32)}`],
      })
    ).rejects.toMatchObject({ code: 4001 });
    expect(interceptSpy).toHaveBeenCalledTimes(1);

    // Frozen provider proxy also enforces blocking
    const frozenRaw = Object.freeze({
      chainId: "0x1",
      async request(payload: { method: string }) {
        return payload.method;
      },
    });
    const wrappedFrozen = wrapEthereumProvider(frozenRaw, "FrozenRabby", {
      interceptRequest: interceptSpy,
    });
    expect(wrappedFrozen.status).toBe("LIMITED_FROZEN");

    const proxied = createFrozenEthereumProxy(frozenRaw, "FrozenRabby", {
      interceptRequest: interceptSpy,
    });
    await expect(
      proxied.request({ method: "eth_sign" })
    ).rejects.toMatchObject({ code: 4001 });
  });
});
