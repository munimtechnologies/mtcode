#!/usr/bin/env bash
# Push the personal Windows build to Blade (build+install) and Dell (install+relaunch).
# Called after a Mac personal install so the fleet stays on the same fork commit.
#
# Requires: SSH hosts `blade` and `dell` (Dell may fall back via Blade LAN).
# Optional env:
#   T3CODE_DESKTOP_VERSION  single MT Code version (resolved from upstream base if unset)
#   T3_PERSONAL_REPO       default $HOME/dev/t3code
#   T3_FORCE_REBUILD=1     force Blade rebuild even when SHA unchanged (default 1 here)
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"

# shellcheck source=lib/personal-mt-version.sh
source "$REPO/scripts/lib/personal-mt-version.sh"
personal_mt_export_desktop_version
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
# -File args do NOT reliably survive ssh -> cmd -> PowerShell: on 2026-08-28 the
# refresh logged "args DesktopVersion= ForceRebuild=" and Blade fell back to
# resolving the version from its own clone, building 0.0.36 while the release
# was 0.0.39. EncodedCommand (base64 UTF-16LE) is the one form cmd cannot chew
# up, so build the whole invocation and hand it over pre-encoded.
ps_encoded_command() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n'
}

blade_refresh_cmd="\$env:T3CODE_DESKTOP_VERSION='$T3CODE_DESKTOP_VERSION'; \
\$env:T3_FORCE_REBUILD='${T3_FORCE_REBUILD:-1}'; \
& 'C:/Users/muhha/dev/personal-refresh-win.ps1' \
-DesktopVersion '$T3CODE_DESKTOP_VERSION' \
-ForceRebuild '${T3_FORCE_REBUILD:-1}'"
ssh -o BatchMode=yes blade powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -EncodedCommand "$(ps_encoded_command "$blade_refresh_cmd")"

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
