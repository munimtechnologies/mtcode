#!/usr/bin/env bash
# Sync T3 Code preference files from this Mac to Blade + Dell.
# Source of truth: ~/.t3/userdata on the Mac.
#
# Syncs: client-settings, keybindings, sanitized settings.json, and the
#        durable asset-access signing key.
# Skips: state.sqlite, logs, attachments, computer-history, window bounds,
#        ephemeral cloud-health nonce/jti blobs, Chromium localStorage themes.
#
# Never sync clerk-tokens.json or connection-catalog.json. Both are encrypted
# with Electron safeStorage, which is backed by the macOS Keychain here and
# DPAPI on Windows, so a copy from this Mac cannot be decrypted on Blade or
# Dell. clerk-tokens fails soft (silently signed out, rewritten on next
# sign-in); connection-catalog fails hard on read. Each machine owns its own.
#
# Never sync cloud-endpoint-runtime-config.bin. It holds this machine's T3
# Connect tunnel token, and copying it makes every machine register as a
# replica of the same Cloudflare tunnel — the relay then round-robins Connect
# traffic between them, and any one machine's shutdown releases the shared
# tunnel out from under the others. Each machine provisions its own on start.
set -euo pipefail

export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.vite-plus/bin:/opt/homebrew/bin:$PATH"

SRC="${T3_PERSONAL_SETTINGS_SRC:-$HOME/.t3/userdata}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/settings-sync-$(date +%Y%m%d).log"
STAGE=$(mktemp -d /tmp/t3-settings-sync.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT

exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) settings sync start src=$SRC ===="

if [[ ! -d "$SRC" ]]; then
  echo "missing settings source: $SRC" >&2
  exit 1
fi

mkdir -p "$STAGE/secrets"

copy_if_present() {
  local name=$1
  if [[ -f "$SRC/$name" ]]; then
    cp -p "$SRC/$name" "$STAGE/$name"
    echo "staged $name"
  else
    echo "skip missing $name"
  fi
}

copy_if_present client-settings.json
copy_if_present keybindings.json

if [[ -f "$SRC/settings.json" ]]; then
  node --input-type=module -e '
import fs from "node:fs";
const src = process.argv[1];
const dest = process.argv[2];
const data = JSON.parse(fs.readFileSync(src, "utf8"));
const instances = data.providerInstances ?? {};
for (const value of Object.values(instances)) {
  const config = value?.config;
  if (!config || typeof config !== "object") continue;
  const binaryPath = typeof config.binaryPath === "string" ? config.binaryPath : "";
  const looksAbsolute =
    binaryPath.startsWith("/") ||
    binaryPath.includes(".app/") ||
    /^[A-Za-z]:[\\/]/.test(binaryPath) ||
    binaryPath.includes("\\\\");
  if (looksAbsolute) {
    config.binaryPath = "";
  }
}
fs.writeFileSync(dest, `${JSON.stringify(data, null, 2)}\n`);
' "$SRC/settings.json" "$STAGE/settings.json"
  echo "staged sanitized settings.json"
fi

for name in asset-access-signing-key.bin; do
  if [[ -f "$SRC/secrets/$name" ]]; then
    cp -p "$SRC/secrets/$name" "$STAGE/secrets/$name"
    echo "staged secrets/$name"
  fi
done

cat >"$STAGE/prepare-settings.ps1" <<'EOF'
$ErrorActionPreference = "Stop"
$userdata = Join-Path $env:USERPROFILE ".t3\userdata"
$secrets = Join-Path $userdata "secrets"
New-Item -ItemType Directory -Force -Path $secrets | Out-Null
Get-Process | Where-Object { $_.ProcessName -like "*T3*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 1
Write-Output ("SETTINGS_PREP_OK " + $userdata)
EOF

cat >"$STAGE/relaunch-t3.ps1" <<'EOF'
$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\t3code\T3 Code*.exe") -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "Uninstall*" } |
  Select-Object -First 1
if ($exe) {
  Start-Process $exe.FullName
  Write-Output ("relaunched " + $exe.Name)
} else {
  Write-Output "no T3 exe to relaunch"
}
EOF

# host -> Windows home relative path for -File scripts under ~/dev
push_host() {
  local host=$1
  local win_user=$2
  echo "-- syncing to $host --"

  scp -o BatchMode=yes -o ConnectTimeout=20 \
    "$STAGE/prepare-settings.ps1" "$STAGE/relaunch-t3.ps1" \
    "${host}:dev/"

  ssh -o BatchMode=yes -o ConnectTimeout=20 "$host" \
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File \
    "C:/Users/${win_user}/dev/prepare-settings.ps1"

  for name in client-settings.json keybindings.json settings.json; do
    if [[ -f "$STAGE/$name" ]]; then
      scp -o BatchMode=yes "$STAGE/$name" "${host}:.t3/userdata/${name}"
      echo "pushed $host $name"
    fi
  done

  for name in asset-access-signing-key.bin; do
    if [[ -f "$STAGE/secrets/$name" ]]; then
      scp -o BatchMode=yes "$STAGE/secrets/$name" "${host}:.t3/userdata/secrets/${name}"
      echo "pushed $host secrets/$name"
    fi
  done

  ssh -o BatchMode=yes "$host" \
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File \
    "C:/Users/${win_user}/dev/relaunch-t3.ps1"

  echo "done $host"
}

# Same reasoning as the refresh: a host that cannot be reached is reported, not fatal, so one
# machine being away does not cost the others their settings.
push_host blade muhha || echo "blade settings sync failed" >&2
push_host dell busin || echo "dell settings sync failed" >&2

echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) settings sync done ===="
