#!/usr/bin/env bash
# Build the MT Code Linux x64 desktop artifacts on a Linux host: by default
# Blade's WSL2 Ubuntu, driven over ssh by personal-publish-github-release.sh.
#
#   personal-linux-build.sh --version 0.0.97 [--ref <sha|branch>] [--out <dir>]
#
# The build itself runs in an ubuntu:24.04 Docker container (glibc 2.39, see
# below), so the host only needs docker. It builds in a checkout on a Docker
# volume, never under /mnt/c: a WSL build there is several times slower. The
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

# WSL appends the Windows PATH; a Windows node/pnpm must never win.
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)"
export PATH

# --- Build inside Ubuntu 24.04 (glibc 2.39) ---
# Native modules (node-pty is compiled from source) link against the build
# host's glibc. Blade's WSL Ubuntu has glibc 2.43, and the 0.1.61-0.1.67
# installers built there needed libc6 >= 2.42, so they would not install on
# Ubuntu 24.04, Debian 13 or most other distros. The build therefore runs in an
# ubuntu:24.04 container, the same glibc as upstream's release runners and the
# 2.39 ceiling in scripts/linux-glibc.ts. The toolchain is baked into a local
# image (rebuilt from cache when the setup script changes); the checkout,
# node_modules, the pnpm store and Rust targets live in a named volume so warm
# builds stay fast. MTCODE_LINUX_BUILD_CONTAINER=0 builds on the host itself,
# which only passes the glibc check on a host with glibc 2.39 or older.
GLIBC_CEILING="2.39"
CONTAINER_IMAGE="${MTCODE_LINUX_BUILD_IMAGE:-mtcode-linux-build:ubuntu-24.04}"
CONTAINER_NAME="mtcode-linux-build"
CONTAINER_VOLUME="${MTCODE_LINUX_BUILD_VOLUME:-mtcode-linux-build-dev}"
if [[ "${MTCODE_LINUX_IN_CONTAINER:-}" != "1" && "${MTCODE_LINUX_BUILD_CONTAINER:-1}" != "0" ]]; then
  command -v docker >/dev/null 2>&1 || {
    echo "docker is required to build in ubuntu:24.04 (MTCODE_LINUX_BUILD_CONTAINER=0 builds on the host)" >&2
    exit 1
  }
  log "building image $CONTAINER_IMAGE (ubuntu:24.04 + toolchain)"
  # The context holds only the setup script: SCRIPT_DIR is the Windows user's
  # whole dev folder when the publish script starts this.
  context="$(mktemp -d)"
  cp "$SCRIPT_DIR/personal-linux-build-host-setup.sh" "$context/"
  cat >"$context/Dockerfile" <<'DOCKERFILE'
FROM ubuntu:24.04
COPY personal-linux-build-host-setup.sh /opt/mtcode/personal-linux-build-host-setup.sh
RUN bash /opt/mtcode/personal-linux-build-host-setup.sh
DOCKERFILE
  docker build -t "$CONTAINER_IMAGE" "$context"
  rm -rf "$context"
  # A build orphaned by a dropped ssh session would race this one on the volume.
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  args=(--version "$VERSION" --ref "$REF" --update-repository "$UPDATE_REPOSITORY" --update-url "$UPDATE_URL")
  # /root/.cache keeps Electron and node-gyp downloads between builds.
  mounts=(-v "$CONTAINER_VOLUME:/root/dev" -v "$CONTAINER_VOLUME-cache:/root/.cache" -v "$SCRIPT_DIR:/opt/mtcode/scripts:ro")
  if [[ -n "$OUT" ]]; then
    mkdir -p "$OUT"
    mounts+=(-v "$OUT:/out")
    args+=(--out /out)
  fi
  log "running the build in container $CONTAINER_NAME"
  exec docker run --rm --init --name "$CONTAINER_NAME" \
    -e MTCODE_LINUX_IN_CONTAINER=1 \
    -e MTCODE_LINUX_REPO_URL="$REPO_URL" \
    -e MTCODE_LINUX_WORKDIR=/root/dev/mtcode-linux \
    -e npm_config_store_dir=/root/dev/.pnpm-store \
    "${mounts[@]}" "$CONTAINER_IMAGE" \
    bash /opt/mtcode/scripts/personal-linux-build.sh "${args[@]}"
fi

host_glibc="$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+$')"
if [[ "$(printf '%s\n%s\n' "$host_glibc" "$GLIBC_CEILING" | sort -V | tail -1)" != "$GLIBC_CEILING" ]]; then
  echo "this build environment has glibc $host_glibc; the installers must build against glibc <= $GLIBC_CEILING" >&2
  exit 1
fi
log "MT Code $VERSION from $REF on $(hostname) (glibc $host_glibc, $(nproc) cpus, $(free -g | awk '/^Mem:/ { print $2 }') GB)"

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
# scripts/linux-glibc.ts fails the build on any packaged ELF needing glibc
# newer than 2.39; this is what keeps the installers working on Ubuntu 24.04.
unset T3CODE_LINUX_GLIBC_BUILD_CEILING || true

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
# scripts/linux-after-pack.ts writes the libc6 floor from the packaged ELFs.
libc_floor="$(dpkg-deb --field "$DEB" Depends | grep -oE 'libc6 \(>= [0-9.]+\)' | grep -oE '[0-9]+\.[0-9]+' || true)"
log "deb Depends libc6 >= ${libc_floor:-none}"
if [[ -n "$libc_floor" && "$(printf '%s\n%s\n' "$libc_floor" "$GLIBC_CEILING" | sort -V | tail -1)" != "$GLIBC_CEILING" ]]; then
  echo "the .deb depends on libc6 >= $libc_floor, above $GLIBC_CEILING: it would not install on Ubuntu 24.04" >&2
  exit 1
fi

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
