---
title: feat: Refine dashboard UI density and review columns
type: feat
status: completed
date: 2026-03-11
---

# feat: Refine dashboard UI density and review columns

## Overview

Refine the activity dashboard shell UI to reduce vertical/horizontal density and keep the most important signals visible without side panels.

Changes requested:

1. Convert the **Contributors** filter from a multi-select listbox into a compact dropdown.
2. Remove the **Signals** side panel, but keep **warnings** visible in the **top status area**.
3. Remove the **Repo coverage** side panel so **Contributor load** spans the full row.
4. On `/reviews`, remove the **Unique PRs** column from the contributor ranking table, while still sorting by **Review score**.

## Problem Statement / Motivation

- The current contributors multi-select listbox consumes too much space in the filter panel.
- The Signals and Repo Coverage panels reduce the width available for the contributor ranking table, and push key content below the fold.
- On the Reviews view, the contributor table is too wide; the “Unique PRs” column is requested to be removed, but the **review score ranking** should remain unchanged.

## Decisions (Proposed)

- **Contributor filter remains multi-select, but becomes a compact dropdown UI.**
  - Rationale: the request explicitly calls for a dropdown to save space while still supporting multi-select.
  - Query param stays `contributor` to avoid changing routing.
  - Proposed submission format: multiple `contributor=<login>` values (one per selected contributor), which is already supported by filter parsing and the export route.
- **Warnings move into the top status area** (the existing status strip under the filter form) and the Signals side panel is removed.
- **Repo coverage side panel is removed** and the content grid becomes single-column so the contributor table is full width.
- **Review score sorting stays as-is.**
  - The reviews contributor table will remove the “Unique PRs” column, but the `Review score` column continues to rank contributors.

## Proposed Solution

### 1) Contributors filter: listbox → dropdown

Primary file: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)

- Replace the current contributors `<select multiple size=...>` listbox with a compact dropdown experience.
- Proposed minimal HTML approach (no new libraries):
  - Use a `<details>` + `<summary>` control as the “dropdown”.
  - Inside the dropdown, render a scrollable checkbox list of contributors.
  - Each checkbox uses `name=\"contributor\"` and `value=\"<login>\"` so the GET form submits multiple `contributor` values.
  - Add a lightweight “All contributors” action inside the dropdown (clears selections).
- Ensure the summary text mirrors the current `selectedContributor` logic (e.g. `All contributors` or a comma-joined list of names).

Supporting file: [src/lib/dashboard-filters.ts](src/lib/dashboard-filters.ts)

- No functional changes expected: `parseDashboardFilters` already supports arrays (multiple `contributor` params) and also supports comma-separated values.
- Verify that both the server pages (`searchParams`) and export route ([src/app/api/export/route.ts](src/app/api/export/route.ts)) continue to parse multi-select submissions (`getAll(\"contributor\")`) as intended.

### 2) Warnings in top bar; remove Signals panel

Primary file: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)

- Remove the `<section className="panel warning-panel">` block (Signals panel) from the sidebar.
- Add a warnings block inside the existing top status area (the `.status-strip` section under the filter form):
  - If `viewData.warnings.length === 0`, display a compact “No warnings” message.
  - Otherwise, render the warning messages using the existing `.warning-item` styles.

Supporting file: [src/app/globals.css](src/app/globals.css)

- The existing warning styles (`.warning-item`) should be re-used.
- Update `.status-strip` layout to support the warnings block cleanly (recommended: switch to an auto-fit grid so the layout doesn’t break if a warnings card is added).

### 3) Remove Repo coverage panel; make contributor load full width

Primary file: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)

- Remove the `<section className="panel repo-panel">` block (Repo coverage).
- Remove the sidebar column wrapper entirely (`<aside className="stack-column">...</aside>`), since both side panels are being removed.

Supporting file: [src/app/globals.css](src/app/globals.css)

- Update `.content-grid` to use a single column layout (e.g. `grid-template-columns: minmax(0, 1fr);`) since there will no longer be a sidebar column.

### 4) Reviews contributor columns: remove “Unique PRs” column

Primary file: [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)

- In `getContributorColumns(view)`, for `case "reviews"`, remove the column with:
  - `key: "unique-prs"`
  - `label: "Unique PRs"`
- Also remove the columns with:
  - `key: "self"` / label `Self`
  - `key: "repos"` / label `Repos`
- Keep the `score` column untouched so sorting and ranking stays driven by `activityScore`.

Note:
- Review score remains defined by `calculateViewScore("reviews")` (currently `reviews submitted + unique PRs reviewed`). This is explicitly desired for sorting.

## Acceptance Criteria

- Contributors filter in the filter panel is a compact dropdown UI and supports multi-select.
- “All contributors” behavior remains available (clears contributor selections).
- The Signals side panel is removed from the page.
- Warnings remain visible in the top status area (same page, above the contributor table) for all views.
- Repo coverage panel is removed.
- Contributor load table spans the full content width (no empty sidebar column).
- Reviews view contributor table no longer includes the columns: “Unique PRs”, “Self”, or “Repos”.
- Reviews view contributor table still sorts/ranks by Review score.
- `npm.cmd run lint` and `npm.cmd run build` succeed.

## Implementation Slices

### Slice 1 — Contributor multi-select dropdown

- [x] Update the contributors filter control in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx).
- [x] Validate parsing behavior through [src/lib/dashboard-filters.ts](src/lib/dashboard-filters.ts) (server pages + export route).

### Slice 2 — Warnings top bar

- [x] Remove Signals side panel in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx).
- [x] Add warnings rendering to the status area.
- [x] Adjust [src/app/globals.css](src/app/globals.css) status-strip layout if needed.

### Slice 3 — Full-width contributor table

- [x] Remove Repo coverage panel and sidebar column in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx).
- [x] Update [src/app/globals.css](src/app/globals.css) `.content-grid` to a single-column layout.

### Slice 4 — Reviews column change

- [x] Update `getContributorColumns("reviews")` in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts) to remove “Unique PRs”, “Self”, and “Repos”.
- [x] Sanity-check `/reviews` contributor table renders the remaining columns as expected.

## Open Questions

- None.
