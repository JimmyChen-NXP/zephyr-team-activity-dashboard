---
title: "fix: GitHub Pages pipeline — stale snapshots and no push-to-deploy trigger"
type: fix
status: active
date: 2026-03-15
---

# fix: GitHub Pages pipeline — stale snapshots and no push-to-deploy trigger

## Overview

Two separate issues cause GitHub Pages to show stale/incomplete data even after manually triggering `publish-pages`:

1. **No code-push trigger**: `publish-pages.yml` only fires on data-collection workflow completion, so UI code changes sit undeployed until the next daily cron.
2. **Snapshot published without prStatus**: `collect-data` runs `aggregate-daily` and pushes snapshots **without** open-items data. `publish-pages` fires immediately after, deploying a snapshot where `prStatus` is null for all PRs. Ten minutes later `collect-open-items` pushes the correct (prStatus-populated) snapshots, and a *second* `publish-pages` fires — but by then the first deploy is already live and cached.

Both issues are eliminated by **merging the three workflows into one sequential pipeline**.

---

## The Current (Broken) Pipeline

```
[05:13 UTC]  collect-data.yml
               └─ collect-daily → aggregate-daily (NO prStatus) → push snapshots
               └─► triggers publish-pages ── DEPLOYS WITH NO PRSTATUS ──►

[05:23 UTC]  collect-open-items.yml
               └─ collect-open-items → aggregate-daily (WITH prStatus) → push snapshots
               └─► triggers publish-pages ── deploys with prStatus (second deploy, correct)
```

Problems with the current design:

| Problem | Effect |
|---------|--------|
| `publish-pages` fires after `collect-data` (before open-items) | First daily deploy always has `prStatus: null` |
| `publish-pages` fires TWICE per day | Two GitHub Actions builds; first one is wrong |
| No `push` trigger on `publish-pages` | Code changes to `master` wait up to 24 h to deploy |
| Two separate pushes to `public/snapshots/` | Race condition if manually triggered or if `collect-data` runs long |

---

## Problem Statement

### Symptom

Manually running `publish-pages` still shows old data (no prStatus, no reviewer badges). Hard browser-cache clears confirm it is not a browser issue.

### Root Cause A — Double deployment with stale first build

`collect-data.yml` runs `aggregate-daily` without `open-items.json`. The snapshot it writes has `prStatus: null` for all PRs. `publish-pages` fires immediately after on `workflow_run`, deploying this snapshot. The correct snapshot (with prStatus) only appears after `collect-open-items` finishes 10 minutes later — but the broken deploy is already live.

### Root Cause B — No master-push trigger

`publish-pages.yml` only has two triggers:

```yaml
on:
  workflow_run:
    workflows: ["Collect GitHub Data", "Collect Open Items"]
    types: [completed]
  workflow_dispatch:
```

Code changes to `master` (new UI features, bug fixes) do not trigger a redeploy. They wait until the next daily cron.

### Root Cause C — Uncommitted local fixes

Session fixes to `src/components/authored-prs-table.tsx` and `src/app/globals.css` (ReviewersCell display corrections) are not committed. `publish-pages` checks out origin/master and uses the pre-fix code. These must be committed and pushed before any redeploy will show the corrected UI.

---

## Proposed Solution

### Fix 1: Create a sequential `collect-and-deploy.yml` parent workflow

Replace the three-workflow fan-out with a single workflow where jobs run in sequence via `needs:`. This ensures:
- `aggregate-daily` runs **once**, after both data sources are ready
- `publish-pages` runs **once**, with complete data
- No race condition on snapshot files

```yaml
# .github/workflows/collect-and-deploy.yml
name: Collect Data and Deploy

on:
  schedule:
    - cron: "13 5 * * *"
  push:
    branches: [master]
  workflow_dispatch:

jobs:
  collect-daily:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          ref: data
          path: _data
          fetch-depth: 0
        continue-on-error: true
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run collect-daily
        env:
          GITHUB_TOKEN: ${{ secrets.DASHBOARD_GITHUB_TOKEN }}
          GITHUB_REPOS: zephyrproject-rtos/zephyr,zephyrproject-rtos/west,zephyrproject-rtos/hal_nxp,zephyrproject-rtos/hostap
          SEARCH_PAGE_LIMIT: 2
          GITHUB_SEARCH_MIN_INTERVAL_MS: 2500
          DAILY_OUT_DIR: _data/public
      - name: Push daily files to data branch
        run: |
          if [ -d "_data/.git" ]; then
            cd _data
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add -f public/daily/ 2>/dev/null || true
            if git diff --cached --quiet; then
              echo "No new daily files"
            else
              git commit -m "chore: daily files $(date -u +%Y-%m-%dT%H:%M:%SZ)"
              git pull --rebase origin data
              git push origin HEAD:data
            fi
          fi

  collect-open-items:
    runs-on: ubuntu-latest
    needs: collect-daily        # ← waits for collect-daily to complete
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          ref: data
          path: _data
          fetch-depth: 0
        continue-on-error: true
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run collect-open-items
        env:
          GITHUB_TOKEN: ${{ secrets.DASHBOARD_GITHUB_TOKEN }}
          GITHUB_REPOS: zephyrproject-rtos/zephyr,zephyrproject-rtos/west,zephyrproject-rtos/hal_nxp,zephyrproject-rtos/hostap
          OPEN_ITEMS_PAGE_LIMIT: 10
          GITHUB_SEARCH_MIN_INTERVAL_MS: 2500
          OPEN_ITEMS_OUT_DIR: _data/public
      - name: Aggregate and push snapshots
        run: |
          cd _data
          # Run aggregate-daily once, after both data sources exist
          cd ..
          npm run aggregate-daily
          env:
            DAILY_IN_DIR: _data/public
            SNAPSHOT_OUT_DIR: _data/public
          cd _data
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -f public/open-items.json public/snapshots/ 2>/dev/null || true
          if git diff --cached --quiet; then
            echo "No changes"
          else
            git commit -m "chore: open items + snapshots $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            git pull --rebase origin data
            git push origin HEAD:data
          fi

  deploy:
    runs-on: ubuntu-latest
    needs: collect-open-items   # ← waits for snapshots with prStatus
    permissions:
      contents: read
      pages: write
      id-token: write
    concurrency:
      group: pages-publish
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          ref: data
          path: _data
          sparse-checkout: |
            public/snapshots
          sparse-checkout-cone-mode: false
      - run: mkdir -p public && cp -r _data/public/snapshots public/snapshots
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: rm -rf src/app/api
      - run: npm run build
        env:
          DEPLOY_TARGET: github-pages
          NEXT_PUBLIC_DEPLOY_TARGET: github-pages
          NEXT_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}
          GITHUB_PAGES_BASE_PATH: /${{ github.event.repository.name }}
          NEXT_PUBLIC_UPDATE_WORKFLOW_URL: https://github.com/${{ github.repository }}/actions/workflows/collect-and-deploy.yml
          NEXT_PUBLIC_UPDATE_OPEN_ITEMS_WORKFLOW_URL: https://github.com/${{ github.repository }}/actions/workflows/collect-and-deploy.yml
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: out }
      - uses: actions/deploy-pages@v4
```

### Fix 2: Commit and push the outstanding local changes

Before any workflow change takes effect, the uncommitted UI fixes must be pushed to origin/master:

```bash
git add src/app/globals.css src/components/authored-prs-table.tsx
git commit -m "fix(pr-table): reviewer column always uses count for pending, named only for APPROVED/CHANGES_REQUESTED"
git push origin master
```

### Fix 3: Retire the old three-workflow setup

Once `collect-and-deploy.yml` is verified working:
- Delete or disable `collect-data.yml`
- Delete or disable `collect-open-items.yml`
- Delete or disable `publish-pages.yml`

Keep `backfill-daily.yml` as-is (it pushes only daily files, not snapshots — no conflict).

---

## New Pipeline (after fix)

```
[05:13 UTC / master push / manual]
  └─► collect-and-deploy.yml
        Job 1: collect-daily
               └─ collect-daily → push daily files only
        Job 2: collect-open-items  (needs: collect-daily)
               └─ collect-open-items → aggregate-daily (WITH prStatus) → push snapshots
        Job 3: deploy  (needs: collect-open-items)
               └─ checkout master + sparse checkout snapshots → next build → deploy-pages
               └─► ONE deploy per trigger, always with full prStatus data
```

---

## Acceptance Criteria

- [ ] `collect-and-deploy.yml` exists and runs the three jobs sequentially.
- [ ] `aggregate-daily` only runs in `collect-open-items` job (not in `collect-daily` job).
- [ ] Deployed snapshots contain `prStatus` data (not null) for open PRs.
- [ ] Pushing to `master` triggers a fresh deploy within ~8 minutes.
- [ ] Manually triggering the workflow deploys with current master code and current prStatus data.
- [ ] Old three-workflow setup is disabled/deleted to avoid double-running.
- [ ] `NEXT_PUBLIC_UPDATE_WORKFLOW_URL` env var points to the new workflow file.
- [ ] Outstanding local changes to `authored-prs-table.tsx` and `globals.css` are committed and pushed.

---

## Files to Change

| File | Change |
|------|--------|
| `.github/workflows/collect-and-deploy.yml` | Create — sequential parent workflow |
| `.github/workflows/collect-data.yml` | Delete or disable (replaced by parent) |
| `.github/workflows/collect-open-items.yml` | Delete or disable (replaced by parent) |
| `.github/workflows/publish-pages.yml` | Delete or disable (replaced by parent) |
| `src/components/authored-prs-table.tsx` | Commit outstanding fixes |
| `src/app/globals.css` | Commit outstanding fixes |

---

## Manual Recovery (immediate action)

Get the current `master` code + latest data onto GitHub Pages right now:

```bash
# Step 1: commit the outstanding UI fixes
git add src/app/globals.css src/components/authored-prs-table.tsx
git commit -m "fix(pr-table): pending reviewers always count-only, not named"
git push origin master

# Step 2: trigger collect-and-deploy manually (after the workflow file is merged)
gh workflow run collect-and-deploy.yml --ref master
gh run watch
```

Before the new workflow exists, use the existing chain:
```bash
# Trigger collect-open-items first (to get prStatus in snapshots)
gh workflow run collect-open-items.yml --ref master
# Then trigger publish-pages AFTER collect-open-items finishes
gh workflow run publish-pages.yml --ref master
```

---

## Sources & References

- [.github/workflows/publish-pages.yml](.github/workflows/publish-pages.yml)
- [.github/workflows/collect-data.yml](.github/workflows/collect-data.yml)
- [.github/workflows/collect-open-items.yml](.github/workflows/collect-open-items.yml)
- [docs/solutions/integration-issues/github-actions-data-branch-push-conflict.md](docs/solutions/integration-issues/github-actions-data-branch-push-conflict.md)
- [docs/solutions/integration-issues/local-dev-snapshot-missing-prstatus-field.md](docs/solutions/integration-issues/local-dev-snapshot-missing-prstatus-field.md)
