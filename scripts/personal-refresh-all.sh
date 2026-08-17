#!/usr/bin/env bash
# Keep personal fork apps current on Mac + Blade + Dell.
# Source of truth: sheehanmunim/t3code@personal (git remote "fork" on this Mac).
# Builds with latest upstream nightly version so logo/artwork are Nightly,
# but product name stays "T3 Code".
#
# Flow: push feature commits to fork/personal → this job (launchd every 3h, or
# T3_FORCE_REBUILD=1) rebuilds Mac, builds Windows on Blade, installs on Dell.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
# Mac checkout uses "fork" → github.com/sheehanmunim/t3code (not origin/pingdotgg).
PERSONAL_REMOTE="${T3_PERSONAL_REMOTE:-fork}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
STATE="$LOG_DIR/last-built-sha"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/orchestrate-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate start ===="

cd "$REPO"
git fetch "$PERSONAL_REMOTE" personal
NEW=$(git rev-parse "$PERSONAL_REMOTE/personal")
OLD=$(cat "$STATE" 2>/dev/null || true)
echo "${PERSONAL_REMOTE}/personal=$NEW previously=$OLD"

if [[ "$NEW" == "$OLD" && -z "${T3_FORCE_REBUILD:-}" ]]; then
  echo "no changes — skipping rebuild"
  exit 0
fi

git checkout personal
git reset --hard "$PERSONAL_REMOTE/personal"

# Match latest upstream nightly version string → Nightly icons + sidebar artwork
NIGHTLY_TAG=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty')
if [[ -z "$NIGHTLY_TAG" ]]; then
  echo "could not resolve latest nightly tag" >&2
  exit 1
fi
export T3CODE_DESKTOP_VERSION="${NIGHTLY_TAG#v}"
echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"

# --- Mac ---
echo "-- building Mac --"
pnpm dist:desktop:dmg:arm64
DMG=$(ls -1t "$REPO"/release/T3-Code-*-arm64.dmg | head -1)
MOUNT=$(hdiutil attach "$DMG" -nobrowse | awk 'END{for(i=3;i<=NF;i++) printf "%s%s", (i>3?" ":""), $i; print ""}')
APP=$(find "$MOUNT" -maxdepth 1 -name '*.app' -print | head -1)
pkill -f 'T3 Code' 2>/dev/null || true
sleep 1
rm -rf "/Applications/T3 Code (Nightly).app" "/Applications/T3 Code (Alpha).app" "/Applications/T3 Code.app"
cp -R "$APP" /Applications/
hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force || true
INSTALLED_APP=$(find /Applications -maxdepth 1 -name 'T3 Code*.app' -print | head -1)
echo "Mac installed: $INSTALLED_APP ($(defaults read "$INSTALLED_APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || true))"
echo "Mac name: $(defaults read "$INSTALLED_APP/Contents/Info" CFBundleName 2>/dev/null || true)"

# --- Blade (build + install) ---
echo "-- refreshing Blade --"
scp -o BatchMode=yes "$REPO/scripts/personal-refresh-win.ps1" blade:dev/personal-refresh-win.ps1
# Pass version/force as -File args (cmd env inheritance to PowerShell is unreliable over SSH).
ssh -o BatchMode=yes blade powershell.exe -NoProfile -ExecutionPolicy Bypass -File \
  C:/Users/muhha/dev/personal-refresh-win.ps1 \
  -DesktopVersion "$T3CODE_DESKTOP_VERSION" \
  -ForceRebuild 1

# --- Dell (install only from Blade-staged installer via this Mac) ---
echo "-- refreshing Dell --"
mkdir -p /tmp/t3-personal-installer
scp -o BatchMode=yes blade:dev/T3-Code-personal-x64.exe /tmp/t3-personal-installer/T3-Code-personal-x64.exe
scp -o BatchMode=yes /tmp/t3-personal-installer/T3-Code-personal-x64.exe dell:dev/T3-Code-personal-x64.exe
ssh -o BatchMode=yes dell 'powershell.exe -NoProfile -Command "
$ErrorActionPreference=\"Stop\"
Get-Process | Where-Object { $_.ProcessName -like \"*T3*\" } | Stop-Process -Force -ErrorAction SilentlyContinue
try { winget uninstall --id T3Tools.T3Code --silent --disable-interactivity | Out-Null } catch {}
foreach ($name in @(\"Uninstall T3 Code (Nightly).exe\",\"Uninstall T3 Code (Alpha).exe\",\"Uninstall T3 Code.exe\")) {
  $u = Join-Path $env:LOCALAPPDATA \"Programs\\t3code\\$name\"
  if (Test-Path $u) { Start-Process $u -ArgumentList \"/S\" -Wait }
}
Start-Process \"C:\\Users\\busin\\dev\\T3-Code-personal-x64.exe\" -ArgumentList \"/S\" -Wait
Start-Sleep 2
$exe = Get-ChildItem \"$env:LOCALAPPDATA\\Programs\\t3code\\T3 Code*.exe\" | Where-Object { $_.Name -notlike \"Uninstall*\" } | Select-Object -First 1
if ($exe) { Start-Process $exe.FullName }
Write-Output (\"DELL_REFRESHED \" + $exe.Name)
"'

echo "$NEW" > "$STATE"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate done ===="
