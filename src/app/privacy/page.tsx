import Link from "next/link";
import type { Metadata } from "next";
import { Shield, Lock, ArrowLeft, Download, ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy — SolShield Browser Guard & Protocol",
  description:
    "Dual-Lane Privacy Policy for SolShield Browser Guard (Chrome MV3 Extension) and sol-shield.xyz.",
  alternates: {
    canonical: "https://sol-shield.xyz/privacy",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#07090F] text-[#F1F5F9] px-5 sm:px-8 py-12 selection:bg-[#2934FF] selection:text-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-8 border-b border-white/10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[13px] font-mono uppercase tracking-[0.08em] text-[#93C5FD] hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to sol-shield.xyz</span>
          </Link>
          <span className="text-[12px] font-mono uppercase tracking-[0.08em] px-3 py-1 border border-white/15 text-slate-300">
            Last Updated: Nov 14, 2026
          </span>
        </div>

        <header className="mt-8 mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#2934FF]/15 border border-[#2934FF]/40 text-[#93C5FD] text-[11.5px] font-mono uppercase tracking-[0.08em] mb-4">
            <Shield className="w-3.5 h-3.5" />
            <span>Dual-Lane Privacy Architecture</span>
          </div>
          <h1 className="text-[32px] sm:text-[40px] font-medium tracking-[-0.03em] leading-[1.1]">
            SolShield® &amp; Browser Guard Privacy Policy
          </h1>
          <p className="mt-4 text-[16px] text-slate-300 leading-relaxed">
            SolShield is built to inspect Solana transactions before you sign
            without ever learning who you are, which sites you browse, or your
            wallet private keys.
          </p>
        </header>

        <div className="space-y-8 text-[15px] leading-relaxed text-slate-300">
          <section className="p-6 border border-white/12 bg-[#0B101B]">
            <h2 className="text-[18px] font-semibold text-white mb-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#2934FF]" />
              <span>1. What Data Never Leaves Your Browser</span>
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>No browsing history:</strong> Visiting regular web pages
                does not phone home. Domain checks trigger only on active wallet{" "}
                <code className="font-mono text-[#93C5FD]">connect</code>,{" "}
                <code className="font-mono text-[#93C5FD]">signIn</code>, or{" "}
                <code className="font-mono text-[#93C5FD]">sign*</code> prompts.
              </li>
              <li>
                <strong>No full URLs or tokens:</strong> Before any remote check
                leaves your device, query parameters, OAuth tokens, paths, ports,
                and fragments are stripped locally so only the normalized ASCII
                hostname is inspected.
              </li>
              <li>
                <strong>No private keys or seed phrases:</strong> SolShield wraps
                public provider signing boundaries without custody and never has
                access to private key material.
              </li>
              <li>
                <strong>Local verdict history:</strong> The Browser Guard popup
                stores only the latest 20 high-level verdict summaries locally in{" "}
                <code className="font-mono text-[#93C5FD]">
                  chrome.storage.local
                </code>
                , editable and clearable anytime.
              </li>
            </ul>
          </section>

          <section className="p-6 border border-white/12 bg-[#0B101B]">
            <h2 className="text-[18px] font-semibold text-white mb-3">
              2. Chrome Manifest V3 Permissions Explained
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <code className="font-mono text-[#93C5FD]">&lt;all_urls&gt;</code>{" "}
                (MAIN &amp; ISOLATED content scripts): Required solely to wrap{" "}
                <code className="font-mono text-[#93C5FD]">window.solana</code>,
                Phantom, Solflare, Backpack, Glow, and Wallet Standard providers
                before malicious dApps invoke a transaction signature prompt.
              </li>
              <li>
                <code className="font-mono text-[#93C5FD]">storage</code>: Stores
                your personal allow/block lists, network preference (Mainnet vs
                Devnet), strict mode flag, optional BYOK Venice key, and the last
                20 local verdicts on-device.
              </li>
              <li>
                <code className="font-mono text-[#93C5FD]">activeTab</code>: Reads
                the current tab&apos;s stripped hostname strictly when you click
                the extension popup icon to display Domain Guard status.
              </li>
            </ul>
          </section>

          <section className="p-6 border border-white/12 bg-[#0B101B]">
            <h2 className="text-[18px] font-semibold text-white mb-3">
              3. Dual-Lane Remote Verification &amp; Venice AI Zero-Retention
            </h2>
            <p className="mb-3">
              Offline bytecode decoding, typosquat Levenshtein checks, homoglyph
              folding, SIWS cross-domain checks, and batch analysis run 100%
              locally in your browser first in under 1 ms.
            </p>
            <p>
              When remote enrichment is enabled (default{" "}
              <code className="font-mono text-[#93C5FD]">
                https://sol-shield.xyz
              </code>
              , or self-hosted backend in Settings):
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>Domain Lane (</strong>
                <code className="font-mono text-[#93C5FD]">
                  POST /api/domain-reputation
                </code>
                <strong>):</strong> Receives only the bare ASCII hostname (when
                not already allowlisted).
              </li>
              <li>
                <strong>Transaction Simulation &amp; Audit Lane (</strong>
                <code className="font-mono text-[#93C5FD]">POST /api/audit</code>
                <strong>):</strong> Runs pre-sign Solana RPC simulation and
                sends sanitized instruction AST metadata to Venice AI (
                <code className="font-mono text-[#93C5FD]">
                  include_venice_system_prompt: false
                </code>
                ) for zero-retention risk explanation.
              </li>
            </ul>
          </section>

          <section className="p-6 border border-white/12 bg-[#0B101B]">
            <h2 className="text-[18px] font-semibold text-white mb-3">
              4. Source Transparency &amp; Contact
            </h2>
            <p className="mb-4">
              Every line of SolShield&apos;s parser, provider wrapper, and API is
              open-source MIT software.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/downloads/solshield-browser-guard-v0.3.0.zip"
                download
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2934FF] text-white text-[13px] font-mono uppercase tracking-[0.06em] hover:opacity-95 transition-opacity"
              >
                <Download className="w-4 h-4" />
                <span>Download MV3 Extension v0.3.0</span>
              </a>
              <a
                href="https://github.com/Blanksite/solshield/tree/main/extension"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 border border-white/25 text-[13px] font-mono uppercase tracking-[0.06em] hover:border-[#2934FF] transition-colors"
              >
                <span>Inspect Extension Source</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
