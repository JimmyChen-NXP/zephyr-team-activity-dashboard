import { differenceInCalendarDays, parseISO } from "date-fns";

import type {
  ActivityItem,
  ContributorMetrics,
  DashboardData,
  DashboardWarning,
  RepoActivity,
  ReviewSourceBreakdown,
  ReviewOutcomeBreakdown,
  RosterMember,
  RangeOption,
} from "@/lib/types";

const DEMO_REPOS = [
  "zephyrproject-rtos/zephyr",
  "zephyrproject-rtos/west",
  "zephyrproject-rtos/sdk-ng",
  "zephyrproject-rtos/hal_nxp",
  "zephyrproject-rtos/modules",
];

function hashSeed(value: string): number {
  return Array.from(value).reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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

export function buildDemoDashboard(roster: RosterMember[], range: RangeOption): DashboardData {
  const generatedAt = new Date().toISOString();
  const contributors: ContributorMetrics[] = roster.slice(0, 18).map((member) => {
    const seed = hashSeed(member.login);
    const openAssignedIssues = seed % 7;
    const openAuthoredPrs = seed % 5;
    const draftPrs = seed % 3;
    const mergedPrs = clamp(Math.floor(seed / 17) % 9, 0, 8);
    const closedUnmergedPrs = seed % 2;
    const reviewsSubmitted = clamp(Math.floor(seed / 13) % 12, 1, 11);
    const pendingReviewRequests = seed % 4;
    const staleItems = clamp(Math.floor(seed / 29) % 4, 0, 3);
    const repositoriesTouched = clamp(Math.floor(seed / 19) % DEMO_REPOS.length + 1, 1, DEMO_REPOS.length);

    return {
      login: member.login,
      name: member.name,
      role: member.role,
      openAssignedIssues,
      openAuthoredPrs,
      draftPrs,
      mergedPrs,
      closedUnmergedPrs,
      reviewsSubmitted,
      pendingReviewRequests,
      staleItems,
      repositoriesTouched,
      activityScore:
        openAssignedIssues * 3 + openAuthoredPrs * 3 + mergedPrs * 2 + reviewsSubmitted + pendingReviewRequests * 2,
    };
  });

  const repoActivity: RepoActivity[] = DEMO_REPOS.map((repo, index) => ({
    name: repo,
    issues: contributors.reduce((total, contributor) => total + ((contributor.openAssignedIssues + index) % 4), 0),
    prs: contributors.reduce((total, contributor) => total + ((contributor.openAuthoredPrs + index) % 3), 0),
    reviews: contributors.reduce((total, contributor) => total + ((contributor.reviewsSubmitted + index) % 5), 0),
    contributors: contributors.filter((contributor) => contributor.repositoriesTouched > index).length,
  }));

  const activityItems: ActivityItem[] = contributors.flatMap((contributor, index) => {
    const repo = DEMO_REPOS[index % DEMO_REPOS.length];
    const createdAt = new Date(Date.parse(range.from) + index * 86400000).toISOString();
    const updatedAt = new Date(Date.parse(createdAt) + 3600000 * ((index % 6) + 2)).toISOString();
    const isTeamPr = index % 2 === 0;
    const reviewState = index % 3 === 0 ? "APPROVED" : index % 3 === 1 ? "CHANGES_REQUESTED" : "COMMENTED";
    const reviewRequestItems: ActivityItem[] =
      contributor.pendingReviewRequests > 0
        ? [
            {
              id: `${contributor.login}-review-request`,
              type: "review_request",
              title: `Review request for ${contributor.name}`,
              url: `https://github.com/${repo}/pull/${400 + index}`,
              repo,
              contributor: contributor.login,
              state: "open",
              createdAt,
              updatedAt,
              ageDays: differenceInCalendarDays(new Date(), parseISO(createdAt)),
              statusLabel: "Pending review request",
              metrics: {
                ...emptyMetrics(),
                pendingReviewRequests: contributor.pendingReviewRequests,
              },
            },
          ]
        : [];

    return [
      {
        id: `${contributor.login}-issue`,
        type: "issue",
        title: `Tracked issue for ${contributor.name}`,
        url: `https://github.com/${repo}/issues/${100 + index}`,
        repo,
        contributor: contributor.login,
        state: "open",
        createdAt,
        updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(createdAt)),
        statusLabel: contributor.staleItems > 0 ? "Needs attention" : "Active",
        metrics: {
          ...emptyMetrics(),
          openAssignedIssues: contributor.openAssignedIssues,
          staleItems: Math.ceil(contributor.staleItems / 2),
        },
      },
      {
        id: `${contributor.login}-pr`,
        type: "pull_request",
        title: `PR activity for ${contributor.name}`,
        url: `https://github.com/${repo}/pull/${200 + index}`,
        repo,
        contributor: contributor.login,
        state: contributor.draftPrs > 0 ? "draft" : "open",
        createdAt,
        updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(createdAt)),
        statusLabel: contributor.pendingReviewRequests > 1 ? "Awaiting review" : "Moving",
        metrics: {
          ...emptyMetrics(),
          openAuthoredPrs: contributor.openAuthoredPrs,
          draftPrs: contributor.draftPrs,
          mergedPrs: contributor.mergedPrs,
          closedUnmergedPrs: contributor.closedUnmergedPrs,
          staleItems: Math.floor(contributor.staleItems / 2),
        },
      },
      {
        id: `${contributor.login}-review`,
        type: "review",
        title: `Review by ${contributor.name}`,
        url: `https://github.com/${repo}/pull/${300 + index}`,
        repo,
        contributor: contributor.login,
        state: reviewState.toLowerCase(),
        createdAt,
        updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(createdAt)),
        statusLabel: isTeamPr ? "Team PR" : "External PR",
        reviewedPrKind: isTeamPr ? "team-pr" : "ext-pr",
        metrics: {
          ...emptyMetrics(),
          reviewsSubmitted: contributor.reviewsSubmitted,
          reviewApproved: Math.max(1, Math.floor(contributor.reviewsSubmitted * 0.5)),
          reviewChangesRequested: Math.floor(contributor.reviewsSubmitted * 0.2),
          reviewCommented: Math.ceil(contributor.reviewsSubmitted * 0.3),
          reviewTeamPr: isTeamPr ? contributor.reviewsSubmitted : 0,
          reviewExtPr: isTeamPr ? 0 : contributor.reviewsSubmitted,
        },
      },
      ...reviewRequestItems,
    ];
  });

  const reviewOutcomes: ReviewOutcomeBreakdown = {
    approved: contributors.reduce((total, contributor) => total + Math.max(1, Math.floor(contributor.reviewsSubmitted * 0.5)), 0),
    changesRequested: contributors.reduce((total, contributor) => total + Math.floor(contributor.reviewsSubmitted * 0.2), 0),
    commented: contributors.reduce((total, contributor) => total + Math.ceil(contributor.reviewsSubmitted * 0.3), 0),
  };

  const reviewSources: ReviewSourceBreakdown = {
    teamPr: activityItems.reduce((total, item) => total + item.metrics.reviewTeamPr, 0),
    extPr: activityItems.reduce((total, item) => total + item.metrics.reviewExtPr, 0),
  };

  const warnings: DashboardWarning[] = [
    {
      level: "info",
      message:
        "GitHub live sync is not configured yet. The dashboard is rendering seeded demo data until a GITHUB_TOKEN is provided.",
    },
  ];

  return {
    range,
    generatedAt,
    rosterSize: roster.length,
    rosterMembers: roster,
    warnings,
    summary: {
      openAssignedIssues: contributors.reduce((total, contributor) => total + contributor.openAssignedIssues, 0),
      openAuthoredPrs: contributors.reduce((total, contributor) => total + contributor.openAuthoredPrs, 0),
      mergedPrs: contributors.reduce((total, contributor) => total + contributor.mergedPrs, 0),
      reviewsSubmitted: contributors.reduce((total, contributor) => total + contributor.reviewsSubmitted, 0),
      pendingReviewRequests: contributors.reduce((total, contributor) => total + contributor.pendingReviewRequests, 0),
      staleItems: contributors.reduce((total, contributor) => total + contributor.staleItems, 0),
      repositoriesTouched: new Set(repoActivity.filter((repo) => repo.contributors > 0).map((repo) => repo.name)).size,
      medianFirstReviewHours: 13.5,
      medianMergeHours: 41.2,
    },
    reviewOutcomes,
    reviewSources,
    contributors: contributors.sort((left, right) => right.activityScore - left.activityScore),
    repoActivity: repoActivity.sort((left, right) => right.prs + right.reviews - (left.prs + left.reviews)),
    activityItems,
    syncHealth: {
      source: "demo",
      generatedAt,
      freshnessMinutes: 0,
      searchSamples: 0,
      detailSamples: activityItems.length,
      liveEnabled: false,
    },
    filterOptions: {
      contributors: roster.map((member) => ({ login: member.login, name: member.name })),
      repos: [...DEMO_REPOS],
    },
    auth: {
      hasToken: false,
      tokenSource: "none",
    },
  };
}
