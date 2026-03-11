import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { differenceInMinutes } from "date-fns";

import { buildDemoDashboard } from "@/lib/demo-data";
import {
  buildConfiguredGitHubAuthState,
  buildGitHubAuthStateFromError,
  buildMissingGitHubAuthState,
  buildValidGitHubAuthState,
  getGitHubEnvToken,
} from "@/lib/github-auth";
import { collectLiveDashboard } from "@/lib/github";
import { resolveRange } from "@/lib/range";
import { loadRoster } from "@/lib/roster";
import { filterDashboardData } from "@/lib/dashboard-filtering";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const SNAPSHOT_DIR = path.join(process.cwd(), ".data", "snapshots");
const SNAPSHOT_TTL_MINUTES = Number(process.env.SNAPSHOT_TTL_MINUTES ?? 15);

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
  if (!filters.refresh && snapshot) {
    const freshness = differenceInMinutes(new Date(), new Date(snapshot.generatedAt));
    if (freshness <= SNAPSHOT_TTL_MINUTES) {
      return filterDashboardData(
        {
          ...snapshot,
          auth: buildConfiguredGitHubAuthState("Token loaded from environment. Showing cached data until live sync is requested or the connection is tested."),
          warnings: [
            ...snapshot.warnings,
            {
              level: "info",
              message: `Showing cached snapshot from ${snapshot.generatedAt}. Use Refresh now for a live sync.`,
            },
          ],
          syncHealth: {
            ...snapshot.syncHealth,
            source: "cache",
            freshnessMinutes: freshness,
          },
        },
        filters,
      );
    }
  }

  try {
    const liveData = {
      ...(await collectLiveDashboard(roster, range, token)),
      auth: buildValidGitHubAuthState({
        checkedAt: new Date().toISOString(),
        message: "Connected to GitHub. Live sync completed successfully.",
      }),
    };
    await writeSnapshot(filters.preset, liveData);

    return filterDashboardData(liveData, filters);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GitHub sync failure";
    const authState = buildGitHubAuthStateFromError(error);

    if (snapshot) {
      return filterDashboardData(
        {
          ...snapshot,
          auth: authState,
          warnings: [
            {
              level: "error",
              message: `Live sync failed (${message}). Falling back to the latest cached snapshot.`,
            },
            ...snapshot.warnings,
          ],
          syncHealth: {
            ...snapshot.syncHealth,
            source: "cache",
            freshnessMinutes: differenceInMinutes(new Date(), new Date(snapshot.generatedAt)),
          },
        },
        filters,
      );
    }

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
