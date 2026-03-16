---
title: "feat: Labels pipeline, issue/PR column refinements, and project spec docs"
type: feat
status: completed
date: 2026-03-16
---

# feat: Labels pipeline, issue/PR column refinements, and project spec docs

## Overview

Four distinct improvements bundled into one plan:

1. **Fix stale issues not appearing** in the Issues table (default filter gap)
2. **Add GitHub labels** to Issues and Pull Requests — requires end-to-end pipeline work (collect → store → aggregate → display)
3. **Refine Issues and PR table columns** — rename, reorder, add reporter, switch dates to relative format
4. **Create living spec documents** — a UI specification and a data collection reference, with an `AGENT.md` that links to them for Claude Code guidance

---

## Problem Statement / Motivation

### 1. Stale issues show 0
The Issues table defaults to `stateFilter = new Set(["Assigned"])`. Stale issues have `statusLabel: "Stale issue"` and are silently excluded. Users see "0 stale issues" on the summary card but can't find them in the table.

### 2. Labels missing everywhere
GitHub labels are the primary triage signal for issues and PRs. The GitHub Search API returns `item.labels[].name` on every result, but the collection scripts (`collect-daily.ts`, `collect-open-items.ts`) never extract them. They're not in `DailyIssueRecord`, `DailyPrRecord`, `ActivityItem`, or any table.

### 3. Issues table column gaps
- "Contributor" is ambiguous — it's actually the **assignee**
- Reporter (issue author) is missing from the table but already lives in `ActivityItem.author`
- "Created" shows an ISO date; relative ("14 days ago") is more actionable
- "Updated" shows an ISO date; same issue
- Column order is unintuitive

### 4. No living specification documents
There is no single source of truth for:
- What columns each page/table shows, in what order, with what defaults
- How data flows from GitHub → daily files → snapshots → UI

Every future Claude Code session must re-discover these details from code.

---

## Proposed Solution

### Phase 1 — Fix stale issues filter default (small, standalone)

**File:** `src/components/issues-table.tsx`

Change the initial state filter to include `"Stale issue"`:

```ts
// issues-table.tsx
const [stateFilter, setStateFilter] = useState<Set<string>>(
  new Set(["Assigned", "Stale issue"])
);
```

### Phase 2 — Labels pipeline (backend-first)

Labels flow through four layers:

```
GitHub Search API
  └─▶ collect-daily.ts / collect-open-items.ts  (extract item.labels[].name)
        └─▶ DailyIssueRecord / DailyPrRecord     (add labels?: string[])
              └─▶ daily-aggregation.ts            (propagate to ActivityItem)
                    └─▶ ActivityItem              (add labels?: string[])
                          └─▶ issues-table.tsx / authored-prs-table.tsx  (render)
```

#### 2a. Type changes

**`src/lib/daily-types.ts`**
```ts
export type DailyIssueRecord = {
  // ... existing fields ...
  labels?: string[];          // GitHub label names, e.g. ["bug", "area: Bluetooth"]
};

export type DailyPrRecord = {
  // ... existing fields ...
  labels?: string[];
};
```

**`src/lib/types.ts`** — add to `ActivityItem`:
```ts
labels?: string[];
```

#### 2b. Collection scripts

**`scripts/collect-daily.ts`** — when building `DailyIssueRecord` and `DailyPrRecord` from search results:
```ts
labels: (item.labels ?? []).map((l: { name: string }) => l.name),
```

**`scripts/collect-open-items.ts`** — same pattern for both issue and PR records.

#### 2c. Aggregation

**`src/lib/daily-aggregation.ts`** — when pushing to `activityItems`:
```ts
activityItems.push({
  ...
  // labels is undefined for historical records — UI shows "—"; no re-fetch needed
  labels: issue.labels,   // or pr.labels — passes through undefined for old files
  ...
});
```

#### 2d. UI — Issues table

New "Labels" column between Reporter and Created. Render as small chips:
```tsx
// labels-cell.tsx inline or in issues-table.tsx
function LabelsCell({ labels }: { labels?: string[] }) {
  if (!labels?.length) return <span className="muted">—</span>;
  return (
    <span className="label-chips">
      {labels.map((l) => <span key={l} className="label-chip">{l}</span>)}
    </span>
  );
}
```

CSS needed: `.label-chip`, `.label-chips`.

#### 2e. UI — Authored PRs table

Same `LabelsCell` component, same column position (after Reviewers, before Contributor).

### Phase 3 — Issues table column refinements

**`src/components/issues-table.tsx`**

| Before | After |
|---|---|
| Issue | Issue (unchanged) |
| State | State (unchanged, ColumnFilterTh) |
| Updated | → move to after Created |
| Repository | → move to end |
| Contributor | → rename to **Assignee** |
| *(missing)* | → add **Reporter** (from `item.author`) |
| *(missing)* | → add **Labels** |
| *(missing)* | → add **Created** (relative) |

Final column order: **Issue / State / Assignee / Reporter / Labels / Created / Updated / Repository**

Date format change — use `formatDistanceToNowStrict` (already used in authored-prs-table):
```tsx
import { formatDistanceToNowStrict } from "date-fns";
// Created: formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })
// Updated: formatDistanceToNowStrict(new Date(item.updatedAt), { addSuffix: true })
```

### Phase 4 — PR table default filter

**`src/components/authored-prs-table.tsx`**

Change default from `["Open PR", "Draft PR"]` to `["Open PR"]` only:
```ts
const [stateFilter, setStateFilter] = useState<Set<string>>(new Set(["Open PR"]));
```

### Phase 5 — Reviews Outcome filter (already done)

The Outcome chip bar was implemented in the previous session. No changes needed. Mark as complete.

### Phase 6 — Spec documents

#### `docs/specs/ui-spec.md` — UI Specification

Describes every page: route, title, filter controls (with defaults), and every table (columns in order, header label, data source field, format).

Structure:
```
# UI Specification

## Pages
### /issues
#### Filter panel
#### Issues table
| # | Column | Source field | Format | Default filter |

### /pull-requests
...

### /reviews
...

### /maintainers
...
```

**Maintenance rule**: Any PR that adds, removes, or reorders a column, filter, or default MUST update this document.

#### `docs/specs/data-spec.md` — Data Collection & Storage Specification

Describes:
- GitHub API queries used by each collection script
- Output file paths and formats
- Data branch layout
- Aggregation logic overview
- How snapshots are built from daily files
- Field-level notes (e.g., "labels: string[] — extracted from `item.labels[].name`")

#### `AGENT.md` — Claude Code guidance file

Short file at project root that links the specs and establishes conventions Claude should follow:

```markdown
# AGENT.md — Claude Code project guidance

## Key documents
- [UI Specification](docs/specs/ui-spec.md) — pages, filters, tables, columns, defaults
- [Data Specification](docs/specs/data-spec.md) — collection scripts, storage, aggregation

## Rules
- Any change touching a UI table or filter: update ui-spec.md
- Any change touching a collection script or type: update data-spec.md
```

---

## Technical Considerations

- **Labels backward compat — no re-fetch required**: `labels?: string[]` is optional everywhere. Historical daily files that have no `labels` field will deserialize cleanly with `undefined`. The aggregation simply passes `labels: record.labels` (which is `undefined` for old records), and the UI `LabelsCell` renders "—" whenever the field is absent or empty. **No re-collection or backfill of old daily files is needed or wanted.**
- **Label chip overflow**: Issues can have many labels. Start with all shown; add overflow (`+N more` tooltip) only if layout breaks.
- **`collect-daily.ts` uses GitHub Search API** — the search result items include `labels` as an array of objects `{id, node_id, url, name, color, default, description}`. Map to `name` only for storage efficiency.
- **`collect-open-items.ts`** does the same search, plus fetches PR details via `fetchPullRequestDetails`. The PR detail response also has `labels`. Extract from the search result (consistent with issues) rather than from the detail call.
- **Column count changes** require updating `colSpan` in the empty-state `<td>` for both tables.
- **`AGENT.md` vs `CLAUDE.md`**: The project already has a `CLAUDE.md`. `AGENT.md` is a complementary file specifically for spec links and Claude Code conventions. Prefer keeping them separate.

---

## Acceptance Criteria

- [x]Issues table default filter includes both "Assigned" and "Stale issue" — stale issues visible on load
- [x]`DailyIssueRecord.labels?: string[]` and `DailyPrRecord.labels?: string[]` added to `daily-types.ts`
- [x]`ActivityItem.labels?: string[]` added to `types.ts`
- [x]`collect-daily.ts` extracts labels from GitHub search results for issues and PRs
- [x]`collect-open-items.ts` extracts labels from GitHub search results for issues and PRs
- [x]`daily-aggregation.ts` propagates labels from records to `activityItems`
- [x]Issues table column order: Issue / State / Assignee / Reporter / Labels / Created / Updated / Repository
- [x]Issues table "Contributor" column renamed to "Assignee"
- [x]Issues table shows "Reporter" column (from `item.author`, linked to `github.com/<login>`)
- [x]Issues table "Created" shows relative time ("14 days ago")
- [x]Issues table "Updated" shows relative time
- [x]Issues table shows "Labels" column with chip rendering; "—" when empty
- [x]Authored PRs table shows "Labels" column
- [x]Authored PRs table default filter is `["Open PR"]` only
- [x]`docs/specs/ui-spec.md` created, covering all four pages with current column/filter state
- [x]`docs/specs/data-spec.md` created, covering collection scripts, storage layout, and aggregation
- [x]`AGENT.md` created at project root linking both spec docs and stating update rules

---

## Files to Create / Modify

```
src/lib/daily-types.ts              ← add labels?: string[] to DailyIssueRecord, DailyPrRecord
src/lib/types.ts                    ← add labels?: string[] to ActivityItem
scripts/collect-daily.ts            ← extract labels from GitHub search items
scripts/collect-open-items.ts       ← extract labels from GitHub search items
src/lib/daily-aggregation.ts        ← propagate labels field to activityItems
src/components/issues-table.tsx     ← column reorder, rename, add Reporter/Labels/relative dates, fix default filter
src/components/authored-prs-table.tsx ← add Labels column, change default filter to ["Open PR"]
src/app/globals.css                 ← .label-chip, .label-chips styles
docs/specs/ui-spec.md               ← NEW: UI specification
docs/specs/data-spec.md             ← NEW: data collection & storage spec
AGENT.md                            ← NEW: Claude Code project guidance
```

---

## Dependencies & Risks

| Item | Notes |
|---|---|
| Labels in existing daily files | **No backfill required.** Old daily files simply have no `labels` field; the optional type means they aggregate to `undefined`, and the UI renders "—". Labels will silently appear for any issue/PR collected after this change ships. |
| `collect-daily.ts` label extraction | GitHub Search API always returns labels on issues and PRs. No extra API call needed — just extract from existing response. |
| Label volume | Some issues have 10+ labels. Start with all shown; add overflow if layout breaks. |
| Spec doc maintenance discipline | Specs only stay accurate if the rule is enforced. `AGENT.md` makes this explicit for future Claude sessions. |

---

## Sources & References

- Issues table: [src/components/issues-table.tsx](src/components/issues-table.tsx)
- PR table: [src/components/authored-prs-table.tsx](src/components/authored-prs-table.tsx)
- Daily types: [src/lib/daily-types.ts](src/lib/daily-types.ts) — `DailyIssueRecord`, `DailyPrRecord`
- Activity types: [src/lib/types.ts](src/lib/types.ts) — `ActivityItem`
- Aggregation: [src/lib/daily-aggregation.ts](src/lib/daily-aggregation.ts:151) — issues loop at line 151
- Collection scripts: [scripts/collect-daily.ts](scripts/collect-daily.ts), [scripts/collect-open-items.ts](scripts/collect-open-items.ts)
- GitHub Search API labels field: `item.labels: [{id, name, color, ...}]` — available in all search results without extra API calls
