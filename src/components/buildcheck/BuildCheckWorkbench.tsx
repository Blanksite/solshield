"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Code2,
  Coins,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileJson2,
  FileWarning,
  Flame,
  Globe,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Monitor,
  Network,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  BlurText,
  ClickSpark,
  CobaltSphere3D,
  CountUp,
  DecryptedText,
  InteractiveDotGrid,
  Magnet,
  ShinyText,
  SpotlightCard,
  StarBorder,
  TiltedCard,
} from "@/components/reactbits";
import type {
  BuildCheckReport,
  BuildCheckStreamEvent,
} from "@/lib/buildcheck/types";
import { formatSolShieldDispatchText } from "@/lib/buildcheck/proof-dispatch";
import {
  formatCompactUsd,
  toScannedTokenExtraFromReport,
} from "@/lib/buildcheck/war-room-metrics";
import {
  clearLocalScannedTokens,
  mergeScannedTokenLists,
  normalizeScannedTokenProgram,
  readLocalScannedTokens,
  saveLocalScannedToken,
  type ScannedTokenSummary,
} from "@/lib/scanned-token-types";
import { AuditLedgerSection } from "./AuditLedgerSection";
import { ClaimsReceiptsPanel } from "./ClaimsReceiptsPanel";
import { DevHistoryPanel } from "./DevHistoryPanel";
import { generateBuildCheckEvidencePng } from "./evidence-card-canvas";
import { MarketTelemetryPanel } from "./MarketTelemetryPanel";
import { MindsharePulsePanel } from "./MindsharePulsePanel";
import { ProofDispatchCard } from "./ProofDispatchCard";
import { RobinhoodAuditCard } from "./RobinhoodAuditCard";
import { RugAutopsyPanel } from "./RugAutopsyPanel";
import { ShieldedSwapPanel } from "./ShieldedSwapPanel";
import { SniperCabalGraph } from "./SniperCabalGraph";
import { TradingViewTokenChart } from "./TradingViewTokenChart";
import { WalletsToWatchPanel } from "./WalletsToWatchPanel";
import { WarRoomDualAxisStrip } from "./WarRoomDualAxisStrip";
import {
  readLocalWatchedWallets,
  WATCHLIST_CHANGED_EVENT,
  type WatchWalletChain,
} from "@/lib/wallet-watch-client";

interface StreamFrameItem {
  url: string;
  title: string;
  stepLabel: string;
  imageBase64: string;
  xhrCount: number;
  elapsedMs: number;
}

interface StreamLogEntry {
  id: string;
  elapsedMs: number;
  title: string;
  detail: string;
  phase: "parse" | "browser" | "collectors" | "venice" | "done" | "error";
}

interface CollectorBadgeState {
  github: { status: "idle" | "ok" | "warn" | "error"; text: string };
  chain: { status: "idle" | "ok" | "warn" | "error"; text: string };
  domain: { status: "idle" | "ok" | "warn" | "error"; text: string };
  xpost: { status: "idle" | "ok" | "warn" | "error"; text: string };
  social: { status: "idle" | "ok" | "warn" | "error"; text: string };
}

const INITIAL_COLLECTORS: CollectorBadgeState = {
  github: { status: "idle", text: "Waiting" },
  chain: { status: "idle", text: "Waiting" },
  domain: { status: "idle", text: "Waiting" },
  xpost: { status: "idle", text: "Waiting" },
  social: { status: "idle", text: "Waiting" },
};

function TokenAvatar({
  imageUrl,
  symbol,
}: {
  imageUrl?: string | null;
  symbol?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={symbol || "Token"}
        onError={() => setFailed(true)}
        className="w-11 h-11 rounded-xl border border-white/15 object-cover bg-[#080A0F] shrink-0"
      />
    );
  }

  return (
    <div className="w-11 h-11 rounded-xl border border-[#2934FF]/40 bg-[#12162A] flex items-center justify-center font-mono text-sm font-bold text-[#93C5FD] shrink-0">
      {(symbol || "TK").slice(0, 3).toUpperCase()}
    </div>
  );
}

function buildCollectorsFromReport(
  report: BuildCheckReport | null
): CollectorBadgeState {
  if (!report) return INITIAL_COLLECTORS;
  return {
    github: report.github
      ? {
          status: report.github.exists ? "ok" : "warn",
          text: report.github.exists
            ? `${report.github.fullName} · ${report.github.stars}★`
            : report.github.error || "Not verified",
        }
      : { status: "idle", text: "Not present" },
    chain: report.chain?.tokenReport
      ? {
          status: report.chain.tokenReport.riskScore < 50 ? "ok" : "warn",
          text: `${report.chain.tokenReport.symbol || "SPL"} · ${report.chain.tokenReport.classification} (${report.chain.tokenReport.riskScore}/100)`,
        }
      : { status: "idle", text: "Not present" },
    domain: report.domain
      ? {
          status: (report.componentScores.domainProof ?? 0) >= 60 ? "ok" : "warn",
          text:
            report.domain.domainAgeDays !== null
              ? `${report.domain.hostname} · ${report.domain.domainAgeDays}d`
              : report.domain.hostname,
        }
      : { status: "idle", text: "Not present" },
    xpost: report.xPost
      ? {
          status: report.xPost.textContent ? "ok" : "warn",
          text: report.xPost.handle
            ? `@${report.xPost.handle}`
            : report.xPost.methodUsed,
        }
      : { status: "idle", text: "Not present" },
    social: report.social
      ? {
          status:
            report.social.totalPostsSampled > 0 || report.social.officialProfile
              ? report.social.quadrant === "NARRATIVE_OVERHEAT"
                ? "warn"
                : "ok"
              : report.social.source === "unavailable"
                ? "warn"
                : "ok",
          text:
            report.social.totalPostsSampled > 0
              ? `${report.social.mindshareScore}/100 · ${report.social.kolCount} KOLs · ${report.social.totalPostsSampled} posts`
              : report.social.officialProfile
                ? `@${report.social.officialProfile.username} · 0 mentions`
                : "Pre-discovery",
        }
      : { status: "idle", text: "On-demand · Click to scan" },
  };
}

function buildLogsFromReport(
  report: BuildCheckReport | null
): StreamLogEntry[] {
  if (!report) return [];
  const entries: StreamLogEntry[] = [
    {
      id: "perm_0",
      elapsedMs: 0,
      title: `Loaded BuildCheck Report ${report.id}`,
      detail: `Target: ${report.target.rawInput}`,
      phase: "parse",
    },
  ];
  for (const stop of report.browser?.stops || []) {
    entries.push({
      id: `perm_stop_${entries.length}`,
      elapsedMs: stop.loadTimeMs || 0,
      title: stop.stepLabel || "Browser Stop",
      detail: `${stop.title || stop.url} · ${stop.xhrCount} XHR`,
      phase: "browser",
    });
  }
  entries.push({
    id: `perm_verdict_${entries.length}`,
    elapsedMs: report.elapsedMs || 0,
    title: `${report.verdict} (${report.authenticityScore}/100)`,
    detail: report.headline,
    phase: "done",
  });
  return entries;
}

export interface BuildCheckWorkbenchProps {
  initialReport?: BuildCheckReport | null;
  initialTarget?: string;
  initialReportMissingId?: string;
}

export default function BuildCheckWorkbench({
  initialReport = null,
  initialTarget,
  initialReportMissingId,
}: BuildCheckWorkbenchProps = {}) {
  const [input, setInput] = useState(
    initialReport?.target?.rawInput || initialTarget || ""
  );
  const [veniceApiKey, setVeniceApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [enableBrowser, setEnableBrowser] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(
    initialReportMissingId
      ? `Shared BuildCheck report "${initialReportMissingId}" was not found or expired. Paste a CA or link below to run a fresh live scan.`
      : null
  );
  const [logs, setLogs] = useState<StreamLogEntry[]>(() =>
    buildLogsFromReport(initialReport)
  );
  const [frames, setFrames] = useState<StreamFrameItem[]>([]);
  const [selectedFrameIdx, setSelectedFrameIdx] = useState(0);
  const [collectors, setCollectors] = useState<CollectorBadgeState>(() =>
    buildCollectorsFromReport(initialReport)
  );
  const [report, setReport] = useState<BuildCheckReport | null>(initialReport);

  const [isExportingPng, setIsExportingPng] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [copiedCa, setCopiedCa] = useState(false);
  const [guestChecksUsed, setGuestChecksUsed] = useState(0);
  const [recentTokens, setRecentTokens] = useState<ScannedTokenSummary[]>([]);
  const [showResultLedger, setShowResultLedger] = useState(false);
  const [watchedCount, setWatchedCount] = useState(0);
  const [forensicTab, setForensicTab] = useState<
    "proof" | "mindshare" | "robinhood" | "holders" | "wallets" | "autopsy" | "dev" | "browser" | "telemetry"
  >("proof");
  const [isScanningMindshare, setIsScanningMindshare] = useState(false);
  const [mindshareScanError, setMindshareScanError] = useState<string | null>(null);

  useEffect(() => {
    const refreshWatchCount = () => {
      setWatchedCount(readLocalWatchedWallets().length);
    };
    refreshWatchCount();
    window.addEventListener(WATCHLIST_CHANGED_EVENT, refreshWatchCount);
    return () => window.removeEventListener(WATCHLIST_CHANGED_EVENT, refreshWatchCount);
  }, []);

  const handleScanMindshare = async () => {
    if (!report || isScanningMindshare) return;
    setIsScanningMindshare(true);
    setMindshareScanError(null);

    try {
      let veniceKey = veniceApiKey.trim();
      if (!veniceKey) {
        try {
          const stored = localStorage.getItem("solshield_venice_key");
          if (stored) veniceKey = stored.trim();
        } catch {
          // Ignore localStorage errors
        }
      }

      const res = await fetch("/api/buildcheck/mindshare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          reportId: report.id,
          target: report.target,
          chain: report.chain,
          github: report.github,
          domain: report.domain,
          xPost: report.xPost,
          browserXUrls: report.browser?.discoveredXUrls,
          veniceApiKey: veniceKey || undefined,
          report,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok || !data.social) {
        throw new Error(data.error || `Failed to fetch X Mindshare (HTTP ${res.status})`);
      }

      const updatedReport: BuildCheckReport = {
        ...report,
        social: data.social,
      };

      setReport(updatedReport);
      setCollectors(buildCollectorsFromReport(updatedReport));
      void import("@/lib/buildcheck/local-report-cache").then((m) =>
        m.saveLocalBuildCheckReport(updatedReport)
      );
    } catch (err) {
      setMindshareScanError(
        err instanceof Error ? err.message : "Failed to scan X Mindshare."
      );
    } finally {
      setIsScanningMindshare(false);
    }
  };

  const abortRef = useRef<AbortController | null>(null);
  const forensicPanelRef = useRef<HTMLDivElement | null>(null);
  const didAutoInitRef = useRef(false);

  const loadRecentScannedTokens = async () => {
    const localList = readLocalScannedTokens();
    setRecentTokens(localList);
    try {
      let res = await fetch("/api/scanned-tokens?limit=40", {
        cache: "no-store",
      });
      if (res.status === 401) {
        await fetch(window.location.pathname || "/buildcheck", {
          method: "HEAD",
          credentials: "same-origin",
        }).catch(() => undefined);
        res = await fetch("/api/scanned-tokens?limit=40", {
          cache: "no-store",
        });
      }
      const data = await res.json();
      if (data?.ok && Array.isArray(data.tokens)) {
        setRecentTokens(mergeScannedTokenLists(localList, data.tokens, 40));
      }
    } catch {
      // Keep local list on transient network failure
    }
  };

  const syncUrlWithReportId = (reportId: string) => {
    if (typeof window === "undefined" || !reportId) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("target");
      url.searchParams.set("report", reportId);
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch {
      // Ignore history API restrictions
    }
  };

  async function loadPermalinkReport(reportId: string, fallbackTarget?: string) {
    const cleanId = reportId.trim();
    if (!cleanId) return;
    setErrorMsg(null);
    setIsRunning(true);
    let handoffToLiveScan = false;

    const hydrateReport = (loaded: BuildCheckReport) => {
      setReport(loaded);
      setShowResultLedger(false);
      setInput(loaded.target.rawInput);
      setFrames([]);
      setCollectors(buildCollectorsFromReport(loaded));
      setLogs(buildLogsFromReport(loaded));
      syncUrlWithReportId(loaded.id);
    };

    try {
      let res = await fetch(
        `/api/buildcheck/report?id=${encodeURIComponent(cleanId)}`,
        { cache: "no-store" }
      );
      if (res.status === 401) {
        await fetch(window.location.pathname || "/buildcheck", {
          method: "HEAD",
          credentials: "same-origin",
        }).catch(() => undefined);
        res = await fetch(
          `/api/buildcheck/report?id=${encodeURIComponent(cleanId)}`,
          { cache: "no-store" }
        );
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        report?: BuildCheckReport;
        error?: string;
      };
      const cacheMod = await import("@/lib/buildcheck/local-report-cache");
      if (res.ok && data.ok && data.report) {
        cacheMod.saveLocalBuildCheckReport(data.report);
        hydrateReport(data.report);
        return;
      }

      const cachedLocal = cacheMod.readLocalBuildCheckReport(cleanId);
      if (cachedLocal) {
        hydrateReport(cachedLocal);
        return;
      }

      const activeMint =
        report?.chain?.mintAddress || report?.target?.mintAddress || undefined;
      const resolvedFallback =
        fallbackTarget?.trim() ||
        activeMint ||
        (await cacheMod.resolveFallbackMintForReport(cleanId, recentTokens));

      if (resolvedFallback) {
        setErrorMsg(null);
        handoffToLiveScan = true;
        void runCheck(resolvedFallback, { bypassBusyCheck: true });
        return;
      }

      setErrorMsg(
        data.error ||
          `Shared BuildCheck report "${cleanId}" was not found or expired. Paste a CA or link below to run a fresh live scan.`
      );
    } catch {
      try {
        const cacheMod = await import("@/lib/buildcheck/local-report-cache");
        const cachedLocal = cacheMod.readLocalBuildCheckReport(cleanId);
        if (cachedLocal) {
          hydrateReport(cachedLocal);
          return;
        }
        const resolvedFallback =
          fallbackTarget?.trim() ||
          (await cacheMod.resolveFallbackMintForReport(cleanId, recentTokens));
        if (resolvedFallback) {
          setErrorMsg(null);
          handoffToLiveScan = true;
          void runCheck(resolvedFallback, { bypassBusyCheck: true });
          return;
        }
      } catch {
        // Ignore cache recovery errors
      }
      setErrorMsg("Failed to load shared BuildCheck report.");
    } finally {
      if (!handoffToLiveScan) {
        setIsRunning(false);
      }
    }
  }

  useEffect(() => {
    try {
      const savedKey = window.sessionStorage.getItem("solshield_venice_api_key");
      if (savedKey) setVeniceApiKey(savedKey);
      const savedGuest = Number(
        window.localStorage.getItem("solshield_buildcheck_runs") || "0"
      );
      if (Number.isFinite(savedGuest)) setGuestChecksUsed(savedGuest);
    } catch {
      // Storage unavailable
    }
    void loadRecentScannedTokens();

    if (didAutoInitRef.current) return;
    didAutoInitRef.current = true;

    if (initialReport) {
      void import("@/lib/buildcheck/local-report-cache").then((m) =>
        m.saveLocalBuildCheckReport(initialReport)
      );
      syncUrlWithReportId(initialReport.id);
      return;
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const reportParam = params.get("report")?.trim();
      const targetParam = (initialTarget || params.get("target") || "").trim();
      if (initialReportMissingId) {
        void (async () => {
          try {
            const cacheMod = await import("@/lib/buildcheck/local-report-cache");
            const cachedLocal =
              cacheMod.readLocalBuildCheckReport(initialReportMissingId);
            if (cachedLocal) {
              setReport(cachedLocal);
              setShowResultLedger(false);
              setErrorMsg(null);
              setInput(cachedLocal.target.rawInput);
              setFrames([]);
              setCollectors(buildCollectorsFromReport(cachedLocal));
              setLogs(buildLogsFromReport(cachedLocal));
              syncUrlWithReportId(cachedLocal.id);
              return;
            }
            const fallbackMint =
              targetParam ||
              (await cacheMod.resolveFallbackMintForReport(initialReportMissingId));
            if (fallbackMint) {
              setErrorMsg(null);
              void runCheck(fallbackMint, { bypassBusyCheck: true });
            }
          } catch {
            // Keep existing SSR missing-report banner
          }
        })();
      } else if (reportParam) {
        void loadPermalinkReport(reportParam, targetParam || undefined);
      } else if (targetParam) {
        void runCheck(targetParam);
      }
    } catch {
      // Ignore query parse failures
    }
  }, []);

  useEffect(() => {
    if (frames.length > 0) {
      setSelectedFrameIdx(frames.length - 1);
    }
  }, [frames.length]);

  const handleSaveKey = (val: string) => {
    setVeniceApiKey(val);
    try {
      if (val.trim()) {
        window.sessionStorage.setItem("solshield_venice_api_key", val.trim());
      } else {
        window.sessionStorage.removeItem("solshield_venice_api_key");
      }
    } catch {
      // Ignore storage failures
    }
  };

  async function runCheck(
    overrideTarget?: string,
    options?: { forceRefresh?: boolean; bypassBusyCheck?: boolean }
  ) {
    const query = (overrideTarget ?? input).trim();
    if (!query || (isRunning && !options?.bypassBusyCheck)) return;
    if (overrideTarget) setInput(overrideTarget);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsRunning(true);
    setErrorMsg(null);
    setReport(null);
    setLogs([]);
    setFrames([]);
    setSelectedFrameIdx(0);
    setCollectors(INITIAL_COLLECTORS);
    setForensicTab("proof");

    try {
      const requestBody = JSON.stringify({
        input: query,
        veniceApiKey: veniceApiKey.trim() || undefined,
        enableBrowser,
        forceRefresh: options?.forceRefresh === true ? true : undefined,
      });

      let response = await fetch("/api/buildcheck/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: requestBody,
      });

      // Seamlessly refresh guard cookie once if tab stayed open past 12h or pre-deploy
      if (response.status === 401) {
        await fetch(window.location.pathname || "/buildcheck", {
          method: "HEAD",
          credentials: "same-origin",
        }).catch(() => undefined);
        response = await fetch("/api/buildcheck/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: requestBody,
        });
      }

      if (!response.ok || !response.body) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(
          (errPayload as { error?: string }).error ||
            `Request failed (${response.status})`
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          const payloadStr = trimmed.startsWith("data:")
            ? trimmed.slice(5).trim()
            : trimmed;
          if (!payloadStr) continue;
          let event: BuildCheckStreamEvent;
          try {
            event = JSON.parse(payloadStr) as BuildCheckStreamEvent;
          } catch {
            continue;
          }

          if (event.type === "step") {
            setLogs((prev) => [
              ...prev,
              {
                id: `step_${prev.length}`,
                elapsedMs: event.elapsedMs,
                title: event.title,
                detail: event.detail,
                phase: event.phase,
              },
            ]);
          } else if (event.type === "frame") {
            setFrames((prev) => [
              ...prev,
              {
                url: event.url,
                title: event.title,
                stepLabel: event.stepLabel,
                imageBase64: event.imageBase64,
                xhrCount: event.xhrCount,
                elapsedMs: event.elapsedMs,
              },
            ]);
          } else if (event.type === "collector") {
            setCollectors((prev) => ({
              ...prev,
              [event.collector]: {
                status: event.status,
                text: event.summary,
              },
            }));
          } else if (event.type === "verdict") {
            setReport(event.report);
            setShowResultLedger(false);
            syncUrlWithReportId(event.report.id);
            void import("@/lib/buildcheck/local-report-cache").then((m) =>
              m.saveLocalBuildCheckReport(event.report)
            );
            if (event.report.chain?.tokenReport) {
              saveLocalScannedToken(
                event.report.chain.tokenReport,
                "buildcheck",
                40,
                toScannedTokenExtraFromReport(event.report)
              );
              void loadRecentScannedTokens();
            }
            setGuestChecksUsed((prev) => {
              const next = prev + 1;
              try {
                window.localStorage.setItem(
                  "solshield_buildcheck_runs",
                  String(next)
                );
              } catch {
                // Ignore
              }
              return next;
            });
          } else if (event.type === "error") {
            setErrorMsg(event.message);
            setLogs((prev) => [
              ...prev,
              {
                id: `err_${prev.length}`,
                elapsedMs: event.elapsedMs,
                title: "Investigation halted",
                detail: event.message,
                phase: "error",
              },
            ]);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to run BuildCheck."
        );
      }
    } finally {
      setIsRunning(false);
    }
  }

  async function handleExportPng() {
    if (!report) return;
    setIsExportingPng(true);
    try {
      const dataUrl = await generateBuildCheckEvidencePng(report);
      const link = document.createElement("a");
      link.download = `solshield-buildcheck-${report.id}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      setErrorMsg("Unable to generate PNG evidence card.");
    } finally {
      setIsExportingPng(false);
    }
  }

  async function handleCopyXPost() {
    if (!report) return;
    const shareOrigin =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://sol-shield.xyz";
    const text = formatSolShieldDispatchText(report, {
      appPublicUrl: shareOrigin,
      maskAddresses: false,
      includeUrl: true,
    });

    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      // Clipboard denied
    }
  }

  async function handleCopyShareLink() {
    if (!report) return;
    const shareOrigin =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://sol-shield.xyz";
    const shareUrl = `${shareOrigin}/buildcheck?report=${encodeURIComponent(report.id)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShareLink(true);
      setTimeout(() => setCopiedShareLink(false), 2000);
    } catch {
      // Clipboard denied
    }
  }

  async function handleCopyCa(mint: string) {
    try {
      await navigator.clipboard.writeText(mint);
      setCopiedCa(true);
      setTimeout(() => setCopiedCa(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  }

  const activeFrame = frames[selectedFrameIdx] || null;
  const isTokenReport = Boolean(report?.chain?.mintAddress);
  const showCompactHeaderSearch = Boolean(report && !isRunning);

  const tokenMeta = report?.chain?.deep?.metadata;
  const tokenMarket = report?.chain?.deep?.market;
  const matchedDirectoryEntry = report?.chain?.mintAddress
    ? recentTokens.find((t) => t.mintAddress === report.chain?.mintAddress) ?? null
    : null;
  const tokenName =
    tokenMeta?.name || report?.chain?.tokenReport?.name || "Solana Token";
  const tokenSymbol =
    tokenMeta?.symbol ||
    report?.chain?.tokenReport?.symbol ||
    report?.chain?.mintAddress.slice(0, 5) ||
    "TOKEN";
  const websiteLink =
    tokenMeta?.websites?.[0] || report?.chain?.dexPair?.websites?.[0] || null;
  const twitterLink = tokenMeta?.twitterUrl || null;
  const devBurnsCount =
    report?.chain?.deep?.devHistory.recentTxs.filter(
      (t) => !t.err && t.action === "burn"
    ).length ?? 0;

  const verdictStyle =
    report?.verdict === "VERIFIED_BUILD"
      ? {
          badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
          scoreText: "text-emerald-400",
          barColor: "bg-emerald-400",
          label: "Verified Build",
          Icon: ShieldCheck,
        }
      : report?.verdict === "UNPROVEN_HYPE"
        ? {
            badge: "bg-amber-500/15 text-amber-300 border-amber-500/40",
            scoreText: "text-amber-300",
            barColor: "bg-amber-400",
            label: "Mixed / Unproven Hype",
            Icon: AlertTriangle,
          }
        : {
            badge: "bg-red-500/15 text-red-300 border-red-500/45",
            scoreText: "text-red-400",
            barColor: "bg-red-400",
            label: "High Fabrication Risk",
            Icon: ShieldAlert,
          };

  const renderBrowserStageCard = (colSpanClass = "lg:col-span-7") => (
    <div
      className={`${colSpanClass} rounded-xl border border-white/[0.08] bg-[#0D1017] overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.4)]`}
    >
      <div className="px-4 py-2.5 border-b border-white/[0.07] bg-[#090B10] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"
              }`}
            />
            <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
          </div>
          <div className="ml-2 px-2.5 py-1 rounded bg-[#07080D] border border-white/[0.08] text-xs font-mono text-slate-300 truncate flex-1 min-w-0">
            {activeFrame?.url || "Agent preparing Chromium session..."}
          </div>
        </div>

        {frames.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            {frames.map((fr, idx) => (
              <button
                key={`${fr.url}_${idx}`}
                type="button"
                onClick={() => setSelectedFrameIdx(idx)}
                className={`px-2 py-0.5 rounded text-[11px] font-mono border cursor-pointer transition-colors ${
                  idx === selectedFrameIdx
                    ? "border-[#2934FF] bg-[#2934FF]/25 text-white"
                    : "border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                Stop {idx + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="aspect-video w-full bg-[#07090F] relative flex items-center justify-center overflow-hidden">
        {activeFrame ? (
          <img
            key={activeFrame.url}
            src={`data:image/jpeg;base64,${activeFrame.imageBase64}`}
            alt={`Live browser observation of ${activeFrame.url}`}
            className="w-full h-full object-contain rb-fade-up"
          />
        ) : !isRunning && report ? (
          <div className="p-6 w-full h-full flex flex-col justify-between gap-4 overflow-y-auto">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="px-2.5 py-1 rounded-md bg-[#2934FF]/15 border border-[#2934FF]/35 text-[11px] font-mono text-[#93C5FD]">
                  Shared Forensic Permalink · {report.id}
                </span>
                <button
                  type="button"
                  onClick={() => runCheck(report.target.rawInput, { forceRefresh: true })}
                  disabled={isRunning}
                  className="px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-[11px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Load Live Browser Captures</span>
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Screenshots are omitted in shareable permalink storage. Recorded browser telemetry ({report.browser?.totalXhrObserved ?? 0} XHR observed):
              </p>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {(report.browser?.stops || []).length > 0 ? (
                report.browser.stops.map((stop, idx) => (
                  <div
                    key={`${stop.url}-${idx}`}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[#93C5FD] truncate">
                        {stop.stepLabel}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0">
                        {stop.xhrCount} XHR · {stop.loadTimeMs}ms
                      </span>
                    </div>
                    <p className="text-slate-200 truncate">{stop.title || stop.url}</p>
                    <p className="font-mono text-[11px] text-slate-500 truncate">{stop.url}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs font-mono text-slate-500">
                  Target audited via Chain, GitHub, and Domain API telemetry ({report.browser?.mode || "http-fallback"}).
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center px-6 py-10 space-y-3 max-w-md relative z-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-16 rb-scanline bg-gradient-to-b from-transparent via-[#2934FF]/35 to-transparent"
            />
            <div className="relative mx-auto w-14 h-14 flex items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-[#2934FF]/50 animate-ping" />
              <CobaltSphere3D className="w-11 h-11" />
            </div>
            <p className="text-sm font-medium text-white">
              {enableBrowser
                ? "Opening target inside headless Chromium..."
                : "Collecting on-chain, GitHub & domain telemetry..."}
            </p>
            <p className="text-xs text-slate-400">
              Live DOM frames and network activity appear here as each stop completes.
            </p>
          </div>
        )}

        {activeFrame && (
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
            <span className="px-2.5 py-1 rounded-md bg-[#07090F]/92 border border-white/15 text-[11px] font-mono text-slate-200 truncate inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate">{activeFrame.stepLabel}</span>
            </span>
            <span className="px-2.5 py-1 rounded-md bg-[#07090F]/92 border border-[#2934FF]/40 text-[11px] font-mono text-[#93C5FD] shrink-0">
              {activeFrame.xhrCount} XHR calls observed
            </span>
          </div>
        )}
      </div>
    </div>
  );

  const renderAgentFeedCard = (colSpanClass = "lg:col-span-5") => (
    <div
      className={`${colSpanClass} rounded-xl border border-white/[0.08] bg-[#0D1017] overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.4)] divide-y divide-white/[0.07]`}
    >
      <div className="px-4 py-3 flex items-center justify-between bg-[#090B10]">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Terminal className="w-4 h-4 text-[#93C5FD]" />
          <span>Live Agent Feed</span>
        </div>
        <span className="text-[11px] font-mono tabular-nums text-slate-400 inline-flex items-center gap-1.5">
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#60A5FA] animate-pulse" />
          )}
          <span>
            {report
              ? report.cache?.hit
                ? "Cached Scan (Reused)"
                : `Done in ${(report.elapsedMs / 1000).toFixed(1)}s`
              : isRunning
                ? "Streaming..."
                : "Idle"}
          </span>
        </span>
      </div>

      {/* 5 Collector Pills */}
      <div className="p-3.5 grid grid-cols-2 gap-2">
        {[
          { key: "github" as const, label: "GitHub", Icon: Code2, span: "" },
          {
            key: "chain" as const,
            label:
              report?.chain?.chainFamily === "evm" ||
              report?.chain?.mintAddress?.startsWith("0x") ||
              input.trim().startsWith("0x")
                ? report?.chain?.networkName || "EVM Chain"
                : "Solana Chain",
            Icon: Coins,
            span: "",
          },
          { key: "domain" as const, label: "Domain RDAP", Icon: Globe, span: "" },
          { key: "xpost" as const, label: "X / Claim", Icon: Activity, span: "" },
          {
            key: "social" as const,
            label: "X Mindshare & KOLs",
            Icon: Radio,
            span: "col-span-2",
          },
        ].map(({ key, label, Icon, span }) => {
          const st = collectors[key];
          const tone =
            st.status === "ok"
              ? "border-emerald-500/35 bg-emerald-500/[0.07] text-emerald-300"
              : st.status === "warn"
                ? "border-amber-500/35 bg-amber-500/[0.07] text-amber-300"
                : "border-white/[0.08] bg-[#080A0F] text-slate-400";
          const canOpenSocial = key === "social" && Boolean(report?.social);
          return (
            <div
              key={key}
              onClick={
                canOpenSocial
                  ? () => {
                      setForensicTab("mindshare");
                      forensicPanelRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }
                  : undefined
              }
              className={`${span} px-2.5 py-2 rounded-lg border transition-colors ${tone} ${
                canOpenSocial ? "cursor-pointer hover:border-[#5D82FF]/60" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{label}</span>
                </span>
                {st.status !== "idle" && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      st.status === "ok" ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                )}
              </div>
              <div className="mt-1 text-[11px] font-mono truncate opacity-85">
                {st.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Step Feed */}
      <div className="p-4 h-72 overflow-y-auto space-y-3">
        {logs.length === 0 ? (
          <p className="text-xs text-slate-500">
            Initializing collectors &amp; headless browser telemetry...
          </p>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="text-xs space-y-0.5 rb-fade-up">
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-[11px] text-[#93C5FD]">
                  +{(entry.elapsedMs / 1000).toFixed(1)}s
                </span>
                <span className="font-medium text-white">{entry.title}</span>
              </div>
              <p className="text-slate-400 pl-10 break-all">{entry.detail}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderForensicTabPanel = () => {
    if (!report) return null;
    return (
      <div
        ref={forensicPanelRef}
        className="rounded-xl border border-white/[0.08] bg-[#0D1017] overflow-hidden scroll-mt-20"
      >
        {/* Unified Forensic Tab Switcher */}
        <div className="px-4 py-2.5 border-b border-white/[0.07] bg-[#090B10] flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setForensicTab("proof")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              forensicTab === "proof"
                ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
            }`}
          >
            <FileJson2 className="w-3.5 h-3.5" />
            <span>Claims &amp; Tech Audits</span>
          </button>

          <button
            type="button"
            data-testid="tab-x-mindshare"
            onClick={() => setForensicTab("mindshare")}
            className={`min-h-[44px] px-4 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-all cursor-pointer ${
              forensicTab === "mindshare"
                ? "bg-[#2934FF] text-white border border-[#60A5FA]/70 shadow-[0_6px_20px_rgba(41,52,255,0.34)]"
                : "bg-[#2934FF]/14 text-[#E0EAFF] hover:bg-[#2934FF]/24 border border-[#5D82FF]/45"
            }`}
          >
            <Radio className="w-4 h-4 text-[#93C5FD] shrink-0" />
            <span>X Mindshare &amp; KOLs</span>
            {report.social ? (
              <span className="px-2 py-0.5 rounded-md bg-black/30 border border-white/15 text-[#BFD0FF] font-mono text-[11px] tabular-nums">
                {report.social.mindshareScore}/100 · {report.social.kolCount} KOLs
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/25 text-[#93C5FD] font-mono text-[10px]">
                On-Demand
              </span>
            )}
          </button>

          {/* Robinhood Listing & Forensics Tab */}
          <button
            type="button"
            data-testid="tab-robinhood"
            onClick={() => setForensicTab("robinhood")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              forensicTab === "robinhood"
                ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {report.chain?.evmSecurity
                ? "EVM Contract & Robinhood"
                : "Robinhood Listing"}
            </span>
            {((report.robinhood && report.robinhood.status === "IMPOSTOR_ALERT") ||
              report.chain?.evmSecurity?.verdict === "CRITICAL") && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            )}
            {report.robinhood &&
              report.robinhood.status === "OFFICIAL_LISTED" &&
              report.chain?.evmSecurity?.verdict !== "CRITICAL" && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            {report.robinhood &&
              report.robinhood.status === "ROBINHOOD_CHAIN_NATIVE" &&
              report.chain?.evmSecurity?.verdict !== "CRITICAL" && (
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              )}
          </button>

          {report.chain?.deep?.holders && (
            <button
              type="button"
              onClick={() => setForensicTab("holders")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                forensicTab === "holders"
                  ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                  : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>
                Sniper &amp; Cabal Graph ({report.chain.deep.holders.score})
              </span>
            </button>
          )}

          {report.chain?.deep?.holders && (
            <button
              type="button"
              data-testid="tab-wallets-to-watch"
              onClick={() => setForensicTab("wallets")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                forensicTab === "wallets"
                  ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                  : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-[#84A7FF]" />
              <span>Wallets to Watch</span>
              {(report.chain.deep.holders.walletsToWatch?.length ?? 0) > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-white/[0.08] border border-white/15 font-mono text-[10px] tabular-nums text-[#BFD0FF]">
                  {report.chain.deep.holders.walletsToWatch!.length}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            data-testid="tab-rug-autopsy"
            onClick={() => setForensicTab("autopsy")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              forensicTab === "autopsy"
                ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
            }`}
          >
            <FileWarning className="w-3.5 h-3.5 text-rose-400" />
            <span>Rug Autopsy</span>
          </button>

          {report.chain?.deep?.devHistory && (
            <button
              type="button"
              onClick={() => setForensicTab("dev")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                forensicTab === "dev"
                  ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                  : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Dev Wallet History</span>
              {devBurnsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px]">
                  {devBurnsCount}B
                </span>
              )}
            </button>
          )}

          {isTokenReport && frames.length > 0 && (
            <button
              type="button"
              onClick={() => setForensicTab("browser")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                forensicTab === "browser"
                  ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                  : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Browser Captures ({frames.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setForensicTab("telemetry")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              forensicTab === "telemetry"
                ? "bg-[#2934FF]/22 text-white border border-[#2934FF]/50"
                : "text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.04]"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>GitHub Code &amp; Tech Logs</span>
          </button>
        </div>

        {/* Tab Contents */}
        {forensicTab === "mindshare" && (
          <MindsharePulsePanel
            social={report.social}
            symbol={tokenSymbol}
            onScanMindshare={handleScanMindshare}
            isScanningMindshare={isScanningMindshare}
            scanError={mindshareScanError}
          />
        )}

        {forensicTab === "robinhood" && (
          <div className="p-5">
            <RobinhoodAuditCard
              robinhood={report.robinhood || report.chain?.robinhood}
              evmSecurity={report.chain?.evmSecurity}
              tokenSymbol={report.chain?.tokenReport?.symbol || tokenSymbol}
              tokenName={report.chain?.tokenReport?.name}
              address={report.chain?.mintAddress || report.target.mintAddress}
            />
          </div>
        )}

        {forensicTab === "holders" && report.chain?.deep?.holders && (
          <div className="p-5">
            <SniperCabalGraph
              mintAddress={report.chain.mintAddress}
              symbol={tokenSymbol}
              networkName={report.chain.networkName}
              holders={report.chain.deep.holders}
              onOpenWalletsToWatch={() => setForensicTab("wallets")}
            />
          </div>
        )}

        {forensicTab === "wallets" && report.chain?.deep?.holders && (
          <div className="p-5">
            <WalletsToWatchPanel
              mintAddress={report.chain.mintAddress}
              symbol={tokenSymbol}
              networkName={report.chain.networkName}
              chainFamily={report.chain.chainFamily}
              holders={report.chain.deep.holders}
              devAddress={report.chain.deep.devHistory?.devAddress}
            />
          </div>
        )}

        {forensicTab === "dev" && report.chain?.deep?.devHistory && (
          <div className="p-5">
            <DevHistoryPanel
              devHistory={report.chain.deep.devHistory}
              symbol={tokenSymbol}
              chainKey={
                (report.chain.deep.holders?.walletsToWatch?.[0]?.chainKey as
                  | WatchWalletChain
                  | undefined) ||
                (report.chain.evmSecurity?.chainKey as WatchWalletChain | undefined) ||
                (report.chain.mintAddress.startsWith("0x") ? "robinhood" : "solana")
              }
              tokenAddress={report.chain.mintAddress}
            />
          </div>
        )}

        {forensicTab === "browser" && isTokenReport && (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {renderBrowserStageCard("lg:col-span-7")}
            {renderAgentFeedCard("lg:col-span-5")}
          </div>
        )}

        {forensicTab === "autopsy" && (
          <div className="p-5">
            <RugAutopsyPanel report={report} />
          </div>
        )}

        {forensicTab === "proof" && (
          <div className="divide-y divide-white/[0.06]">
            {/* Claims vs Receipts Tracker */}
            <ClaimsReceiptsPanel
              report={report}
              onMonitorProject={() => {
                const params = new URLSearchParams();
                if (tokenSymbol) params.set("label", tokenSymbol);
                const ca =
                  report.chain?.mintAddress ||
                  report.target.contractAddress ||
                  report.target.mintAddress;
                if (ca) params.set("ca", ca);
                const chainKey =
                  report.chain?.evmSecurity?.chainKey ||
                  (ca?.startsWith("0x") ? "robinhood" : "solana");
                params.set("chain", chainKey);
                const web =
                  report.browser?.stops?.[0]?.url ||
                  report.chain?.deep?.metadata?.websites?.[0] ||
                  "";
                if (web) params.set("web", web);
                if (report.github?.fullName) params.set("repo", report.github.fullName);
                params.set("report", report.id);
                window.location.href = `/watchdog?${params.toString()}`;
              }}
            />

            {/* Verified Signals & Red Flags */}
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
              <div className="p-5 space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-300 inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verified Proof Signals</span>
                </h4>
                {report.verifiedSignals.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No independent proof signals established.
                  </p>
                ) : (
                  <ul className="space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {report.verifiedSignals.map((sig, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">•</span>
                        <span>{sig}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="p-5 space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-300 inline-flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Red Flags &amp; Gaps</span>
                </h4>
                {report.keyRedFlags.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No major contradiction flags triggered.
                  </p>
                ) : (
                  <ul className="space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {report.keyRedFlags.map((flag, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-rose-400 mt-0.5">•</span>
                        <span>{flag}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Tech Architecture & Codebase Forensics */}
            {report.github && report.github.exists && (
              <div className="p-5 space-y-3 border-t border-white/[0.06]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-[#84A7FF]" />
                    <span className="text-sm font-semibold text-white">
                      Tech Architecture &amp; Open Source Codebase
                    </span>
                  </div>
                  <a
                    href={report.github.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#2934FF]/15 border border-[#2934FF]/35 text-xs text-[#93C5FD] hover:text-white font-mono transition-colors"
                  >
                    <span>{report.github.fullName}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
                  <div className="p-3 rounded-lg bg-[#080A0F] border border-white/[0.07] space-y-1">
                    <div className="text-slate-400 text-[11px]">Primary Languages</div>
                    <div className="text-white font-semibold truncate">
                      {report.github.topLanguages.join(", ") || "N/A"}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#080A0F] border border-white/[0.07] space-y-1">
                    <div className="text-slate-400 text-[11px]">Recent Commits</div>
                    <div className="text-white font-semibold">
                      {report.github.recentCommitCount} commits
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#080A0F] border border-white/[0.07] space-y-1">
                    <div className="text-slate-400 text-[11px]">Burst Ratio (Rushed)</div>
                    <div
                      className={`font-semibold ${
                        report.github.burstCommitRatio > 0.6
                          ? "text-amber-300"
                          : "text-emerald-300"
                      }`}
                    >
                      {Math.round(report.github.burstCommitRatio * 100)}%
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#080A0F] border border-white/[0.07] space-y-1">
                    <div className="text-slate-400 text-[11px]">Repo Age &amp; Stars</div>
                    <div className="text-white font-semibold">
                      {report.github.ageDays ?? "N/A"}d · {report.github.stars}★
                    </div>
                  </div>
                </div>

                {report.github.topLevelFiles.length > 0 && (
                  <div className="p-3 rounded-lg bg-[#080A0F] border border-white/[0.07] text-xs font-mono space-y-1">
                    <div className="text-slate-400 text-[11px]">Key Tech Manifests &amp; Files</div>
                    <div className="text-slate-200 flex flex-wrap gap-1.5 pt-0.5">
                      {report.github.topLevelFiles.map((file) => (
                        <span
                          key={file}
                          className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[11px] text-slate-300"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Inspected Browser XHR API Payloads */}
            {(report.browser.inspectedApiPayloads?.length ||
              (report.browser.pageErrorsCount ?? 0) > 0) && (
              <div className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#93C5FD]">
                    Inspected Site XHR / JSON Payloads ({report.browser.inspectedApiPayloads?.length || 0})
                  </span>
                  {(report.browser.pageErrorsCount ?? 0) > 0 && (
                    <span className="px-2 py-0.5 rounded border border-rose-500/35 bg-rose-500/15 font-mono text-[11px] text-rose-300">
                      {report.browser.pageErrorsCount} Browser Console Errors
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  {(report.browser.inspectedApiPayloads || []).slice(0, 6).map((p, i) => (
                    <div
                      key={`${p.url}-${i}`}
                      className="p-3 rounded-lg border border-white/[0.07] bg-[#080A0F] space-y-1.5 overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 text-slate-300">
                        <span className="truncate">{p.url}</span>
                        <span className="text-emerald-400 shrink-0 tabular-nums">
                          HTTP {p.status}
                        </span>
                      </div>
                      <pre className="text-[11px] text-slate-400 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                        {p.jsonExcerpt}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {forensicTab === "telemetry" && (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono text-slate-300">
            {report.visionSummary && (
              <div className="md:col-span-2 p-4 rounded-xl bg-[#080A0F] border border-white/[0.07] space-y-1.5">
                <div className="text-[#93C5FD] uppercase">
                  Venice Vision UI Audit ({report.modelsUsed[0]})
                </div>
                <p className="font-sans text-sm text-slate-200 leading-relaxed">
                  {report.visionSummary}
                </p>
              </div>
            )}

            {report.github && (
              <div className="p-4 rounded-xl bg-[#080A0F] border border-white/[0.07] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#93C5FD]">GITHUB FORENSICS</span>
                  <a
                    href={report.github.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
                  >
                    <span>Open Repo</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div>Repo: {report.github.fullName}</div>
                <div>
                  Fork: {report.github.isFork ? `Yes (${report.github.forkParent})` : "No"} ·
                  Age: {report.github.ageDays ?? "N/A"}d
                </div>
                <div>
                  Commits (sampled): {report.github.recentCommitCount} · Burst ratio:{" "}
                  {Math.round(report.github.burstCommitRatio * 100)}%
                </div>
                <div>
                  Languages: {report.github.topLanguages.join(", ") || "N/A"}
                </div>
                <div className="text-slate-400 break-all">
                  Files: {report.github.topLevelFiles.join(", ") || "None"}
                </div>
              </div>
            )}

            {report.chain && (
              <div className="p-4 rounded-xl bg-[#080A0F] border border-white/[0.07] space-y-2">
                <div className="text-[#93C5FD]">
                  {report.chain.chainFamily === "evm" || report.chain.mintAddress.startsWith("0x")
                    ? (report.chain.networkName || "EVM").toUpperCase()
                    : "SOLANA"}{" "}
                  ON-CHAIN CONTRACT &amp; DEX
                </div>
                <div className="break-all">
                  {report.chain.chainFamily === "evm" || report.chain.mintAddress.startsWith("0x")
                    ? "Contract"
                    : "Mint"}
                  : {report.chain.mintAddress}
                </div>
                {report.chain.tokenReport && (
                  <>
                    <div>
                      Program: {report.chain.tokenReport.tokenProgram} · Symbol:{" "}
                      {report.chain.tokenReport.symbol || "N/A"}
                    </div>
                    <div>
                      MintAuth: {report.chain.tokenReport.mintAuthority || "Revoked"} ·
                      FreezeAuth: {report.chain.tokenReport.freezeAuthority || "Revoked"}
                    </div>
                    <div>
                      Top-5 Supply: {report.chain.tokenReport.top5Pct.toFixed(2)}%
                    </div>
                  </>
                )}
                {report.chain.dexPair && (
                  <div>
                    DEX ({report.chain.dexPair.dexId}): Liq $
                    {report.chain.dexPair.liquidityUsd.toLocaleString("en-US")} · FDV{" "}
                    {report.chain.dexPair.fdv
                      ? `$${report.chain.dexPair.fdv.toLocaleString("en-US")}`
                      : "N/A"}
                  </div>
                )}
              </div>
            )}

            {report.domain && (
              <div className="p-4 rounded-xl bg-[#080A0F] border border-white/[0.07] space-y-2">
                <div className="text-[#93C5FD]">DOMAIN &amp; BROWSER ENGINE</div>
                <div>Host: {report.domain.hostname}</div>
                <div>
                  Status: {report.domain.domainEval.status} · Risk Score:{" "}
                  {report.domain.domainEval.riskScore}/100
                </div>
                <div>
                  RDAP Registration: {report.domain.rdapCreatedAt || "Unavailable"}{" "}
                  {report.domain.domainAgeDays !== null
                    ? `(${report.domain.domainAgeDays}d)`
                    : ""}
                </div>
                <div>
                  Runner: {report.browser.executableLabel} · Total XHR:{" "}
                  {report.browser.totalXhrObserved} · Errors:{" "}
                  {report.browser.pageErrorsCount ?? 0}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <ClickSpark sparkColor="#60A5FA" sparkRadius={24} sparkCount={8} sparkSize={9}>
      <div className="solshield-subpage relative min-h-screen bg-[#07080D] text-[#F8F8FA] selection:bg-[#2934FF] selection:text-white overflow-x-hidden">
        {/* Subtle Backdrop DotGrid — isolated behind opaque panels */}
        <div className="pointer-events-none fixed inset-0 z-0 opacity-40">
          <InteractiveDotGrid />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 -top-40 h-[460px] z-0"
          style={{
            background:
              "radial-gradient(62% 56% at 50% 0%, rgba(41, 52, 255, 0.2) 0%, rgba(79, 70, 229, 0.06) 48%, rgba(7, 8, 13, 0) 100%)",
          }}
        />

        {/* Sticky Top Bar (with inline compact re-search when results are loaded) */}
        <header className="border-b border-white/[0.08] bg-[#0A0C12]/92 backdrop-blur-xl sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 shrink-0">
              <Magnet padding={20} magnetStrength={4.5}>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden lg:inline">SolShield</span>
                </Link>
              </Magnet>
              <span className="text-white/20 hidden sm:inline">/</span>
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/logo.png?v=2"
                  alt="SolShield Logo"
                  className="w-7 h-7 rounded-md border border-white/15 shrink-0"
                />
                <span className="font-semibold tracking-tight text-sm sm:text-base truncate">
                  BuildCheck
                </span>
              </div>
              <Link
                href="/wallet-detox"
                className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-emerald-300/90 hover:text-white border border-emerald-500/25 hover:border-emerald-400/50 bg-emerald-500/[0.06] transition-colors"
              >
                Wallet Detox
              </Link>
              <Link
                href="/dev-lineage"
                className="hidden md:inline-flex items-center px-2.5 py-1 rounded-md text-xs text-purple-300/90 hover:text-white border border-purple-500/25 hover:border-purple-400/50 bg-purple-500/[0.06] transition-colors"
              >
                Dev Lineage
              </Link>
              <Link
                href="/wallets"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[#BFD0FF] hover:text-white border border-[#2934FF]/35 hover:border-[#2934FF]/60 bg-[#2934FF]/12 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Watchlist{watchedCount > 0 ? ` (${watchedCount})` : ""}</span>
              </Link>
            </div>

            {/* Inline Header Search Bar (visible after scan so cockpit stays at top) */}
            {showCompactHeaderSearch && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runCheck();
                }}
                className="hidden md:flex flex-1 max-w-md items-center gap-1.5 bg-[#07080D] border border-white/[0.1] focus-within:border-[#2934FF]/70 rounded-lg px-2.5 py-1.5"
              >
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste Solana CA, EVM 0x contract, GitHub, or URL..."
                  className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none min-w-0"
                />
                <button
                  type="submit"
                  disabled={isRunning || !input.trim()}
                  title="Run BuildCheck — Powered by Venice AI"
                  className="px-2.5 py-1 rounded bg-[#2934FF] hover:bg-[#1E28E6] text-white text-[11px] font-semibold shrink-0 cursor-pointer disabled:opacity-40"
                >
                  Run · Venice AI
                </button>
              </form>
            )}

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEnableBrowser((prev) => !prev)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  enableBrowser
                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                    : "border-white/12 bg-white/5 text-slate-300"
                }`}
                title="Toggle headless Chromium live observation"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    enableBrowser ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {enableBrowser ? "Live Browser: On" : "API Only Mode"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowKeyInput((prev) => !prev)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap ${
                  veniceApiKey.trim()
                    ? "border-[#2934FF]/60 bg-[#2934FF]/20 text-white"
                    : "border-white/12 bg-white/5 text-slate-300 hover:border-white/25"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span className="sm:hidden">
                  {veniceApiKey.trim() ? "Venice Active" : "BYOK"}
                </span>
                <span className="hidden sm:inline">
                  {veniceApiKey.trim() ? "Venice Key Active" : "Venice BYOK"}
                </span>
              </button>

              <ThemeToggleButton />
            </div>
          </div>

          {showKeyInput && (
            <div className="border-t border-white/10 bg-[#0D1017] px-4 sm:px-6 py-3 rb-fade-up">
              <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <p className="text-xs text-slate-300">
                  Optional BYOK Venice API key (stored only in browser{" "}
                  <code className="font-mono text-[#93C5FD]">sessionStorage</code>
                  ). Enables live{" "}
                  <code className="font-mono text-[#93C5FD]">
                    qwen3-vl-235b-a22b
                  </code>{" "}
                  screenshot vision +{" "}
                  <code className="font-mono text-[#93C5FD]">llama-3.3-70b</code>{" "}
                  zero-retention reasoning.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="password"
                    value={veniceApiKey}
                    onChange={(e) => handleSaveKey(e.target.value)}
                    placeholder="vn_..."
                    className="w-56 px-3 py-1.5 rounded-md text-xs font-mono bg-[#07080D] border border-white/15 text-white focus:outline-none focus:border-[#2934FF]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeyInput(false)}
                    className="px-3 py-1.5 rounded-md text-xs bg-white/10 hover:bg-white/15 text-white cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </header>

        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          {/* Mobile Search Strip when Result View is Active */}
          {showCompactHeaderSearch && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runCheck();
              }}
              className="flex md:hidden items-center gap-2 p-1.5 rounded-xl bg-[#0D1017] border border-white/[0.1]"
            >
              <Search className="w-4 h-4 text-slate-400 ml-2 shrink-0" />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste Solana CA, X post, GitHub, or URL..."
                className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none min-w-0"
              />
              <button
                type="submit"
                disabled={isRunning || !input.trim()}
                className="px-3 py-2 rounded-lg bg-[#2934FF] text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                Scan
              </button>
            </form>
          )}

          {/* MODE 1 & 2 HERO + SEARCH STAGE (Shown on Idle or Live Streaming) */}
          {(!report || isRunning) && (
            <section className="space-y-5 pt-2">
              <div className="max-w-3xl space-y-3">
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-[#93C5FD]">
                  <CobaltSphere3D className="w-4 h-4 shrink-0" />
                  <DecryptedText
                    text="SOLSHIELD® PROOF-OF-BUILD AGENT"
                    speed={24}
                    maxIterations={10}
                    animateOn="both"
                    className="tracking-wider font-semibold"
                  />
                  <span className="text-white/25">·</span>
                  <ShinyText
                    text={
                      guestChecksUsed === 0
                        ? "First check needs no account"
                        : `${guestChecksUsed} check(s) run in this session`
                    }
                    speedSec={4}
                  />
                </div>

                <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.12] text-white">
                  <BlurText text="Verify Any Token, Repo, or Claim" delay={18} />{" "}
                  <BlurText
                    text="Before You Trust It."
                    delay={28}
                    className="text-[#84A7FF] drop-shadow-[0_0_24px_rgba(41,52,255,0.35)]"
                  />
                </h1>

                <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-[65ch]">
                  Paste a Solana mint address, X post, website, or GitHub repo.
                  SolShield launches headless Chromium to audit UI claims vs live XHR,
                  traces cabal clusters and dev burns on-chain, and delivers a factual proof
                  verdict.
                </p>
              </div>

              <StarBorder
                active={isRunning}
                speed={isRunning ? "2.1s" : "6.5s"}
                color={isRunning ? "#60A5FA" : "#2934FF"}
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runCheck();
                  }}
                  className="bg-[#0D1017] p-2 flex flex-col sm:flex-row sm:items-center gap-2"
                >
                  <div className="relative flex-1 flex items-center min-w-0">
                    <Search className="w-4 h-4 text-slate-400 ml-3 shrink-0" />
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Paste Solana CA, EVM 0x contract (Robinhood Chain/ETH), X post, GitHub, or URL"
                      className="w-full px-3 py-3 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none min-w-0"
                    />
                  </div>
                  <Magnet padding={28} magnetStrength={5}>
                    <button
                      type="submit"
                      disabled={isRunning || !input.trim()}
                      aria-label="Run BuildCheck — Powered by Venice AI"
                      className="px-5 py-2.5 rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] disabled:opacity-45 disabled:cursor-not-allowed text-white transition-all inline-flex items-center justify-center gap-2.5 shrink-0 cursor-pointer shadow-[0_0_24px_rgba(41,52,255,0.4)]"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          <span className="flex flex-col items-start leading-tight text-left">
                            <span className="text-sm font-semibold">Inspecting Live...</span>
                            <span className="text-[10px] font-mono font-medium text-blue-100/80 tracking-wide">
                              Powered by Venice AI
                            </span>
                          </span>
                        </>
                      ) : (
                        <>
                          <Activity className="w-4 h-4 shrink-0" />
                          <span className="flex flex-col items-start leading-tight text-left">
                            <span className="text-sm font-semibold">Run BuildCheck</span>
                            <span className="text-[10px] font-mono font-medium text-blue-100/80 tracking-wide">
                              Powered by Venice AI
                            </span>
                          </span>
                        </>
                      )}
                    </button>
                  </Magnet>
                </form>
              </StarBorder>
            </section>
          )}

          {errorMsg && (
            <div className="p-4 rounded-xl border border-red-500/40 bg-[#1B0D11] text-red-200 text-sm flex items-start gap-2.5 rb-fade-up">
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* MODE 1 IDLE LANDING CAPABILITIES (Replaces giant empty Waiting box) */}
          {!isRunning && !report && (
            <section className="rounded-xl border border-white/[0.08] bg-[#0D1017] divide-y md:divide-y-0 md:divide-x divide-white/[0.07] grid grid-cols-1 md:grid-cols-3">
              <div className="p-5 space-y-2">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-[#93C5FD]">
                  <Network className="w-4 h-4" />
                  <span>Cabal &amp; Dev Forensic Trace</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Traces co-funded buyer clusters, same-slot launch snipers, creator fee
                  claims, token burns, and deployer history directly via Solana RPC.
                </p>
              </div>
              <div className="p-5 space-y-2">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-300">
                  <Monitor className="w-4 h-4" />
                  <span>Live Headless Chromium + XHR Audit</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Renders target dApps and GitHub repos live while capturing network JSON
                  payloads to catch devnet endpoints masquerading as mainnet launches.
                </p>
              </div>
              <div className="p-5 space-y-2">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-amber-300">
                  <Layers className="w-4 h-4" />
                  <span>TradingView + Burn Overlay</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Correlates real-time OHLCV candlesticks with verified dev burn &amp; launch
                  events alongside live Jupiter valuation quotes.
                </p>
              </div>
            </section>
          )}

          {/* RECENTLY SCANNED TOKENS (Real Audits Only — Zero Dummy Presets) */}
          {!isRunning && !report && recentTokens.length > 0 && (
            <AuditLedgerSection
              tokens={recentTokens}
              onOpenPermalink={(reportId, fallbackTarget) =>
                void loadPermalinkReport(reportId, fallbackTarget)
              }
              onRunAudit={(mintAddress) => void runCheck(mintAddress)}
              onRefresh={() => void loadRecentScannedTokens()}
              onClearLocal={() => {
                clearLocalScannedTokens();
                void loadRecentScannedTokens();
              }}
            />
          )}

          {/* MODE 2 LIVE STREAMING OBSERVATION STAGE */}
          {isRunning && (
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start rb-fade-up">
              {renderBrowserStageCard("lg:col-span-7")}
              {renderAgentFeedCard("lg:col-span-5")}
            </section>
          )}

          {/* MODE 3 RESULT COCKPIT */}
          {report && !isRunning && (
            <div className="space-y-5 rb-fade-up">
              {/* Executive Identity + Verdict Cockpit */}
              <SpotlightCard
                spotlightColor={
                  report.verdict === "VERIFIED_BUILD"
                    ? "rgba(16, 185, 129, 0.12)"
                    : report.verdict === "UNPROVEN_HYPE"
                      ? "rgba(245, 158, 11, 0.12)"
                      : "rgba(239, 68, 68, 0.14)"
                }
                className="rounded-xl border border-white/[0.09] bg-[#0D1017] overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
              >
                <div className="divide-y divide-white/[0.07]">
                  {/* Token Identity Strip (if Solana Mint) */}
                  {isTokenReport && report.chain && (
                    <div className="px-5 py-4 bg-[#090B10] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <TokenAvatar imageUrl={tokenMeta?.imageUrl} symbol={tokenSymbol} />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base sm:text-lg font-semibold text-white truncate">
                              {tokenName}
                            </h2>
                            <span className="font-mono text-xs font-semibold text-[#84A7FF]">
                              ${tokenSymbol}
                            </span>
                            {tokenMeta?.launchpad && (
                              <span className="px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] font-mono text-[10px] text-slate-300">
                                {tokenMeta.launchpad}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => void handleCopyCa(report.chain!.mintAddress)}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#07080D] border border-white/[0.08] hover:border-white/25 font-mono text-[11px] text-slate-300 cursor-pointer transition-colors"
                              title="Copy contract address"
                            >
                              <span>
                                {report.chain.mintAddress.slice(0, 6)}...
                                {report.chain.mintAddress.slice(-5)}
                              </span>
                              {copiedCa ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3 text-slate-500" />
                              )}
                            </button>

                            {websiteLink && (
                              <a
                                href={websiteLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white"
                              >
                                <Globe className="w-3 h-3 text-[#84A7FF]" />
                                <span>Website</span>
                              </a>
                            )}
                            {twitterLink && (
                              <a
                                href={twitterLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white"
                              >
                                <ExternalLink className="w-3 h-3 text-[#84A7FF]" />
                                <span>X</span>
                              </a>
                            )}
                            <a
                              href={
                                report.chain.chainFamily === "evm" || report.chain.mintAddress.startsWith("0x")
                                  ? (report.robinhood?.blockscoutUrl || `https://etherscan.io/token/${report.chain.mintAddress}`)
                                  : `https://solscan.io/token/${report.chain.mintAddress}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white"
                            >
                              <ExternalLink className="w-3 h-3 text-[#84A7FF]" />
                              <span>
                                {report.chain.chainFamily === "evm" || report.chain.mintAddress.startsWith("0x")
                                  ? (report.chain.networkName?.includes("Robinhood") ? "Blockscout" : "Explorer")
                                  : "Solscan"}
                              </span>
                            </a>
                          </div>
                        </div>
                      </div>

                      {tokenMarket && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-5 text-xs shrink-0">
                          <div>
                            <div className="text-[11px] text-slate-400">Market Cap</div>
                            <div className="font-mono tabular-nums font-semibold text-white">
                              {formatCompactUsd(tokenMarket.marketCapUsd)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">Price</div>
                            <div className="font-mono tabular-nums font-semibold text-white">
                              {formatCompactUsd(tokenMarket.priceUsd)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">Liquidity</div>
                            <div className="font-mono tabular-nums font-semibold text-white">
                              {formatCompactUsd(tokenMarket.liquidityUsd)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">24h Vol</div>
                            <div className="font-mono tabular-nums font-semibold text-white">
                              {formatCompactUsd(tokenMarket.volume24hUsd)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">24h Change</div>
                            <div
                              className={`font-mono tabular-nums font-semibold ${
                                tokenMarket.priceChange24h === null
                                  ? "text-slate-300"
                                  : tokenMarket.priceChange24h >= 0
                                    ? "text-emerald-400"
                                    : "text-rose-400"
                              }`}
                            >
                              {tokenMarket.priceChange24h !== null
                                ? `${tokenMarket.priceChange24h >= 0 ? "+" : ""}${tokenMarket.priceChange24h.toFixed(1)}%`
                                : "—"}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Verdict Banner Strip */}
                  <TiltedCard rotateAmplitude={1.2} scaleOnHover={1.002} showGlare={true}>
                    <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
                      <div className="space-y-2 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span
                            className={`px-2.5 py-0.5 rounded-md text-xs font-mono uppercase tracking-wider border inline-flex items-center gap-1.5 ${verdictStyle.badge}`}
                          >
                            <verdictStyle.Icon className="w-3.5 h-3.5" />
                            <span>{verdictStyle.label}</span>
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            {report.inferenceMode === "venice-live-api"
                              ? `Venice AI · ${report.modelsUsed.join(" + ")}`
                              : "Deterministic Proof Engine"}
                          </span>
                          {report.cache?.hit && (
                            <span
                              title={`Reused shared scan cached at ${report.cache.cachedAt}`}
                              className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-emerald-500/12 border border-emerald-500/30 text-emerald-300"
                            >
                              Cached Result · Reused
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg sm:text-xl font-semibold text-white">
                          {report.headline}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                          {report.executiveSummary}
                        </p>
                      </div>

                      <div className="flex flex-col sm:items-end gap-3 shrink-0">
                        <div className="flex items-baseline gap-1.5">
                          <CountUp
                            to={report.authenticityScore}
                            durationMs={850}
                            className={`text-4xl sm:text-5xl font-mono tabular-nums font-bold ${verdictStyle.scoreText}`}
                          />
                          <span className="text-base font-mono text-slate-500">
                            / 100
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {report.social && (
                            <button
                              type="button"
                              data-testid="verdict-mindshare-cta"
                              onClick={() => {
                                setForensicTab("mindshare");
                                forensicPanelRef.current?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                              }}
                              className="min-h-[42px] px-4 py-2 rounded-xl bg-gradient-to-r from-[#0284C7] to-[#2934FF] hover:brightness-110 border border-[#60A5FA]/55 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 shadow-[0_8px_22px_rgba(2,132,199,0.28)] cursor-pointer transition-all"
                            >
                              <Radio className="w-4 h-4 shrink-0" />
                              <span>
                                X Mindshare ({report.social.mindshareScore}/100)
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleExportPng}
                            disabled={isExportingPng}
                            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-[#2934FF] hover:bg-[#1E28E6] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>
                              {isExportingPng
                                ? "Rendering PNG..."
                                : "Download X Evidence Card"}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyShareLink}
                            className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/12 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            {copiedShareLink ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Link Copied</span>
                              </>
                            ) : (
                              <>
                                <Link2 className="w-3.5 h-3.5" />
                                <span>Copy Share Link</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => runCheck(report.target.rawInput, { forceRefresh: true })}
                            disabled={isRunning}
                            className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/12 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Re-run Live</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyXPost}
                            className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/12 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            {copiedSummary ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Copied Summary</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy X Verdict</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </TiltedCard>

                  {/* Dual-Axis Forensic Profile + Deployer Track Record */}
                  <WarRoomDualAxisStrip report={report} />

                  {/* 4/5 Pillar Scores Strip */}
                  <div
                    className={`grid grid-cols-2 ${
                      report.componentScores.holdersProof !== undefined &&
                      report.componentScores.holdersProof !== null
                        ? "sm:grid-cols-5"
                        : "sm:grid-cols-4"
                    } divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] bg-[#0A0C12]`}
                  >
                    {[
                      { label: "Code Proof", val: report.componentScores.codeProof },
                      { label: "On-Chain Proof", val: report.componentScores.chainProof },
                      ...(report.componentScores.holdersProof !== undefined &&
                      report.componentScores.holdersProof !== null
                        ? [
                            {
                              label: "Holders & Cabal",
                              val: report.componentScores.holdersProof,
                            },
                          ]
                        : []),
                      { label: "Domain & Web", val: report.componentScores.domainProof },
                      { label: "Claim Alignment", val: report.componentScores.claimAlignment },
                    ].map((item) => {
                      const pct = item.val !== null ? Math.max(0, Math.min(100, item.val)) : 0;
                      const barTone =
                        item.val === null
                          ? "bg-white/10"
                          : item.val >= 75
                            ? "bg-emerald-400"
                            : item.val >= 50
                              ? "bg-amber-400"
                              : "bg-rose-400";
                      return (
                        <div key={item.label} className="px-4 py-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-400">{item.label}</span>
                            <span className="font-mono tabular-nums font-semibold text-white">
                              {item.val !== null ? `${item.val}/100` : "N/A"}
                            </span>
                          </div>
                          <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              style={{ width: `${pct}%` }}
                              className={`h-full ${barTone} transition-all duration-700`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* X Mindshare & KOL Discourse Pulse Quick Strip */}
                  {report.social ? (
                    <div
                      data-testid="mindshare-overview-strip"
                      className="px-5 py-4 border-t border-[#5D82FF]/25 bg-gradient-to-r from-[#0B1120] via-[#090D18] to-[#0B101D] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
                          <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.08em] text-[#93C5FD] font-bold">
                            <Radio className="w-4 h-4" />
                            <span>X Mindshare Architecture</span>
                            <span className="text-white tabular-nums">
                              {report.social.mindshareScore}/100
                            </span>
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                              report.social.quadrant === "CONVICTION_RUNNER"
                                ? "bg-emerald-500/12 text-emerald-300 border-emerald-500/35"
                                : report.social.quadrant === "UNDERVALUED_BUILDER"
                                  ? "bg-[#2934FF]/18 text-[#93C5FD] border-[#5D82FF]/40"
                                  : report.social.quadrant === "NARRATIVE_OVERHEAT"
                                    ? "bg-rose-500/12 text-rose-300 border-rose-500/35"
                                    : report.social.quadrant === "CONTESTED_DISCOURSE"
                                      ? "bg-amber-500/12 text-amber-300 border-amber-500/35"
                                      : "bg-white/[0.05] text-slate-300 border-white/15"
                            }`}
                          >
                            {report.social.quadrantLabel}
                          </span>
                        </div>

                        <div className="text-slate-300 font-mono text-xs tabular-nums">
                          {report.social.totalPostsSampled > 0
                            ? `${report.social.kolCount} KOLs · ${report.social.sentimentBreakdown.bullishPct}% bull / ${report.social.sentimentBreakdown.skepticalPct}% skeptical · ${report.social.totalPostsSampled} live posts across topics & cohorts`
                            : report.social.officialProfile
                              ? `@${report.social.officialProfile.username} (${report.social.officialProfile.followersCount.toLocaleString("en-US")} followers) · 0 recent mentions`
                              : "Pre-discovery on X"}
                        </div>
                      </div>

                      <button
                        type="button"
                        data-testid="jump-mindshare-tab"
                        onClick={() => {
                          setForensicTab("mindshare");
                          forensicPanelRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }}
                        className="min-h-[46px] px-5 py-2.5 rounded-xl border border-[#60A5FA]/60 bg-[#2934FF] hover:bg-[#1E28E6] text-xs sm:text-sm font-semibold text-white inline-flex items-center justify-center gap-2 shadow-[0_10px_28px_rgba(41,52,255,0.34)] cursor-pointer transition-all shrink-0"
                      >
                        <Radio className="w-4 h-4 shrink-0" />
                        <span>Open X Mindshare &amp; Treemap →</span>
                      </button>
                    </div>
                  ) : (
                    <div
                      data-testid="mindshare-overview-strip"
                      className="px-5 py-3.5 border-t border-[#5D82FF]/20 bg-gradient-to-r from-[#0B1120] via-[#090D18] to-[#0B101D] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-slate-300 min-w-0">
                        <Radio className="w-4 h-4 text-[#60A5FA] shrink-0" />
                        <span className="font-semibold text-white">X Mindshare &amp; KOL Discourse:</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/12 border border-blue-500/30 text-blue-300">
                          On-Demand
                        </span>
                        <span className="text-slate-400 text-[11px] hidden md:inline">
                          — Scan finished fast without social lag. Click to analyze live X threads &amp; KOLs.
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setForensicTab("mindshare");
                            forensicPanelRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/10 text-xs font-medium transition-colors cursor-pointer"
                        >
                          View Tab
                        </button>
                        <button
                          type="button"
                          onClick={handleScanMindshare}
                          disabled={isScanningMindshare}
                          className="px-3.5 py-1.5 rounded-lg bg-[#2934FF] hover:bg-[#3D49FF] disabled:bg-[#2934FF]/40 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-[0_2px_12px_rgba(41,52,255,0.3)] cursor-pointer"
                        >
                          {isScanningMindshare ? (
                            <>
                              <Sparkles className="w-3.5 h-3.5 animate-spin text-[#93C5FD]" />
                              <span>Scanning X...</span>
                            </>
                          ) : (
                            <>
                              <Radio className="w-3.5 h-3.5 text-[#93C5FD]" />
                              <span>Scan Mindshare Now</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Robinhood Forensics & Listing Status Strip */}
                  {report.robinhood && (
                    <div
                      data-testid="robinhood-overview-strip"
                      className={`px-5 py-3.5 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                        report.robinhood.status === "IMPOSTOR_ALERT"
                          ? "border-red-500/40 bg-gradient-to-r from-red-950/40 via-[#0A0D14] to-red-950/30"
                          : report.robinhood.status === "TICKER_CLONE_WARNING"
                            ? "border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-[#0A0D14] to-amber-950/30"
                            : report.robinhood.status === "OFFICIAL_LISTED"
                              ? "border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-[#0A0D14] to-emerald-950/30"
                              : report.robinhood.status === "ROBINHOOD_CHAIN_NATIVE"
                                ? "border-sky-500/40 bg-gradient-to-r from-sky-950/40 via-[#0A0D14] to-sky-950/30"
                                : "border-white/[0.08] bg-[#0A0C12]"
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 text-white">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            <span>Robinhood Telemetry:</span>
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border ${
                              report.robinhood.status === "OFFICIAL_LISTED"
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                : report.robinhood.status === "IMPOSTOR_ALERT"
                                  ? "bg-red-500/20 text-red-300 border-red-500/50 animate-pulse"
                                  : report.robinhood.status === "TICKER_CLONE_WARNING"
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                                    : report.robinhood.status === "ROBINHOOD_CHAIN_NATIVE"
                                      ? "bg-sky-500/20 text-sky-300 border-sky-500/50"
                                      : "bg-white/[0.05] text-slate-400 border-white/10"
                            }`}
                          >
                            {report.robinhood.status.replace(/_/g, " ")}
                          </span>
                          {report.robinhood.tradingPair && (
                            <span className="text-emerald-300 font-mono text-[11px]">
                              ({report.robinhood.tradingPair})
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 line-clamp-1">
                          {report.robinhood.warning || report.robinhood.summary}
                        </p>
                      </div>

                      <button
                        type="button"
                        data-testid="jump-robinhood-tab"
                        onClick={() => {
                          setForensicTab("robinhood");
                          forensicPanelRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }}
                        className="self-start sm:self-auto px-3.5 py-1.5 rounded-lg text-xs font-semibold font-mono text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.15] transition-all cursor-pointer whitespace-nowrap"
                      >
                        Inspect Robinhood Receipts →
                      </button>
                    </div>
                  )}
                </div>
              </SpotlightCard>

              {/* SolShield Proof Dispatch — Original Structured Narrative & Forensic Balance Sheet */}
              <ProofDispatchCard report={report} />

              {/* RESULT BODY — Asymmetric War-Room for Tokens vs Clean Observation+Proof for Repos/Sites */}
              {isTokenReport && report.chain ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left 8 Columns: TradingView Chart + Integrated Forensic Tabs */}
                  <div className="lg:col-span-8 space-y-5 min-w-0">
                    <TradingViewTokenChart
                      mintAddress={report.chain.mintAddress}
                      poolAddress={
                        tokenMarket?.poolAddress || report.chain.dexPair?.pairAddress
                      }
                      symbol={tokenSymbol}
                      totalSupply={report.chain.tokenReport?.supplyUi}
                      devTxs={report.chain.deep?.devHistory.recentTxs}
                      chainFamily={
                        report.chain.chainFamily ||
                        (report.chain.mintAddress.startsWith("0x") ? "evm" : "solana")
                      }
                      networkName={
                        report.chain.networkName ||
                        report.robinhood?.networkName ||
                        report.chain.deep?.metadata?.launchpad ||
                        undefined
                      }
                      quoteSymbol={
                        report.chain.dexPair?.quoteSymbol ||
                        (report.chain.chainFamily === "evm" ||
                        report.chain.mintAddress.startsWith("0x")
                          ? (report.chain.networkName?.toLowerCase().includes("robinhood")
                              ? "ETH"
                              : "USD")
                          : "SOL")
                      }
                    />
                    {renderForensicTabPanel()}
                  </div>

                  {/* Right 4 Columns Sticky Utility Sidebar: Swap + Pulse + Quick Security Specs */}
                  <aside className="lg:col-span-4 lg:sticky lg:top-20 space-y-4 min-w-0">
                    <ShieldedSwapPanel
                      mintAddress={report.chain.mintAddress}
                      symbol={tokenSymbol}
                      decimals={report.chain.tokenReport?.decimals ?? 6}
                      priceUsd={tokenMarket?.priceUsd}
                      chainFamily={
                        report.chain.chainFamily ||
                        (report.chain.mintAddress.startsWith("0x") ? "evm" : "solana")
                      }
                      networkName={
                        report.chain.networkName ||
                        report.robinhood?.networkName ||
                        report.chain.deep?.metadata?.launchpad ||
                        undefined
                      }
                      robinhood={report.robinhood || report.chain.robinhood}
                      dexPairUrl={report.chain.dexPair?.pairUrl}
                    />

                    {/* Market Telemetry + Delta Since 1st Audit + Audit Checkpoints */}
                    <MarketTelemetryPanel
                      tokenMarket={tokenMarket}
                      dexPair={report.chain.dexPair}
                      directoryEntry={matchedDirectoryEntry}
                      activeReportId={report.id}
                      onSelectReportId={(reportId) =>
                        void loadPermalinkReport(reportId)
                      }
                    />

                    {/* Token Security & Dev Spec Sheet */}
                    <div className="rounded-xl border border-white/[0.08] bg-[#0D1017] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-white/[0.06] bg-[#090B10] flex items-center justify-between text-xs font-medium text-white">
                        <span>Token &amp; Dev Specs</span>
                        {report.chain.tokenReport && (
                          <span className="font-mono text-[10px] text-slate-400">
                            {normalizeScannedTokenProgram(
                              report.chain.tokenReport.tokenProgram,
                              report.chain.mintAddress
                            )}
                          </span>
                        )}
                      </div>
                      <div className="divide-y divide-white/[0.06] text-xs px-4">
                        {report.chain.mintAddress.startsWith("0x") ? (
                          <>
                            <div className="py-2.5 flex items-center justify-between gap-2">
                              <span className="text-slate-400">Contract Standard</span>
                              <span className="font-mono text-sky-300">
                                {normalizeScannedTokenProgram(
                                  report.chain.tokenReport?.tokenProgram,
                                  report.chain.mintAddress
                                )}
                              </span>
                            </div>
                            <div className="py-2.5 flex items-center justify-between gap-2">
                              <span className="text-slate-400">Network / Status</span>
                              <span className="font-mono text-emerald-400 text-right">
                                {report.robinhood?.networkName ||
                                  report.chain.networkName ||
                                  report.chain.deep?.metadata?.launchpad ||
                                  "EVM Smart Contract"}
                              </span>
                            </div>
                            {report.chain.evmSecurity && (
                              <>
                                <div className="py-2.5 flex items-center justify-between gap-2">
                                  <span className="text-slate-400">Honeypot / Tax</span>
                                  <span
                                    className={`font-mono ${
                                      report.chain.evmSecurity.honeypotStatus === "HONEYPOT"
                                        ? "text-rose-400"
                                        : report.chain.evmSecurity.honeypotStatus === "HIGH_TAX"
                                          ? "text-amber-300"
                                          : report.chain.evmSecurity.honeypotStatus === "SELLABLE"
                                            ? "text-emerald-400"
                                            : "text-sky-300"
                                    }`}
                                  >
                                    {report.chain.evmSecurity.honeypotStatus === "UNVERIFIED"
                                      ? "Bytecode Checked"
                                      : `${report.chain.evmSecurity.honeypotStatus}${
                                          report.chain.evmSecurity.sellTaxPct !== null
                                            ? ` (${report.chain.evmSecurity.buyTaxPct ?? 0}%/${report.chain.evmSecurity.sellTaxPct}%)`
                                            : ""
                                        }`}
                                  </span>
                                </div>
                                <div className="py-2.5 flex items-center justify-between gap-2">
                                  <span className="text-slate-400">Proxy / Owner</span>
                                  <span
                                    className={`font-mono ${
                                      report.chain.evmSecurity.isProxy
                                        ? "text-amber-300"
                                        : report.chain.evmSecurity.ownershipRenounced === true
                                          ? "text-emerald-400"
                                          : "text-slate-300"
                                    }`}
                                  >
                                    {report.chain.evmSecurity.isProxy
                                      ? report.chain.evmSecurity.proxyType || "Proxy"
                                      : report.chain.evmSecurity.ownershipRenounced === true
                                        ? "Immutable · Renounced"
                                        : "Non-Proxy"}
                                  </span>
                                </div>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="py-2.5 flex items-center justify-between gap-2">
                              <span className="text-slate-400">Mint Authority</span>
                              <span
                                className={`font-mono ${
                                  report.chain.tokenReport?.mintAuthority === null
                                    ? "text-emerald-400"
                                    : "text-rose-400"
                                }`}
                              >
                                {report.chain.tokenReport?.mintAuthority === null
                                  ? "Revoked (Null)"
                                  : "Active"}
                              </span>
                            </div>
                            <div className="py-2.5 flex items-center justify-between gap-2">
                              <span className="text-slate-400">Freeze Authority</span>
                              <span
                                className={`font-mono ${
                                  report.chain.tokenReport?.freezeAuthority === null
                                    ? "text-emerald-400"
                                    : "text-rose-400"
                                }`}
                              >
                                {report.chain.tokenReport?.freezeAuthority === null
                                  ? "Revoked (Null)"
                                  : "Active"}
                              </span>
                            </div>
                          </>
                        )}
                        <div className="py-2.5 flex items-center justify-between gap-2">
                          <span className="text-slate-400">Top-5 Holders</span>
                          <span className="font-mono tabular-nums text-white">
                            {report.chain.tokenReport
                              ? `${report.chain.tokenReport.top5Pct.toFixed(1)}%`
                              : "—"}
                          </span>
                        </div>
                        {report.chain.deep?.devHistory.devAddress && (
                          <div className="py-2.5 flex items-center justify-between gap-2">
                            <span className="text-slate-400">Dev Wallet</span>
                            <button
                              type="button"
                              onClick={() => setForensicTab("dev")}
                              className="inline-flex items-center gap-1.5 font-mono text-[#84A7FF] hover:text-white cursor-pointer"
                            >
                              <span>
                                {report.chain.deep.devHistory.devAddress.slice(0, 5)}...
                                {report.chain.deep.devHistory.devAddress.slice(-4)}
                              </span>
                              {devBurnsCount > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-amber-300">
                                  <Flame className="w-3 h-3" />
                                  {devBurnsCount}
                                </span>
                              )}
                            </button>
                          </div>
                        )}
                        <div className="py-2.5 flex items-center justify-between gap-2">
                          <span className="text-slate-400">Explorers</span>
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <a
                              href={
                                report.chain.dexPair?.pairUrl ||
                                (report.chain.chainFamily === "evm" ||
                                report.chain.mintAddress.startsWith("0x")
                                  ? `https://dexscreener.com/search?q=${encodeURIComponent(report.chain.mintAddress)}`
                                  : `https://dexscreener.com/solana/${report.chain.mintAddress}`)
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#84A7FF] hover:text-white"
                            >
                              DexScreener
                            </a>
                            <span className="text-white/20">·</span>
                            <a
                              href={
                                report.chain.chainFamily === "evm" ||
                                report.chain.mintAddress.startsWith("0x")
                                  ? (report.robinhood?.blockscoutUrl ||
                                      `https://etherscan.io/token/${report.chain.mintAddress}`)
                                  : `https://solscan.io/token/${report.chain.mintAddress}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#84A7FF] hover:text-white"
                            >
                              {report.chain.chainFamily === "evm" ||
                              report.chain.mintAddress.startsWith("0x")
                                ? (report.chain.networkName?.includes("Robinhood")
                                    ? "Blockscout"
                                    : "Explorer")
                                : "Solscan"}
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              ) : (
                /* Non-Token Repository / Website Audit Layout */
                <div className="space-y-5">
                  <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    {renderBrowserStageCard("lg:col-span-7")}
                    {renderAgentFeedCard("lg:col-span-5")}
                  </section>
                  {renderForensicTabPanel()}
                </div>
              )}

              {recentTokens.length > 0 && (
                <div className="pt-2 space-y-3">
                  <div className="rounded-xl border border-white/[0.08] bg-[#0D1017] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                      <Coins className="w-3.5 h-3.5 text-[#84A7FF]" />
                      <span>
                        Verified Audit Ledger ({recentTokens.length} indexed)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowResultLedger((prev) => !prev)}
                      className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[11px] font-mono text-slate-200 cursor-pointer transition-colors"
                    >
                      {showResultLedger ? "Hide Ledger" : "Switch Audited Target"}
                    </button>
                  </div>

                  {showResultLedger && (
                    <AuditLedgerSection
                      tokens={recentTokens}
                      onOpenPermalink={(reportId, fallbackTarget) =>
                        void loadPermalinkReport(reportId, fallbackTarget)
                      }
                      onRunAudit={(mintAddress) => void runCheck(mintAddress)}
                      onRefresh={() => void loadRecentScannedTokens()}
                      onClearLocal={() => {
                        clearLocalScannedTokens();
                        void loadRecentScannedTokens();
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </ClickSpark>
  );
}
