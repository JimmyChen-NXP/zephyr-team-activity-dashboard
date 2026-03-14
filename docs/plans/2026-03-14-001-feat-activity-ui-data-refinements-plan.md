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
