import { Metadata } from "next";
import DevLineagePanel from "@/components/dev-lineage/DevLineagePanel";

export const metadata: Metadata = {
  title:
    "SolShield® Dev Lineage & Cabal Tree — Rugpuller Wallet Forensics",
  description:
    "Trace the funding lineage of any Solana wallet to expose serial rugpullers, cabal treasuries, and suspicious deployer patterns. Powered by Venice AI zero-retention inference.",
};

export default function DevLineagePage() {
  return <DevLineagePanel />;
}
