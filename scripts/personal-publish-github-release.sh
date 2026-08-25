#!/usr/bin/env bash
# Publish public Munim desktop installers to GitHub Releases on munimtechnologies/mtcode.
#
# Builds with T3CODE_DESKTOP_DISTRO=munim so appId=com.munim.t3code and the
# updater feed points at this fork. Then uploads assets for munimtech.com.
#
# Mac: Developer ID sign when available. Windows: unsigned in v1.
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
personal_mt_export_desktop_version
# GitHub release tag is prefixed with munim-.
TAG="munim-v${T3CODE_DESKTOP_VERSION}"

export T3CODE_DESKTOP_DISTRO=munim
export T3CODE_DESKTOP_UPDATE_REPOSITORY="$RELEASE_REPO"
export GITHUB_REPOSITORY="$RELEASE_REPO"

# Munim-owned T3 Connect config (public identifiers only), if present. The Mac
# build below reads it from the process env; the Blade build reads the copy
# synced to %USERPROFILE%\.mt\munim-connect.env.
# shellcheck source=lib/personal-munim-connect-env.sh
source "$REPO/scripts/lib/personal-munim-connect-env.sh"
munim_connect_load

# Never publish a build whose upstream merge dropped fork features (kept
# modules, lost call sites). Checks live in personal-verify-fork-features.sh.
"$REPO/scripts/personal-verify-fork-features.sh"
if [[ "$MUNIM_CONNECT_ACTIVE" == 1 ]]; then
  munim_connect_write_repo_env "$REPO"
fi

SIGN_IDENTITY="${T3_PERSONAL_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ { print $2; exit }')}"
# Full T3CODE_DESKTOP_SIGNED enables Clerk passkey provisioning we may not have.
# Build unsigned via electron-builder, then Developer ID codesign the DMG/app
# with scripts/personal-codesign-mac-dmg.sh. Notarization needs APPLE_API_ISSUER.
unset T3CODE_DESKTOP_SIGNED || true
echo "building Munim Mac (post-codesign with Developer ID: ${SIGN_IDENTITY:-none})"

echo "T3CODE_DESKTOP_VERSION=$T3CODE_DESKTOP_VERSION"
echo "T3CODE_DESKTOP_DISTRO=$T3CODE_DESKTOP_DISTRO"
echo "UPDATE_REPO=$T3CODE_DESKTOP_UPDATE_REPOSITORY"

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

# --- Windows x64 via Blade (PS1 file avoids nested $env escaping bugs) ---
echo "-- building Munim Windows x64 on Blade --"
munim_connect_sync_to_windows_host blade
scp -o BatchMode=yes "$REPO/scripts/personal-publish-munim-win.ps1" blade:dev/personal-publish-munim-win.ps1
ssh -o BatchMode=yes blade powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File C:/Users/muhha/dev/personal-publish-munim-win.ps1 \
  -DesktopVersion "$T3CODE_DESKTOP_VERSION" \
  -UpdateRepository "$RELEASE_REPO"

WIN_REMOTE=$(ssh -o BatchMode=yes blade 'powershell.exe -NoProfile -Command "Get-ChildItem C:/Users/muhha/dev/t3code-personal/release/MT-Code-*-x64.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"')
WIN_REMOTE=$(echo "$WIN_REMOTE" | tr -d '\r' | tail -1 | tr '\\' '/')
if [[ -z "$WIN_REMOTE" ]]; then
  echo "Windows exe not found on Blade" >&2
  exit 1
fi
echo "WIN_REMOTE=$WIN_REMOTE"
WIN_LOCAL="$REPO/release/$(basename "$WIN_REMOTE")"
scp -o BatchMode=yes "blade:$WIN_REMOTE" "$WIN_LOCAL"
# Also pull yml/blockmap if present
ssh -o BatchMode=yes blade "powershell.exe -NoProfile -Command \"Get-ChildItem C:/Users/muhha/dev/t3code-personal/release/*MT-Code*, C:/Users/muhha/dev/t3code-personal/release/*Munim*, C:/Users/muhha/dev/t3code-personal/release/nightly.yml -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name\"" | tr -d '\r' | while read -r name; do
  [[ -z "$name" ]] && continue
  [[ "$name" == *.exe ]] && continue
  scp -o BatchMode=yes "blade:C:/Users/muhha/dev/t3code-personal/release/$name" "$REPO/release/$name" || true
done

ASSETS=("$MAC_DMG")
[[ -n "$MAC_ZIP" && -f "$MAC_ZIP" ]] && ASSETS+=("$MAC_ZIP")
[[ -f "${MAC_DMG}.blockmap" ]] && ASSETS+=("${MAC_DMG}.blockmap")
[[ -n "$MAC_ZIP" && -f "${MAC_ZIP}.blockmap" ]] && ASSETS+=("${MAC_ZIP}.blockmap")
[[ -n "$MAC_YML" && -f "$MAC_YML" ]] && ASSETS+=("$MAC_YML")
ASSETS+=("$WIN_LOCAL")
[[ -f "${WIN_LOCAL}.blockmap" ]] && ASSETS+=("${WIN_LOCAL}.blockmap")
for y in "$REPO"/release/latest.yml "$REPO"/release/nightly.yml "$REPO"/release/*Munim*.yml "$REPO"/release/*MT-Code*.yml; do
  [[ -f "$y" ]] && ASSETS+=("$y")
done

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
CHANGELOG=$(
  if [[ -n "$PREV_TAG" ]] && git rev-parse "$PREV_TAG" >/dev/null 2>&1; then
    git log --pretty=format:'- %s' "${PREV_TAG}..HEAD"
  else
    git log --pretty=format:'- %s' -15
  fi | head -25
)
NOTES=$(cat <<EOF
## What's changed

${CHANGELOG}

MT Code — public build from \`munimtechnologies/mtcode@main\`.

- App ID: \`com.munim.t3code\`
- Downloads: https://munimtech.com/mt-code
- Updates come from this repository (not pingdotgg/t3code)

Commit: \`$(git rev-parse --short HEAD)\`
EOF
)

echo "-- publishing $TAG to $RELEASE_REPO --"

if gh release view "$TAG" -R "$RELEASE_REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "${UNIQUE_ASSETS[@]}" -R "$RELEASE_REPO" --clobber
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
