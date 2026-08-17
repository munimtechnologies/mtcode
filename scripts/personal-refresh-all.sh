#!/usr/bin/env bash
# Keep personal fork apps current on Mac + Blade + Dell.
# Safe to run every few hours: no-ops when origin/personal has not moved.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
STATE="$LOG_DIR/last-built-sha"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/orchestrate-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate start ===="

cd "$REPO"
git fetch origin personal
NEW=$(git rev-parse origin/personal)
OLD=$(cat "$STATE" 2>/dev/null || true)
echo "origin/personal=$NEW previously=$OLD"

if [[ "$NEW" == "$OLD" ]]; then
  echo "no changes — skipping rebuild"
  exit 0
fi

git checkout personal
git reset --hard origin/personal

# --- Mac ---
echo "-- building Mac --"
pnpm dist:desktop:dmg:arm64
DMG=$(ls -1t "$REPO"/release/T3-Code-*-arm64.dmg | head -1)
MOUNT=$(hdiutil attach "$DMG" -nobrowse | awk 'END{for(i=3;i<=NF;i++) printf "%s%s", (i>3?" ":""), $i; print ""}')
APP=$(find "$MOUNT" -maxdepth 1 -name '*.app' -print | head -1)
pkill -f 'T3 Code' 2>/dev/null || true
sleep 1
rm -rf "/Applications/T3 Code (Nightly).app" "/Applications/T3 Code (Alpha).app"
cp -R "$APP" /Applications/
hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force || true
echo "Mac installed $(defaults read "/Applications/T3 Code (Alpha).app/Contents/Info" CFBundleShortVersionString)"

# --- Blade (build + install) ---
echo "-- refreshing Blade --"
scp -o BatchMode=yes "$REPO/scripts/personal-refresh-win.ps1" blade:dev/personal-refresh-win.ps1
ssh -o BatchMode=yes blade 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\muhha\dev\personal-refresh-win.ps1'

# --- Dell (install only from Blade-staged installer via this Mac) ---
echo "-- refreshing Dell --"
mkdir -p /tmp/t3-personal-installer
scp -o BatchMode=yes blade:dev/T3-Code-personal-x64.exe /tmp/t3-personal-installer/T3-Code-personal-x64.exe
scp -o BatchMode=yes /tmp/t3-personal-installer/T3-Code-personal-x64.exe dell:dev/T3-Code-personal-x64.exe
ssh -o BatchMode=yes dell 'powershell.exe -NoProfile -Command "
\$ErrorActionPreference=\"Stop\"
Get-Process | Where-Object { \$_.ProcessName -like \"*T3*\" } | Stop-Process -Force -ErrorAction SilentlyContinue
try { winget uninstall --id T3Tools.T3Code --silent --disable-interactivity | Out-Null } catch {}
\$u = \"\$env:LOCALAPPDATA\\Programs\\t3code\\Uninstall T3 Code (Nightly).exe\"
if (Test-Path \$u) { Start-Process \$u -ArgumentList \"/S\" -Wait }
Start-Process \"C:\\Users\\busin\\dev\\T3-Code-personal-x64.exe\" -ArgumentList \"/S\" -Wait
Start-Sleep 2
Start-Process \"\$env:LOCALAPPDATA\\Programs\\t3code\\T3 Code (Alpha).exe\"
Write-Output DELL_REFRESHED
"'

echo "$NEW" > "$STATE"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate done ===="
