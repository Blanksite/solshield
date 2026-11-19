import type { Metadata } from "next";
import AgentFirewallPanel from "@/components/agent-firewall/AgentFirewallPanel";

export const metadata: Metadata = {
  title: "SolShield MCP & AI Agent Firewall | Pre-Sign Security Bodyguard",
  description:
    "Connect autonomous AI trading agents to SolShield MCP to verify multi-chain contracts, block honeypots, and sanitize prompt-injected token metadata before signing.",
};

export default function AgentFirewallPage() {
  return <AgentFirewallPanel />;
}
