/**
 * Incremental daily collection script.
 *
 * Collects raw GitHub activity for 1-2 fully-completed past UTC days and
 * writes structured daily event files to DAILY_OUT_DIR/daily/YYYY-MM-DD.json.
 *
 * - Collects D-1 (yesterday) and D-2 (catch-up) if D-2's file is missing.
 * - Idempotent: skips dates that already have a file.
 * - Only collects fully-completed UTC days (never the current day D).
 *
 * Override mode (backfill):
 *   DAILY_OVERRIDE_DATES=2026-03-01,2026-03-02,...  collect specific dates
 *
 * Usage:
 *   npm run collect-daily
 *   DAILY_OUT_DIR=_data/public npm run collect-daily
 *   DAILY_OVERRIDE_DATES=2026-03-01,2026-03-05 npm run collect-daily
 *
 * Reads GITHUB_TOKEN from .env.local or the GITHUB_TOKEN env var.
 * Set SEARCH_PAGE_LIMIT (default 2) and GITHUB_SEARCH_MIN_INTERVAL_MS before
 * running — these are read at module load time by github.ts.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

import pLimit from "p-limit";

import { getGitHubEnvToken } from "@/lib/github-auth";
import {
  fetchPullRequestDetails,
  fetchPullRequestReviews,
  repoFullNameFromSearchItem,
  searchAcrossQueries,
} from "@/lib/github";
import type { DailyFile, DailyIssueRecord, DailyPrRecord, DailyReviewRecord } from "@/lib/daily-types";

// Read at module load time — set process.env BEFORE running this script.
const GITHUB_REPOS = process.env.GITHUB_REPOS
  ? process.env.GITHUB_REPOS.split(",").map((r) => r.trim()).filter(Boolean)
  : [];

const DAILY_DETAIL_LIMIT = Number(process.env.DAILY_DETAIL_LIMIT ?? 300);
const detailLimit = pLimit(4);

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getTargetDates(outDir: string): Array<{ date: string; filePath: string }> {
  // Override mode: collect exactly the specified dates (used by backfill workflow).
  const override = process.env.DAILY_OVERRIDE_DATES;
  if (override) {
    const dates = override.split(",").map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (dates.length === 0) {
      throw new Error("[collect-daily] DAILY_OVERRIDE_DATES is set but contains no valid YYYY-MM-DD dates.");
    }
    return dates.map((date) => ({ date, filePath: path.join(outDir, "daily", `${date}.json`) }));
  }

  // Normal mode: yesterday (D-1) and the day before (D-2) as a 1-day catch-up.
  const now = new Date();

  const d1 = new Date(now);
  d1.setUTCDate(d1.getUTCDate() - 1);

  const d2 = new Date(now);
  d2.setUTCDate(d2.getUTCDate() - 2);

  const d1Str = utcDateString(d1);
  const d2Str = utcDateString(d2);

  return [
    { date: d2Str, filePath: path.join(outDir, "daily", `${d2Str}.json`) },
    { date: d1Str, filePath: path.join(outDir, "daily", `${d1Str}.json`) },
  ];
}

async function collectDay(date: string, token: string): Promise<DailyFile["records"]> {
  if (GITHUB_REPOS.length === 0) {
    throw new Error("[collect-daily] GITHUB_REPOS must be set. No repos configured.");
  }

  // Single UTC day range — use date-only format (YYYY-MM-DD) which GitHub
  // Search qualifiers document. Full ISO timestamps with T/Z can cause 422.
  const from = date;
  const to = date;

  const repoScope = (base: string) => GITHUB_REPOS.map((repo) => `repo:${repo} ${base}`);

  // Closed issues and updated PRs only — date-scoped to this specific day.
  // Open issues and open PRs are now collected separately by collect-open-items.ts.
  const [closedIssuesResult, updatedPrsResult] = await Promise.all([
    searchAcrossQueries(repoScope(`is:issue is:closed archived:false sort:updated-desc closed:${from}..${to}`), token),
    searchAcrossQueries(repoScope(`is:pr archived:false sort:updated-desc updated:${from}..${to}`), token),
  ]);

  const records: DailyFile["records"] = [];

  // --- Issues ---
  for (const item of closedIssuesResult.items) {
    const record: DailyIssueRecord = {
      type: "issue",
      id: item.id,
      number: item.number,
      repo: repoFullNameFromSearchItem(item),
      title: item.title,
      url: item.html_url,
      author: item.user.login,
      assignees: (item.assignees ?? []).map((a) => a.login),
      state: "closed",
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      closedAt: item.closed_at,
      labels: (item.labels ?? []).map((l: { name: string }) => l.name),
    };
    records.push(record);
  }

  // --- PRs: fetch full details + reviews for PRs active on this date ---
  const prUrlSeen = new Set<string>();
  const detailTargets = updatedPrsResult.items
    .filter((item) => {
      if (!item.pull_request?.url || prUrlSeen.has(item.html_url)) return false;
      prUrlSeen.add(item.html_url);
      return true;
    })
    .slice(0, DAILY_DETAIL_LIMIT);

  console.log(
    `[collect-daily] ${date}: ${closedIssuesResult.items.length} closed issues, ` +
    `${detailTargets.length} PRs to fetch`,
  );

  const detailResults = await Promise.all(
    detailTargets.map((item) =>
      detailLimit(async () => {
        try {
          const detail = await fetchPullRequestDetails(item.pull_request!.url, token);
          const repoFullName = detail.base.repo?.full_name ?? detail.head.repo?.full_name;
          if (!repoFullName) return null;
          const [owner, repo] = repoFullName.split("/");
          const reviews = await fetchPullRequestReviews(owner, repo, detail.number, token);
          return { item, detail, reviews, repoFullName };
        } catch (error) {
          console.warn(
            `[collect-daily] Failed to fetch PR detail ${item.html_url}: ` +
            `${error instanceof Error ? error.message : error}`,
          );
          return null;
        }
      }),
    ),
  );

  for (const result of detailResults) {
    if (!result) continue;
    const { detail, reviews, repoFullName } = result;

    const prRecord: DailyPrRecord = {
      type: "pr",
      id: detail.id,
      number: detail.number,
      repo: repoFullName,
      title: result.item.title,
      url: detail.html_url,
      author: detail.user.login,
      state: detail.state === "closed" ? "closed" : "open",
      isDraft: detail.draft,
      createdAt: detail.created_at,
      updatedAt: detail.updated_at,
      mergedAt: detail.merged_at,
      assignees: detail.assignees.map((a) => a.login),
      requestedReviewers: detail.requested_reviewers.map((r) => r.login),
      labels: (result.item.labels ?? []).map((l: { name: string }) => l.name),
    };
    records.push(prRecord);

    for (const review of reviews) {
      if (!review.user?.login || !review.submitted_at) continue;

      const upperState = review.state.toUpperCase();
      const reviewState: DailyReviewRecord["state"] =
        upperState === "APPROVED" ? "APPROVED"
        : upperState === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED"
        : "COMMENTED";

      const reviewRecord: DailyReviewRecord = {
        type: "review",
        reviewId: review.id,
        repo: repoFullName,
        prNumber: detail.number,
        prTitle: result.item.title,
        prUrl: detail.html_url,
        prAuthor: detail.user.login,
        reviewer: review.user.login,
        state: reviewState,
        submittedAt: review.submitted_at,
        prIsDraft: detail.draft,
        prMergedAt: detail.merged_at,
      };
      records.push(reviewRecord);
    }
  }

  return records;
}

async function main() {
  const outDir = process.env.DAILY_OUT_DIR ?? path.join(process.cwd(), "public");

  const token = getGitHubEnvToken();
  if (!token) {
    console.error("[collect-daily] No GITHUB_TOKEN found. Set it in .env.local or GITHUB_TOKEN env var.");
    process.exitCode = 1;
    return;
  }

  const targets = getTargetDates(outDir);

  for (const { date, filePath } of targets) {
    if (await fileExists(filePath)) {
      console.log(`[collect-daily] ${date}: already collected, skipping`);
      continue;
    }

    console.log(`[collect-daily] Collecting ${date}...`);
    const records = await collectDay(date, token);

    const daily: DailyFile = {
      date,
      collectedAt: new Date().toISOString(),
      repos: GITHUB_REPOS,
      records,
    };

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(daily, null, 2), "utf8");
    console.log(`[collect-daily] ${date}: wrote ${records.length} records to ${filePath}`);
  }

  console.log("[collect-daily] Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
