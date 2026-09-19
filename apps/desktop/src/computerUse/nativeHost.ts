// @effect-diagnostics nodeBuiltinImport:off - one-shot child process from Electron main.
import * as NodeChildProcess from "node:child_process";

import { mtcodeDesktopProfileEnv } from "@t3tools/shared/munimComputerUse";

import { resolveDesktopMcpBinaryPathSync } from "../computerHistory/resolveBinary.ts";

let registration: Promise<boolean> | undefined;

/**
 * Register MT Code's Chrome native-messaging host (`com.munim.mtcode.desktop`)
 * so the extension reaches the desktop-control server MT Code runs.
 *
 * munim-computer-use does the work (`install-native-host`): under the MT
 * profile it writes a wrapper that relays into MT Code's own bridge socket, and
 * the host manifest for every Chrome/Chromium profile directory (the registry
 * on Windows). The binary rewrites nothing that is already current, so this is
 * cheap to repeat; it runs at most once per app launch and resolves to whether
 * a browser was registered.
 */
export function ensureChromeNativeHostRegistered(): Promise<boolean> {
  registration ??= new Promise((resolve) => {
    const binary = resolveDesktopMcpBinaryPathSync();
    if (!binary) {
      resolve(false);
      return;
    }
    NodeChildProcess.execFile(
      binary,
      ["install-native-host", "--binary", binary],
      { env: { ...process.env, ...mtcodeDesktopProfileEnv() }, timeout: 15_000 },
      (error, _stdout, stderr) => {
        if (error) {
          process.stderr.write(
            `[computer-use] native host registration failed: ${stderr || error.message}\n`,
          );
        }
        resolve(!error);
      },
    );
  });
  return registration;
}
