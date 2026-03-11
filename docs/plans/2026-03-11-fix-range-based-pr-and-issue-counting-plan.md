---
title: fix: Count in-range PR and issue activity correctly
type: fix
status: completed
date: 2026-03-11
---
# fix: Count in-range PR and issue activity correctly

## Overview

Fix the live dashboard collector so the PR and Issues pages count activity that happened within the selected range, not just items that are currently open or happen to survive org-wide sampling.

Today the dashboard correctly shows some current-state signals, but it undercounts or misses:

- merged PRs in range
- closed-unmerged PRs in range
- draft PRs that were active in range
- issues closed in range
- contributor and repo totals derived from those missing records

The result is a misleading PR page where open PRs dominate while merged counts can show as `0`, plus an Issues page that effectively behaves like an "open assigned issues" report rather than a range-based activity report.

## Problem Statement / Motivation

The current live collector in [src/lib/github.ts](src/lib/github.ts#L314-L699) combines two different concepts:

1. **current-state inventory** — for example, open assigned issues and open authored PRs
2. **range-based activity** — for example, PRs merged during the selected window or issues closed during the selected window

That mix leads to correctness problems.

### What the current implementation does

- PR collection starts with four org-wide searches in [src/lib/github.ts](src/lib/github.ts#L337-L342): open issues, open PRs, merged PRs in range, and closed-unmerged PRs in range.
- Issues are only counted from `openIssuesResult` via `teamOpenIssues` in [src/lib/github.ts](src/lib/github.ts#L357-L391), so closed issues in range are never represented.
- Merged and closed PR searches are org-wide and page-limited before the roster filter is applied, then team PRs are filtered later in [src/lib/github.ts](src/lib/github.ts#L394-L446).
- PR and issue summary cards on the activity pages are built directly from these collected metrics in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts#L188-L203).

### Why that causes bad numbers

- **Closed issues are dropped by design** because there is no matching in-range closed-issue search path.
- **Merged and closed PRs can be missed** because the collector samples the first few pages of org-wide results, then filters to roster authors afterward. In a large org, roster-authored PRs can be absent from those sampled pages even when they exist in the selected range.
- **Draft/open/merged semantics are inconsistent** because draft status is enriched later from PR detail in [src/lib/github.ts](src/lib/github.ts#L473-L480), while the base candidate set is still driven by mixed current-state and sampled historical queries.
- **Page UI wording suggests range reporting**, but the Issues page summary still labels the lead metric as "Open assigned issues" in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts#L191-L195), which matches current-state inventory more than range activity.

This matters because the dashboard is intended to answer "what happened in the selected range" for team activity, not just "what is open right now".

## Local Research Summary

### Repo patterns

- Live collection and normalization are centralized in [src/lib/github.ts](src/lib/github.ts#L314-L699).
- View-specific summaries and contributor/repo tables are recomputed from `activityItems` in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts#L59-L185).
- Shared metrics contracts live in [src/lib/types.ts](src/lib/types.ts#L26-L116).
- Current regression coverage is narrow and only validates external-authored review counting in [tests/github.test.ts](tests/github.test.ts#L22-L101).

### Relevant institutional learning

The prior solution note [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md) shows an important pattern: when collector candidate selection and later filtering use different assumptions, valid activity silently disappears. That same class of mistake is happening here, except with org-wide search sampling and range semantics rather than reviewer/author coupling.

### Research decision

Strong local context exists and the bug is in existing repository logic, so external research is not necessary for the plan.

## Proposed Solution

Refactor the live collector so PR and issue activity is modeled explicitly as **range-qualified events** and **current-state inventory**, then ensure the Issues and Pull Requests pages consume the correct event set.

### Core approach

1. **Split issue collection into separate buckets**
   - current open assigned issues
   - issues created in range for roster assignees (if supported by product scope)
   - issues closed in range for roster assignees

2. **Split PR collection into separate buckets keyed by roster authors first, not org-wide samples first**
   - open authored PRs
   - draft authored PRs
   - merged PRs in range
   - closed-unmerged PRs in range

3. **Build `activityItems` from normalized event buckets**
   - every counted issue/PR state should produce a corresponding activity item with the correct metric delta
   - summary cards, contributor rows, and repo activity should continue to derive from `activityItems`

4. **Clarify metric semantics in page-level summaries**
   - preserve current-state metrics where intentionally current-state
   - rename or extend summary labels when the page is intended to represent range totals

5. **Add regression tests for range correctness and sampling resistance**
   - specifically cover merged PRs and closed issues in the selected window
   - cover scenarios where org-wide sampling would previously have hidden roster activity

## Technical Considerations

### Collector design changes

#### 1. Query strategy should align with roster-first counting

The collector currently performs org-wide searches, then filters to roster authors later. For range-sensitive counts, the safer pattern is:

- query by roster author/assignee where possible
- aggregate across roster members
- deduplicate by PR/issue URL or API URL
- only apply caps/warnings after team-scoped aggregation decisions are visible

This avoids the current failure mode in [src/lib/github.ts](src/lib/github.ts#L337-L342) and [src/lib/github.ts](src/lib/github.ts#L394-L446), where the first few org-wide pages may not contain the team’s merged/closed items.

#### 2. Issue metrics need explicit closed-in-range support

The issue flow in [src/lib/github.ts](src/lib/github.ts#L357-L391) currently only increments `openAssignedIssues`. The plan should add explicit treatment for:

- issue closed in range
- optionally issue opened in range
- stale/open logic only for currently open issues

If product scope keeps "open assigned issues" as a current-state KPI, that is fine — but the Issues page must also include closed-in-range activity if the page is meant to reflect selected-range work.

#### 3. PR metrics need event-accurate categorization

PR counts should be computed from normalized PR records with explicit booleans/timestamps:

- `isOpenNow`
- `isDraftNow`
- `mergedAtInRange`
- `closedUnmergedAtInRange`
- `createdAtInRange` if needed for detail rows

That avoids overloading `item.state` and later detail enrichment as happens in [src/lib/github.ts](src/lib/github.ts#L408-L446) and [src/lib/github.ts](src/lib/github.ts#L473-L480).

#### 4. Types and summaries may need expansion

Current types in [src/lib/types.ts](src/lib/types.ts#L26-L116) support:

- `openAssignedIssues`
- `openAuthoredPrs`
- `draftPrs`
- `mergedPrs`
- `closedUnmergedPrs`

The likely gap is not missing fields but missing semantics. The implementation should decide whether to:

- keep existing field names and document that some are current-state while others are range-based, or
- introduce clearer names for issue counters on the Issues page (for example, `closedIssues` or `issuesTouchedInRange`) if the UX needs less ambiguity

#### 5. Summary-card copy must match data semantics

Current copy in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts#L188-L203) still emphasizes open-state counts. After the fix, update labels/formulas so users are not told they are seeing one thing while the data represents another.

## System-Wide Impact

- **Interaction graph**: `getDashboardData()` calls `collectLiveDashboard()` in [src/lib/dashboard.ts](src/lib/dashboard.ts#L95-L110), which feeds `activityItems`, contributor metrics, repo activity, and summary cards. A collector change therefore affects all three activity pages and snapshot generation.
- **Error propagation**: more team-scoped queries may increase request count; rate-limit handling added recently in [src/lib/github.ts](src/lib/github.ts) must remain compatible with the new query pattern.
- **State lifecycle risks**: if one bucket (for example merged PRs) fails while open PRs succeed, the dashboard can become internally inconsistent unless partial-data warnings name which bucket was incomplete.
- **API surface parity**: [src/app/issues/page.tsx](src/app/issues/page.tsx) and [src/app/pull-requests/page.tsx](src/app/pull-requests/page.tsx) both rely on the same normalized dashboard payload; semantics must remain consistent between live and snapshot modes.
- **Integration test scenarios**: team member with only merged PRs in range, team member with only closed issues in range, mixed draft/open transitions, and large-org sampling where the team item is not on the first org-wide search pages.

## SpecFlow-style gap analysis

A dedicated SpecFlow analyzer is not available in this workspace, so this plan includes a manual gap analysis instead.

### Key edge cases to cover

- PR opened before the range but merged inside the range → should count as merged in range
- PR opened in the range and still open → should count as open PR activity
- Draft PR switched to ready-for-review during the range → draft/open labeling should be deterministic and documented
- Issue opened before the range and closed inside the range → should count on the Issues page
- Issue assigned to a team member but later unassigned before close → assignment rule must be explicit
- Team activity hidden beyond org-wide sampled pages → roster-first aggregation must still count it

## Acceptance Criteria

- [x] The Pull Requests page counts roster-authored PRs in the selected range even when they are not present in the first sampled org-wide search pages.
- [x] `mergedPrs` is non-zero whenever qualifying roster-authored merged PRs exist in the selected range.
- [x] `closedUnmergedPrs` reflects roster-authored PRs closed without merge in the selected range.
- [x] Open and draft PR metrics are derived consistently from the normalized PR detail model.
- [x] The Issues page includes issues closed in the selected range when a roster member qualifies under the chosen issue-ownership rule.
- [x] Current-state issue metrics such as stale/open remain available where intended, but are no longer the only issue counts shown for a selected range.
- [x] `activityItems`, contributor rows, repo activity, and summary cards remain internally consistent for PR and issue totals.
- [x] Snapshot generation continues to succeed within GitHub API rate limits.
- [x] Regression tests are added for merged-in-range PRs, closed-in-range issues, and large-org sampling scenarios.
- [x] UI labels and metric documentation match the final semantics of each issue/PR counter.

## Success Metrics

- PR page no longer shows false-zero merged totals when roster-authored merged PRs exist in the selected window.
- Issues page shows closed-in-range activity that was previously absent.
- Test coverage includes at least one regression for each corrected bucket: open PR, draft PR, merged PR, closed-unmerged PR, open issue, closed issue.
- Partial-data warnings become more actionable when range counts are capped or incomplete.

## Dependencies & Risks

### Dependencies

- GitHub Search query strategy in [src/lib/github.ts](src/lib/github.ts)
- Dashboard aggregation behavior in [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts)
- Snapshot generation in [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts)
- Existing rate-limit/throttling behavior in [src/lib/github.ts](src/lib/github.ts)

### Risks

- Moving to roster-first queries can increase search request volume and require tighter throttling or lower per-query breadth.
- Changing metric semantics may require updates to docs, labels, and stakeholder expectations.
- If issue assignment semantics are not agreed upon, "closed issue" counts could still be disputed even after implementation.

### Mitigations

- Prefer normalized helper functions for "qualifies for range" decisions instead of spreading logic across loops.
- Emit bucket-specific warnings when search caps or incomplete results affect merged/closed counts.
- Keep current-state and range-based counters distinct in naming and UI copy.

## Suggested Implementation Shape

### Phase 1: Normalize semantics

- Document the exact meaning of each PR and issue counter.
- Decide which issue metrics are current-state only vs range-based.
- Decide ownership rule for counting a closed issue in range.

### Phase 2: Refactor collector

- Replace org-wide sampled merged/closed filtering with team-scoped aggregation.
- Add closed-issue-in-range collection.
- Build consistent PR and issue `activityItems` from normalized buckets.

### Phase 3: Update summaries and tests

- Update page summaries/formulas/labels where semantics changed.
- Add regression tests in [tests/github.test.ts](tests/github.test.ts) and any needed aggregate helper tests.
- Validate snapshot generation path and warning behavior.

## Sources & References

### Internal References

- Live collector: [src/lib/github.ts](src/lib/github.ts#L314-L699)
- PR/issue summary cards and contributor tables: [src/lib/dashboard-aggregates.ts](src/lib/dashboard-aggregates.ts#L188-L245)
- Shared metric types: [src/lib/types.ts](src/lib/types.ts#L26-L116)
- Dashboard loader: [src/lib/dashboard.ts](src/lib/dashboard.ts#L95-L110)
- Existing collector regression test: [tests/github.test.ts](tests/github.test.ts#L22-L101)
- Existing solution note about collector filtering mistakes: [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md)

### Related Work

- Base dashboard plan: [docs/plans/2026-03-10-feat-zephyr-team-activity-dashboard-plan.md](docs/plans/2026-03-10-feat-zephyr-team-activity-dashboard-plan.md)
- Activity-page split plan: [docs/plans/2026-03-10-feat-split-dashboard-activity-pages-plan.md](docs/plans/2026-03-10-feat-split-dashboard-activity-pages-plan.md)

## AI-era notes

- Initial exploration used GitHub Copilot to trace collector flow, compare summary derivation with activity-item derivation, and identify where org-wide search sampling was happening before roster filtering.
- Human review should focus on metric semantics, especially the exact ownership rule for counting closed issues in range and how draft/open PR states should appear when a PR changes state during the selected window.
