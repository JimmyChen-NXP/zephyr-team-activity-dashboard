import type { DashboardView } from "@/lib/dashboard-views";
import { getActivityPageTitle, isItemInDashboardView } from "@/lib/dashboard-views";
import type { ActivityItem, ContributorMetrics, DashboardData, DashboardSummary, RepoActivity } from "@/lib/types";

export type SummaryCard = {
  label: string;
  value: number | string;
  accent: "violet" | "blue" | "emerald" | "amber" | "rose";
};

export type ContributorColumn = {
  key: string;
  label: string;
  value: (contributor: ContributorMetrics) => number | string;
};

function buildEmptyContributor(member: DashboardData["rosterMembers"][number]): ContributorMetrics {
  return {
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
  };
}

function calculateViewScore(view: DashboardView, contributor: ContributorMetrics) {
  switch (view) {
    case "issues":
      return contributor.openAssignedIssues * 3 + contributor.staleItems;
    case "pull-requests":
      return contributor.openAuthoredPrs * 3 + contributor.mergedPrs * 2 + contributor.staleItems;
    case "reviews":
      return contributor.reviewsSubmitted;
  }
}

export function getViewScoreLabel(view: DashboardView) {
  switch (view) {
    case "issues":
      return "Issue score";
    case "pull-requests":
      return "PR score";
    case "reviews":
      return "Review score";
  }
}

export function getViewScoreFormula(view: DashboardView) {
  switch (view) {
    case "issues":
      return "issue score = (open assigned issues × 3) + stale items";
    case "pull-requests":
      return "pr score = (open authored PRs × 3) + (merged PRs × 2) + stale items";
    case "reviews":
      return "review score = reviews submitted";
  }
}

export function getActivityItemsForView(activityItems: ActivityItem[], view: DashboardView) {
  return activityItems.filter((item) => isItemInDashboardView(item, view));
}

export function buildViewDashboardData(data: DashboardData, view: DashboardView): DashboardData {
  const activityItems = getActivityItemsForView(data.activityItems, view);
  const contributorMap = new Map(data.rosterMembers.map((member) => [member.login.toLowerCase(), buildEmptyContributor(member)]));
  const contributorRepos = new Map<string, Set<string>>();
  const repoMap = new Map<string, { issues: number; prs: number; reviews: number; contributors: Set<string> }>();

  for (const item of activityItems) {
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

      const repos = contributorRepos.get(contributor.login) ?? new Set<string>();
      repos.add(item.repo);
      contributorRepos.set(contributor.login, repos);
    }

    const repo = repoMap.get(item.repo) ?? { issues: 0, prs: 0, reviews: 0, contributors: new Set<string>() };
    if (item.type === "issue") {
      repo.issues += 1;
    }
    if (item.type === "pull_request") {
      repo.prs += 1;
    }
    if (item.type === "review") {
      repo.reviews += 1;
    }
    repo.contributors.add(item.contributor);
    repoMap.set(item.repo, repo);
  }

  const contributors = Array.from(contributorMap.values())
    .map((contributor) => {
      contributor.repositoriesTouched = contributorRepos.get(contributor.login)?.size ?? 0;
      contributor.activityScore = calculateViewScore(view, contributor);
      return contributor;
    })
    .filter((contributor) => contributor.activityScore > 0)
    .sort((left, right) => right.activityScore - left.activityScore || left.name.localeCompare(right.name));

  const repoActivity: RepoActivity[] = Array.from(repoMap.entries())
    .map(([name, repo]) => ({
      name,
      issues: repo.issues,
      prs: repo.prs,
      reviews: repo.reviews,
      contributors: repo.contributors.size,
    }))
    .sort((left, right) => right.issues + right.prs + right.reviews - (left.issues + left.prs + left.reviews));

  const summary: DashboardSummary = {
    openAssignedIssues: contributors.reduce((total, contributor) => total + contributor.openAssignedIssues, 0),
    openAuthoredPrs: contributors.reduce((total, contributor) => total + contributor.openAuthoredPrs, 0),
    mergedPrs: contributors.reduce((total, contributor) => total + contributor.mergedPrs, 0),
    reviewsSubmitted: contributors.reduce((total, contributor) => total + contributor.reviewsSubmitted, 0),
    pendingReviewRequests: contributors.reduce((total, contributor) => total + contributor.pendingReviewRequests, 0),
    staleItems: contributors.reduce((total, contributor) => total + contributor.staleItems, 0),
    repositoriesTouched: repoActivity.length,
    medianFirstReviewHours: view === "reviews" ? data.summary.medianFirstReviewHours : null,
    medianMergeHours: view === "pull-requests" ? data.summary.medianMergeHours : null,
  };

  return {
    ...data,
    activityItems,
    contributors,
    repoActivity,
    summary,
    reviewOutcomes: {
      approved: activityItems.reduce((total, item) => total + item.metrics.reviewApproved, 0),
      changesRequested: activityItems.reduce((total, item) => total + item.metrics.reviewChangesRequested, 0),
      commented: activityItems.reduce((total, item) => total + item.metrics.reviewCommented, 0),
    },
    reviewSources: {
      teamPr: activityItems.reduce((total, item) => total + item.metrics.reviewTeamPr, 0),
      extPr: activityItems.reduce((total, item) => total + item.metrics.reviewExtPr, 0),
    },
  };
}

export function getSummaryCards(data: DashboardData, view: DashboardView): SummaryCard[] {
  switch (view) {
    case "issues":
      return [
        { label: "Open assigned issues", value: data.summary.openAssignedIssues, accent: "violet" },
        { label: "Stale issues", value: data.summary.staleItems, accent: "rose" },
        { label: "Repositories touched", value: data.summary.repositoriesTouched, accent: "blue" },
        { label: "Active contributors", value: data.contributors.length, accent: "emerald" },
      ];
    case "pull-requests":
      return [
        { label: "Open authored PRs", value: data.summary.openAuthoredPrs, accent: "blue" },
        { label: "Merged PRs", value: data.summary.mergedPrs, accent: "violet" },
        { label: "Stale PRs", value: data.summary.staleItems, accent: "rose" },
        { label: "Repositories touched", value: data.summary.repositoriesTouched, accent: "emerald" },
      ];
    case "reviews":
      return [
        { label: "Reviews submitted", value: data.summary.reviewsSubmitted, accent: "emerald" },
        { label: "Team PR reviews", value: data.reviewSources.teamPr, accent: "violet" },
        { label: "External PR reviews", value: data.reviewSources.extPr, accent: "amber" },
        { label: "Active reviewers", value: data.contributors.length, accent: "blue" },
      ];
  }
}

export function getContributorColumns(view: DashboardView): ContributorColumn[] {
  switch (view) {
    case "issues":
      return [
        { key: "issues", label: "Issues", value: (contributor) => contributor.openAssignedIssues },
        { key: "stale", label: "Stale", value: (contributor) => contributor.staleItems },
        { key: "repos", label: "Repos", value: (contributor) => contributor.repositoriesTouched },
        { key: "score", label: getViewScoreLabel(view), value: (contributor) => contributor.activityScore },
      ];
    case "pull-requests":
      return [
        { key: "open-prs", label: "Open PRs", value: (contributor) => contributor.openAuthoredPrs },
        { key: "merged", label: "Merged", value: (contributor) => contributor.mergedPrs },
        { key: "repos", label: "Repos", value: (contributor) => contributor.repositoriesTouched },
        { key: "score", label: getViewScoreLabel(view), value: (contributor) => contributor.activityScore },
      ];
    case "reviews":
      return [
        { key: "reviews", label: "Reviews", value: (contributor) => contributor.reviewsSubmitted },
        { key: "repos", label: "Repos", value: (contributor) => contributor.repositoriesTouched },
        { key: "score", label: getViewScoreLabel(view), value: (contributor) => contributor.activityScore },
      ];
  }
}

export function getDetailCountLabel(data: DashboardData, view: DashboardView) {
  return `${data.activityItems.length} ${getActivityPageTitle(view).toLowerCase()} rows`;
}
