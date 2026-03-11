---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, correctness, github, reviews]
dependencies: []
---

# External-authored PR reviews are still skipped in live collection

The change intends to include review activity from PRs authored outside the team roster, but the live collector still drops those PRs before review processing. This means the user-visible bug is not actually fixed for live refreshes.

## Findings

- In `src/lib/github.ts`, `reviewDetailTargets` is now built from `allPrItems`, which correctly broadens the candidate set to team-authored and external-authored PRs.
- In the same detail loop, the code still does `const contributor = contributorMap.get(item.user.login.toLowerCase()); if (!contributor) continue;` before any review extraction.
- For external-authored PRs, `item.user.login` is not in the roster, so the loop exits early and never reaches `rangedTeamReviews`, `reviewSources.externalAuthored`, or review-row creation.
- This directly contradicts the requested behavior: "review activities be also considered even it is from external authored pr".

## Proposed Solutions

### Option 1: Separate author-specific PR enrichment from review extraction

**Approach:** Only gate PR-author metrics (`draftPrs`, authored PR counters, pending review request attribution to team-authored PRs) on roster membership, but always execute review extraction for roster reviewers on any PR in `reviewDetailTargets`.

**Pros:**
- Fixes the user-reported bug directly
- Preserves authored-PR metrics semantics
- Minimal behavior change outside review extraction

**Cons:**
- Requires careful branching in the detail loop
- Needs tests to avoid regressions

**Effort:** 1-2 hours

**Risk:** Medium

---

### Option 2: Split the detail loop into two passes

**Approach:** One pass for team-authored PR enrichment, another pass for review-event extraction over all detail targets.

**Pros:**
- Clearer responsibilities
- Easier to reason about team-author vs reviewer logic

**Cons:**
- More refactor churn
- Slightly more code movement

**Effort:** 2-4 hours

**Risk:** Medium

## Recommended Action


## Technical Details

**Affected files:**
- `src/lib/github.ts` - early `continue` on non-roster PR authors blocks review extraction for external-authored PRs

**Related components:**
- Review summary cards
- Review split chart
- Review activity table
- Live refresh path

**Database changes (if any):**
- Migration needed? No

## Resources

- **Branch:** `feat/zephyr-dashboard`
- **User request:** include review activities from external-authored PRs
- **Relevant file:** `src/lib/github.ts`

## Acceptance Criteria

- [ ] Live collection includes review rows for roster reviewers on external-authored PRs
- [ ] `reviewSources.externalAuthored` increments when applicable
- [ ] Review summary cards and table show external-authored data after live refresh
- [ ] Tests cover at least one external-authored PR review scenario

## Work Log

### 2026-03-11 - Initial Discovery

**By:** GitHub Copilot

**Actions:**
- Reviewed the `reviewDetailTargets` expansion in `src/lib/github.ts`
- Traced the detail loop and found an early roster-author guard
- Confirmed the guard prevents external-authored PRs from contributing reviews

**Learnings:**
- The candidate set was widened, but the loop still assumes the PR author is on the roster
- The bug is in the live path, not only in rendering

## Notes

- This is a merge-blocking correctness issue because it leaves the requested feature incomplete.
