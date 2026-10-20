// @effect-diagnostics nodeBuiltinImport:off -- The process fixture runs real shell commands with isolated config files.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import { assert, describe, it } from "@effect/vitest";
import { WindowsPersistentPath } from "@t3tools/shared/shell";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as TestClock from "effect/testing/TestClock";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopShellEnvironment from "./DesktopShellEnvironment.ts";
import {
  DEFAULT_SHELL_ENVIRONMENT_HARVEST,
  type ShellEnvironmentHarvest,
} from "./shellEnvironmentHarvest.ts";

vi.mock("node:os", { spy: true });

const textEncoder = new TextEncoder();

const isDesktopShellEnvironmentCommandError = Schema.is(
  DesktopShellEnvironment.DesktopShellEnvironmentCommandError,
);

function envOutput(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .flatMap(([name, value]) => [
      `__T3CODE_ENV_${name}_START__`,
      value,
      `__T3CODE_ENV_${name}_END__`,
    ])
    .join("\n");
}

function fullEnvOutput(values: Readonly<Record<string, string>>): string {
  const body = Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\0");
  return ["__T3CODE_ENV_*_START__", body, "__T3CODE_ENV_*_END__"].join("\n");
}

function commandLine(command: ChildProcess.Command): string {
  return command._tag === "StandardCommand" ? command.args.join(" ") : "";
}

function makeProcess(output: string, exitCode = 0): ChildProcessSpawner.ChildProcessHandle {
  const stdout = output.length === 0 ? Stream.empty : Stream.make(textEncoder.encode(output));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout,
    stderr: Stream.empty,
    all: stdout,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
}

function makeHangingProcess(): ChildProcessSpawner.ChildProcessHandle {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(124),
    stdout: Stream.never,
    stderr: Stream.never,
    all: Stream.never,
    exitCode: Effect.never,
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
}

function withProcessEnv<A, E, R>(
  env: NodeJS.ProcessEnv,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env;
      process.env = env;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.env = previous;
      }),
  );
}

function runShellEnvironment(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly userShell?: string;
  readonly handler: (
    command: ChildProcess.Command,
  ) =>
    | string
    | { output: string; exitCode: number }
    | ChildProcessSpawner.ChildProcessHandle
    | Effect.Effect<ChildProcessSpawner.ChildProcessHandle, PlatformError.PlatformError>;
  readonly failure?: PlatformError.PlatformError;
  readonly persistentPath?: string;
  readonly harvest?: ShellEnvironmentHarvest;
}) {
  const layerEnvironment = Layer.succeed(
    DesktopEnvironment.DesktopEnvironment,
    DesktopEnvironment.DesktopEnvironment.of({
      platform: input.platform,
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
  );
  const layerSpawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      if (input.failure !== undefined) return Effect.fail(input.failure);
      const result = input.handler(command);
      if (Effect.isEffect(result)) return result;
      if (typeof result === "string") return Effect.succeed(makeProcess(result));
      return Effect.succeed(
        "output" in result ? makeProcess(result.output, result.exitCode) : result,
      );
    }),
  );
  const layerPersistentPath = Layer.succeed(WindowsPersistentPath, () => input.persistentPath);

  const program = Effect.gen(function* () {
    const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
    const harvest = input.harvest ?? DEFAULT_SHELL_ENVIRONMENT_HARVEST;
    const prepared = yield* shellEnvironment.installIntoProcess(harvest);
    assert.equal(yield* shellEnvironment.installIntoProcess(harvest), prepared);
    return prepared;
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        layerPersistentPath,
        DesktopShellEnvironment.layer.pipe(
          Layer.provide(Layer.mergeAll(layerEnvironment, NodeServices.layer, layerSpawner)),
        ),
      ),
    ),
  );

  return Effect.acquireUseRelease(
    Effect.sync(() =>
      vi.spyOn(NodeOS, "userInfo").mockReturnValue({
        ...NodeOS.userInfo(),
        shell: input.userShell ?? null,
      }),
    ),
    () => withProcessEnv(input.env, program),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );
}

describe("DesktopShellEnvironment", () => {
  // Explicit opt-in keeps real shell coverage independent of globally installed tools.
  it.effect.runIf(process.env.T3_TEST_NU_PATH !== undefined)(
    "hydrates the desktop through a renamed Nushell symlink with native export conversions",
    () =>
      Effect.gen(function* () {
        const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-nu-"));
        try {
          const toolPath = NodePath.join(home, "nu tools", "bin");
          const extraToolPath = NodePath.join(home, "extra-tools", "bin");
          const convertedToolPath = NodePath.join(home, "converted-tools", "bin");
          NodeFS.mkdirSync(toolPath, { recursive: true });
          NodeFS.mkdirSync(extraToolPath, { recursive: true });
          NodeFS.mkdirSync(convertedToolPath, { recursive: true });
          const shell = NodePath.join(toolPath, "nushell");
          NodeFS.symlinkSync(process.env.T3_TEST_NU_PATH!, shell);
          const config = NodePath.join(home, "config.nu");
          const envConfig = NodePath.join(home, "env.nu");
          NodeFS.writeFileSync(envConfig, "");
          NodeFS.writeFileSync(
            config,
            [
              `$env.PATH = [${JSON.stringify(toolPath)}, ${JSON.stringify(extraToolPath)}]`,
              '$env.SSH_AUTH_SOCK = "/tmp/nu-agent.sock"',
              '$env.__MISE_DIFF = "  first\\nsecond  "',
              '$env.HOMEBREW_PREFIX = ""',
              "$env.ENV_CONVERSIONS = {",
              "  PATH: {",
              "    from_string: {|value| $value | split row (char esep) },",
              '    to_string: {|value| $value | str join (char esep) | str replace "nu tools" "converted-tools" }',
              "  },",
              "  __MISE_DIFF: { from_string: {|value| $value }, to_string: { str upcase } }",
              "}",
              'print "startup noise"',
            ].join("\n"),
          );
          const env: NodeJS.ProcessEnv = { SHELL: shell, PATH: `/inherited/bin:${extraToolPath}` };
          yield* runShellEnvironment({
            env,
            platform: "linux",
            handler: (command) => {
              if (command._tag !== "StandardCommand" || command.command !== shell) return "";
              const result = NodeChildProcess.spawnSync(
                command.command,
                ["--no-history", "--config", config, "--env-config", envConfig, ...command.args],
                {
                  encoding: "utf8",
                  timeout: 5000,
                  env: { HOME: home, XDG_CONFIG_HOME: home, PATH: toolPath },
                },
              );
              if (result.error) throw result.error;
              return { output: result.stdout, exitCode: result.status ?? 1 };
            },
          });

          assert.deepEqual(
            { PATH: env.PATH, __MISE_DIFF: env.__MISE_DIFF },
            {
              PATH: `${convertedToolPath}:${extraToolPath}:/inherited/bin`,
              __MISE_DIFF: "  FIRST\nSECOND  ",
            },
          );
          assert.equal(env.SSH_AUTH_SOCK, "/tmp/nu-agent.sock");
          assert.isUndefined(env.DISPLAY);
          assert.isUndefined(env.HOMEBREW_PREFIX);
        } finally {
          NodeFS.rmSync(home, { recursive: true, force: true });
        }
      }),
  );

  it.effect("rejects PATH output from a failed shell and tries the next candidate", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/failing", PATH: "/usr/bin" };
      const commands: string[] = [];

      yield* runShellEnvironment({
        env,
        platform: "linux",
        userShell: "/usr/local/bin/fish",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          commands.push(command.command);
          return command.command === "/bin/failing"
            ? { output: envOutput({ PATH: "/failed/bin" }), exitCode: 7 }
            : envOutput({ PATH: "/home/test/.local/bin:/usr/bin" });
        },
      }).pipe(Effect.provide(Logger.layer([])));

      assert.deepEqual(commands, ["/bin/failing", "/usr/local/bin/fish"]);
      assert.equal(env.PATH, "/home/test/.local/bin:/usr/bin");
    }),
  );

  it.effect.each(["darwin", "linux"] as const)(
    "uses the account shell when SHELL is missing on %s",
    (platform) =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
        const commands: string[] = [];

        yield* runShellEnvironment({
          env,
          platform,
          userShell: "/usr/local/bin/fish",
          handler: (command) => {
            if (command._tag !== "StandardCommand") return "";
            commands.push(command.command);
            return envOutput({ PATH: "/home/test/.local/bin:/usr/bin" });
          },
        });

        assert.deepEqual(commands, ["/usr/local/bin/fish"]);
        assert.equal(env.PATH, "/home/test/.local/bin:/usr/bin");
      }),
  );

  it.effect("tries the account shell before the platform fallback when SHELL has no PATH", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/missing", PATH: "/usr/bin" };
      const commands: string[] = [];

      yield* runShellEnvironment({
        env,
        platform: "linux",
        userShell: "/usr/local/bin/fish",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          commands.push(command.command);
          return command.command === "/usr/local/bin/fish"
            ? envOutput({ PATH: "/home/test/.local/bin:/usr/bin" })
            : "";
        },
      });

      assert.deepEqual(commands, ["/bin/missing", "/usr/local/bin/fish"]);
      assert.equal(env.PATH, "/home/test/.local/bin:/usr/bin");
    }),
  );

  it.effect("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on macOS", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/Users/test/.local/bin:/usr/bin",
      };
      const commands: ChildProcess.Command[] = [];

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: (command) => {
          commands.push(command);
          return envOutput({
            PATH: "/opt/homebrew/bin:/usr/bin",
            SSH_AUTH_SOCK: "/tmp/secretive.sock",
            HOMEBREW_PREFIX: "/opt/homebrew",
          });
        },
      });

      assert.equal(commands.length, 1);
      assert.equal(commands[0]?._tag === "StandardCommand" ? commands[0].command : "", "/bin/zsh");
      assert.equal(commands[0]?._tag === "StandardCommand" ? commands[0].args[0] : "", "-lc");
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin:/Users/test/.local/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/secretive.sock");
      assert.equal(env.HOMEBREW_PREFIX, "/opt/homebrew");
    }),
  );

  it.effect("preserves inherited POSIX values when present", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/inherited.sock",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () =>
          envOutput({
            PATH: "/opt/homebrew/bin:/usr/bin",
            SSH_AUTH_SOCK: "/tmp/login-shell.sock",
          }),
      });

      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/inherited.sock");
    }),
  );

  it.effect("hydrates the locale from the login shell on macOS", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () =>
          envOutput({
            PATH: "/opt/homebrew/bin:/usr/bin",
            LANG: "de_DE.UTF-8",
          }),
      });

      assert.equal(env.LANG, "de_DE.UTF-8");
    }),
  );

  it.effect("preserves an inherited locale over the login shell on macOS", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        LANG: "en_US.UTF-8",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () =>
          envOutput({
            PATH: "/opt/homebrew/bin:/usr/bin",
            LANG: "de_DE.UTF-8",
          }),
      });

      assert.equal(env.LANG, "en_US.UTF-8");
    }),
  );

  it.effect("does not mix login-shell locale categories into an inherited locale", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        LANG: "en_US.UTF-8",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () =>
          envOutput({
            PATH: "/opt/homebrew/bin:/usr/bin",
            LC_ALL: "de_DE.UTF-8",
          }),
      });

      assert.equal(env.LANG, "en_US.UTF-8");
      assert.equal(env.LC_ALL, undefined);
    }),
  );

  it.effect("falls back to a UTF-8 LC_CTYPE when no locale is available on macOS", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () => envOutput({ PATH: "/opt/homebrew/bin:/usr/bin" }),
      });

      assert.equal(env.LANG, undefined);
      assert.equal(env.LC_ALL, undefined);
      assert.equal(env.LC_CTYPE, "en_US.UTF-8");
    }),
  );

  it.effect("does not apply the locale fallback on linux", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () => envOutput({ PATH: "/home/linuxbrew/.linuxbrew/bin:/usr/bin" }),
      });

      assert.equal(env.LANG, undefined);
    }),
  );

  it.effect("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on linux", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
      };

      const commands: ChildProcess.Command[] = [];
      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: (command) => {
          commands.push(command);
          return envOutput({
            PATH: "/home/linuxbrew/.linuxbrew/bin:/usr/bin",
            SSH_AUTH_SOCK: "/tmp/secretive.sock",
            T3CODE_TELEMETRY_ENABLED: "false",
          });
        },
      });

      assert.equal(commands[0]?._tag === "StandardCommand" ? commands[0].args[0] : "", "-ilc");
      assert.equal(env.PATH, "/home/linuxbrew/.linuxbrew/bin:/usr/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/secretive.sock");
      assert.equal(env.T3CODE_TELEMETRY_ENABLED, "false");
    }),
  );

  it.effect("hydrates missing CA trust variables from the login shell", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        SSL_CERT_DIR: "/etc/ssl/certs",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () =>
          envOutput({
            PATH: "/opt/zerobrew/bin:/usr/bin",
            SSL_CERT_FILE: "/opt/zerobrew/etc/ca-certificates/cacert.pem",
            SSL_CERT_DIR: "/opt/zerobrew/etc/ca-certificates",
            NODE_EXTRA_CA_CERTS: "/Users/me/corp-root.pem",
          }),
      });

      assert.equal(env.SSL_CERT_FILE, "/opt/zerobrew/etc/ca-certificates/cacert.pem");
      assert.equal(env.SSL_CERT_DIR, "/etc/ssl/certs");
      assert.equal(env.NODE_EXTRA_CA_CERTS, "/Users/me/corp-root.pem");
    }),
  );

  it.effect("keeps mise's PATH record with the login shell PATH", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/bash",
        PATH: "/usr/bin",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () =>
          envOutput({
            PATH: "/home/me/.local/bin:/mise/installs/claude/latest:/mise/shims",
            __MISE_DIFF: "mise-diff",
          }),
      });

      assert.equal(env.__MISE_DIFF, "mise-diff");
    }),
  );

  it.effect("falls back to launchctl PATH on macOS when shell probing does not return one", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/opt/homebrew/bin/nu",
        PATH: "/usr/bin",
      };
      const commands: string[] = [];

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          commands.push(command.command);
          return command.command === "/bin/launchctl" ? "/opt/homebrew/bin:/usr/bin" : "";
        },
      });

      assert.deepEqual(commands, ["/opt/homebrew/bin/nu", "/bin/zsh", "/bin/launchctl"]);
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
    }),
  );

  it.effect("caps a hanging macOS login shell before falling back to launchctl PATH", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
    };
    const commands: string[] = [];
    const layerTestClock = TestClock.layer();

    return Effect.gen(function* () {
      const fiber = yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          commands.push(command.command);
          if (command.command === "/bin/launchctl") {
            return "/opt/homebrew/bin:/usr/bin";
          }
          assert.equal(
            Duration.toMillis(Duration.fromInputUnsafe(command.options.forceKillAfter ?? 0)),
            100,
          );
          return makeHangingProcess();
        },
      }).pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      assert.deepEqual(commands, ["/bin/zsh"]);

      yield* TestClock.adjust(Duration.millis(749));
      yield* Effect.yieldNow;
      assert.deepEqual(commands, ["/bin/zsh"]);

      yield* TestClock.adjust(Duration.millis(1));
      yield* Fiber.join(fiber);

      assert.deepEqual(commands, ["/bin/zsh", "/bin/launchctl"]);
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
    }).pipe(Effect.provide(layerTestClock));
  });

  it.effect("loads PowerShell profile environment on Windows", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        PATH: "C:\\Windows\\System32",
        APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
        USERPROFILE: "C:\\Users\\testuser",
      };

      const prepared = yield* runShellEnvironment({
        env,
        platform: "win32",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          const loadProfile = !command.args.includes("-NoProfile");
          return loadProfile
            ? envOutput({
                PATH: "C:\\Profile\\Node;C:\\Windows\\System32",
                FNM_DIR: "C:\\Users\\testuser\\AppData\\Roaming\\fnm",
                FNM_MULTISHELL_PATH: "C:\\Users\\testuser\\AppData\\Local\\fnm_multishells\\123",
              })
            : envOutput({ PATH: 'C:\\Custom\\Bin;C:";C:\\Windows\\System32' });
        },
      });

      assert.isTrue(prepared);
      assert.equal(
        env.PATH,
        [
          "C:\\Profile\\Node",
          "C:\\Windows\\System32",
          "C:\\Users\\testuser\\AppData\\Roaming\\npm",
          "C:\\Users\\testuser\\AppData\\Local\\Programs\\nodejs",
          "C:\\Users\\testuser\\AppData\\Local\\Volta\\bin",
          "C:\\Users\\testuser\\AppData\\Local\\pnpm",
          "C:\\Users\\testuser\\AppData\\Local\\cursor-agent",
          "C:\\Users\\testuser\\.local\\bin",
          "C:\\Users\\testuser\\.bun\\bin",
          "C:\\Users\\testuser\\scoop\\shims",
          "C:\\Custom\\Bin",
          "C:",
        ].join(";"),
      );
      assert.equal(env.FNM_DIR, "C:\\Users\\testuser\\AppData\\Roaming\\fnm");
      assert.equal(
        env.FNM_MULTISHELL_PATH,
        "C:\\Users\\testuser\\AppData\\Local\\fnm_multishells\\123",
      );
    }),
  );

  it.effect("waits at most 5 seconds in total when the PowerShell profile hangs", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };
      const profileShells: string[] = [];
      const started = yield* Deferred.make<void>();
      const completed = yield* Deferred.make<void>();
      const baseClock = yield* Clock.Clock;
      let wallTime = 0;
      const clockWithBackwardWallJump: Clock.Clock = {
        ...baseClock,
        currentTimeMillisUnsafe: () => wallTime,
        currentTimeMillis: Effect.sync(() => wallTime),
      };

      const install = yield* Effect.forkChild(
        runShellEnvironment({
          env,
          platform: "win32",
          handler: (command) => {
            if (command._tag !== "StandardCommand") return "";
            if (command.args.includes("-NoProfile")) {
              return envOutput({ PATH: "C:\\NoProfile\\Bin;C:\\Windows\\System32" });
            }
            profileShells.push(command.command);
            return Deferred.succeed(started, undefined).pipe(
              Effect.as(
                ChildProcessSpawner.makeHandle({
                  ...makeProcess(""),
                  stdout: Stream.never,
                  all: Stream.never,
                  exitCode: Effect.never,
                  isRunning: Effect.succeed(true),
                }),
              ),
            );
          },
        }).pipe(
          Effect.tap(() => Deferred.succeed(completed, undefined)),
          Effect.provide(Logger.layer([])),
          Effect.provideService(Clock.Clock, clockWithBackwardWallJump),
        ),
      );
      yield* Deferred.await(started);
      wallTime = -60_000;
      yield* TestClock.adjust("5 seconds");
      assert.isTrue(yield* Deferred.isDone(completed), "finishes within the shared budget");
      assert.isFalse(yield* Fiber.join(install));
      assert.deepEqual(profileShells, ["pwsh.exe"]);
      assert.equal(env.PATH, "C:\\NoProfile\\Bin;C:\\Windows\\System32");
    }),
  );

  it.effect("falls back to Windows PowerShell when pwsh.exe is not installed", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };
      const missing = PlatformError.systemError({
        _tag: "NotFound",
        module: "ChildProcess",
        method: "spawn",
        pathOrDescriptor: "pwsh.exe",
      });

      const prepared = yield* runShellEnvironment({
        env,
        platform: "win32",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          if (command.command === "pwsh.exe") return Effect.fail(missing);
          return command.args.includes("-NoProfile")
            ? envOutput({ PATH: "C:\\Windows\\System32" })
            : envOutput({ PATH: "C:\\Profile\\Node;C:\\Windows\\System32" });
        },
      }).pipe(Effect.provide(Logger.layer([])));

      assert.isTrue(prepared);
      assert.equal(env.PATH, "C:\\Profile\\Node;C:\\Windows\\System32");
    }),
  );

  it.effect.each([false, true])(
    "leaves Windows preparation incomplete when loadProfile=%s fails",
    (loadProfile) =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };
        let calls = 0;
        const prepared = yield* runShellEnvironment({
          env,
          platform: "win32",
          handler: (command) => {
            calls++;
            if (command._tag !== "StandardCommand") return "";
            return !command.args.includes("-NoProfile") === loadProfile
              ? { output: "", exitCode: 1 }
              : envOutput({ PATH: "C:\\Working" });
          },
        }).pipe(Effect.provide(Logger.layer([])));
        assert.isFalse(prepared);
        assert.equal(calls, 3);
        assert.include(env.PATH, "C:\\Working");
        assert.include(env.PATH, "C:\\Windows\\System32");
      }),
  );

  it.effect("replaces a Path-spelled Windows PATH instead of adding a second key", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { Path: "C:\\Windows\\System32" };

      yield* runShellEnvironment({
        env,
        platform: "win32",
        handler: (command) =>
          command._tag === "StandardCommand" && command.args.includes("-NoProfile")
            ? envOutput({ PATH: "C:\\Shell\\Bin" })
            : "",
      });

      assert.deepEqual(env, { PATH: "C:\\Shell\\Bin;C:\\Windows\\System32" });
    }),
  );

  it.effect("merges persistent User PATH when PowerShell only returns a stale process PATH", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        PATH: "C:\\Windows\\System32",
        APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
        USERPROFILE: "C:\\Users\\testuser",
      };

      yield* runShellEnvironment({
        env,
        platform: "win32",
        persistentPath: [
          "C:\\Users\\testuser\\AppData\\Local\\Microsoft\\WinGet\\Links",
          "C:\\Users\\testuser\\AppData\\Local\\cursor-agent",
        ].join(";"),
        handler: () => envOutput({ PATH: "C:\\Windows\\System32" }),
      });

      assert.ok(
        env.PATH?.includes("C:\\Users\\testuser\\AppData\\Local\\Microsoft\\WinGet\\Links"),
      );
      assert.ok(env.PATH?.includes("C:\\Users\\testuser\\AppData\\Local\\cursor-agent"));
    }),
  );

  it.effect("drops earlier AppImage launches' mount dirs from the search paths on linux", () =>
    Effect.gen(function* () {
      const current = "/var/tmp/.mount_cur";
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        APPIMAGE: "/home/me/T3-Code.AppImage",
        APPDIR: `${current}/`,
        PATH: `${current}/usr/bin:/tmp/.mount_old/usr/bin:/usr/bin`,
        LD_LIBRARY_PATH: `/tmp/.mount_old/usr/lib:${current}/usr/lib::/opt/lib`,
        XDG_DATA_DIRS: "/tmp/.mount_old/usr/share:/var/tmp/.mount_cur2/usr/share",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () => envOutput({ PATH: "/tmp/.mount_older/usr/bin:/home/me/.local/bin" }),
      });

      assert.equal(env.PATH, `/home/me/.local/bin:${current}/usr/bin:/usr/bin`);
      assert.equal(env.LD_LIBRARY_PATH, `${current}/usr/lib::/opt/lib`);
      assert.equal(env.XDG_DATA_DIRS, undefined);
    }),
  );

  it.effect("keeps AppImage-looking search paths outside an AppImage launch", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/tmp/.mount_old/usr/bin:/usr/bin",
        LD_LIBRARY_PATH: "/tmp/.mount_old/usr/lib",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () => envOutput({ PATH: "/usr/bin" }),
      });

      assert.equal(env.PATH, "/usr/bin:/tmp/.mount_old/usr/bin");
      assert.equal(env.LD_LIBRARY_PATH, "/tmp/.mount_old/usr/lib");
    }),
  );

  it.effect("prefers login-shell desktop session hints over inherited values on linux", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        XDG_CURRENT_DESKTOP: "wrong-launcher",
        XDG_SESSION_DESKTOP: "wrong-launcher",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () =>
          envOutput({
            PATH: "/home/linuxbrew/.linuxbrew/bin:/usr/bin",
            XDG_CURRENT_DESKTOP: "KDE",
            XDG_SESSION_DESKTOP: "KDE",
            XDG_SESSION_TYPE: "wayland",
          }),
      });

      assert.equal(env.XDG_CURRENT_DESKTOP, "KDE");
      assert.equal(env.XDG_SESSION_DESKTOP, "KDE");
      assert.equal(env.XDG_SESSION_TYPE, "wayland");
    }),
  );

  it.effect("overrides stale dbus session addresses from the login shell", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/stale-bus",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () =>
          envOutput({
            PATH: "/usr/bin",
            DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
          }),
      });

      assert.equal(env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
    }),
  );

  it.effect("leaves the probe untouched when no harvest is configured", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
      const commands: ChildProcess.Command[] = [];

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: (command) => {
          commands.push(command);
          return envOutput({ PATH: "/usr/bin" });
        },
      });

      const args = commandLine(commands[0] as ChildProcess.Command);
      assert.equal(args.includes("env -0"), false);
      assert.equal(args.includes("printenv OPENAI_API_KEY"), false);
    }),
  );

  it.effect("restores configured extra names from the login shell", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
      const commands: ChildProcess.Command[] = [];

      yield* runShellEnvironment({
        env,
        platform: "linux",
        harvest: { mode: "allowlist", names: ["OPENAI_API_KEY"] },
        handler: (command) => {
          commands.push(command);
          return envOutput({ PATH: "/usr/bin", OPENAI_API_KEY: "sk-test" });
        },
      });

      assert.equal(
        commandLine(commands[0] as ChildProcess.Command).includes("printenv OPENAI_API_KEY"),
        true,
      );
      assert.equal(env.OPENAI_API_KEY, "sk-test");
    }),
  );

  it.effect("lets the login shell win over an inherited value for configured names", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        OPENAI_API_KEY: "sk-stale",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        harvest: { mode: "allowlist", names: ["OPENAI_API_KEY"] },
        handler: () => envOutput({ PATH: "/usr/bin", OPENAI_API_KEY: "sk-fresh" }),
      });

      assert.equal(env.OPENAI_API_KEY, "sk-fresh");
    }),
  );

  it.effect("restores the whole login shell environment in all mode", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
      const commands: ChildProcess.Command[] = [];

      yield* runShellEnvironment({
        env,
        platform: "linux",
        harvest: { mode: "all", names: [] },
        handler: (command) => {
          commands.push(command);
          return [
            envOutput({ PATH: "/usr/bin" }),
            fullEnvOutput({
              PATH: "/usr/bin",
              OPENAI_API_KEY: "sk-test",
              CARGO_HOME: "/home/test/.local/share/cargo",
              GREETING: "line one\nline two",
              CONNECTION: "key=value=more",
            }),
          ].join("\n");
        },
      });

      assert.equal(commandLine(commands[0] as ChildProcess.Command).includes("env -0"), true);
      assert.equal(env.OPENAI_API_KEY, "sk-test");
      assert.equal(env.CARGO_HOME, "/home/test/.local/share/cargo");
      assert.equal(env.GREETING, "line one\nline two");
      assert.equal(env.CONNECTION, "key=value=more");
    }),
  );

  it.effect("does not import process identity names in all mode", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        HOME: "/home/desktop",
        PWD: "/",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        harvest: { mode: "all", names: [] },
        handler: () =>
          [
            envOutput({ PATH: "/usr/bin" }),
            fullEnvOutput({
              HOME: "/home/shell",
              PWD: "/home/shell/projects",
              OLDPWD: "/tmp",
              SHLVL: "3",
              _: "/usr/bin/env",
            }),
          ].join("\n"),
      });

      assert.equal(env.HOME, "/home/desktop");
      assert.equal(env.PWD, "/");
      assert.equal(env.OLDPWD, undefined);
      assert.equal(env.SHLVL, undefined);
      assert.equal(env._, undefined);
    }),
  );

  it.effect("keeps PATH merging and locale precedence in all mode", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        LANG: "en_US.UTF-8",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        harvest: { mode: "all", names: [] },
        handler: () =>
          [
            envOutput({ PATH: "/opt/homebrew/bin" }),
            fullEnvOutput({ PATH: "/only/from/dump", LANG: "de_DE.UTF-8" }),
          ].join("\n"),
      });

      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
      assert.equal(env.LANG, "en_US.UTF-8");
    }),
  );

  it.effect("restores configured extra names from the PowerShell profile on Windows", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };
      const commands: ChildProcess.Command[] = [];

      yield* runShellEnvironment({
        env,
        platform: "win32",
        harvest: { mode: "all", names: ["OPENAI_API_KEY"] },
        handler: (command) => {
          commands.push(command);
          if (command._tag !== "StandardCommand") return "";
          return command.args.includes("-NoProfile")
            ? envOutput({ PATH: "C:\\Windows\\System32" })
            : [
                envOutput({ PATH: "C:\\Windows\\System32", OPENAI_API_KEY: "sk-test" }),
                fullEnvOutput({ CARGO_HOME: "C:\\Users\\test\\.cargo" }),
              ].join("\n");
        },
      });

      const profileCommand = commands.find(
        (command) => command._tag === "StandardCommand" && !command.args.includes("-NoProfile"),
      );
      assert.equal(
        commandLine(profileCommand as ChildProcess.Command).includes("Get-ChildItem Env:"),
        true,
      );
      assert.equal(env.OPENAI_API_KEY, "sk-test");
      assert.equal(env.CARGO_HOME, "C:\\Users\\test\\.cargo");
    }),
  );

  it.effect("clears an inherited value when the login shell exports it empty", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        OPENAI_API_KEY: "sk-stale",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        harvest: { mode: "all", names: [] },
        handler: () =>
          [
            envOutput({ PATH: "/usr/bin" }),
            fullEnvOutput({ OPENAI_API_KEY: "", CARGO_HOME: "/home/test/.cargo" }),
          ].join("\n"),
      });

      assert.equal(env.OPENAI_API_KEY, "");
      assert.equal(env.CARGO_HOME, "/home/test/.cargo");
    }),
  );

  it.effect("keeps parsing the dump when a value contains the terminator marker", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        harvest: { mode: "all", names: [] },
        handler: () =>
          [
            envOutput({ PATH: "/usr/bin" }),
            fullEnvOutput({
              SNEAKY: "__T3CODE_ENV_*_END__",
              CARGO_HOME: "/home/test/.cargo",
              RUSTUP_HOME: "/home/test/.rustup",
            }),
          ].join("\n"),
      });

      assert.equal(env.SNEAKY, "__T3CODE_ENV_*_END__");
      assert.equal(env.CARGO_HOME, "/home/test/.cargo");
      assert.equal(env.RUSTUP_HOME, "/home/test/.rustup");
    }),
  );

  it.effect("preserves multiline values in the Windows dump", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };

      yield* runShellEnvironment({
        env,
        platform: "win32",
        harvest: { mode: "all", names: [] },
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          return command.args.includes("-NoProfile")
            ? envOutput({ PATH: "C:\\Windows\\System32" })
            : [
                envOutput({ PATH: "C:\\Windows\\System32" }),
                fullEnvOutput({
                  MULTI: "first\nINJECTED=value",
                  CARGO_HOME: "C:\\Users\\test\\.cargo",
                }),
              ].join("\n");
        },
      });

      assert.equal(env.MULTI, "first\nINJECTED=value");
      assert.equal(env.INJECTED, undefined);
      assert.equal(env.CARGO_HOME, "C:\\Users\\test\\.cargo");
    }),
  );

  it.effect("does not let a differently cased Windows PATH clobber the merged one", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };

      yield* runShellEnvironment({
        env,
        platform: "win32",
        harvest: { mode: "all", names: [] },
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          return command.args.includes("-NoProfile")
            ? envOutput({ PATH: "C:\\Windows\\System32" })
            : [
                envOutput({ PATH: "C:\\Profile\\Node;C:\\Windows\\System32" }),
                fullEnvOutput({ Path: "C:\\Injected", CARGO_HOME: "C:\\Users\\test\\.cargo" }),
              ].join("\n");
        },
      });

      assert.equal(env.Path, undefined);
      assert.equal(env.PATH?.startsWith("C:\\Profile\\Node"), true);
      assert.equal(env.PATH?.includes("C:\\Injected"), false);
      assert.equal(env.CARGO_HOME, "C:\\Users\\test\\.cargo");
    }),
  );

  it.effect("logs command failures with safe probe context and the exact cause", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/bash",
      PATH: "/usr/bin",
    };
    const cause = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "ChildProcess",
      method: "spawn",
      pathOrDescriptor: "/bin/bash",
    });
    const messages: Array<unknown> = [];
    const logger = Logger.make(({ message }) => {
      messages.push(message);
    });

    return runShellEnvironment({
      env,
      platform: "linux",
      handler: () => "",
      failure: cause,
    }).pipe(
      Effect.andThen(
        Effect.sync(() => {
          const errors = messages
            .flatMap((message) => (Array.isArray(message) ? message : [message]))
            .filter(isDesktopShellEnvironmentCommandError);
          assert.lengthOf(errors, 1);
          assert.equal(errors[0]?.probe, "login-shell");
          assert.equal(errors[0]?.executable, "bash");
          assert.equal(errors[0]?.argumentCount, 2);
          assert.notProperty(errors[0] ?? {}, "args");
          assert.equal(errors[0]?.cause, cause);
          assert.notInclude(errors[0]?.message ?? "", cause.message);
        }),
      ),
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    );
  });
});
