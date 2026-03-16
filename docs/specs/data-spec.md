# Data Collection & Storage Specification

**Maintenance rule**: Any PR that changes a collection script, type definition, or aggregation logic MUST update this document.

---

## Overview

Data flows through four layers:

```
GitHub Search API
  └─▶ collect-daily.ts / collect-open-items.ts  (extract and serialize)
        └─▶ Daily files / open-items.json        (stored on data branch)
              └─▶ aggregate-daily.ts             (merge and compute snapshots)
                    └─▶ public/snapshots/*.json  (served to UI)
```

---

## Collection Scripts

### `scripts/collect-daily.ts`

**Purpose**: Collects activity for 1–2 past UTC calendar days (D-1 and D-2 catch-up).

**GitHub Search queries** (scoped per repo in `GITHUB_REPOS`):
- Closed issues: `is:issue is:closed archived:false sort:updated-desc closed:<date>..<date>`
- Updated PRs: `is:pr archived:false sort:updated-desc updated:<date>..<date>`

**For PRs**: calls `fetchPullRequestDetails` (REST `/repos/{owner}/{repo}/pulls/{number}`) + `fetchPullRequestReviews` for each PR.

**Label extraction**: `(item.labels ?? []).map(l => l.name)` from search result items (no extra API call needed).

**Output**: `public/daily/YYYY-MM-DD.json` (one file per UTC date). Idempotent — skips dates that already have a file.

**Override mode**: `DAILY_OVERRIDE_DATES=2026-03-01,2026-03-02` collects specific dates (backfill).

**Key env vars**:
| Var | Default | Purpose |
|-----|---------|---------|
| `GITHUB_REPOS` | (required) | Comma-separated `org/repo` list |
| `DAILY_OUT_DIR` | `public/` | Output directory |
| `DAILY_DETAIL_LIMIT` | 300 | Max PRs to fetch details for per day |
| `SEARCH_PAGE_LIMIT` | 2 | GitHub Search pages per query |
| `GITHUB_TOKEN` | (required) | Personal access token |

---

### `scripts/collect-open-items.ts`

**Purpose**: Collects all currently open issues and open/draft PRs (no date scope). Overwrites previous snapshot.

**GitHub Search queries**:
- Open issues: `is:issue is:open archived:false sort:updated-desc`
- Open PRs: `is:pr is:open archived:false sort:updated-desc`

**For PRs**: calls `fetchPullRequestDetails` + `fetchCommitCIStatus` (commit SHA from detail response).

**Label extraction**: `(item.labels ?? []).map(l => l.name)` from search result items.

**Output**: `public/open-items.json` (single file, always overwritten).

**Key env vars**:
| Var | Default | Purpose |
|-----|---------|---------|
| `GITHUB_REPOS` | (required) | Comma-separated `org/repo` list |
| `OPEN_ITEMS_OUT_DIR` | `public/` | Output directory |
| `OPEN_ITEMS_PAGE_LIMIT` | 10 | GitHub Search pages per query |
| `DAILY_DETAIL_LIMIT` | 300 | Max PRs to fetch details for |

---

## Type Definitions

### `src/lib/daily-types.ts`

#### `DailyIssueRecord`
```ts
{
  type: "issue";
  id: number;
  number: number;
  repo: string;           // "org/name"
  title: string;
  url: string;
  author: string;
  assignees: string[];
  state: "open" | "closed";
  createdAt: string;      // ISO
  updatedAt: string;      // ISO
  closedAt: string | null;
  labels?: string[];      // GitHub label names; absent in legacy files collected before this field was added
}
```

#### `DailyPrRecord`
```ts
{
  type: "pr";
  id: number;
  number: number;
  repo: string;
  title: string;
  url: string;
  author: string;
  state: "open" | "closed";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  labels?: string[];      // GitHub label names; absent in legacy files
  assignees?: string[];   // Optional for backward compat with legacy daily files
  requestedReviewers: string[];
  ciStatus?: "success" | "failure" | "pending" | null;  // Only in open-items.json
}
```

#### `DailyReviewRecord`
```ts
{
  type: "review";
  reviewId: number;
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prAuthor: string;
  reviewer: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  submittedAt: string;
  prIsDraft: boolean;
  prMergedAt: string | null;
}
```

### `src/lib/types.ts` — `ActivityItem`

Key field additions:
- `labels?: string[]` — GitHub label names; `undefined` for records from daily files collected before labels were added. UI renders `—`.

---

## Storage Layout

### Data branch (`data`)

```
public/
  daily/
    YYYY-MM-DD.json    ← one file per UTC calendar day (DailyFile format)
  open-items.json      ← single overwritable file (OpenItemsFile format)
  snapshots/
    7d.json            ← DashboardData for 7-day window
    30d.json           ← DashboardData for 30-day window
    90d.json           ← DashboardData for 90-day window
    meta.json          ← snapshot metadata (generatedAt, etc.)
```

### `DailyFile` format
```ts
{
  date: string;         // "YYYY-MM-DD"
  collectedAt: string;  // ISO
  repos: string[];
  records: DailyRecord[];  // DailyIssueRecord | DailyPrRecord | DailyReviewRecord
}
```

### `OpenItemsFile` format
```ts
{
  collectedAt: string;
  repos: string[];
  records: Array<DailyIssueRecord | OpenPrRecord>;
}
```

---

## Aggregation (`src/lib/daily-aggregation.ts`)

Called from `aggregate-daily.ts` (CI) and `src/app/api/dashboard/route.ts` (live/dev mode).

**Input**: Array of daily files + open-items file + roster + config.

**Processing**:
1. Deduplicate records across daily files (by id + type).
2. Open-items file records take priority over matching daily records (fresher state).
3. Issues: open issues (no date filter) assigned to roster members; closed issues within the date range.
4. PRs: open/draft PRs (no date filter) authored by roster members; merged/closed PRs within range.
5. Reviews: filtered to `submittedAt` within range.
6. Labels pass through from record to `ActivityItem.labels` unchanged (`undefined` for legacy records).

**Stale threshold**: Issues/PRs with `updatedAt` older than 30 days get `statusLabel: "Stale issue"` / contribute to `staleItems` counter.

---

## Snapshot Generation (`scripts/aggregate-daily.ts`)

Run after collection in CI (`collect-open-items` job). Reads all daily files + open-items.json, writes all three window snapshots.

**CI trigger**: `collect-and-deploy.yml` — `collect-open-items` job calls `npm run aggregate-daily`.

---

## Labels Backward Compatibility

- `labels?: string[]` is optional in all types.
- Historical daily files without a `labels` field deserialize cleanly with `undefined`.
- Aggregation passes `labels: record.labels` (which is `undefined` for old records).
- UI `LabelsCell` renders `—` whenever labels is `undefined` or empty.
- **No re-collection or backfill of historical files is needed.**
