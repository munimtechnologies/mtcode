#!/usr/bin/env bash
# One command: publish MT Code and install it on the Mac, Blade and Dell.
#
# Order is chosen for wall-clock time, not simplicity:
#   1. publish builds Windows on Blade and the Mac DMG at the same time
#   2. Blade and Dell install the exe the publish just built (no second rebuild)
#   3. the Mac installs last, because installing quits the app — and when this
#      runs from an agent shell inside MT Code, that quit would kill the run,
#      so the Mac step is handed to launchd with a short delay instead.
#
# Env:
#   T3_FLEET_SKIP_MAC_INSTALL=1   publish + Windows only
#   T3_FLEET_MAC_DELAY_SECONDS    delay before the detached Mac install (default 60)
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
mkdir -p "$LOG_DIR"
STARTED=$(date +%s)
stamp() { echo "[$(date -u +%H:%M:%S) +$(( $(date +%s) - STARTED ))s] $*"; }

cd "$REPO"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "refusing to release from a dirty checkout:" >&2
  git status --short >&2
  exit 1
fi
if [[ -n "$(git rev-list HEAD..fork/main 2>/dev/null)" ]]; then
  echo "local main is behind fork/main; pull first" >&2
  exit 1
fi
if [[ -n "$(git rev-list fork/main..HEAD 2>/dev/null)" ]]; then
  echo "HEAD has commits not on fork/main; push first (Blade builds from fork/main)" >&2
  exit 1
fi

# The publish resolves the next free version itself; a version inherited from
# the running app would republish an existing tag.
unset T3CODE_DESKTOP_VERSION
# shellcheck source=lib/personal-mt-version.sh
source "$REPO/scripts/lib/personal-mt-version.sh"
T3_MT_VERSION_NEXT=1 personal_mt_export_desktop_version
VERSION="$T3CODE_DESKTOP_VERSION"
unset T3CODE_DESKTOP_VERSION
SHA=$(git rev-parse HEAD)
stamp "releasing MT Code $VERSION from ${SHA:0:10}"

# The 3-hourly refresh would otherwise fire on the new commit and race this run.
REFRESH_LABEL="codes.t3.personal.refresh"
REFRESH_PLIST="$HOME/Library/LaunchAgents/$REFRESH_LABEL.plist"
launchctl bootout "gui/$(id -u)/$REFRESH_LABEL" 2>/dev/null || true
restore_refresh() {
  echo "$SHA" >"$LOG_DIR/last-built-sha"
  launchctl bootstrap "gui/$(id -u)" "$REFRESH_PLIST" 2>/dev/null || true
}
trap restore_refresh EXIT

# Never build on top of a stale bundle from an interrupted run.
rm -rf "$REPO/apps/web/dist" "$REPO/node_modules/.vite" "$REPO/.turbo"

stamp "publishing (Mac + Windows in parallel)"
PUBLISH_LOG="$LOG_DIR/publish-munim-$(date +%Y%m%d).log"
if ! env -u T3CODE_DESKTOP_VERSION bash "$REPO/scripts/personal-publish-github-release.sh"; then
  echo "publish failed — see $PUBLISH_LOG" >&2
  exit 1
fi
stamp "published munim-v$VERSION"

WIN_USER="${T3_MUNIM_WIN_USER:-muhha}"
WIN_INSTALLER="C:/Users/$WIN_USER/dev/t3code-personal/release/MT-Code-$VERSION-x64.exe"
stamp "installing on Blade + Dell from $WIN_INSTALLER"
T3CODE_DESKTOP_VERSION="$VERSION" T3_WIN_INSTALLER="$WIN_INSTALLER" T3_BUILT_SHA="$SHA" \
  bash "$REPO/scripts/personal-refresh-windows.sh"
stamp "Windows fleet done"

DMG="$REPO/release/MT-Code-$VERSION-arm64.dmg"
if [[ "${T3_FLEET_SKIP_MAC_INSTALL:-}" == "1" ]]; then
  stamp "skipping Mac install (T3_FLEET_SKIP_MAC_INSTALL=1); DMG at $DMG"
  exit 0
fi
[[ -f "$DMG" ]] || { echo "Mac DMG missing: $DMG" >&2; exit 1; }

# Inside MT Code the install must outlive this shell: MT Code kills its whole
# descendant tree on quit, nohup included. launchd is the only parent that
# survives, so hand the install over with a delay long enough to report back.
DELAY="${T3_FLEET_MAC_DELAY_SECONDS:-60}"
if [[ -n "${T3CODE_APP_DISPLAY_NAME:-}" ]] || pgrep -qx "MT Code" 2>/dev/null; then
  MAC_LOG="$LOG_DIR/mac-install-$VERSION.log"
  launchctl remove codes.t3.personal.macinstall.once 2>/dev/null || true
  launchctl submit -l codes.t3.personal.macinstall.once -- /bin/bash -c \
    "sleep $DELAY; env -u T3CODE_DESKTOP_VERSION -u T3_MAC_INSTALL_WORKER bash '$REPO/scripts/personal-install-relaunch-mac.sh' '$DMG' > '$MAC_LOG' 2>&1; launchctl remove codes.t3.personal.macinstall.once"
  stamp "Mac install scheduled in ${DELAY}s via launchd (log $MAC_LOG); MT Code will quit and relaunch"
else
  stamp "installing on this Mac"
  env -u T3CODE_DESKTOP_VERSION -u T3_MAC_INSTALL_WORKER bash "$REPO/scripts/personal-install-relaunch-mac.sh" "$DMG"
  stamp "Mac done"
fi
