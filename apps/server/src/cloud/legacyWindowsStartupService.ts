/**
 * Fork: before upstream's Task Scheduler service, MT Code ran `t3 service` on
 * Windows from a Startup folder shortcut whose launcher supervised itself and
 * stopped on a request file. Upstream's task replaces it; this retires the old
 * entry so two launchers never serve one T3 home.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const LEGACY_STARTUP_SHORTCUT_FILE = "T3 Code Server.lnk";
const LEGACY_RUNTIME_SCRIPTS = ["service-startup.ps1", "service-shortcut.ps1"] as const;
const LEGACY_PID_FILE = ".service-pid";
const LEGACY_STOP_REQUEST_FILE = ".service-stop-request";
// The old launcher polls for the request every 2s and may finish a backup first.
const LEGACY_STOP_POLL = Duration.millis(250);
const LEGACY_STOP_ATTEMPTS = 120;

/**
 * Removes the old Startup entry and asks its launcher to stop. Best effort: a
 * launcher that outlives the wait only holds the home, which leaves the new
 * service idle until it frees. Resolves whether anything legacy was found.
 */
export const retireLegacyWindowsStartupService = Effect.fn(
  "cloud.legacy_windows_startup_service.retire",
)(function* (baseDir: string) {
  if ((yield* HostProcess.Platform) !== "win32") return false;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const appData = (yield* HostProcess.Environment).APPDATA?.trim() ?? "";
  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));
  const remove = (target: string) => fs.remove(target, { force: true }).pipe(Effect.ignore);

  const runtimeDir = path.join(baseDir, "runtime");
  const pidPath = path.join(runtimeDir, LEGACY_PID_FILE);
  const shortcutPath =
    appData === ""
      ? undefined
      : path.join(
          appData,
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "Startup",
          LEGACY_STARTUP_SHORTCUT_FILE,
        );
  const hasShortcut = shortcutPath !== undefined && (yield* exists(shortcutPath));
  if (!hasShortcut && !(yield* exists(pidPath))) return false;

  // The shortcut first, so the next sign-in cannot start the old launcher again.
  if (shortcutPath !== undefined) yield* remove(shortcutPath);
  for (const script of LEGACY_RUNTIME_SCRIPTS) yield* remove(path.join(runtimeDir, script));

  if (yield* exists(pidPath)) {
    const stopRequestPath = path.join(runtimeDir, LEGACY_STOP_REQUEST_FILE);
    yield* fs.writeFileString(stopRequestPath, "").pipe(Effect.ignore);
    // The old launcher deletes its pid file as the last step of a stop.
    for (let attempt = 0; attempt < LEGACY_STOP_ATTEMPTS && (yield* exists(pidPath)); attempt++) {
      yield* Effect.sleep(LEGACY_STOP_POLL);
    }
    if (yield* exists(pidPath)) {
      yield* Effect.logWarning(
        "The previous Windows service launcher did not stop; the new service waits until it exits.",
      );
    }
    // Nothing reads these any more; a leftover pid file would only repeat this wait.
    yield* remove(pidPath);
    yield* remove(stopRequestPath);
  }
  return true;
});
