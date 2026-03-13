---
title: "feat: Incremental Daily Accumulation for GitHub Activity Data"
type: feat
status: completed
date: 2026-03-13
origin: docs/brainstorms/2026-03-13-incremental-daily-accumulation-brainstorm.md
---

# feat: Incremental Daily Accumulation for GitHub Activity Data

## Overview

Replace the current "collect everything once per day, overwrite snapshot" CI pattern with an incremental architecture that collects only 1-2 fully-completed past days per run, accumulates raw daily event files on the `data` branch, and re-aggregates rolling-window snapshots after each push.

This eliminates rate limit risk at its root: a single day's activity across 4 repos produces ~10–50 search results total — far below GitHub's 30 req/min search quota.

## Problem Statement

The current `collect-data.yml` workflow calls `npm run snapshots`, which runs `collectLiveDashboard` for three separate presets (7d, 30d, 90d). Each preset fires 5 search queries × 4 repos = 20 search requests, plus up to 500 PR detail fetches using the core REST API. Running all three presets totals 60 search requests per CI run. At SEARCH_PAGE_LIMIT=5 the search quota (30/min) is tight; with GITHUB_SEARCH_MIN_INTERVAL_MS throttling, total runtime can exceed 30 minutes. Any transient rate limit failure discards the entire run.

Additionally, each run force-pushes the `data` branch (orphan + reset), erasing all history. This makes it impossible to audit past snapshots or recover from a bad run.

## Proposed Solution

(see brainstorm: docs/brainstorms/2026-03-13-incremental-daily-accumulation-brainstorm.md)

### Architecture

```
[GitHub Actions: collect-data.yml — daily at 05:13 UTC]
  1. Checkout main branch (scripts + roster)
  2. Checkout data branch → _data/
  3. Run: npm run collect-daily
     → determines D-1 (and D-2 catch-up if missing)
     → queries GitHub for each target date (1-day range per repo)
     → writes _data/public/daily/YYYY-MM-DD.json
     → idempotent: skips dates that already have files
  4. Run: npm run aggregate-daily
     → reads all _data/public/daily/*.json
     → computes DashboardData for 7d, 30d, 90d windows
     → writes _data/public/snapshots/{7d,30d,90d}.json + meta.json
  5. Commit and push to data branch (regular push, NOT force)

[GitHub Actions: publish-pages.yml — unchanged]
  Reads public/snapshots/ from data branch → builds static site
```

### Key Design Decisions

(see brainstorm: docs/brainstorms/2026-03-13-incremental-daily-accumulation-brainstorm.md)

1. **Aggregation location**: CI step after daily push (Option C). `publish-pages.yml` reads pre-computed snapshots unchanged — no runtime aggregation in the browser.
2. **Data format**: Structured daily event files. Each file stores the raw GitHub search results for that one UTC day: open issues updated that day, issues closed that day, PRs opened/merged/closed that day, and PR reviews submitted that day (with full detail fields).
3. **Data branch**: Append-only. New daily file + updated snapshot files are committed with `git commit` on each run. No `--orphan` + force-push.
4. **Catch-up window**: Collect D-1 and D-2. If D-2 file already exists, skip it. Handles missed runs gracefully.
5. **Only completed days**: If CI runs on day D (UTC), only collect day D-1 (the last fully elapsed UTC day).

## Technical Approach

### New Files

#### `src/lib/daily-types.ts`

Defines the on-disk daily file schema:

```typescript
// src/lib/daily-types.ts

export type DailyIssueRecord = {
  type: "issue";
  id: number;
  number: number;
  repo: string;         // "org/name"
  title: string;
  url: string;
  author: string;
  assignees: string[];
  state: "open" | "closed";
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
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
  requestedReviewers: string[];
};

export type DailyReviewRecord = {
  type: "review";
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
  date: string;           // "YYYY-MM-DD" (UTC)
  collectedAt: string;    // ISO timestamp of collection run
  repos: string[];        // repos this file covers
  records: DailyRecord[];
};
```

#### `scripts/collect-daily.ts`

Collects raw GitHub activity for 1-2 completed UTC days and writes daily event files.

Key logic:
- Determine target UTC dates: `D-1`, and `D-2` if its file is missing in `OUT_DIR`
- `OUT_DIR` defaults to `public/` but is overridable via `DAILY_OUT_DIR` env var (so CI can write to `_data/public/`)
- For each target date, build a single-day `RangeOption` (`from = start-of-day, to = end-of-day`)
- Run the same 5 search queries as today (open issues, closed issues, open PRs, closed PRs, updated PRs) but scoped to a 24-hour window
- Fetch PR details and reviews for PRs in `updatedPrs` result (much smaller set — 1 day of activity)
- Serialize all results to `DailyFile` shape
- Write to `{OUT_DIR}/daily/YYYY-MM-DD.json`
- Log how many records were written and how many search requests were consumed

```typescript
// scripts/collect-daily.ts (key outline)
async function main() {
  const outDir = process.env.DAILY_OUT_DIR ?? path.join(process.cwd(), "public");
  const targetDates = getTargetDates(outDir); // [D-1] or [D-2, D-1]

  for (const date of targetDates) {
    const dailyPath = path.join(outDir, "daily", `${date}.json`);
    if (await fileExists(dailyPath)) {
      console.log(`[collect-daily] ${date} already collected, skipping`);
      continue;
    }
    const records = await collectDay(date, token);
    await writeDailyFile(dailyPath, { date, collectedAt: new Date().toISOString(), repos: REPOS, records });
    console.log(`[collect-daily] ${date}: wrote ${records.length} records`);
  }
}
```

#### `scripts/aggregate-daily.ts`

Reads all daily files and produces `DashboardData` snapshots for each preset.

Key logic:
- `DAILY_IN_DIR` env var (defaults to `public/`) — read daily files from here
- `SNAPSHOT_OUT_DIR` env var (defaults to same base) — write snapshot JSONs here
- For each preset (`7d`, `30d`, `90d`), compute the window `[from, to]`
- Load all daily files whose `date` falls within `[from, to]`
- Run `aggregateDailyRecords(records, roster, range)` → `DashboardData`
- Write `{SNAPSHOT_OUT_DIR}/snapshots/{preset}.json`

```typescript
// scripts/aggregate-daily.ts (key outline)
for (const preset of PRESETS) {
  const range = resolveRange(preset);
  const dailyFiles = await loadDailyFilesInRange(dailyInDir, range.from, range.to);
  const records = dailyFiles.flatMap((f) => f.records);
  const data = aggregateDailyRecords(records, roster, range);
  await writeSnapshotFile(path.join(snapshotOutDir, "snapshots", `${preset}.json`), normalizeForStaticHosting(data));
}
```

#### `src/lib/daily-aggregation.ts`

Pure function: `aggregateDailyRecords(records, roster, range) → DashboardData`

This mirrors the aggregation logic in `collectLiveDashboard` but operates on `DailyRecord[]` instead of live GitHub API responses. Key computations:

- **openAssignedIssues**: Issue records with `state=open` and member in `assignees`, deduplicated by `repo+number`, taking latest `updatedAt`
- **closedIssues**: Issue records with `state=closed` and `closedAt` within range, deduplicated
- **openAuthoredPrs**: PR records with `state=open` authored by member, deduplicated
- **mergedPrs**: PR records with `mergedAt` within range, authored by member
- **closedUnmergedPrs**: PR records with `state=closed` and `mergedAt=null`, `updatedAt` within range
- **reviewsSubmitted**: Review records where `reviewer=member.login` and `submittedAt` within range
- **pendingReviewRequests**: PR records with `state=open` and member in `requestedReviewers`
- **uniqueReviewedPrs**: Distinct `repo+prNumber` in review records for this member
- **reviewSelfAuthored/teamAuthored/externalAuthored**: Based on whether `prAuthor` is the reviewer / in roster / external
- **activityItems**: Constructed from issue + PR + review records, same shape as today
- **repoActivity**: Per-repo count of issues, PRs, reviews, contributors
- **staleItems**: Open issues/PRs with `createdAt` > 30 days ago
- **activityScore**: Via existing `calculateActivityScore()`

### Updated Files

#### `package.json`

Add two new scripts:

```json
{
  "scripts": {
    "collect-daily": "tsx scripts/collect-daily.ts",
    "aggregate-daily": "tsx scripts/aggregate-daily.ts"
  }
}
```

Keep `"snapshots"` script for local dev (unchanged — still works for direct `npm run snapshots`).

#### `.github/workflows/collect-data.yml`

Replace current collect+push steps with:

```yaml
- name: Checkout data branch into _data/
  uses: actions/checkout@v4
  with:
    ref: data
    path: _data
    fetch-depth: 0
  continue-on-error: true   # data branch may not exist on first run

- name: Collect daily GitHub activity
  run: npm run collect-daily
  env:
    GITHUB_TOKEN: ${{ secrets.DASHBOARD_GITHUB_TOKEN }}
    GITHUB_REPOS: zephyrproject-rtos/zephyr,zephyrproject-rtos/west,zephyrproject-rtos/hal_nxp,zephyrproject-rtos/hostap
    SEARCH_PAGE_LIMIT: 2
    GITHUB_SEARCH_MIN_INTERVAL_MS: 2000
    DAILY_OUT_DIR: _data/public

- name: Aggregate snapshots from daily files
  run: npm run aggregate-daily
  env:
    DAILY_IN_DIR: _data/public
    SNAPSHOT_OUT_DIR: _data/public

- name: Commit and push daily files + snapshots to data branch
  run: |
    cd _data
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add public/daily/ public/snapshots/
    if git diff --cached --quiet; then
      echo "No new data to commit"
    else
      git commit -m "chore: daily snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      git push origin HEAD:data
    fi
```

Note: `SEARCH_PAGE_LIMIT: 2` (200 results max per query) is sufficient for a single day's activity. The current `5` (500 results) was needed for 7-day/90-day windows.

#### `.github/workflows/publish-pages.yml`

No changes needed. It already reads `public/snapshots/` from the `data` branch — the aggregation step now keeps those up to date.

### Implementation Phases

#### Phase 1: Daily Event Types + Collection Script

- [ ] Create `src/lib/daily-types.ts` with `DailyFile`, `DailyRecord` union, `DailyIssueRecord`, `DailyPrRecord`, `DailyReviewRecord`
- [x] Create `scripts/collect-daily.ts`:
  - `getTargetDates(outDir)` — returns D-1, or [D-2, D-1] if D-2 file missing
  - `collectDay(date, token)` → `DailyRecord[]` using existing search + PR detail logic
  - Idempotency check (skip if file exists)
  - Support `DAILY_OUT_DIR` env var
- [x] Add `collect-daily` to `package.json` scripts
- [ ] Test locally: `DAILY_OUT_DIR=_tmp npm run collect-daily` produces well-formed JSON

#### Phase 2: Aggregation Script

- [x] Create `src/lib/daily-aggregation.ts`:
  - `aggregateDailyRecords(records, roster, range)` → `DashboardData`
  - Deduplicate issue/PR records by `repo+number`, keeping latest state
  - Match all `ContributorMetrics` fields from existing `collectLiveDashboard` output
  - Produce `activityItems[]` array
- [x] Create `scripts/aggregate-daily.ts`:
  - Load daily files for window
  - Call `aggregateDailyRecords`
  - Write `public/snapshots/{7d,30d,90d}.json` + `meta.json`
  - Support `DAILY_IN_DIR` and `SNAPSHOT_OUT_DIR` env vars
- [x] Add `aggregate-daily` to `package.json` scripts
- [ ] Validate output against current `generate-snapshots.ts` output shape

#### Phase 3: CI Workflow Update

- [x] Update `collect-data.yml` to use new scripts + append-only push
- [x] Remove `git checkout --orphan data-staging` + force push
- [x] Add `continue-on-error: true` on data branch checkout (first run)
- [x] Init data branch if it doesn't exist yet (bootstrap step)
- [ ] Verify `publish-pages.yml` continues working unchanged

#### Phase 4: Tests + Validation

- [x] Add unit tests in `tests/daily-aggregation.test.ts`:
  - Given sample daily files → assert correct `ContributorMetrics` values
  - Deduplication: same PR in two daily files → counted once
  - Catch-up: D-2 file missing → both dates collected
  - Idempotency: re-running produces no duplicate records
- [ ] Manual end-to-end: run both scripts locally, verify snapshot JSON shape matches what `generate-snapshots.ts` produced
- [ ] CI test run: trigger `workflow_dispatch` on updated `collect-data.yml`, confirm data branch receives a new commit

## Alternative Approaches Considered

| Approach | Why Rejected |
|---|---|
| Keep current force-push + overwrite | Rate limits hit routinely; no history |
| Reviewer-targeted chunk queries (`reviewer:login`) | 422 errors on certain username patterns — unreliable |
| Client-side aggregation in browser | Incompatible with static GitHub Pages export |
| Runtime aggregation in Next.js API route | API routes are removed during static build |

## System-Wide Impact

### Interaction Graph

`collect-data.yml` → `collect-daily.ts` → GitHub Search API (search quota) + GitHub REST API (core quota for PR details) → writes `_data/public/daily/YYYY-MM-DD.json`

→ `aggregate-daily.ts` → reads all daily files → calls `aggregateDailyRecords()` → writes `_data/public/snapshots/*.json`

→ `git push origin HEAD:data` → triggers `publish-pages.yml` (via `workflow_run`) → `publish-pages.yml` sparse-checkouts `public/snapshots/` from data branch → Next.js static build reads those files → deploys to GitHub Pages

`getDashboardData()` in `src/lib/dashboard.ts` reads snapshot files unchanged.

### Error & Failure Propagation

- **Collection failure (GitHub API error)**: `collect-daily.ts` exits non-zero. CI step fails. No partial daily file is written (write is atomic: build full `records[]` in memory, then write once). The `data` branch is unchanged. Next run will retry D-1 (now D-2) as a catch-up.
- **Aggregation failure**: `aggregate-daily.ts` exits non-zero. Daily files were already written. Next run can re-run aggregation from existing daily files.
- **Push failure**: `data` branch is unchanged; next run retries.
- **Data branch missing**: `continue-on-error: true` on checkout step. Scripts write to `_data/public/` even if `_data/` is an empty directory. The push step creates the `data` branch on first run via `git push origin HEAD:data`.

### State Lifecycle Risks

- **Duplicate daily files**: Idempotency check prevents re-writing an existing daily file. File existence check uses the `date` string — same date = same file, skip.
- **Partial snapshot**: Aggregation writes all presets atomically per file. If CI is interrupted mid-aggregation, some snapshot files may be stale but not missing (old data). Next run re-runs aggregation and overwrites.
- **Stale rolling window**: If no daily collection happens for >90 days, the 90d window would lose older entries. This is expected behavior; run `collect-daily` with a backfill flag to recover.

### API Surface Parity

- `generate-snapshots.ts` remains unchanged — still used for `npm run snapshots` local workflow and any non-static deployment
- `check-queries.ts` remains unchanged — still used for diagnostic runs
- `getDashboardData()` in `dashboard.ts` reads snapshot files — unchanged behavior
- New scripts are additive: `collect-daily` and `aggregate-daily`

### Integration Test Scenarios

1. **Happy path**: Provide 7 daily files covering the last week → `aggregate-daily` produces `7d.json` with correct contributor counts
2. **Catch-up**: D-2 file missing + D-1 file missing → `collect-daily` writes both; no duplicates after second run
3. **Idempotency**: Run `collect-daily` twice for the same date → second run skips, daily file unchanged
4. **Deduplication**: Same PR appears in D-2 and D-1 daily files → `aggregate-daily` counts it once in 7d snapshot
5. **Data branch bootstrap**: `data` branch does not exist → first CI run creates it with initial daily file + snapshots

## Acceptance Criteria

### Functional Requirements

- [ ] `npm run collect-daily` writes `public/daily/YYYY-MM-DD.json` for D-1 (and D-2 if missing)
- [ ] Running `collect-daily` twice for the same date produces identical output (idempotent)
- [ ] `npm run aggregate-daily` produces `public/snapshots/{7d,30d,90d}.json` with the same `DashboardData` shape as `generate-snapshots.ts`
- [ ] All `ContributorMetrics` fields are populated (no undefined/missing fields vs. current output)
- [ ] `collect-data.yml` commits new daily file + updated snapshots with `git commit` (non-destructive push)
- [ ] `data` branch history grows by one commit per CI run
- [ ] `publish-pages.yml` continues to deploy correctly without any changes

### Non-Functional Requirements

- [ ] Single `collect-daily` run uses ≤ 20 search API requests (well under 30/min quota)
- [ ] Total wall time for `collect-daily` < 3 minutes for 4 repos
- [ ] Daily files are valid JSON, parseable by `JSON.parse`
- [ ] CI does not fail on first run (data branch bootstrap)

### Quality Gates

- [ ] `tests/daily-aggregation.test.ts` covers deduplication, catch-up, and all ContributorMetrics fields
- [ ] TypeScript compilation passes (`tsc --noEmit`)
- [ ] `npm run check-queries` continues to pass (existing tooling unaffected)

## Dependencies & Prerequisites

- `tsx` already installed (used by existing scripts)
- `date-fns` already installed (used for date math)
- `p-limit` already installed (used for concurrency in detail fetches)
- No new npm dependencies required
- Existing `collectLiveDashboard` internals (search, PR detail fetch, review fetch) can be refactored into shared utility functions callable by both `generate-snapshots.ts` (legacy) and `collect-daily.ts` (new)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `aggregateDailyRecords` produces subtly different counts vs. `collectLiveDashboard` | Medium | Medium | Run both in parallel during transition; compare outputs |
| Missing PR detail fields in daily file (e.g., `requestedReviewers`) | Low | Medium | Validate `DailyPrRecord` against full PR detail fetch; add assertions in collect step |
| Data branch history grows too large over months | Low | Low | Daily files are small (~5–50 KB each); 365 days/year = ~10 MB/year max |
| First run fails to create data branch | Low | High | `git push origin HEAD:data` creates branch automatically; tested with `continue-on-error` |

## Future Considerations

- **Backfill script**: A one-time `backfill-daily.ts` script that fetches historical daily files for the last 90 days (useful for initial deployment or recovery from data loss)
- **Per-day drill-down UI**: Since daily files are stored, a future "daily activity" view could show per-day breakdowns without re-querying GitHub
- **Alerting**: If `collect-daily` writes 0 records for a non-holiday weekday, emit a warning (possible GitHub API outage)

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-13-incremental-daily-accumulation-brainstorm.md](docs/brainstorms/2026-03-13-incremental-daily-accumulation-brainstorm.md)
  Key decisions carried forward:
  1. CI aggregation step (Option C) — compatible with static GitHub Pages
  2. Structured activity events format (Option C) — typed, compact, aggregatable
  3. Append-only data branch — preserves history, enables catch-up

### Internal References

- Current snapshot generation: [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts)
- Current CI collection workflow: [.github/workflows/collect-data.yml](.github/workflows/collect-data.yml)
- Static publish workflow: [.github/workflows/publish-pages.yml](.github/workflows/publish-pages.yml)
- Dashboard data types: [src/lib/types.ts](src/lib/types.ts)
- Dashboard data loader: [src/lib/dashboard.ts](src/lib/dashboard.ts)
- Date range resolution: [src/lib/range.ts](src/lib/range.ts)
- GitHub API layer (search + details): [src/lib/github.ts](src/lib/github.ts)
- Diagnostics script: [scripts/check-queries.ts](scripts/check-queries.ts)
