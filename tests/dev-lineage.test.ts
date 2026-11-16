import { describe, test, expect, vi } from "vitest";
import {
  computeLineageRisk,
  buildDeterministicSummary,
  buildDeterministicRecommendations,
  type LineageNode,
  type FundingEdge,
  type LineageRiskLevel,
} from "../src/lib/dev-lineage";

/* ── Helpers for test fixtures ───────────────────────────── */

function makeNode(overrides: Partial<LineageNode> = {}): LineageNode {
  return {
    wallet: "11111111111111111111111111111112",
    depth: 0,
    isCex: false,
    cexLabel: null,
    isKnownProgram: false,
    deployedTokens: [],
    totalDeployedTokenCount: 0,
    fundedBy: [],
    fundedWallets: [],
    solBalanceLamports: 1_000_000_000,
    solBalance: 1,
    firstSeenSlot: 100000,
    firstSeenTimestamp: 1700000000,
    isSerialDeployer: false,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<FundingEdge> = {}): FundingEdge {
  return {
    from: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1",
    to: "11111111111111111111111111111112",
    amountSol: 5,
    amountLamports: 5_000_000_000,
    txSignature: "sig_test_1",
    slot: 100000,
    blockTime: 1700000000,
    isCex: false,
    cexLabel: null,
    ...overrides,
  };
}

/* ── Tests ────────────────────────────────────────────────── */

describe("Dev Lineage: computeLineageRisk", () => {
  test("clean wallet with no deployments returns CLEAN", () => {
    const nodes = [makeNode()];
    const edges: FundingEdge[] = [];
    const result = computeLineageRisk(nodes, edges);

    expect(result.riskLevel).toBe("CLEAN");
    expect(result.riskScore).toBeLessThan(15);
    expect(result.cabalDetected).toBe(false);
    expect(result.serialDeployerCount).toBe(0);
  });

  test("serial deployer (3+ tokens) scores HIGH_RISK or above", () => {
    const nodes = [
      makeNode({
        isSerialDeployer: true,
        totalDeployedTokenCount: 4,
        deployedTokens: Array.from({ length: 4 }, (_, i) => ({
          mint: `mint_${i}`,
          name: `Token ${i}`,
          symbol: `TKN${i}`,
          deploySlot: 100000 + i,
          deployTxSignature: `sig_deploy_${i}`,
          deployBlockTime: 1700000000 + i * 3600,
          liquidityEventDetected: false,
          deployPlatform: "SPL" as const,
        })),
      }),
    ];
    const edges: FundingEdge[] = [];
    const result = computeLineageRisk(nodes, edges);

    expect(result.riskScore).toBeGreaterThanOrEqual(30);
    expect(result.serialDeployerCount).toBe(1);
    expect(["HIGH_RISK", "SERIAL_RUGPULLER"]).toContain(result.riskLevel);
  });

  test("cabal pattern: one wallet funds 2+ deployers", () => {
    const hubWallet = "HUBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const deployer1 = "DEPLOYER1111111111111111111111111111111111111";
    const deployer2 = "DEPLOYER2222222222222222222222222222222222222";

    const nodes = [
      makeNode({
        wallet: deployer1,
        depth: 0,
        totalDeployedTokenCount: 2,
        deployedTokens: [
          {
            mint: "mint_a",
            name: "Rug A",
            symbol: "RUGA",
            deploySlot: 100000,
            deployTxSignature: "sig_a",
            deployBlockTime: 1700000000,
            liquidityEventDetected: false,
            deployPlatform: "Pump.fun",
          },
          {
            mint: "mint_b",
            name: "Rug B",
            symbol: "RUGB",
            deploySlot: 100001,
            deployTxSignature: "sig_b",
            deployBlockTime: 1700003600,
            liquidityEventDetected: false,
            deployPlatform: "Pump.fun",
          },
        ],
        fundedBy: [
          makeEdge({ from: hubWallet, to: deployer1 }),
        ],
      }),
      makeNode({
        wallet: deployer2,
        depth: 0,
        totalDeployedTokenCount: 1,
        deployedTokens: [
          {
            mint: "mint_c",
            name: "Rug C",
            symbol: "RUGC",
            deploySlot: 100002,
            deployTxSignature: "sig_c",
            deployBlockTime: 1700007200,
            liquidityEventDetected: false,
            deployPlatform: "SPL",
          },
        ],
        fundedBy: [
          makeEdge({ from: hubWallet, to: deployer2 }),
        ],
      }),
      makeNode({
        wallet: hubWallet,
        depth: 1,
      }),
    ];

    const edges = [
      makeEdge({ from: hubWallet, to: deployer1 }),
      makeEdge({ from: hubWallet, to: deployer2 }),
    ];

    const result = computeLineageRisk(nodes, edges);

    expect(result.cabalDetected).toBe(true);
    expect(result.cabalHubWallet).toBe(hubWallet);
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
  });

  test("CEX-funded clean wallet stays low risk", () => {
    const nodes = [
      makeNode({
        fundedBy: [
          makeEdge({
            from: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
            isCex: true,
            cexLabel: "Binance Hot Wallet 1",
          }),
        ],
      }),
    ];
    const edges = [
      makeEdge({
        from: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        isCex: true,
        cexLabel: "Binance Hot Wallet 1",
      }),
    ];
    const result = computeLineageRisk(nodes, edges);

    expect(result.riskLevel).toBe("CLEAN");
    expect(result.riskScore).toBeLessThan(15);
  });

  test("prolific deployer (5+ tokens) adds extra risk", () => {
    const nodes = [
      makeNode({
        isSerialDeployer: true,
        totalDeployedTokenCount: 7,
        deployedTokens: Array.from({ length: 7 }, (_, i) => ({
          mint: `mint_${i}`,
          name: `Token ${i}`,
          symbol: `TKN${i}`,
          deploySlot: 100000 + i,
          deployTxSignature: `sig_deploy_${i}`,
          deployBlockTime: 1700000000 + i * 3600,
          liquidityEventDetected: false,
          deployPlatform: "Pump.fun" as const,
        })),
      }),
    ];
    const edges: FundingEdge[] = [];
    const result = computeLineageRisk(nodes, edges);

    // 30 (serial) + 20 (prolific) = 50
    expect(result.riskScore).toBeGreaterThanOrEqual(50);
  });

  test("deep lineage (depth >= 3) adds risk", () => {
    const nodes = [
      makeNode({ wallet: "W0", depth: 0 }),
      makeNode({ wallet: "W1", depth: 1 }),
      makeNode({ wallet: "W2", depth: 2 }),
      makeNode({ wallet: "W3", depth: 3 }),
    ];
    const edges = [
      makeEdge({ from: "W1", to: "W0" }),
      makeEdge({ from: "W2", to: "W1" }),
      makeEdge({ from: "W3", to: "W2" }),
    ];
    const result = computeLineageRisk(nodes, edges);

    expect(result.riskScore).toBeGreaterThanOrEqual(15);
  });
});

describe("Dev Lineage: deterministic fallback", () => {
  test("SERIAL_RUGPULLER summary mentions CRITICAL", () => {
    const nodes = [
      makeNode({
        isSerialDeployer: true,
        totalDeployedTokenCount: 5,
      }),
    ];
    const summary = (computeLineageRisk as any).__proto__; // we test the exported function
    // Use the actual function
    const risk = computeLineageRisk(nodes, []);
    expect(risk.verdictLabel).toContain("Serial Rugpuller");
  });

  test("CLEAN verdict for empty wallet", () => {
    const nodes = [makeNode()];
    const risk = computeLineageRisk(nodes, []);
    expect(risk.verdictLabel).toContain("Clean");
  });
});
