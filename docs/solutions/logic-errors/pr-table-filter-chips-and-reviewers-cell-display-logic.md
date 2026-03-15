---
title: "PR Table: Filter Chips Not Showing and ReviewersCell Naming Logic"
category: logic-errors
date: 2026-03-15
tags: [react, authored-prs-table, filter-chips, reviewers, prStatus, ui]
---

# PR Table: Filter Chips Not Showing and ReviewersCell Naming Logic

## Problems

Two related display-logic issues were discovered in `AuthoredPrsTable` during implementation of the PR table filter + reviewer column feature.

### Problem 1: Filter Chips Not Appearing

The table filter chip bar was invisible even though the feature was fully implemented and CSS was applied.

**Symptom:** No filter chip bar rendered above the PR table rows, despite `items.length > 0`.

**Root cause:** The initial implementation derived available states from live data:

```tsx
const availableStates = [...new Set(items.map((i) => i.statusLabel))].sort();
// rendered only when: availableStates.length > 1
```

When local snapshot data only contained `"Open PR"` items (e.g. filtered to a single contributor, or the snapshot only captured open PRs), `availableStates` had length 1, so the guard `availableStates.length > 1` suppressed the bar entirely.

### Problem 2: ReviewersCell Showing Pending Reviewer Names

After fixing the chip bar, the `ReviewersCell` was naming pending reviewers in detailed mode when it should have always shown pending as a count badge.

**Symptom:** Rows with any meaningful verdict (APPROVED/CHANGES_REQUESTED) also showed named badges for pending reviewers like `⏳ alice` instead of `⏳2`.

**Root cause:** The `hasMeaningfulVerdict` branch included named pending badges:

```tsx
if (hasMeaningfulVerdict) {
  for (const login of pendingLogins) {
    items.push(<span key={`p-${login}`} ...>⏳ {login}</span>); // wrong
  }
  // ...
}
```

The design intent is: **only APPROVED and CHANGES_REQUESTED ever show names**. Pending is always a count. The merge-readiness principle dictates surfacing blocking/approving signals prominently and compacting everything else.

---

## Solutions

### Fix 1: Use a Fixed Constant for Filter Chips

Replace data-derived state list with a hardcoded constant. Render chips whenever `items.length > 0`, disable chips whose count is 0.

```tsx
// authored-prs-table.tsx
const PR_STATE_CHIPS = ["Open PR", "Draft PR", "Merged", "Closed"] as const;

export function AuthoredPrsTable({ items }: AuthoredPrsTableProps) {
  const [activeStates, setActiveStates] = useState<Set<string>>(new Set());

  const countByState = Object.fromEntries(
    PR_STATE_CHIPS.map((label) => [
      label,
      items.filter((i) => i.statusLabel === label).length,
    ])
  );

  function toggleState(label: string) {
    if (countByState[label] === 0) return; // guard
    setActiveStates((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  return (
    // ...
    {items.length > 0 && (
      <div className="table-filter-bar">
        {PR_STATE_CHIPS.map((label) => {
          const count = countByState[label];
          return (
            <button
              key={label}
              type="button"
              className={clsx("table-filter-chip", activeStates.has(label) && "is-active", count === 0 && "is-empty")}
              onClick={() => toggleState(label)}
              disabled={count === 0}
            >
              {label}
              {count > 0 && <span className="table-filter-chip-count">{count}</span>}
            </button>
          );
        })}
      </div>
    )}
  );
}
```

**Why fixed constant is better:** The chip bar's purpose is consistent navigation — the reader should always see the same 4 options regardless of what data is currently loaded. Data sparsity (e.g. viewing a single contributor's PRs) should not change the UI structure.

### Fix 2: Simplify ReviewersCell — Named Badges Only for APPROVED/CHANGES_REQUESTED

Remove the `hasMeaningfulVerdict` branching entirely. Pending is always a count badge; commented is always a count badge. Only approved and changes-requested get named.

```tsx
function ReviewersCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const { assignees = [], requestedVerdicts, otherVerdicts, pendingRequestedLogins = [] } = prStatus;
  const assigneeSet = new Set(assignees.map((l) => l.toLowerCase()));

  const pendingCount = pendingRequestedLogins.filter((l) => !assigneeSet.has(l.toLowerCase())).length;
  const allVerdicts = [...requestedVerdicts, ...otherVerdicts].filter(
    (v) => !assigneeSet.has(v.login.toLowerCase()),
  );
  // deduplicate by login
  const verdictMap = new Map(allVerdicts.map((v) => [v.login.toLowerCase(), v]));

  // Named badges only for APPROVED / CHANGES_REQUESTED
  const namedVerdicts = [...verdictMap.values()].filter(
    (v) => v.state === "APPROVED" || v.state === "CHANGES_REQUESTED",
  );
  const commentedCount = [...verdictMap.values()].filter((v) => v.state === "COMMENTED").length;

  if (namedVerdicts.length === 0 && pendingCount === 0 && commentedCount === 0) {
    return <span className="pr-badge-empty">—</span>;
  }

  const nodes: React.ReactNode[] = [];
  for (const v of namedVerdicts) {
    nodes.push(
      <span key={`v-${v.login}`} className={VERDICT_CLASS[v.state] ?? "pr-badge"} title={v.state.replace(/_/g, " ")}>
        {VERDICT_ICON[v.state]} {v.login}
      </span>,
    );
  }
  if (pendingCount > 0) {
    nodes.push(
      <span key="p" className="pr-badge pr-badge-pending" title={`${pendingCount} pending`}>
        ⏳{pendingCount}
      </span>,
    );
  }
  if (commentedCount > 0) {
    nodes.push(
      <span key="o" className="pr-badge pr-badge-commented" title={`${commentedCount} comment review(s)`}>
        ○{commentedCount}
      </span>,
    );
  }
  return <span className="pr-badges">{nodes}</span>;
}
```

**Design principle:** The merge-readiness column answers "is anyone blocking or approving this PR?" Named badges surface that signal. Pending reviewers who haven't decided yet are noise — a count is sufficient. This rule applies unconditionally, regardless of what other verdicts exist.

---

## Prevention

### For Filter Chips

- **Prefer fixed constants over data-derived lists** for navigation elements. A UI control that appears/disappears based on current data creates inconsistent UX and confusing "where did the filter go?" moments.
- **Check every conditional guard** (`length > 1`, `length > 0`) to confirm it handles sparse or uniform data correctly before shipping.
- When a UI element is not rendering, check for data-driven guards first — they are a common cause of "feature not appearing" bugs.

### For Reviewer Display Logic

- State the naming rule as a data-independent invariant at the top of the function: "Named badges for APPROVED/CHANGES_REQUESTED only." Then implement it without branching on `hasMeaningfulVerdict`.
- If the same data can be displayed two different ways depending on a condition, consider whether both paths are really necessary. In this case, one unconditional path was simpler and more correct.
- When reviewing PR review-status display code, verify: do pending reviewers ever show names? They should not in a merge-readiness-focused UI.

---

## Related

- [src/components/authored-prs-table.tsx](src/components/authored-prs-table.tsx) — implementation
- [docs/solutions/logic-errors/dual-data-path-pr-status-divergence.md](docs/solutions/logic-errors/dual-data-path-pr-status-divergence.md) — related: local snapshot missing prStatus
- [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md)
- Plan: [docs/plans/2026-03-14-002-feat-pr-table-filter-and-reviewer-columns-plan.md](docs/plans/2026-03-14-002-feat-pr-table-filter-and-reviewer-columns-plan.md)
