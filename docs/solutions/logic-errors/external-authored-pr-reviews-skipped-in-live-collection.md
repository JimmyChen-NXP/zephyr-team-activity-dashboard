---
title: External-authored PR reviews were excluded from Zephyr dashboard review metrics
date: 2026-03-11
category: logic-errors
tags:
  - github
  - dashboard
  - reviews
  - analytics
  - bugfix
status: completed
---

# External-authored PR reviews were excluded from Zephyr dashboard review metrics

## Summary

A live-collection bug in the Zephyr team activity dashboard caused review activity on externally authored pull requests to be dropped before review extraction ran. The dashboard therefore underreported review activity, left the external-authored review bucket at zero, and omitted valid review rows from the reviews page.

The fix separated roster-author PR enrichment from review-event extraction, so roster reviewers are now counted even when the PR author is outside the team roster. The change was validated with a dedicated collector regression test plus lint and production build checks.

## Problem type

Data aggregation correctness bug in live GitHub review collection.

## Symptoms observed

- Reviews submitted by roster members on externally authored PRs were missing after live refresh.
- `externalAuthored` review counts stayed at zero or were underreported.
- Review summary cards and the review split chart showed incomplete data.
- Reviewer-level metrics such as `reviewsSubmitted` and `uniqueReviewedPrs` were understated.
- Review detail rows for external-authored PRs did not appear on the reviews page.

## Components involved

- [src/lib/github.ts](src/lib/github.ts)
- [src/lib/types.ts](src/lib/types.ts)
- [src/lib/dashboard.ts](src/lib/dashboard.ts)
- [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)
- [src/lib/demo-data.ts](src/lib/demo-data.ts)
- [src/components/reviewed-prs-table.tsx](src/components/reviewed-prs-table.tsx)
- [src/components/charts.tsx](src/components/charts.tsx)
- [tests/github.test.ts](tests/github.test.ts)

## Root cause

The live collector in [src/lib/github.ts](src/lib/github.ts) broadened review detail targets from team-authored PRs to all PRs, but the detail-processing loop still assumed the PR author had to be a roster member.

Specifically, the loop looked up the PR author in the contributor map and exited early when the author was external. That early exit happened before review extraction, so the collector never reached the logic that:

- scans in-range review events,
- classifies them as self/team/external authored,
- increments `reviewSources.externalAuthored`, or
- creates review activity rows.

In short: the candidate set was widened, but the control flow still silently filtered out external-authored PRs.

## Investigation steps

1. Reviewed the live collection flow in [src/lib/github.ts](src/lib/github.ts).
2. Confirmed `reviewDetailTargets` was already being built from all PR search results.
3. Traced the detail loop and found the roster-author guard that caused `continue` before `rangedTeamReviews` processing.
4. Checked downstream contracts in [src/lib/types.ts](src/lib/types.ts), [src/lib/dashboard.ts](src/lib/dashboard.ts), and [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts) to verify the data model could preserve external author information.
5. Reviewed the UI surfaces in [src/components/reviewed-prs-table.tsx](src/components/reviewed-prs-table.tsx) and [src/components/charts.tsx](src/components/charts.tsx) to ensure the richer classification would render correctly.
6. Added a focused regression test in [tests/github.test.ts](tests/github.test.ts) to reproduce the exact failure mode.

## Working solution

### 1. Separate author-specific PR enrichment from review extraction

In [src/lib/github.ts](src/lib/github.ts), the detail loop now uses `authorContributor` rather than assuming every review-detail target belongs to a roster author.

- Author-only metrics remain gated on roster membership:
  - draft PR enrichment
  - authored PR counters
  - pending review request attribution tied to team-authored PRs
  - merge timing tied to roster-authored PRs
- Review extraction now always proceeds for qualifying roster reviewers, even when the PR author is external.

This preserves authored-PR semantics while fixing review-event correctness.

### 2. Carry author metadata and richer review classification through the pipeline

The shared types in [src/lib/types.ts](src/lib/types.ts) were expanded so the dashboard can represent:

- PR/review `author`
- `authored-by-self`
- `authored-by-them`
- `authored-external`
- `uniqueReviewedPrs`
- `reviewSelfAuthored`
- `reviewTeamAuthored`
- `reviewExternalAuthored`

The same model is used consistently in:

- [src/lib/dashboard.ts](src/lib/dashboard.ts)
- [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)
- [src/lib/demo-data.ts](src/lib/demo-data.ts)

### 3. Update the reviews UI to reflect the corrected model

The reviews page now displays the richer split and related metadata in:

- [src/components/charts.tsx](src/components/charts.tsx)
- [src/components/reviewed-prs-table.tsx](src/components/reviewed-prs-table.tsx)
- [src/lib/dashboard-views.ts](src/lib/dashboard-views.ts)

A small table fix was also applied so the reviewed PR empty state spans all rendered columns.

## Regression coverage

A dedicated test was added in [tests/github.test.ts](tests/github.test.ts).

The test mocks:

- one externally authored PR returned by search,
- PR detail with `user.login = "external-author"`, and
- one in-range `APPROVED` review submitted by `alice`.

It verifies that the collector now returns:

- `summary.reviewsSubmitted === 1`
- `summary.uniqueReviewedPrs === 1`
- `reviewSources.externalAuthored === 1`
- reviewer metrics updated for `alice`
- a `review` activity item with `author: "external-author"` and `reviewedPrKind: "authored-external"`

Helper expectations were also updated in [tests/dashboard-helpers.test.ts](tests/dashboard-helpers.test.ts) to match the new review-source model and unique reviewed PR summary.

## Validation

The following commands passed after the fix:

- `npm.cmd test`
- `npm.cmd run lint`
- `npm.cmd run build`

## Prevention strategies

- Separate PR-author enrichment from review extraction in the collector.
- Keep review classification in one place so self/team/external logic is not reimplemented inconsistently.
- Treat a missing roster author as a non-fatal condition for review extraction.
- Add regression tests for all three review-source buckets: self, teammate, and external.
- Track skipped review reasons explicitly instead of silently exiting early.

## Recommended test cases going forward

- Roster reviewer on external-authored PR → counted as `authored-external`
- Roster reviewer on teammate-authored PR → counted as `authored-by-them`
- Roster reviewer on self-authored PR → counted as `authored-by-self`
- Multiple reviews on the same PR → `reviewsSubmitted` increments, `uniqueReviewedPrs` remains deduplicated
- Non-roster reviewer on eligible PR → ignored
- Missing or out-of-range `submitted_at` → ignored without affecting valid reviews on the same PR

## Related references

- [todos/001-pending-p1-external-pr-reviews-still-skipped.md](todos/001-pending-p1-external-pr-reviews-still-skipped.md)
- [todos/002-pending-p2-missing-review-split-regression-tests.md](todos/002-pending-p2-missing-review-split-regression-tests.md)
- [todos/003-pending-p2-review-detail-cap-misses-older-prs.md](todos/003-pending-p2-review-detail-cap-misses-older-prs.md)
- [docs/plans/2026-03-10-feat-zephyr-team-activity-dashboard-plan.md](docs/plans/2026-03-10-feat-zephyr-team-activity-dashboard-plan.md)
- [docs/plans/2026-03-10-feat-split-dashboard-activity-pages-plan.md](docs/plans/2026-03-10-feat-split-dashboard-activity-pages-plan.md)

## Key takeaway

If the product question is "what reviews did the team submit", the collector must be keyed to reviewer eligibility, not PR author membership. The bug happened because those two concepts were accidentally coupled in the live detail loop.
