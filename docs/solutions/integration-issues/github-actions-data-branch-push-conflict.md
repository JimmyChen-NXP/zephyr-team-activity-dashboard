---
title: "GitHub Actions: data Branch Push Rejected After Concurrent Runs"
category: integration-issues
date: 2026-03-15
tags: [github-actions, git, orphan-branch, push-conflict, collect-data, collect-open-items]
---

# GitHub Actions: data Branch Push Rejected After Concurrent Runs

## Problem

The `collect-open-items` (and `collect-data`) GitHub Actions workflows fail with a push-rejected error when run after another workflow has already pushed to the `data` branch.

**Error:**

```
To github.com/org/repo.git
 ! [rejected]        HEAD -> data (fetch first)
error: failed to push some refs to 'github.com/org/repo.git'
hint: Updates were rejected because the remote contains work that you do not have locally.
```

**Symptom:** The workflow completes data collection successfully but fails at the final `git push` step, meaning the newly collected data is never persisted to the snapshot files.

---

## Root Cause

Both workflows check out the repo, write snapshot JSON files, and push to the orphan `data` branch. When two workflow runs complete in close succession (or when one is triggered manually after an automated run), the second push is rejected because the remote `data` branch has moved forward since the workflow started.

The original push command had no rebase step:

```yaml
# collect-open-items.yml (before fix)
- name: Commit and push
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add public/snapshots/
    git commit -m "chore: update open items snapshot" || echo "No changes"
    git push origin HEAD:data   # fails if remote has diverged
```

---

## Solution

Add `git pull --rebase origin data` immediately before `git push`. This replays the local commit on top of the latest remote state, avoiding the conflict.

```yaml
# collect-open-items.yml (after fix)
- name: Commit and push
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add public/snapshots/
    git commit -m "chore: update open items snapshot" || echo "No changes"
    git pull --rebase origin data   # <-- added
    git push origin HEAD:data
```

Apply the same fix to `collect-data.yml`.

**Why `--rebase` and not `--merge`:** The `data` branch is a pure data store — no manual commits, no feature branches, no merges. A linear rebase history is correct and keeps the log clean. `--merge` would create merge commits polluting the data log.

**Why not `--force`:** Force-pushing discards any concurrent writes from another workflow run that completed between this run's checkout and push. This could silently erase valid snapshot data.

---

## Prevention

- Any workflow that pushes to a shared persistent branch (like an orphan `data` branch) must include a pull-rebase before push.
- Use this pattern as the standard template for data-writing workflows:

```yaml
- name: Commit and push snapshot
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add public/snapshots/
    git commit -m "chore: update snapshot [skip ci]" || echo "No changes to commit"
    git pull --rebase origin data
    git push origin HEAD:data
```

- Add `[skip ci]` to automated commit messages to prevent recursive workflow triggers.
- If the rebase itself fails (rare, but possible if two runs touch the same file with conflicting content), the workflow will exit non-zero and leave a clear error — this is safer than silently overwriting.

---

## Related

- `.github/workflows/collect-data.yml` — same fix applied
- `.github/workflows/collect-open-items.yml` — primary fix location
- [docs/solutions/integration-issues/dashboard-token-invalid-env-precedence.md](docs/solutions/integration-issues/dashboard-token-invalid-env-precedence.md)
