#!/usr/bin/env bash
# Developer ID codesign the .app inside a Munim Mac DMG, notarize + staple the
# app and the DMG, then rebuild DMG + ZIP.
#
# Notarization is required: an unnotarized Developer ID build is what makes
# macOS say "Apple could not verify MT Code is free of malware". Credentials
# come from APPLE_API_ISSUER + APPLE_API_KEY_ID + APPLE_API_KEY when set, else
# the notarytool keychain profile T3_NOTARY_PROFILE (default "mtcode-notary",
# created with `xcrun notarytool store-credentials`). T3_SKIP_NOTARIZE=1 opts
# out for local test builds only.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

DMG="${1:-}"
if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "usage: $0 /path/to/MT-Code-*-arm64.dmg" >&2
  exit 1
fi

IDENTITY="${T3_PERSONAL_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ { print $2; exit }')}"
if [[ -z "$IDENTITY" ]]; then
  echo "no Developer ID Application identity in keychain" >&2
  exit 1
fi

WORK="$(mktemp -d /tmp/mt-codesign.XXXXXX)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Apple's timestamp server drops requests during brownouts, and osx-sign makes one per
# binary, so a single dropped request failed a whole release. This codesign retries those
# requests, and only those, before giving up.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/codesign" <<'SH'
#!/bin/bash
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  out="$(mktemp)"
  err="$(mktemp)"
  /usr/bin/codesign "$@" >"$out" 2>"$err"
  status=$?
  if [[ $status -eq 0 || $attempt -eq 10 ]] || ! grep -q "timestamp service is not available" "$err"; then
    cat "$out"
    cat "$err" >&2
    rm -f "$out" "$err"
    exit "$status"
  fi
  rm -f "$out" "$err"
  echo "codesign: timestamp service unavailable, retrying (attempt $attempt)" >&2
  sleep $((attempt < 6 ? attempt * 5 : 30))
done
SH
chmod +x "$WORK/bin/codesign"
export PATH="$WORK/bin:$PATH"

echo "codesigning with: $IDENTITY"
echo "dmg: $DMG"

ATTACH_OUT="$(hdiutil attach -nobrowse -readonly "$DMG")"
MOUNT="$(printf '%s\n' "$ATTACH_OUT" | awk '/\/Volumes\//{print substr($0, index($0, "/Volumes/"))}' | tail -1)"
if [[ -z "$MOUNT" || ! -d "$MOUNT" ]]; then
  echo "failed to mount DMG" >&2
  echo "$ATTACH_OUT" >&2
  exit 1
fi

APP_SRC="$(find "$MOUNT" -maxdepth 2 -name '*.app' | head -1)"
if [[ -z "$APP_SRC" ]]; then
  hdiutil detach "$MOUNT" -quiet || true
  echo "no .app found in DMG" >&2
  exit 1
fi

ditto "$APP_SRC" "$WORK/MT Code.app"
hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force

APP="$WORK/MT Code.app"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OSX_SIGN_DIR="$(find "$REPO_ROOT/node_modules" -type d -path '*/node_modules/@electron/osx-sign' 2>/dev/null | head -1)"
if [[ -z "$OSX_SIGN_DIR" || ! -f "$OSX_SIGN_DIR/package.json" ]]; then
  echo "missing @electron/osx-sign" >&2
  exit 1
fi
echo "osx-sign: $OSX_SIGN_DIR"

# Proper Electron inside-out signing (hardened runtime + Apple timestamp).
IDENTITY="$IDENTITY" APP_PATH="$APP" OSX_SIGN_DIR="$OSX_SIGN_DIR" node <<'NODE'
const { signAsync } = require(process.env.OSX_SIGN_DIR);
(async () => {
  await signAsync({
    app: process.env.APP_PATH,
    platform: 'darwin',
    identity: process.env.IDENTITY,
    hardenedRuntime: true,
    optionsForFile: () => ({
      hardenedRuntime: true,
    }),
  });
  console.log('osx-sign complete');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
NODE

codesign --verify --deep --strict "$APP"

NOTARY_ARGS=()
if [[ -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_KEY:-}" ]]; then
  KEY_FILE="$WORK/AuthKey.p8"
  if [[ -f "${APPLE_API_KEY}" ]]; then
    KEY_FILE="$APPLE_API_KEY"
  else
    printf '%s' "$APPLE_API_KEY" >"$KEY_FILE"
  fi
  NOTARY_ARGS=(--key "$KEY_FILE" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
elif [[ "${T3_SKIP_NOTARIZE:-0}" != "1" ]]; then
  NOTARY_ARGS=(--keychain-profile "${T3_NOTARY_PROFILE:-mtcode-notary}")
fi

notarize() {
  local target="$1" out attempt extra=()
  for attempt in 1 2 3; do
    echo "notarizing $(basename "$target") (attempt $attempt)..."
    out="$(xcrun notarytool submit "$target" "${NOTARY_ARGS[@]}" ${extra[@]+"${extra[@]}"} --wait 2>&1)" || true
    printf '%s\n' "$out"
    # A verdict ("status: Accepted/Invalid/...") is final. No verdict means the
    # upload itself died (abortedUpload / deadlineExceeded on a flaky link),
    # so retry, skipping S3 transfer acceleration, whose endpoint is the one
    # that stalls.
    if printf '%s\n' "$out" | grep -q "^  *status: "; then break; fi
    extra=(--no-s3-acceleration)
    sleep 10
  done
  if ! printf '%s\n' "$out" | grep -q "status: Accepted"; then
    local id
    id="$(printf '%s\n' "$out" | awk '/^  id: /{print $2; exit}')"
    if [[ -n "$id" ]]; then
      xcrun notarytool log "$id" "${NOTARY_ARGS[@]}" >&2 || true
    fi
    echo "notarization failed for $target" >&2
    exit 1
  fi
}

if [[ ${#NOTARY_ARGS[@]} -gt 0 ]]; then
  # Staple the app itself so the updater ZIP carries its own ticket, then the
  # DMG built from it.
  APP_ZIP="$WORK/notarize-app.zip"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$APP_ZIP"
  notarize "$APP_ZIP"
  xcrun stapler staple "$APP"
  rm -f "$APP_ZIP"
else
  echo "WARNING: T3_SKIP_NOTARIZE=1 -- this build will trip Gatekeeper on other Macs" >&2
fi

STAGE="$WORK/stage"
mkdir -p "$STAGE"
ditto "$WORK/MT Code.app" "$STAGE/MT Code.app"
ln -s /Applications "$STAGE/Applications"

VOL_NAME="$(basename "$DMG" .dmg | sed 's/MT-Code-/MT Code /; s/-arm64//; s/$/ Installer/')"
SIGNED_DMG="$WORK/signed.dmg"
# hdiutil create intermittently fails "Resource busy" while the volume from an
# earlier attach is still being released.
for attempt in 1 2 3 4 5; do
  hdiutil create -volname "$VOL_NAME" -srcfolder "$STAGE" -ov -format UDZO "$SIGNED_DMG" && break
  [[ $attempt -eq 5 ]] && exit 1
  echo "hdiutil create failed (attempt $attempt); retrying in 15s" >&2
  sleep 15
done
codesign --force --sign "$IDENTITY" --timestamp "$SIGNED_DMG"

SIGNED_ZIP="$WORK/signed.zip"
ditto -c -k --sequesterRsrc --keepParent "$WORK/MT Code.app" "$SIGNED_ZIP"

if [[ ${#NOTARY_ARGS[@]} -gt 0 ]]; then
  notarize "$SIGNED_DMG"
  xcrun stapler staple "$SIGNED_DMG"
  spctl -a -t open --context context:primary-signature -vv "$SIGNED_DMG"
  spctl -a -t exec -vv "$APP"
  echo "notarized + stapled"
fi

cp "$SIGNED_DMG" "$DMG"
ZIP_OUT="${DMG%.dmg}.zip"
cp "$SIGNED_ZIP" "$ZIP_OUT"

# Refresh latest-mac.yml next to the DMG when present.
YML="$(dirname "$DMG")/latest-mac.yml"
if [[ -f "$YML" ]]; then
  python3 - "$DMG" "$ZIP_OUT" "$YML" <<'PY'
import base64, hashlib, sys
from datetime import datetime, timezone
from pathlib import Path

dmg, zip_path, yml = map(Path, sys.argv[1:])

def digest(path: Path) -> tuple[str, int]:
    h = hashlib.sha512()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode(), path.stat().st_size

zip_sha, zip_size = digest(zip_path)
dmg_sha, dmg_size = digest(dmg)
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
# Keep version line if present
version = "0.0.0"
for line in yml.read_text().splitlines():
    if line.startswith("version:"):
        version = line.split(":", 1)[1].strip()
        break
yml.write_text(
    f"""version: {version}
files:
  - url: {zip_path.name}
    sha512: {zip_sha}
    size: {zip_size}
  - url: {dmg.name}
    sha512: {dmg_sha}
    size: {dmg_size}
path: {zip_path.name}
sha512: {zip_sha}
releaseDate: '{now}'
"""
)
print(f"updated {yml}")
PY
fi

echo "SIGNED_DMG=$DMG"
echo "SIGNED_ZIP=$ZIP_OUT"
