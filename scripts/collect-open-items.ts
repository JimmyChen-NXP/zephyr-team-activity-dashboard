/**
 * Open items collection script.
 *
 * Collects all currently open issues and open/draft PRs for all configured repos
 * and writes a single overwritable open-items.json to OPEN_ITEMS_OUT_DIR.
 *
 * Unlike collect-daily.ts, this file has no date scope — it captures current state.
 * Re-running it always overwrites the previous snapshot.
 *
 * Uses the REST list endpoints (/repos/{owner}/{repo}/issues and /pulls) instead of
 * the Search API, so there is no 1000-result cap. The REST endpoints use the core
 * rate limit (5000 req/hr) rather than the search limit (30 req/min).
 *
 * Usage:
 *   npm run collect-open-items
 *   OPEN_ITEMS_OUT_DIR=_data/public npm run collect-open-items
 *
 * Reads GITHUB_TOKEN from .env.local or the GITHUB_TOKEN env var.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import pLimit from "p-limit";

import { getGitHubEnvToken } from "@/lib/github-auth";
import {
  fetchCommitCIStatus,
  listOpenIssuesForRepo,
  listOpenPullRequestsForRepo,
} from "@/lib/github";
import type { DailyIssueRecord, OpenItemsFile, OpenPrRecord } from "@/lib/daily-types";

const GITHUB_REPOS = process.env.GITHUB_REPOS
  ? process.env.GITHUB_REPOS.split(",").map((r) => r.trim()).filter(Boolean)
  : [];

const DAILY_DETAIL_LIMIT = Number(process.env.DAILY_DETAIL_LIMIT ?? 300);
const OPEN_ITEMS_PR_STALE_DAYS = Number(process.env.OPEN_ITEMS_PR_STALE_DAYS ?? 90);
const repoLimit = pLimit(4);
const ciLimit = pLimit(4);

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

  console.log(`[collect-open-items] Fetching open issues and PRs across ${GITHUB_REPOS.length} repo(s) via REST...`);

  // Fetch issues and PRs for all repos concurrently (capped at 4 parallel repo fetches)
  const [issuesByRepo, prsByRepo] = await Promise.all([
    Promise.all(
      GITHUB_REPOS.map((repo) => repoLimit(() => listOpenIssuesForRepo(repo, token).then((items) => ({ repo, items })))),
    ),
    Promise.all(
      GITHUB_REPOS.map((repo) => repoLimit(() => listOpenPullRequestsForRepo(repo, token).then((items) => ({ repo, items })))),
    ),
  ]);

  const records: Array<DailyIssueRecord | OpenPrRecord> = [];

  // --- Open Issues ---
  for (const { repo, items } of issuesByRepo) {
    for (const item of items) {
      const record: DailyIssueRecord = {
        type: "issue",
        id: item.id,
        number: item.number,
        repo,
        title: item.title,
        url: item.html_url,
        author: item.user.login,
        assignees: (item.assignees ?? []).map((a) => a.login),
        state: "open",
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        closedAt: item.closed_at,
        labels: (item.labels ?? []).map((l: { name: string }) => l.name),
      };
      records.push(record);
    }
  }

  const totalIssues = issuesByRepo.reduce((n, { items }) => n + items.length, 0);
  const staleCutoff = new Date(Date.now() - OPEN_ITEMS_PR_STALE_DAYS * 24 * 60 * 60 * 1000);
  const allPrs = prsByRepo
    .flatMap(({ repo, items }) => items.map((detail) => ({ repo, detail })))
    .filter(({ detail }) => new Date(detail.updated_at) >= staleCutoff);

  const stalePrCount = prsByRepo.reduce((n, { items }) => n + items.length, 0) - allPrs.length;
  console.log(
    `[collect-open-items] ${totalIssues} open issues, ${allPrs.length} open PRs` +
    (stalePrCount > 0 ? ` (${stalePrCount} skipped — not updated in ${OPEN_ITEMS_PR_STALE_DAYS} days)` : "") +
    ` — fetching CI status...`,
  );

  // --- Open PRs: REST list already includes full details (draft, reviewers, assignees).
  //     Only CI status requires an extra fetch per PR — limited to DAILY_DETAIL_LIMIT.
  //     PRs beyond the limit are still written to the file, just with ciStatus: null.
  const ciTargets = allPrs.slice(0, DAILY_DETAIL_LIMIT);
  const ciSkipped = allPrs.slice(DAILY_DETAIL_LIMIT);

  if (ciSkipped.length > 0) {
    console.log(
      `[collect-open-items] ${ciSkipped.length} PRs beyond DAILY_DETAIL_LIMIT (${DAILY_DETAIL_LIMIT}) — writing with ciStatus: null`,
    );
  }

  const ciResults = await Promise.all(
    ciTargets.map(({ repo, detail }) =>
      ciLimit(async () => {
        const repoFullName = detail.base.repo?.full_name ?? detail.head.repo?.full_name ?? repo;
        try {
          const ciStatus = await fetchCommitCIStatus(repoFullName, detail.head.sha, token);
          return { detail, repoFullName, ciStatus };
        } catch (error) {
          console.warn(
            `[collect-open-items] Failed to fetch CI status for PR #${detail.number} in ${repoFullName}: ` +
            `${error instanceof Error ? error.message : error}`,
          );
          return { detail, repoFullName, ciStatus: null as "success" | "failure" | "pending" | null };
        }
      }),
    ),
  );

  // Append skipped PRs with ciStatus: null so no PR data is lost
  const allPrResults = [
    ...ciResults,
    ...ciSkipped.map(({ repo, detail }) => ({
      detail,
      repoFullName: detail.base.repo?.full_name ?? detail.head.repo?.full_name ?? repo,
      ciStatus: null as "success" | "failure" | "pending" | null,
    })),
  ];

  for (const { detail, repoFullName, ciStatus } of allPrResults) {
    const prRecord: OpenPrRecord = {
      type: "pr",
      id: detail.id,
      number: detail.number,
      repo: repoFullName,
      title: detail.title,
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
      labels: (detail.labels ?? []).map((l) => l.name),
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

  console.log(
    `[collect-open-items] Wrote ${records.length} records ` +
    `(${totalIssues} issues, ${allPrResults.length} PRs) to ${outPath}`,
  );
  console.log("[collect-open-items] Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
