#!/usr/bin/env bash
# Push the personal Windows build to Blade (build+install) and Dell (install+relaunch).
# Called after a Mac personal install so the fleet stays on the same fork commit.
#
# Requires: SSH hosts `blade` and `dell` (Dell may fall back via Blade LAN).
# Optional env:
#   T3CODE_DESKTOP_VERSION  nightly version string (resolved from upstream if unset)
#   T3_PERSONAL_REPO       default $HOME/dev/t3code
#   T3_FORCE_REBUILD=1     force Blade rebuild even when SHA unchanged (default 1 here)
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"

if [[ -z "${T3CODE_DESKTOP_VERSION:-}" ]]; then
  NIGHTLY_TAG=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty')
  if [[ -z "$NIGHTLY_TAG" ]]; then
    echo "could not resolve latest nightly tag" >&2
    exit 1
  fi
  export T3CODE_DESKTOP_VERSION="${NIGHTLY_TAG#v}"
fi
echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"

# --- Blade (build + install) ---
echo "-- refreshing Blade --"
# Mirror the Mac's Munim Connect config (public identifiers only) so Blade's
# clone bakes the same values; absent file means unchanged T3 defaults.
# shellcheck source=lib/personal-munim-connect-env.sh
source "$REPO/scripts/lib/personal-munim-connect-env.sh"
munim_connect_sync_to_windows_host blade
scp -o BatchMode=yes "$REPO/scripts/personal-refresh-win.ps1" blade:dev/personal-refresh-win.ps1
# Beside it: both Windows machines launch through this, so that the app lands in the logged-on
# user's session rather than in session 0, where it runs with no window on any screen.
scp -o BatchMode=yes "$REPO/scripts/personal-launch-gui.ps1" blade:dev/personal-launch-gui.ps1
# Pass version/force as -File args (cmd env inheritance to PowerShell is unreliable over SSH).
ssh -o BatchMode=yes blade powershell.exe -NoProfile -ExecutionPolicy Bypass -File \
  C:/Users/muhha/dev/personal-refresh-win.ps1 \
  -DesktopVersion "$T3CODE_DESKTOP_VERSION" \
  -ForceRebuild "${T3_FORCE_REBUILD:-1}"

# --- Dell (install only from Blade-staged installer via this Mac) ---
# One machine being off, asleep, or behind a tunnel that is not up must not undo the refresh for
# the others: reaching Dell used to be the last thing that could kill the run outright.
refresh_dell() {
  mkdir -p /tmp/t3-personal-installer || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 blade:dev/MT-Code-x64.exe \
    /tmp/t3-personal-installer/MT-Code-x64.exe || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 /tmp/t3-personal-installer/MT-Code-x64.exe \
    dell:dev/MT-Code-x64.exe || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-refresh-dell.ps1" \
    dell:dev/personal-refresh-dell.ps1 || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-launch-gui.ps1" \
    dell:dev/personal-launch-gui.ps1 || return 1
  ssh -o BatchMode=yes -o ConnectTimeout=30 dell powershell.exe -NoProfile -ExecutionPolicy Bypass \
    -File C:/Users/busin/dev/personal-refresh-dell.ps1 || return 1
}

# Blade is on the same LAN as Dell and holds the same key, so when the tunnel from this Mac is
# down Blade can still reach it.
refresh_dell_via_blade() {
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-refresh-dell-via-blade.ps1" \
    blade:dev/personal-refresh-dell-via-blade.ps1 || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-refresh-dell.ps1" \
    blade:dev/personal-refresh-dell.ps1 || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-launch-gui.ps1" \
    blade:dev/personal-launch-gui.ps1 || return 1
  ssh -o BatchMode=yes -o ConnectTimeout=60 blade powershell.exe -NoProfile -ExecutionPolicy Bypass \
    -File C:/Users/muhha/dev/personal-refresh-dell-via-blade.ps1 || return 1
}

echo "-- refreshing Dell --"
if refresh_dell; then
  echo "Dell refreshed"
elif refresh_dell_via_blade; then
  echo "Dell refreshed over the LAN from Blade"
else
  echo "Dell could not be reached, directly or through Blade — skipped." >&2
fi

# After both Windows installs, push Mac preference files to Blade + Dell.
echo "-- syncing settings Mac → Blade/Dell --"
/bin/bash "$REPO/scripts/personal-sync-settings.sh"
