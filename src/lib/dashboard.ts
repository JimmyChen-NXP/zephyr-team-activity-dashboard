import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { differenceInMinutes } from "date-fns";

import { buildDemoDashboard } from "@/lib/demo-data";
import {
  buildConfiguredGitHubAuthState,
  buildGitHubAuthStateFromError,
  buildMissingGitHubAuthState,
  buildRateLimitedGitHubAuthState,
  buildValidGitHubAuthState,
  getGitHubEnvToken,
} from "@/lib/github-auth";
import { collectLiveDashboard, GitHubRequestError } from "@/lib/github";
import { resolveRange } from "@/lib/range";
import { loadRoster } from "@/lib/roster";
import { filterDashboardData } from "@/lib/dashboard-filtering";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const SNAPSHOT_DIR = path.join(process.cwd(), ".data", "snapshots");
const SNAPSHOT_TTL_MINUTES = Number(process.env.SNAPSHOT_TTL_MINUTES ?? 15);
const RATE_LIMIT_COOLDOWN_MINUTES = Number(process.env.GITHUB_RATE_LIMIT_COOLDOWN_MINUTES ?? 5);
let liveSyncBlockedUntil: number | null = null;

function emptyMetrics() {
  return {
    openAssignedIssues: 0,
    openAuthoredPrs: 0,
    draftPrs: 0,
    mergedPrs: 0,
    closedUnmergedPrs: 0,
    reviewsSubmitted: 0,
    pendingReviewRequests: 0,
    staleItems: 0,
    reviewApproved: 0,
    reviewChangesRequested: 0,
    reviewCommented: 0,
    reviewSelfAuthored: 0,
    reviewTeamAuthored: 0,
    reviewExternalAuthored: 0,
  };
}

function getSnapshotPath(preset: DashboardFilters["preset"]) {
  return path.join(SNAPSHOT_DIR, `${preset}.json`);
}

async function readSnapshot(preset: DashboardFilters["preset"]): Promise<DashboardData | null> {
  try {
    const snapshotPath = getSnapshotPath(preset);
    const content = await readFile(snapshotPath, "utf8");
    const snapshot = JSON.parse(content) as Partial<DashboardData>;
    if (!snapshot.rosterMembers || !snapshot.filterOptions || !snapshot.reviewSources) {
      return null;
    }

    return snapshot as DashboardData;
  } catch {
    return null;
  }
}

async function writeSnapshot(preset: DashboardFilters["preset"], data: DashboardData) {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(getSnapshotPath(preset), JSON.stringify(data, null, 2), "utf8");
}

function annotateSnapshotWarnings(data: DashboardData["warnings"]) {
  return data.map((warning) => ({
    ...warning,
    message: `Cached snapshot: ${warning.message}`,
  }));
}

function formatLiveSyncFailure(error: unknown) {
  if (error instanceof GitHubRequestError && error.status === 403 && error.responseBody?.includes("API rate limit exceeded")) {
    return "GitHub Search rate limit exceeded. Falling back to the latest cached snapshot. Wait a minute and refresh again.";
  }

  const message = error instanceof Error ? error.message : "Unknown GitHub sync failure";
  return `Live sync failed (${message}). Falling back to the latest cached snapshot.`;
}

function isSearchRateLimitError(error: unknown) {
  return error instanceof GitHubRequestError
    && error.status === 403
    && (error.rateLimitRemaining === 0 || error.responseBody?.includes("API rate limit exceeded") === true);
}

function isLiveSyncCooldownActive() {
  return liveSyncBlockedUntil !== null && Date.now() < liveSyncBlockedUntil;
}

function startLiveSyncCooldown() {
  if (RATE_LIMIT_COOLDOWN_MINUTES <= 0) {
    liveSyncBlockedUntil = Date.now();
    return;
  }

  liveSyncBlockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MINUTES * 60_000;
}

function clearLiveSyncCooldown() {
  liveSyncBlockedUntil = null;
}

function buildCooldownWarningMessage() {
  return "GitHub Search rate limit cooldown active. Showing cached data instead of retrying live sync on every page load.";
}

function buildCachedSnapshotResponse(snapshot: DashboardData, freshnessMinutes: number, auth = buildConfiguredGitHubAuthState("Token loaded from environment. Showing cached data until live sync is requested or the connection is tested."), extraWarnings: DashboardData["warnings"] = []) {
  return {
    ...snapshot,
    auth,
    warnings: [
      ...extraWarnings,
      ...annotateSnapshotWarnings(snapshot.warnings),
      {
        level: "info" as const,
        message: `Showing cached snapshot from ${snapshot.generatedAt}. Use Refresh now for a live sync.`,
      },
    ],
    syncHealth: {
      ...snapshot.syncHealth,
      source: "cache" as const,
      freshnessMinutes,
    },
  };
}

function buildCooldownDemoData(data: DashboardData) {
  return {
    ...data,
    auth: buildRateLimitedGitHubAuthState("GitHub Search rate limit cooldown active. Showing demo data until the next retry window."),
    warnings: [
      {
        level: "warn" as const,
        message: buildCooldownWarningMessage(),
      },
      ...data.warnings,
    ],
  };
}

function buildDefaultDemoData(data: DashboardData) {
  return {
    ...data,
    auth: buildConfiguredGitHubAuthState("Token loaded from environment. Showing demo data until Refresh now runs a live GitHub sync."),
    warnings: [
      {
        level: "info" as const,
        message: "No cached snapshot is available yet. Showing demo data until you run Refresh now.",
      },
      ...data.warnings,
    ],
  };
}

export async function getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
  const range = resolveRange(filters.preset);
  const roster = await loadRoster();
  const token = getGitHubEnvToken();
  const configuredAuth = token
    ? buildConfiguredGitHubAuthState("Token loaded from environment. Run Test connection to verify GitHub access.")
    : buildMissingGitHubAuthState();
  const demoData = {
    ...buildDemoDashboard(roster, range),
    auth: configuredAuth,
  };

  if (!token) {
    return filterDashboardData(demoData, filters);
  }

  const snapshot = await readSnapshot(filters.preset);
  const snapshotFreshness = snapshot ? differenceInMinutes(new Date(), new Date(snapshot.generatedAt)) : null;

  if (!filters.refresh) {
    if (snapshot) {
      return filterDashboardData(buildCachedSnapshotResponse(snapshot, snapshotFreshness ?? 0), filters);
    }

    if (isLiveSyncCooldownActive()) {
      return filterDashboardData(buildCooldownDemoData(demoData), filters);
    }

    return filterDashboardData(buildDefaultDemoData(demoData), filters);
  }

  if (snapshot && isLiveSyncCooldownActive()) {
    return filterDashboardData(
      buildCachedSnapshotResponse(
        snapshot,
        snapshotFreshness ?? 0,
        buildRateLimitedGitHubAuthState("GitHub Search rate limit cooldown active. Showing cached snapshot until the next retry window."),
        [{
          level: "warn",
          message: buildCooldownWarningMessage(),
        }],
      ),
      filters,
    );
  }

  if (!snapshot && isLiveSyncCooldownActive()) {
    return filterDashboardData(buildCooldownDemoData(demoData), filters);
  }

  try {
    const liveData = {
      ...(await collectLiveDashboard(roster, range, token)),
      auth: buildValidGitHubAuthState({
        checkedAt: new Date().toISOString(),
        message: "Connected to GitHub. Live sync completed successfully.",
      }),
    };
    clearLiveSyncCooldown();
    await writeSnapshot(filters.preset, liveData);

    return filterDashboardData(liveData, filters);
  } catch (error) {
    if (isSearchRateLimitError(error)) {
      startLiveSyncCooldown();
    }

    const authState = buildGitHubAuthStateFromError(error);

    if (snapshot) {
      return filterDashboardData(
        buildCachedSnapshotResponse(snapshot, snapshotFreshness ?? differenceInMinutes(new Date(), new Date(snapshot.generatedAt)), authState, [{
          level: "error",
          message: formatLiveSyncFailure(error),
        }]),
        filters,
      );
    }

    const message = error instanceof Error ? error.message : "Unknown GitHub sync failure";

    return filterDashboardData(
      {
        ...demoData,
        auth: authState,
        warnings: [
          {
            level: "error",
            message: `Live sync failed (${message}). Showing seeded demo data until GitHub credentials are fixed.`,
          },
          ...demoData.warnings,
        ],
      },
      filters,
    );
  }
}
