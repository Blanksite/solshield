import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolShield — Private Solana Transaction Firewall & Blinks Agent | Powered by Venice AI",
  description:
    "Non-custodial Solana transaction firewall, Blinks inspector, and Anchor policy vault using Venice AI to detect drainers and risky instructions privately before signing.",
  icons: {
    icon: "/shield-icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#080b11] text-slate-100 antialiased selection:bg-[#14F195]/20 selection:text-[#14F195]">
        {children}
      </body>
    </html>
  );
}
