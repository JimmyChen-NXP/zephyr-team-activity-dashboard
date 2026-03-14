/**
 * Types for incremental daily activity files stored on the data branch.
 *
 * Each file covers one UTC calendar day and stores the raw GitHub activity
 * records collected for that day. The aggregate-daily script reads these files
 * to compute rolling-window DashboardData snapshots.
 */

export type DailyIssueRecord = {
  type: "issue";
  id: number;
  number: number;
  repo: string; // "org/name"
  title: string;
  url: string;
  author: string;
  assignees: string[];
  state: "open" | "closed";
  createdAt: string; // ISO
  updatedAt: string; // ISO
  closedAt: string | null;
};

export type DailyPrRecord = {
  type: "pr";
  id: number;
  number: number;
  repo: string;
  title: string;
  url: string;
  author: string;
  state: "open" | "closed";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  /** GitHub assignees for this PR. Optional for backward compat with legacy daily files. */
  assignees?: string[];
  requestedReviewers: string[];
  /** CI status from check-runs API. Only set for open PRs in open-items.json; undefined in legacy daily files. */
  ciStatus?: "success" | "failure" | "pending" | null;
};

/** Open-items-only extension of DailyPrRecord with ciStatus always present. */
export type OpenPrRecord = DailyPrRecord & {
  ciStatus: "success" | "failure" | "pending" | null;
};

export type DailyReviewRecord = {
  type: "review";
  reviewId: number;
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prAuthor: string;
  reviewer: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  submittedAt: string;
  prIsDraft: boolean;
  prMergedAt: string | null;
};

export type DailyRecord = DailyIssueRecord | DailyPrRecord | DailyReviewRecord;

export type DailyFile = {
  /** UTC calendar date this file covers, "YYYY-MM-DD" */
  date: string;
  /** ISO timestamp of when this file was collected */
  collectedAt: string;
  /** Repos covered by this file */
  repos: string[];
  records: DailyRecord[];
};

/**
 * Single overwritable snapshot of all currently open issues and open/draft PRs.
 * Written by collect-open-items.ts; merged into the record pool in aggregate-daily.ts.
 */
export type OpenItemsFile = {
  /** ISO timestamp of when this file was collected */
  collectedAt: string;
  /** Repos covered by this file */
  repos: string[];
  /** All currently open issues and open/draft PRs */
  records: Array<DailyIssueRecord | OpenPrRecord>;
};
