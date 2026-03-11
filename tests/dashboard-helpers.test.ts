import { describe, expect, it } from "vitest";

import { buildViewDashboardData, getSummaryCards, getViewScoreFormula } from "@/lib/dashboard-aggregates";
import { parseDashboardFilters } from "@/lib/dashboard-filters";
import { buildDashboardHref, buildExportHref, sanitizeDashboardReturnTo } from "@/lib/dashboard-links";
import type { DashboardData, DashboardFilters } from "@/lib/types";

const baseData: DashboardData = {
  range: {
    preset: "30d",
    label: "Last 30 days",
    from: "2026-02-09T00:00:00.000Z",
    to: "2026-03-10T00:00:00.000Z",
    timeZone: "UTC",
  },
  generatedAt: "2026-03-10T00:00:00.000Z",
  rosterSize: 2,
  rosterMembers: [
    { login: "alice", name: "Alice", email: null, createdAt: "2026-01-01T00:00:00.000Z", role: "Engineer" },
    { login: "bob", name: "Bob", email: null, createdAt: "2026-01-01T00:00:00.000Z", role: "Engineer" },
  ],
  warnings: [],
  summary: {
    openAssignedIssues: 1,
    openAuthoredPrs: 1,
    mergedPrs: 1,
    reviewsSubmitted: 1,
    pendingReviewRequests: 1,
    uniqueReviewedPrs: 1,
    staleItems: 2,
    repositoriesTouched: 2,
    medianFirstReviewHours: 6,
    medianMergeHours: 12,
  },
  reviewOutcomes: { approved: 1, changesRequested: 0, commented: 0 },
  reviewSources: { selfAuthored: 0, teamAuthored: 1, externalAuthored: 0 },
  contributors: [],
  repoActivity: [],
  activityItems: [
    {
      id: "issue-1",
      type: "issue",
      title: "Issue one",
      url: "https://example.com/issue-1",
      repo: "zephyrproject-rtos/repo-a",
      contributor: "alice",
      author: "external-issue-author",
      state: "open",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
      ageDays: 7,
      statusLabel: "Open",
      metrics: {
        openAssignedIssues: 1,
        openAuthoredPrs: 0,
        draftPrs: 0,
        mergedPrs: 0,
        closedUnmergedPrs: 0,
        reviewsSubmitted: 0,
        pendingReviewRequests: 0,
        staleItems: 1,
        reviewApproved: 0,
        reviewChangesRequested: 0,
        reviewCommented: 0,
        reviewSelfAuthored: 0,
        reviewTeamAuthored: 0,
        reviewExternalAuthored: 0,
      },
    },
    {
      id: "pr-1",
      type: "pull_request",
      title: "PR one",
      url: "https://example.com/pr-1",
      repo: "zephyrproject-rtos/repo-b",
      contributor: "bob",
      author: "bob",
      state: "open",
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
      ageDays: 6,
      statusLabel: "Open",
      metrics: {
        openAssignedIssues: 0,
        openAuthoredPrs: 1,
        draftPrs: 0,
        mergedPrs: 1,
        closedUnmergedPrs: 0,
        reviewsSubmitted: 0,
        pendingReviewRequests: 0,
        staleItems: 1,
        reviewApproved: 0,
        reviewChangesRequested: 0,
        reviewCommented: 0,
        reviewSelfAuthored: 0,
        reviewTeamAuthored: 0,
        reviewExternalAuthored: 0,
      },
    },
    {
      id: "review-1",
      type: "review",
      title: "Review one",
      url: "https://example.com/review-1",
      repo: "zephyrproject-rtos/repo-b",
      contributor: "alice",
      author: "bob",
      state: "approved",
      createdAt: "2026-03-04T00:00:00.000Z",
      updatedAt: "2026-03-09T12:00:00.000Z",
      ageDays: 1,
      statusLabel: "Approved",
      reviewedPrKind: "authored-by-them",
      metrics: {
        openAssignedIssues: 0,
        openAuthoredPrs: 0,
        draftPrs: 0,
        mergedPrs: 0,
        closedUnmergedPrs: 0,
        reviewsSubmitted: 1,
        pendingReviewRequests: 0,
        staleItems: 0,
        reviewApproved: 1,
        reviewChangesRequested: 0,
        reviewCommented: 0,
        reviewSelfAuthored: 0,
        reviewTeamAuthored: 1,
        reviewExternalAuthored: 0,
      },
    },
    {
      id: "review-request-1",
      type: "review_request",
      title: "Review request one",
      url: "https://example.com/review-request-1",
      repo: "zephyrproject-rtos/repo-b",
      contributor: "alice",
      author: "external-author",
      state: "pending",
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-09T12:00:00.000Z",
      ageDays: 1,
      statusLabel: "Pending",
      metrics: {
        openAssignedIssues: 0,
        openAuthoredPrs: 0,
        draftPrs: 0,
        mergedPrs: 0,
        closedUnmergedPrs: 0,
        reviewsSubmitted: 0,
        pendingReviewRequests: 1,
        staleItems: 0,
        reviewApproved: 0,
        reviewChangesRequested: 0,
        reviewCommented: 0,
        reviewSelfAuthored: 0,
        reviewTeamAuthored: 0,
        reviewExternalAuthored: 0,
      },
    },
  ],
  syncHealth: {
    source: "live",
    generatedAt: "2026-03-10T00:00:00.000Z",
    freshnessMinutes: 1,
    searchSamples: 10,
    detailSamples: 4,
    liveEnabled: true,
  },
  filterOptions: {
    contributors: [
      { login: "alice", name: "Alice" },
      { login: "bob", name: "Bob" },
    ],
    repos: ["zephyrproject-rtos/repo-a", "zephyrproject-rtos/repo-b"],
  },
  auth: {
    hasToken: true,
    connectionStatus: "valid",
    message: "Connected to GitHub.",
    checkedAt: "2026-03-10T00:00:00.000Z",
  },
};

describe("dashboard filters and links", () => {
  it("parses dashboard filters with defaults", () => {
    expect(parseDashboardFilters({ preset: "7d", contributor: ["alice", "bob"] })).toEqual({
      preset: "7d",
      contributors: ["alice", "bob"],
      repo: "all",
      refresh: false,
    });
  });

  it("builds route-aware hrefs and sanitizes token return paths", () => {
    const filters: DashboardFilters = { preset: "30d", contributors: ["alice", "bob"], repo: "all", refresh: false };

    expect(buildDashboardHref("/reviews", filters)).toBe("/reviews?preset=30d&repo=all&contributor=alice&contributor=bob");
    expect(buildExportHref("issues", filters)).toBe("/api/export?preset=30d&repo=all&contributor=alice&contributor=bob&view=issues");
    expect(sanitizeDashboardReturnTo("/pull-requests?preset=7d")).toBe("/pull-requests?preset=7d");
    expect(sanitizeDashboardReturnTo("https://example.com/evil")).toBe("/issues");
  });
});

describe("dashboard view aggregates", () => {
  it("builds issue-only data", () => {
    const viewData = buildViewDashboardData(baseData, "issues");

    expect(viewData.activityItems).toHaveLength(1);
    expect(viewData.summary.openAssignedIssues).toBe(1);
    expect(viewData.summary.openAuthoredPrs).toBe(0);
    expect(viewData.contributors[0]?.login).toBe("alice");
    expect(viewData.contributors[0]?.activityScore).toBe(4);
    expect(getViewScoreFormula("issues")).toContain("open assigned issues");
  });

  it("builds pull-request-only data", () => {
    const viewData = buildViewDashboardData(baseData, "pull-requests");

    expect(viewData.activityItems).toHaveLength(1);
    expect(viewData.summary.openAuthoredPrs).toBe(1);
    expect(viewData.summary.mergedPrs).toBe(1);
    expect(viewData.summary.reviewsSubmitted).toBe(0);
    expect(viewData.contributors[0]?.login).toBe("bob");
    expect(viewData.contributors[0]?.activityScore).toBe(6);
  });

  it("builds review-only data and excludes review requests", () => {
    const viewData = buildViewDashboardData(baseData, "reviews");
    const cards = getSummaryCards(viewData, "reviews");

    expect(viewData.activityItems).toHaveLength(1);
    expect(viewData.summary.reviewsSubmitted).toBe(1);
    expect(viewData.summary.uniqueReviewedPrs).toBe(1);
    expect(viewData.summary.pendingReviewRequests).toBe(0);
    expect(viewData.reviewSources.teamAuthored).toBe(1);
    expect(cards.map((card) => card.label)).toContain("Unique PRs reviewed");
    expect(cards.map((card) => card.label)).not.toContain("Authored by self");
    expect(cards.find((card) => card.label === "Teammate PRs / reviews")?.value).toBe("1 / 1");
  });

  it("excludes self-authored review items and tracks unique PRs by author type", () => {
    const reviewData: DashboardData = {
      ...baseData,
      activityItems: [
        {
          id: "review-self",
          type: "review",
          title: "Self review",
          url: "https://example.com/pr-self",
          repo: "zephyrproject-rtos/repo-b",
          contributor: "alice",
          author: "alice",
          state: "commented",
          createdAt: "2026-03-04T00:00:00.000Z",
          updatedAt: "2026-03-09T12:00:00.000Z",
          ageDays: 1,
          statusLabel: "COMMENTED · Authored by self",
          reviewedPrKind: "authored-by-self",
          metrics: {
            openAssignedIssues: 0,
            openAuthoredPrs: 0,
            draftPrs: 0,
            mergedPrs: 0,
            closedUnmergedPrs: 0,
            reviewsSubmitted: 1,
            pendingReviewRequests: 0,
            staleItems: 0,
            reviewApproved: 0,
            reviewChangesRequested: 0,
            reviewCommented: 1,
            reviewSelfAuthored: 1,
            reviewTeamAuthored: 0,
            reviewExternalAuthored: 0,
          },
        },
        {
          id: "review-team-1",
          type: "review",
          title: "Team review 1",
          url: "https://example.com/pr-team",
          repo: "zephyrproject-rtos/repo-b",
          contributor: "alice",
          author: "bob",
          state: "approved",
          createdAt: "2026-03-04T00:00:00.000Z",
          updatedAt: "2026-03-09T12:00:00.000Z",
          ageDays: 1,
          statusLabel: "APPROVED · Authored by teammate",
          reviewedPrKind: "authored-by-them",
          metrics: {
            openAssignedIssues: 0,
            openAuthoredPrs: 0,
            draftPrs: 0,
            mergedPrs: 0,
            closedUnmergedPrs: 0,
            reviewsSubmitted: 1,
            pendingReviewRequests: 0,
            staleItems: 0,
            reviewApproved: 1,
            reviewChangesRequested: 0,
            reviewCommented: 0,
            reviewSelfAuthored: 0,
            reviewTeamAuthored: 1,
            reviewExternalAuthored: 0,
          },
        },
        {
          id: "review-team-2",
          type: "review",
          title: "Team review 2",
          url: "https://example.com/pr-team",
          repo: "zephyrproject-rtos/repo-b",
          contributor: "alice",
          author: "bob",
          state: "commented",
          createdAt: "2026-03-04T00:00:00.000Z",
          updatedAt: "2026-03-09T13:00:00.000Z",
          ageDays: 1,
          statusLabel: "COMMENTED · Authored by teammate",
          reviewedPrKind: "authored-by-them",
          metrics: {
            openAssignedIssues: 0,
            openAuthoredPrs: 0,
            draftPrs: 0,
            mergedPrs: 0,
            closedUnmergedPrs: 0,
            reviewsSubmitted: 1,
            pendingReviewRequests: 0,
            staleItems: 0,
            reviewApproved: 0,
            reviewChangesRequested: 0,
            reviewCommented: 1,
            reviewSelfAuthored: 0,
            reviewTeamAuthored: 1,
            reviewExternalAuthored: 0,
          },
        },
        {
          id: "review-external-1",
          type: "review",
          title: "External review",
          url: "https://example.com/pr-external",
          repo: "zephyrproject-rtos/repo-b",
          contributor: "alice",
          author: "external-author",
          state: "changes_requested",
          createdAt: "2026-03-04T00:00:00.000Z",
          updatedAt: "2026-03-09T14:00:00.000Z",
          ageDays: 1,
          statusLabel: "CHANGES_REQUESTED · Authored externally",
          reviewedPrKind: "authored-external",
          metrics: {
            openAssignedIssues: 0,
            openAuthoredPrs: 0,
            draftPrs: 0,
            mergedPrs: 0,
            closedUnmergedPrs: 0,
            reviewsSubmitted: 1,
            pendingReviewRequests: 0,
            staleItems: 0,
            reviewApproved: 0,
            reviewChangesRequested: 1,
            reviewCommented: 0,
            reviewSelfAuthored: 0,
            reviewTeamAuthored: 0,
            reviewExternalAuthored: 1,
          },
        },
      ],
    };

    const viewData = buildViewDashboardData(reviewData, "reviews");

    expect(viewData.activityItems).toHaveLength(3);
    expect(viewData.reviewSources.selfAuthored).toBe(0);
    expect(viewData.reviewSources.teamAuthored).toBe(2);
    expect(viewData.reviewSources.externalAuthored).toBe(1);
    expect(viewData.summary.uniqueReviewedPrs).toBe(2);

    const alice = viewData.contributors.find((contributor) => contributor.login === "alice");
    expect(alice).toBeDefined();
    expect(alice?.reviewsSubmitted).toBe(3);
    expect(alice?.uniqueReviewedPrs).toBe(2);
    expect(alice?.uniqueReviewedPrsTeamAuthored).toBe(1);
    expect(alice?.reviewTeamAuthored).toBe(2);
    expect(alice?.uniqueReviewedPrsExternalAuthored).toBe(1);
    expect(alice?.reviewExternalAuthored).toBe(1);
  });
});
