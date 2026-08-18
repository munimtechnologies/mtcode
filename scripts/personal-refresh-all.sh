#!/usr/bin/env bash
# Keep MT Code current on Mac + Blade + Dell.
# Source of truth: sheehanmunim/mtcode@main (git remote "fork" on this Mac).
# Builds the MT Code distro with the latest upstream nightly version string.
#
# Flow: push feature commits to fork/main → this job (launchd every 3h, or
# T3_FORCE_REBUILD=1) rebuilds Mac, builds Windows on Blade, installs on Dell.
set -euo pipefail

# /usr/local/bin carries the corepack shims — pnpm among them. launchd starts this job with a
# bare PATH, so leaving it out meant every scheduled rebuild died at "pnpm: command not found"
# and only hand-run rebuilds ever reached the build step.
export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
# Mac checkout uses "fork" → github.com/sheehanmunim/mtcode (not origin/pingdotgg).
PERSONAL_REMOTE="${T3_PERSONAL_REMOTE:-fork}"
PRODUCT_BRANCH="${T3_PRODUCT_BRANCH:-main}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
STATE="$LOG_DIR/last-built-sha"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/orchestrate-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate start ===="

cd "$REPO"
git fetch "$PERSONAL_REMOTE" "$PRODUCT_BRANCH"
NEW=$(git rev-parse "$PERSONAL_REMOTE/$PRODUCT_BRANCH")
OLD=$(cat "$STATE" 2>/dev/null || true)
echo "${PERSONAL_REMOTE}/$PRODUCT_BRANCH=$NEW previously=$OLD"

# This job never merges upstream and never rewrites local work (policy set 2026-08-18: upstream
# t3code is merged only when Sheehan explicitly hands the merge to an agent). It builds exactly
# what was pushed to fork/main, and it refuses to touch a checkout that has uncommitted or
# unpushed work — an agent session may be mid-task in this tree.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "checkout is dirty (uncommitted work in progress) — skipping this run" >&2
  exit 0
fi
git checkout "$PRODUCT_BRANCH"
if ! git merge --ff-only "$PERSONAL_REMOTE/$PRODUCT_BRANCH"; then
  echo "local $PRODUCT_BRANCH has diverged from ${PERSONAL_REMOTE}/$PRODUCT_BRANCH — not resetting; reconcile by hand" >&2
  exit 0
fi

if [[ "$NEW" == "$OLD" && -z "${T3_FORCE_REBUILD:-}" ]]; then
  echo "no changes — skipping rebuild"
  exit 0
fi

# Bake T3 Connect public client config into desktop artifacts (gitignored .env).
# Without this, hasCloudPublicConfig() is false and Connect UI is omitted.
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example for T3 Connect"
fi

# Match latest upstream nightly version string → Nightly icons + sidebar artwork
NIGHTLY_TAG=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty')
if [[ -z "$NIGHTLY_TAG" ]]; then
  echo "could not resolve latest nightly tag" >&2
  exit 1
fi
export T3CODE_DESKTOP_VERSION="${NIGHTLY_TAG#v}"
echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"

# The fleet ships MT Code branding on every machine (Windows side does the same
# in personal-refresh-win.ps1).
export T3CODE_DESKTOP_DISTRO=munim

# Align package versions like upstream's release workflow, so the bundled
# server and web report this nightly version instead of the stale package.json
# one. Without this, every nightly-track client (app.t3.codes → Settings →
# Update track: Nightly) shows "Server update available" against our servers.
node scripts/update-release-package-versions.ts "$T3CODE_DESKTOP_VERSION"

# --- Mac ---
echo "-- building Mac --"
pnpm dist:desktop:dmg:arm64

# The stamp is build input only; keep the checkout clean for the merge/push flow.
git checkout -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json

# Install + relaunch before Windows work so this Mac is never left shut while Blade builds.
/bin/bash "$REPO/scripts/personal-install-relaunch-mac.sh"

T3_FORCE_REBUILD=1 /bin/bash "$REPO/scripts/personal-refresh-windows.sh"

echo "$NEW" > "$STATE"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate done ===="
