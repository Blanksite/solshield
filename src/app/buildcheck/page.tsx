import type { Metadata } from "next";
import BuildCheckWorkbench from "@/components/buildcheck/BuildCheckWorkbench";

export const metadata: Metadata = {
  title: "SolShield® BuildCheck — Live Browser Agent & Venice AI Proof Auditor",
  description:
    "Paste any Solana token CA, X post, website, or GitHub repo. Watch a real Chromium browser verify code velocity, on-chain mint authorities, and domain age with Zero-Retention Venice AI.",
};

export default function BuildCheckPage() {
  return <BuildCheckWorkbench />;
}
