---
title: Activity UI and Data Architecture Refinements
type: feat
status: active
date: 2026-03-14
---

# Activity UI and Data Architecture Refinements

## Overview

A set of coordinated changes that (1) separates live open-item data from historical daily snapshots, adds a manual refresh button for open items, and (2) significantly simplifies the dashboard UI by removing charts, the Contributor Focus panel, and the oversized hero block, while making the contributor table more compact and exploring a side-by-side layout for the two most important tables.

---

## Problem Statement

- **Open items in historical data:** `collect-daily.ts` collects open/draft PRs and open issues alongside dated historical records and stores them in daily accumulation files. Open items have no "closed date" — they represent current state, not history. Accumulating them per day adds noise and inflates snapshot file size.
- **No way to refresh open items independently:** There is no targeted action to refresh only open PR / issue lists without triggering a full daily collection cycle.
- **Oversized hero block:** The `section.hero.panel` dominates the top of every page. Its `h1` font size is `clamp(2.5rem, 5vw, 4.75rem)` with a paragraph description and three meta cards — most users scroll past it immediately to get to the data.
- **Tab navigation buried below filters:** `<ActivityPageNav>` renders below the large filter panel. The three tab buttons (Issues / Pull Requests / Reviews) are not at a glance level.
- **Charts add visual weight without decision value:** The bar chart (contributor concentration) and pie chart (review split) duplicate information already in the contributor table and summary cards.
- **Contributor Focus panel is redundant:** The second `.detail-focus-panel` ("Contributor focus") explains how filtering works but adds no data value.
- **Contributor table Contributor column wraps to two lines:** The `person-cell` renders name on line 1 and `@login` on line 2, making every row taller than necessary.
- **Two important tables compete for vertical space:** The "Contributor load" table and the view-specific detail table (Issues / PRs / Reviews) are stacked. A side-by-side layout would let the user reference both at once without scrolling.

---

## Proposed Solution

### Part A — Data Architecture: Open Items Separate Snapshot

Introduce a dedicated `collect-open-items.ts` script and `collect-open-items.yml` GitHub Action that writes a single overwritable `open-items.json` to the data branch. Remove open item record collection from `collect-daily.ts` so daily files only contain date-scoped (closed / merged) records.

#### Backward Compatibility — No Re-fetching Needed

Up to 90 days of legacy daily files already contain open item records (`DailyIssueRecord` with `state: "open"`, `DailyPrRecord` with `state: "open"`) mixed alongside historical records. The existing `deduplicateByUrl()` in `daily-aggregation.ts:55` already resolves this:

```ts
// Keeps the record with the latest updatedAt for each URL
function deduplicateByUrl<T extends { url: string; updatedAt: string }>(records: T[])
```

`open-items.json` reuses the exact same `DailyIssueRecord` and `DailyPrRecord` types — **no type changes**. `aggregate-daily.ts` merges `open-items.json` records into the pool before calling `aggregateDailyRecords`:

```ts
// pseudocode — insertion point is scripts/aggregate-daily.ts:94
const allDailyRecords = allDailyFiles.flatMap((f) => f.records);
const openItemsFile = await loadOpenItemsFile(openItemsPath); // null if missing
const allRecords = [...(openItemsFile?.records ?? []), ...allDailyRecords];
// aggregateDailyRecords unchanged — deduplication handles conflicts
```

Since `open-items.json` is refreshed on every run, its `updatedAt` values beat old daily file records for the same URL — the current state always wins. If an item was open in an old file but has since closed, the newer daily file that captured the close date will have a fresher `updatedAt` and wins deduplication correctly.

**Transition behavior:**

| Scenario | Result |
|---|---|
| Old daily file: `open`, `open-items.json`: same item still open (newer `updatedAt`) | `open-items.json` wins |
| Old daily file: `open`, newer daily file: `closed` at close date | Closed record wins |
| Old daily file: `open`, not in `open-items.json` (closed but daily capture missed it) | Old open record survives until it ages out of 90d window — same edge case as today |
| `open-items.json` missing (first run before new workflow has run) | Warning logged; open items sourced from legacy daily files (existing behavior) |
| 90 days after cutover — all old files aged out | Only new daily files + `open-items.json` — clean state |

### Part B — UI: Slim Title Bar + Inline Nav Tabs

Replace the full `section.hero.panel` with a single compact title bar (`div.title-bar`) that sits inline with the three tab buttons. The title bar shows the dashboard name (or abbreviated brand) in one line; the tab buttons (`Issues` / `Pull Requests` / `Reviews`) are on the same row on the right (or below on narrow viewports).

The existing `<ActivityPageNav>` component moves to be a sibling to the new title bar — or better, the title bar and nav merge into one `<header>` row.

### Part C — UI: Remove Charts and Contributor Focus Panel

Delete `<DashboardCharts>` from the render tree in `dashboard-shell.tsx`. Delete the second `section.panel.detail-focus-panel` ("Contributor focus"). The first `detail-focus-panel` ("Activity context") may be kept as a sub-header below the filter panel, or merged into the filter panel header.

### Part D — UI: Compact Contributor Table

Merge name and login into a single line:

```tsx
// Before (2 lines)
<div className="person-cell">
  <strong>{contributor.name}</strong>
  <span>@{contributor.login}</span>
</div>

// After (1 line)
<span className="person-cell">
  <a ...><strong>{contributor.name}</strong></a>
  <span className="muted"> @{contributor.login}</span>
</span>
```

Also tighten row padding (`td` vertical padding) in `.table-wrap table` — currently generous for comfortable two-line cells.

### Part E — UI: Two Tables Side-by-Side

Wrap the contributor load section and the view-specific detail section in a shared two-column grid:

```css
.tables-grid {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(560px, 2fr);
  gap: 24px;
  align-items: start;
}

@media (max-width: 1100px) {
  .tables-grid { grid-template-columns: 1fr; }
}
```

The contributor table (left, narrower) has 5 columns: **Contributor + 4 metric columns** for issues/PR views (fewer than reviews: 6). The detail tables (right, wider) vary by view.

**Width analysis at max container (1440px, 32px body padding → ~1376px usable):**

| View | Contributor cols | Detail table cols | Feasibility |
|---|---|---|---|
| Issues | 5 (Contributor, Issues, Closed, Stale, Score) | ~6 (Contributor, Title, Repo, State, Assigned, Updated) | Comfortable |
| Pull Requests | 5 (Contributor, Open PRs, Merged, Repos, Score) | ~7 (Contributor, Title, Repo, State, Draft, Stale, Updated) | Comfortable |
| Reviews | 6 (Contributor, Reviews, Teammate, External, Pending, Score) | ~9 (Contributor, PR Title, Author, Author type, Outcome, Review time, Repo, State, Date) | Tight — reviews detail table is wide |

**Recommendation:** Apply the side-by-side grid for all three views with `min-width: 0` on each cell to allow table overflow scrolling. For the reviews view, the detail table already uses `overflow-x: auto` on `.table-wrap`. The `2fr` allocation gives the reviews table enough room at 1440px. Below 1100px, both stack to full width (existing responsive breakpoint).

**Risk mitigation:** Each table is already inside a `.table-wrap` with `overflow-x: auto`, so overflow scrolling will absorb any overflow rather than breaking layout.

---

## Acceptance Criteria

### Part A — Open Items Separate Snapshot

- [x] `scripts/collect-open-items.ts` exists and fetches only open/draft PRs + open issues (all roster members, all configured repos), writing `open-items.json` to `OPEN_ITEMS_OUT_DIR` (default `_data/public`)
- [x] `open-items.json` structure (`OpenItemsFile` type): `{ collectedAt: string, repos: string[], records: Array<DailyIssueRecord | DailyPrRecord> }` — all records have `state: "open"`, overwritten on every run, no date accumulation
- [x] `src/lib/daily-types.ts`: `DailyFile`, `DailyIssueRecord`, `DailyPrRecord`, `DailyReviewRecord` types are **not modified**; `OpenItemsFile` added as an additive export only
- [x] `.github/workflows/collect-open-items.yml` exists; triggers on `workflow_dispatch` (and optionally on a schedule matching or slightly ahead of `collect-data.yml`); pushes `open-items.json` to data branch
- [x] `collect-daily.ts` no longer queries or stores open-item records; removes `OPEN_ITEMS_PAGE_LIMIT` usage from that script
- [x] `aggregate-daily.ts` merges `open-items.json` records into the pool before calling `aggregateDailyRecords`; logs a warning (not error) if file is absent; `aggregateDailyRecords` itself is unchanged
- [x] Running `aggregate-daily` against the full 90-day window of legacy daily files (with embedded open items) plus a fresh `open-items.json` produces no double-counting
- [x] Running `aggregate-daily` without `open-items.json` present produces the same counts as today (backward-compat fallback)
- [ ] In hosted snapshot mode, `open-items.json` is included in the static build alongside `7d.json`, `30d.json`, `90d.json`
- [x] A "Refresh open items" button/link appears in the UI (filter panel or title bar); in snapshot mode it links to the `collect-open-items.yml` workflow dispatch URL; in live mode it triggers an in-page refresh of the open items data
- [x] The `DashboardShell` optionally accepts an `updateOpenItemsUrl` prop (string) so the hosting deployment can pass the workflow dispatch deep-link

### Part B — Title Bar + Inline Nav

- [x] The `section.hero.panel` block is removed from `dashboard-shell.tsx`
- [x] A new compact `div.title-bar` renders the dashboard name ("Zephyr team activity") in a single `h1` or `h2` (font size ≤ 1.25rem) with no description paragraph
- [x] The `<ActivityPageNav>` (Issues / Pull Requests / Reviews tabs) is visually on the same row as the title bar (flex row, space-between) at ≥ 900px viewport
- [x] At < 900px the title and tabs stack vertically
- [x] The "Roster size / Time window / Timezone" meta cards from the old hero are either removed or collapsed into the filter panel header as inline text
- [x] No regressions in filter panel layout or status strip

### Part C — Remove Charts and Contributor Focus Panel

- [x] `<DashboardCharts>` is removed from `dashboard-shell.tsx` render (the component file may remain but is no longer rendered)
- [x] The second `section.panel.detail-focus-panel` ("Contributor focus" section with its `p.token-copy` explanation) is removed
- [x] No orphaned CSS classes or empty sections remain visible
- [x] The "Activity context" `detail-focus-panel` (first one, showing `pageTitle` and `detailCountLabel`) is kept

### Part D — Compact Contributor Table

- [x] The `person-cell` in the contributor table renders name + `@login` on a single line
- [x] Row height in the contributor table is visually single-line (no wrapping under normal contributor name lengths)
- [x] The `table-link` click behaviour (navigating to contributor-filtered view) is preserved
- [x] No change to other table components (`issues-table.tsx`, `authored-prs-table.tsx`, `reviewed-prs-table.tsx`)

### Part E — Two Tables Side-by-Side

- [x] `div.tables-grid` wraps both the contributor load `.panel.table-panel` and the view-specific table section
- [x] Grid is `1fr 2fr` (or `minmax(360px,1fr) minmax(560px,2fr)`) at wide viewports, stacks at ≤ 1100px
- [x] Each table column has `min-width: 0` to prevent grid blowout
- [x] `.table-wrap` inside each panel continues to use `overflow-x: auto` for horizontal scroll on narrow viewports
- [ ] Visually tested at 1280px, 1440px, and 1100px (breakpoint)

### Part F — UI: Page Layout and Contributor Table Cleanup

Four focused refinements requested after initial implementation:

1. **Status strip to end of page** — the four status cards (GitHub connection, Active source, Last update, Warnings) are operational detail, not decision-making data. Move `div.status-strip` out of `section.filter-panel` and place it at the bottom of the page after `.tables-grid`.

2. **Activity context to end of page** — the `section.panel.detail-focus-panel` ("Activity context") describes the current view. It is more useful as a footer reference than as a separator between the filter panel and the summary cards. Move it to the end of the page, after the status strip.

3. **Remove `@login` from contributor name cell** — the login tag is redundant next to the display name. The contributor filter link on the name is sufficient for identification.

4. **Remove score column from contributor table, keep score-based sorting** — contributors are already sorted by `activityScore` descending (`dashboard-aggregates.ts:145`). Remove the column from display; the `scoreLabel`/`scoreFormula` tooltip logic and the `getViewScoreLabel`/`getViewScoreFormula` imports can be removed.

#### Acceptance Criteria

- [x] `div.status-strip` is rendered after `div.tables-grid`, not inside `section.filter-panel`
- [x] `section.panel.detail-focus-panel` ("Activity context") is rendered at the end of the page, after the status strip
- [x] `section.filter-panel` contains only the panel header and `form.filter-form`
- [x] Contributor table `person-cell` renders only `<strong>{contributor.name}</strong>` — no `@login` span
- [x] Score column (`key: "score"`) is not rendered in contributor table header or rows
- [x] `getViewScoreLabel` and `getViewScoreFormula` imports removed from `dashboard-shell.tsx`
- [x] Contributors remain sorted by `activityScore` descending (no change to data layer)

---

### Part G — Contributor Row → Local Detail Filter, PR Review Status, Column Reorder

Three coordinated improvements to make the side-by-side tables more interactive and informative.

#### G1 — Contributor row click filters only the detail table (no URL change)

Currently clicking a contributor name navigates to `?contributor=<login>`, which applies a full-page filter (both tables + URL change). The request is to instead let clicking a contributor row act as a **local, in-memory filter on the detail table only** — the contributor table stays fully visible for comparison, and no URL navigation occurs.

**Approach:**

`dashboard-shell.tsx` is already `"use client"`. Add a `useState<string | null>` for `localContributor`:

```tsx
const [localContributor, setLocalContributor] = useState<string | null>(null);

// Filter detail items locally
const detailItems = localContributor
  ? viewData.activityItems.filter((item) => item.contributor === localContributor)
  : viewData.activityItems;
```

Change the contributor table rows from `<a href={...}>` links to `<button>` elements that call `setLocalContributor(login)` on click (toggle: clicking the already-selected contributor clears the filter). Highlight the selected row visually (`aria-selected` + CSS). Add a small "clear" affordance above the detail table when a local filter is active (e.g., a `×` button showing "Filtering for: Name").

The existing URL-based contributor filter (from the filter form) continues to work as before — it is a separate, coarser control.

```tsx
// Contributor table row button (replaces <a>)
<button
  className={clsx("table-link", localContributor === contributor.login && "is-selected")}
  onClick={() => setLocalContributor(localContributor === contributor.login ? null : contributor.login)}
  type="button"
>
  <strong>{contributor.name}</strong>
</button>
```

#### G2 — PR status cell: reviewer verdicts, CI, cooldown, and row highlighting

The authored-PRs detail table needs to answer at a glance: **is this PR blocked, and by what?**

Five signals are needed per open PR:

| Signal | Question answered |
|---|---|
| Requested-reviewer verdicts | Did the people asked to review approve or request changes? |
| Other reviewer verdicts | Did anyone outside the requested set weigh in? |
| CI status | Did automated checks pass? |
| 72-hour cooldown (Zephyr rule) | Has the PR been in review long enough to merge? |
| Age | Has this been open for over a month with no merge? |

**Terminology clarification — "assignee" vs "requested reviewer":**

In GitHub's PR model, `assignees` (PR field) are typically the author/DRI, while `requested_reviewers` are people explicitly asked to review. The Zephyr project uses `requested_reviewers` for the "who must approve" role. This plan uses **requested reviewers** as the primary concept. The distinction between "requested reviewer verdict" and "other reviewer verdict" is: was the reviewer's login in `DailyPrRecord.requestedReviewers` at the time of collection?

---

**Data currently available:**
- `DailyReviewRecord.state` (`APPROVED | CHANGES_REQUESTED | COMMENTED`) ✓ in daily files
- `DailyReviewRecord.reviewer` (login) ✓
- `DailyPrRecord.requestedReviewers` ✓
- `DailyPrRecord.isDraft` ✓
- `DailyPrRecord.createdAt` ✓ (for age + cooldown proxy)

**Data NOT yet available (requires collection additions):**
- `ciStatus` — not in `DailyPrRecord` or `PullRequestDetail`; requires `head.sha` + a new API call

---

**Data layer additions:**

**Step 1 — Add `ciStatus` to `PullRequestDetail` type** (`src/lib/github.ts`):

```ts
export type PullRequestDetail = {
  // ...existing fields...
  head: {
    sha: string;           // add this
    repo: { full_name: string } | null;
  };
};
```

The REST API already returns `head.sha` in every PR detail response — it just isn't typed yet.

**Step 2 — Add `fetchCommitCIStatus` function** (`src/lib/github.ts`):

```ts
// Calls GET /repos/{owner}/{repo}/commits/{sha}/check-runs
// Returns aggregated: "success" | "failure" | "pending" | null (null = no checks configured)
export async function fetchCommitCIStatus(
  repoFullName: string,
  sha: string,
  token?: string,
): Promise<"success" | "failure" | "pending" | null>
```

Logic: if any check run has `conclusion: "failure" | "timed_out" | "cancelled"` → `"failure"`. If all are `"success"` → `"success"`. Otherwise `"pending"`.

**Step 3 — Extend `DailyPrRecord` for open-items-only fields** (`src/lib/daily-types.ts`):

`DailyPrRecord` is used in both daily files and `open-items.json`. Rather than modifying it (breaking change for daily files), introduce an extended type only for open-items output:

```ts
// daily-types.ts — additive only, DailyPrRecord unchanged
export type OpenPrRecord = DailyPrRecord & {
  ciStatus: "success" | "failure" | "pending" | null;
};

// Update OpenItemsFile to use OpenPrRecord for PR entries
export type OpenItemsFile = {
  collectedAt: string;
  repos: string[];
  records: Array<DailyIssueRecord | OpenPrRecord>;
};
```

**Step 4 — Collect CI status in `collect-open-items.ts`**:

After `fetchPullRequestDetails`, fetch CI status concurrently:

```ts
const [detail, ciStatus] = await Promise.all([
  fetchPullRequestDetails(item.pull_request!.url, token),
  fetchCommitCIStatus(repoFullName, detail.head.sha, token), // after detail resolves
]);

const prRecord: OpenPrRecord = {
  // ...existing DailyPrRecord fields...
  ciStatus,
};
```

Rate-limit note: `check-runs` uses the core rate limit (not search). At 300 PRs per run and 5,000 requests/hour, this adds ~300 requests. Stay within budget.

**Step 5 — Enrich `ActivityItem` with reviewer verdicts** (`src/lib/types.ts` + `src/lib/daily-aggregation.ts`):

```ts
// src/lib/types.ts
export type ReviewerVerdict = {
  login: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  wasRequested: boolean; // true if login was in DailyPrRecord.requestedReviewers
};

export type PrStatusSummary = {
  requestedVerdicts: ReviewerVerdict[];  // people in requestedReviewers who submitted a review
  otherVerdicts: ReviewerVerdict[];      // reviewers not in requestedReviewers
  pendingRequestedCount: number;         // requestedReviewers with no review yet
  ciStatus: "success" | "failure" | "pending" | null;
  cooldownHours: number;                 // hours since createdAt (proxy for review start)
  cooldownMet: boolean;                  // cooldownHours >= 72
};

export type ActivityItem = {
  // ...existing fields...
  prStatus?: PrStatusSummary; // only set for type === "pull_request"
};
```

**Scope: open PRs only.** `prStatus` is computed and attached only for PR ActivityItems where `pr.state === "open"`. Merged and closed PRs leave `prStatus` undefined — the Status cell renders `—` and no row highlight is applied. This matches where the rich data comes from: `OpenPrRecord` (with `ciStatus`) is only written by `collect-open-items.ts`, which exclusively fetches open PRs. Reviewer verdict computation is also guarded to `state === "open"` to avoid stale/misleading data on already-resolved PRs.

In `aggregateDailyRecords`, before building PR ActivityItems, build a per-PR-URL map from review records:

```ts
// Map from prUrl → latest verdict per reviewer login
const reviewsByPrUrl = new Map<string, Map<string, "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED">>();
for (const review of reviewRecords) {
  if (!reviewsByPrUrl.has(review.prUrl)) reviewsByPrUrl.set(review.prUrl, new Map());
  // Use latest review per reviewer (later submittedAt wins)
  reviewsByPrUrl.get(review.prUrl)!.set(review.reviewer, review.state);
}

// When building open PR ActivityItem:
const reviewerMap = reviewsByPrUrl.get(pr.url) ?? new Map();
const requestedSet = new Set(pr.requestedReviewers.map(r => r.toLowerCase()));
const requestedVerdicts: ReviewerVerdict[] = [];
const otherVerdicts: ReviewerVerdict[] = [];
for (const [login, state] of reviewerMap) {
  const verdict = { login, state, wasRequested: requestedSet.has(login.toLowerCase()) };
  (verdict.wasRequested ? requestedVerdicts : otherVerdicts).push(verdict);
}
const pendingRequestedCount = pr.requestedReviewers
  .filter(r => !reviewerMap.has(r.toLowerCase())).length;
const cooldownHours = differenceInHours(new Date(), parseISO(pr.createdAt));

activityItem.prStatus = {
  requestedVerdicts,
  otherVerdicts,
  pendingRequestedCount,
  ciStatus: (pr as OpenPrRecord).ciStatus ?? null,
  cooldownHours,
  cooldownMet: cooldownHours >= 72,
};
```

---

**UI — compact "Status" cell** (`authored-prs-table.tsx`):

Replace the simple "State" and "Reviews" columns with a single compact **"Status"** cell that shows all signals as inline badges. Keep the table scannable — one dense cell beats four sparse columns.

```
[PR Title]                              [Status cell]           [Updated]   ...
Open PR linked to title                 ✓ Alice  ✗ Bob  ○ Carol  CI ✓  72h ✓
```

Badge rendering rules (all inline, small font, colored):

| Badge | Condition | Color |
|---|---|---|
| `✓ {login}` | Requested reviewer: APPROVED | green |
| `✗ {login}` | Requested reviewer: CHANGES_REQUESTED | red |
| `○ {login}` | Requested reviewer: pending (no review yet) | muted |
| `+ ✓` / `+ ✗` | Non-requested reviewer: approved/changes | green/red (smaller) |
| `CI ✓` | ciStatus = success | green |
| `CI ✗` | ciStatus = failure | red |
| `CI …` | ciStatus = pending | muted |
| `72h ✓` | cooldownMet = true | muted green |
| `⏱ Xh` | cooldownMet = false, X hours remaining | amber |

Use `title` attributes on each badge for tooltip detail (e.g., `title="Bob requested changes"`).

**Row highlighting** — `<tr data-pr-highlight="...">` + CSS:

| Condition | Class | Color | Priority |
|---|---|---|---|
| `changesRequested > 0` in any verdict, OR `ciStatus === "failure"` | `pr-row-blocked` | Red tint `#fff0f0` | 1 (highest) |
| `isDraft === true` | `pr-row-draft` | Grey tint `#f5f5f5` | 2 |
| `ageDays >= 30` | `pr-row-stale` | Yellow tint `#fffbe6` | 3 |
| none | — | white | — |

Priority means: a PR that is both draft AND blocked shows red (red wins).

```css
tr[data-pr-highlight="blocked"] { background: #fff0f0; }
tr[data-pr-highlight="draft"]   { background: #f5f5f5; color: var(--muted); }
tr[data-pr-highlight="stale"]   { background: #fffbe6; }
```

---

> **Note on data freshness for reviews:** Review records in the daily files are scoped to the collection window (default 30–90 days). For PRs older than the window, review history may be incomplete. The status cell shows what is in the dataset — for open PRs (the primary use case), reviews are within window. For merged/closed PRs in the table, `prStatus` will be absent or incomplete.

> **Note on CI status freshness:** CI status is collected at the time `collect-open-items` runs (daily, ~05:23 UTC). It reflects the CI result as of collection time, not real-time. The table header or tooltip should note "CI status as of last collection".

#### G3 — Column reorder for detail tables

Move low-priority identification columns (Repository, Contributor, Created) to the right of each detail table so the most decision-relevant columns appear first.

**`authored-prs-table.tsx` — Pull Requests view:**

| Before | After |
|---|---|
| PR · Repository · Contributor · Created · State · Updated | PR · State · Reviews (new) · Updated · Repository · Contributor · Created |

**`issues-table.tsx` — Issues view:**

| Before | After |
|---|---|
| Issue · Repository · Contributor · State · Updated | Issue · State · Updated · Repository · Contributor |

**`reviewed-prs-table.tsx` — Reviews view:**

| Before | After |
|---|---|
| Reviewed PR · Repository · Reviewer · Author · Author type · Created · Status · Outcome · Updated | Reviewed PR · Status · Outcome · Author type · Updated · Repository · Reviewer · Author · Created |

#### Acceptance Criteria

**G1 — Local contributor filter:**
- [x] Clicking a contributor row in the contributor table sets a local filter; the detail table shows only that contributor's items
- [x] Clicking the same row again clears the filter (toggle)
- [x] A "Focusing: Name  ×" label appears above the detail table when a local filter is active; clicking × clears it
- [x] The selected contributor row has a visible active state (CSS class `is-selected`)
- [x] The URL does not change when the local filter is applied (no navigation)
- [x] The full-page contributor filter (form `?contributor=`) continues to work independently

**G2 — PR status cell:**
- [ ] `PullRequestDetail` type in `github.ts` includes `head.sha`
- [ ] `fetchCommitCIStatus(repoFullName, sha, token)` function added to `github.ts`; returns `"success" | "failure" | "pending" | null`
- [ ] `OpenPrRecord = DailyPrRecord & { ciStatus }` type added to `daily-types.ts`; `DailyPrRecord` is NOT modified
- [ ] `OpenItemsFile.records` uses `Array<DailyIssueRecord | OpenPrRecord>` (was `DailyPrRecord`)
- [ ] `collect-open-items.ts` fetches CI status per PR and writes `OpenPrRecord` records
- [ ] `ActivityItem` has optional `prStatus?: PrStatusSummary` field (only set for `type === "pull_request"`, only for open PRs)
- [ ] `PrStatusSummary` includes `requestedVerdicts`, `otherVerdicts`, `pendingRequestedCount`, `ciStatus`, `cooldownHours`, `cooldownMet`
- [ ] `aggregateDailyRecords` computes `prStatus` from review records × PR requested-reviewer list; latest review per reviewer wins
- [ ] `authored-prs-table.tsx` renders a single compact "Status" cell with per-reviewer badges (✓/✗/○) + CI badge + 72h cooldown badge
- [ ] Non-requested reviewers shown with smaller `+` prefix badges
- [ ] `<tr data-pr-highlight="blocked">` set when any reviewer has `CHANGES_REQUESTED` or `ciStatus === "failure"`
- [ ] `<tr data-pr-highlight="draft">` set when `isDraft === true` and not blocked
- [ ] `<tr data-pr-highlight="stale">` set when `ageDays >= 30` and not blocked or draft
- [ ] CSS rules for `blocked` (red tint), `draft` (grey tint), `stale` (yellow tint) added to `globals.css`
- [ ] `DailyReviewRecord` type is not modified

**G3 — Column reorder:**
- [x] `authored-prs-table.tsx` column order: PR · State · Updated · Repository · Contributor · Created (Reviews column deferred to G2)
- [x] `issues-table.tsx` column order: Issue · State · Updated · Repository · Contributor
- [x] `reviewed-prs-table.tsx` column order: Reviewed PR · Status · Outcome · Author type · Updated · Repository · Reviewer · Author · Created
- [x] `colSpan` values unchanged (column counts unchanged; Reviews column added in G2)

---

## Technical Considerations

- **`open-items.json` and contributor score:** `open-items.json` uses the same `DailyIssueRecord`/`DailyPrRecord` types and is merged into the record pool in `aggregate-daily.ts` before calling `aggregateDailyRecords`. The existing `deduplicateByUrl()` resolves any conflicts between old daily file records and fresh `open-items.json` records by keeping the one with the latest `updatedAt`. No changes to `aggregateDailyRecords` or the scoring logic are required.
- **Workflow dispatch button:** GitHub's `workflow_dispatch` API requires a `GITHUB_TOKEN` with `actions:write` scope. For a fully static GitHub Pages deployment, calling this from the browser requires either a proxy or exposing a scoped token. The simplest approach is to render the button as a link to the GitHub Actions UI page (like the existing `updateDataUrl` pattern), not a direct API call.
- **Hero removal:** The "Roster size", "Time window", and "Timezone" meta values are currently shown in `hero-meta`. After removing the hero, consider showing the active time range (the most useful of the three) as a badge in the filter panel header or title bar.
- **CSS cleanup:** Removing `.hero`, `.hero h1`, `.hero-copy`, `.hero-meta`, `.meta-label`, `.chart-grid`, `.chart-frame`, `.contributor-bar`, `.donut-*`, `.highlight-panel`, and related classes from `globals.css` will reduce file size.
- **`DashboardCharts` component:** The component can be left in place (for potential future use or for reference) but removed from the render in `dashboard-shell.tsx`. The Recharts dependency remains in `package.json` — remove only if charts are confirmed permanently removed.

---

## Files to Change

| File | Change |
|---|---|
| `scripts/collect-open-items.ts` | **New** — collects open issues + PRs, outputs `OpenItemsFile` JSON |
| `.github/workflows/collect-open-items.yml` | **New** — workflow to run open item collection, pushes `open-items.json` to data branch |
| `scripts/collect-daily.ts` | Remove open item queries; remove `OPEN_ITEMS_PAGE_LIMIT` |
| `scripts/aggregate-daily.ts` | Load + merge `open-items.json` records before `aggregateDailyRecords`; warn if absent |
| `src/lib/daily-types.ts` | Add `OpenItemsFile` type (additive only — no changes to existing types) |
| `src/components/dashboard-shell.tsx` | Remove hero section; add title bar with inline nav; remove charts render; remove Contributor Focus panel; compact person-cell; add tables-grid wrapper |
| `src/components/activity-page-nav.tsx` | Possibly update layout classes to support inline-with-title mode |
| `src/app/globals.css` | Remove hero/chart CSS; add `.title-bar`, `.tables-grid` CSS |
| `src/components/snapshot-dashboard-page.tsx` | Optionally load `open-items.json` in addition to the main snapshot |
| `src/lib/github.ts` | Add `head.sha` to `PullRequestDetail` type; add `fetchCommitCIStatus` function (Part G2) |
| `src/lib/daily-types.ts` | Add `OpenPrRecord` type extending `DailyPrRecord` with `ciStatus`; update `OpenItemsFile.records` union (Part G2) |
| `src/lib/types.ts` | Add `ReviewerVerdict`, `PrStatusSummary` types; add `prStatus?: PrStatusSummary` to `ActivityItem` (Part G2) |
| `src/lib/daily-aggregation.ts` | Build per-PR reviewer verdict map; attach `prStatus` to open PR `ActivityItem`s (Part G2) |
| `scripts/collect-open-items.ts` | Fetch CI status per PR via `fetchCommitCIStatus`; write `OpenPrRecord` records (Part G2) |
| `src/components/authored-prs-table.tsx` | Add Reviews column; reorder columns (Part G2 + G3) |
| `src/components/issues-table.tsx` | Reorder columns (Part G3) |
| `src/components/reviewed-prs-table.tsx` | Reorder columns (Part G3) |
| `src/components/dashboard-shell.tsx` | Add `localContributor` state; change contributor rows to toggle-buttons; filter detail items locally (Part G1) |
| `src/app/globals.css` | Add `.is-selected` style for contributor row; add `.local-filter-bar` style (Part G1) |

---

## Dependencies and Risks

- **Open item counts in activity score:** Removing open items from daily collection changes historical contributor scores. The activity score for issues (`openAssignedIssues × 3 + closedIssues × 2 + staleItems`) will drop the `openAssignedIssues` term unless we merge from `open-items.json` at aggregate time. **Mitigation:** Implement the merge in `aggregate-daily.ts` before modifying `collect-daily.ts`.
- **Side-by-side width on reviews:** The reviews detail table has 9+ columns. At 1440px with a `1fr:2fr` split, the right panel gets ~917px — enough for 9 columns at ~102px each with `overflow-x: auto` as safety net. Monitor at 1280px.
- **Hero removal and page identity:** Removing the hero removes the only place the dashboard name appears prominently. The new title bar must retain enough brand identity that the page is recognizable without the large heading.

---

## Verification Plan (Part A)

Before deploying the data architecture changes, run locally to confirm no regression:

1. **Baseline:** Run `npm run aggregate-daily` against the current data branch. Record issue/PR/review counts for 7d, 30d, 90d.
2. **After merge logic:** Apply updated `aggregate-daily.ts`. Run again **without** `open-items.json` present. Closed/merged/review counts must match baseline exactly.
3. **With `open-items.json`:** Extract open item records from any recent daily file and write a minimal `open-items.json`. Run again — only open item counts should differ (fresher dedup wins).
4. **No open items in new daily file:** Create a test daily file with only closed/merged records. Confirm it aggregates correctly.

---

## Sources and References

- `src/components/dashboard-shell.tsx` — primary render file for all UI changes
- `src/app/globals.css` — single stylesheet, all style additions/removals here
- `scripts/collect-daily.ts` — open item query removal
- `scripts/aggregate-daily.ts:94` — `allRecords` construction — insertion point for open-items merge
- `src/lib/daily-aggregation.ts:55` — `deduplicateByUrl` — key backward-compat mechanism
- `src/lib/daily-aggregation.ts:129-136` — record partition and deduplication flow
- `src/lib/daily-types.ts` — unchanged types; `OpenItemsFile` added here
- `.github/workflows/collect-data.yml` — reference pattern for new workflow
- `src/lib/dashboard-aggregates.ts:225` — `getContributorColumns` (column counts per view)
- `src/lib/daily-aggregation.ts:119` — `activityItems` array construction — insertion point for `reviewSummary`
- `src/lib/daily-aggregation.ts:383` — PR `ActivityItem` push — where `prStatus` is attached
- `src/lib/types.ts:92` — `ActivityItem` type definition
- `src/lib/daily-types.ts:37` — `DailyPrRecord.requestedReviewers` (requested reviewer set)
- `src/lib/daily-types.ts:49` — `DailyReviewRecord.state` (`APPROVED | CHANGES_REQUESTED | COMMENTED`)
- `src/lib/github.ts:46` — `PullRequestDetail` type (add `head.sha`)
- `src/lib/github.ts:377` — `fetchPullRequestDetails` (pattern for new `fetchCommitCIStatus`)
- GitHub REST API: `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` — CI status endpoint
