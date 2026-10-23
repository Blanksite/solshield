import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SolShield — Private Solana Transaction Firewall & Blinks Agent",
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
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen font-sans antialiased selection:bg-emerald-500/15 selection:text-emerald-700">
        {children}
      </body>
    </html>
  );
}
