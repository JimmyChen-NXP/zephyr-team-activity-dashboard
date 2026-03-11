---
title: feat: Refine reviews page focus and concentration
type: feat
status: completed
date: 2026-03-11
---



# feat: Refine reviews page focus and concentration

## Overview

Refine the Reviews activity view to:

1. Ignore review activity that is performed on the reviewer’s own authored PRs.
2. Show teammate/external breakdown as `unique PRs reviewed / reviews submitted`.
3. Replace the “Repository concentration” chart with “Contributor concentration”.

The change is intended to make `/reviews` a clearer signal of *collaboration/peer review*, and reduce noise from self-reviews.

## Problem Statement / Motivation

The current `/reviews` view includes review events where a roster member reviewed a PR they authored themselves (bucketed as `Authored by self`). This inflates review totals and makes it harder to see:

- how much review load is going to teammate-authored vs externally-authored PRs,
- how concentrated review work is across the team.

Additionally, the existing donut/summary surfaces primarily show counts of review events. The user wants teammate/external to show the ratio of **unique PRs** to **review events** as `PRs / reviews`.

Finally, the “Repository concentration” bar chart is less useful on `/reviews` than a contributor-centric distribution.

## Decisions (Confirmed)

- Exclude self-authored review activity everywhere on `/reviews` (charts, summary cards, contributor ranking, reviewed PRs table, and CSV export for `view=reviews`).
- Display teammate/external as `unique PRs reviewed / reviews submitted` in both:
  - the Reviews contributor table columns, and
  - the Reviews split donut legend/cards.
- “Contributor concentration” bar chart should use the existing **view-scoped activity score** (for Reviews: `review score = reviews submitted + unique PRs reviewed`).

## Proposed Solution

### 1) Exclude self-authored review activity at the view aggregation layer

Implement the exclusion in the view-scoped aggregation function so it applies consistently to:

- page rendering (`/reviews`),
- the export route (`/api/export?view=reviews`), and
- any other consumers of view-scoped dashboard data.

**Primary hook:** `buildViewDashboardData()` in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)

- When `view === "reviews"`, filter out `ActivityItem`s where:
  - `item.type === "review"` AND `item.reviewedPrKind === "authored-by-self"`

This ensures self-authored review rows do not contribute to:

- `summary.reviewsSubmitted`
- `summary.uniqueReviewedPrs`
- `reviewOutcomes` and `reviewSources`
- contributor ranking / columns
- reviewed PR table rows

### 2) Show teammate/external as `PRs / reviews`

#### Donut legend/cards (Reviews split)

Update the Reviews split panel in [src/components/charts.tsx](src/components/charts.tsx) to display teammate/external values as:

- `unique PRs reviewed (by kind) / reviews submitted (by kind)`

Definitions (on the filtered Reviews view data):

- `reviews submitted (by kind)` = count of review activity rows in that kind
- `unique PRs reviewed (by kind)` = dedupe by PR URL across review rows in that kind

Notes:

- The donut/pie sizing can remain based on **review event count** (current behavior), while the legend displays the richer `PRs / reviews` string.
- Since self-authored reviews are excluded, the "Authored by self" segment should be removed from the Reviews split surface (no slice, no legend row).

#### Contributor table columns

Update Reviews contributor ranking columns in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) / [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts) so:

- `Teammate` column renders: `${uniqueTeamPrs} / ${teamReviews}`
- `External` column renders: `${uniqueExternalPrs} / ${externalReviews}`

Implementation approach (lowest-risk):

- Precompute a `Map<login, { team: { uniquePrs, reviews }, external: { uniquePrs, reviews } }>` from `viewData.activityItems` inside `DashboardShell` when `view === "reviews"`.
- Update the Reviews `getContributorColumns()` path to use closures over that map (or extend `ContributorColumn.value` to accept a secondary context object).

### 3) Replace repository concentration with contributor concentration

Update [src/components/charts.tsx](src/components/charts.tsx) first chart panel to:

- Rename eyebrow/title to “Contributor concentration” / “Who is carrying the load” (or similar)
- Use bars for the top 6 contributors by `activityScore` from `viewData.contributors`
- Render:
  - x-axis: contributor (short name or `@login`)
  - y-axis: `activityScore`

Plumbing changes:

- Change `DashboardCharts` props to accept `contributors` (and optionally omit `repos`),
- Update the call site in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) to pass `viewData.contributors`.

## Technical Considerations

### Interaction graph

- `/reviews` route: [src/app/reviews/page.tsx](src/app/reviews/page.tsx)
  - calls `getDashboardData()`
  - `DashboardShell` builds `viewData` via `buildViewDashboardData()`
  - `DashboardCharts` renders charts from `viewData` props

### Error propagation

No new external API calls. Changes are aggregation + rendering only.

### State lifecycle risks

None (no persistence).

### Performance

- Filtering out self-authored review rows is O(n) over view activity items.
- Computing unique PR sets for teammate/external is also O(n) and bounded by activityItems size.

### Institutional learnings to preserve

- Preserve correctness of teammate/external author classification and avoid regressing external review coverage (see [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md)).

## Acceptance Criteria

### Functional requirements

- [x] `/reviews` excludes self-authored review activity rows (`reviewedPrKind === "authored-by-self"`) from all UI surfaces and export.
- [x] Reviews split surface no longer displays a “self-authored” segment.
- [x] Reviews split teammate/external display `unique PRs / reviews`.
- [x] Reviews contributor table teammate/external columns display `unique PRs / reviews`.
- [x] Repository concentration chart is replaced with contributor concentration based on `activityScore`.

### Non-functional requirements

- [x] No changes to GitHub collection logic or request volume.
- [x] No token values exposed.

### Quality gates

- [x] Unit tests cover exclusion of self-authored reviews in `buildViewDashboardData()`.
- [x] Tests cover teammate/external `unique PRs / reviews` computations.
- [x] `npm.cmd test`, `npm.cmd run lint`, and `npm.cmd run build` pass.

## Implementation slices

### Slice 1 — Aggregation filter

- [x] Update [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts) to filter self-authored review activity when `view === "reviews"`.
- [x] Confirm `/api/export?view=reviews` reflects the same filtered set.

### Slice 2 — Teammate/External `PRs / reviews`

- [x] Update [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts) and/or [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) to render teammate/external columns as `unique PRs / reviews`.
- [x] Update [src/components/charts.tsx](src/components/charts.tsx) to render teammate/external legend/cards as `unique PRs / reviews` and remove self segment.

### Slice 3 — Contributor concentration chart

- [x] Update [src/components/charts.tsx](src/components/charts.tsx) to use `contributors` + `activityScore` for the first chart.
- [x] Update [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) prop plumbing accordingly.

### Slice 4 — Tests

- [x] Add/extend tests in [tests/dashboard-helpers.test.ts](tests/dashboard-helpers.test.ts) (or a new focused test) validating:
  - self-authored review rows are excluded for view=reviews,
  - teammate/external counts still match expectations.

## Sources & References

- Reviews route: [src/app/reviews/page.tsx](src/app/reviews/page.tsx)
- View aggregation: [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)
- Reviews split + concentration charts: [src/components/charts.tsx](src/components/charts.tsx)
- Contributor ranking table: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- Review row rendering: [src/components/reviewed-prs-table.tsx](src/components/reviewed-prs-table.tsx)
- Export path uses view aggregation: [src/app/api/export/route.ts](src/app/api/export/route.ts)
- Prior review correctness learning: [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md)
