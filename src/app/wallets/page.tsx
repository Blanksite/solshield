import type { Metadata } from "next";
import WalletTrackerPanel from "@/components/wallets/WalletTrackerPanel";

export const metadata: Metadata = {
  title: "Wallets to Watch | SolShield Multi-Chain Wallet Tracker",
  description:
    "Track possible MM wallets, early buyers, devs, and top holders across Solana, Ethereum, Base, and Robinhood Chain L2.",
};

export default function WalletsPage() {
  return <WalletTrackerPanel />;
}
