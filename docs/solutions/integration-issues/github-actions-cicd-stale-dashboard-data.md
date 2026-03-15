---
title: "GitHub Actions deploy: stale snapshots and blank PR columns from cp -r nesting, working-directory mismatch, and sequential workflow ordering"
category: integration-issues
date: 2026-03-15
tags: [github-actions, github-pages, cp-r, working-directory, git, next-js, snapshot, prStatus, orphan-branch, static-export]
---

# GitHub Actions Deploy: Stale Snapshots and Blank PR Columns

## Problem

A GitHub Pages dashboard (Next.js 15 static export) showed stale data and blank columns despite multiple workflow runs:

- **Assignees/Reviewers columns**: all `—` (dashes) for every PR row
- **Header timestamp**: `Generated 2026-03-14 10:17:22 · Connection checked about 23 hours ago`
- Hard browser-cache clears confirmed it was not a browser issue
- Problem persisted after multiple manual and scheduled workflow runs

---

## Root Cause 1: `cp -r` Dest-Exists Nesting

The deploy job had:

```yaml
- name: Copy snapshots into public/
  run: mkdir -p public && cp -r _data/public/snapshots public/snapshots
```

Master's checkout had already created `public/snapshots/` (committed snapshot files). When `cp -r src dest` is called and `dest` already exists as a directory, cp places the source directory **inside** the destination rather than merging into it.

```
# What actually happened:
public/snapshots/snapshots/30d.json   ← data-branch files (IGNORED by build)
public/snapshots/30d.json             ← master's stale committed file, prStatus: null (USED by build)
```

Next.js build read `public/snapshots/*.json` — the master-committed stale files — while the current data-branch files sat silently nested one level too deep.

### Fix

```yaml
- name: Copy snapshots into public/
  run: mkdir -p public/snapshots && cp _data/public/snapshots/*.json public/snapshots/
```

---

## Root Cause 2: `working-directory` + Path-Relative Check Conflict

The `collect-daily` push step combined `working-directory: _data` with a path check that assumed the repo root as CWD:

```yaml
- name: Push daily files to data branch
  run: |
    if [ -d "_data/.git" ]; then   # BUG: looks for _data/_data/.git
      cd _data
      ...
    else
      ORIGIN_URL=$(git -C .. remote get-url origin)
      cd _data
      git init                        # re-initializes already-checked-out repo
      git remote add origin "$ORIGIN_URL"   # fails: remote origin already exists
      ...
    fi
  working-directory: _data   # ← causes the path mismatch
```

Error seen in Actions log:
```
Reinitialized existing Git repository in .../_data/.git/
error: remote origin already exists.
Error: Process completed with exit code 3.
```

### Fix

Remove `working-directory: _data`; use an explicit `cd _data` inside the script so the path check and the working directory are consistent:

```yaml
- name: Push daily files to data branch
  run: |
    if [ -d "_data/.git" ]; then   # now correctly checks from repo root
      cd _data
      ...
    else
      ORIGIN_URL=$(git remote get-url origin)
      cd _data
      git init
      git remote add origin "$ORIGIN_URL"
      ...
    fi
  # no working-directory key
```

---

## Root Cause 3: `git -C ..` Wrong at Repo Root

Inside the else branch, the origin URL was retrieved with:

```bash
ORIGIN_URL=$(git -C .. remote get-url origin)
```

With the script running at the repo root, `-C ..` ascended to the parent of the repository where no git repo exists, causing the URL lookup to fail.

### Fix

```bash
ORIGIN_URL=$(git remote get-url origin)   # no -C needed at repo root
```

---

## Root Cause 4: Sequential Pipeline Design Causing `prStatus: null` Deployments

The old three-workflow fan-out had a race condition:

```
[05:13 UTC] collect-data.yml
              └─ aggregate-daily (NO open-items.json) → prStatus: null in all snapshots
              └─► publish-pages fires → DEPLOYS WITH prStatus: null

[05:23 UTC] collect-open-items.yml
              └─ aggregate-daily (WITH open-items.json) → prStatus populated
              └─► publish-pages fires → second deploy (correct) — but first is already live
```

### Fix

Single `collect-and-deploy.yml` with `needs:` sequential jobs:

```yaml
jobs:
  collect-daily:
    if: github.event_name != 'push'
    # Collects daily files only — does NOT run aggregate-daily

  collect-open-items:
    needs: collect-daily
    if: github.event_name != 'push'
    # Collects open items, THEN runs aggregate-daily ONCE with all data present

  deploy:
    needs: [collect-open-items]
    if: >
      always() && (
        needs.collect-open-items.result == 'success' ||
        needs.collect-open-items.result == 'skipped'
      )
    # Sparse-checks out snapshots from data branch, builds, deploys
```

`if: github.event_name != 'push'` on collection jobs allows a push to master to trigger a deploy-only run (using existing data-branch snapshots) without re-collecting.

---

## Prevention

- [ ] **`cp -r` destination discipline**: Never use `cp -r src dest` when `dest` already exists and you intend a merge/overwrite. Use `cp src/*.json dest/` or `rsync -a src/ dest/` to copy contents without nesting.
- [ ] **Resolve paths against `working-directory`**: When a step sets `working-directory: X`, all relative paths in that step's `run` block are already rooted at `X`. Either strip the leading path component from checks (e.g., `[ -d ".git" ]` not `[ -d "X/.git" ]`) or remove `working-directory` and use explicit `cd`.
- [ ] **`git -C` is for changing context, not stacking it**: Use `git -C <path>` only when the shell is NOT already at that path. If already at repo root, call `git` directly.
- [ ] **Gate steps on `needs:` dependencies**: Any step that consumes a generated file must declare a `needs:` dependency on the step that produces it. Assert file existence before proceeding: `test -f open-items.json || { echo "missing prerequisite"; exit 1; }`.
- [ ] **Don't commit build-output directories that are also CI copy targets**: If `public/snapshots/` is written by CI, either remove it from version control or ensure the copy step overwrites at the correct level. Committed stale files silently win when the `cp -r` lands in the wrong place.

---

## Verification

Check that `cp` landed files at the correct depth (no spurious nesting):

```sh
# Should list .json files directly, NOT a nested snapshots/ subdirectory
ls public/snapshots/
test -d public/snapshots/snapshots && echo "NESTED — cp bug present" || echo "OK"
```

Confirm the `.git` directory check resolves correctly relative to the actual CWD:

```sh
# Simulate what the step sees with working-directory: _data
(cd _data && [ -d ".git" ] && echo "found at .git" || echo "not found")
```

Validate snapshots have prStatus populated before deploy:

```sh
grep -r '"prStatus": null' public/snapshots/ && echo "NULL prStatus — race condition" || echo "OK"
```

---

## Related

- [docs/solutions/integration-issues/github-actions-data-branch-push-conflict.md](github-actions-data-branch-push-conflict.md) — push rejected after concurrent runs; `git pull --rebase` fix
- [docs/solutions/integration-issues/local-dev-snapshot-missing-prstatus-field.md](local-dev-snapshot-missing-prstatus-field.md) — local `.data/snapshots/` diverging from data branch; prStatus null in dev
- [docs/solutions/logic-errors/dual-data-path-pr-status-divergence.md](../logic-errors/dual-data-path-pr-status-divergence.md) — two snapshot data paths and how they diverge
- [docs/plans/2026-03-15-001-fix-github-pages-stale-data-pipeline-plan.md](../../plans/2026-03-15-001-fix-github-pages-stale-data-pipeline-plan.md) — full pipeline redesign plan
- [.github/workflows/collect-and-deploy.yml](../../../.github/workflows/collect-and-deploy.yml) — the fixed sequential workflow
