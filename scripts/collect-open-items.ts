/**
 * Open items collection script.
 *
 * Collects all currently open issues and open/draft PRs for all configured repos
 * and writes a single overwritable open-items.json to OPEN_ITEMS_OUT_DIR.
 *
 * Unlike collect-daily.ts, this file has no date scope — it captures current state.
 * Re-running it always overwrites the previous snapshot.
 *
 * Usage:
 *   npm run collect-open-items
 *   OPEN_ITEMS_OUT_DIR=_data/public npm run collect-open-items
 *
 * Reads GITHUB_TOKEN from .env.local or the GITHUB_TOKEN env var.
 * Set OPEN_ITEMS_PAGE_LIMIT (default 10) and GITHUB_SEARCH_MIN_INTERVAL_MS before running.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import pLimit from "p-limit";

import { getGitHubEnvToken } from "@/lib/github-auth";
import {
  fetchCommitCIStatus,
  fetchPullRequestDetails,
  repoFullNameFromSearchItem,
  searchAcrossQueries,
} from "@/lib/github";
import type { DailyIssueRecord, OpenItemsFile, OpenPrRecord } from "@/lib/daily-types";

const GITHUB_REPOS = process.env.GITHUB_REPOS
  ? process.env.GITHUB_REPOS.split(",").map((r) => r.trim()).filter(Boolean)
  : [];

const OPEN_ITEMS_PAGE_LIMIT = Number(process.env.OPEN_ITEMS_PAGE_LIMIT ?? 10);
const DAILY_DETAIL_LIMIT = Number(process.env.DAILY_DETAIL_LIMIT ?? 300);
const detailLimit = pLimit(4);

async function main() {
  const outDir = process.env.OPEN_ITEMS_OUT_DIR ?? path.join(process.cwd(), "public");

  const token = getGitHubEnvToken();
  if (!token) {
    console.error("[collect-open-items] No GITHUB_TOKEN found. Set it in .env.local or GITHUB_TOKEN env var.");
    process.exitCode = 1;
    return;
  }

  if (GITHUB_REPOS.length === 0) {
    throw new Error("[collect-open-items] GITHUB_REPOS must be set. No repos configured.");
  }

  const repoScope = (base: string) => GITHUB_REPOS.map((repo) => `repo:${repo} ${base}`);

  console.log(`[collect-open-items] Fetching open issues and PRs across ${GITHUB_REPOS.length} repo(s)...`);

  const [openIssuesResult, openPrsResult] = await Promise.all([
    searchAcrossQueries(repoScope(`is:issue is:open archived:false sort:updated-desc`), token, OPEN_ITEMS_PAGE_LIMIT),
    searchAcrossQueries(repoScope(`is:pr is:open archived:false sort:updated-desc`), token, OPEN_ITEMS_PAGE_LIMIT),
  ]);

  const records: Array<DailyIssueRecord | OpenPrRecord> = [];

  // --- Open Issues ---
  for (const item of openIssuesResult.items) {
    const record: DailyIssueRecord = {
      type: "issue",
      id: item.id,
      number: item.number,
      repo: repoFullNameFromSearchItem(item),
      title: item.title,
      url: item.html_url,
      author: item.user.login,
      assignees: (item.assignees ?? []).map((a) => a.login),
      state: "open",
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      closedAt: item.closed_at,
    };
    records.push(record);
  }

  console.log(
    `[collect-open-items] ${openIssuesResult.items.length} open issues, ` +
    `${openPrsResult.items.length} open PRs to fetch details for`,
  );

  // --- Open PRs: fetch full details for accurate isDraft, requestedReviewers, etc. ---
  const prUrlSeen = new Set<string>();
  const detailTargets = openPrsResult.items
    .filter((item) => {
      if (!item.pull_request?.url || prUrlSeen.has(item.html_url)) return false;
      prUrlSeen.add(item.html_url);
      return true;
    })
    .slice(0, DAILY_DETAIL_LIMIT);

  const detailResults = await Promise.all(
    detailTargets.map((item) =>
      detailLimit(async () => {
        try {
          const detail = await fetchPullRequestDetails(item.pull_request!.url, token);
          const repoFullName = detail.base.repo?.full_name ?? detail.head.repo?.full_name;
          if (!repoFullName) return null;
          const ciStatus = await fetchCommitCIStatus(repoFullName, detail.head.sha, token);
          return { item, detail, repoFullName, ciStatus };
        } catch (error) {
          console.warn(
            `[collect-open-items] Failed to fetch PR detail ${item.html_url}: ` +
            `${error instanceof Error ? error.message : error}`,
          );
          return null;
        }
      }),
    ),
  );

  for (const result of detailResults) {
    if (!result) continue;
    const { detail, repoFullName, ciStatus } = result;

    const prRecord: OpenPrRecord = {
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
      ciStatus,
    };
    records.push(prRecord);
  }

  const openItemsFile: OpenItemsFile = {
    collectedAt: new Date().toISOString(),
    repos: GITHUB_REPOS,
    records,
  };

  const outPath = path.join(outDir, "open-items.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(openItemsFile, null, 2), "utf8");

  const prCount = detailResults.filter(Boolean).length;
  console.log(
    `[collect-open-items] Wrote ${records.length} records ` +
    `(${openIssuesResult.items.length} issues, ${prCount} PRs) to ${outPath}`,
  );
  console.log("[collect-open-items] Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
