#!/usr/bin/env bash
# Developer ID codesign the .app inside a Munim Mac DMG, then rebuild DMG + ZIP.
# Notarization requires an App Store Connect API Issuer ID (UUID) — set
# APPLE_API_ISSUER (+ APPLE_API_KEY / APPLE_API_KEY_ID) to also submit + staple.
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

STAGE="$WORK/stage"
mkdir -p "$STAGE"
ditto "$WORK/MT Code.app" "$STAGE/MT Code.app"
ln -s /Applications "$STAGE/Applications"

VOL_NAME="$(basename "$DMG" .dmg | sed 's/MT-Code-/MT Code /; s/-arm64//; s/$/ Installer/')"
SIGNED_DMG="$WORK/signed.dmg"
hdiutil create -volname "$VOL_NAME" -srcfolder "$STAGE" -ov -format UDZO "$SIGNED_DMG"
codesign --force --sign "$IDENTITY" --timestamp "$SIGNED_DMG"

SIGNED_ZIP="$WORK/signed.zip"
ditto -c -k --sequesterRsrc --keepParent "$WORK/MT Code.app" "$SIGNED_ZIP"

# Optional notarization when ASC API issuer is available.
if [[ -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_KEY:-}" ]]; then
  KEY_FILE="$WORK/AuthKey.p8"
  if [[ -f "${APPLE_API_KEY}" ]]; then
    KEY_FILE="$APPLE_API_KEY"
  else
    printf '%s' "$APPLE_API_KEY" >"$KEY_FILE"
  fi
  echo "submitting for notarization..."
  xcrun notarytool submit "$SIGNED_DMG" \
    --key "$KEY_FILE" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  xcrun stapler staple "$SIGNED_DMG"
  echo "notarized + stapled"
else
  echo "skipping notarization (set APPLE_API_ISSUER, APPLE_API_KEY_ID, APPLE_API_KEY to enable)"
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
