---
title: "Local Dev: Assignees and Reviewers Columns All Dashes (prStatus null in Snapshot)"
category: integration-issues
date: 2026-03-15
tags: [local-dev, snapshot, prStatus, data-sync, authored-prs-table, next-cache]
---

# Local Dev: Assignees and Reviewers Columns All Dashes (prStatus null in Snapshot)

## Problem

After implementing `AssigneesCell` and `ReviewersCell` with `prStatus`-based badge rendering, all Assignees and Reviewers cells in the PR table render `—` (empty dash) for every row — despite the feature being correctly implemented.

**Symptom:** Every PR row shows `—` in the Assignees and Reviewers columns. No review badges, no pending icons, nothing.

---

## Root Cause

The project has two snapshot data paths:

| Path | Source | Contains `prStatus`? |
|------|--------|----------------------|
| `.data/snapshots/*.json` | Local `npm run sync` / `pnpm sync` | Only if run after `prStatus` collection was added |
| `public/snapshots/*.json` | GitHub Actions `collect-data` workflow | Yes — always current |

The dev server loads from `.data/snapshots/` first (local sync output). If the local snapshot was generated before the `prStatus` field was added to the data collector, every `ActivityItem` has `prStatus: null`, and `AuthoredPrsTable` correctly renders `—` for null prStatus.

This is a data staleness problem, not a code bug — but it looks exactly like a rendering bug until the data source is inspected.

---

## Diagnosis

Check whether `prStatus` is actually populated in the local snapshot:

```bash
# Look for the first prStatus field in the local snapshot
grep -m1 '"prStatus"' .data/snapshots/30d.json
# If output is:  "prStatus": null,   → stale local data
# If output is:  "prStatus": {       → data is fine, look elsewhere
```

---

## Solution

### Option A: Copy CI-generated snapshots to local data directory (fastest)

```bash
cp public/snapshots/30d.json .data/snapshots/30d.json
cp public/snapshots/7d.json .data/snapshots/7d.json
cp public/snapshots/90d.json .data/snapshots/90d.json
cp public/snapshots/meta.json .data/snapshots/meta.json
```

`public/snapshots/` is populated by GitHub Actions and committed to the repo, so it always has current data including `prStatus`. Copying it to `.data/snapshots/` gives the dev server valid data immediately without a full re-sync.

### Option B: Re-run local sync

```bash
pnpm sync    # or: npm run sync
```

This regenerates `.data/snapshots/` from the GitHub API with current data including `prStatus`. Takes 30–60 seconds depending on repo size.

### Option C: Clear Next.js cache and restart

If you've recently swapped snapshot files, the dev server may be serving stale responses from its `.next` build cache:

```bash
rm -rf .next
pnpm dev     # restart dev server
```

---

## Prevention

- When implementing features that depend on new fields in the snapshot JSON, **always verify the local snapshot contains those fields** before debugging the rendering code.
- The canonical check: `grep -m1 '"newField"' .data/snapshots/30d.json`
- `public/snapshots/` is the ground truth for what CI produces. `.data/snapshots/` drifts over time. If the two diverge and you're seeing mysterious `null`/`undefined` data, copy from `public/` to `.data/`.
- After copying snapshot files mid-session, clear `.next` cache to avoid serving stale bundled data:
  ```bash
  rm -rf .next && pnpm dev
  ```

---

## Related

- [docs/solutions/logic-errors/dual-data-path-pr-status-divergence.md](docs/solutions/logic-errors/dual-data-path-pr-status-divergence.md) — architectural overview of the two data paths
- [docs/solutions/logic-errors/pr-table-filter-chips-and-reviewers-cell-display-logic.md](docs/solutions/logic-errors/pr-table-filter-chips-and-reviewers-cell-display-logic.md) — related: filter chips and reviewer display bugs in the same feature
- [src/components/authored-prs-table.tsx](src/components/authored-prs-table.tsx) — `prStatus`-dependent rendering
