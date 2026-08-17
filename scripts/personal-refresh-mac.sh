#!/usr/bin/env bash
# Refresh this Mac to latest personal fork, then push the same build to Blade + Dell.
# Pulls sheehanmunim/t3code personal via the "fork" remote, builds arm64 DMG,
# installs, relaunches (verified), then refreshes Windows.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
PERSONAL_REMOTE="${T3_PERSONAL_REMOTE:-fork}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) refresh start ===="

cd "$REPO"
git fetch "$PERSONAL_REMOTE" personal
git checkout personal
git reset --hard "$PERSONAL_REMOTE/personal"
echo "HEAD=$(git rev-parse --short HEAD) $(git log -1 --oneline)"

# Bake T3 Connect public client config into desktop artifacts (gitignored .env).
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example for T3 Connect"
fi

NIGHTLY_TAG=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty')
if [[ -z "$NIGHTLY_TAG" ]]; then
  echo "could not resolve latest nightly tag" >&2
  exit 1
fi
export T3CODE_DESKTOP_VERSION="${NIGHTLY_TAG#v}"
echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"

pnpm dist:desktop:dmg:arm64

/bin/bash "$REPO/scripts/personal-install-relaunch-mac.sh"

T3_FORCE_REBUILD=1 /bin/bash "$REPO/scripts/personal-refresh-windows.sh"

echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) refresh done ===="
