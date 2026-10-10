import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { CommandAvailability, WindowsShellEnvironment } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Observe the existing synchronous shell probe without launching the user's login shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import { assert, it, vi } from "vite-plus/test";

import { fixPath, hydratePosixEnvironment, hydratePosixHome } from "./os-jank.ts";

vi.mock("node:child_process", { spy: true });

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

it("imports the whole login-shell environment, not just PATH", () => {
  const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

  hydratePosixEnvironment(env, "linux", () => ({
    PATH: "/home/u/.nvm/bin:/usr/bin",
    EDITOR: "nvim",
    GOROOT: "/home/u/.gvm/go",
    RBENV_SHELL: "zsh",
  }));

  assert.equal(env.EDITOR, "nvim");
  assert.equal(env.GOROOT, "/home/u/.gvm/go");
  assert.equal(env.RBENV_SHELL, "zsh");
  assert.equal(env.PATH, "/home/u/.nvm/bin:/usr/bin");
});

it("keeps runtime-owned variables out of the import", () => {
  const env: NodeJS.ProcessEnv = {
    SHELL: "/bin/zsh",
    PATH: "/usr/bin",
    HOME: "/run/service-home",
    T3CODE_NO_BROWSER: "1",
  };

  hydratePosixEnvironment(env, "linux", () => ({
    HOME: "/home/u",
    T3CODE_NO_BROWSER: "0",
    PWD: "/home/u",
    SHLVL: "3",
    EDITOR: "nvim",
  }));

  assert.equal(env.HOME, "/run/service-home");
  assert.equal(env.T3CODE_NO_BROWSER, "1");
  assert.equal(env.PWD, undefined);
  assert.equal(env.SHLVL, undefined);
  assert.equal(env.EDITOR, "nvim");
});

it("preserves inherited values instead of overwriting them from the login shell", () => {
  const env: NodeJS.ProcessEnv = {
    SHELL: "/bin/zsh",
    PATH: "/usr/bin",
    SSH_AUTH_SOCK: "/tmp/inherited.sock",
    EDITOR: "vi",
  };

  hydratePosixEnvironment(env, "linux", () => ({
    SSH_AUTH_SOCK: "/tmp/login-shell.sock",
    EDITOR: "nvim",
  }));

  assert.equal(env.SSH_AUTH_SOCK, "/tmp/inherited.sock");
  assert.equal(env.EDITOR, "vi");
});

it("backfills a session handle the service was launched without", () => {
  const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

  hydratePosixEnvironment(env, "linux", () => ({ SSH_AUTH_SOCK: "/tmp/login-shell.sock" }));

  assert.equal(env.SSH_AUTH_SOCK, "/tmp/login-shell.sock");
});

it("treats an inherited empty value as absent", () => {
  const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin", EDITOR: "" };

  hydratePosixEnvironment(env, "linux", () => ({ EDITOR: "nvim" }));

  assert.equal(env.EDITOR, "nvim");
});

it("keeps the inherited environment when every candidate shell fails", () => {
  const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin", EDITOR: "vi" };

  hydratePosixEnvironment(env, "linux", () => {
    throw new Error("login shell unavailable");
  });

  assert.equal(env.EDITOR, "vi");
  assert.equal(env.PATH, "/usr/bin");
});

effectIt.effect.each(["darwin", "linux"] as const)(
  "keeps the prepared PATH and still hydrates HOME on %s",
  (platform) =>
    Effect.acquireUseRelease(
      Effect.sync(() => vi.spyOn(NodeChildProcess, "execFileSync")),
      (probe) =>
        Effect.gen(function* () {
          probe.mockImplementation(() => {
            throw new Error("The prepared environment must not launch another shell");
          });
          const env: NodeJS.ProcessEnv = { PATH: "/prepared/bin:/usr/bin" };

          yield* fixPath({ shellEnvironmentPrepared: true }).pipe(
            Effect.provideService(HostProcess.Platform, platform),
            Effect.provideService(HostProcess.Environment, env),
            Effect.provide(NodeServices.layer),
          );

          assert.equal(probe.mock.calls.length, 0);
          assert.equal(env.PATH, "/prepared/bin:/usr/bin");
          assert.equal(env.HOME, NodeOS.userInfo().homedir);
        }),
      (probe) => Effect.sync(() => probe.mockRestore()),
    ),
);

effectIt.effect("hydrates PATH when the desktop handoff is absent", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        // The fork imports the whole login-shell environment (`env -0`), not just PATH.
        .mockReturnValue("__T3CODE_ENV_ALL_START__\nPATH=/opt/tools/bin\0__T3CODE_ENV_ALL_END__\n"),
    ),
    (probe) =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
          Effect.provide(NodeServices.layer),
        );

        assert.equal(probe.mock.calls.length, 1);
        assert.equal(env.PATH, "/opt/tools/bin:/usr/bin");
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("repairs Windows PATH even when the desktop marks it prepared", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows" };
    const commands: string[] = [];

    yield* fixPath({ shellEnvironmentPrepared: true }).pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () => ({ PATH: "C:\\Tools" })),
      Effect.provideService(CommandAvailability, (command) =>
        Effect.sync(() => {
          commands.push(command);
          return true;
        }),
      ),
      Effect.provide(NodeServices.layer),
    );

    assert.deepEqual(commands, ["node"]);
    assert.equal(env.PATH, "C:\\Tools;C:\\Windows");
  }),
);
