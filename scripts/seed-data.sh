#!/usr/bin/env bash
# seed-data.sh — collect GitHub activity locally and push to the remote data branch.
#
# Usage:
#   bash scripts/seed-data.sh FROM_DATE TO_DATE
#   bash scripts/seed-data.sh 2026-03-01 2026-03-12
#
# Both dates are inclusive YYYY-MM-DD.  If omitted, defaults to D-2..D-1
# (yesterday + the day before), same as the daily CI job.
#
# Prerequisites:
#   1. GITHUB_TOKEN set in .env.local (or exported in your shell).
#   2. npm ci already run (node_modules present).
#   3. Git remote "origin" pointing to the repo.
#
# What it does:
#   1. Checks out (or clones) the remote data branch into _data/.
#   2. Runs collect-daily for every date in FROM..TO that is not yet present.
#   3. Runs aggregate-daily to rebuild snapshots.
#   4. Commits and pushes the new files to origin/data.

set -euo pipefail

# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------
yesterday() { date -u -d "yesterday" +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d; }
day_before_yesterday() { date -u -d "2 days ago" +%Y-%m-%d 2>/dev/null || date -u -v-2d +%Y-%m-%d; }
next_day() { date -u -d "$1 + 1 day" +%Y-%m-%d 2>/dev/null || date -u -j -f "%Y-%m-%d" -v+1d "$1" +%Y-%m-%d; }

FROM="${1:-$(day_before_yesterday)}"
TO="${2:-$(yesterday)}"

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------
if [[ ! "$FROM" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "ERROR: from_date '$FROM' is not in YYYY-MM-DD format" >&2; exit 1
fi
if [[ ! "$TO" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "ERROR: to_date '$TO' is not in YYYY-MM-DD format" >&2; exit 1
fi
if [[ "$FROM" > "$TO" ]]; then
  echo "ERROR: from_date '$FROM' is after to_date '$TO'" >&2; exit 1
fi

YESTERDAY="$(yesterday)"
if [[ "$TO" > "$YESTERDAY" ]]; then
  echo "ERROR: to_date '$TO' must be $YESTERDAY or earlier (only fully-completed UTC days)" >&2; exit 1
fi

echo "[seed-data] Range: $FROM .. $TO"

# ---------------------------------------------------------------------------
# Load .env.local (if present) without overwriting already-exported vars
# ---------------------------------------------------------------------------
if [[ -f ".env.local" ]]; then
  set -o allexport
  # Strip comments and blank lines, then source
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' .env.local | grep -v '^\s*$')
  set +o allexport
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: GITHUB_TOKEN is not set. Add it to .env.local or export it." >&2; exit 1
fi

if [[ -z "${GITHUB_REPOS:-}" ]]; then
  echo "ERROR: GITHUB_REPOS is not set. Add it to .env.local or export it." >&2; exit 1
fi

# ---------------------------------------------------------------------------
# Build comma-separated date list
# ---------------------------------------------------------------------------
DATES=""
current="$FROM"
while [[ "$current" < "$TO" || "$current" == "$TO" ]]; do
  DATES="${DATES:+$DATES,}$current"
  current="$(next_day "$current")"
done
echo "[seed-data] Dates to collect: $DATES"

# ---------------------------------------------------------------------------
# Setup _data/ from the remote data branch
# ---------------------------------------------------------------------------
REPO_URL="$(git remote get-url origin)"

if [[ -d "_data/.git" ]]; then
  echo "[seed-data] Updating existing _data/ from origin/data..."
  (cd _data && git fetch origin && git reset --hard origin/data) || \
    echo "[seed-data] Could not update _data/ (data branch may not exist yet on remote — that's OK for first run)"
else
  # Remove any stale non-git _data/ left from a previous failed run
  if [[ -d "_data" ]]; then
    echo "[seed-data] Removing stale _data/ (not a git repo)..."
    rm -rf _data
  fi
  echo "[seed-data] Cloning data branch into _data/..."
  if ! git clone --branch data --single-branch "$REPO_URL" _data; then
    echo "[seed-data] data branch not found on remote — will create it on push"
    mkdir -p _data/public
  fi
fi

mkdir -p _data/public/daily _data/public/snapshots

# ---------------------------------------------------------------------------
# Collect
# ---------------------------------------------------------------------------
echo "[seed-data] Running collect-daily..."
DAILY_OUT_DIR=_data/public \
DAILY_OVERRIDE_DATES="$DATES" \
SEARCH_PAGE_LIMIT="${SEARCH_PAGE_LIMIT:-2}" \
GITHUB_SEARCH_MIN_INTERVAL_MS="${GITHUB_SEARCH_MIN_INTERVAL_MS:-2500}" \
  npm run collect-daily

# ---------------------------------------------------------------------------
# Aggregate
# ---------------------------------------------------------------------------
echo "[seed-data] Running aggregate-daily..."
DAILY_IN_DIR=_data/public \
SNAPSHOT_OUT_DIR=_data/public \
  npm run aggregate-daily

# ---------------------------------------------------------------------------
# Push to data branch
# ---------------------------------------------------------------------------
echo "[seed-data] Pushing to origin/data..."

if [[ -d "_data/.git" ]]; then
  cd _data
  git config user.name "seed-data-local"
  git config user.email "seed-data-local@localhost"
  git add -f public/daily/ public/snapshots/ 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "[seed-data] Nothing new to commit (all dates already existed)."
  else
    git commit -m "chore: local seed $FROM..$TO $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    git push origin HEAD:data
    echo "[seed-data] Pushed to origin/data."
  fi
  cd ..
else
  # First run — _data/ is a plain directory (no remote data branch yet).
  # Initialize a standalone git repo inside _data/ and push as the data branch.
  cd _data
  git init
  git config user.name "seed-data-local"
  git config user.email "seed-data-local@localhost"
  git remote add origin "$REPO_URL"
  git add -f public/daily/ public/snapshots/ 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "[seed-data] Nothing to commit on first run."
  else
    git commit -m "chore: local seed $FROM..$TO $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    git push origin HEAD:data
    echo "[seed-data] Bootstrapped and pushed origin/data."
  fi
  cd ..
fi

echo "[seed-data] Done."
