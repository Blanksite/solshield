import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolShield® — Adaptive AI Guard for Solana",
  description:
    "Continuous Solana payload simulation, DeFi Intent Copilot, Blinks Inspector, and Anchor Policy PDA Vault powered by zero-retention Venice AI.",
  icons: {
    icon: "/logo.jpg",
    shortcut: "/logo.jpg",
    apple: "/logo.jpg",
  },
  openGraph: {
    title: "SolShield® — Adaptive AI Guard",
    description:
      "Continuous Solana transaction payload and behavior audit by private Venice AI.",
    images: ["/og-image.jpg"],
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
