#!/usr/bin/env bash
# Build the MT Code Linux x64 desktop artifacts on a Linux host: by default
# Blade's WSL2 Ubuntu, driven over ssh by personal-publish-github-release.sh.
#
#   personal-linux-build.sh --version 0.0.97 [--ref <sha|branch>] [--out <dir>]
#
# Builds in a checkout on the Linux filesystem ($MTCODE_LINUX_WORKDIR, default
# ~/dev/mtcode-linux): a WSL build under /mnt/c is several times slower. The
# result is the same munim distro the Mac and Windows publish builds produce:
# MT-Code-<version>-x86_64.AppImage, MT-Code-<version>-amd64.deb, and
# latest-linux.yml listing both. The .deb alone carries electron-builder's
# resources/package-type marker, so electron-updater updates each install in
# its own format. With --out, those three files are copied there (the publish
# script points it at the Windows side of WSL so plain scp can fetch them).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION=""
REF="main"
OUT=""
REPO_URL="${MTCODE_LINUX_REPO_URL:-https://github.com/munimtechnologies/mtcode.git}"
WORKDIR="${MTCODE_LINUX_WORKDIR:-$HOME/dev/mtcode-linux}"
UPDATE_REPOSITORY="${MTCODE_LINUX_UPDATE_REPOSITORY:-munimtechnologies/mtcode}"
UPDATE_URL="${MTCODE_LINUX_UPDATE_URL:-https://updates.mtcode.munimtech.com}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --update-repository) UPDATE_REPOSITORY="$2"; shift 2 ;;
    --update-url) UPDATE_URL="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
VERSION="${VERSION%%-nightly*}"
# Relative to where this was started: the publish script starts it with
# `wsl.exe --cd C:/Users/<user>/dev` and a relative --out, because an absolute
# /mnt/c path gets rewritten by Git Bash, the Windows host's ssh shell.
[[ -n "$OUT" ]] && OUT="$(realpath -m "$OUT")"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "--version must look like 0.0.97, got '${VERSION}'" >&2
  exit 2
fi

log() { printf '[linux-build %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
STARTED=$(date +%s)
log "MT Code $VERSION from $REF on $(hostname) ($(nproc) cpus, $(free -g | awk '/^Mem:/ { print $2 }') GB)"

# WSL appends the Windows PATH; a Windows node/pnpm must never win.
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)"
export PATH

# --- Checkout at the release commit ---
if [[ ! -d "$WORKDIR/.git" ]]; then
  log "cloning $REPO_URL into $WORKDIR"
  mkdir -p "$(dirname "$WORKDIR")"
  git clone --no-checkout --filter=blob:none "$REPO_URL" "$WORKDIR"
fi
cd "$WORKDIR"
git remote set-url origin "$REPO_URL"
if ! git fetch --no-tags origin "$REF"; then
  echo "cannot fetch '$REF' from $REPO_URL: push it to main first" >&2
  exit 1
fi
git checkout --force --detach FETCH_HEAD
git clean -fd
SHA=$(git rev-parse HEAD)
log "HEAD $SHA"

# Never package a stale bundle or a previous version's installers. Rust
# targets and node_modules stay: they are the whole speedup of a warm host.
rm -rf release apps/web/dist apps/server/dist apps/desktop/dist-electron node_modules/.vite .turbo

# --- Toolchain (idempotent) ---
# The setup script travels with this one (the publish script copies both), so
# a build of any ref gets the toolchain this version of the scripts expects.
bash "$SCRIPT_DIR/personal-linux-build-host-setup.sh"
# shellcheck source=/dev/null
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
export PATH="$HOME/.local/mtcode-node/current/bin:$HOME/.vite-plus/bin:$PATH"

# Same public Connect identifiers as the Mac and Windows builds
# (personal-publish-munim-win.ps1 seeds .env from .env.example too).
cp .env.example .env

log "installing dependencies"
# CI=true answers pnpm's "remove the modules directory?" prompt (no TTY here)
# and keeps the install on the committed lockfile.
CI=true vp install

# Align package versions like the other publish builds, so the bundled server
# and web report this version. The stamp is build input only.
restore_manifests() {
  git checkout -- apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json 2>/dev/null || true
}
trap restore_manifests EXIT
node scripts/update-release-package-versions.ts "$VERSION"

export T3CODE_DESKTOP_DISTRO=munim
export T3CODE_DESKTOP_VERSION="$VERSION"
export T3CODE_DESKTOP_UPDATE_REPOSITORY="$UPDATE_REPOSITORY"
export T3CODE_DESKTOP_UPDATE_URL="$UPDATE_URL"
export GITHUB_REPOSITORY="$UPDATE_REPOSITORY"
unset T3CODE_DESKTOP_SIGNED || true

log "building desktop artifacts"
node scripts/build-desktop-artifact.ts --platform linux --target AppImage --arch x64 --build-version "$VERSION" --verbose

# --- Verify before anything leaves this host ---
# A release without a matching feed is invisible to installed updaters, and a
# feed naming another build is worse.
APPIMAGE="release/MT-Code-${VERSION}-x86_64.AppImage"
DEB="release/MT-Code-${VERSION}-amd64.deb"
FEED="release/latest-linux.yml"
for file in "$APPIMAGE" "$DEB" "$FEED"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; ls -la release >&2; exit 1; }
done
found="$(awk '/^version:/ { print $2; exit }' "$FEED" | tr -d "\"'")"
[[ "$found" == "$VERSION" ]] || { echo "latest-linux.yml names '$found', expected $VERSION" >&2; exit 1; }
for name in "$(basename "$APPIMAGE")" "$(basename "$DEB")"; do
  grep -qF "url: $name" "$FEED" || { echo "latest-linux.yml does not list $name" >&2; exit 1; }
done

scratch="$(mktemp -d)"
cleanup_scratch() { rm -rf "$scratch"; restore_manifests; }
trap cleanup_scratch EXIT
dpkg-deb -x "$DEB" "$scratch/deb"
package_type="$(find "$scratch/deb" -path '*/resources/package-type' -print -quit)"
app_update="$(find "$scratch/deb" -path '*/resources/app-update.yml' -print -quit)"
[[ -n "$package_type" && "$(cat "$package_type")" == "deb" ]] || { echo "the .deb has no resources/package-type = deb marker" >&2; exit 1; }
if [[ -z "$app_update" ]] || ! grep -qF "url: $UPDATE_URL" "$app_update"; then
  echo "the .deb's app-update.yml does not point at $UPDATE_URL" >&2
  exit 1
fi
log "deb: $(dpkg-deb --field "$DEB" Package Version Architecture | paste -sd' ' -)"

# Smoke: the AppImage unpacks (no FUSE needed) and its bundled server starts
# under the packaged Electron as Node and reports this version.
(cd "$scratch" && "$WORKDIR/$APPIMAGE" --appimage-extract >/dev/null)
server_version="$(
  cd "$scratch/squashfs-root" &&
    ELECTRON_RUN_AS_NODE=1 timeout 60 ./mtcode resources/app.asar/apps/server/dist/bin.mjs --version 2>&1 | tail -1
)"
log "AppImage server --version: $server_version"
[[ "$server_version" == *"$VERSION"* ]] || { echo "bundled server did not report $VERSION" >&2; exit 1; }

if [[ -n "$OUT" ]]; then
  mkdir -p "$OUT"
  rm -f "$OUT"/MT-Code-*.AppImage "$OUT"/MT-Code-*.deb "$OUT"/latest-linux.yml
  cp "$APPIMAGE" "$DEB" "$FEED" "$OUT"/
  log "copied to $OUT"
fi

ls -la "$APPIMAGE" "$DEB" "$FEED"
log "done in $(( $(date +%s) - STARTED ))s"
