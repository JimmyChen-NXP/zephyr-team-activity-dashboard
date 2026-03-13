---
title: Incremental Daily Accumulation Architecture
date: 2026-03-13
status: ready-for-planning
---

# Incremental Daily Accumulation Architecture

## What We're Building

Replace the current "collect everything, overwrite snapshot" CI pattern with an incremental architecture that:

1. Collects only 1-2 fully-completed past days per CI run
2. Appends raw daily event files to the `data` branch (never force-overwrites history)
3. After each daily push, runs a CI aggregation step that re-computes 7d/30d/90d snapshot JSON files from the accumulated daily files
4. The `publish-pages.yml` workflow reads those pre-computed snapshots — no change to page rendering

This fundamentally eliminates rate limit concerns: a single day's activity across 4 repos produces a tiny result set (tens to low hundreds of items), far below any API quota threshold.

## Why This Approach

The current architecture queries a 7d/30d/90d rolling window every run. With 4 repos and SEARCH_PAGE_LIMIT=5, this can generate hundreds of API calls. Rate limits (30 search requests/min, 5000 core requests/hr) become a real constraint.

By narrowing each run to 1-2 completed days, the query volume per run is ~10x smaller. The full historical window is reconstructed from accumulated daily files rather than re-fetched from GitHub every time.

## Key Decisions

### Q1: How does the dashboard assemble views?
**Option C chosen — CI aggregation step.**

After the daily event files are pushed to the `data` branch, a CI step runs a script that reads all daily event files within each window (7d, 30d, 90d) and writes out pre-computed snapshot JSON files. These snapshot files are committed to the `data` branch alongside the daily files. The `publish-pages.yml` workflow reads the snapshot files exactly as it does today — no change required in the Next.js app or page rendering.

Rationale: Static GitHub Pages requires pre-computed data. A client-side aggregation step (Option B) is incompatible with static export. Server-side on-the-fly aggregation (Option A) requires a runtime API route, which is removed during static build. Option C is the only viable path.

### Q2: Only fully-completed days
If the CI run occurs on day D, collect data for day D-1 only (and optionally D-2 as a catch-up window in case the previous run was skipped or failed). Never collect partial data for day D.

Implementation: The collection script checks `new Date()` (UTC), sets `targetDate = D-1`, builds a date range of `targetDate..targetDate` (a single UTC day), and queries GitHub for all events in that day.

### Q3: Data format for daily files
**Structured activity events (Option C).**

Each daily file is a JSON array of event records, one per PR/issue/review activity:

```json
[
  {
    "login": "alice",
    "type": "review",
    "repo": "zephyrproject-rtos/zephyr",
    "prNumber": 12345,
    "date": "2026-03-12",
    "state": "APPROVED",
    "isDraft": false
  },
  {
    "login": "bob",
    "type": "pr_merged",
    "repo": "zephyrproject-rtos/west",
    "prNumber": 678,
    "date": "2026-03-12",
    "isDraft": false
  },
  {
    "login": "carol",
    "type": "issue_closed",
    "repo": "zephyrproject-rtos/hal_nxp",
    "issueNumber": 90,
    "date": "2026-03-12"
  }
]
```

Event types: `review`, `pr_merged`, `pr_opened`, `pr_closed`, `issue_closed`, `issue_opened`.

Rationale: Structured events are easy to filter by login (for roster matching) and aggregate by date window. They are more compact than raw GitHub API responses and don't require re-parsing.

### Q4: File naming and layout on data branch

Daily files: `public/daily/YYYY-MM-DD.json`
Aggregated snapshots (existing format, unchanged): `public/snapshots/<preset>/<login>.json` or the existing snapshot shape

This keeps backward compatibility — `publish-pages.yml` continues reading from `public/snapshots/`.

### Q5: Catch-up window
Each run collects D-1 and D-2. If D-2's file already exists in the `data` branch, skip it (idempotent). This handles:
- CI run skipped one day (weekend, outage)
- Partial run that failed before committing

## Architecture Flow

```
[GitHub Actions: collect-data.yml, daily at 05:13 UTC]
  1. Checkout main branch (for scripts)
  2. Checkout data branch into _data/
  3. Determine target days: D-1 (and D-2 if missing)
  4. For each target day:
     a. Run GitHub search for that day's range across GITHUB_REPOS
     b. Fetch PR details for review data (small set — 1 day of activity)
     c. Write raw events to _data/public/daily/YYYY-MM-DD.json
  5. Run aggregation script:
     a. Read all daily files within [today-90d .. today-1]
     b. Compute 7d, 30d, 90d summaries per roster member
     c. Write snapshot JSON to _data/public/snapshots/
  6. Commit and push _data/ to data branch (NOT force-push — append-only)

[GitHub Actions: publish-pages.yml]
  Triggered after collect-data.yml succeeds
  Reads public/snapshots/ from data branch (unchanged behavior)
  Builds and deploys static site
```

## Open Questions

_All resolved during brainstorm._

## Constraints

- GitHub Pages requires fully static output — no runtime aggregation
- `data` branch must be append-only (no force-push) to preserve history
- Collection must be idempotent: re-running for a day that already has a file is a no-op
- Daily CI run at 05:13 UTC means D-1 = the full prior UTC day

## Success Criteria

- Zero rate limit errors in CI (search quota: 30/min; a single-day query across 4 repos uses ~10 search requests)
- No review activity gaps (all reviews for roster members in collected days are captured)
- Historical window grows automatically as daily files accumulate
- Existing `publish-pages.yml` workflow requires no changes
- Dashboard shows accurate 7d/30d/90d windows assembled from daily files

## Out of Scope

- Backfilling historical data (pre-launch days) — can be done manually if needed
- Per-user granular daily breakdowns in the UI (future feature)
- Changing the roster CSV format
