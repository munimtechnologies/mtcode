/**
 * Best-effort activate-or-launch of the installed T3 Code desktop app so
 * `t3 .` can attach a project to it instead of starting a headless server.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

/** Bundle / window names electron-builder ships for stable and nightly. */
export const DESKTOP_APP_NAMES = ["T3 Code (Alpha)", "T3 Code (Nightly)", "T3 Code"] as const;

export function windowsDesktopExecutableCandidates(
  localAppData: string = process.env.LOCALAPPDATA ??
    NodePath.join(NodeOS.homedir(), "AppData", "Local"),
): ReadonlyArray<string> {
  const programs = NodePath.join(localAppData, "Programs");
  const out: Array<string> = [];
  for (const name of DESKTOP_APP_NAMES) {
    out.push(NodePath.join(programs, "t3-code", `${name}.exe`));
    out.push(NodePath.join(programs, name, `${name}.exe`));
  }
  return out;
}

const spawnOk = (command: string, args: ReadonlyArray<string>): boolean => {
  try {
    const result = NodeChildProcess.spawnSync(command, [...args], {
      stdio: "ignore",
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
};

/** Activate a running desktop app, or launch it if installed. */
export const tryLaunchDesktopApp = Effect.fn("tryLaunchDesktopApp")(function* () {
  const platform = yield* HostProcessPlatform;

  if (platform === "darwin") {
    for (const name of DESKTOP_APP_NAMES) {
      if (spawnOk("open", ["-a", name])) {
        return true;
      }
    }
    return false;
  }

  if (platform === "win32") {
    for (const exe of windowsDesktopExecutableCandidates()) {
      if (!NodeFS.existsSync(exe)) continue;
      try {
        const child = NodeChildProcess.spawn(exe, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
        return true;
      } catch {
        // try next candidate
      }
    }
    return false;
  }

  // Linux: AppImage / desktop-entry installs vary; gtk-launch is best-effort.
  if (spawnOk("gtk-launch", ["com.t3tools.t3code"])) {
    return true;
  }
  for (const name of ["t3-code", "t3code"]) {
    if (spawnOk("gtk-launch", [name])) {
      return true;
    }
  }
  return false;
});
