# AGENT.md — Claude Code project guidance

## Key documents

- [UI Specification](docs/specs/ui-spec.md) — pages, filters, tables, columns, column order, default filters
- [Data Specification](docs/specs/data-spec.md) — collection scripts, GitHub API queries, storage layout, type definitions, aggregation logic

## Rules

- **Any change touching a UI table or filter** (column added/removed/reordered, filter default changed): update `docs/specs/ui-spec.md`.
- **Any change touching a collection script, type definition, or aggregation**: update `docs/specs/data-spec.md`.
- Before starting any feature that touches the UI or data pipeline, read both spec docs to understand current state.

## Project structure quick reference

- `src/components/` — page components and tables
- `src/lib/types.ts` — `ActivityItem`, `DashboardData`, etc.
- `src/lib/daily-types.ts` — `DailyIssueRecord`, `DailyPrRecord`, `DailyReviewRecord`
- `src/lib/daily-aggregation.ts` — merges daily files + open-items into `DashboardData`
- `scripts/collect-daily.ts` — collects closed issues + updated PRs for past days
- `scripts/collect-open-items.ts` — collects all currently open issues and PRs
- `scripts/aggregate-daily.ts` — generates rolling-window snapshots
- `.github/workflows/collect-and-deploy.yml` — CI pipeline (collect → aggregate → deploy)
- `docs/plans/` — feature plans
- `docs/solutions/` — solution library (bugs solved, patterns discovered)
