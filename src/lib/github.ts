import { differenceInHours, differenceInMinutes, differenceInCalendarDays, parseISO } from "date-fns";
import pLimit from "p-limit";

import type {
  ActivityItem,
  ContributorMetrics,
  DashboardData,
  DashboardWarning,
  RepoActivity,
  ReviewOutcomeBreakdown,
  RosterMember,
  RangeOption,
} from "@/lib/types";

type SearchItem = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  state: string;
  draft?: boolean;
  user: { login: string };
  assignees?: Array<{ login: string }>;
  pull_request?: { url: string };
};

type SearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: SearchItem[];
};

type PullRequestDetail = {
  id: number;
  number: number;
  html_url: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  state: string;
  requested_reviewers: Array<{ login: string }>;
  user: { login: string };
  head: { repo: { full_name: string } | null };
  base: { repo: { full_name: string } | null };
};

type PullRequestReview = {
  id: number;
  state: string;
  submitted_at: string | null;
  user: { login: string } | null;
};

type RepoAccumulator = {
  issues: number;
  prs: number;
  reviews: number;
  contributors: Set<string>;
};

type ContributorAccumulator = ContributorMetrics;

const API_ROOT = "https://api.github.com";
const ORG = process.env.GITHUB_ORG ?? "zephyrproject-rtos";
const SEARCH_PAGE_LIMIT = Number(process.env.SEARCH_PAGE_LIMIT ?? 5);
const PR_DETAIL_LIMIT = Number(process.env.PR_DETAIL_LIMIT ?? 40);
const limit = pLimit(4);

function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "zephyr-team-activity-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchGitHub<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: getHeaders(),
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function searchIssues(query: string, page: number): Promise<SearchResponse> {
  return fetchGitHub<SearchResponse>(`/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`);
}

async function searchAcrossPages(query: string, maxPages = SEARCH_PAGE_LIMIT) {
  const allItems: SearchItem[] = [];
  let totalCount = 0;
  let incompleteResults = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await searchIssues(query, page);
    totalCount = response.total_count;
    incompleteResults = incompleteResults || response.incomplete_results;
    allItems.push(...response.items);

    if (response.items.length < 100) {
      break;
    }
  }

  return {
    totalCount,
    incompleteResults,
    items: allItems,
    capped: allItems.length >= maxPages * 100,
  };
}

async function fetchPullRequestDetails(pullRequestUrl: string): Promise<PullRequestDetail> {
  const url = new URL(pullRequestUrl);
  return fetchGitHub<PullRequestDetail>(url.pathname);
}

async function fetchPullRequestReviews(owner: string, repo: string, number: number): Promise<PullRequestReview[]> {
  return fetchGitHub<PullRequestReview[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`);
}

function repoFullNameFromSearchItem(item: SearchItem): string {
  return item.repository_url.replace(`${API_ROOT}/repos/`, "");
}

function createContributorMap(roster: RosterMember[]): Map<string, ContributorAccumulator> {
  return new Map(
    roster.map((member) => [
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
}

function asActivityItem(item: SearchItem, contributor: string, type: ActivityItem["type"], statusLabel: string): ActivityItem {
  return {
    id: `${type}-${item.id}-${contributor}`,
    type,
    title: item.title,
    url: item.html_url,
    repo: repoFullNameFromSearchItem(item),
    contributor,
    state: item.state,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    ageDays: differenceInCalendarDays(new Date(), parseISO(item.created_at)),
    statusLabel,
  };
}

export async function collectLiveDashboard(roster: RosterMember[], range: RangeOption): Promise<DashboardData> {
  const rosterLogins = new Set(roster.map((member) => member.login.toLowerCase()));
  const contributorMap = createContributorMap(roster);
  const repoMap = new Map<string, RepoAccumulator>();
  const warnings: DashboardWarning[] = [];
  const reviewOutcomes: ReviewOutcomeBreakdown = {
    approved: 0,
    changesRequested: 0,
    commented: 0,
  };
  const activityItems: ActivityItem[] = [];
  const firstReviewHours: number[] = [];
  const mergeHours: number[] = [];
  let searchSamples = 0;
  let detailSamples = 0;

  const staleCutoff = parseISO(range.to).getTime() - 7 * 86400000;

  const [openIssuesResult, openPrsResult, mergedPrsResult, closedPrsResult] = await Promise.all([
    searchAcrossPages(`org:${ORG} is:issue is:open archived:false sort:updated-desc`),
    searchAcrossPages(`org:${ORG} is:pr is:open archived:false sort:updated-desc`, Math.max(2, SEARCH_PAGE_LIMIT - 1)),
    searchAcrossPages(`org:${ORG} is:pr merged:${range.from.slice(0, 10)}..${range.to.slice(0, 10)} archived:false sort:updated-desc`, 3),
    searchAcrossPages(`org:${ORG} is:pr is:closed closed:${range.from.slice(0, 10)}..${range.to.slice(0, 10)} -is:merged archived:false sort:updated-desc`, 2),
  ]);

  searchSamples +=
    openIssuesResult.items.length + openPrsResult.items.length + mergedPrsResult.items.length + closedPrsResult.items.length;

  if (openIssuesResult.incompleteResults || openPrsResult.incompleteResults || mergedPrsResult.incompleteResults || closedPrsResult.incompleteResults) {
    warnings.push({ level: "warn", message: "GitHub Search returned incomplete results for one or more queries. Totals may be partial." });
  }

  if (openIssuesResult.capped || openPrsResult.capped || mergedPrsResult.capped || closedPrsResult.capped) {
    warnings.push({
      level: "warn",
      message: "Collection hit the configured search page limit. Increase SEARCH_PAGE_LIMIT for fuller org-wide coverage.",
    });
  }

  const teamOpenIssues = openIssuesResult.items.filter((item) =>
    (item.assignees ?? []).some((assignee) => rosterLogins.has(assignee.login.toLowerCase())),
  );

  for (const item of teamOpenIssues) {
    const assignee = (item.assignees ?? []).find((candidate) => rosterLogins.has(candidate.login.toLowerCase()));
    if (!assignee) {
      continue;
    }

    const contributor = contributorMap.get(assignee.login.toLowerCase());
    if (!contributor) {
      continue;
    }

    contributor.openAssignedIssues += 1;
    if (Date.parse(item.updated_at) < staleCutoff) {
      contributor.staleItems += 1;
    }

    const repo = repoFullNameFromSearchItem(item);
    const repoEntry = repoMap.get(repo) ?? { issues: 0, prs: 0, reviews: 0, contributors: new Set<string>() };
    repoEntry.issues += 1;
    repoEntry.contributors.add(contributor.login);
    repoMap.set(repo, repoEntry);

    activityItems.push(asActivityItem(item, contributor.login, "issue", Date.parse(item.updated_at) < staleCutoff ? "Stale issue" : "Assigned"));
  }

  const allTeamPrItems = [...openPrsResult.items, ...mergedPrsResult.items, ...closedPrsResult.items].filter((item) =>
    rosterLogins.has(item.user.login.toLowerCase()),
  );

  const uniquePrs = Array.from(new Map(allTeamPrItems.map((item) => [item.pull_request?.url ?? item.html_url, item])).values()).slice(0, PR_DETAIL_LIMIT);

  for (const item of uniquePrs) {
    const contributor = contributorMap.get(item.user.login.toLowerCase());
    if (!contributor) {
      continue;
    }

    const repo = repoFullNameFromSearchItem(item);
    const repoEntry = repoMap.get(repo) ?? { issues: 0, prs: 0, reviews: 0, contributors: new Set<string>() };
    repoEntry.prs += 1;
    repoEntry.contributors.add(contributor.login);
    repoMap.set(repo, repoEntry);

    if (item.state === "open") {
      contributor.openAuthoredPrs += 1;
      if (Date.parse(item.updated_at) < staleCutoff) {
        contributor.staleItems += 1;
      }
    }

    if (item.closed_at && item.html_url.includes("/pull/")) {
      if (mergedPrsResult.items.some((candidate) => candidate.id === item.id)) {
        contributor.mergedPrs += 1;
      } else {
        contributor.closedUnmergedPrs += 1;
      }
    }

    activityItems.push(
      asActivityItem(
        item,
        contributor.login,
        "pull_request",
        item.state === "open" ? "Open PR" : mergedPrsResult.items.some((candidate) => candidate.id === item.id) ? "Merged" : "Closed",
      ),
    );
  }

  const detailTargets = uniquePrs.filter((item) => item.pull_request?.url).slice(0, PR_DETAIL_LIMIT);

  const detailResults = await Promise.all(
    detailTargets.map((item) =>
      limit(async () => {
        const detail = await fetchPullRequestDetails(item.pull_request!.url);
        const repoFullName = detail.base.repo?.full_name ?? detail.head.repo?.full_name;
        if (!repoFullName) {
          return null;
        }
        const [owner, repo] = repoFullName.split("/");
        const reviews = await fetchPullRequestReviews(owner, repo, detail.number);
        return { item, detail, reviews, repoFullName };
      }),
    ),
  );

  for (const result of detailResults) {
    if (!result) {
      continue;
    }

    detailSamples += 1;
    const { item, detail, reviews, repoFullName } = result;
    const contributor = contributorMap.get(item.user.login.toLowerCase());
    if (!contributor) {
      continue;
    }

    if (detail.draft) {
      contributor.draftPrs += 1;
    }

    const matchingRequests = detail.requested_reviewers.filter((reviewer) => rosterLogins.has(reviewer.login.toLowerCase()));
    for (const reviewer of matchingRequests) {
      const reviewerMetrics = contributorMap.get(reviewer.login.toLowerCase());
      if (reviewerMetrics) {
        reviewerMetrics.pendingReviewRequests += 1;
      }
    }

    const repoEntry = repoMap.get(repoFullName) ?? { issues: 0, prs: 0, reviews: 0, contributors: new Set<string>() };
    repoEntry.contributors.add(contributor.login);

    const rangedTeamReviews = reviews.filter(
      (review) =>
        Boolean(review.user?.login) &&
        Boolean(review.submitted_at) &&
        rosterLogins.has(review.user!.login.toLowerCase()) &&
        review.submitted_at! >= range.from &&
        review.submitted_at! <= range.to,
    );

    if (rangedTeamReviews.length > 0) {
      const firstReview = rangedTeamReviews
        .filter((review) => review.submitted_at)
        .sort((left, right) => (left.submitted_at! < right.submitted_at! ? -1 : 1))[0];

      if (firstReview?.submitted_at) {
        firstReviewHours.push(Math.abs(differenceInHours(parseISO(firstReview.submitted_at), parseISO(detail.created_at))));
      }
    }

    if (detail.merged_at) {
      mergeHours.push(Math.abs(differenceInHours(parseISO(detail.merged_at), parseISO(detail.created_at))));
    }

    for (const review of rangedTeamReviews) {
      const reviewer = review.user?.login ? contributorMap.get(review.user.login.toLowerCase()) : null;
      if (!reviewer || !review.submitted_at) {
        continue;
      }

      reviewer.reviewsSubmitted += 1;
      repoEntry.reviews += 1;
      repoEntry.contributors.add(reviewer.login);
      activityItems.push({
        id: `review-${review.id}`,
        type: "review",
        title: `${item.title} review by ${reviewer.name}`,
        url: item.html_url,
        repo: repoFullName,
        contributor: reviewer.login,
        state: review.state.toLowerCase(),
        createdAt: detail.created_at,
        updatedAt: review.submitted_at,
        ageDays: differenceInCalendarDays(new Date(), parseISO(review.submitted_at)),
        statusLabel: review.state,
      });

      const state = review.state.toUpperCase();
      if (state === "APPROVED") {
        reviewOutcomes.approved += 1;
      } else if (state === "CHANGES_REQUESTED") {
        reviewOutcomes.changesRequested += 1;
      } else {
        reviewOutcomes.commented += 1;
      }
    }

    repoMap.set(repoFullName, repoEntry);
  }

  const contributors = Array.from(contributorMap.values())
    .map((contributor) => {
      contributor.repositoriesTouched = Array.from(repoMap.values()).filter((repo) => repo.contributors.has(contributor.login)).length;
      contributor.activityScore =
        contributor.openAssignedIssues * 3 +
        contributor.openAuthoredPrs * 3 +
        contributor.mergedPrs * 2 +
        contributor.reviewsSubmitted +
        contributor.pendingReviewRequests * 2 +
        contributor.staleItems;
      return contributor;
    })
    .filter((contributor) => contributor.activityScore > 0)
    .sort((left, right) => right.activityScore - left.activityScore);

  const repoActivity: RepoActivity[] = Array.from(repoMap.entries())
    .map(([name, values]) => ({
      name,
      issues: values.issues,
      prs: values.prs,
      reviews: values.reviews,
      contributors: values.contributors.size,
    }))
    .sort((left, right) => right.prs + right.reviews - (left.prs + left.reviews));

  const median = (values: number[]) => {
    if (values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1)) : sorted[middle];
  };

  const generatedAt = new Date().toISOString();
  const freshnessMinutes = Math.max(0, differenceInMinutes(new Date(generatedAt), new Date(generatedAt)));

  return {
    range,
    generatedAt,
    rosterSize: roster.length,
    warnings,
    summary: {
      openAssignedIssues: contributors.reduce((total, contributor) => total + contributor.openAssignedIssues, 0),
      openAuthoredPrs: contributors.reduce((total, contributor) => total + contributor.openAuthoredPrs, 0),
      mergedPrs: contributors.reduce((total, contributor) => total + contributor.mergedPrs, 0),
      reviewsSubmitted: contributors.reduce((total, contributor) => total + contributor.reviewsSubmitted, 0),
      pendingReviewRequests: contributors.reduce((total, contributor) => total + contributor.pendingReviewRequests, 0),
      staleItems: contributors.reduce((total, contributor) => total + contributor.staleItems, 0),
      repositoriesTouched: repoActivity.length,
      medianFirstReviewHours: median(firstReviewHours),
      medianMergeHours: median(mergeHours),
    },
    reviewOutcomes,
    contributors,
    repoActivity,
    activityItems: activityItems.sort((left, right) => (left.updatedAt > right.updatedAt ? -1 : 1)).slice(0, 40),
    syncHealth: {
      source: "live",
      generatedAt,
      freshnessMinutes,
      searchSamples,
      detailSamples,
      liveEnabled: true,
    },
  };
}
