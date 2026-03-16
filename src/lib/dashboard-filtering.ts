import { calculateActivityScore } from "@/lib/scoring";
import type { DashboardData, DashboardFilters } from "@/lib/types";

export function filterDashboardData(data: DashboardData, filters: DashboardFilters): DashboardData {
  const contributorFilter = new Set(filters.contributors.map((login) => login.toLowerCase()));
  const hasContributorFilter = contributorFilter.size > 0;
  const filteredItems = data.activityItems.filter((item) => {
    const contributorMatch = !hasContributorFilter || contributorFilter.has(item.contributor.toLowerCase());
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
        closedIssues: 0,
        openAuthoredPrs: 0,
        draftPrs: 0,
        mergedPrs: 0,
        closedUnmergedPrs: 0,
        reviewsSubmitted: 0,
        pendingReviewRequests: 0,
        staleItems: 0,
        uniqueReviewedPrs: 0,
        reviewSelfAuthored: 0,
        reviewTeamAuthored: 0,
        reviewExternalAuthored: 0,
        reviewCommented: 0,
        repositoriesTouched: 0,
        activityScore: 0,
        archPrs: 0,
        rfcPrs: 0,
        stablePrs: 0,
      },
    ]),
  );
  const contributorRepos = new Map<string, Set<string>>();
  const repoMap = new Map<string, { issues: number; prs: number; reviews: number; contributors: Set<string> }>();

  for (const item of filteredItems) {
    const contributor = contributorMap.get(item.contributor.toLowerCase());
    if (contributor) {
      contributor.openAssignedIssues += item.metrics.openAssignedIssues;
      contributor.closedIssues += item.metrics.closedIssues;
      contributor.openAuthoredPrs += item.metrics.openAuthoredPrs;
      contributor.draftPrs += item.metrics.draftPrs;
      contributor.mergedPrs += item.metrics.mergedPrs;
      contributor.closedUnmergedPrs += item.metrics.closedUnmergedPrs;
      contributor.reviewsSubmitted += item.metrics.reviewsSubmitted;
      contributor.pendingReviewRequests += item.metrics.pendingReviewRequests;
      contributor.staleItems += item.metrics.staleItems;
      contributor.reviewSelfAuthored += item.metrics.reviewSelfAuthored;
      contributor.reviewTeamAuthored += item.metrics.reviewTeamAuthored;
      contributor.reviewExternalAuthored += item.metrics.reviewExternalAuthored;
      contributor.reviewCommented += item.metrics.reviewCommented;

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
      const contributorReviewItems = filteredItems.filter(
        (item) => item.type === "review" && item.contributor === contributor.login,
      );
      contributor.repositoriesTouched = contributorRepos.get(contributor.login)?.size ?? 0;
      contributor.uniqueReviewedPrs = new Set(contributorReviewItems.map((item) => item.url)).size;
      contributor.activityScore = calculateActivityScore({
        openAssignedIssues: contributor.openAssignedIssues,
        closedIssues: contributor.closedIssues,
        openAuthoredPrs: contributor.openAuthoredPrs,
        mergedPrs: contributor.mergedPrs,
        reviewsSubmitted: contributor.reviewsSubmitted,
        pendingReviewRequests: contributor.pendingReviewRequests,
        staleItems: contributor.staleItems,
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
      closedIssues: filteredContributors.reduce((total, contributor) => total + contributor.closedIssues, 0),
      openAuthoredPrs: filteredContributors.reduce((total, contributor) => total + contributor.openAuthoredPrs, 0),
      mergedPrs: filteredContributors.reduce((total, contributor) => total + contributor.mergedPrs, 0),
      reviewsSubmitted: filteredContributors.reduce((total, contributor) => total + contributor.reviewsSubmitted, 0),
      pendingReviewRequests: filteredContributors.reduce((total, contributor) => total + contributor.pendingReviewRequests, 0),
      uniqueReviewedPrs: new Set(filteredItems.filter((item) => item.type === "review").map((item) => item.url)).size,
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
      selfAuthored: filteredItems.reduce((total, item) => total + item.metrics.reviewSelfAuthored, 0),
      teamAuthored: filteredItems.reduce((total, item) => total + item.metrics.reviewTeamAuthored, 0),
      externalAuthored: filteredItems.reduce((total, item) => total + item.metrics.reviewExternalAuthored, 0),
    },
  };
}
