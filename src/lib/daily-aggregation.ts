/**
 * Aggregates DailyRecord[] arrays into a full DashboardData snapshot.
 *
 * This mirrors the aggregation logic in collectLiveDashboard (github.ts) but
 * operates on pre-collected DailyRecord[] from on-disk daily files instead of
 * making live GitHub API calls.
 */

import { differenceInCalendarDays, differenceInHours, differenceInMinutes, parseISO } from "date-fns";

import { calculateActivityScore } from "@/lib/scoring";
import type {
  ActivityItem,
  ContributorMetrics,
  DashboardData,
  DashboardWarning,
  PrStatusSummary,
  RangeOption,
  RepoActivity,
  ReviewerVerdict,
  ReviewOutcomeBreakdown,
  ReviewSourceBreakdown,
  RosterMember,
} from "@/lib/types";
import type { DailyIssueRecord, DailyPrRecord, DailyRecord, DailyReviewRecord } from "@/lib/daily-types";

function emptyMetrics() {
  return {
    openAssignedIssues: 0,
    closedIssues: 0,
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

type RepoAccumulator = {
  issues: number;
  prs: number;
  reviews: number;
  contributors: Set<string>;
};

/**
 * Deduplicate issue/PR records by URL, keeping the one with the latest updatedAt.
 */
function deduplicateByUrl<T extends { url: string; updatedAt: string }>(records: T[]): T[] {
  const map = new Map<string, T>();
  for (const record of records) {
    const existing = map.get(record.url);
    if (!existing || record.updatedAt > existing.updatedAt) {
      map.set(record.url, record);
    }
  }
  return Array.from(map.values());
}

/**
 * Deduplicate review records by reviewId (same review can appear in multiple daily files
 * if the PR was touched on multiple days).
 */
function deduplicateReviews(records: DailyReviewRecord[]): DailyReviewRecord[] {
  const map = new Map<number, DailyReviewRecord>();
  for (const record of records) {
    map.set(record.reviewId, record);
  }
  return Array.from(map.values());
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1))
    : sorted[mid];
}

/**
 * Produce a full DashboardData from accumulated DailyRecord[] entries.
 *
 * @param allRecords  Records from all daily files that overlap the window.
 *                    The function filters them to [range.from, range.to].
 * @param roster      The team roster (used for login matching and contributor map).
 * @param range       The time window to aggregate.
 */
export function aggregateDailyRecords(
  allRecords: DailyRecord[],
  roster: RosterMember[],
  range: RangeOption,
): DashboardData {
  const rosterLogins = new Set(roster.map((m) => m.login.toLowerCase()));

  // Build contributor map (login → accumulator)
  const contributorMap = new Map<string, ContributorMetrics>(
    roster.map((member) => [
      member.login.toLowerCase(),
      {
        login: member.login,
        name: member.name,
        role: member.role,
        ...emptyMetrics(),
        uniqueReviewedPrs: 0,
        repositoriesTouched: 0,
        activityScore: 0,
        archPrs: 0,
        rfcPrs: 0,
        stablePrs: 0,
      } satisfies ContributorMetrics,
    ]),
  );

  const repoMap = new Map<string, RepoAccumulator>();
  const activityItems: ActivityItem[] = [];
  const warnings: DashboardWarning[] = [];
  const reviewOutcomes: ReviewOutcomeBreakdown = { approved: 0, changesRequested: 0, commented: 0 };
  const reviewSources: ReviewSourceBreakdown = { selfAuthored: 0, teamAuthored: 0, externalAuthored: 0 };
  const firstReviewHours: number[] = [];
  const mergeHours: number[] = [];

  const staleCutoff = parseISO(range.to).getTime() - 7 * 86400000;

  // Partition records by type
  const issueRecords = allRecords.filter((r): r is DailyIssueRecord => r.type === "issue");
  const prRecords = allRecords.filter((r): r is DailyPrRecord => r.type === "pr");
  const reviewRecords = allRecords.filter((r): r is DailyReviewRecord => r.type === "review");

  // Deduplicate — same issue/PR may appear in multiple daily files
  const uniqueIssues = deduplicateByUrl(issueRecords);
  const uniquePrs = deduplicateByUrl(prRecords);
  const uniqueReviews = deduplicateReviews(reviewRecords);

  function getOrCreateRepo(name: string): RepoAccumulator {
    const existing = repoMap.get(name);
    if (existing) return existing;
    const fresh: RepoAccumulator = { issues: 0, prs: 0, reviews: 0, contributors: new Set() };
    repoMap.set(name, fresh);
    return fresh;
  }

  // -----------------------------------------------------------------------
  // Issues
  // -----------------------------------------------------------------------
  for (const issue of uniqueIssues) {
    // Open issues: all currently open — no date filter. An issue that has been
    // sitting open for months without an update is still on the assignee's plate.
    if (issue.state === "open") {
      const assigneeLogin = issue.assignees.find((a) => rosterLogins.has(a.toLowerCase()));
      if (!assigneeLogin) continue;
      const contributor = contributorMap.get(assigneeLogin.toLowerCase());
      if (!contributor) continue;

      contributor.openAssignedIssues += 1;
      const isStale = Date.parse(issue.updatedAt) < staleCutoff;
      if (isStale) contributor.staleItems += 1;

      getOrCreateRepo(issue.repo).issues += 1;
      getOrCreateRepo(issue.repo).contributors.add(contributor.login);

      activityItems.push({
        id: `issue-${issue.id}-${contributor.login}`,
        type: "issue",
        title: issue.title,
        url: issue.url,
        repo: issue.repo,
        contributor: contributor.login,
        author: issue.author,
        state: issue.state,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(issue.createdAt)),
        statusLabel: isStale ? "Stale issue" : "Assigned",
        labels: issue.labels,
        metrics: { ...emptyMetrics(), openAssignedIssues: 1, staleItems: isStale ? 1 : 0 },
      });
    }

    // Closed issues: closed within range
    if (issue.state === "closed" && issue.closedAt && issue.closedAt >= range.from && issue.closedAt <= range.to) {
      const assigneeLogin = issue.assignees.find((a) => rosterLogins.has(a.toLowerCase()));
      if (!assigneeLogin) continue;
      const contributor = contributorMap.get(assigneeLogin.toLowerCase());
      if (!contributor) continue;

      contributor.closedIssues += 1;
      getOrCreateRepo(issue.repo).issues += 1;
      getOrCreateRepo(issue.repo).contributors.add(contributor.login);

      activityItems.push({
        id: `issue-${issue.id}-${contributor.login}`,
        type: "issue",
        title: issue.title,
        url: issue.url,
        repo: issue.repo,
        contributor: contributor.login,
        author: issue.author,
        state: issue.state,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(issue.createdAt)),
        statusLabel: "Closed",
        labels: issue.labels,
        metrics: { ...emptyMetrics(), closedIssues: 1 },
      });
    }
  }

  // -----------------------------------------------------------------------
  // PRs
  // Open/draft PRs: no date filter — show all currently open PRs authored by
  // roster members regardless of last-update date.
  // Merged/closed PRs: date-scoped — only events that happened in the range.
  // -----------------------------------------------------------------------

  // Build a map of prUrl → all review records (all time, not range-filtered) for prStatus computation.
  const prReviewsMap = new Map<string, DailyReviewRecord[]>();
  for (const review of uniqueReviews) {
    const list = prReviewsMap.get(review.prUrl) ?? [];
    list.push(review);
    prReviewsMap.set(review.prUrl, list);
  }

  const teamOpenPrs = uniquePrs.filter(
    (pr) => pr.state === "open" && rosterLogins.has(pr.author.toLowerCase()),
  );
  const teamClosedPrs = uniquePrs.filter(
    (pr) => pr.state === "closed" && rosterLogins.has(pr.author.toLowerCase()) &&
      pr.updatedAt >= range.from && pr.updatedAt <= range.to,
  );

  for (const pr of teamOpenPrs) {
    const contributor = contributorMap.get(pr.author.toLowerCase());
    if (!contributor) continue;

    getOrCreateRepo(pr.repo).prs += 1;
    getOrCreateRepo(pr.repo).contributors.add(contributor.login);

    contributor.openAuthoredPrs += 1;
    if (pr.isDraft) contributor.draftPrs += 1;
    const isStale = Date.parse(pr.updatedAt) < staleCutoff;
    if (isStale) contributor.staleItems += 1;

    // Build prStatus from review records + requested reviewers + ciStatus
    const prReviews = prReviewsMap.get(pr.url) ?? [];
    const latestByReviewer = new Map<string, DailyReviewRecord>();
    for (const review of prReviews) {
      const existing = latestByReviewer.get(review.reviewer.toLowerCase());
      if (!existing || review.submittedAt > existing.submittedAt) {
        latestByReviewer.set(review.reviewer.toLowerCase(), review);
      }
    }
    const requestedSet = new Set(pr.requestedReviewers.map((r) => r.toLowerCase()));
    const requestedVerdicts: ReviewerVerdict[] = [];
    const otherVerdicts: ReviewerVerdict[] = [];
    for (const [reviewerKey, review] of latestByReviewer) {
      const verdict: ReviewerVerdict = {
        login: review.reviewer,
        state: review.state,
        wasRequested: requestedSet.has(reviewerKey),
      };
      if (verdict.wasRequested) requestedVerdicts.push(verdict);
      else otherVerdicts.push(verdict);
    }
    const pendingRequestedLogins = pr.requestedReviewers.filter(
      (r) => !latestByReviewer.has(r.toLowerCase()),
    );
    const pendingRequestedCount = pendingRequestedLogins.length;
    const cooldownHours = differenceInHours(new Date(), parseISO(pr.updatedAt));
    const prStatus: PrStatusSummary = {
      assignees: pr.assignees ?? [],
      requestedVerdicts,
      otherVerdicts,
      pendingRequestedLogins,
      pendingRequestedCount,
      ciStatus: pr.ciStatus ?? null,
      cooldownHours,
      cooldownMet: cooldownHours >= 72,
    };

    activityItems.push({
      id: `pull_request-${pr.id}-${contributor.login}`,
      type: "pull_request",
      title: pr.title,
      url: pr.url,
      repo: pr.repo,
      contributor: contributor.login,
      author: pr.author,
      state: pr.state,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      ageDays: differenceInCalendarDays(new Date(), parseISO(pr.createdAt)),
      statusLabel: pr.isDraft ? "Draft PR" : "Open PR",
      labels: pr.labels,
      prStatus,
      metrics: {
        ...emptyMetrics(),
        openAuthoredPrs: 1,
        draftPrs: pr.isDraft ? 1 : 0,
        staleItems: isStale ? 1 : 0,
      },
    });
  }

  for (const pr of teamClosedPrs) {
    const contributor = contributorMap.get(pr.author.toLowerCase());
    if (!contributor) continue;

    getOrCreateRepo(pr.repo).prs += 1;
    getOrCreateRepo(pr.repo).contributors.add(contributor.login);

    if (pr.mergedAt && pr.mergedAt >= range.from && pr.mergedAt <= range.to) {
      contributor.mergedPrs += 1;
      mergeHours.push(Math.abs(differenceInHours(parseISO(pr.mergedAt), parseISO(pr.createdAt))));

      activityItems.push({
        id: `pull_request-${pr.id}-${contributor.login}`,
        type: "pull_request",
        title: pr.title,
        url: pr.url,
        repo: pr.repo,
        contributor: contributor.login,
        author: pr.author,
        state: pr.state,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(pr.createdAt)),
        statusLabel: "Merged",
        labels: pr.labels,
        metrics: { ...emptyMetrics(), mergedPrs: 1 },
      });
    } else if (!pr.mergedAt) {
      contributor.closedUnmergedPrs += 1;

      activityItems.push({
        id: `pull_request-${pr.id}-${contributor.login}`,
        type: "pull_request",
        title: pr.title,
        url: pr.url,
        repo: pr.repo,
        contributor: contributor.login,
        author: pr.author,
        state: pr.state,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(pr.createdAt)),
        statusLabel: "Closed",
        labels: pr.labels,
        metrics: { ...emptyMetrics(), closedUnmergedPrs: 1 },
      });
    }
  }

  // -----------------------------------------------------------------------
  // Pending review requests (open PRs with roster member in requestedReviewers)
  // No date filter — a pending review request is still pending regardless of
  // when the PR was last updated.
  // -----------------------------------------------------------------------
  const openPrs = uniquePrs.filter((pr) => pr.state === "open");
  for (const pr of openPrs) {
    for (const reviewerLogin of pr.requestedReviewers) {
      const reviewerMetrics = contributorMap.get(reviewerLogin.toLowerCase());
      if (!reviewerMetrics) continue;

      reviewerMetrics.pendingReviewRequests += 1;
      activityItems.push({
        id: `review-request-${pr.id}-${reviewerMetrics.login}`,
        type: "review_request",
        title: `Review requested from ${reviewerMetrics.name}`,
        url: pr.url,
        repo: pr.repo,
        contributor: reviewerMetrics.login,
        author: pr.author,
        state: "open",
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        ageDays: differenceInCalendarDays(new Date(), parseISO(pr.updatedAt)),
        statusLabel: "Pending review request",
        metrics: { ...emptyMetrics(), pendingReviewRequests: 1 },
      });
    }
  }

  // -----------------------------------------------------------------------
  // Reviews (filter to range by submittedAt)
  // -----------------------------------------------------------------------
  const rangedReviews = uniqueReviews.filter(
    (r) => r.submittedAt >= range.from && r.submittedAt <= range.to,
  );

  // Build a map of prUrl → sorted review dates for firstReviewHours calculation
  const prFirstReviewMap = new Map<string, string>();
  for (const review of rangedReviews) {
    if (rosterLogins.has(review.reviewer.toLowerCase())) {
      const existing = prFirstReviewMap.get(review.prUrl);
      if (!existing || review.submittedAt < existing) {
        prFirstReviewMap.set(review.prUrl, review.submittedAt);
      }
    }
  }

  // Cross-reference with PR createdAt for firstReviewHours
  const prCreatedAtMap = new Map<string, string>(uniquePrs.map((pr) => [pr.url, pr.createdAt]));
  for (const [prUrl, firstReviewAt] of prFirstReviewMap) {
    const prCreatedAt = prCreatedAtMap.get(prUrl);
    if (prCreatedAt) {
      firstReviewHours.push(Math.abs(differenceInHours(parseISO(firstReviewAt), parseISO(prCreatedAt))));
    }
  }

  for (const review of rangedReviews) {
    const reviewer = contributorMap.get(review.reviewer.toLowerCase());
    if (!reviewer) continue;

    const reviewAuthorLogin = review.prAuthor;
    const reviewedPrKind =
      reviewAuthorLogin.toLowerCase() === review.reviewer.toLowerCase()
        ? "authored-by-self"
        : rosterLogins.has(reviewAuthorLogin.toLowerCase())
          ? "authored-by-them"
          : "authored-external";

    reviewer.reviewsSubmitted += 1;
    if (reviewedPrKind === "authored-by-self") reviewer.reviewSelfAuthored += 1;
    else if (reviewedPrKind === "authored-by-them") reviewer.reviewTeamAuthored += 1;
    else reviewer.reviewExternalAuthored += 1;

    getOrCreateRepo(review.repo).reviews += 1;
    getOrCreateRepo(review.repo).contributors.add(reviewer.login);

    activityItems.push({
      id: `review-${review.reviewId}`,
      type: "review",
      title: `${review.prTitle} review by ${reviewer.name}`,
      url: review.prUrl,
      repo: review.repo,
      contributor: reviewer.login,
      author: reviewAuthorLogin,
      state: review.state.toLowerCase(),
      createdAt: review.submittedAt, // best approximation available
      updatedAt: review.submittedAt,
      ageDays: differenceInCalendarDays(new Date(), parseISO(review.submittedAt)),
      statusLabel:
        reviewedPrKind === "authored-by-self"
          ? `${review.state} · Authored by self`
          : reviewedPrKind === "authored-by-them"
            ? `${review.state} · Authored by teammate`
            : `${review.state} · Authored externally`,
      reviewedPrKind,
      metrics: {
        ...emptyMetrics(),
        reviewsSubmitted: 1,
        reviewApproved: review.state === "APPROVED" ? 1 : 0,
        reviewChangesRequested: review.state === "CHANGES_REQUESTED" ? 1 : 0,
        reviewCommented: review.state === "APPROVED" || review.state === "CHANGES_REQUESTED" ? 0 : 1,
        reviewSelfAuthored: reviewedPrKind === "authored-by-self" ? 1 : 0,
        reviewTeamAuthored: reviewedPrKind === "authored-by-them" ? 1 : 0,
        reviewExternalAuthored: reviewedPrKind === "authored-external" ? 1 : 0,
      },
    });

    if (review.state === "APPROVED") reviewOutcomes.approved += 1;
    else if (review.state === "CHANGES_REQUESTED") reviewOutcomes.changesRequested += 1;
    else reviewOutcomes.commented += 1;

    if (reviewedPrKind === "authored-by-self") reviewSources.selfAuthored += 1;
    else if (reviewedPrKind === "authored-by-them") reviewSources.teamAuthored += 1;
    else reviewSources.externalAuthored += 1;
  }

  // -----------------------------------------------------------------------
  // Final contributor metrics
  // -----------------------------------------------------------------------
  const contributors = Array.from(contributorMap.values())
    .map((contributor) => {
      const reviewItems = activityItems.filter(
        (item) => item.type === "review" && item.contributor === contributor.login,
      );
      contributor.repositoriesTouched = Array.from(repoMap.values()).filter((repo) =>
        repo.contributors.has(contributor.login),
      ).length;
      contributor.uniqueReviewedPrs = new Set(reviewItems.map((item) => item.url)).size;
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
    .sort((a, b) => b.activityScore - a.activityScore);

  const repoActivity: RepoActivity[] = Array.from(repoMap.entries())
    .map(([name, values]) => ({
      name,
      issues: values.issues,
      prs: values.prs,
      reviews: values.reviews,
      contributors: values.contributors.size,
    }))
    .sort((a, b) => b.prs + b.reviews - (a.prs + a.reviews));

  const generatedAt = new Date().toISOString();

  return {
    range,
    generatedAt,
    rosterSize: roster.length,
    rosterMembers: roster,
    warnings,
    summary: {
      openAssignedIssues: contributors.reduce((sum, c) => sum + c.openAssignedIssues, 0),
      closedIssues: contributors.reduce((sum, c) => sum + c.closedIssues, 0),
      openAuthoredPrs: contributors.reduce((sum, c) => sum + c.openAuthoredPrs, 0),
      mergedPrs: contributors.reduce((sum, c) => sum + c.mergedPrs, 0),
      reviewsSubmitted: contributors.reduce((sum, c) => sum + c.reviewsSubmitted, 0),
      pendingReviewRequests: contributors.reduce((sum, c) => sum + c.pendingReviewRequests, 0),
      uniqueReviewedPrs: new Set(activityItems.filter((i) => i.type === "review").map((i) => i.url)).size,
      staleItems: contributors.reduce((sum, c) => sum + c.staleItems, 0),
      repositoriesTouched: repoActivity.length,
      medianFirstReviewHours: median(firstReviewHours),
      medianMergeHours: median(mergeHours),
    },
    reviewOutcomes,
    reviewSources,
    contributors,
    repoActivity,
    activityItems: activityItems.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1)),
    syncHealth: {
      source: "live",
      generatedAt,
      freshnessMinutes: Math.max(0, differenceInMinutes(new Date(generatedAt), new Date(generatedAt))),
      searchSamples: allRecords.length,
      detailSamples: uniquePrs.length,
      liveEnabled: true,
    },
    filterOptions: {
      contributors: roster.map((member) => ({ login: member.login, name: member.name })),
      repos: Array.from(new Set(repoActivity.map((repo) => repo.name))).sort(),
    },
    auth: {
      hasToken: true,
      connectionStatus: "valid",
      message: "Aggregated from daily files.",
      checkedAt: generatedAt,
    },
  };
}
