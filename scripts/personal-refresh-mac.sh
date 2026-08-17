#!/usr/bin/env bash
# Refresh this Mac to latest personal fork (upstream nightly + CU/History).
# Pulls sheehanmunim/t3code personal via the "fork" remote, builds arm64 DMG,
# installs, removes Nightly/Alpha leftovers.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:$PATH"
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

pnpm dist:desktop:dmg:arm64

DMG=$(ls -1t "$REPO"/release/T3-Code-*-arm64.dmg | head -1)
echo "Installing $DMG"
MOUNT=$(hdiutil attach "$DMG" -nobrowse | awk 'END{for(i=3;i<=NF;i++) printf "%s%s", (i>3?" ":""), $i; print ""}')
APP=$(find "$MOUNT" -maxdepth 1 -name '*.app' -print | head -1)
pkill -f 'T3 Code' 2>/dev/null || true
sleep 1
rm -rf "/Applications/T3 Code (Nightly).app" "/Applications/T3 Code (Alpha).app" "/Applications/T3 Code.app"
cp -R "$APP" /Applications/
hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force || true

INSTALLED_APP=$(find /Applications -maxdepth 1 -name 'T3 Code*.app' -print | head -1)
echo "Installed: $INSTALLED_APP ($(defaults read "$INSTALLED_APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || true))"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) refresh done ===="
