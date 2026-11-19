import { NextRequest } from "next/server";
import { buildGuardErrorResponse, guardApiRoute } from "../../../lib/api-guard";
import { corsJson, corsOptionsResponse } from "../../../lib/cors";
import {
  deriveWatchdogStatus,
  detectProjectMutations,
  makeWatchedProjectId,
  normalizeGithubRepoSlug,
  normalizeWebsiteTarget,
  probeProjectWatchdogSnapshot,
  type WatchedProjectRecord,
} from "../../../lib/project-watchdog";
import { runUpstashCommand } from "../../../lib/upstash-rest";
import {
  isValidWatchedChain,
  type WatchWalletChain,
} from "../../../lib/wallet-watch-client";
import { normalizeWatchedAddress } from "../../../lib/wallet-watch-tracker";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const SYNC_KEY_RE = /^[a-f0-9]{16,48}$/i;
const WATCHDOG_TTL_SEC = 30 * 24 * 60 * 60;
const MAX_PROJECTS_PER_SYNC = 15;

// In-memory fallback when Upstash is unconfigured (local dev)
const gStore = globalThis as unknown as {
  __solshieldWatchdogMemory?: Map<string, WatchedProjectRecord[]>;
};
function getMemStore(): Map<string, WatchedProjectRecord[]> {
  if (!gStore.__solshieldWatchdogMemory) {
    gStore.__solshieldWatchdogMemory = new Map();
  }
  return gStore.__solshieldWatchdogMemory;
}

function redisWatchdogKey(syncKey: string): string {
  return `solshield:watchdog:${syncKey.toLowerCase()}`;
}

async function readMonitoredProjects(
  syncKey: string
): Promise<WatchedProjectRecord[]> {
  if (!SYNC_KEY_RE.test(syncKey)) return [];
  const raw = await runUpstashCommand(["GET", redisWatchdogKey(syncKey)]);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as WatchedProjectRecord[];
    } catch {
      // Fall through to memory
    }
  }
  return getMemStore().get(syncKey.toLowerCase()) || [];
}

async function saveMonitoredProjects(
  syncKey: string,
  projects: WatchedProjectRecord[]
): Promise<void> {
  if (!SYNC_KEY_RE.test(syncKey)) return;
  const trimmed = projects.slice(0, MAX_PROJECTS_PER_SYNC);
  getMemStore().set(syncKey.toLowerCase(), trimmed);
  await runUpstashCommand([
    "SET",
    redisWatchdogKey(syncKey),
    JSON.stringify(trimmed),
    "EX",
    WATCHDOG_TTL_SEC,
  ]);
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req, "web");
}

export async function GET(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "read",
  });
  if (!guarded.ok) return buildGuardErrorResponse(guarded);

  const syncKey = req.nextUrl.searchParams.get("syncKey")?.trim() || "";
  if (!SYNC_KEY_RE.test(syncKey)) {
    return corsJson(
      { ok: true, projects: [] },
      { req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const projects = await readMonitoredProjects(syncKey);
  return corsJson(
    { ok: true, projects },
    { req, policy: "web", headers: guarded.rateHeaders }
  );
}

export async function POST(req: NextRequest) {
  const guarded = await guardApiRoute(req, {
    profile: "web-tool",
    kind: "fresh",
  });
  if (!guarded.ok) return buildGuardErrorResponse(guarded);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return corsJson(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const syncKey = String(body.syncKey || "").trim();
  const action = String(body.action || "add");

  if (!SYNC_KEY_RE.test(syncKey)) {
    return corsJson(
      { ok: false, error: "Missing or invalid Watchdog syncKey." },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const existing = await readMonitoredProjects(syncKey);

  if (action === "remove") {
    const id = String(body.id || "").trim();
    const updated = existing.filter((p) => p.id !== id);
    await saveMonitoredProjects(syncKey, updated);
    return corsJson(
      { ok: true, projects: updated },
      { req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  if (action === "probe" || action === "probe_all") {
    const targetId = String(body.id || "").trim();
    const updated: WatchedProjectRecord[] = [];
    for (const proj of existing) {
      if (action === "probe" && proj.id !== targetId) {
        updated.push(proj);
        continue;
      }
      const freshSnap = await probeProjectWatchdogSnapshot({
        contractAddress: proj.contractAddress,
        chain: proj.chain,
        websiteUrl: proj.websiteUrl,
        githubRepo: proj.githubRepo,
      });
      const newMutations = detectProjectMutations(proj.baseline, freshSnap);
      const status = deriveWatchdogStatus(freshSnap, newMutations);
      updated.push({
        ...proj,
        latest: freshSnap,
        mutations: newMutations,
        status,
      });
    }
    await saveMonitoredProjects(syncKey, updated);
    return corsJson(
      { ok: true, projects: updated },
      { req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  // action === "add"
  const rawAddr =
    typeof body.contractAddress === "string" ? body.contractAddress.trim() : "";
  const rawChain =
    typeof body.chain === "string" && isValidWatchedChain(body.chain)
      ? body.chain
      : undefined;
  const normAddr = rawAddr ? normalizeWatchedAddress(rawAddr, rawChain) : null;
  const websiteUrl = normalizeWebsiteTarget(
    typeof body.websiteUrl === "string" ? body.websiteUrl : null
  );
  const githubRepo = normalizeGithubRepoSlug(
    typeof body.githubRepo === "string" ? body.githubRepo : null
  );

  if ((!normAddr || !normAddr.valid) && !websiteUrl && !githubRepo) {
    return corsJson(
      {
        ok: false,
        error:
          "Provide at least one valid target: Contract Address (Solana/0x), Website URL, or GitHub owner/repo.",
      },
      { status: 400, req, policy: "web", headers: guarded.rateHeaders }
    );
  }

  const chain: WatchWalletChain = normAddr?.valid
    ? normAddr.chain
    : rawChain || "robinhood";
  const contractAddress = normAddr?.valid ? normAddr.address : null;
  const id = makeWatchedProjectId({
    contractAddress,
    chain,
    websiteUrl,
    githubRepo,
  });

  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 64)
      : githubRepo ||
        (contractAddress
          ? `${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}`
          : websiteUrl?.replace(/^https?:\/\//i, "").slice(0, 32) || "Project");

  const reportId =
    typeof body.reportId === "string" && body.reportId.trim()
      ? body.reportId.trim().slice(0, 48)
      : null;

  const baselineSnap = await probeProjectWatchdogSnapshot({
    contractAddress,
    chain,
    websiteUrl,
    githubRepo,
  });

  const record: WatchedProjectRecord = {
    id,
    label,
    contractAddress,
    chain,
    websiteUrl,
    githubRepo,
    reportId,
    addedAt: new Date().toISOString(),
    status: deriveWatchdogStatus(baselineSnap, []),
    baseline: baselineSnap,
    latest: baselineSnap,
    mutations: [],
  };

  const deduped = [record, ...existing.filter((p) => p.id !== id)].slice(
    0,
    MAX_PROJECTS_PER_SYNC
  );
  await saveMonitoredProjects(syncKey, deduped);

  return corsJson(
    { ok: true, project: record, projects: deduped },
    { req, policy: "web", headers: guarded.rateHeaders }
  );
}
