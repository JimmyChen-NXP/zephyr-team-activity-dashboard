import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { differenceInMinutes } from "date-fns";

import { buildDemoDashboard } from "@/lib/demo-data";
import { collectLiveDashboard } from "@/lib/github";
import { resolveRange } from "@/lib/range";
import { loadRoster } from "@/lib/roster";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const SNAPSHOT_DIR = path.join(process.cwd(), ".data", "snapshots");
const SNAPSHOT_TTL_MINUTES = Number(process.env.SNAPSHOT_TTL_MINUTES ?? 15);

function getSnapshotPath(preset: DashboardFilters["preset"]) {
  return path.join(SNAPSHOT_DIR, `${preset}.json`);
}

async function readSnapshot(preset: DashboardFilters["preset"]): Promise<DashboardData | null> {
  try {
    const snapshotPath = getSnapshotPath(preset);
    const content = await readFile(snapshotPath, "utf8");
    return JSON.parse(content) as DashboardData;
  } catch {
    return null;
  }
}

async function writeSnapshot(preset: DashboardFilters["preset"], data: DashboardData) {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(getSnapshotPath(preset), JSON.stringify(data, null, 2), "utf8");
}

function filterDashboard(data: DashboardData, filters: DashboardFilters): DashboardData {
  const filteredContributors =
    filters.contributor === "all"
      ? data.contributors
      : data.contributors.filter((contributor) => contributor.login === filters.contributor);

  const filteredRepoActivity =
    filters.repo === "all" ? data.repoActivity : data.repoActivity.filter((repo) => repo.name === filters.repo);

  const filteredItems = data.activityItems.filter((item) => {
    const contributorMatch = filters.contributor === "all" || item.contributor === filters.contributor;
    const repoMatch = filters.repo === "all" || item.repo === filters.repo;
    return contributorMatch && repoMatch;
  });

  return {
    ...data,
    contributors: filteredContributors,
    repoActivity: filteredRepoActivity,
    activityItems: filteredItems,
    summary: {
      openAssignedIssues: filteredContributors.reduce((total, contributor) => total + contributor.openAssignedIssues, 0),
      openAuthoredPrs: filteredContributors.reduce((total, contributor) => total + contributor.openAuthoredPrs, 0),
      mergedPrs: filteredContributors.reduce((total, contributor) => total + contributor.mergedPrs, 0),
      reviewsSubmitted: filteredContributors.reduce((total, contributor) => total + contributor.reviewsSubmitted, 0),
      pendingReviewRequests: filteredContributors.reduce((total, contributor) => total + contributor.pendingReviewRequests, 0),
      staleItems: filteredContributors.reduce((total, contributor) => total + contributor.staleItems, 0),
      repositoriesTouched: filteredRepoActivity.length,
      medianFirstReviewHours: data.summary.medianFirstReviewHours,
      medianMergeHours: data.summary.medianMergeHours,
    },
  };
}

export async function getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
  const range = resolveRange(filters.preset);
  const roster = await loadRoster();
  const demoData = buildDemoDashboard(roster, range);

  if (!process.env.GITHUB_TOKEN) {
    return filterDashboard(demoData, filters);
  }

  const snapshot = await readSnapshot(filters.preset);
  if (!filters.refresh && snapshot) {
    const freshness = differenceInMinutes(new Date(), new Date(snapshot.generatedAt));
    if (freshness <= SNAPSHOT_TTL_MINUTES) {
      return filterDashboard(
        {
          ...snapshot,
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
    const liveData = await collectLiveDashboard(roster, range);
    await writeSnapshot(filters.preset, liveData);

    return filterDashboard(liveData, filters);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GitHub sync failure";

    if (snapshot) {
      return filterDashboard(
        {
          ...snapshot,
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

    return filterDashboard(
      {
        ...demoData,
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
