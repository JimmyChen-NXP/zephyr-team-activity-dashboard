---
title: feat: Split dashboard activity views into dedicated pages
type: feat
status: completed
date: 2026-03-10
---

# feat: Split dashboard activity views into dedicated pages

## Overview

Split the current combined dashboard detail area into three focused pages:
- Issues
- Authored PRs
- Review activities

The goal is to reduce visual density, improve scanability, and preserve the existing shared filter model so users can move between activity pages without losing context.

## Problem Statement / Motivation

The current dashboard places issues, authored PRs, and review activity on one screen. This creates a dense layout that is harder to scan, especially when a contributor is selected and the user wants to focus on one activity type at a time.

The user wants:
- issues, authored PRs, and review activities on separate pages rather than one page
- shared filters preserved across those pages
- contributor-focused detail on each page
- activity calculations separated by activity type instead of combining issues, authored PRs, and reviews into one shared calculation

## Proposed Solution

Introduce three dedicated activity routes while preserving the current shared dashboard context and filter semantics.

### Proposed route structure

- `/issues`
- `/pull-requests`
- `/reviews`

### Recommended UX model

Use the URL query string as the source of truth for shared filter state:
- `preset`
- `contributor`
- `repo`
- `refresh`

Add a shared page navigation control that lets users move between the three activity pages while preserving the active query string.

### Shared content strategy

Keep the following shared across the three pages:
- hero/header context
- filter controls
- GitHub token controls
- page chrome and layout structure for summary cards
- page chrome and layout structure for charts
- page chrome and layout structure for contributor load sections
- warnings / sync health
- repo coverage panel

Each page should then render only one focused detail table:
- Issues page → issue table
- Pull requests page → authored PR table
- Reviews page → reviewed PR table, including `team-pr` vs `ext-pr`

All page-level calculations must be scoped to the active activity type. The dashboard should no longer present a single combined activity calculation that mixes all three aspects together.

## Recommended decisions to lock before implementation

These decisions remove the main sequencing risks in the current plan.

### Root route behavior

Recommended default:
- keep `/` as a compatibility entrypoint
- redirect `/` to `/issues` with the active query string preserved
- do not introduce a fourth overview-specific data path in this change

Why:
- preserves old bookmarks and shared links
- keeps the implementation focused on the requested three-page split
- avoids creating a new overview route with separate rendering logic

### Review page scope

Recommended default:
- `/reviews` shows only submitted review rows where `item.type === "review"`
- `review_request` remains summary-only for this change

Why:
- matches the current reviewed PR table semantics
- avoids mixing completed review events with pending requests in one table
- keeps page-level export behavior easier to explain

### Refresh query behavior

Recommended default:
- preserve `preset`, `contributor`, and `repo` across page switches
- do not persist `refresh=1` in navigation links after the request completes

Why:
- page navigation should not trigger accidental live refreshes
- `refresh` is an action flag, not durable state

### Export behavior

Recommended default:
- the main export action is page-aware and exports only the currently visible table
- all-activity export, if needed later, is a separate explicit mode and is out of scope for this change

### Activity calculation behavior

Recommended default:
- Issues, authored PRs, and reviews each calculate their metrics separately
- summary cards, charts, and contributor ranking shown on a page are derived only from that page's activity subset
- no combined cross-activity score is used as the primary page metric in this split-page experience

Why:
- aligns the page totals with the visible table
- reduces confusion when users focus on one activity type
- makes contributor ranking and charts easier to interpret within each page context

### Token return-path behavior

Recommended default:
- token save and clear return to `pathname + search`
- invalid or missing `returnTo` falls back to `/issues`
- return targets are limited to internal dashboard routes

## Route contract

| Route | Focused content | Calculation scope | Export behavior | Zero-state expectation |
| --- | --- | --- | --- | --- |
| `/issues` | Assigned issue rows only | Issue-only metrics and contributor ranking | Issues-only CSV | Explain that no issues matched the active filters |
| `/pull-requests` | Authored PR rows only | Authored-PR-only metrics and contributor ranking | Authored-PR CSV | Explain that no authored PRs matched the active filters |
| `/reviews` | Submitted review rows only | Review-only metrics and contributor ranking | Reviews-only CSV | Explain that no reviews matched the active filters |

The shared shell remains structurally consistent across routes for the same query string, but page metrics and contributor ranking are recalculated from the active activity subset.

## Technical Considerations

### Existing patterns to preserve

- Server-rendered page data flow from [src/app/page.tsx](src/app/page.tsx) into [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- Centralized filter application in [src/lib/dashboard.ts](src/lib/dashboard.ts)
- Shared filter contract in [src/lib/types.ts](src/lib/types.ts)
- URL-driven export behavior in [src/app/api/export/route.ts](src/app/api/export/route.ts)
- Token redirect behavior in [src/app/api/token/route.ts](src/app/api/token/route.ts)

### Recommended implementation shape

1. Extract shared search-param parsing into a reusable helper
2. Extract shared route-aware URL builders for filter forms, contributor links, export links, and token return paths
3. Extract shared shell sections from the current monolithic dashboard shell
4. Add dedicated route pages for issues, pull requests, and reviews
5. Add per-view aggregate builders so each route recalculates summaries, charts, and contributor ranking from the active activity subset
6. Add page-aware navigation that preserves durable filters but not one-shot refresh actions
7. Make export page-aware so the CSV matches the currently visible activity page
8. Preserve root-route compatibility through redirect behavior

### Suggested helper boundaries

Add small shared helpers instead of repeating route logic in each page:

- `parseDashboardFilters(searchParams)`
  - normalize `preset`, `contributor`, `repo`, and `refresh`
  - keep page parsing logic out of individual route files
- `buildDashboardHref(pathname, filters, options?)`
  - build route-aware links
  - allow explicit omission of `refresh`
- `getActivityItemsForView(data, view)`
  - map the already-filtered shared payload to issue, PR, or review rows
  - share the same row-selection logic between UI and CSV export
- `getViewMetrics(data, view)`
  - derive summary cards, charts, and contributor ranking from the active activity subset only
  - avoid mixing issue, PR, and review counts in one page-level calculation
- `resolveTokenReturnTo(pathname, filters)`
  - centralize safe return-path generation for [src/app/api/token/route.ts](src/app/api/token/route.ts)

### Route/page composition

Prefer thin page files:

- `src/app/issues/page.tsx`
- `src/app/pull-requests/page.tsx`
- `src/app/reviews/page.tsx`

Each page should:
- read `searchParams`
- call the shared filter parser
- call `getDashboardData(filters)` once
- render a shared layout component with `view="issues" | "pull-requests" | "reviews"`

This keeps data loading server-first and avoids creating separate live/cache/demo pipelines per page, while still allowing per-view derived calculations.

### Next.js App Router note

Keep query parsing in page components or shared page helpers, not in a layout that expects fresh `searchParams` on every navigation. App Router layouts do not re-render with updated search params in the same way pages do, so the route-level page remains the correct server entrypoint for filter-aware rendering.

### Data model and filter behavior

Avoid creating separate fetch pipelines for each page. Continue using the current shared `DashboardData` payload from [src/lib/dashboard.ts](src/lib/dashboard.ts), then derive page-specific subsets and page-specific aggregates from the already filtered data.

This reduces drift risk and keeps:
- cache behavior consistent
- warning states consistent
- live refresh behavior consistent

The page split changes both presentation and derived page math: collection stays shared, but page metrics must be recalculated separately for issues, authored PRs, and reviews.

### Page-specific metric explanation

The current combined activity score formula in [src/lib/scoring.ts](src/lib/scoring.ts) and [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md) should not be the primary metric model for these split pages.

Instead, the plan should introduce page-specific calculations:

- Issues page → issue-focused contributor load and issue-focused summary metrics
- Pull Requests page → authored-PR-focused contributor load and PR-focused summary metrics
- Reviews page → review-focused contributor load and review-focused summary metrics

If explanatory help text is shown, it should describe the active page's metric semantics rather than one combined cross-activity score.

## UI / UX recommendations

### Activity navigation

- Add a persistent activity switcher directly below the shared hero/filter region
- Use strong active-state treatment:
  - selected pill or underline
  - matching section accent
  - `aria-current="page"`
- Preserve the current query string when switching routes

### Focused detail section

Each page should add a local heading above its single table that includes:
- the activity type label
- visible result count
- active filter summary when helpful

This makes it obvious that the shared dashboard context is unchanged and only the detail mode has changed.

The count and support metrics shown in this section should be scoped to the active activity type only.

### Zero-state design

Each route should have page-specific zero-state copy that:
- names the empty activity type
- restates the active filters
- suggests one-click recovery actions where practical, such as clearing contributor or repo filters

### Responsive behavior

- keep the shared shell order stable across all routes
- make the activity switcher sticky or easy to re-access on long pages
- use a horizontally scrollable segmented control on smaller screens
- preserve readable table behavior on narrow screens instead of shrinking text aggressively

## System-Wide Impact

- **Interaction graph**: page navigation, filter submit, contributor click-through, token save/clear, and export links must all become route-aware instead of assuming `/`.
- **Error propagation**: cached/demo/live warnings should remain consistent across the three pages for the same filter state.
- **State lifecycle risks**: route splits must not create inconsistent freshness states, filter resets, or page-specific metric drift when moving across pages.
- **API surface parity**: issues, pull requests, and reviews must all preserve the same query parameter contract and zero-state behavior while using page-specific aggregate calculations.
- **Integration test scenarios**:
  - direct-link to each page with query params
  - contributor selection preserved across page navigation
  - token save/clear returns to the active page
  - export matches the active page table
  - zero-state on one page while other pages still have results

## Non-goals

- no new GitHub collection pipeline per page
- no new global combined score introduced for the split-page experience
- no new filters beyond the current `preset`, `contributor`, `repo`, and `refresh`
- no redesign of shared summary cards or charts beyond adding clearer activity navigation context

## Acceptance Criteria

- [x] The dashboard exposes three direct-entry routes: `/issues`, `/pull-requests`, and `/reviews`.
- [x] For the same query string, the shared shell structure remains consistent across all three routes while page metrics are recalculated from the active activity subset.
- [x] Navigating between activity pages preserves `preset`, `contributor`, and `repo` query parameters.
- [x] `refresh` is treated as an explicit action flag and does not persist across page-to-page navigation.
- [x] `Apply filters` updates the current route instead of sending the user back to `/`.
- [x] Clicking a contributor row preserves the current activity route while updating the contributor filter.
- [x] The Issues page renders only issue rows and its summary cards, charts, and contributor ranking are calculated only from issue activity.
- [x] The Pull Requests page renders only authored PR rows and its summary cards, charts, and contributor ranking are calculated only from authored PR activity.
- [x] The Reviews page renders only submitted review rows, clearly labels `team-pr` vs `ext-pr`, does not mix in `review_request` rows, and calculates its metrics only from review activity.
- [x] Export behavior is page-aware and its rows exactly match the currently visible filtered table.
- [x] Saving or clearing a token returns the user to the same in-app pathname with the active query string restored.
- [x] Any metric explanation shown on a page describes the page-specific calculation instead of a combined cross-activity score.
- [x] Existing filtered warnings and sync state remain consistent for the same query parameters after the UI split.
- [x] Existing root URLs remain valid through a documented redirect or compatibility behavior.

## Success Metrics

- Users can focus on one activity type without scanning unrelated detail tables.
- Page navigation between issues, authored PRs, and reviews retains filter context without re-entry.
- Page-scoped exports align with visible table data and reduce confusion.
- Page-scoped totals and contributor ranking align with the visible activity type and reduce interpretation errors.
- Contributor drill-down remains fast and understandable even after the route split.

## Dependencies & Risks

### Dependencies

- Current shared dashboard data contracts in [src/lib/types.ts](src/lib/types.ts)
- Shared filtered data generation in [src/lib/dashboard.ts](src/lib/dashboard.ts)
- Existing activity typing from [src/lib/github.ts](src/lib/github.ts) and [src/lib/demo-data.ts](src/lib/demo-data.ts)
- Shared styling in [src/app/globals.css](src/app/globals.css)

### Risks

- Root-relative links and forms may break navigation if not updated everywhere.
- Export may no longer match user expectations unless page-aware filtering is introduced.
- Review activity handling may drift if row selection rules are duplicated between UI and export.
- Page-specific aggregate logic may diverge across routes if summary, charts, and contributor ranking are recalculated in different places.
- Repeating shared summary UI across pages could create confusion unless the active page is clearly indicated.
- Old bookmarks to `/` may behave unexpectedly if root-route behavior is changed without a compatibility strategy.

### Mitigations

- centralize parse/build helpers for filters and URLs
- centralize page-to-activity subset selection for both UI and CSV export
- centralize per-view aggregate builders for summary cards, charts, and contributor ranking
- perform a navigation audit to remove all hard-coded `/` links and form actions
- keep one shared data-composition path in [src/lib/dashboard.ts](src/lib/dashboard.ts)
- verify direct-link, contributor click-through, token return, export parity, and per-page metric parity before closing the work

## Implementation Suggestions

### Suggested file / module changes

- [src/app/page.tsx](src/app/page.tsx) — preserve compatibility redirect behavior
- `src/app/issues/page.tsx` — issues activity page
- `src/app/pull-requests/page.tsx` — authored PR page
- `src/app/reviews/page.tsx` — reviews page
- [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) — extract shared shell
- New page-level detail components:
  - `src/components/issues-table.tsx`
  - `src/components/authored-prs-table.tsx`
  - `src/components/reviewed-prs-table.tsx`
  - `src/components/activity-page-nav.tsx`
- contributor/summary view helpers:
  - `src/lib/dashboard-views.ts`
  - `src/lib/dashboard-aggregates.ts`
- [src/app/api/export/route.ts](src/app/api/export/route.ts) — add page-aware export selection
- [src/app/api/token/route.ts](src/app/api/token/route.ts) — preserve return path for each activity route
- [src/app/globals.css](src/app/globals.css) — add navigation and focused-page layout styles
- New shared helpers, likely under `src/lib/`:
  - `dashboard-filters.ts`
  - `dashboard-links.ts`
  - `dashboard-views.ts`

### Suggested delivery phases

1. **Contract decisions**
   - lock `/` redirect behavior
   - lock `review_request` handling
   - lock export semantics
   - lock token return-path rules
   - lock `refresh` persistence rules

2. **Routing and helper foundation**
   - extract shared search-param parsing
   - add route-aware URL builders
   - add shared activity-view subset selection
  - add shared per-view aggregate builders
   - create page files for `/issues`, `/pull-requests`, and `/reviews`

3. **Shared shell extraction**
   - split [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) into shared shell and focused detail components
   - add persistent activity navigation
  - update filter form and contributor links to target the current route
  - convert summary cards, charts, and contributor ranking to consume page-specific aggregates

4. **First-page validation slice**
   - complete one route end-to-end, preferably `/issues`
   - verify routing, filters, contributor click-through, token redirect, export parity, and zero-state behavior before cloning the pattern

5. **Complete the remaining activity pages**
   - implement `/pull-requests`
   - implement `/reviews`
   - add `team-pr` / `ext-pr` emphasis in the reviews table

6. **Export, compatibility, and regression pass**
   - make export page-aware
   - verify `/` compatibility redirect
  - validate shared-shell structure parity across routes
  - run final regression checks on warnings, charts, and page-specific contributor ranking

## Test matrix

| Area | Scenarios | Preferred coverage |
| --- | --- | --- |
| Routing | direct load of `/issues`, `/pull-requests`, `/reviews`; `/` redirect behavior | automated route/helper tests + manual smoke test |
| Filters | apply filters on each route; preserve `preset`, `contributor`, `repo`; normalize `refresh` | automated helper tests + manual submit verification |
| Contributor drill-down | clicking a contributor keeps the current route and updates only the contributor filter | automated link-builder tests + manual click-through |
| Export | CSV matches the visible row subset for each route | automated handler tests + manual CSV spot-check |
| Token actions | save/clear returns to the same route with the same search string | automated redirect tests + manual verification |
| Zero-states | one page empty while others still show data | manual visual verification + subset tests |
| Per-view aggregate parity | summary cards, charts, repo coverage, and contributor ranking match the active activity subset on each route | manual comparison + targeted assertions |

### Manual verification checklist

- open each route directly with no query params
- open each route directly with contributor and repo filters
- apply filters from each route and confirm no bounce to `/`
- click contributor rows from each route and confirm route stability
- save and clear token from each route and confirm return path fidelity
- export CSV from each route and compare to the visible table
- verify one empty page while another page still has rows
- verify that page totals and contributor ranking change when switching activity routes under the same filters

## Migration / compatibility notes

- existing bookmarks to `/` should continue to work through redirect behavior
- existing shared links with query strings should preserve filters after redirect
- internal docs and future screenshots should reference the new direct-entry activity routes

## Research Summary

### Local repo findings

- The current dashboard is a single server-rendered route in [src/app/page.tsx](src/app/page.tsx).
- The monolithic composition currently lives in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx).
- Shared filtering and aggregate recomputation already live in [src/lib/dashboard.ts](src/lib/dashboard.ts).
- The current export endpoint is not page-aware in [src/app/api/export/route.ts](src/app/api/export/route.ts).
- Token redirect behavior already supports return paths in [src/app/api/token/route.ts](src/app/api/token/route.ts).

### Learnings search

- No relevant brainstorms or solution documents were found in `docs/brainstorms/` or `docs/solutions/`.
- Existing code strongly suggests preserving URL-driven filters as the shared state model.
- The updated requirement adds a second constraint: page-level aggregates must be recomputed per activity type, not reused as one combined cross-activity score.

### Research insights

- App Router page-level `searchParams` handling is the right fit for this split because each route remains a server entrypoint and shared filters depend on incoming request state.
- Layout-level search-param assumptions would be brittle for this use case because the shared shell still needs fresh route-aware filter state on every page render.
- The current implementation risk is not data recomputation but hard-coded root-relative navigation in forms, contributor links, export links, and token flows.
- The safest route split keeps one shared `DashboardData` pipeline but adds centralized per-view aggregate builders for presentation and page-level metrics.

### Spec-style refinement

The following gaps should be resolved during implementation:
- confirm the recommended defaults above before coding begins
- verify that route-aware helpers are used everywhere that currently hard-codes `/`
- verify that page-specific zero states and page-level summaries are both derived from the active activity subset

## Enhancement Summary

### Key improvements

- added recommended decisions to remove route, export, and token-flow ambiguity
- defined a route contract for `/issues`, `/pull-requests`, and `/reviews`
- added shared-helper boundaries to reduce duplication and drift
- updated the plan so activity calculations are separate for issues, authored PRs, and reviews
- added UX guidance for active navigation, focused detail sections, zero states, and responsiveness
- strengthened acceptance criteria with page-specific and route-specific expectations
- added a concrete test matrix, manual verification checklist, and compatibility notes

## Sources & References

### Internal references

- [src/app/page.tsx](src/app/page.tsx)
- [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- [src/components/charts.tsx](src/components/charts.tsx)
- [src/lib/dashboard.ts](src/lib/dashboard.ts)
- [src/lib/types.ts](src/lib/types.ts)
- [src/lib/scoring.ts](src/lib/scoring.ts)
- [src/app/api/export/route.ts](src/app/api/export/route.ts)
- [src/app/api/token/route.ts](src/app/api/token/route.ts)
- [src/app/globals.css](src/app/globals.css)
- [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md)

### External references

- Next.js App Router routing patterns: https://nextjs.org/docs/app/building-your-application/routing
- URL search params in Next.js App Router: https://nextjs.org/docs/app/api-reference/file-conventions/page#searchparams-optional

### Related plans

- [docs/plans/2026-03-10-feat-zephyr-team-activity-dashboard-plan.md](docs/plans/2026-03-10-feat-zephyr-team-activity-dashboard-plan.md)
