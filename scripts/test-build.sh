#!/usr/bin/env bash
# test-build.sh — simulate the publish-pages CI workflow locally.
#
# Usage:
#   bash scripts/test-build.sh
#
# What it does (mirrors publish-pages.yml exactly):
#   1. Copies snapshots from _data/public/snapshots → public/snapshots
#   2. Removes src/app/api  (static export requires no runtime routes)
#   3. Runs `npm run build`
#   4. Restores src/app/api from git so your working tree is clean
#
# Prerequisites:
#   - _data/ must exist and contain public/snapshots/
#     (run `bash scripts/seed-data.sh` first if you don't have it yet,
#      or just `git clone --branch data ... _data`)
#   - npm ci already run

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Validate _data/
# ---------------------------------------------------------------------------
if [[ ! -d "_data/public/snapshots" ]]; then
  echo "ERROR: _data/public/snapshots not found." >&2
  echo "       Run:  bash scripts/seed-data.sh" >&2
  echo "       Or:   git clone --branch data \$(git remote get-url origin) _data" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Copy snapshots (same as CI step)
# ---------------------------------------------------------------------------
echo "[test-build] Copying snapshots..."
mkdir -p public
rm -rf public/snapshots
cp -r _data/public/snapshots public/snapshots
echo "[test-build] Copied $(find public/snapshots -name '*.json' | wc -l) snapshot files."

# ---------------------------------------------------------------------------
# 3. Remove API routes (static export has no server)
# ---------------------------------------------------------------------------
echo "[test-build] Removing src/app/api (static export)..."
rm -rf src/app/api

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------
echo "[test-build] Running npm run build..."
# MSYS_NO_PATHCONV=1 prevents Git Bash on Windows from translating /ccode into
# a Windows absolute path (e.g. C:/Program Files/Git/ccode), which would cause
# Next.js to fail with "Missing parameter name at 2" from path-to-regexp.
MSYS_NO_PATHCONV=1 \
DEPLOY_TARGET=github-pages \
NEXT_PUBLIC_DEPLOY_TARGET=github-pages \
NEXT_PUBLIC_BASE_PATH=/ccode \
GITHUB_PAGES_BASE_PATH=/ccode \
NEXT_PUBLIC_UPDATE_WORKFLOW_URL=https://github.com/local/test/actions/workflows/collect-data.yml \
  npm run build

BUILD_EXIT=$?

# ---------------------------------------------------------------------------
# 5. Restore src/app/api from git
# ---------------------------------------------------------------------------
echo "[test-build] Restoring src/app/api..."
git checkout -- src/app/api 2>/dev/null || true

if [[ $BUILD_EXIT -eq 0 ]]; then
  echo ""
  echo "[test-build] Build succeeded. Output is in out/"
else
  echo ""
  echo "[test-build] Build FAILED (exit $BUILD_EXIT)." >&2
  exit $BUILD_EXIT
fi
