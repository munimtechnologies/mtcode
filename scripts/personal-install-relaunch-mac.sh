#!/usr/bin/env bash
# Install a personal Mac DMG into /Applications and relaunch so the user does not
# have to open T3 Code by hand. Prints MAC_GUI_VISIBLE when a *fresh* process is up.
#
# Why this is a detached worker:
# Agents often run this *inside* T3 Code. Quitting the app then kills the installer
# shell mid-copy, which leaves a white window and never relaunches. The outer
# invocation always schedules a nohup worker that survives that quit, waits on a
# done marker when the parent lives (launchd / terminal), and still finishes if
# the parent dies with the app.
#
# Overwriting /Applications/T3 Code.app while it is still running is what leaves a
# white window. The worker kills every T3 Code process first, swaps the bundle
# only after they are gone, then opens a new instance.
#
# Usage:
#   personal-install-relaunch-mac.sh [path-to.dmg]
set -euo pipefail

REPO="${T3_PERSONAL_REPO:-$HOME/dev/t3code}"
LOG_DIR="${T3_PERSONAL_LOG_DIR:-$HOME/Library/Logs/t3-personal}"
mkdir -p "$LOG_DIR"

APP_PATH="/Applications/T3 Code.app"
APP_STAGING="/Applications/T3 Code.installing.app"
APP_BACKUP="/Applications/T3 Code.previous.app"

# --- outer: schedule worker and wait if we can ---
if [[ "${T3_MAC_INSTALL_WORKER:-}" != "1" ]]; then
  DMG_ARG="${1:-}"
  DONE="$LOG_DIR/mac-install-worker-$$.done"
  FAIL="$LOG_DIR/mac-install-worker-$$.fail"
  LOG="$LOG_DIR/mac-install-worker-$(date +%Y%m%d-%H%M%S).log"
  rm -f "$DONE" "$FAIL"

  echo "Mac install scheduling detached worker (log $LOG)"
  # launchctl/nohup so the worker is not in T3 Code's process group.
  nohup env \
    T3_MAC_INSTALL_WORKER=1 \
    T3_MAC_INSTALL_DONE="$DONE" \
    T3_MAC_INSTALL_FAIL="$FAIL" \
    T3_PERSONAL_REPO="$REPO" \
    T3_PERSONAL_LOG_DIR="$LOG_DIR" \
    T3_PERSONAL_SIGN_IDENTITY="${T3_PERSONAL_SIGN_IDENTITY:-}" \
    /bin/bash "$0" "$DMG_ARG" >>"$LOG" 2>&1 &
  WORKER_PID=$!
  echo "Mac install worker pid $WORKER_PID"

  for _ in $(seq 1 900); do
    if [[ -f "$DONE" ]]; then
      echo "Mac install worker finished ok"
      cat "$DONE"
      rm -f "$DONE" "$FAIL"
      exit 0
    fi
    if [[ -f "$FAIL" ]]; then
      echo "Mac install worker failed:" >&2
      cat "$FAIL" >&2 || true
      rm -f "$DONE" "$FAIL"
      exit 1
    fi
    if ! kill -0 "$WORKER_PID" 2>/dev/null; then
      if [[ -f "$DONE" ]]; then
        cat "$DONE"
        rm -f "$DONE" "$FAIL"
        exit 0
      fi
      echo "Mac install worker exited without a done marker — see $LOG" >&2
      exit 1
    fi
    sleep 1
  done

  echo "Mac install worker timed out after 15m — see $LOG" >&2
  exit 1
fi

# --- worker ---
DONE_FILE="${T3_MAC_INSTALL_DONE:?}"
FAIL_FILE="${T3_MAC_INSTALL_FAIL:?}"

fail() {
  echo "$*" | tee "$FAIL_FILE" >&2
  exit 1
}

DMG="${1:-}"
if [[ -z "$DMG" ]]; then
  DMG=$(ls -1t "$REPO"/release/T3-Code-*-arm64.dmg 2>/dev/null | head -1 || true)
fi
if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  fail "no arm64 DMG found to install"
fi

echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) worker start ===="
echo "Installing $DMG"

t3_pids() {
  pgrep -f '/Applications/T3 Code[^/]*\.app/' 2>/dev/null || true
}

t3_running() {
  [[ -n "$(t3_pids)" ]]
}

quit_t3() {
  echo "Mac quitting existing T3 Code…"

  osascript >/dev/null 2>&1 <<'APPLESCRIPT' || true
tell application "System Events"
  set procs to every process whose name is "T3 Code" or name starts with "T3 Code Helper"
  repeat with p in procs
    try
      tell p to quit
    end try
  end repeat
end tell
APPLESCRIPT
  osascript >/dev/null 2>&1 <<'APPLESCRIPT' || true
try
  tell application "T3 Code" to quit
end try
APPLESCRIPT

  local i pid
  for i in $(seq 1 40); do
    if ! t3_running; then
      echo "Mac quit clean"
      return 0
    fi
    sleep 0.25
  done

  echo "Mac soft quit timed out — sending TERM"
  for pid in $(t3_pids); do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for i in $(seq 1 20); do
    if ! t3_running; then
      echo "Mac quit after TERM"
      return 0
    fi
    sleep 0.25
  done

  echo "Mac still running — sending KILL"
  for pid in $(t3_pids); do
    kill -KILL "$pid" 2>/dev/null || true
  done
  sleep 0.5

  if t3_running; then
    fail "Mac quit failed — processes still held the bundle: $(t3_pids | tr '\n' ' ')"
  fi
  echo "Mac quit after KILL"
}

swap_install() {
  local source_app="$1"

  rm -rf "$APP_STAGING" "$APP_BACKUP"
  cp -R "$source_app" "$APP_STAGING"

  SIGN_IDENTITY="${T3_PERSONAL_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ { print $2; exit }')}"
  if [[ -n "$SIGN_IDENTITY" ]]; then
    if codesign --force --deep --sign "$SIGN_IDENTITY" "$APP_STAGING" >/dev/null 2>&1; then
      echo "Mac signed: $SIGN_IDENTITY"
    else
      echo "Mac signing failed — permission prompts will return on each rebuild" >&2
    fi
  else
    echo "no Developer ID identity found — leaving the ad-hoc signature" >&2
  fi

  xattr -dr com.apple.quarantine "$APP_STAGING" 2>/dev/null || true

  if [[ -d "$APP_PATH" ]]; then
    mv "$APP_PATH" "$APP_BACKUP"
  fi
  mv "$APP_STAGING" "$APP_PATH"
  rm -rf "$APP_BACKUP" \
    "/Applications/T3 Code (Nightly).app" \
    "/Applications/T3 Code (Alpha).app"

  echo "Mac installed: $APP_PATH ($(defaults read "$APP_PATH/Contents/Info" CFBundleShortVersionString 2>/dev/null || true))"
  echo "Mac name: $(defaults read "$APP_PATH/Contents/Info" CFBundleName 2>/dev/null || true)"
}

relaunch_t3() {
  local marker_epoch
  marker_epoch=$(date +%s)

  if t3_running; then
    echo "Mac relaunch refused — old processes still alive; forcing kill" >&2
    for pid in $(t3_pids); do
      kill -KILL "$pid" 2>/dev/null || true
    done
    sleep 0.5
  fi
  if t3_running; then
    fail "Mac relaunch failed — could not clear old processes"
  fi

  open "$APP_PATH" || fail "open $APP_PATH failed"

  local i pid start_epoch
  for i in $(seq 1 80); do
    pid=$(pgrep -n -f "$APP_PATH/Contents/MacOS/T3 Code$" 2>/dev/null || true)
    if [[ -z "$pid" ]]; then
      pid=$(pgrep -n -f "$APP_PATH/Contents/MacOS/T3 Code" 2>/dev/null || true)
    fi
    if [[ -n "$pid" ]]; then
      start_epoch=$(ps -p "$pid" -o lstart= 2>/dev/null | xargs -I{} date -j -f "%a %b %d %T %Y" "{}" "+%s" 2>/dev/null || echo "")
      if [[ -n "$start_epoch" && "$start_epoch" -lt "$marker_epoch" ]]; then
        echo "Mac found stale PID $pid (started before install) — killing" >&2
        kill -KILL "$pid" 2>/dev/null || true
        sleep 0.25
        open "$APP_PATH" || true
        sleep 0.25
        continue
      fi
      if osascript >/dev/null 2>&1 <<'APPLESCRIPT'
tell application "System Events"
  if not (exists process "T3 Code") then error "no process"
end tell
tell application "T3 Code" to activate
APPLESCRIPT
      then
        echo "MAC_GUI_VISIBLE $APP_PATH pid=$pid"
        return 0
      fi
    fi
    sleep 0.25
  done

  fail "Mac relaunch failed — no fresh T3 Code process after open"
}

quit_t3

MOUNT=$(hdiutil attach "$DMG" -nobrowse | awk 'END{for(i=3;i<=NF;i++) printf "%s%s", (i>3?" ":""), $i; print ""}')
if [[ -z "$MOUNT" || ! -d "$MOUNT" ]]; then
  fail "failed to mount $DMG"
fi
APP=$(find "$MOUNT" -maxdepth 1 -name '*.app' -print | head -1)
if [[ -z "$APP" ]]; then
  hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force || true
  fail "no .app in $DMG"
fi

swap_install "$APP"
hdiutil detach "$MOUNT" -quiet || hdiutil detach "$MOUNT" -force || true

relaunch_t3

{
  echo "MAC_GUI_VISIBLE $APP_PATH"
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) worker done ===="
} | tee "$DONE_FILE"
