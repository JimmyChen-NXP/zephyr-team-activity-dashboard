# Zephyr team activity dashboard

A snapshot-first internal dashboard for understanding issue, pull request, and review activity across a team roster inside the `zephyrproject-rtos` GitHub organization.

## Stack
- Next.js 15
- React 19
- TypeScript
- Recharts for visualizations

## Features
- CSV-backed team roster using [upstream_member.csv](upstream_member.csv)
- Preset date ranges for 7, 30, and 90 days
- Cache-first refresh model with cached snapshots and explicit live refresh
- Environment-based GitHub authentication via `.env.local`
- Compact live-sync status with a lightweight GitHub connection test
- Team summary cards, contributor table, repo concentration chart, and recent activity drill-down
- CSV export of the current filtered detail view
- Demo fallback when `GITHUB_TOKEN` is not configured

## Getting started
1. Copy [.env.example](.env.example) to `.env.local`
2. Set `GITHUB_TOKEN`
3. Install dependencies with `npm.cmd install`
4. Start the app with `npm.cmd run dev`
5. Open http://localhost:3000
6. If you change `GITHUB_TOKEN`, restart the dev server before re-testing the connection

## Operational notes
- Normal page loads are cache-first and do not hit GitHub live unless `refresh=1` is requested.
- Live GitHub collection uses a sampled search strategy to stay inside API limits.
- Cached snapshots are stored in `.data/snapshots`.
- Set `GITHUB_LOG_REQUESTS=1` to print GitHub API requests in the Next.js server console during local debugging.
- Metric definitions live in [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md).

## GitHub Pages deployment

Two workflows handle the static site:

- **`collect-data.yml`** — runs daily at 05:13 UTC (or manually via `workflow_dispatch`). Fetches GitHub API data using `DASHBOARD_GITHUB_TOKEN`, writes snapshots to `public/snapshots/`, and force-pushes them to the `data` branch (orphan, single commit — no history accumulation on `master`).
- **`publish-pages.yml`** — runs on push to `master` and after a successful `collect-data` run. Checks out `public/snapshots/` from the `data` branch, builds the static export, and deploys to GitHub Pages. Does **not** call the GitHub API.

**First-time setup:** run `collect-data.yml` via `workflow_dispatch` before the first pages deploy so the `data` branch exists.

**To refresh data manually:** trigger `collect-data.yml` via `workflow_dispatch` in the Actions tab. A pages redeploy follows automatically.

## Post-Deploy Monitoring & Validation
- **What to monitor/search**
  - Logs: `GitHub request failed`, `incomplete results`, `search page limit`
  - Metrics/Dashboards: snapshot freshness, request latency, API error rate
- **Validation checks**
  - Load the dashboard with and without `refresh=1`
  - Compare exported CSV rows against visible drill-down rows
- **Expected healthy behavior**
  - Summary loads under a few seconds from cache
  - Warnings only appear for cached/demo/partial coverage situations
- **Failure signal / rollback trigger**
  - Continuous API failures or empty live results with a valid token
  - Roll back to cached/demo mode while investigating token scope or query limits
- **Validation window & owner**
  - Window: first working day after rollout
  - Owner: dashboard maintainer
