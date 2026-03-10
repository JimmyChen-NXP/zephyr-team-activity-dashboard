# Zephyr team activity dashboard

A snapshot-first internal dashboard for understanding issue, pull request, and review activity across a team roster inside the `zephyrproject-rtos` GitHub organization.

## Stack
- Next.js 15
- React 19
- TypeScript
- Recharts for visualizations

## Features
- CSV-backed team roster using [nxp-upstream_members_2026-03-09.csv](nxp-upstream_members_2026-03-09.csv)
- Preset date ranges for 7, 30, and 90 days
- Hybrid refresh model with cached snapshots and manual live refresh
- In-app GitHub token entry stored in a secure cookie for local use
- Team summary cards, contributor table, repo concentration chart, and recent activity drill-down
- CSV export of the current filtered detail view
- Demo fallback when `GITHUB_TOKEN` is not configured

## Getting started
1. Copy [.env.example](.env.example) to `.env.local`
2. Set `GITHUB_TOKEN`
3. Install dependencies with `npm.cmd install`
4. Start the app with `npm.cmd run dev`
5. Open http://localhost:3000
6. Paste a GitHub token into the "GitHub authentication" box if you want live data without editing `.env.local`

## Operational notes
- Live GitHub collection uses a sampled search strategy to stay inside API limits.
- Cached snapshots are stored in `.data/snapshots`.
- Metric definitions live in [docs/metrics/team-activity-metrics.md](docs/metrics/team-activity-metrics.md).

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
