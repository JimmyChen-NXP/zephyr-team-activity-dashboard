---
title: fix: Restore roster activity capture under search caps
type: fix
status: completed
date: 2026-03-12
---

# fix: Restore roster activity capture under search caps

## Overview

Fix the live collector so roster issue activity, roster-authored PR activity, and roster-submitted review/comment activity are captured correctly even when org-wide GitHub Search results are large enough to be capped, sampled, or truncated.

The visible bug is on the PR page, but the failure originates earlier in the live collection path. The page summary is derived from PR-scoped `activityItems`, so if merged PRs never make it into the collected team dataset, the UI confidently renders a false zero.

The same pattern also affects review/comment activity. The collector chooses which PRs deserve review-detail fetches from the same org-wide sampled candidate set, so valid roster review rows can disappear before review extraction runs.

The issues path is exposed to the same risk. Open and closed issues are collected through org-wide issue searches and only later filtered by roster assignee, so roster-assigned issues can also disappear before issue activity rows are created.

The search-cap warning seen on the page is part of the same failure mode. The current collector asks GitHub for org-wide PR results first and only afterward filters to the roster, so the code is spending its result budget on unrelated PRs before it decides which items belong to the team.

## Problem Statement / Motivation

Direct GitHub search confirmed that merged PRs exist in the last 30 days for authors present in `upstream_member.csv`, but the PR page still reports `0` merged PRs. The same collector shape can also undercount roster review activity, especially comment-only reviews, because review extraction is only attempted for PRs that survive the earlier org-wide sampling pass. Issue metrics appear to have the same structural weakness because team issue rows are derived from org-wide issue search results after late assignee filtering.

The most likely cause is the current collection strategy in [src/lib/github.ts](src/lib/github.ts):

- merged PRs are queried with broad org-wide GitHub Search
- open and closed issues are queried with broad org-wide GitHub Search
- PR review detail targets are also selected from broad org-wide PR search results
- the roster filter is applied afterward
- the dashboard then rebuilds PR summaries from the filtered `activityItems`

That means two separate classes of valid team activity can disappear before aggregation:

- roster-assigned open or closed issues can be excluded before issue rows are created if team issues do not appear in the sampled org-wide issue result pages
- roster-authored merged PRs can be excluded before they ever reach PR-page aggregation if the org-wide search window is sampled, capped, or ordered such that team-authored merged PRs do not appear in the first collected pages
- roster-submitted reviews, including comment-only reviews, can be excluded if the reviewed PR is not selected into `reviewDetailTargets`

The warning currently emitted by [src/lib/github.ts](src/lib/github.ts) is therefore not incidental. It is strong evidence that the collector is answering the wrong question first:

- current question: "Which issues and PRs across the whole org match this broad state/date query?"
- actual dashboard questions:
   - "Which issues assigned to this roster should count?"
   - "Which PRs authored by this roster should count?"
   - "Which PRs need review-detail fetches because this roster reviewed them or was asked to review them?"

When those are treated as the same query, correctness depends on org-wide result ordering, which is not an acceptable invariant for a team dashboard.

This is consistent with:

- metric definitions in [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md), which define merged PRs as PRs authored by roster members and merged during the selected range
- the prior broader fix plan in [docs/plans/2026-03-11-fix-range-based-pr-and-issue-counting-plan.md](docs/plans/2026-03-11-fix-range-based-pr-and-issue-counting-plan.md)
- the prior collector-learning pattern in [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md), where broad candidate selection plus later filtering silently dropped valid activity

## Local Research Summary

### Relevant code path

- Issues page route: [src/app/issues/page.tsx](src/app/issues/page.tsx)
- PR page entry: [src/app/pull-requests/page.tsx](src/app/pull-requests/page.tsx)
- View-level recomputation: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- PR summary cards and PR-view aggregation: [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)
- Filtered dashboard recomputation: [src/lib/dashboard-filtering.ts](src/lib/dashboard-filtering.ts)
- Live GitHub collection: [src/lib/github.ts](src/lib/github.ts)
- Review page route: [src/app/reviews/page.tsx](src/app/reviews/page.tsx)
- Snapshot generation: [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts)

### Current behavior from code

- `collectLiveDashboard()` performs broad org-wide searches for open and closed issues and only later filters by roster assignee.
- The PR page does not render the raw live summary directly; it calls `buildViewDashboardData()` and uses PR-only `activityItems` to recompute the visible summary.
- `collectLiveDashboard()` performs broad org-wide searches for merged PRs and only later filters to roster authors.
- `collectLiveDashboard()` also builds `reviewDetailTargets` from all sampled PR items before review extraction runs, so review/comment activity is only visible if the parent PR survived the earlier org-wide sampling pass.
- Existing tests validate merged PR counting in a small happy-path mock, but they do not cover the large-org sampling failure mode where relevant merged PRs are outside the sampled org-wide result pages.
- Existing tests also do not cover the case where a roster member submitted a valid review/comment on a PR that never entered the sampled detail-target set.
- Existing tests do not cover the case where a roster-assigned issue is absent from sampled org-wide issue search results.

### External research findings

GitHub's Search API behavior reinforces the local diagnosis:

- Search returns at most 100 results per page and up to 1,000 results per query.
- Search queries can also return `incomplete_results=true` when GitHub times out while building the result set.
- Search rate limits are stricter than the normal REST API budget, so any fix that increases query count must still be deliberate.
- Query construction has practical limits, including query-length and boolean-operator limits, so a roster-focused strategy cannot safely be "one giant OR query for every login" when the roster is large.

Those constraints make the current org-wide-first search especially fragile for large organizations: it is easy to hit the 1,000-result ceiling before roster filtering ever runs.

## Proposed Solution

Make issue, PR, and review candidate selection roster-correct before view aggregation runs.

### Core approach

1. Replace the current org-wide-first candidate strategy with roster-aware or otherwise team-safe aggregation paths.
2. Ensure issue qualification is based on:
   - at least one assignee login in `upstream_member.csv`
   - issue state and timestamps matching the current metric definition
3. Ensure merged PR qualification is based on:
   - authored by a login in `upstream_member.csv`
   - merged during the selected range
4. Ensure review/comment qualification is based on:
   - review submitted by a login in `upstream_member.csv`
   - review submission timestamp within the selected range
   - the reviewed PR being discoverable through a team-safe candidate path rather than only through sampled org-wide results
5. Build issue, PR, and review `activityItems` from those corrected team candidate sets so page summaries, tables, and repo activity all inherit the correct counts.
6. Add regression tests that specifically reproduce the current false-zero and missed-activity scenarios.
7. Surface a degraded-data warning if GitHub search cannot confidently answer the team-activity question, rather than showing definitive low counts without context.

### Query strategy recommendation

The collector should stop relying on broad org-wide search queries as the source of truth for team metrics.

Preferred direction:

1. collect issue candidates with assignee-scoped queries, using bounded assignee chunks or per-login queries for:
   - open assigned issues
   - closed issues in range
2. collect authored-PR candidates with author-scoped queries, using bounded author chunks or per-login queries for:
   - open authored PRs
   - merged PRs in range
   - closed-unmerged PRs in range
3. collect review-detail targets with reviewer-scoped PR queries rather than only from authored-PR candidates, using bounded queries built from GitHub qualifiers such as:
   - `reviewed-by:` for completed reviews
   - `review-requested:` for pending review requests
   - `commenter:` or `involves:` only if needed to close gaps that `reviewed-by:` does not cover reliably
4. merge and deduplicate the returned issue and PR candidates across chunks
5. classify issue metrics from team issue candidates, authored-PR metrics from team-authored PR candidates, and review/comment activity from reviewer-discovery PR candidates after detail fetch and timestamp filtering
6. keep explicit warnings when chunking still produces partial or incomplete results

The critical design decision is that authored-PR discovery and review-target discovery are related but not identical. A reviewer can legitimately contribute to an external-authored PR, so review extraction cannot depend only on authored-by-roster PR candidates.

This directly answers the open design question from the bug report:

- yes, the org-wide search followed by roster filtering is a likely reason the collector reaches GitHub Search caps and misses valid team issues and PRs
- yes, the same org-wide candidate selection likely explains why some roster review/comment activities are also missed
- yes, the query should be made more roster-focused
- no, the fix should not be a single massive roster query; it should use bounded per-metric queries because GitHub Search also limits query length and boolean operators

## Proposed Search Optimization (2026-03-12)

To reduce rate-limit usage and improve accuracy, update the issue search logic:

- For open issues:
  - Search only issues where the assignee is in the roster and the status is not resolved.
- For non-open issues:
  - Search only issues where the assignee is in the roster and the issue was updated in the past 30 days.

This narrows the search scope to relevant issues, avoids fetching old or unrelated data, and minimizes unnecessary API requests.

## PR and Review Search Optimization (2026-03-12)

- PRs:
  - Search for PRs authored by roster members.
    - Open PRs: author in roster, status is open (not merged/closed).
    - Merged/closed PRs: author in roster, status is merged or closed.
- Reviews:
  - Search for review activity where reviewer is in roster and review happened in the last 30 days.
- All queries are restricted to a maximum range of 30 days (no last 90 days).

## Implementation Steps
- Update collector logic in src/lib/github.ts to compile search queries as above.
- Validate with tests and runtime logs.
- Update documentation if needed.

## Technical Considerations

### 1. Define the collection invariant

The implementation should explicitly guarantee this invariant:

> If a roster member authored a PR that was merged during the selected range, the PR page must count it even when unrelated org activity is high.

> If a roster member submitted a qualifying review during the selected range, the reviews dataset must capture it even when the reviewed PR would not have appeared in the first sampled org-wide search pages.

> If a roster member is assigned to a qualifying issue, the issues dataset must capture it even when unrelated org issue volume is high.

> If a roster member reviews an external-authored PR, that review must still be discoverable even though the PR would not appear in an authored-by-roster query.

Without that invariant, changing search limits or page ordering can reintroduce the bug.

An equivalent negative statement is also useful:

> Unrelated org activity must not be able to push qualifying roster issues, PRs, or review targets out of the collector's candidate set.

### 2. Fix the collector, not just the page

The UI is behaving consistently with its inputs. The visible PR-page zero, missing review/comment rows, and any missing issue rows are downstream symptoms of collector misses. The fix should therefore target [src/lib/github.ts](src/lib/github.ts) first, not only [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts).

Concretely, the issue candidate search path, PR candidate search path, and review-detail target selection should be changed before any attempt to adjust summary-card math or page-level rendering.

### 3. Preserve cross-layer consistency

The following must agree for the same filters:

- live collector summary
- filtered dashboard summary
- issues-page summary cards and issue rows
- PR-view summary cards
- PR detail table rows
- reviews-page summary cards and review rows
- snapshot-generated PR page

Any fix that only patches one of those surfaces will create a second correctness bug.

The highest-risk inconsistency is between authored-PR metrics and review metrics. If authored PRs become roster-aware but review target selection still depends on broad org sampling, the dashboard will keep showing internally inconsistent team activity.

### 4. Author matching rules must be explicit

Use case-insensitive login matching against `upstream_member.csv`, since roster data is login-based and current filtering already normalizes logins to lowercase.

### 5. Partial-data behavior must be explicit

If GitHub Search is capped, incomplete, or rate-limited, the app should not silently render missing issue counts, `Merged PRs = 0`, or undercounted review/comment totals as if those results were definitive. A warning or degraded-data state should remain visible.

The warning should also describe why confidence is reduced. "Search cap reached" is useful for debugging, but the user-facing meaning is: "team totals may be incomplete because the collector could not exhaust the relevant candidate set."

### 6. Query-shape constraints must be explicit

Any roster-focused implementation needs to respect GitHub Search constraints:

- max 100 results per page
- max 1,000 results per query
- stricter search-specific rate limits
- query-length and boolean-operator limits

That means the implementation should choose one of these bounded strategies deliberately:

- chunk roster identities into safe search groups
- keep issue, authored-PR, and review-target discovery as separate query families rather than forcing one shared query shape
- partition by date windows when a chunk is still too large
- fall back to another collector path only if search confidence cannot be guaranteed after chunking

What should be avoided is an unbounded org-wide query whose correctness depends on result ordering.

## System-Wide Impact

- **Interaction graph**: [src/lib/dashboard.ts](src/lib/dashboard.ts) calls `collectLiveDashboard()`, then [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) calls `buildViewDashboardData()`, which in turn drives issues, PR, and review summary cards and detail rows.
- **Error propagation**: a collector change can increase GitHub request volume and may interact with existing search throttling in [src/lib/github.ts](src/lib/github.ts).
- **State lifecycle risks**: if issue or authored-PR capture is fixed but review-target selection stays on the old path, the three activity views can disagree about the same underlying team activity.
- **API surface parity**: live mode and generated snapshots must both reflect the same corrected semantics, which means [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts) must continue to rely on the same fixed collector behavior.
- **Integration test scenarios**: the test matrix needs to cover collector behavior, aggregation behavior, and degraded-data signaling.

## Manual Spec-Flow Analysis

No dedicated SpecFlow tool is available in this workspace flow, so this plan includes the required gap analysis directly.

### Key spec gaps to close during implementation

- exact issue qualification semantics for roster-assigned open and closed issues under the selected range
- exact merged-range boundary semantics (`from` and `to` inclusive)
- exact review submission boundary semantics (`submitted_at` inclusive of both range ends)
- expected behavior when GitHub Search returns incomplete or capped results
- whether `reviewed-by:` is sufficient for review-target discovery in practice or whether `review-requested:`, `commenter:`, or `involves:` are also required
- how chunk sizing should be chosen so query construction stays inside GitHub Search limits without exploding request volume

### Edge cases to cover

- roster-assigned issue exists only outside the first sampled org-wide issue pages
- roster-authored merged PR exists only outside the first sampled org-wide pages
- roster-submitted commented review exists on a PR that would be absent from sampled org-wide pages
- roster-submitted review exists on an external-authored PR and must still be discovered by the review-target path
- merged PR timestamp falls exactly on the range boundary
- review submission timestamp falls exactly on the range boundary
- author login case differs from roster CSV case
- roster is large enough that one roster-focused query would exceed GitHub Search query constraints
- one roster chunk returns `incomplete_results=true` and the dashboard must warn instead of presenting a definitive total
- one query family succeeds while another is partial, and the warning model must not overstate confidence for the whole dataset
- no merged PRs exist and the UI should show a real zero
- merged PRs exist but the collector is partial/incomplete and must warn instead of silently zeroing out

## Acceptance Criteria

- [x] The Issues page counts roster-assigned issues according to the metric definition in [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md) without depending on unrelated org-wide issue result ordering.
- [x] The Pull Requests page counts merged PRs authored by roster members during the selected range, using the metric definition in [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md).
- [x] The merged PR count is no longer dependent on unrelated org-wide result ordering or whether roster PRs appear in the first sampled merged-PR pages.
- [x] Issue and PR collectors use roster-aware query strategies that stay within documented GitHub Search constraints instead of depending on broad org-wide queries.
- [x] Review/comment activity submitted by roster members is discovered through a reviewer-aware target path and is no longer dependent on whether the reviewed PR appeared in the first sampled org-wide detail-target pages.
- [x] Reviews on external-authored PRs remain discoverable after the collector is made roster-aware.
- [x] Issue, PR, and review `activityItems`, contributor rows, repo activity, and summary cards all reflect the same corrected team activity totals.
- [x] Live mode and snapshot mode both show the corrected roster-scoped activity counts for the same underlying dataset.
- [x] Case-insensitive login matching against `upstream_member.csv` is preserved.
- [x] When one or more query families return incomplete, capped, or otherwise degraded results, the UI surfaces a warning instead of silently presenting a definitive false zero or undercount.
- [x] Regression tests cover issue, PR, and review discovery under org-scale sampling pressure, plus range-boundary and degraded-data cases.

## Success Metrics

- The issues dataset no longer omits qualifying roster-assigned issues solely because unrelated org-wide issue results consumed the search budget.
- The PR page no longer shows `0` merged PRs when qualifying merged PRs exist for roster members.
- The reviews dataset no longer omits qualifying roster comment/review activity solely because the parent PR was absent from org-wide sampled candidates.
- Reviews on external-authored PRs remain represented after the collector switches away from org-wide PR sampling.
- A direct GitHub verification for the active range matches the dashboard’s merged PR count for sampled test fixtures.
- Regression coverage prevents reintroduction of collector misses caused by broad candidate selection followed by late roster filtering.
- The collector warning rate drops on high-activity org ranges because irrelevant org-wide results are no longer consuming the query budget.

## Dependencies & Risks

### Dependencies

- issues-page rendering in [src/app/issues/page.tsx](src/app/issues/page.tsx)
- live collector behavior in [src/lib/github.ts](src/lib/github.ts)
- PR-view aggregation in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)
- filtered recomputation in [src/lib/dashboard-filtering.ts](src/lib/dashboard-filtering.ts)
- reviews-page rendering in [src/app/reviews/page.tsx](src/app/reviews/page.tsx)
- snapshot generation in [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts)

### Risks

- Team-scoped querying may increase request count and interact with search-specific rate limits.
- Fixing one activity type at a time could create new inconsistencies between issues, PRs, and reviews surfaces.
- Existing tests may pass while still missing large-org search ordering regressions.
- Poor chunk sizing could replace one failure mode with another if queries exceed search syntax limits.
- A review-target strategy that only follows authored PRs would regress external-authored review coverage.

### Mitigations

- centralize chunking, deduplication, and warning helpers, but keep review-target discovery logically separate from authored-PR discovery
- add one regression test that specifically simulates roster PRs falling outside early org pages
- add one regression test that specifically simulates roster issues falling outside early org pages
- add one regression test that specifically simulates a roster review on an external-authored PR
- keep warning behavior explicit when data confidence is reduced
- make chunking deterministic and test it with a synthetic large-roster fixture

## Suggested Implementation Shape

### Phase 1: Correct team issue and PR candidate selection

- decide and implement roster-aware issue and PR query/aggregation paths in [src/lib/github.ts](src/lib/github.ts)
- introduce chunking or partitioning helpers if roster-focused search needs bounded query groups
- deduplicate results before metrics and `activityItems` are built
- keep review-target discovery separate from authored-PR discovery so external-authored reviewed PRs remain discoverable

Implementation note: the shared abstraction should be query execution, chunking, deduplication, and warning aggregation. The discovered candidate sets themselves should remain separate by metric family.

Recommended order inside this phase:

1. replace issue discovery with assignee-scoped queries
2. replace authored-PR discovery with author-scoped queries
3. replace review-target discovery with reviewer-aware PR queries
4. deduplicate overlapping PR targets before detail fetches

### Phase 2: Align downstream aggregation

- verify `buildViewDashboardData()` and `filterDashboardData()` preserve corrected issue, PR, and review counts without introducing divergent totals
- confirm issue summary cards, PR summary cards, review summary cards, and detail tables read the corrected activity sets

### Phase 2.5: Preserve degraded-data semantics

- ensure search-cap, incomplete-result, and rate-limit signals still surface after the new query strategy is introduced
- keep warnings attributable to the affected query family when possible so a partial review-target path does not masquerade as a fully trusted dataset
- confirm the UI only shows a definitive zero when the collector had sufficient confidence to conclude there were no matching roster activities for that metric

### Phase 3: Add regression coverage and validation

- extend [tests/github.test.ts](tests/github.test.ts) with the large-org false-zero scenario
- add coverage for chunked roster queries and degraded-data warnings
- add coverage for missed issue activity when a roster-assigned issue would be absent from sampled org-wide pages
- add coverage for missed comment-only review activity when the parent PR would be absent from org-wide sampled pages
- add coverage for reviews on external-authored PRs after the roster-aware collector change
- extend [tests/dashboard-helpers.test.ts](tests/dashboard-helpers.test.ts) if needed for PR-view aggregation consistency
- validate snapshot generation assumptions in [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts)

## Sources & References

### Internal References

- issues page route: [src/app/issues/page.tsx](src/app/issues/page.tsx)
- PR page route: [src/app/pull-requests/page.tsx](src/app/pull-requests/page.tsx)
- reviews page route: [src/app/reviews/page.tsx](src/app/reviews/page.tsx)
- dashboard shell: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- view aggregation: [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)
- filter recomputation: [src/lib/dashboard-filtering.ts](src/lib/dashboard-filtering.ts)
- live GitHub collection: [src/lib/github.ts](src/lib/github.ts)
- metrics definition: [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md)
- snapshot generation: [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts)
- collector regression tests: [tests/github.test.ts](tests/github.test.ts)
- helper aggregation tests: [tests/dashboard-helpers.test.ts](tests/dashboard-helpers.test.ts)

### Related Work

- broader prior plan: [docs/plans/2026-03-11-fix-range-based-pr-and-issue-counting-plan.md](docs/plans/2026-03-11-fix-range-based-pr-and-issue-counting-plan.md)
- related collector learning: [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md)

### External References

- GitHub REST Search docs: https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#search-issues-and-pull-requests
- GitHub REST rate-limit docs: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28

## AI-era Notes

- This plan is grounded in local repository analysis and validated against current GitHub Search API constraints, because the root bug is internal but the safe fix depends on respecting external search limits.
- Human review should focus on whether the chosen collector invariant is strong enough to make the PR page robust under high org-wide activity, not just under small mocked datasets.