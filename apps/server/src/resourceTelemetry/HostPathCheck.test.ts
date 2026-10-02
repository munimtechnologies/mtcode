// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

import { checkHostPaths, resolveHostPath } from "./HostPathCheck.ts";

describe("resolveHostPath", () => {
  const mac = { homeDirectory: "/Users/me", platform: "darwin" as const };
  const windows = { homeDirectory: "C:\\Users\\me", platform: "win32" as const };

  it("resolves home-relative and relative paths against the home directory", () => {
    expect(resolveHostPath("~/dev/app", mac)).toBe("/Users/me/dev/app");
    expect(resolveHostPath("~", mac)).toBe("/Users/me");
    expect(resolveHostPath("dev/app", mac)).toBe("/Users/me/dev/app");
    expect(resolveHostPath("~/dev/app", windows)).toBe("C:\\Users\\me\\dev\\app");
    expect(resolveHostPath("%USERPROFILE%\\dev\\app", windows)).toBe("C:\\Users\\me\\dev\\app");
    expect(resolveHostPath("dev/app", windows)).toBe("C:\\Users\\me\\dev\\app");
  });

  it("keeps absolute paths and drops drive letters off Windows", () => {
    expect(resolveHostPath("/opt/tools", mac)).toBe("/opt/tools");
    expect(resolveHostPath("C:/Users/me/dev", windows)).toBe("C:\\Users\\me\\dev");
    expect(resolveHostPath("C:\\Users\\me\\dev", mac)).toBeNull();
    expect(resolveHostPath("~other/dev", mac)).toBe("/Users/me/~other/dev");
  });
});

describe("checkHostPaths", () => {
  it.effect("returns the requested spellings that exist", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "host-path-check-")),
      );
      yield* Effect.promise(() =>
        NodeFSP.mkdir(NodePath.join(home, "dev", "app"), { recursive: true }),
      );
      const platform = yield* HostProcessPlatform;
      const result = yield* checkHostPaths(
        { paths: ["~/dev/app", "dev/app", "~/dev/missing", "C:\\nowhere"] },
        { homeDirectory: home, platform },
      );
      expect(result.existing).toEqual(["~/dev/app", "dev/app"]);
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
