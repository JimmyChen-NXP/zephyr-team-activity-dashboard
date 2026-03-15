---
title: "GitHub Dashboard PR Table: Dual Data Path prStatus Divergence, Assignees Pipeline, and Column Deduplication"
category: logic-errors
date: 2026-03-14
tags:
  - github-api
  - nextjs
  - typescript
  - dashboard
  - pull-requests
  - data-pipeline
  - reviewer-verdicts
  - ci-status
  - assignees
  - deduplication
problem_type: logic-errors
components:
  - src/lib/types.ts
  - src/lib/daily-types.ts
  - src/lib/github.ts
  - src/lib/daily-aggregation.ts
  - scripts/collect-open-items.ts
  - scripts/collect-daily.ts
  - src/components/authored-prs-table.tsx
---

# Dual Data Path prStatus Divergence, Assignees Pipeline, and Column Deduplication

## Problem Symptoms

- The **Reviews column** in the Pull Requests table always showed `—` (dash) in the live dashboard,
  even for PRs that had reviews, assignees, and CI status.
- The **Assignees column** was showing the wrong people — it was displaying `requested_reviewers`
  (GitHub's Reviewers sidebar) instead of the real `assignees` field (GitHub's Assignees sidebar).
- The same GitHub user could appear in multiple table columns simultaneously (Assignees, Requested, Reviewers).

---

## Root Cause Analysis

### 1. Live path never computed `prStatus`

The dashboard has two data paths:

- **Snapshot path** (`daily-aggregation.ts`): reads pre-collected JSON records, computes `prStatus`
  (reviewer verdicts, CI status, cooldown) and attaches it to each open `ActivityItem`.
- **Live path** (`github.ts` → `collectLiveDashboard`): fetches data from GitHub API at render time.

The live path fetched PR reviews via the GitHub API but **never computed `PrStatusSummary` and
attached it to `prItem.prStatus`**. The snapshot path did this correctly. As a result, `item.prStatus`
was always `undefined` for live renders, and the UI displayed `—` in every Reviews cell.

### 2. `assignees` field missing from the entire pipeline

GitHub PRs expose three distinct reviewer-related concepts:

| Field | GitHub UI | Meaning |
|---|---|---|
| `pull_request.assignees[]` | Assignees sidebar | People responsible for the PR; has nothing to do with code review |
| `pull_request.requested_reviewers[]` | Reviewers sidebar | People whose review is explicitly requested but not yet submitted |
| `pull_request.reviews[]` | Timeline | Actual submitted review events (APPROVED, CHANGES_REQUESTED, etc.) |

The `assignees` field was never extracted from `detail.assignees` in either collection script
(`collect-open-items.ts`, `collect-daily.ts`) and never threaded through `PrStatusSummary`.
The "Assignees" column was using `requested_reviewers` — the wrong field entirely.

### 3. No deduplication across table columns

`RequestedCell` and `ReviewersCell` in `authored-prs-table.tsx` had no logic to exclude people
who were already rendered in a prior column. A person who was both an assignee and a requested
reviewer would appear in two columns.

---

## Solution

### Step 1: Thread `assignees` through the entire data pipeline

Added `assignees?: string[]` to `DailyPrRecord` (optional for backward compatibility with
existing data files) and `assignees: string[]` to `PrStatusSummary`.

Updated all collection and aggregation sites:

```ts
// scripts/collect-open-items.ts and scripts/collect-daily.ts
const prRecord: OpenPrRecord = {
  // ...
  assignees: detail.assignees.map((a) => a.login),   // was missing entirely
  requestedReviewers: detail.requested_reviewers.map((r) => r.login),
};
```

```ts
// src/lib/daily-aggregation.ts
const prStatus: PrStatusSummary = {
  assignees: pr.assignees ?? [],  // safe fallback for old data files
  requestedVerdicts,
  otherVerdicts,
  // ...
};
```

### Step 2: Compute and attach `prStatus` in the live path

Added the following block inside the detail-results loop for open PRs in `src/lib/github.ts`
(mirrors the logic already in `daily-aggregation.ts`):

```ts
if (item.state === "open") {
  const prItem = activityItems.find(
    (ai) => ai.type === "pull_request" && ai.url === item.html_url
  );
  if (prItem) {
    const latestByReviewer = new Map<string, PullRequestReview>();
    for (const review of reviews) {
      if (!review.user?.login || !review.submitted_at) continue;
      const key = review.user.login.toLowerCase();
      const existing = latestByReviewer.get(key);
      if (!existing || review.submitted_at > existing.submitted_at!)
        latestByReviewer.set(key, review);
    }
    const requestedSet = new Set(
      detail.requested_reviewers.map((r) => r.login.toLowerCase())
    );
    const requestedVerdicts: ReviewerVerdict[] = [];
    const otherVerdicts: ReviewerVerdict[] = [];
    for (const [reviewerKey, review] of latestByReviewer) {
      const state = review.state.toUpperCase() as ReviewerVerdict["state"];
      if (!["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(state)) continue;
      const verdict: ReviewerVerdict = {
        login: review.user!.login,
        state,
        wasRequested: requestedSet.has(reviewerKey),
      };
      if (verdict.wasRequested) requestedVerdicts.push(verdict);
      else otherVerdicts.push(verdict);
    }
    const pendingRequestedLogins = detail.requested_reviewers
      .filter((r) => !latestByReviewer.has(r.login.toLowerCase()))
      .map((r) => r.login);
    const cooldownHours = differenceInHours(new Date(), parseISO(detail.updated_at));
    const prStatus: PrStatusSummary = {
      assignees: detail.assignees.map((a) => a.login),
      requestedVerdicts,
      otherVerdicts,
      pendingRequestedLogins,
      pendingRequestedCount: pendingRequestedLogins.length,
      ciStatus: ciStatus ?? null,
      cooldownHours,
      cooldownMet: cooldownHours >= 72,
    };
    prItem.prStatus = prStatus;
  }
}
```

### Step 3: Deduplicate columns at render time

In `src/components/authored-prs-table.tsx`:

```tsx
// RequestedCell: skip anyone already shown as an assignee
const assigneeSet = new Set((assignees ?? []).map((l) => l.toLowerCase()));
for (const login of pendingRequestedLogins) {
  if (assigneeSet.has(login.toLowerCase())) continue;
  // render badge...
}

// ReviewersCell: skip assignees + all requested reviewer logins
const excludeSet = new Set([
  ...(assignees ?? []).map((l) => l.toLowerCase()),
  ...requestedVerdicts.map((v) => v.login.toLowerCase()),
  ...pendingRequestedLogins.map((l) => l.toLowerCase()),
]);
const filtered = otherVerdicts.filter(
  (v) => !excludeSet.has(v.login.toLowerCase())
);
```

---

## Prevention & Best Practices

### 1. Keep live path and snapshot path in sync

Any computed/enriched field added to `daily-aggregation.ts` must also be added to
`collectLiveDashboard` in `github.ts`, and vice versa. These paths are independent — one
working correctly in CI gives no signal about the other.

**Recommended convention:** mark paired enrichment blocks with a sync comment:

```ts
// SYNC: prStatus — keep this in sync with daily-aggregation.ts / github.ts
```

Search for `SYNC:` when adding enrichment to either file to find the counterpart.

**Checklist before merging any data-shape change:**

- [ ] Field is computed in `daily-aggregation.ts` (snapshot path)
- [ ] Field is computed in `github.ts` `collectLiveDashboard` (live path)
- [ ] Both produce the same type and the same empty/missing value convention
- [ ] UI render code guards against missing field with `?? default`

### 2. GitHub API: three distinct reviewer-related fields

Never conflate these:

- **`assignees[]`** — Assignees sidebar. Ownership/accountability. Not related to code review.
- **`requested_reviewers[]`** — Reviewers sidebar. Pending review requests only — shrinks as reviews are submitted.
- **`reviews[]`** — Actual submitted review events with state. Source of truth for review outcomes.

To display a complete reviewer picture, union `requested_reviewers` (pending) with deduped authors from `reviews` (completed), keeping the most recent state per reviewer login.

### 3. Backward compatibility for stored JSON schema changes

Records accumulate in the `_data` branch over time. Rules:

1. **Always mark new fields optional in the interface:** `assignees?: string[]`
2. **Always default when reading:** `pr.assignees ?? []` — never `pr.assignees.map(...)` without guard
3. **Never remove or rename a field without a migration step**

### 4. Column deduplication: do it at render time, not collection time

Store each list faithfully from the source API. Apply deduplication at render time using a
left-to-right exclusion set. This keeps raw data complete, lets different views apply different
strategies, and makes priority order easy to change without re-fetching data.

---

## Related Files

- [`src/lib/github.ts:759–808`](src/lib/github.ts#L759) — `prStatus` computation in live path
- [`src/lib/daily-aggregation.ts:248–283`](src/lib/daily-aggregation.ts#L248) — `prStatus` computation in snapshot path
- [`src/lib/types.ts`](src/lib/types.ts) — `PrStatusSummary`, `ReviewerVerdict`, `ActivityItem`
- [`src/lib/daily-types.ts`](src/lib/daily-types.ts) — `DailyPrRecord`, `OpenPrRecord`
- [`src/components/authored-prs-table.tsx`](src/components/authored-prs-table.tsx) — column render and deduplication

## Related Solutions

- [`docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md`](external-authored-pr-reviews-skipped-in-live-collection.md) — similar pattern: live collection dropping data before enrichment ran
- [`docs/solutions/integration-issues/dashboard-token-invalid-env-precedence.md`](../integration-issues/dashboard-token-invalid-env-precedence.md) — another `github.ts` data path issue

## Related Plans

- [`docs/plans/2026-03-14-001-feat-activity-ui-data-refinements-plan.md`](../../plans/2026-03-14-001-feat-activity-ui-data-refinements-plan.md) — primary plan for this work (Part G2: PrStatusSummary data layer)
- [`docs/plans/2026-03-13-001-feat-incremental-daily-accumulation-plan.md`](../../plans/2026-03-13-001-feat-incremental-daily-accumulation-plan.md) — foundational architecture establishing the dual-path design
