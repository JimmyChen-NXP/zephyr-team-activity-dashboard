/**
 * Local diagnostics script: runs search queries for one preset and reports
 * result counts, cap warnings, and search API rate limit consumption.
 *
 * Usage:
 *   npm run check-queries
 *   SEARCH_PAGE_LIMIT=3 npm run check-queries   # check with more pages
 *
 * Reads GITHUB_TOKEN from .env.local (same as dev server) or the env var.
 * Never writes snapshot files — read-only.
 */

async function checkSearchRateLimit(token: string) {
  const resp = await fetch("https://api.github.com/rate_limit", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    resources?: { search?: { remaining?: number; limit?: number; reset?: number } };
  };
  return data.resources?.search ?? null;
}

async function main() {
  // Set env vars BEFORE dynamic-importing github.ts — its module-level constants
  // (SEARCH_PAGE_LIMIT, GITHUB_REPOS, GITHUB_SEARCH_MIN_INTERVAL_MS) are evaluated at first import.
  process.env.SEARCH_PAGE_LIMIT ??= "1";
  process.env.GITHUB_SEARCH_MIN_INTERVAL_MS ??= "0"; // no throttle needed for ~20 queries
  process.env.REVIEW_DETAIL_LIMIT ??= "20";  // fetch details for 20 PRs only (vs 120 default)
  process.env.PR_DETAIL_LIMIT ??= "10";      // fetch merge/draft status for 10 PRs only
  // Default to the 4 key repos so the script works locally without any extra env setup.
  // Override by setting GITHUB_REPOS in your shell or .env.local.
  process.env.GITHUB_REPOS ??= "zephyrproject-rtos/zephyr,zephyrproject-rtos/west,zephyrproject-rtos/hal_nxp,zephyrproject-rtos/hostap";

  const { collectLiveDashboard } = await import("@/lib/github");
  const { resolveRange } = await import("@/lib/range");
  const { loadRoster } = await import("@/lib/roster");
  const { getGitHubEnvToken } = await import("@/lib/github-auth");

  const token = getGitHubEnvToken();
  if (!token) {
    console.error("[check-queries] No GITHUB_TOKEN found. Set it in .env.local or the GITHUB_TOKEN env var.");
    process.exitCode = 1;
    return;
  }

  const preset = "7d";
  const repoScope = process.env.GITHUB_REPOS ?? `org:${process.env.GITHUB_ORG ?? "zephyrproject-rtos"} (no GITHUB_REPOS set)`;
  console.log(`[check-queries] preset=${preset}  SEARCH_PAGE_LIMIT=${process.env.SEARCH_PAGE_LIMIT}  scope=${repoScope}\n`);

  const before = await checkSearchRateLimit(token);
  if (before) {
    const resetAt = new Date((before.reset ?? 0) * 1000).toISOString();
    console.log(`Search rate limit before: ${before.remaining}/${before.limit}  resets=${resetAt}\n`);
  }

  const roster = await loadRoster();
  const range = resolveRange(preset);

  try {
    const data = await collectLiveDashboard(roster, range, token);
    const { summary, warnings, syncHealth } = data;

    console.log("Results:");
    console.log(`  Open assigned issues : ${summary.openAssignedIssues}`);
    console.log(`  Closed issues        : ${summary.closedIssues}`);
    console.log(`  Open authored PRs    : ${summary.openAuthoredPrs}`);
    console.log(`  Merged PRs           : ${summary.mergedPrs}`);
    console.log(`  Reviews submitted    : ${summary.reviewsSubmitted}`);
    console.log(`  Search items fetched : ${syncHealth.searchSamples}`);

    if (warnings.length > 0) {
      console.log("\nWarnings:");
      for (const w of warnings) {
        console.log(`  [${w.level}] ${w.message}`);
      }
    } else {
      console.log("\nNo warnings.");
    }

    const after = await checkSearchRateLimit(token);
    if (after && before) {
      const used = (before.remaining ?? 0) - (after.remaining ?? 0);
      console.log(`\nSearch rate limit after: ${after.remaining}/${after.limit}  (used ${used} requests this run)`);
    }

    const hasCap = warnings.some((w) => w.message.includes("cap") || w.message.includes("SEARCH_PAGE_LIMIT"));
    const hasIncomplete = warnings.some((w) => w.message.includes("incomplete"));

    if (hasCap) {
      // Expected when running with SEARCH_PAGE_LIMIT=1. CI uses SEARCH_PAGE_LIMIT=5 (500 results max).
      // Only a concern if total items fetched approaches 500 per query.
      console.log("\n[check-queries] NOTE: Cap warning is expected with SEARCH_PAGE_LIMIT=1 (check mode). Queries are working correctly.");
    }
    if (hasIncomplete) {
      console.log("\n[check-queries] WARN: GitHub returned incomplete results for one or more queries. This may indicate a real data gap.");
      process.exitCode = 1;
    } else {
      console.log("\n[check-queries] OK — queries succeeded, no HTTP errors.");
    }
  } catch (error) {
    console.error("\n[check-queries] FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
