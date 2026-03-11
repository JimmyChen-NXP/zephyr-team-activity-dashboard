---
status: pending
priority: p2
issue_id: "002"
tags: [code-review, tests, quality, reviews]
dependencies: ["001"]
---

# Review split changes lack regression coverage

The new review model adds multi-select contributors, self/teammate/external review classification, unique reviewed PR counts, and live collection changes, but the test suite only covers helper-level happy paths. The core bug in the live collector slipped through because the new behavior is not protected.

## Findings

- `tests/dashboard-helpers.test.ts` validates helper parsing and one review aggregate case, but does not exercise `collectLiveDashboard()`.
- `src/lib/github.ts` now contains the most critical behavior changes: external-authored review inclusion, review-source classification, and unique reviewed PR derivation.
- `src/lib/demo-data.ts` also changed to synthesize `author`, `reviewedPrKind`, and external/self/teammate counters, but has no direct test coverage.
- Without collector-level tests, regressions in live refresh behavior can pass lint, build, and helper tests unnoticed.

## Proposed Solutions

### Option 1: Add focused collector unit tests with mocked GitHub responses

**Approach:** Add tests for `collectLiveDashboard()` that stub search/detail/review responses and assert self/teammate/external counts and unique reviewed PR totals.

**Pros:**
- Protects the highest-risk logic directly
- Reproduces the reported bug in a deterministic way
- Fast test runtime

**Cons:**
- Requires mocking multiple GitHub API calls
- Some setup overhead

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Add contract tests for both live and demo review shaping

**Approach:** Keep helper tests, and add dedicated tests for `collectLiveDashboard()` and `buildDemoDashboard()` output contracts.

**Pros:**
- Covers both live and fallback paths
- Documents expected review semantics more completely

**Cons:**
- More test code to maintain
- Slightly broader scope

**Effort:** 4-6 hours

**Risk:** Low

## Recommended Action


## Technical Details

**Affected files:**
- `src/lib/github.ts`
- `src/lib/demo-data.ts`
- `tests/dashboard-helpers.test.ts`
- new collector/demo tests as needed

**Related components:**
- Live refresh behavior
- Demo fallback behavior
- Review summary cards and contributor ranking

**Database changes (if any):**
- Migration needed? No

## Resources

- **Branch:** `feat/zephyr-dashboard`
- **Existing tests:** `tests/dashboard-helpers.test.ts`

## Acceptance Criteria

- [ ] Tests cover at least one external-authored PR review in the live collector path
- [ ] Tests cover self/teammate/external classification outputs
- [ ] Tests cover `uniqueReviewedPrs` derivation
- [ ] Tests cover demo fallback review shaping or justify why collector-only coverage is sufficient

## Work Log

### 2026-03-11 - Initial Discovery

**By:** GitHub Copilot

**Actions:**
- Reviewed updated test coverage for the review split changes
- Compared helper tests against collector and demo changes
- Identified missing direct coverage for the user-reported bug path

**Learnings:**
- Current tests validate aggregates, not the data collection path where the defect lives
- The new review classification model needs explicit regression tests

## Notes

- This should follow the correctness fix so the regression cannot recur.
