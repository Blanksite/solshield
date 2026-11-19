"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  Cpu,
  Eye,
  FileWarning,
  GitBranch,
  Globe,
  Key,
  Lock,
  Menu,
  Moon,
  Radar,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Wallet,
  X,
} from "lucide-react";

export interface SolShieldNavbarProps {
  lang: "en" | "id";
  onToggleLang: () => void;
  darkMode: boolean;
  onToggleTheme: () => void;
  connectedWallet: string;
  isRealWalletConnected: boolean;
  onConnectWallet: () => void;
  walletNotice: string | null;
  onOpenKeyModal: () => void;
  onOpenTxFirewall: () => void;
  onOpenTokenAudit: () => void;
  onOpenVault: () => void;
  onOpenBlinks: () => void;
}

function VeniceMark({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.295 16.074a4.239 4.239 0 00-1.37-.685 4.255 4.255 0 00-1.636-.138 4.27 4.27 0 00-1.566.499c-.472.26-.875.602-1.19.973-.315.37-.59.824-.773 1.336a4.432 4.432 0 00-.257 1.644c.02.564.155 1.125.375 1.621s.528.93.87 1.275c.34.346.766.657 1.256.881.49.224 1.041.36 1.598.381a4.258 4.258 0 001.62-.26 4.25 4.25 0 001.318-.786c.365-.319.703-.728.959-1.206.256-.479.43-1.027.492-1.589a4.436 4.436 0 00-.137-1.659 4.346 4.346 0 00-.675-1.39l.95-.964.691.702h.393l.475-.481v-.399l-.692-.702L12 14.11l1.004 1.018-.691.702v.399l.474.48h.393l.691-.701.95.964a4.346 4.346 0 00-.675 1.39 4.435 4.435 0 00-.137 1.66c.062.56.236 1.11.492 1.588s.594.887.96 1.206c.364.32.812.599 1.316.785a4.258 4.258 0 001.621.261 4.262 4.262 0 001.598-.38c.49-.225.916-.536 1.257-.882.341-.346.648-.779.869-1.275.22-.496.355-1.057.375-1.62a4.433 4.433 0 00-.257-1.645 4.338 4.338 0 00-.774-1.336 4.272 4.272 0 00-1.189-.973 4.27 4.27 0 00-1.566-.5 4.255 4.255 0 00-1.635.14 4.239 4.239 0 00-1.37.684l-.933-.947.69-.702v-.398l-.49-.498h-.393l-.692.701-1.004-1.018L18.15 7.87l2.132 2.163v-2.25H22.5L20.368 5.62 22.5 3.457V3.06l-.491-.498h-.393L12 12.316 2.384 2.56H1.99l-.491.498v.398L3.632 5.62 1.5 7.782h2.218v2.25L5.85 7.87l5.266 5.342-1.004 1.018-.692-.701h-.393l-.49.498v.399l.69.7-.932.948zm8.546 4.95a1.59 1.59 0 00.107 1.49c.256.43.799.73 1.294.716.494.014 1.037-.287 1.293-.716a1.59 1.59 0 00.108-1.49l.054-.06a1.53 1.53 0 001.471-.107c.424-.26.72-.81.707-1.313.014-.502-.283-1.053-.707-1.313a1.53 1.53 0 00-1.471-.107l-.054-.059a1.59 1.59 0 00-.108-1.49c-.256-.43-.799-.73-1.293-.717-.495-.013-1.038.287-1.294.716a1.59 1.59 0 00-.107 1.491l-.054.059a1.53 1.53 0 00-1.472.107c-.424.26-.72.81-.707 1.313-.013.502.283 1.053.707 1.313a1.53 1.53 0 001.472.107l.054.06zm-9.79 1.49a1.59 1.59 0 00.108-1.49l.054-.06a1.53 1.53 0 001.471-.107c.424-.26.72-.81.707-1.313.014-.502-.283-1.053-.707-1.313a1.53 1.53 0 00-1.47-.107l-.055-.059a1.59 1.59 0 00-.107-1.49c-.257-.43-.8-.73-1.294-.717-.495-.013-1.037.287-1.294.716a1.59 1.59 0 00-.107 1.491l-.054.059a1.53 1.53 0 00-1.471.107c-.424.26-.72.81-.707 1.313-.014.502.283 1.053.707 1.313a1.53 1.53 0 001.471.107l.054.06a1.59 1.59 0 00.107 1.49c.257.43.8.73 1.294.716.495.014 1.037-.287 1.294-.716z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.274 2.56L14.8 0l1.25 1.268v4.274l-3.462 3.512h-.625L8.5 5.542V1.268L9.75 0l2.524 2.56zM9.75.898l2.212 2.243v4.12L9.75 5.018V.897zm2.837 2.243L14.799.897v4.12l-2.212 2.244V3.14z"
      />
    </svg>
  );
}

interface MegaMenuItem {
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  external?: boolean;
  onClick?: () => void;
}

interface MegaMenuColumn {
  heading: string;
  items: MegaMenuItem[];
}

export default function SolShieldNavbar({
  lang,
  onToggleLang,
  darkMode,
  onToggleTheme,
  connectedWallet,
  isRealWalletConnected,
  onConnectWallet,
  walletNotice,
  onOpenKeyModal,
  onOpenTxFirewall,
  onOpenTokenAudit,
  onOpenVault,
  onOpenBlinks,
}: SolShieldNavbarProps) {
  const [productsOpen, setProductsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openedByHoverAtRef = useRef<number>(0);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openMenuByHover = () => {
    clearCloseTimer();
    if (!productsOpen) {
      openedByHoverAtRef.current = Date.now();
    }
    setProductsOpen(true);
  };

  const handleProductsClick = () => {
    clearCloseTimer();
    if (productsOpen && Date.now() - openedByHoverAtRef.current < 300) {
      // User moved pointer onto button and clicked immediately: keep it open
      return;
    }
    setProductsOpen((prev) => !prev);
  };

  const scheduleCloseMenu = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setProductsOpen(false);
    }, 160);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProductsOpen(false);
        setMobileOpen(false);
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setProductsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      clearCloseTimer();
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  const closeAll = () => {
    clearCloseTimer();
    setProductsOpen(false);
    setMobileOpen(false);
  };

  const columns: MegaMenuColumn[] = [
    {
      heading: lang === "en" ? "Forensics" : "Forensik",
      items: [
        {
          label: "BuildCheck",
          desc:
            lang === "en"
              ? "Token, live site, repo & Claims vs Receipts"
              : "Audit token, situs live, repo & bukti klaim",
          icon: ShieldCheck,
          href: "/buildcheck",
        },
        {
          label: "Dev Lineage",
          desc:
            lang === "en"
              ? "Serial deployer & rugger cluster graph"
              : "Grafik riwayat deployer & pola serial rug",
          icon: GitBranch,
          href: "/dev-lineage",
        },
        {
          label: "Rug Autopsy",
          desc:
            lang === "en"
              ? "1-click forensic timeline & X card"
              : "Kronologi forensik 1-klik & kartu X",
          icon: FileWarning,
          href: "/autopsy",
        },
        {
          label: lang === "en" ? "Token Audit" : "Cek Token",
          desc:
            lang === "en"
              ? "Live SPL & Token-2022 mint scanner"
              : "Pemindai mint SPL & Token-2022 live",
          icon: ScanSearch,
          onClick: () => {
            closeAll();
            onOpenTokenAudit();
          },
        },
      ],
    },
    {
      heading: lang === "en" ? "Wallet Protection" : "Proteksi Wallet",
      items: [
        {
          label: lang === "en" ? "Tx Firewall" : "Firewall Tx",
          desc:
            lang === "en"
              ? "Pre-sign Legacy & V0 bytecode sandbox"
              : "Sandbox bytecode pra-sign Legacy & V0",
          icon: ShieldAlert,
          onClick: () => {
            closeAll();
            onOpenTxFirewall();
          },
        },
        {
          label: "Wallet Detox",
          desc:
            lang === "en"
              ? "Revoke risky SPL & EVM/Permit2 approvals"
              : "Cabut approval SPL & EVM/Permit2 berisiko",
          icon: Wallet,
          href: "/wallet-detox",
        },
        {
          label: "Wallets to Watch",
          desc:
            lang === "en"
              ? "Live MM & early buyer radar"
              : "Pantau pergerakan MM & early buyer",
          icon: Eye,
          href: "/wallets",
        },
        {
          label: lang === "en" ? "Vault & Blinks" : "Vault & Blinks",
          desc:
            lang === "en"
              ? "Anchor PDA caps & guarded Blinks"
              : "Batas spend Anchor PDA & Blinks aman",
          icon: Lock,
          onClick: () => {
            closeAll();
            onOpenVault();
          },
        },
      ],
    },
    {
      heading: lang === "en" ? "Autonomous Defense" : "Pertahanan Otonom",
      items: [
        {
          label: "Proof-of-Ship Watchdog",
          desc:
            lang === "en"
              ? "3-layer post-launch mutation alerts"
              : "Alert mutasi 3-layer pasca-launch",
          icon: Radar,
          href: "/watchdog",
        },
        {
          label: "Agent MCP Firewall",
          desc:
            lang === "en"
              ? "Read-only bodyguard for AI trading agents"
              : "Bodyguard read-only untuk AI trading agent",
          icon: Cpu,
          href: "/agent-firewall",
        },
        {
          label: "Browser Guard",
          desc:
            lang === "en"
              ? "Chrome MV3 pre-sign extension"
              : "Ekstensi Chrome MV3 pra-sign",
          icon: Globe,
          href: "#browser-guard",
          onClick: () => {
            closeAll();
            const el = document.getElementById("browser-guard");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          },
        },
        {
          label: lang === "en" ? "Blinks Studio" : "Studio Blinks",
          desc:
            lang === "en"
              ? "Shareable /api/actions/audit-swap links"
              : "Link Solana Actions /api/actions/audit-swap",
          icon: Bot,
          onClick: () => {
            closeAll();
            onOpenBlinks();
          },
        },
      ],
    },
  ];

  const navLinkCls = darkMode
    ? "text-[#A8B0BC] hover:text-white hover:bg-white/[0.06]"
    : "text-[#47474F] hover:text-[#0A0A0C] hover:bg-black/[0.05]";

  const controlBtnCls = darkMode
    ? "border-white/15 bg-white/[0.02] text-[#E4E7EE] hover:border-[#2934FF] hover:text-white"
    : "border-black/15 bg-black/[0.02] text-[#141413] hover:border-[#2934FF] hover:text-[#0A0A0C]";

  return (
    <header
      className={`sticky top-0 z-[60] w-full border-b backdrop-blur-xl transition-colors ${
        darkMode
          ? "bg-[#0A0A0C]/90 border-white/15 text-[#F8F8FA]"
          : "bg-[#F3F3F6]/90 border-black/15 text-[#0A0A0C]"
      }`}
    >
      <div className="w-full px-5 sm:px-8 xl:px-12 h-16 flex items-center justify-between gap-4">
        {/* LEFT: Brand Mark + Built in Venice Pill */}
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="inline-flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] rounded-lg"
          >
            <div className="relative">
              <img
                src="/logo.jpg"
                alt="SolShield Logo"
                className="w-8 h-8 rounded-lg object-cover shrink-0 border border-white/20 shadow-sm group-hover:scale-105 transition-transform"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-[#0A0A0C]" />
            </div>
            <span className="text-[19px] font-semibold tracking-[-0.03em]">
              SolShield
              <sup className="text-[10px] font-normal ml-0.5 opacity-70">®</sup>
            </span>
          </a>

          <a
            href="https://github.com/veniceai/builtinvenice/pull/194"
            target="_blank"
            rel="noreferrer"
            title="Official Built in Venice Directory"
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.07em] border transition-colors whitespace-nowrap ${
              darkMode
                ? "bg-white/[0.03] border-white/15 text-white/80 hover:border-[#E05A2D]/60 hover:text-white"
                : "bg-black/[0.03] border-black/15 text-black/80 hover:border-[#E05A2D]/70 hover:text-black"
            }`}
          >
            <VeniceMark className="w-3.5 h-3.5 text-[#E05A2D] shrink-0" />
            <span>
              Built in <strong className="text-[#E05A2D] font-semibold">Venice</strong>
            </span>
          </a>
        </div>

        {/* CENTER: Single-Row 4-Item Monochrome Navigation (Desktop) */}
        <nav
          aria-label="Primary navigation"
          className="hidden lg:flex items-center gap-1"
        >
          {/* 1. Products Mega-Menu Trigger */}
          <div
            ref={dropdownRef}
            className="static"
            onMouseEnter={openMenuByHover}
            onMouseLeave={scheduleCloseMenu}
          >
            <button
              type="button"
              aria-expanded={productsOpen}
              aria-haspopup="menu"
              onClick={handleProductsClick}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[14px] font-medium tracking-[-0.01em] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${
                productsOpen
                  ? darkMode
                    ? "bg-white/[0.08] text-white"
                    : "bg-black/[0.07] text-[#0A0A0C]"
                  : navLinkCls
              }`}
            >
              <span>{lang === "en" ? "Products" : "Produk"}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  productsOpen ? "rotate-180 opacity-100" : "opacity-65"
                }`}
              />
            </button>

            {/* Smoked-Glass 3-Column Mega-Menu (Centered cleanly below header) */}
            {productsOpen && (
              <div
                role="menu"
                className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50 w-[740px] max-w-[calc(100vw-2rem)]"
              >
                <div
                  className={`relative rounded-2xl border overflow-hidden ${
                    darkMode
                      ? "bg-[#0B0E16] border-white/15 text-[#F4F6FA] shadow-[0_32px_80px_rgba(0,0,0,0.88)]"
                      : "bg-[#FFFFFF] border-black/15 text-[#141413] shadow-[0_24px_64px_rgba(10,10,12,0.18)]"
                  }`}
                >
                  {/* Subtle top specular cobalt-silver highlight */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2934FF]/70 to-transparent" />

                  <div className="grid grid-cols-3 gap-5 p-5">
                    {columns.map((col) => (
                      <div key={col.heading} className="min-w-0">
                        <div className="px-2.5 pb-2 text-[10.5px] font-mono font-semibold uppercase tracking-[0.12em] opacity-50">
                          {col.heading}
                        </div>
                        <div className="space-y-0.5">
                          {col.items.map((item) => {
                            const Icon = item.icon;
                            const itemCls = `w-full text-left flex items-start gap-3 px-2.5 py-2.5 rounded-xl transition-colors cursor-pointer group ${
                              darkMode
                                ? "hover:bg-white/[0.06]"
                                : "hover:bg-black/[0.04]"
                            }`;

                            const inner = (
                              <>
                                <span
                                  className={`mt-0.5 p-1.5 rounded-lg border shrink-0 transition-colors ${
                                    darkMode
                                      ? "border-white/10 bg-white/[0.03] text-[#9EA8BA] group-hover:border-[#2934FF]/50 group-hover:text-white"
                                      : "border-black/10 bg-black/[0.02] text-[#47474F] group-hover:border-[#2934FF]/50 group-hover:text-[#2934FF]"
                                  }`}
                                >
                                  <Icon className="w-3.5 h-3.5" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-[13.5px] font-medium leading-tight tracking-[-0.01em]">
                                    {item.label}
                                  </span>
                                  <span className="block mt-0.5 text-[11.5px] leading-snug opacity-60">
                                    {item.desc}
                                  </span>
                                </span>
                              </>
                            );

                            if (item.onClick) {
                              return (
                                <button
                                  key={item.label}
                                  type="button"
                                  role="menuitem"
                                  onClick={item.onClick}
                                  className={itemCls}
                                >
                                  {inner}
                                </button>
                              );
                            }

                            if (item.external && item.href) {
                              return (
                                <a
                                  key={item.label}
                                  role="menuitem"
                                  href={item.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={closeAll}
                                  className={itemCls}
                                >
                                  {inner}
                                </a>
                              );
                            }

                            return (
                              <Link
                                key={item.label}
                                role="menuitem"
                                href={item.href || "/"}
                                onClick={closeAll}
                                className={itemCls}
                              >
                                {inner}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mega-Menu Bottom Bar */}
                  <div
                    className={`px-6 py-3 border-t flex items-center justify-between gap-4 text-[11.5px] font-mono ${
                      darkMode
                        ? "border-white/10 bg-white/[0.02] text-[#8E98AD]"
                        : "border-black/10 bg-black/[0.02] text-[#575653]"
                    }`}
                  >
                    <span>
                      8 Chains · Non-Custodial · Zero-Retention Venice AI
                    </span>
                    <div className="flex items-center gap-4 shrink-0">
                      <a
                        href="https://t.me/UseSolShieldBot"
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-[#2934FF] transition-colors inline-flex items-center gap-1"
                      >
                        <span>TG Bot</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                      <Link
                        href="/agent-firewall"
                        onClick={closeAll}
                        className="text-[#2934FF] hover:underline font-medium inline-flex items-center gap-1"
                      >
                        <span>MCP /api/mcp</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. BuildCheck */}
          <Link
            href="/buildcheck"
            className={`px-3.5 py-2 rounded-lg text-[14px] font-medium tracking-[-0.01em] transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${navLinkCls}`}
          >
            BuildCheck
          </Link>

          {/* 3. Agent MCP */}
          <Link
            href="/agent-firewall"
            className={`px-3.5 py-2 rounded-lg text-[14px] font-medium tracking-[-0.01em] transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${navLinkCls}`}
          >
            Agent MCP
          </Link>

          {/* 4. GitHub */}
          <a
            href="https://github.com/Blanksite/solshield"
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1 px-3.5 py-2 rounded-lg text-[14px] font-medium tracking-[-0.01em] transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${navLinkCls}`}
          >
            <span>GitHub</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-60" />
          </a>
        </nav>

        {/* RIGHT: Clean Utility Controls + Primary CTA + Mobile Hamburger */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Connect Wallet */}
          <button
            type="button"
            onClick={onConnectWallet}
            title="Connect Phantom / Solflare (Read-Only)"
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${controlBtnCls}`}
          >
            <Wallet className="w-3.5 h-3.5 text-[#2934FF] shrink-0" />
            <span>
              {isRealWalletConnected
                ? `${connectedWallet.slice(0, 4)}..${connectedWallet.slice(-4)}`
                : "Connect"}
            </span>
          </button>

          {/* Language Switch */}
          <button
            type="button"
            onClick={onToggleLang}
            title="Switch Language (EN / ID)"
            className={`hidden sm:inline-flex items-center justify-center h-9 px-2.5 rounded-lg border text-[11.5px] font-mono uppercase tracking-[0.08em] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${controlBtnCls}`}
          >
            {lang.toUpperCase()}
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"
            }
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className={`inline-flex items-center justify-center h-9 w-9 rounded-lg border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${controlBtnCls}`}
          >
            {darkMode ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-[#2934FF]" />
            )}
          </button>

          {/* BYOK Venice AI Key */}
          <button
            type="button"
            onClick={onOpenKeyModal}
            aria-label="Configure Venice AI Zero-Retention Key"
            title="Configure Venice AI Key"
            className={`hidden sm:inline-flex items-center justify-center h-9 w-9 rounded-lg border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${controlBtnCls}`}
          >
            <Key className="w-3.5 h-3.5 text-[#2934FF]" />
          </button>

          {/* Primary CTA */}
          <Link
            href="/buildcheck"
            className="hidden xl:inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#2934FF] hover:bg-[#1E27E6] text-white text-[13px] font-semibold tracking-[-0.01em] transition-colors whitespace-nowrap shadow-[0_4px_16px_rgba(41,52,255,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF]"
          >
            <span>
              {lang === "en" ? "Launch BuildCheck" : "Buka BuildCheck"}
            </span>
          </Link>

          {/* Mobile Drawer Trigger */}
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className={`lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2934FF] ${controlBtnCls}`}
          >
            {mobileOpen ? (
              <X className="w-4 h-4" />
            ) : (
              <Menu className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Wallet Notice Sub-bar (only when triggered) */}
      {walletNotice && (
        <div
          className={`px-5 sm:px-8 xl:px-12 py-2 border-t text-[12.5px] font-sans text-amber-400 ${
            darkMode
              ? "border-white/10 bg-[#0D1017]/95"
              : "border-black/10 bg-amber-50 text-amber-800"
          }`}
        >
          {walletNotice}
        </div>
      )}

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div
          className={`lg:hidden border-t max-h-[calc(100vh-4rem)] overflow-y-auto px-5 py-5 space-y-5 ${
            darkMode
              ? "bg-[#090B10] border-white/15 text-[#F4F6FA]"
              : "bg-[#FAF9F6] border-black/15 text-[#141413]"
          }`}
        >
          {columns.map((col) => (
            <div key={col.heading}>
              <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.12em] opacity-55 mb-2">
                {col.heading}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {col.items.map((item) => {
                  const Icon = item.icon;
                  const cls = `flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    darkMode
                      ? "border-white/10 bg-white/[0.02] hover:border-[#2934FF]/50"
                      : "border-black/10 bg-white hover:border-[#2934FF]/50"
                  }`;
                  const content = (
                    <>
                      <Icon className="w-4 h-4 text-[#2934FF] shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium leading-tight">
                          {item.label}
                        </span>
                        <span className="block text-[11.5px] opacity-60 truncate">
                          {item.desc}
                        </span>
                      </span>
                    </>
                  );

                  if (item.onClick) {
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={item.onClick}
                        className={cls}
                      >
                        {content}
                      </button>
                    );
                  }

                  return (
                    <Link
                      key={item.label}
                      href={item.href || "/"}
                      onClick={closeAll}
                      className={cls}
                    >
                      {content}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Mobile Utility Footer */}
          <div
            className={`pt-4 border-t flex flex-wrap items-center justify-between gap-2 ${
              darkMode ? "border-white/10" : "border-black/10"
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleLang}
                className={`h-9 px-3 rounded-lg border text-[12px] font-mono uppercase cursor-pointer ${controlBtnCls}`}
              >
                Lang: {lang.toUpperCase()}
              </button>
              <button
                type="button"
                onClick={() => {
                  closeAll();
                  onOpenKeyModal();
                }}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12px] font-medium cursor-pointer ${controlBtnCls}`}
              >
                <Key className="w-3.5 h-3.5 text-[#2934FF]" />
                <span>BYOK Key</span>
              </button>
            </div>
            <a
              href="https://github.com/Blanksite/solshield"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-medium opacity-80 hover:opacity-100"
            >
              <span>GitHub</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
