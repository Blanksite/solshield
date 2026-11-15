import type { Metadata } from "next";
import BuildCheckWorkbench from "@/components/buildcheck/BuildCheckWorkbench";
import {
  getBuildCheckReportPermalink,
  isValidBuildCheckReportId,
} from "@/lib/buildcheck/report-store";
import type { BuildCheckReport } from "@/lib/buildcheck/types";

export const dynamic = "force-dynamic";

const DEFAULT_TITLE =
  "SolShield® BuildCheck — Live Browser Agent & Venice AI Proof Auditor";
const DEFAULT_DESC =
  "Paste any Solana token CA, X post, website, or GitHub repo. Watch a real Chromium browser verify code velocity, on-chain mint authorities, and domain age with Zero-Retention Venice AI.";

interface BuildCheckPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readSingleParam(
  params: Record<string, string | string[] | undefined> | undefined,
  key: string
): string {
  const raw = params?.[key];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim();
  return "";
}

function resolveTargetLabel(report: BuildCheckReport): string {
  const sym =
    report.chain?.deep?.metadata?.symbol || report.chain?.tokenReport?.symbol;
  if (sym) return `$${sym.replace(/^\$/, "")}`;
  return (
    report.target.githubOwnerRepo ||
    report.target.hostname ||
    (report.target.xHandle ? `@${report.target.xHandle}` : null) ||
    report.target.rawInput.slice(0, 32)
  );
}

export async function generateMetadata({
  searchParams,
}: BuildCheckPageProps): Promise<Metadata> {
  const resolved = searchParams ? await searchParams : undefined;
  const reportId = readSingleParam(resolved, "report");
  if (!isValidBuildCheckReportId(reportId)) {
    return { title: DEFAULT_TITLE, description: DEFAULT_DESC };
  }

  const report = await getBuildCheckReportPermalink(reportId);
  if (!report) {
    return { title: DEFAULT_TITLE, description: DEFAULT_DESC };
  }

  const label = resolveTargetLabel(report);
  const verdict = report.verdict.replace(/_/g, " ");
  return {
    title: `SolShield® BuildCheck — ${label} (${report.authenticityScore}/100 · ${verdict})`,
    description: report.headline || DEFAULT_DESC,
  };
}

export default async function BuildCheckPage({
  searchParams,
}: BuildCheckPageProps) {
  const resolved = searchParams ? await searchParams : undefined;
  const reportId = readSingleParam(resolved, "report");
  const initialTarget = readSingleParam(resolved, "target") || undefined;

  let initialReport: BuildCheckReport | null = null;
  let initialReportMissingId: string | undefined;

  if (reportId) {
    if (isValidBuildCheckReportId(reportId)) {
      initialReport = await getBuildCheckReportPermalink(reportId);
      if (!initialReport) {
        initialReportMissingId = reportId;
      }
    } else {
      initialReportMissingId = reportId;
    }
  }

  return (
    <BuildCheckWorkbench
      initialReport={initialReport}
      initialTarget={initialTarget}
      initialReportMissingId={initialReportMissingId}
    />
  );
}
