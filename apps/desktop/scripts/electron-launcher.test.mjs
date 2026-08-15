import { assert, describe, it } from "vite-plus/test";

import {
  makeMacDevelopmentOpenCommand,
  makeDevelopmentLauncherSource,
  resolveElectronBinaryPath,
  resolveMacLauncherIconPaths,
  resolveMacLauncherPaths,
} from "./electron-launcher.mjs";

describe("electron development launcher", () => {
  it("uses captured values only as fallbacks for a live runner environment", () => {
    const source = makeDevelopmentLauncherSource({
      electronBinaryPath: "/repo/node_modules/electron/Electron",
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {
        VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
        T3CODE_PORT: "16566",
        T3CODE_HOME: "/tmp/t3",
      },
    });

    assert.include(source, 'setFallback("VITE_DEV_SERVER_URL", "http://127.0.0.1:8526");');
    assert.notInclude(source, 'setenv("VITE_DEV_SERVER_URL"');
    assert.include(source, 'const char *electronPath = "/repo/node_modules/electron/Electron";');
    assert.include(source, 'childArgs[1] = "--t3code-dev-root=/repo/apps/desktop";');
    assert.include(source, 'childArgs[2] = "/repo/apps/desktop/dist-electron/main.cjs";');
    assert.include(source, "childPid = fork();");
    assert.include(source, "waitpid(childPid, &status, 0)");
    assert.include(source, "kill(childPid, signalNumber);");
    assert.notInclude(source, "\n  execv(electronPath, childArgs);");
  });

  it("repairs Electron before loading the package entrypoint", () => {
    const calls = [];
    const electronPath = resolveElectronBinaryPath({
      ensureRuntime: () => {
        calls.push("ensure");
      },
      createRequire: () => (specifier) => {
        calls.push(`require:${specifier}`);
        return "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
      },
      moduleUrl: import.meta.url,
    });

    assert.equal(
      electronPath,
      "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
    assert.deepEqual(calls, ["ensure", "require:electron"]);
  });

  it("keeps the native Electron executable name inside the branded macOS bundle", () => {
    const paths = resolveMacLauncherPaths(
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app",
      "T3 Code (Dev)",
    );

    assert.equal(paths.launcherExecutableName, "T3 Code (Dev) Launcher");
    assert.equal(
      paths.launcherBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher",
    );
    assert.equal(
      paths.runtimeElectronBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/Electron",
    );

    const source = makeDevelopmentLauncherSource({
      electronBinaryPath: paths.runtimeElectronBinaryPath,
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {},
    });
    assert.include(
      source,
      'const char *electronPath = "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/Electron";',
    );
    assert.notInclude(source, "node_modules/electron");
  });

  it("launches the development bundle through LaunchServices", () => {
    assert.deepEqual(
      makeMacDevelopmentOpenCommand("/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app", [
        "--remote-debugging-port=9222",
      ]),
      {
        electronPath: "/usr/bin/open",
        args: [
          "-W",
          "-n",
          "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app",
          "--args",
          "--remote-debugging-port=9222",
        ],
      },
    );
  });

  it("derives launcher icons from canonical development and production assets", () => {
    const development = resolveMacLauncherIconPaths("/runtime", true);
    const production = resolveMacLauncherIconPaths("/runtime", false);

    assert.match(development.sourceIconPath, /assets\/dev\/blueprint-macos-1024\.png$/);
    assert.equal(development.generatedIconPath, "/runtime/icon-dev.icns");
    assert.match(production.sourceIconPath, /assets\/prod\/black-macos-1024\.png$/);
    assert.equal(production.generatedIconPath, "/runtime/icon-prod.icns");
  });
});
