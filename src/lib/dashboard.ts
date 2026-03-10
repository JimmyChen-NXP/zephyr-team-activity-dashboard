import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { differenceInMinutes } from "date-fns";
import { cookies } from "next/headers";

import { buildDemoDashboard } from "@/lib/demo-data";
import { collectLiveDashboard } from "@/lib/github";
import { resolveRange } from "@/lib/range";
import { loadRoster } from "@/lib/roster";
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
    reviewTeamPr: 0,
    reviewExtPr: 0,
  };
}

function scoreContributor(metrics: ReturnType<typeof emptyMetrics>) {
  return (
    metrics.openAssignedIssues * 3 +
    metrics.openAuthoredPrs * 3 +
    metrics.mergedPrs * 2 +
    metrics.reviewsSubmitted +
    metrics.pendingReviewRequests * 2 +
    metrics.staleItems
  );
}

async function getGitHubAuth() {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("github_token")?.value?.trim();
  const authNoticeCookie = cookieStore.get("auth_notice")?.value;
  let authNotice: { level: "info" | "warn" | "error"; message: string } | null = null;

  if (authNoticeCookie) {
    try {
      authNotice = JSON.parse(authNoticeCookie) as { level: "info" | "warn" | "error"; message: string };
    } catch {}
  }

  if (cookieToken) {
    return { token: cookieToken, source: "cookie" as const, notice: authNotice };
  }

  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, source: "env" as const, notice: authNotice };
  }

  return { token: "", source: "none" as const, notice: authNotice };
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

function filterDashboard(data: DashboardData, filters: DashboardFilters): DashboardData {
  const filteredItems = data.activityItems.filter((item) => {
    const contributorMatch = filters.contributor === "all" || item.contributor === filters.contributor;
    const repoMatch = filters.repo === "all" || item.repo === filters.repo;
    return contributorMatch && repoMatch;
  });

  const contributorMap = new Map(
    data.rosterMembers.map((member) => [
      member.login.toLowerCase(),
      {
        login: member.login,
        name: member.name,
        role: member.role,
        openAssignedIssues: 0,
        openAuthoredPrs: 0,
        draftPrs: 0,
        mergedPrs: 0,
        closedUnmergedPrs: 0,
        reviewsSubmitted: 0,
        pendingReviewRequests: 0,
        staleItems: 0,
        repositoriesTouched: 0,
        activityScore: 0,
      },
    ]),
  );
  const contributorRepos = new Map<string, Set<string>>();
  const repoMap = new Map<string, { issues: number; prs: number; reviews: number; contributors: Set<string> }>();

  for (const item of filteredItems) {
    const contributor = contributorMap.get(item.contributor.toLowerCase());
    if (contributor) {
      contributor.openAssignedIssues += item.metrics.openAssignedIssues;
      contributor.openAuthoredPrs += item.metrics.openAuthoredPrs;
      contributor.draftPrs += item.metrics.draftPrs;
      contributor.mergedPrs += item.metrics.mergedPrs;
      contributor.closedUnmergedPrs += item.metrics.closedUnmergedPrs;
      contributor.reviewsSubmitted += item.metrics.reviewsSubmitted;
      contributor.pendingReviewRequests += item.metrics.pendingReviewRequests;
      contributor.staleItems += item.metrics.staleItems;

      const touchedRepos = contributorRepos.get(contributor.login) ?? new Set<string>();
      touchedRepos.add(item.repo);
      contributorRepos.set(contributor.login, touchedRepos);
    }

    const repoEntry = repoMap.get(item.repo) ?? { issues: 0, prs: 0, reviews: 0, contributors: new Set<string>() };
    if (item.type === "issue") {
      repoEntry.issues += 1;
    } else if (item.type === "pull_request") {
      repoEntry.prs += 1;
    } else if (item.type === "review") {
      repoEntry.reviews += 1;
    }
    repoEntry.contributors.add(item.contributor);
    repoMap.set(item.repo, repoEntry);
  }

  const filteredContributors = Array.from(contributorMap.values())
    .map((contributor) => {
      contributor.repositoriesTouched = contributorRepos.get(contributor.login)?.size ?? 0;
      contributor.activityScore = scoreContributor({
        openAssignedIssues: contributor.openAssignedIssues,
        openAuthoredPrs: contributor.openAuthoredPrs,
        draftPrs: contributor.draftPrs,
        mergedPrs: contributor.mergedPrs,
        closedUnmergedPrs: contributor.closedUnmergedPrs,
        reviewsSubmitted: contributor.reviewsSubmitted,
        pendingReviewRequests: contributor.pendingReviewRequests,
        staleItems: contributor.staleItems,
        reviewApproved: 0,
        reviewChangesRequested: 0,
        reviewCommented: 0,
        reviewTeamPr: 0,
        reviewExtPr: 0,
      });
      return contributor;
    })
    .filter((contributor) => contributor.activityScore > 0)
    .sort((left, right) => right.activityScore - left.activityScore);

  const filteredRepoActivity = Array.from(repoMap.entries())
    .map(([name, repo]) => ({
      name,
      issues: repo.issues,
      prs: repo.prs,
      reviews: repo.reviews,
      contributors: repo.contributors.size,
    }))
    .sort((left, right) => right.prs + right.reviews + right.issues - (left.prs + left.reviews + left.issues));

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
    reviewOutcomes: {
      approved: filteredItems.reduce((total, item) => total + item.metrics.reviewApproved, 0),
      changesRequested: filteredItems.reduce((total, item) => total + item.metrics.reviewChangesRequested, 0),
      commented: filteredItems.reduce((total, item) => total + item.metrics.reviewCommented, 0),
    },
    reviewSources: {
      teamPr: filteredItems.reduce((total, item) => total + item.metrics.reviewTeamPr, 0),
      extPr: filteredItems.reduce((total, item) => total + item.metrics.reviewExtPr, 0),
    },
  };
}

export async function getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
  const range = resolveRange(filters.preset);
  const roster = await loadRoster();
  const auth = await getGitHubAuth();
  const baseDemoData = buildDemoDashboard(roster, range);
  const demoData = {
    ...baseDemoData,
    warnings: auth.notice ? [auth.notice, ...baseDemoData.warnings] : baseDemoData.warnings,
    auth: {
      hasToken: auth.source !== "none",
      tokenSource: auth.source,
    },
  };

  if (!auth.token) {
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
            ...(auth.notice ? [auth.notice] : []),
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
    const collectedLiveData = await collectLiveDashboard(roster, range, auth.token);
    const liveData = {
      ...collectedLiveData,
      warnings: auth.notice ? [auth.notice, ...collectedLiveData.warnings] : collectedLiveData.warnings,
      auth: {
        hasToken: true,
        tokenSource: auth.source,
      },
    };
    await writeSnapshot(filters.preset, liveData);

    return filterDashboard(liveData, filters);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GitHub sync failure";

    if (snapshot) {
      return filterDashboard(
        {
          ...snapshot,
          warnings: [
            ...(auth.notice ? [auth.notice] : []),
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
