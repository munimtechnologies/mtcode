#!/usr/bin/env bash
# Refresh this Mac to latest MT Code, then push the same build to Blade + Dell.
# Pulls munimtechnologies/mtcode main via the "fork" remote, builds arm64 DMG,
# installs, relaunches (verified), then refreshes Windows.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
PERSONAL_REMOTE="${T3_PERSONAL_REMOTE:-fork}"
PRODUCT_BRANCH="${T3_PRODUCT_BRANCH:-main}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) refresh start ===="

cd "$REPO"
git fetch "$PERSONAL_REMOTE" "$PRODUCT_BRANCH"
# Never rewrite local work (policy set 2026-08-18): fast-forward only, and leave a dirty or
# diverged checkout alone — an agent session may be mid-task in this tree.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "checkout is dirty (uncommitted work in progress) — skipping this run" >&2
  exit 0
fi
git checkout "$PRODUCT_BRANCH"
if ! git merge --ff-only "$PERSONAL_REMOTE/$PRODUCT_BRANCH"; then
  echo "local $PRODUCT_BRANCH has diverged from ${PERSONAL_REMOTE}/$PRODUCT_BRANCH — not resetting; reconcile by hand" >&2
  exit 0
fi
echo "HEAD=$(git rev-parse --short HEAD) $(git log -1 --oneline)"

# Bake Connect public client config into desktop artifacts (gitignored .env).
# ~/.mt/munim-connect.env (Munim-owned Clerk + relay identifiers) wins when
# present; otherwise fall back to T3's .env.example defaults as before.
# shellcheck source=lib/personal-munim-connect-env.sh
source "$REPO/scripts/lib/personal-munim-connect-env.sh"
munim_connect_load
if [[ "$MUNIM_CONNECT_ACTIVE" == 1 ]]; then
  munim_connect_write_repo_env "$REPO"
elif [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example for T3 Connect"
fi

# Single MT Code version: upstream base without the nightly prerelease.
# shellcheck source=lib/personal-mt-version.sh
source "$REPO/scripts/lib/personal-mt-version.sh"
personal_mt_export_desktop_version
echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"

# The fleet ships MT Code branding on every machine.
export T3CODE_DESKTOP_DISTRO=munim

# Align package versions like upstream's release workflow, so the bundled
# server and web report this version instead of the stale package.json one.
node scripts/update-release-package-versions.ts "$T3CODE_DESKTOP_VERSION"

pnpm dist:desktop:dmg:arm64

# The stamp is build input only; keep the checkout clean.
git checkout -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json

/bin/bash "$REPO/scripts/personal-install-relaunch-mac.sh"

T3_FORCE_REBUILD=1 /bin/bash "$REPO/scripts/personal-refresh-windows.sh"

echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) refresh done ===="
