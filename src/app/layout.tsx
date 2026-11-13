import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sol-shield.xyz"),
  title: "SolShield® — Non-Custodial Solana Transaction Firewall & Venice AI Guard",
  description:
    "Non-custodial Solana transaction firewall, Blinks inspector, and Anchor Policy PDA vault powered by zero-retention Venice AI to block wallet drainers before signing.",
  alternates: {
    canonical: "https://sol-shield.xyz",
  },
  icons: {
    icon: "/logo.png?v=2",
    shortcut: "/logo.png?v=2",
    apple: "/logo.png?v=2",
  },
  openGraph: {
    title: "SolShield® — Private Solana Transaction Firewall & Policy Vault",
    description:
      "Pre-sign bytecode firewall, Solana Blinks inspector, DeFi Intent Copilot & Anchor Policy PDA vault powered by zero-retention Venice AI.",
    url: "https://sol-shield.xyz",
    siteName: "SolShield Protocol",
    images: [
      {
        url: "/og-image.jpg?v=2",
        width: 1200,
        height: 630,
        alt: "SolShield® — Built in Venice Solana Transaction Firewall",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    creator: "@usesolshield",
    title: "SolShield® — Private Solana Transaction Firewall & Policy Vault",
    description:
      "Non-custodial Solana tx firewall, Blinks inspector & Anchor Policy PDA vault powered by zero-retention Venice AI.",
    images: ["/og-image.jpg?v=2"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased selection:bg-[#2934FF] selection:text-white">
        {children}
      </body>
    </html>
  );
}
