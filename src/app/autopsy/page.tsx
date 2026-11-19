import type { Metadata } from "next";
import AutopsyWorkbench from "@/components/autopsy/AutopsyWorkbench";

export const metadata: Metadata = {
  title: "Rug Autopsy Generator | SolShield Forensic Attack Timeline",
  description:
    "Reconstruct chronological on-chain rug autopsies across Solana and 7 EVM chains with 1-click X breakdown threads and exportable PNG cards.",
};

export default function AutopsyPage() {
  return <AutopsyWorkbench />;
}
