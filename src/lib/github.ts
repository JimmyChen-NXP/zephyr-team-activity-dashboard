import { differenceInHours, differenceInMinutes, differenceInCalendarDays, parseISO } from "date-fns";
import pLimit from "p-limit";

import { calculateActivityScore } from "@/lib/scoring";
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

type RateLimitResponse = {
  resources?: {
    core?: {
      remaining?: number;
    };
  };
};

type ContributorAccumulator = ContributorMetrics;

const API_ROOT = "https://api.github.com";
const ORG = process.env.GITHUB_ORG ?? "zephyrproject-rtos";
const SEARCH_PAGE_LIMIT = Number(process.env.SEARCH_PAGE_LIMIT ?? 10);
const SEARCH_API_MAX_PAGES = 10;
const PR_DETAIL_LIMIT = Number(process.env.PR_DETAIL_LIMIT ?? 40);
const REVIEW_DETAIL_LIMIT = Number(process.env.REVIEW_DETAIL_LIMIT ?? 120);
const limit = pLimit(4);

const DEFAULT_SEARCH_MIN_INTERVAL_MS = 2200;
let searchThrottleChain: Promise<void> = Promise.resolve();
let lastSearchRequestAt = 0;

function getSearchMinIntervalMs() {
  const configured = Number(process.env.GITHUB_SEARCH_MIN_INTERVAL_MS ?? "");
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return process.env.GITHUB_ACTIONS ? DEFAULT_SEARCH_MIN_INTERVAL_MS : 0;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function throttleGitHubSearch() {
  const minIntervalMs = getSearchMinIntervalMs();
  if (minIntervalMs <= 0) {
    return Promise.resolve();
  }

  searchThrottleChain = searchThrottleChain
    .catch(() => {})
    .then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lastSearchRequestAt + minIntervalMs - now);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      lastSearchRequestAt = Date.now();
    });

  return searchThrottleChain;
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
    reviewSelfAuthored: 0,
    reviewTeamAuthored: 0,
    reviewExternalAuthored: 0,
  };
}

function getHeaders(token?: string): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "zephyr-team-activity-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export class GitHubRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly rateLimitRemaining: number | null = null,
    public readonly requestPath: string | null = null,
    public readonly responseBody: string | null = null,
  ) {
    const pathText = requestPath ? ` (${requestPath})` : "";
    const bodyText = responseBody ? `: ${responseBody}` : "";
    super(`GitHub request failed: ${status} ${statusText}${pathText}${bodyText}`);
  }
}

async function fetchGitHub<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: getHeaders(token),
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    const rateLimitRemainingHeader = response.headers.get("x-ratelimit-remaining");
    const responseBody = await response
      .text()
      .then((text) => (text ? text.replace(/\s+/g, " ").slice(0, 500) : null))
      .catch(() => null);
    throw new GitHubRequestError(
      response.status,
      response.statusText,
      rateLimitRemainingHeader === null ? null : Number(rateLimitRemainingHeader),
      path,
      responseBody,
    );
  }

  return (await response.json()) as T;
}

export async function probeGitHubConnection(token: string) {
  const checkedAt = new Date().toISOString();
  const response = await fetch(`${API_ROOT}/rate_limit`, {
    headers: getHeaders(token),
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    const rateLimitRemainingHeader = response.headers.get("x-ratelimit-remaining");
    throw new GitHubRequestError(
      response.status,
      response.statusText,
      rateLimitRemainingHeader === null ? null : Number(rateLimitRemainingHeader),
    );
  }

  const body = (await response.json()) as RateLimitResponse;

  return {
    checkedAt,
    rateLimitRemaining: body.resources?.core?.remaining ?? null,
  };
}

async function searchIssues(query: string, page: number, token?: string): Promise<SearchResponse> {
  await throttleGitHubSearch();
  return fetchGitHub<SearchResponse>(`/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`, token);
}

async function searchAcrossPages(query: string, maxPages = SEARCH_PAGE_LIMIT, token?: string) {
  const allItems: SearchItem[] = [];
  let totalCount = 0;
  let incompleteResults = false;
  const pagesToFetch = Math.min(maxPages, SEARCH_API_MAX_PAGES);

  for (let page = 1; page <= pagesToFetch; page += 1) {
    const response = await searchIssues(query, page, token);
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
    capped: maxPages > pagesToFetch || totalCount > allItems.length,
  };
}

async function fetchPullRequestDetails(pullRequestUrl: string, token?: string): Promise<PullRequestDetail> {
  const url = new URL(pullRequestUrl);
  return fetchGitHub<PullRequestDetail>(url.pathname, token);
}

async function fetchPullRequestReviews(owner: string, repo: string, number: number, token?: string): Promise<PullRequestReview[]> {
  return fetchGitHub<PullRequestReview[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`, token);
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
        uniqueReviewedPrs: 0,
        reviewSelfAuthored: 0,
        reviewTeamAuthored: 0,
        reviewExternalAuthored: 0,
        repositoriesTouched: 0,
        activityScore: 0,
      },
    ]),
  );
}

function asActivityItem(
  item: SearchItem,
  contributor: string,
  type: ActivityItem["type"],
  statusLabel: string,
  metrics = emptyMetrics(),
): ActivityItem {
  return {
    id: `${type}-${item.id}-${contributor}`,
    type,
    title: item.title,
    url: item.html_url,
    repo: repoFullNameFromSearchItem(item),
    contributor,
    author: item.user.login,
    state: item.state,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    ageDays: differenceInCalendarDays(new Date(), parseISO(item.created_at)),
    statusLabel,
    metrics,
  };
}

export async function collectLiveDashboard(roster: RosterMember[], range: RangeOption, token: string): Promise<DashboardData> {
  const rosterLogins = new Set(roster.map((member) => member.login.toLowerCase()));
  const contributorMap = createContributorMap(roster);
  const repoMap = new Map<string, RepoAccumulator>();
  const warnings: DashboardWarning[] = [];
  const reviewOutcomes: ReviewOutcomeBreakdown = {
    approved: 0,
    changesRequested: 0,
    commented: 0,
  };
  const reviewSources: ReviewSourceBreakdown = {
    selfAuthored: 0,
    teamAuthored: 0,
    externalAuthored: 0,
  };
  const activityItems: ActivityItem[] = [];
  const firstReviewHours: number[] = [];
  const mergeHours: number[] = [];
  let searchSamples = 0;
  let detailSamples = 0;

  const staleCutoff = parseISO(range.to).getTime() - 7 * 86400000;

  const [openIssuesResult, openPrsResult, mergedPrsResult, closedPrsResult] = await Promise.all([
    searchAcrossPages(`org:${ORG} is:issue is:open archived:false sort:updated-desc`, SEARCH_PAGE_LIMIT, token),
    searchAcrossPages(`org:${ORG} is:pr is:open archived:false sort:updated-desc`, Math.max(2, SEARCH_PAGE_LIMIT - 1), token),
    searchAcrossPages(`org:${ORG} is:pr merged:${range.from.slice(0, 10)}..${range.to.slice(0, 10)} archived:false sort:updated-desc`, 3, token),
    searchAcrossPages(`org:${ORG} is:pr is:closed closed:${range.from.slice(0, 10)}..${range.to.slice(0, 10)} -is:merged archived:false sort:updated-desc`, 2, token),
  ]);

  searchSamples +=
    openIssuesResult.items.length + openPrsResult.items.length + mergedPrsResult.items.length + closedPrsResult.items.length;

  if (openIssuesResult.incompleteResults || openPrsResult.incompleteResults || mergedPrsResult.incompleteResults || closedPrsResult.incompleteResults) {
    warnings.push({ level: "warn", message: "GitHub Search returned incomplete results for one or more queries. Totals may be partial." });
  }

  if (openIssuesResult.capped || openPrsResult.capped || mergedPrsResult.capped || closedPrsResult.capped) {
    warnings.push({
      level: "warn",
      message:
        "Collection hit the GitHub Search cap (max 1000 results per query) or SEARCH_PAGE_LIMIT. Narrow the query scope for fuller coverage.",
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

    activityItems.push(
      asActivityItem(item, contributor.login, "issue", Date.parse(item.updated_at) < staleCutoff ? "Stale issue" : "Assigned", {
        ...emptyMetrics(),
        openAssignedIssues: 1,
        staleItems: Date.parse(item.updated_at) < staleCutoff ? 1 : 0,
      }),
    );
  }

  const allPrItems = [...openPrsResult.items, ...mergedPrsResult.items, ...closedPrsResult.items];

  const allTeamPrItems = allPrItems.filter((item) =>
    rosterLogins.has(item.user.login.toLowerCase()),
  );

  const uniquePrs = Array.from(new Map(allTeamPrItems.map((item) => [item.pull_request?.url ?? item.html_url, item])).values()).slice(0, PR_DETAIL_LIMIT);
  const reviewDetailTargets = Array.from(new Map(allPrItems.map((item) => [item.pull_request?.url ?? item.html_url, item])).values()).slice(0, REVIEW_DETAIL_LIMIT);

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

    const isMerged = mergedPrsResult.items.some((candidate) => candidate.id === item.id);
    activityItems.push(
      asActivityItem(
        item,
        contributor.login,
        "pull_request",
        item.state === "open" ? "Open PR" : isMerged ? "Merged" : "Closed",
        {
          ...emptyMetrics(),
          openAuthoredPrs: item.state === "open" ? 1 : 0,
          mergedPrs: isMerged ? 1 : 0,
          closedUnmergedPrs: item.closed_at && !isMerged ? 1 : 0,
          staleItems: item.state === "open" && Date.parse(item.updated_at) < staleCutoff ? 1 : 0,
        },
      ),
    );
  }

  const detailTargets = reviewDetailTargets.filter((item) => item.pull_request?.url).slice(0, REVIEW_DETAIL_LIMIT);

  const detailResults = await Promise.all(
    detailTargets.map((item) =>
      limit(async () => {
        const detail = await fetchPullRequestDetails(item.pull_request!.url, token);
        const repoFullName = detail.base.repo?.full_name ?? detail.head.repo?.full_name;
        if (!repoFullName) {
          return null;
        }
        const [owner, repo] = repoFullName.split("/");
        const reviews = await fetchPullRequestReviews(owner, repo, detail.number, token);
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
    const authorContributor = contributorMap.get(item.user.login.toLowerCase());

    if (authorContributor && detail.draft) {
      authorContributor.draftPrs += 1;
      const prItem = activityItems.find((activityItem) => activityItem.type === "pull_request" && activityItem.url === item.html_url);
      if (prItem) {
        prItem.metrics.draftPrs += 1;
        prItem.statusLabel = "Draft PR";
      }
    }

    if (authorContributor) {
      const matchingRequests = detail.requested_reviewers.filter((reviewer) => rosterLogins.has(reviewer.login.toLowerCase()));
      for (const reviewer of matchingRequests) {
        const reviewerMetrics = contributorMap.get(reviewer.login.toLowerCase());
        if (reviewerMetrics) {
          reviewerMetrics.pendingReviewRequests += 1;
          activityItems.push({
            id: `review-request-${detail.id}-${reviewer.login}`,
            type: "review_request",
            title: `Review requested from ${reviewerMetrics.name}`,
            url: item.html_url,
            repo: repoFullName,
            contributor: reviewerMetrics.login,
            author: detail.user.login,
            state: "open",
            createdAt: detail.created_at,
            updatedAt: detail.updated_at,
            ageDays: differenceInCalendarDays(new Date(), parseISO(detail.updated_at)),
            statusLabel: "Pending review request",
            metrics: {
              ...emptyMetrics(),
              pendingReviewRequests: 1,
            },
          });
        }
      }
    }

    const repoEntry = repoMap.get(repoFullName) ?? { issues: 0, prs: 0, reviews: 0, contributors: new Set<string>() };
    if (authorContributor) {
      repoEntry.contributors.add(authorContributor.login);
    }

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

    if (authorContributor && detail.merged_at) {
      mergeHours.push(Math.abs(differenceInHours(parseISO(detail.merged_at), parseISO(detail.created_at))));
    }

    for (const review of rangedTeamReviews) {
      const reviewer = review.user?.login ? contributorMap.get(review.user.login.toLowerCase()) : null;
      if (!reviewer || !review.submitted_at) {
        continue;
      }

      const reviewAuthorLogin = detail.user.login;
      const reviewedPrKind =
        reviewAuthorLogin.toLowerCase() === reviewer.login.toLowerCase()
          ? "authored-by-self"
          : rosterLogins.has(reviewAuthorLogin.toLowerCase())
            ? "authored-by-them"
            : "authored-external";

      reviewer.reviewsSubmitted += 1;
      if (reviewedPrKind === "authored-by-self") {
        reviewer.reviewSelfAuthored += 1;
      } else if (reviewedPrKind === "authored-by-them") {
        reviewer.reviewTeamAuthored += 1;
      } else {
        reviewer.reviewExternalAuthored += 1;
      }
      repoEntry.reviews += 1;
      repoEntry.contributors.add(reviewer.login);
      activityItems.push({
        id: `review-${review.id}`,
        type: "review",
        title: `${item.title} review by ${reviewer.name}`,
        url: item.html_url,
        repo: repoFullName,
        contributor: reviewer.login,
        author: reviewAuthorLogin,
        state: review.state.toLowerCase(),
        createdAt: detail.created_at,
        updatedAt: review.submitted_at,
        ageDays: differenceInCalendarDays(new Date(), parseISO(review.submitted_at)),
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
          reviewApproved: review.state.toUpperCase() === "APPROVED" ? 1 : 0,
          reviewChangesRequested: review.state.toUpperCase() === "CHANGES_REQUESTED" ? 1 : 0,
          reviewCommented: review.state.toUpperCase() === "APPROVED" || review.state.toUpperCase() === "CHANGES_REQUESTED" ? 0 : 1,
          reviewSelfAuthored: reviewedPrKind === "authored-by-self" ? 1 : 0,
          reviewTeamAuthored: reviewedPrKind === "authored-by-them" ? 1 : 0,
          reviewExternalAuthored: reviewedPrKind === "authored-external" ? 1 : 0,
        },
      });

      const state = review.state.toUpperCase();
      if (state === "APPROVED") {
        reviewOutcomes.approved += 1;
      } else if (state === "CHANGES_REQUESTED") {
        reviewOutcomes.changesRequested += 1;
      } else {
        reviewOutcomes.commented += 1;
      }

      if (reviewedPrKind === "authored-by-self") {
        reviewSources.selfAuthored += 1;
      } else if (reviewedPrKind === "authored-by-them") {
        reviewSources.teamAuthored += 1;
      } else {
        reviewSources.externalAuthored += 1;
      }
    }

    repoMap.set(repoFullName, repoEntry);
  }

  const contributors = Array.from(contributorMap.values())
    .map((contributor) => {
      const contributorReviewItems = activityItems.filter((item) => item.type === "review" && item.contributor === contributor.login);
      contributor.repositoriesTouched = Array.from(repoMap.values()).filter((repo) => repo.contributors.has(contributor.login)).length;
      contributor.uniqueReviewedPrs = new Set(contributorReviewItems.map((item) => item.url)).size;
      contributor.activityScore = calculateActivityScore({
        openAssignedIssues: contributor.openAssignedIssues,
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
    rosterMembers: roster,
    warnings,
    summary: {
      openAssignedIssues: contributors.reduce((total, contributor) => total + contributor.openAssignedIssues, 0),
      openAuthoredPrs: contributors.reduce((total, contributor) => total + contributor.openAuthoredPrs, 0),
      mergedPrs: contributors.reduce((total, contributor) => total + contributor.mergedPrs, 0),
      reviewsSubmitted: contributors.reduce((total, contributor) => total + contributor.reviewsSubmitted, 0),
      pendingReviewRequests: contributors.reduce((total, contributor) => total + contributor.pendingReviewRequests, 0),
      uniqueReviewedPrs: new Set(activityItems.filter((item) => item.type === "review").map((item) => item.url)).size,
      staleItems: contributors.reduce((total, contributor) => total + contributor.staleItems, 0),
      repositoriesTouched: repoActivity.length,
      medianFirstReviewHours: median(firstReviewHours),
      medianMergeHours: median(mergeHours),
    },
    reviewOutcomes,
    reviewSources,
    contributors,
    repoActivity,
    activityItems: activityItems.sort((left, right) => (left.updatedAt > right.updatedAt ? -1 : 1)),
    syncHealth: {
      source: "live",
      generatedAt,
      freshnessMinutes,
      searchSamples,
      detailSamples,
      liveEnabled: true,
    },
    filterOptions: {
      contributors: roster.map((member) => ({ login: member.login, name: member.name })),
      repos: Array.from(new Set(repoActivity.map((repo) => repo.name))).sort(),
    },
    auth: {
      hasToken: true,
      connectionStatus: "valid",
      message: "Connected to GitHub.",
      checkedAt: generatedAt,
    },
  };
}
