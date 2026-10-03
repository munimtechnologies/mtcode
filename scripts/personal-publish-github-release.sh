#!/usr/bin/env bash
# Publish public Munim desktop installers to GitHub Releases on munimtechnologies/mtcode.
#
# Builds with T3CODE_DESKTOP_DISTRO=munim so appId=com.munim.mtcode and the
# updater feed points at this fork. Then uploads assets for munimtech.com.
#
# Mac: Developer ID sign when available. Windows: unsigned in v1.
# Linux x64 (AppImage + .deb): unsigned, built in the Windows build host's
# WSL2 Ubuntu by personal-linux-build.sh. T3_MUNIM_SKIP_LINUX=1 skips it.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
RELEASE_REPO="${T3_MUNIM_RELEASE_REPO:-munimtechnologies/mtcode}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/publish-munim-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) munim publish start ===="

cd "$REPO"

# shellcheck source=lib/personal-mt-version.sh
source "$REPO/scripts/lib/personal-mt-version.sh"
# Publishing must never reuse a published tag; fleet refreshes must match one.
T3_MT_VERSION_NEXT=1 personal_mt_export_desktop_version
# GitHub release tag is prefixed with munim-.
TAG="munim-v${T3CODE_DESKTOP_VERSION}"

export T3CODE_DESKTOP_DISTRO=munim
export T3CODE_DESKTOP_UPDATE_REPOSITORY="$RELEASE_REPO"
export GITHUB_REPOSITORY="$RELEASE_REPO"
# Ship the feed behind infra/updates so updates can be counted: GitHub's
# download counter ignores the range requests a differential update is made of,
# so publishing straight at the repo hides every auto-update. The Worker serves
# the same yml and redirects to the same assets on this release.
UPDATE_URL="${T3_MUNIM_UPDATE_URL:-https://updates.mtcode.munimtech.com}"
export T3CODE_DESKTOP_UPDATE_URL="$UPDATE_URL"

# Never publish a build whose upstream merge dropped fork features (kept
# modules, lost call sites). Checks live in personal-verify-fork-features.sh.
"$REPO/scripts/personal-verify-fork-features.sh"

SIGN_IDENTITY="${T3_PERSONAL_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ { print $2; exit }')}"
# Full T3CODE_DESKTOP_SIGNED enables Clerk passkey provisioning we may not have.
# Build unsigned via electron-builder, then Developer ID codesign the DMG/app
# with scripts/personal-codesign-mac-dmg.sh. Notarization needs APPLE_API_ISSUER.
unset T3CODE_DESKTOP_SIGNED || true
echo "building Munim Mac (post-codesign with Developer ID: ${SIGN_IDENTITY:-none})"

echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"
echo "T3CODE_DESKTOP_DISTRO=$T3CODE_DESKTOP_DISTRO"
echo "UPDATE_REPO=$T3CODE_DESKTOP_UPDATE_REPOSITORY"
echo "UPDATE_URL=$T3CODE_DESKTOP_UPDATE_URL"

# --- Windows x64 via the Windows build host, started first so it overlaps the Mac build ---
# Host/user are overridable so a second Windows box can cover for Blade when it
# is offline; the remote paths are derived from the user, not hardcoded.
WIN_HOST="${T3_MUNIM_WIN_HOST:-blade}"
WIN_USER="${T3_MUNIM_WIN_USER:-muhha}"
WIN_HOME="C:/Users/$WIN_USER"
WIN_RELEASE_DIR="$WIN_HOME/dev/t3code-personal/release"
WIN_JOB_LOG="$LOG_DIR/publish-munim-win-$$.log"
WIN_PID=""
build_windows() {
  scp -o BatchMode=yes "$REPO/scripts/personal-publish-munim-win.ps1" "$WIN_HOST:dev/personal-publish-munim-win.ps1"
  ssh -o BatchMode=yes "$WIN_HOST" powershell.exe -NoProfile -ExecutionPolicy Bypass \
    -File "$WIN_HOME/dev/personal-publish-munim-win.ps1" \
    -DesktopVersion "$T3CODE_DESKTOP_VERSION" \
    -UpdateRepository "$RELEASE_REPO" \
    -UpdateUrl "$UPDATE_URL"
}
if [[ "${T3_MUNIM_SKIP_WIN:-}" == "1" ]]; then
  echo "-- skipping Windows build (T3_MUNIM_SKIP_WIN=1) --"
else
  echo "-- building Munim Windows x64 on $WIN_HOST (in parallel with the Mac build; log $WIN_JOB_LOG) --"
  build_windows >"$WIN_JOB_LOG" 2>&1 &
  WIN_PID=$!
fi

# --- Linux x64 in the build host's WSL2 Ubuntu, overlapping the other two ---
# personal-linux-build.sh runs inside the distro and builds on the Linux
# filesystem; it and its toolchain setup travel over scp like the Windows .ps1.
# The ssh shell on the Windows hosts is Git Bash, which rewrites any absolute
# /mnt/... argument, so the build starts in C:/Users/<user>/dev and every path
# it is given is relative to that. The Dell (dell-ts, Ubuntu too) can stand in.
LINUX_HOST="${T3_MUNIM_LINUX_HOST:-$WIN_HOST}"
LINUX_WIN_USER="${T3_MUNIM_LINUX_WIN_USER:-$WIN_USER}"
LINUX_DISTRO="${T3_MUNIM_LINUX_DISTRO:-Ubuntu}"
LINUX_OUT_DIR="mtcode-linux-release"
# Hard ceiling for the whole remote build: wsl.exe can wedge over ssh, and a
# hung Linux job must fail the release instead of stalling it forever.
LINUX_TIMEOUT_SECONDS="${T3_MUNIM_LINUX_TIMEOUT_SECONDS:-5400}"
LINUX_JOB_LOG="$LOG_DIR/publish-munim-linux-$$.log"
LINUX_PID=""
LINUX_ASSET_NAMES=(
  "MT-Code-${T3CODE_DESKTOP_VERSION}-x86_64.AppImage"
  "MT-Code-${T3CODE_DESKTOP_VERSION}-amd64.deb"
  "latest-linux.yml"
)
build_linux() {
  scp -o BatchMode=yes "$REPO/scripts/personal-linux-build.sh" "$REPO/scripts/personal-linux-build-host-setup.sh" "$LINUX_HOST:dev/"
  perl -e 'alarm shift; exec @ARGV' "$LINUX_TIMEOUT_SECONDS" \
    ssh -n -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=6 "$LINUX_HOST" \
    wsl.exe -d "$LINUX_DISTRO" --cd "C:/Users/$LINUX_WIN_USER/dev" -- \
    bash personal-linux-build.sh \
    --version "$T3CODE_DESKTOP_VERSION" \
    --ref "$LINUX_REF" \
    --out "$LINUX_OUT_DIR" \
    --update-repository "$RELEASE_REPO" \
    --update-url "$UPDATE_URL"
}
if [[ "${T3_MUNIM_SKIP_LINUX:-}" == "1" ]]; then
  echo "-- skipping Linux build (T3_MUNIM_SKIP_LINUX=1) --"
else
  # The Linux host clones from GitHub, so it can only build a pushed commit.
  # Check now rather than after the Mac build: the fleet release already
  # refuses unpushed commits, and a manual publish should push first too.
  LINUX_REF=$(git rev-parse HEAD)
  LINUX_ON_MAIN=$(gh api "repos/$RELEASE_REPO/compare/main...$LINUX_REF" --jq .status 2>/dev/null || true)
  if [[ "$LINUX_ON_MAIN" != "identical" && "$LINUX_ON_MAIN" != "behind" ]]; then
    echo "HEAD $LINUX_REF is not on $RELEASE_REPO main (${LINUX_ON_MAIN:-unknown}): push it, or set T3_MUNIM_SKIP_LINUX=1" >&2
    exit 1
  fi
  for name in "${LINUX_ASSET_NAMES[@]}"; do
    rm -f "$REPO/release/$name"
  done
  echo "-- building Munim Linux x64 on $LINUX_HOST WSL $LINUX_DISTRO at ${LINUX_REF:0:10} (in parallel; log $LINUX_JOB_LOG) --"
  build_linux >"$LINUX_JOB_LOG" 2>&1 &
  LINUX_PID=$!
fi

# --- Mac arm64 ---
EXPECTED_MAC="$REPO/release/MT-Code-${T3CODE_DESKTOP_VERSION}-arm64.dmg"
if [[ "${T3_MUNIM_SKIP_MAC:-}" == "1" && -f "$EXPECTED_MAC" ]]; then
  echo "-- reusing existing Munim Mac DMG --"
elif [[ -f "$EXPECTED_MAC" && "${T3_MUNIM_FORCE_MAC:-}" != "1" ]]; then
  echo "-- reusing existing Munim Mac DMG (set T3_MUNIM_FORCE_MAC=1 to rebuild) --"
else
  echo "-- building Munim Mac arm64 --"
  # Align package versions so the bundled server and web report this version.
  node scripts/update-release-package-versions.ts "$T3CODE_DESKTOP_VERSION"
  pnpm dist:desktop:dmg:arm64
  # The stamp is build input only; keep the checkout clean.
  git checkout -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json
fi

MAC_DMG=$(ls -t "$REPO"/release/MT-Code-*-arm64.dmg 2>/dev/null | head -1 || true)
MAC_ZIP=$(ls -t "$REPO"/release/MT-Code-*-arm64.zip 2>/dev/null | head -1 || true)
MAC_YML=""
for candidate in "$REPO"/release/latest-mac.yml "$REPO"/release/nightly-mac.yml; do
  if [[ -f "$candidate" ]]; then
    MAC_YML="$candidate"
    break
  fi
done
if [[ -z "$MAC_YML" ]]; then
  MAC_YML=$(ls -t "$REPO"/release/*-mac.yml 2>/dev/null | head -1 || true)
fi
if [[ -z "$MAC_DMG" ]]; then
  echo "Mac DMG not found in release/" >&2
  ls -la "$REPO"/release | head -40 >&2
  exit 1
fi
echo "MAC_DMG=$MAC_DMG"
echo "MAC_ZIP=${MAC_ZIP:-none}"
echo "MAC_YML=${MAC_YML:-none}"

if [[ -n "$SIGN_IDENTITY" && "${T3_MUNIM_SKIP_CODESIGN:-}" != "1" ]]; then
  echo "-- Developer ID codesign Mac DMG --"
  /bin/bash "$REPO/scripts/personal-codesign-mac-dmg.sh" "$MAC_DMG"
  MAC_ZIP="${MAC_DMG%.dmg}.zip"
  MAC_YML="$REPO/release/latest-mac.yml"
fi

# Clear quarantine on the DMG we ship.
xattr -cr "$MAC_DMG" 2>/dev/null || true

# --- Collect the Windows build ---
# Skipping Windows publishes a Mac-only release; re-running later with
# T3_MUNIM_SKIP_MAC=1 uploads the exe onto the same tag (upload --clobber).
WIN_LOCAL=""
if [[ -n "$WIN_PID" ]]; then
WIN_STATUS=0
wait "$WIN_PID" || WIN_STATUS=$?
echo "-- Windows build output ($WIN_HOST) --"
cat "$WIN_JOB_LOG"
rm -f "$WIN_JOB_LOG"
if [[ "$WIN_STATUS" -ne 0 ]]; then
  echo "Windows build on $WIN_HOST failed (exit $WIN_STATUS)" >&2
  exit "$WIN_STATUS"
fi

WIN_REMOTE=$(ssh -o BatchMode=yes "$WIN_HOST" "powershell.exe -NoProfile -Command \"Get-ChildItem $WIN_RELEASE_DIR/MT-Code-*-x64.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName\"")
WIN_REMOTE=$(echo "$WIN_REMOTE" | tr -d '\r' | tail -1 | tr '\\' '/')
if [[ -z "$WIN_REMOTE" ]]; then
  echo "Windows exe not found on $WIN_HOST" >&2
  exit 1
fi
echo "WIN_REMOTE=$WIN_REMOTE"
WIN_LOCAL="$REPO/release/$(basename "$WIN_REMOTE")"
scp -o BatchMode=yes "$WIN_HOST:$WIN_REMOTE" "$WIN_LOCAL"
# Pull back the blockmap and the Windows updater feed for THIS build. Name them
# explicitly: a wildcard sweep re-copies every stale artifact the build host has
# ever produced, which is how a nightly.yml from an old build rode along to
# every release while latest.yml -- matching no wildcard -- was never fetched at
# all, leaving Windows with no update feed from 0.0.43 on.
WIN_EXE_NAME=$(basename "$WIN_REMOTE")
for name in "${WIN_EXE_NAME}.blockmap" latest.yml; do
  scp -o BatchMode=yes "$WIN_HOST:$WIN_RELEASE_DIR/$name" "$REPO/release/$name" || true
done
fi

# --- Collect the Linux build ---
# Unlike a skipped one, a failed Linux build fails the release: set
# T3_MUNIM_SKIP_LINUX=1 to publish without it.
if [[ -n "$LINUX_PID" ]]; then
LINUX_STATUS=0
wait "$LINUX_PID" || LINUX_STATUS=$?
echo "-- Linux build output ($LINUX_HOST WSL $LINUX_DISTRO) --"
cat "$LINUX_JOB_LOG"
rm -f "$LINUX_JOB_LOG"
if [[ "$LINUX_STATUS" -ne 0 ]]; then
  echo "Linux build on $LINUX_HOST failed (exit $LINUX_STATUS); T3_MUNIM_SKIP_LINUX=1 publishes without it" >&2
  exit "$LINUX_STATUS"
fi
# Named explicitly, like the Windows files, so no stale artifact rides along.
for name in "${LINUX_ASSET_NAMES[@]}"; do
  scp -o BatchMode=yes "$LINUX_HOST:dev/$LINUX_OUT_DIR/$name" "$REPO/release/$name"
done
fi

ASSETS=("$MAC_DMG")
[[ -n "$MAC_ZIP" && -f "$MAC_ZIP" ]] && ASSETS+=("$MAC_ZIP")
[[ -f "${MAC_DMG}.blockmap" ]] && ASSETS+=("${MAC_DMG}.blockmap")
[[ -n "$MAC_ZIP" && -f "${MAC_ZIP}.blockmap" ]] && ASSETS+=("${MAC_ZIP}.blockmap")
[[ -n "$WIN_LOCAL" && -f "$WIN_LOCAL" ]] && ASSETS+=("$WIN_LOCAL")
[[ -n "$WIN_LOCAL" && -f "${WIN_LOCAL}.blockmap" ]] && ASSETS+=("${WIN_LOCAL}.blockmap")
# The AppImage and .deb; latest-linux.yml goes through add_manifest below.
[[ -n "$LINUX_PID" ]] && ASSETS+=("$REPO/release/${LINUX_ASSET_NAMES[0]}" "$REPO/release/${LINUX_ASSET_NAMES[1]}")

# A manifest naming another build is worse than no manifest: the updater
# believes whatever version it reads. Ship only manifests describing this build.
# personal-publish-munim-win.ps1 strips the nightly suffix from the Windows
# build version, so the stripped base counts as a match.
BASE_VERSION="${T3CODE_DESKTOP_VERSION%%-nightly.*}"
MAC_FEED_OK=0
WIN_FEED_OK=0
LINUX_FEED_OK=0
add_manifest() {
  local yml="$1" found
  [[ -f "$yml" ]] || return 0
  found=$(awk '/^version:/ { print $2; exit }' "$yml" | tr -d "\"'")
  if [[ "$found" != "$T3CODE_DESKTOP_VERSION" && "$found" != "$BASE_VERSION" ]]; then
    echo "skipping stale manifest $(basename "$yml"): names ${found:-unreadable}, publishing $T3CODE_DESKTOP_VERSION"
    return 0
  fi
  ASSETS+=("$yml")
  case "$(basename "$yml")" in
    *-mac.yml) MAC_FEED_OK=1 ;;
    *-linux.yml) LINUX_FEED_OK=1 ;;
    *) WIN_FEED_OK=1 ;;
  esac
}
[[ -n "$MAC_YML" ]] && add_manifest "$MAC_YML"
[[ -n "$LINUX_PID" ]] && add_manifest "$REPO/release/latest-linux.yml"
for y in "$REPO"/release/latest.yml "$REPO"/release/nightly.yml "$REPO"/release/*Munim*.yml "$REPO"/release/*MT-Code*.yml; do
  add_manifest "$y"
done

# An installer published without its feed file is invisible to every updater in
# the field. Windows shipped that way from 0.0.43 to 0.0.84 because nothing
# checked; refuse to publish instead.
if [[ "$MAC_FEED_OK" != "1" ]]; then
  echo "no Mac update feed for $T3CODE_DESKTOP_VERSION: installed clients would never see this release" >&2
  exit 1
fi
if [[ -n "$WIN_LOCAL" && "$WIN_FEED_OK" != "1" ]]; then
  echo "no Windows update feed (latest.yml) for $T3CODE_DESKTOP_VERSION: check the scp back from $WIN_HOST" >&2
  exit 1
fi
if [[ -n "$LINUX_PID" && "$LINUX_FEED_OK" != "1" ]]; then
  echo "no Linux update feed (latest-linux.yml) for $T3CODE_DESKTOP_VERSION: check the scp back from $LINUX_HOST" >&2
  exit 1
fi

# Deduplicate (no associative arrays: macOS ships bash 3.2)
UNIQUE_ASSETS=()
SEEN=" "
for a in "${ASSETS[@]}"; do
  [[ -f "$a" ]] || continue
  key=$(basename "$a")
  case "$SEEN" in *" $key "*) continue ;; esac
  SEEN="$SEEN$key "
  UNIQUE_ASSETS+=("$a")
done

PREV_TAG=$(
  gh release list -R "$RELEASE_REPO" --limit 30 --json tagName,isLatest \
    --jq '[.[] | select(.tagName | startswith("munim-v"))] | map(.tagName) | .[0] // empty' 2>/dev/null || true
)
# When republishing the same tag, take the previous munim release for the log range.
if [[ "$PREV_TAG" == "$TAG" ]]; then
  PREV_TAG=$(
    gh release list -R "$RELEASE_REPO" --limit 30 --json tagName \
      --jq '[.[] | select(.tagName | startswith("munim-v"))] | .[1] // empty' 2>/dev/null || true
  )
fi
# -25 instead of `| head`: head's early exit SIGPIPEs git log under
# pipefail and set -e kills the whole publish with no error output.
# --reverse: oldest first. The desktop updater (upstream #9138) keeps the LAST
# items of a note and reverses them for display, so the note must be
# chronological or the hover shows the oldest commits and drops the newest.
CHANGELOG=$(
  if [[ -n "$PREV_TAG" ]] && git rev-parse "$PREV_TAG" >/dev/null 2>&1; then
    git log --reverse --pretty=format:'- %s' -25 "${PREV_TAG}..HEAD"
  else
    git log --reverse --pretty=format:'- %s' -15
  fi
)
NOTES=$(cat <<EOF
## What's changed

${CHANGELOG}

MT Code — public build from \`munimtechnologies/mtcode@main\`.

- App ID: \`com.munim.mtcode\`
- Downloads: https://munimtech.com/mtcode
- Updates come from this repository (not pingdotgg/t3code)

Commit: \`$(git rev-parse --short HEAD)\`
EOF
)

echo "-- publishing $TAG to $RELEASE_REPO --"

if gh release view "$TAG" -R "$RELEASE_REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "${UNIQUE_ASSETS[@]}" -R "$RELEASE_REPO" --clobber
  gh release edit "$TAG" -R "$RELEASE_REPO" --title "MT Code ${T3CODE_DESKTOP_VERSION}" --notes "$NOTES"
else
  gh release create "$TAG" "${UNIQUE_ASSETS[@]}" \
    -R "$RELEASE_REPO" \
    --title "MT Code ${T3CODE_DESKTOP_VERSION}" \
    --notes "$NOTES"
fi
# Public download page: keep the newest installer release pinned as Latest so
# github.com/<repo>/releases and /releases/latest point at it, not demo assets.
gh release edit "$TAG" -R "$RELEASE_REPO" --prerelease=false --latest

echo "PUBLISHED $TAG"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) munim publish done ===="
