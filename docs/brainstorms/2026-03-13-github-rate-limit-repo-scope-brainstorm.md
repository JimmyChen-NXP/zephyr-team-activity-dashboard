---
title: GitHub Rate Limit — Repo-Scoped Broad Search
topic: github-rate-limit-repo-scope
date: 2026-03-13
status: implemented
implemented: 2026-03-14
---

# GitHub Rate Limit — Repo-Scoped Broad Search

## Problem History

Three iterations have been tried:

1. **Broad org search, post-filter members** — hit GitHub's 1000-result search cap on active queries; data was silently incomplete.
2. **All members in one query** — query string too long; GitHub rejected it.
3. **Members chunked 10-per-group (later 20)** — 9 chunks × 6 query types × up to 5 pages × 3 presets = 162–810 requests per run; still hitting the 30 req/min rate limit even with throttling at 3000 ms.

## What We're Building

Replace the org-wide chunked-member query strategy with:

1. **Repo-scoped broad queries** — search `repo:A OR repo:B OR ...` (a configurable allowlist) instead of `org:zephyrproject-rtos`. Remove member names from the query entirely.
2. **Post-search roster filtering** — results are still filtered to team members in code after fetching (already partially done for issues/PRs).
3. **Remove push trigger from `publish-pages.yml`** — the workflow no longer generates snapshots (it reads from the `data` branch), but the push trigger causes unnecessary re-deploys during development and fails when the `data` branch doesn't yet exist.

## Why This Approach

### Request count comparison

| Strategy | Queries/preset | Max requests/preset | 3 presets total |
|---|---|---|---|
| Old chunk-10 | 18 × 6 = 108 | ~540 | ~1620 |
| Current chunk-20 | 9 × 6 = 54 | ~270 | ~810 |
| **Proposed repo-scope** | **1 × 6 = 6** | **~30** | **~90** |

Eliminating member names from queries reduces query count by **~94%** at chunk-20 baseline.

### Why the 1000-result cap is no longer a problem

The original broad-org search returned >1000 results for active queries (e.g., all closed PRs in `org:zephyrproject-rtos` for 90 days). A repo-scoped query for 4–5 specific repos will return far fewer results — `zephyrproject-rtos/zephyr` closed PRs in 90 days is roughly 300–600, well within 5 pages (500 items).

### User confirmed scope trade-off

Confirmed: contributions to repos outside the allowlist (other drivers, modules, etc.) will not appear in the dashboard. The 4–5 key repos capture the primary team activity.

## Key Decisions

### 1. Repo allowlist configurable via env var

Add `GITHUB_REPOS` env var as a comma-separated list of `owner/repo` pairs:

```
GITHUB_REPOS=zephyrproject-rtos/zephyr,zephyrproject-rtos/west,zephyrproject-rtos/hal_nxp,zephyrproject-rtos/hostap
```

Falls back to `org:${GITHUB_ORG}` if unset, preserving backward compatibility for local dev without the var.

### 2. Query base changes from `org:X` to `repo:A OR repo:B OR ...`

```typescript
// Before (chunked member queries):
`org:zephyrproject-rtos is:pr is:closed (author:user1 OR author:user2 ... OR author:user20)`

// After (repo-scoped, no member filter):
`repo:zephyrproject-rtos/zephyr OR repo:zephyrproject-rtos/west OR ... is:pr is:closed sort:updated-desc closed:RANGE`
```

The query builder picks `repo:A OR repo:B OR...` when `GITHUB_REPOS` is set, or falls back to `org:X`.

### 3. Remove member chunking from queries entirely

`rosterChunks`, `assigneeQueries`, `authorQueries`, `reviewerQueries` only run when no repo allowlist is configured. When the allowlist is active, a single query covers all repos.

### 4. Remove `push: master` trigger from `publish-pages.yml`

- Keeps `workflow_run` (auto-deploys after successful data collection) and `workflow_dispatch` (manual).
- UI code changes require a manual dispatch or a `collect-data` run to trigger re-deploy. Acceptable trade-off during development.
- Prevents build failures when the `data` branch doesn't yet exist.

### 5. Roster filtering stays in post-processing code

Existing code already filters search results to roster members (e.g., `rosterLogins.has(item.user.login.toLowerCase())`). No behavioral change — we just remove the roster from the query string.

## Implementation Scope

### Files to change

- **`src/lib/github.ts`** — Add `GITHUB_REPOS` parsing; build repo-scoped query base; remove chunked member query path when allowlist is set.
- **`.github/workflows/collect-data.yml`** — Add `GITHUB_REPOS` env var with the 4-repo list.
- **`.github/workflows/publish-pages.yml`** — Remove `push: master` trigger.

### Files unchanged

- `scripts/generate-snapshots.ts` — no change
- `src/lib/dashboard.ts` — no change
- `upstream_member.csv` / roster — no change (still used for post-filter)

## Local Diagnostics Command

Before pushing and triggering GitHub Actions, the developer needs a local command to verify:
- Queries are syntactically valid (no 422/400 errors)
- Result counts are reasonable (no silent caps or missing data)
- Rate limit is not exhausted mid-run

**Decision:** Add `npm run check-queries` (new script `scripts/check-queries.ts`) that:
1. Reads token from `.env.local` (same as dev server)
2. Runs all search queries for **one preset only** (default `7d` — cheapest)
3. Uses `SEARCH_PAGE_LIMIT=1` so it only fetches the first page of each query (fast, minimal API calls)
4. Prints a table: query → total_count returned → capped? → rate_limit_remaining
5. Exits non-zero if any query returned a 4xx error

This lets the developer catch query format errors and cap conditions locally without running the full 3-preset CI job.

```bash
# Example output:
npm run check-queries

[check-queries] preset=7d repos=4 queries=6
query                               total  capped  remaining
----------------------------------  -----  ------  ---------
open issues                          42    no      487
closed issues                        31    no      486
open PRs                             18    no      485
closed PRs                          127    no      484
updated PRs                         134    no      483
reviews                             212    no      482

All queries OK. Rate limit remaining: 482/500
```

Script is **read-only** — never writes snapshot files.

## Open Questions

None — all decisions resolved during brainstorm.

## Resolved Questions

- **Is losing non-allowlist repo visibility acceptable?** → Yes, confirmed by user. The 4 key repos cover primary team activity.

## Success Criteria

- [ ] `collect-data.yml` completes without a 403/429 rate-limit error
- [ ] All 3 preset snapshots (7d, 30d, 90d) are generated
- [ ] Push to master no longer triggers a `publish-pages.yml` run
- [ ] Dashboard shows correct per-member metrics derived from post-search filtering
- [ ] Total search requests per full run ≤ 90 (vs ~810 previously)
- [ ] `npm run check-queries` exits 0 and reports query health in under 30 seconds
