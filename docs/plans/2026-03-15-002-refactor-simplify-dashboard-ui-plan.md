---
title: "refactor: Simplify dashboard UI — remove noise, surface data timestamp"
type: refactor
status: completed
date: 2026-03-15
---

# refactor: Simplify dashboard UI — remove noise, surface data timestamp

The dashboard footer carries four status cards (GitHub Connection, Active Source, Last Update, Warnings) and an Activity Context section that add visual weight without helping users read the data. The goal is to surface what matters — *when the data was last generated* — at the top of every page, and remove everything that is infrastructure noise from the user's perspective.

## Acceptance Criteria

- [x] Title bar shows three zones: **title** (left) · **data timestamp** (center) · **page nav buttons** (right)
- [x] The entire `status-strip` div (GitHub Connection, Active Source, Last Update, Warnings cards) is removed
- [x] The `detail-focus-panel` section ("Activity Context") is removed
- [x] "Update data" and "Refresh open items" buttons are removed from the filter panel
- [x] `updateDataUrl`, `updateOpenItemsUrl` props are removed from `DashboardShell` and `SnapshotDashboardPage`; related env-var reads removed
- [x] Dead helper functions (`getAuthStatusLabel`, `getSyncSourceLabel`) and unused imports (`ConnectionTestButton`, `getActivityPageDescription`) are deleted
- [x] "Refresh now" button (non-hosted path) is kept — it is an active filter action, not a status widget

## Changes by File

### `src/components/dashboard-shell.tsx`

**Title bar** — restructure from `title | nav` to `title | timestamp | nav`:

```tsx
// dashboard-shell.tsx — title-bar (replaces lines 103-107)
<div className="title-bar">
  <span className="title-bar-name">Zephyr team activity</span>
  <span className="title-bar-timestamp">
    Updated {formatDistanceToNow(new Date(viewData.generatedAt), { addSuffix: true })}
    {" · "}
    {formatISO9075(new Date(viewData.generatedAt))}
  </span>
  <ActivityPageNav currentView={view} filters={filters} />
</div>
```

**Filter panel** — remove the two hosted-only action buttons (keep Apply Filters, Refresh now, Export CSV):

```tsx
// Remove these two blocks from filter-actions:
// isHostedSnapshot && updateDataUrl  → "Update data" anchor
// isHostedSnapshot && updateOpenItemsUrl → "Refresh open items" anchor
```

**Status strip** — delete lines 277–342 (`<div className="status-strip">…</div>`) entirely.

**Activity Context section** — delete lines 344–356 (`<section className="panel detail-focus-panel">…</section>`) entirely.

**Dead code to remove from the same file:**
- `getAuthStatusLabel` function (lines 48–63)
- `getSyncSourceLabel` function (lines 65–74)
- `ConnectionTestButton` import (line 10)
- `getActivityPageDescription` import from `@/lib/dashboard-views` (line 21)
- `updateDataUrl` and `updateOpenItemsUrl` from the props type and destructure

### `src/components/snapshot-dashboard-page.tsx`

- Remove `const updateDataUrl = process.env.NEXT_PUBLIC_UPDATE_WORKFLOW_URL ?? "";` (line 38)
- Remove `const updateOpenItemsUrl = process.env.NEXT_PUBLIC_UPDATE_OPEN_ITEMS_WORKFLOW_URL ?? "";` (line 39)
- Remove `updateDataUrl` and `updateOpenItemsUrl` from the `<DashboardShell>` JSX props (lines 125–126)

### CSS (if needed)

The `.title-bar` currently has two children. After this change it has three. Add a center-aligned flex slot for `.title-bar-timestamp` if the existing flex layout doesn't auto-distribute correctly. No new CSS classes are strictly required — verify visually.

## Context

- `isHostedSnapshot` prop is **kept** — it still gates the Export CSV button path (line 191–196).
- `formatISO9075` and `formatDistanceToNow` imports from `date-fns` are **kept** — they move to the title bar.
- `ConnectionTestButton` component file itself (`src/components/connection-test-button.tsx`) can be left on disk unless a follow-up cleanup pass is desired; removing its import is sufficient.
- `NEXT_PUBLIC_UPDATE_WORKFLOW_URL` and `NEXT_PUBLIC_UPDATE_OPEN_ITEMS_WORKFLOW_URL` env vars in `.env` / GitHub Actions can be left in place — unused vars cause no harm.

## Sources

- Primary file: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- Secondary file: [src/components/snapshot-dashboard-page.tsx](src/components/snapshot-dashboard-page.tsx)
- Nav component: [src/components/activity-page-nav.tsx](src/components/activity-page-nav.tsx)
