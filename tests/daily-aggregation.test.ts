import { describe, expect, it } from "vitest";

import { aggregateDailyRecords } from "@/lib/daily-aggregation";
import type { DailyIssueRecord, DailyPrRecord, DailyRecord, DailyReviewRecord } from "@/lib/daily-types";
import type { RangeOption, RosterMember } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const range: RangeOption = {
  preset: "7d",
  label: "Last 7 days",
  from: "2026-03-07T00:00:00.000Z",
  to: "2026-03-13T23:59:59.000Z",
  timeZone: "UTC",
};

const roster: RosterMember[] = [
  { login: "alice", name: "Alice", email: null, createdAt: "2026-01-01T00:00:00Z", role: "Engineer" },
  { login: "bob", name: "Bob", email: null, createdAt: "2026-01-01T00:00:00Z", role: "Engineer" },
];

function makeIssue(overrides: Partial<DailyIssueRecord> = {}): DailyIssueRecord {
  return {
    type: "issue",
    id: 1001,
    number: 101,
    repo: "org/repo",
    title: "Test issue",
    url: "https://github.com/org/repo/issues/101",
    author: "alice",
    assignees: ["alice"],
    state: "open",
    createdAt: "2026-03-08T10:00:00Z",
    updatedAt: "2026-03-10T10:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function makePr(overrides: Partial<DailyPrRecord> = {}): DailyPrRecord {
  return {
    type: "pr",
    id: 2001,
    number: 201,
    repo: "org/repo",
    title: "Test PR",
    url: "https://github.com/org/repo/pull/201",
    author: "alice",
    state: "open",
    isDraft: false,
    createdAt: "2026-03-08T10:00:00Z",
    updatedAt: "2026-03-10T10:00:00Z",
    mergedAt: null,
    requestedReviewers: [],
    ...overrides,
  };
}

function makeReview(overrides: Partial<DailyReviewRecord> = {}): DailyReviewRecord {
  return {
    type: "review",
    reviewId: 3001,
    repo: "org/repo",
    prNumber: 201,
    prTitle: "Test PR",
    prUrl: "https://github.com/org/repo/pull/201",
    prAuthor: "alice",
    reviewer: "bob",
    state: "APPROVED",
    submittedAt: "2026-03-10T10:00:00Z",
    prIsDraft: false,
    prMergedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("aggregateDailyRecords", () => {
  it("returns empty DashboardData when no records are provided", () => {
    const data = aggregateDailyRecords([], roster, range);
    expect(data.contributors).toHaveLength(0);
    expect(data.summary.openAssignedIssues).toBe(0);
    expect(data.summary.mergedPrs).toBe(0);
    expect(data.summary.reviewsSubmitted).toBe(0);
    expect(data.rosterSize).toBe(2);
    expect(data.rosterMembers).toEqual(roster);
  });

  it("counts open assigned issues for roster members", () => {
    const records: DailyRecord[] = [makeIssue({ assignees: ["alice"], state: "open" })];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.openAssignedIssues).toBe(1);
    expect(data.summary.openAssignedIssues).toBe(1);
  });

  it("ignores open issues assigned to non-roster members", () => {
    const records: DailyRecord[] = [makeIssue({ assignees: ["external-user"], state: "open" })];
    const data = aggregateDailyRecords(records, roster, range);
    expect(data.contributors).toHaveLength(0);
    expect(data.summary.openAssignedIssues).toBe(0);
  });

  it("counts closed issues in range", () => {
    const records: DailyRecord[] = [
      makeIssue({ state: "closed", closedAt: "2026-03-10T10:00:00Z" }),
    ];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.closedIssues).toBe(1);
    expect(data.summary.closedIssues).toBe(1);
  });

  it("excludes closed issues with closedAt outside range", () => {
    const records: DailyRecord[] = [
      makeIssue({ state: "closed", closedAt: "2026-03-01T10:00:00Z", updatedAt: "2026-03-01T10:00:00Z" }),
    ];
    const data = aggregateDailyRecords(records, roster, range);
    expect(data.summary.closedIssues).toBe(0);
  });

  it("counts open authored PRs", () => {
    const records: DailyRecord[] = [makePr({ state: "open", author: "alice" })];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.openAuthoredPrs).toBe(1);
    expect(data.summary.openAuthoredPrs).toBe(1);
  });

  it("counts merged PRs with mergedAt in range", () => {
    const records: DailyRecord[] = [
      makePr({ state: "closed", mergedAt: "2026-03-10T10:00:00Z" }),
    ];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.mergedPrs).toBe(1);
    expect(data.summary.mergedPrs).toBe(1);
  });

  it("does not count merged PR if mergedAt is outside range", () => {
    const records: DailyRecord[] = [
      makePr({ state: "closed", mergedAt: "2026-03-01T10:00:00Z", updatedAt: "2026-03-01T10:00:00Z" }),
    ];
    const data = aggregateDailyRecords(records, roster, range);
    expect(data.summary.mergedPrs).toBe(0);
  });

  it("counts reviews submitted in range", () => {
    const records: DailyRecord[] = [makeReview({ reviewer: "bob", submittedAt: "2026-03-10T10:00:00Z" })];
    const data = aggregateDailyRecords(records, roster, range);

    const bob = data.contributors.find((c) => c.login === "bob");
    expect(bob?.reviewsSubmitted).toBe(1);
    expect(data.summary.reviewsSubmitted).toBe(1);
  });

  it("excludes reviews with submittedAt outside range", () => {
    const records: DailyRecord[] = [
      makeReview({ submittedAt: "2026-03-01T10:00:00Z" }),
    ];
    const data = aggregateDailyRecords(records, roster, range);
    expect(data.summary.reviewsSubmitted).toBe(0);
  });

  it("deduplicates issues with the same URL, keeping latest updatedAt", () => {
    const older = makeIssue({ updatedAt: "2026-03-08T10:00:00Z", state: "open" });
    const newer = makeIssue({ updatedAt: "2026-03-11T10:00:00Z", state: "open" });
    const records: DailyRecord[] = [older, newer];
    const data = aggregateDailyRecords(records, roster, range);

    // Should count only once
    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.openAssignedIssues).toBe(1);
  });

  it("deduplicates PRs with the same URL, keeping latest state", () => {
    const olderPr = makePr({ updatedAt: "2026-03-08T10:00:00Z", state: "open" });
    const newerPr = makePr({ updatedAt: "2026-03-11T10:00:00Z", state: "closed", mergedAt: "2026-03-11T10:00:00Z" });
    const records: DailyRecord[] = [olderPr, newerPr];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    // Latest state is merged, not open
    expect(alice?.mergedPrs).toBe(1);
    expect(alice?.openAuthoredPrs).toBe(0);
  });

  it("deduplicates reviews by reviewId across daily files", () => {
    const review1 = makeReview({ reviewId: 3001 });
    const review2 = makeReview({ reviewId: 3001 }); // same reviewId = duplicate
    const records: DailyRecord[] = [review1, review2];
    const data = aggregateDailyRecords(records, roster, range);

    const bob = data.contributors.find((c) => c.login === "bob");
    expect(bob?.reviewsSubmitted).toBe(1); // counted once, not twice
  });

  it("counts pending review requests for roster members", () => {
    const pr = makePr({ state: "open", requestedReviewers: ["bob"] });
    const records: DailyRecord[] = [pr];
    const data = aggregateDailyRecords(records, roster, range);

    const bob = data.contributors.find((c) => c.login === "bob");
    expect(bob?.pendingReviewRequests).toBe(1);
    expect(data.summary.pendingReviewRequests).toBe(1);
  });

  it("classifies reviews by source (team vs external)", () => {
    const teamReview = makeReview({ reviewer: "bob", prAuthor: "alice" }); // alice is in roster
    const externalReview = makeReview({
      reviewId: 4001,
      reviewer: "bob",
      prAuthor: "external-dev",
      prUrl: "https://github.com/org/repo/pull/999",
    });
    const records: DailyRecord[] = [teamReview, externalReview];
    const data = aggregateDailyRecords(records, roster, range);

    const bob = data.contributors.find((c) => c.login === "bob");
    expect(bob?.reviewTeamAuthored).toBe(1);
    expect(bob?.reviewExternalAuthored).toBe(1);
    expect(bob?.reviewsSubmitted).toBe(2);
  });

  it("classifies self-authored reviews correctly", () => {
    const selfReview = makeReview({ reviewer: "alice", prAuthor: "alice" });
    const records: DailyRecord[] = [makePr(), selfReview];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.reviewSelfAuthored).toBe(1);
  });

  it("produces correct reviewOutcomes breakdown", () => {
    const approved = makeReview({ reviewId: 1, state: "APPROVED" });
    const changesRequested = makeReview({ reviewId: 2, state: "CHANGES_REQUESTED", prUrl: "https://github.com/org/repo/pull/202" });
    const commented = makeReview({ reviewId: 3, state: "COMMENTED", prUrl: "https://github.com/org/repo/pull/203" });
    const records: DailyRecord[] = [approved, changesRequested, commented];
    const data = aggregateDailyRecords(records, roster, range);

    expect(data.reviewOutcomes.approved).toBe(1);
    expect(data.reviewOutcomes.changesRequested).toBe(1);
    expect(data.reviewOutcomes.commented).toBe(1);
  });

  it("marks stale open issues (updated > 7 days before range.to) using a 30d range", () => {
    // Use a 30d range so range.from (Feb 12) is earlier than the stale cutoff (March 6).
    // An issue updated on March 5 is within the 30d window but before the stale cutoff.
    const thirtyDayRange: RangeOption = {
      preset: "30d",
      label: "Last 30 days",
      from: "2026-02-12T00:00:00.000Z",
      to: "2026-03-13T23:59:59.000Z",
      timeZone: "UTC",
    };
    const staleIssue = makeIssue({ updatedAt: "2026-03-05T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" });
    const records: DailyRecord[] = [staleIssue];
    const data = aggregateDailyRecords(records, roster, thirtyDayRange);

    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.staleItems).toBe(1);
    expect(data.summary.staleItems).toBe(1);
  });

  it("counts draft PRs", () => {
    const draft = makePr({ isDraft: true });
    const records: DailyRecord[] = [draft];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    expect(alice?.draftPrs).toBe(1);
  });

  it("populates repoActivity", () => {
    const records: DailyRecord[] = [
      makeIssue(),
      makePr(),
      makeReview(),
    ];
    const data = aggregateDailyRecords(records, roster, range);

    expect(data.repoActivity).toHaveLength(1);
    expect(data.repoActivity[0].name).toBe("org/repo");
    expect(data.repoActivity[0].issues).toBeGreaterThan(0);
  });

  it("returns correct filterOptions from roster", () => {
    const data = aggregateDailyRecords([], roster, range);
    expect(data.filterOptions.contributors).toEqual([
      { login: "alice", name: "Alice" },
      { login: "bob", name: "Bob" },
    ]);
  });

  it("handles multiple roster members independently", () => {
    const records: DailyRecord[] = [
      makeIssue({ assignees: ["alice"] }),
      makePr({ author: "bob", url: "https://github.com/org/repo/pull/300", id: 3000 }),
      makeReview({ reviewer: "bob", submittedAt: "2026-03-10T10:00:00Z" }),
    ];
    const data = aggregateDailyRecords(records, roster, range);

    const alice = data.contributors.find((c) => c.login === "alice");
    const bob = data.contributors.find((c) => c.login === "bob");

    expect(alice?.openAssignedIssues).toBe(1);
    expect(bob?.openAuthoredPrs).toBe(1);
    expect(bob?.reviewsSubmitted).toBe(1);
  });
});
