#!/usr/bin/env bash
# Keep personal fork apps current on Mac + Blade + Dell.
# Source of truth: sheehanmunim/t3code@personal (git remote "fork" on this Mac).
# Builds with latest upstream nightly version so logo/artwork are Nightly,
# but product name stays "T3 Code".
#
# Flow: push feature commits to fork/personal → this job (launchd every 3h, or
# T3_FORCE_REBUILD=1) rebuilds Mac, builds Windows on Blade, installs on Dell.
set -euo pipefail

# /usr/local/bin carries the corepack shims — pnpm among them. launchd starts this job with a
# bare PATH, so leaving it out meant every scheduled rebuild died at "pnpm: command not found"
# and only hand-run rebuilds ever reached the build step.
export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
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
# Upstream too, because the fork is meant to stay level with it rather than drift: the fork being
# unchanged is no longer a reason to skip a run, since upstream may have moved instead.
UPSTREAM_REMOTE="${T3_UPSTREAM_REMOTE:-origin}"
UPSTREAM_BRANCH="${T3_UPSTREAM_BRANCH:-main}"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
NEW=$(git rev-parse "$PERSONAL_REMOTE/personal")
UPSTREAM_HEAD=$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
OLD=$(cat "$STATE" 2>/dev/null || true)
echo "${PERSONAL_REMOTE}/personal=$NEW previously=$OLD"
echo "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}=$UPSTREAM_HEAD"

git checkout personal
git reset --hard "$PERSONAL_REMOTE/personal"

# --- stay level with upstream ---
# The fork carries its own features on top of T3 Code, and every hour it spends behind is another
# hour of drift for those features to conflict with. So each run merges upstream first and the
# build decides whether it was a good idea: a merge that compiles is pushed, one that does not
# never leaves this machine.
#
# Conflicts are not fixed here. A script cannot judge which side of a conflict was deliberate;
# the merge is taken back and the pull requests page's "Take release" button hands the same merge
# to an agent in a worktree, which can.
BEHIND=$(git rev-list --count "HEAD..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
MERGED_UPSTREAM=0
if [[ "$BEHIND" -eq 0 ]]; then
  echo "level with ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
elif git merge --no-edit "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"; then
  MERGED_UPSTREAM=1
  echo "UPSTREAM_MERGED $BEHIND commits from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
else
  git merge --abort || true
  echo "UPSTREAM_MERGE_CONFLICT $BEHIND commits behind ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} — take the release from the pull requests page and let an agent resolve it" >&2
fi

if [[ "$NEW" == "$OLD" && "$MERGED_UPSTREAM" -eq 0 && -z "${T3_FORCE_REBUILD:-}" ]]; then
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

# --- Mac ---
echo "-- building Mac --"
pnpm dist:desktop:dmg:arm64

# The build is the review. An upstream merge only becomes the fork's history once it has compiled
# here — pushed before Blade builds, because Blade builds from the fork rather than from this
# tree, and an unpushed merge would have the three machines running different code.
if [[ "$MERGED_UPSTREAM" -eq 1 ]]; then
  git push "$PERSONAL_REMOTE" personal
  NEW=$(git rev-parse HEAD)
  echo "UPSTREAM_MERGE_PUSHED $NEW"
fi
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

# electron-builder leaves an unsigned build ad-hoc signed, and an ad-hoc signature's identity is
# the binary's own hash — so every rebuild is a different application as far as macOS is
# concerned, and every privacy grant the developer has given is asked for again. Re-signing with
# a Developer ID gives the bundle a designated requirement of "this bundle id, this team", which
# is the same after every build, and the grants survive.
#
# Not fatal: a machine with no identity, or a locked keychain, still gets the build. It just
# keeps being asked for permission.
SIGN_IDENTITY="${T3_PERSONAL_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ { print $2; exit }')}"
if [[ -n "$SIGN_IDENTITY" ]]; then
  if codesign --force --deep --sign "$SIGN_IDENTITY" "$INSTALLED_APP" >/dev/null 2>&1; then
    echo "Mac signed: $SIGN_IDENTITY"
  else
    echo "Mac signing failed — permission prompts will return on each rebuild" >&2
  fi
else
  echo "no Developer ID identity found — leaving the ad-hoc signature" >&2
fi
# Blade and Dell are both reopened after their install; the Mac was the one machine left shut
# down, so every refresh ended with the app the developer is actually sitting in front of gone.
open -a "$INSTALLED_APP" && echo "Mac relaunched" || echo "Mac relaunch failed" >&2

# --- Blade (build + install) ---
echo "-- refreshing Blade --"
scp -o BatchMode=yes "$REPO/scripts/personal-refresh-win.ps1" blade:dev/personal-refresh-win.ps1
# Pass version/force as -File args (cmd env inheritance to PowerShell is unreliable over SSH).
ssh -o BatchMode=yes blade powershell.exe -NoProfile -ExecutionPolicy Bypass -File \
  C:/Users/muhha/dev/personal-refresh-win.ps1 \
  -DesktopVersion "$T3CODE_DESKTOP_VERSION" \
  -ForceRebuild 1

# --- Dell (install only from Blade-staged installer via this Mac) ---
# One machine being off, asleep, or behind a tunnel that is not up must not undo the refresh for
# the others: reaching Dell used to be the last thing that could kill the run outright, taking
# the settings sync and the built-sha record down with it and leaving the next run to redo a
# build that had already succeeded. Errors are reported and the refresh carries on without it.
refresh_dell() {
  mkdir -p /tmp/t3-personal-installer || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 blade:dev/T3-Code-personal-x64.exe \
    /tmp/t3-personal-installer/T3-Code-personal-x64.exe || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 /tmp/t3-personal-installer/T3-Code-personal-x64.exe \
    dell:dev/T3-Code-personal-x64.exe || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-refresh-dell.ps1" \
    dell:dev/personal-refresh-dell.ps1 || return 1
  ssh -o BatchMode=yes -o ConnectTimeout=30 dell powershell.exe -NoProfile -ExecutionPolicy Bypass \
    -File C:/Users/busin/dev/personal-refresh-dell.ps1 || return 1
}

# Blade is on the same LAN as Dell and holds the same key, so when the tunnel from this Mac is
# down Blade can still reach it. That tunnel is the least reliable part of the fleet, and without
# this Dell simply falls behind every refresh it is missing from.
refresh_dell_via_blade() {
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-refresh-dell-via-blade.ps1" \
    blade:dev/personal-refresh-dell-via-blade.ps1 || return 1
  scp -o BatchMode=yes -o ConnectTimeout=30 "$REPO/scripts/personal-refresh-dell.ps1" \
    blade:dev/personal-refresh-dell.ps1 || return 1
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

echo "$NEW" > "$STATE"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) orchestrate done ===="
