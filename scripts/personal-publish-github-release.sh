#!/usr/bin/env bash
# Publish public Munim desktop installers to GitHub Releases on sheehanmunim/t3code.
#
# Builds with T3CODE_DESKTOP_DISTRO=munim so appId=com.munim.t3code and the
# updater feed points at this fork. Then uploads assets for munimtech.com.
#
# Mac: Developer ID sign when available. Windows: unsigned in v1.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
RELEASE_REPO="${T3_MUNIM_RELEASE_REPO:-sheehanmunim/t3code}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/publish-munim-$(date +%Y%m%d).log"

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) munim publish start ===="

cd "$REPO"

NIGHTLY_TAG=$(gh api repos/pingdotgg/t3code/releases --jq '[.[] | select(.prerelease==true and (.tag_name|test("nightly")))] | sort_by(.published_at) | reverse | .[0].tag_name // empty')
if [[ -z "$NIGHTLY_TAG" ]]; then
  echo "could not resolve latest upstream nightly tag" >&2
  exit 1
fi

# Keep the upstream nightly version string so icons/artwork stay Nightly and the
# updater channel stays "nightly". GitHub release tag is prefixed with munim-.
export T3CODE_DESKTOP_VERSION="${NIGHTLY_TAG#v}"
TAG="munim-v${T3CODE_DESKTOP_VERSION}"

export T3CODE_DESKTOP_DISTRO=munim
export T3CODE_DESKTOP_UPDATE_REPOSITORY="$RELEASE_REPO"
export GITHUB_REPOSITORY="$RELEASE_REPO"

SIGN_IDENTITY="${T3_PERSONAL_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ { print $2; exit }')}"
# Full T3CODE_DESKTOP_SIGNED enables passkey provisioning which this machine may
# not have. Ship unsigned Mac DMGs for now; Gatekeeper needs right-click → Open.
# Set T3CODE_DESKTOP_SIGNED=1 + Apple passkey env later for notarized builds.
unset T3CODE_DESKTOP_SIGNED || true
echo "building Munim Mac unsigned (Developer ID available: ${SIGN_IDENTITY:-none})"

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
  # Align package versions like upstream's release workflow, so the bundled
  # server and web report this nightly version (else nightly-track clients
  # show "Server update available").
  node scripts/update-release-package-versions.ts "$T3CODE_DESKTOP_VERSION"
  pnpm dist:desktop:dmg:arm64
  # The stamp is build input only; keep the checkout clean.
  git checkout -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json
fi

MAC_DMG=$(ls -t "$REPO"/release/MT-Code-*-arm64.dmg 2>/dev/null | head -1 || true)
MAC_ZIP=$(ls -t "$REPO"/release/MT-Code-*-arm64.zip 2>/dev/null | head -1 || true)
MAC_YML=""
for candidate in "$REPO"/release/nightly-mac.yml "$REPO"/release/latest-mac.yml; do
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

# Optional local codesign of the .app inside DMG is handled by electron-builder when CSC is set.
# Clear quarantine on the DMG we ship.
xattr -cr "$MAC_DMG" 2>/dev/null || true

# --- Windows x64 via Blade (PS1 file avoids nested $env escaping bugs) ---
echo "-- building Munim Windows x64 on Blade --"
scp -o BatchMode=yes "$REPO/scripts/personal-publish-munim-win.ps1" blade:dev/personal-publish-munim-win.ps1
ssh -o BatchMode=yes blade powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File C:/Users/muhha/dev/personal-publish-munim-win.ps1 \
  -DesktopVersion "$T3CODE_DESKTOP_VERSION" \
  -UpdateRepository "$RELEASE_REPO"

WIN_REMOTE=$(ssh -o BatchMode=yes blade 'powershell.exe -NoProfile -Command "Get-ChildItem C:/Users/muhha/dev/t3code-personal/release/MT-Code-*-x64.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"')
WIN_REMOTE=$(echo "$WIN_REMOTE" | tr -d '\r' | tail -1)
if [[ -z "$WIN_REMOTE" ]]; then
  echo "Windows exe not found on Blade" >&2
  exit 1
fi
echo "WIN_REMOTE=$WIN_REMOTE"
WIN_LOCAL="$REPO/release/$(basename "$WIN_REMOTE")"
scp -o BatchMode=yes "blade:$WIN_REMOTE" "$WIN_LOCAL"
# Also pull yml/blockmap if present
ssh -o BatchMode=yes blade "powershell.exe -NoProfile -Command \"Get-ChildItem C:/Users/muhha/dev/t3code-personal/release/*Munim* | Select-Object -ExpandProperty Name\"" | tr -d '\r' | while read -r name; do
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
for y in "$REPO"/release/latest.yml "$REPO"/release/*Munim*.yml; do
  [[ -f "$y" ]] && ASSETS+=("$y")
done

# Deduplicate
UNIQUE_ASSETS=()
declare -A SEEN=()
for a in "${ASSETS[@]}"; do
  [[ -f "$a" ]] || continue
  key=$(basename "$a")
  if [[ -z "${SEEN[$key]:-}" ]]; then
    SEEN[$key]=1
    UNIQUE_ASSETS+=("$a")
  fi
done

NOTES=$(cat <<EOF
MT Code — public build from \`sheehanmunim/t3code@personal\`.

- App ID: \`com.munim.t3code\`
- Downloads: https://munimtech.com/t3-code
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
    --notes "$NOTES" \
    --prerelease
fi

echo "PUBLISHED $TAG"
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) munim publish done ===="
