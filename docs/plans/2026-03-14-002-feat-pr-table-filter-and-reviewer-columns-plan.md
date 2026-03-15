---
title: "feat: PR Table State Filter and Unified Reviewer Column"
type: feat
status: completed
date: 2026-03-14
---

# feat: PR Table State Filter and Unified Reviewer Column

## Motivation

The PR table exists to answer one question: **has this PR reached merge criteria?** A reader scanning the table should be able to tell immediately whether a PR is blocked, approved, or still waiting — without navigating to the PR detail page.

The current table mixes critical signals (blocking changes requests, missing approvals) with low-signal information (reviewer names for closed PRs, split requested/reviewer columns that require reading two cells). This dilutes the signal-to-noise ratio.

**Design principle:** Surface merge-critical signals prominently. Compact everything else into statistical counts. If a reader needs more detail, the PR title is a link.

---

## Overview

Three focused improvements to `AuthoredPrsTable` shaped by the merge-readiness principle:

1. **In-table state filter** — filter to only open (or only merged) PRs without a full page navigation, so the table stays focused on the relevant queue.
2. **Assignees column with review status icons** — immediately shows whether an assignee has acted (approved / blocked / pending) rather than just their name.
3. **Merge Requested + Reviewers into one column** — when any non-assignee has a meaningful verdict (approve/block), show names. When no verdict exists, show compact counts only. Readers can click through for full review history.

---

## Problem Statement

### State filter

The table shows up to 40 PRs mixing Open, Draft, Merged, and Closed states. A team lead checking merge-readiness only cares about open PRs — but there is no way to narrow to them without a full page navigation. Users need a fast, local toggle that keeps the focus on the actionable queue.

### Assignees column

Assignees are responsible for driving a PR to merge. The current plain-name display gives no signal whether they have acted. A reviewer scanning the table cannot tell if an assignee has already approved, is blocking the PR, or hasn't reviewed yet — all three render identically.

### Requested / Reviewers column split

The "Requested" column (reviewers who were requested) and "Reviewers" column (unsolicited reviewers) require reading two cells to form a single picture. Most of the time, the merge-critical question is binary: is anyone blocking this PR? The two-column design buries that answer in noise. Compact counts suffice when no verdict has been rendered; named badges with verdict icons are shown only when someone has actually approved or blocked.

---

## Proposed Solution

### 1. In-table state filter

Add a local `useState<string[]>` inside `AuthoredPrsTable` that holds the set of active `statusLabel` filters. Render a row of toggle-chip buttons above the table. When no filters are selected all rows show. Filtering is purely client-side — no URL change, no form submit.

**Distinct `statusLabel` values for `pull_request` items:**
- `"Open PR"`
- `"Draft PR"`
- `"Merged"`
- `"Closed"`

Toggle chips sit inside the existing `.panel-header` area or in a new `.table-filter-bar` between the panel header and `.table-wrap`.

### 2. Assignees column with review status icons

For each assignee, look up their review state from `prStatus`:
- If the login appears in `requestedVerdicts` → show the verdict icon (`✓` approved, `✗` changes requested, `○` commented) alongside the name, using the same `VERDICT_CLASS` map already defined.
- If the login appears in `pendingRequestedLogins` → show `⏳` pending icon alongside name.
- Otherwise (assignee has no review activity) → show a neutral `·` icon alongside name.

This replaces the current `AssigneesCell` which shows only the login string.

### 3. Unified reviewer column (merge Requested + Reviewers)

Replace the two columns "Requested" and "Reviewers" with a single "Reviewers" column.

**Logic:**

```
nonAssigneeReviewers = [
  ...pendingRequestedLogins (not in assignees),
  ...requestedVerdicts (not in assignees),
  ...otherVerdicts (not in assignees),
]
```

**Display rule:**

- If **any** non-assignee reviewer has `state === "APPROVED"` or `state === "CHANGES_REQUESTED"`:
  → Show each such reviewer as a named badge: `[icon] login` using `VERDICT_CLASS`.
  → Pending reviewers (still no verdict) are shown as `⏳ login`.
  → COMMENTED-only reviewers: omit names, roll into a static `○N` count badge.

- If **no** non-assignee reviewer has APPROVED or CHANGES_REQUESTED (i.e., all are pending or commented only):
  → Show compact static icons: `⏳N` pending, `○N` commented. No names.

The table shrinks from 10 columns to 9 columns (Requested column removed, Reviewers column repurposed).

---

## Acceptance Criteria

- [ ] Filter chips appear above the PR table rows (not in the global filter panel).
- [ ] Selecting a chip narrows the rows to only that `statusLabel`; selecting multiple chips shows the union.
- [ ] Selecting an already-active chip deselects it; when no chips are active, all rows show.
- [ ] Each assignee badge renders an appropriate review-status icon (✓ / ✗ / ○ / ⏳ / neutral) based on their verdict in `prStatus`.
- [ ] The "Requested" column is removed; "Reviewers" column shows names when any non-assignee has a meaningful verdict, otherwise shows static icon counts.
- [ ] Assignees are never double-counted in the reviewer column.
- [ ] When `prStatus` is absent (non-open PRs), the Assignees and Reviewers cells render `—` as before.
- [ ] `colSpan` on the empty-state row is updated to reflect the new column count (9).
- [ ] No changes to `PrStatusSummary` type or any data-layer files.

---

## Technical Considerations

### Component scope

All changes are confined to [src/components/authored-prs-table.tsx](src/components/authored-prs-table.tsx). No type changes, no data-layer changes. `ReviewedPrsTable` is out of scope — it does not have the same column structure and has no `prStatus` data.

### Required new imports in `authored-prs-table.tsx`

```tsx
import { useState } from "react";
import clsx from "clsx";
```

`clsx` is already a project dependency (used in `dashboard-shell.tsx`) but not currently imported in the PR table file.

### State management

```tsx
// authored-prs-table.tsx
const [activeStates, setActiveStates] = useState<Set<string>>(new Set());
const filtered = activeStates.size === 0
  ? items
  : items.filter((item) => activeStates.has(item.statusLabel));
```

Toggle logic:

```tsx
function toggleState(label: string) {
  setActiveStates((prev) => {
    const next = new Set(prev);
    next.has(label) ? next.delete(label) : next.add(label);
    return next;
  });
}
```

Available filter labels are derived from the distinct `statusLabel` values present in `items` (not hardcoded), so the chips only appear for states that actually exist in the current data set.

### Revised `AssigneesCell`

```tsx
function AssigneesCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const { assignees = [], requestedVerdicts, pendingRequestedLogins = [] } = prStatus;
  if (assignees.length === 0) return <span className="pr-badge-empty">—</span>;

  const verdictMap = new Map(requestedVerdicts.map((v) => [v.login.toLowerCase(), v.state]));
  const pendingSet = new Set(pendingRequestedLogins.map((l) => l.toLowerCase()));

  return (
    <span className="pr-badges">
      {assignees.map((login) => {
        const key = login.toLowerCase();
        const state = verdictMap.get(key);
        const isPending = pendingSet.has(key);
        const badgeClass = state ? (VERDICT_CLASS[state] ?? "pr-badge") : "pr-badge pr-badge-commented";
        const icon = state ? VERDICT_ICON[state] : isPending ? "⏳" : "·";
        return (
          <span key={login} className={badgeClass} title={state ?? (isPending ? "Pending" : "Assigned")}>
            {icon} {login}
          </span>
        );
      })}
    </span>
  );
}
```

### Revised unified `ReviewersCell`

```tsx
function ReviewersCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const { assignees = [], requestedVerdicts, otherVerdicts, pendingRequestedLogins = [] } = prStatus;
  const assigneeSet = new Set(assignees.map((l) => l.toLowerCase()));

  const pendingLogins = pendingRequestedLogins.filter((l) => !assigneeSet.has(l.toLowerCase()));
  const allVerdicts = [...requestedVerdicts, ...otherVerdicts].filter(
    (v) => !assigneeSet.has(v.login.toLowerCase())
  );
  // deduplicate by login (requestedVerdicts and otherVerdicts should not overlap, but guard anyway)
  const verdictMap = new Map(allVerdicts.map((v) => [v.login.toLowerCase(), v]));

  const hasMeaningfulVerdict = [...verdictMap.values()].some(
    (v) => v.state === "APPROVED" || v.state === "CHANGES_REQUESTED"
  );

  if (!hasMeaningfulVerdict && pendingLogins.length === 0 && verdictMap.size === 0) {
    return <span className="pr-badge-empty">—</span>;
  }

  if (hasMeaningfulVerdict) {
    // named mode
    const items: React.ReactNode[] = [];
    for (const login of pendingLogins) {
      items.push(<span key={`p-${login}`} className="pr-badge pr-badge-pending" title="Pending">⏳ {login}</span>);
    }
    for (const [, v] of verdictMap) {
      if (v.state === "COMMENTED") continue; // roll into count below
      items.push(
        <span key={`v-${v.login}`} className={VERDICT_CLASS[v.state] ?? "pr-badge"} title={v.state.replace(/_/g, " ")}>
          {VERDICT_ICON[v.state]} {v.login}
        </span>
      );
    }
    const commented = [...verdictMap.values()].filter((v) => v.state === "COMMENTED").length;
    if (commented > 0) items.push(<span key="cmt" className="pr-badge pr-badge-commented" title={`${commented} comment review(s)`}>○{commented}</span>);
    return <span className="pr-badges">{items}</span>;
  }

  // static icon mode (pending + commented counts only)
  const parts: React.ReactNode[] = [];
  if (pendingLogins.length > 0)
    parts.push(<span key="p" className="pr-badge pr-badge-pending" title={`${pendingLogins.length} pending`}>⏳{pendingLogins.length}</span>);
  const commented = [...verdictMap.values()].filter((v) => v.state === "COMMENTED").length;
  if (commented > 0)
    parts.push(<span key="o" className="pr-badge pr-badge-commented" title={`${commented} comment review(s)`}>○{commented}</span>);
  return parts.length > 0 ? <span className="pr-badges">{parts}</span> : <span className="pr-badge-empty">—</span>;
}
```

### Filter bar markup

```tsx
// Inside AuthoredPrsTable, between panel-header and table-wrap
{availableStates.length > 1 && (
  <div className="table-filter-bar">
    {availableStates.map((label) => (
      <button
        key={label}
        type="button"
        className={clsx("table-filter-chip", activeStates.has(label) && "is-active")}
        onClick={() => toggleState(label)}
      >
        {label}
      </button>
    ))}
  </div>
)}
```

`availableStates` is derived as:
```tsx
const availableStates = [...new Set(items.map((i) => i.statusLabel))].sort();
```

The chip bar renders only when `availableStates.length > 1` — if all current rows share the same state label, filtering adds no value and the bar is hidden.

### CSS additions needed

New classes in `globals.css`:

```css
.table-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--border);
}

.table-filter-chip {
  padding: 0.2rem 0.65rem;
  border-radius: 1rem;
  border: 1px solid var(--border);
  background: transparent;
  font-size: 0.75rem;
  cursor: pointer;
  color: var(--text-muted);
}

.table-filter-chip.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}
```

(Exact CSS variables may need adjustment to match existing design tokens in `globals.css`.)

---

## Files to Change

| File | Change |
|------|--------|
| [src/components/authored-prs-table.tsx](src/components/authored-prs-table.tsx) | Add state filter, revise `AssigneesCell`, replace `RequestedCell`+`ReviewersCell` with unified `ReviewersCell`, update `colSpan` |
| [src/app/globals.css](src/app/globals.css) | Add `.table-filter-bar` and `.table-filter-chip` styles |

No other files need changes.

---

## System-Wide Impact

- **Type safety**: No changes to `PrStatusSummary`, `ActivityItem`, or any other type. Purely presentational.
- **State lifecycle**: Filter state is ephemeral React state — resets on page navigation, no persistence needed.
- **Column count**: `colSpan` on the empty-state `<td>` changes from `10` to `9` (one column removed).
- **Reviewer deduplication**: The existing deduplication pattern (assigneeSet exclusion) is preserved and extended. Guard against `requestedVerdicts` / `otherVerdicts` overlap via `Map` keyed on login.

---

## Sources & References

- [src/components/authored-prs-table.tsx](src/components/authored-prs-table.tsx) — current implementation
- [src/lib/types.ts](src/lib/types.ts) — `PrStatusSummary`, `ActivityItem` types
- [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx) — existing local filter pattern (`localContributor` state)
