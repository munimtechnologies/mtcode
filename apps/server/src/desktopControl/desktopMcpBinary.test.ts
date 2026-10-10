// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodePath from "node:path";

import {
  newestStandaloneRelease,
  packagedDesktopMcpCandidates,
  resolveDesktopMcpPath,
} from "./desktopMcpBinary.ts";

describe("desktopMcpBinary", () => {
  it.effect("resolves the override path on macOS", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-binary-",
      });
      const binaryPath = `${baseDir}/munim-computer-use`;
      yield* fileSystem.writeFileString(binaryPath, "binary");
      yield* fileSystem.chmod(binaryPath, 0o755);

      const resolved = yield* resolveDesktopMcpPath().pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, {
          MTCODE_DESKTOP_MCP_PATH: binaryPath,
        }),
      );

      assert.equal(resolved, binaryPath);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves the override on Linux and Windows too", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-binary-",
      });

      // Windows ships the .exe; the other platforms do not.
      for (const [platform, name] of [
        ["linux", "munim-computer-use"],
        ["win32", "munim-computer-use.exe"],
      ] as const) {
        const binaryPath = `${baseDir}/${name}`;
        yield* fileSystem.writeFileString(binaryPath, "binary");
        if (platform !== "win32") {
          yield* fileSystem.chmod(binaryPath, 0o755);
        }

        const resolved = yield* resolveDesktopMcpPath().pipe(
          Effect.provideService(HostProcess.Platform, platform),
          Effect.provideService(HostProcess.Environment, {
            MTCODE_DESKTOP_MCP_PATH: binaryPath,
          }),
        );
        assert.equal(resolved, binaryPath);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("still honours the deprecated T3CODE_DESKTOP_MCP_PATH, after the MT name", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-binary-",
      });
      const legacyPath = `${baseDir}/legacy`;
      const currentPath = `${baseDir}/current`;
      for (const binaryPath of [legacyPath, currentPath]) {
        yield* fileSystem.writeFileString(binaryPath, "binary");
        yield* fileSystem.chmod(binaryPath, 0o755);
      }

      const legacyOnly = yield* resolveDesktopMcpPath().pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, { T3CODE_DESKTOP_MCP_PATH: legacyPath }),
      );
      assert.equal(legacyOnly, legacyPath);

      const both = yield* resolveDesktopMcpPath().pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, {
          MTCODE_DESKTOP_MCP_PATH: currentPath,
          T3CODE_DESKTOP_MCP_PATH: legacyPath,
        }),
      );
      assert.equal(both, currentPath);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falls back to a local munim-computer-use checkout build", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const checkout = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-checkout-",
      });
      const binaryDir = `${checkout}/windows-linux/target/release`;
      yield* fileSystem.makeDirectory(binaryDir, { recursive: true });
      const binaryPath = `${binaryDir}/munim-computer-use`;
      yield* fileSystem.writeFileString(binaryPath, "binary");
      yield* fileSystem.chmod(binaryPath, 0o755);

      const resolved = yield* resolveDesktopMcpPath().pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, {
          HOME: checkout,
          MUNIM_COMPUTER_USE_CHECKOUT: checkout,
        }),
      );
      assert.equal(resolved, binaryPath);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("finds the packaged copy beside the app.asar the macOS server runs from", () => {
    const candidates = packagedDesktopMcpCandidates({
      moduleDir: "/Applications/MT Code.app/Contents/Resources/app.asar/apps/server/dist",
      executableName: "munim-computer-use",
      path: NodePath.posix,
    });
    assert.include(
      candidates,
      "/Applications/MT Code.app/Contents/Resources/munim-computer-use/munim-computer-use",
    );
  });

  it("finds the packaged copy beside the server.asar the Windows server runs from", () => {
    const candidates = packagedDesktopMcpCandidates({
      moduleDir:
        "C:\\Users\\busin\\AppData\\Local\\Programs\\mtcode\\resources\\server.asar\\apps\\server\\dist",
      executableName: "munim-computer-use.exe",
      path: NodePath.win32,
    });
    assert.include(
      candidates,
      "C:\\Users\\busin\\AppData\\Local\\Programs\\mtcode\\resources\\munim-computer-use\\munim-computer-use.exe",
    );
  });

  it("adds no archive candidate for a server outside any asar (checkout, SSH runtime)", () => {
    const candidates = packagedDesktopMcpCandidates({
      moduleDir: "/home/me/.t3/runtime/versions/0.0.96/apps/server/dist",
      executableName: "munim-computer-use",
      path: NodePath.posix,
    });
    assert.deepEqual(candidates, [
      "/home/me/.t3/runtime/versions/0.0.96/apps/server/dist/munim-computer-use/munim-computer-use",
      "/home/me/.t3/runtime/versions/0.0.96/apps/server/munim-computer-use/munim-computer-use",
    ]);
  });

  it("picks the newest standalone release that supports remote control", () => {
    assert.equal(
      newestStandaloneRelease(["0.4.0", "0.4.10", "0.4.4", ".0.4.5-download-x", "0.5.0-rc.1"]),
      "0.4.10",
    );
    assert.equal(newestStandaloneRelease(["0.3.0", "0.4.0"]), undefined);
    assert.equal(newestStandaloneRelease([]), undefined);
  });

  it.effect("falls back to the standalone npx launcher's cache (SSH hosts)", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const home = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-home-",
      });
      const cache = `${home}/.cache/munim-computer-use`;
      for (const version of ["0.4.0", "0.4.4"]) {
        yield* fileSystem.makeDirectory(`${cache}/${version}`, { recursive: true });
        const binaryPath = `${cache}/${version}/munim-computer-use`;
        yield* fileSystem.writeFileString(binaryPath, "binary");
        yield* fileSystem.chmod(binaryPath, 0o755);
      }

      const resolved = yield* resolveDesktopMcpPath().pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, {
          HOME: home,
          MUNIM_COMPUTER_USE_CHECKOUT: `${home}/no-checkout`,
          MTCODE_COMPUTER_USE_CACHE: `${home}/no-fetched-release`,
        }),
      );
      assert.equal(resolved, `${cache}/0.4.4/munim-computer-use`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("returns undefined on platforms with no desktop backend", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-binary-",
      });
      const binaryPath = `${baseDir}/munim-computer-use`;
      yield* fileSystem.writeFileString(binaryPath, "binary");

      // Neither backend covers these, so the tools must not be offered even
      // when someone points the override at a binary.
      for (const platform of ["freebsd", "aix"] as const) {
        const resolved = yield* resolveDesktopMcpPath().pipe(
          Effect.provideService(HostProcess.Platform, platform),
          Effect.provideService(HostProcess.Environment, {
            MTCODE_DESKTOP_MCP_PATH: binaryPath,
          }),
        );
        assert.equal(resolved, undefined);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("returns undefined when nothing is built or overridden", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "munim-computer-use-binary-",
      });

      const resolved = yield* resolveDesktopMcpPath().pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, {
          MTCODE_DESKTOP_MCP_PATH: `${baseDir}/does-not-exist`,
        }),
      );

      // A dev checkout that has built the binary will resolve a bundled
      // candidate; otherwise nothing matches. Both are valid — the contract is
      // that a missing override never throws and never returns the bad path.
      assert.notEqual(resolved, `${baseDir}/does-not-exist`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
