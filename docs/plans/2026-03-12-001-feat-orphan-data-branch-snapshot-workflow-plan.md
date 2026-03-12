---
title: "feat: Decouple snapshot collection from pages build via orphan data branch"
type: feat
status: active
date: 2026-03-12
---

# feat: Decouple snapshot collection from pages build via orphan data branch

## Overview

Split the single `publish-pages.yml` GitHub Actions workflow into two independent workflows:

1. **`collect-data.yml`** — runs on a schedule, fetches GitHub API data, force-pushes JSON snapshots to an orphan `data` branch (no history accumulation, master stays clean)
2. **`publish-pages.yml`** — runs on push to master or when data collection completes, checks out snapshots from the `data` branch, builds static site without touching the GitHub API

## Problem Statement

The current `publish-pages.yml` runs `npm run snapshots` (which calls the GitHub Search API ~108+ times for a 171-member roster) on **every push to master** in addition to its daily schedule. This causes:

- **Rate limit errors**: multiple workflow runs from the same token exhaust the 30 req/min Search API budget
- **Slow builds**: API fetching adds 5–20 minutes to every deploy triggered by a code change
- **No separation of concerns**: a CSS fix triggers a full GitHub API scrape

The roster has 171 members → `ceil(171/10) = 18 chunks` × 6 query groups = **108+ Search API calls per preset** × 3 presets = **324+ calls per workflow run**.

## Proposed Solution

### Architecture

```
[collect-data.yml]                    [publish-pages.yml]
  trigger: schedule (daily)             trigger: push to master
           workflow_dispatch                     workflow_run (after collect-data)
                                                 workflow_dispatch
  steps:
    checkout master                    steps:
    npm ci                               checkout master
    npm run snapshots  ← API calls       checkout public/snapshots/ from data branch
    git checkout --orphan                npm ci
    git add public/snapshots/            rm -rf src/app/api
    git commit                           npm run build  ← no API calls
    git push origin HEAD:data --force    deploy to GitHub Pages
```

### The `data` branch

- Orphan branch — no parent commits, no history
- Force-pushed on every collection run → always has exactly **1 commit**
- Contains only `public/snapshots/*.json` and `public/snapshots/meta.json`
- Master branch history is never polluted with data commits

## Acceptance Criteria

- [ ] `collect-data.yml` runs on daily schedule and `workflow_dispatch`; does **not** run on push to master
- [ ] `collect-data.yml` force-pushes to a `data` branch with a single commit (orphan, no history)
- [ ] `collect-data.yml` uses `DASHBOARD_GITHUB_TOKEN` secret (same as today)
- [ ] `publish-pages.yml` **removes** the `Generate snapshots` step
- [ ] `publish-pages.yml` checks out `public/snapshots/` from the `data` branch before building
- [ ] `publish-pages.yml` triggers on push to master AND on successful completion of `collect-data.yml`
- [ ] Pages build succeeds without `DASHBOARD_GITHUB_TOKEN` being present
- [ ] If the `data` branch does not exist yet, the pages build fails with a clear message (not silently with stale/empty data)
- [ ] README operational notes updated to describe the two-workflow model
- [ ] First-time setup documented: run `collect-data.yml` manually before first pages deploy

## Technical Considerations

### Permissions

`collect-data.yml` needs `contents: write` to push the `data` branch.
`publish-pages.yml` keeps `contents: read`, `pages: write`, `id-token: write` — no change from today.

### Sparse checkout for the data branch

Use `actions/checkout@v4` with `sparse-checkout` to pull only the snapshots folder, keeping the build step fast:

```yaml
- uses: actions/checkout@v4
  with:
    ref: data
    sparse-checkout: |
      public/snapshots
    sparse-checkout-cone-mode: false
```

Then copy into the working tree before the build step.

### workflow_run trigger

`publish-pages.yml` should rebuild when new data is available:

```yaml
on:
  push:
    branches: [master]
  workflow_run:
    workflows: ["Collect GitHub Data"]
    types: [completed]
  workflow_dispatch:
```

Note: `workflow_run` fires even on failure — add a condition `if: github.event.workflow_run.conclusion == 'success'` on the job, or check inside the steps.

### Force-push safety

The `data` branch is dedicated solely to snapshot JSON. Force-pushing it is intentional and safe — there is no human-authored history to lose. The concurrency group on the collect workflow prevents two simultaneous collections from racing.

### First-run bootstrapping

On a fresh repo clone with no `data` branch, `publish-pages.yml` will fail at the sparse checkout step. Solutions:
- Document in README: run `collect-data.yml` via `workflow_dispatch` before the first push
- Or: add a fallback step in `publish-pages.yml` that uses demo/empty snapshots if the `data` branch is absent

## Files to Create / Modify

### `.github/workflows/collect-data.yml` (new)

```yaml
name: Collect GitHub Data

on:
  schedule:
    - cron: "13 5 * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: collect-data
  cancel-in-progress: false

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Generate snapshots
        run: npm run snapshots
        env:
          GITHUB_TOKEN: ${{ secrets.DASHBOARD_GITHUB_TOKEN }}

      - name: Push snapshots to data branch
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout --orphan data-staging
          git reset
          git add public/snapshots/
          git commit -m "chore: snapshots $(date -u +%Y-%m-%dT%H:%M:%SZ)"
          git push origin HEAD:data --force
```

### `.github/workflows/publish-pages.yml` (modified)

Key changes:
- Remove `schedule` trigger (pages rebuild is now driven by `workflow_run` from collect-data)
- Remove `Generate snapshots` step and `DASHBOARD_GITHUB_TOKEN` env
- Add sparse-checkout of `public/snapshots/` from `data` branch before build
- Add `workflow_run` trigger

```yaml
name: Publish GitHub Pages (static snapshots)

on:
  push:
    branches:
      - master
  workflow_run:
    workflows: ["Collect GitHub Data"]
    types: [completed]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages-publish
  cancel-in-progress: false

jobs:
  build-and-publish:
    runs-on: ubuntu-latest
    if: >
      github.event_name != 'workflow_run' ||
      github.event.workflow_run.conclusion == 'success'

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Checkout snapshots from data branch
        uses: actions/checkout@v4
        with:
          ref: data
          path: _data
          sparse-checkout: |
            public/snapshots
          sparse-checkout-cone-mode: false

      - name: Copy snapshots into public/
        run: cp -r _data/public/snapshots public/snapshots

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Remove runtime API routes (static export)
        run: rm -rf src/app/api

      - name: Build static export
        run: npm run build
        env:
          DEPLOY_TARGET: github-pages
          NEXT_PUBLIC_DEPLOY_TARGET: github-pages
          NEXT_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}
          GITHUB_PAGES_BASE_PATH: /${{ github.event.repository.name }}
          NEXT_PUBLIC_UPDATE_WORKFLOW_URL: https://github.com/${{ github.repository }}/actions/workflows/collect-data.yml

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: out

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### `README.md` (updated operational notes)

Update the Operational notes section to describe:
- Two-workflow model: `collect-data.yml` (data) vs `publish-pages.yml` (build)
- First-time setup: run `collect-data.yml` via workflow_dispatch before first pages deploy
- "Refresh data" = trigger `collect-data.yml` workflow_dispatch manually
- `DASHBOARD_GITHUB_TOKEN` is only required in `collect-data.yml`

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| `data` branch absent on first deploy | Document bootstrap step; optionally add a guard step in `publish-pages.yml` |
| `workflow_run` fires on failed collect | Job-level `if` condition on `conclusion == 'success'` |
| Stale data if `collect-data.yml` fails silently | GitHub Actions email notifications on workflow failure; data branch commit timestamp visible in repo |
| `NEXT_PUBLIC_UPDATE_WORKFLOW_URL` pointed at old workflow | Update to `collect-data.yml` URL in the build env vars |

## Sources & References

- Current workflow: [.github/workflows/publish-pages.yml](.github/workflows/publish-pages.yml)
- Snapshot script: [scripts/generate-snapshots.ts](scripts/generate-snapshots.ts:42)
- GitHub Actions `workflow_run` trigger docs: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_run
- GitHub Actions sparse-checkout: https://github.com/actions/checkout#sparse-checkout
