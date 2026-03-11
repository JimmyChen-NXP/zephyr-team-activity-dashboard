---
status: pending
priority: p2
issue_id: "003"
tags: [code-review, performance, architecture, github, reviews]
dependencies: []
---

# Review detail cap can silently miss external-authored review activity

The collector now inspects review details from `allPrItems`, but still slices the candidate set with a global `REVIEW_DETAIL_LIMIT`. On busy orgs, this can silently drop older or lower-ranked PRs, including external-authored PRs that are now part of the requested behavior.

## Findings

- `src/lib/github.ts` builds `reviewDetailTargets` from `allPrItems` and immediately applies `slice(0, REVIEW_DETAIL_LIMIT)`.
- The underlying search results are already capped and ordered by GitHub search queries, not by "has team review activity".
- Expanding from team-authored PRs to all PRs increases the chance that relevant reviewed PRs fall outside the detail window.
- There is no explicit warning when `reviewDetailTargets` is truncated by `REVIEW_DETAIL_LIMIT`, so coverage loss is silent.

## Proposed Solutions

### Option 1: Emit a warning when the detail target set is truncated

**Approach:** Keep the cap, but detect truncation and surface a warning in `warnings` / sync health.

**Pros:**
- Small change
- Makes partial coverage visible to users

**Cons:**
- Does not improve coverage by itself

**Effort:** 30-60 minutes

**Risk:** Low

---

### Option 2: Prioritize detail targets likely to contain team reviews

**Approach:** Rank or partition detail targets so likely relevant PRs are inspected first, rather than taking the raw first N from org-wide search results.

**Pros:**
- Better coverage within the same budget
- More aligned with product intent

**Cons:**
- More heuristic logic
- Harder to validate

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 3: Support pagination for review detail collection with configurable limits

**Approach:** Make the cap configurable and optionally process more detail targets in the live path.

**Pros:**
- Higher fidelity
- More future-proof for large orgs

**Cons:**
- More API traffic and latency
- May need rate-limit safeguards

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action


## Technical Details

**Affected files:**
- `src/lib/github.ts`

**Related components:**
- Live review collection
- Warnings and sync health panel

**Database changes (if any):**
- Migration needed? No

## Resources

- **Branch:** `feat/zephyr-dashboard`
- **Config:** `REVIEW_DETAIL_LIMIT`

## Acceptance Criteria

- [ ] The app warns when review detail collection is truncated
- [ ] Review coverage behavior is documented or improved for large orgs
- [ ] External-authored review inclusion does not silently regress due to truncation

## Work Log

### 2026-03-11 - Initial Discovery

**By:** GitHub Copilot

**Actions:**
- Reviewed the new `REVIEW_DETAIL_LIMIT` behavior after broadening review detail targets
- Assessed how the fixed cap interacts with org-wide PR candidate expansion

**Learnings:**
- The new behavior improves scope, but increases the chance of silent truncation
- Users currently get no signal when the detail cap hides review activity

## Notes

- This is not a correctness blocker for small datasets, but it is a reliability risk for larger org activity windows.
