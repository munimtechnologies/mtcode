// @effect-diagnostics nodeBuiltinImport:off - the suite writes budget files to disk.
// @effect-diagnostics globalDate:off - the suite asserts on wall-clock budgets.
// @effect-diagnostics globalDateInEffect:off - the suite asserts on wall-clock budgets.
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  cursorAboutTimeoutMs,
  cursorAboutTimeoutMsFor,
  cursorAcpModelDiscoveryTimeoutMsFor,
  grokAcpModelDiscoveryTimeoutMsFor,
  isUsableProbeDirectory,
  providerAuthProbeTimeoutMs,
  providerAuthProbeTimeoutMsFor,
  providerVersionProbeTimeoutMsFor,
  resolveProviderProbeCwd,
  resolveProviderProbeCwdSync,
} from "./providerProbeTimeouts.ts";

describe("providerProbeTimeouts", () => {
  it("uses higher probe timeouts on Windows via pure helpers", () => {
    expect(cursorAboutTimeoutMsFor(true)).toBe(45_000);
    expect(cursorAcpModelDiscoveryTimeoutMsFor(true)).toBe(45_000);
    expect(grokAcpModelDiscoveryTimeoutMsFor(true)).toBe(45_000);
    expect(providerAuthProbeTimeoutMsFor(true)).toBe(45_000);
    expect(providerVersionProbeTimeoutMsFor(true)).toBe(15_000);

    expect(cursorAboutTimeoutMsFor(false)).toBe(20_000);
    expect(providerAuthProbeTimeoutMsFor(false)).toBe(15_000);
    expect(providerVersionProbeTimeoutMsFor(false)).toBe(4_000);
  });

  it.effect("Effect timeout values follow HostProcess.Platform", () =>
    Effect.gen(function* () {
      const winAbout = yield* cursorAboutTimeoutMs.pipe(
        Effect.provideService(HostProcess.Platform, "win32"),
      );
      const linuxAuth = yield* providerAuthProbeTimeoutMs.pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      expect(winAbout).toBe(45_000);
      expect(linuxAuth).toBe(15_000);
    }),
  );

  it("resolveProviderProbeCwdSync prefers explicit cwd when it is usable", () => {
    const preferred = NodeOS.tmpdir();
    expect(resolveProviderProbeCwdSync(preferred)).toBe(preferred);
  });

  it("resolveProviderProbeCwdSync ignores non-directories and falls back", () => {
    const missing = NodePath.join(NodeOS.tmpdir(), `t3-missing-cwd-${Date.now()}`);
    const resolved = resolveProviderProbeCwdSync(missing, {
      T3_PROVIDER_CWD: NodeOS.tmpdir(),
    });
    expect(resolved).toBe(NodeOS.tmpdir());
  });

  it("resolveProviderProbeCwdSync always returns an existing usable directory", () => {
    const resolved = resolveProviderProbeCwdSync(null, {});
    expect(isUsableProbeDirectory(resolved)).toBe(true);
  });

  it("isUsableProbeDirectory rejects missing paths", () => {
    const missing = NodePath.join(NodeOS.tmpdir(), `t3-no-such-dir-${Date.now()}`);
    expect(isUsableProbeDirectory(missing)).toBe(false);
  });

  it.effect("resolveProviderProbeCwd Effect form matches sync", () =>
    Effect.gen(function* () {
      const preferred = NodeOS.tmpdir();
      const viaEffect = yield* resolveProviderProbeCwd(preferred, {});
      expect(viaEffect).toBe(resolveProviderProbeCwdSync(preferred, {}));
      expect(NodeFS.statSync(viaEffect).isDirectory()).toBe(true);
    }),
  );

  it.effect("resolveProviderProbeCwd uses HostProcess.WorkingDirectory as a candidate", () =>
    Effect.gen(function* () {
      const preferredMissing = NodePath.join(NodeOS.tmpdir(), `t3-missing-wd-${Date.now()}`);
      const overrideCwd = NodeOS.tmpdir();
      const viaEffect = yield* resolveProviderProbeCwd(preferredMissing, {}).pipe(
        Effect.provideService(HostProcess.WorkingDirectory, overrideCwd),
      );
      expect(viaEffect).toBe(overrideCwd);
    }),
  );
});
