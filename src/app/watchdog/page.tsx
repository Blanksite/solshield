import type { Metadata } from "next";
import WatchdogDashboard from "@/components/watchdog/WatchdogDashboard";

export const metadata: Metadata = {
  title: "Proof-of-Ship Watchdog | SolShield Post-Launch Rug Monitor",
  description:
    "Monitor projects continuously across 3 layers: EVM/Solana bytecode & LP mutations, live website status, and GitHub proof-of-ship activity.",
};

export default function WatchdogPage() {
  return <WatchdogDashboard />;
}
