import type { Metadata } from "next";
import WalletDetoxPanel from "@/components/wallet-detox/WalletDetoxPanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title:
    "SolShield® Wallet Detox — Zero-Retention SPL & Token-2022 Approval Auditor",
  description:
    "Audit any Solana wallet address in read-only mode (no wallet connect required) to uncover hidden SPL Token delegates, unlimited drainers, and Token-2022 PermanentDelegate or TransferHook traps with Venice AI Zero Data Retention.",
};

interface WalletDetoxPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WalletDetoxPage({
  searchParams,
}: WalletDetoxPageProps) {
  const resolved = searchParams ? await searchParams : undefined;
  const rawAddress = resolved?.address;
  const initialAddress =
    typeof rawAddress === "string"
      ? rawAddress.trim()
      : Array.isArray(rawAddress) && typeof rawAddress[0] === "string"
        ? rawAddress[0].trim()
        : "";

  return <WalletDetoxPanel initialAddress={initialAddress} />;
}
