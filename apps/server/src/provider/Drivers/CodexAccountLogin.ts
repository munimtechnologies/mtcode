/**
 * In-app Codex sign-in.
 *
 * Runs the same `account/login/*` app-server routes the Codex desktop app
 * uses: `account/login/start` returns a browser URL (or device code) and the
 * app-server child owns the OAuth callback server, writing `auth.json` into
 * this instance's effective `CODEX_HOME` on completion. The child process
 * lives for the duration of the flow's scope, so cancelling the stream
 * aborts the login cleanly.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexSchema from "effect-codex-app-server/schema";

import {
  ProviderAccountLoginError,
  type CodexSettings,
  type ProviderAccountLoginEvent,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { expandHomePath } from "../../pathExpansion.ts";
import { codexAppServerArgs, resolveCodexLaunchArgs } from "../Layers/codexLaunchArgs.ts";
import { buildCodexInitializeParams } from "../Layers/CodexProvider.ts";
import type { ProviderAccountLoginFlow, ProviderAccountLoginSupport } from "../ProviderDriver.ts";

const LOGIN_FORCE_KILL_AFTER = "2 seconds" as const;

const isLoginCompleted = Schema.is(
  CodexSchema.ServerNotification__AccountLoginCompletedNotification,
);

interface CodexAccountLoginInput {
  readonly instanceId: ProviderInstanceId;
  /** Effective config: `homePath` already points at the account's home. */
  readonly config: CodexSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}

/**
 * Spawn a scoped app-server child for this instance and hand back its
 * client. Mirrors the provider probe's spawn so login sees exactly the
 * environment (and `CODEX_HOME`) the instance's sessions run with.
 */
const acquireLoginClient = Effect.fn("acquireLoginClient")(function* (
  input: CodexAccountLoginInput,
) {
  const spawner = input.spawner;
  const resolvedHomePath =
    input.config.homePath.trim().length > 0 ? expandHomePath(input.config.homePath) : undefined;
  const environment = {
    ...input.environment,
    ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
  };
  const launchArgs = resolveCodexLaunchArgs(input.config.launchArgs, environment);
  const spawnCommand = yield* resolveSpawnCommand(
    input.config.binaryPath,
    codexAppServerArgs(launchArgs),
    { env: environment, extendEnv: true },
  );
  const child = yield* spawner.spawn(
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      cwd: process.cwd(),
      env: environment,
      extendEnv: true,
      forceKillAfter: LOGIN_FORCE_KILL_AFTER,
      shell: spawnCommand.shell,
    }),
  );
  const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
  const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
    Effect.provide(clientContext),
  );
  yield* client.request("initialize", buildCodexInitializeParams());
  yield* client.notify("initialized", undefined);
  return client;
});

const loginFailure = (instanceId: ProviderInstanceId, message: string) =>
  new ProviderAccountLoginError({ instanceId, message });

/** Resolve once the app-server reports the login finished, pass or fail. */
const awaitLoginCompleted = (
  client: CodexClient.CodexAppServerClient["Service"],
  instanceId: ProviderInstanceId,
) =>
  client.raw.notifications.pipe(
    Stream.filterMap((notification) => {
      const params = notification.params;
      return notification.method === "account/login/completed" && isLoginCompleted(params)
        ? Result.succeed(params)
        : Result.failVoid;
    }),
    Stream.take(1),
    Stream.runHead,
    Effect.flatMap((completed) => {
      if (Option.isNone(completed)) {
        return Effect.fail(
          loginFailure(instanceId, "Codex closed the login flow before it completed."),
        );
      }
      if (!completed.value.success) {
        return Effect.fail(
          loginFailure(instanceId, completed.value.error ?? "Codex sign-in failed."),
        );
      }
      return Effect.succeed({ type: "complete" } as const satisfies ProviderAccountLoginEvent);
    }),
  );

export function makeCodexAccountLogin(input: CodexAccountLoginInput): ProviderAccountLoginSupport {
  const start: ProviderAccountLoginSupport["start"] = Effect.fn("codexAccountLogin.start")(
    function* ({
      mode,
      apiKey,
    }): Effect.fn.Return<ProviderAccountLoginFlow, ProviderAccountLoginError, Scope.Scope> {
      const client = yield* acquireLoginClient(input).pipe(
        Effect.mapError((cause) =>
          loginFailure(input.instanceId, `Could not start Codex for sign-in: ${cause.message}`),
        ),
      );

      if (mode === "apiKey") {
        if (!apiKey || apiKey.trim().length === 0) {
          return yield* loginFailure(input.instanceId, "An API key is required for this sign-in.");
        }
        yield* client
          .request("account/login/start", { type: "apiKey", apiKey: apiKey.trim() })
          .pipe(
            Effect.mapError((cause) =>
              loginFailure(input.instanceId, `Codex rejected the API key: ${cause.message}`),
            ),
          );
        return {
          events: Stream.make({ type: "complete" } as const satisfies ProviderAccountLoginEvent),
        };
      }

      const response = yield* client
        .request(
          "account/login/start",
          mode === "deviceCode" ? { type: "chatgptDeviceCode" } : { type: "chatgpt" },
        )
        .pipe(
          Effect.mapError((cause) =>
            loginFailure(input.instanceId, `Codex could not start sign-in: ${cause.message}`),
          ),
        );

      const firstEvent: ProviderAccountLoginEvent =
        response.type === "chatgptDeviceCode"
          ? { type: "deviceCode", url: response.verificationUrl, userCode: response.userCode }
          : response.type === "chatgpt"
            ? { type: "authUrl", url: response.authUrl }
            : { type: "complete" };

      const events =
        firstEvent.type === "complete"
          ? Stream.make(firstEvent)
          : Stream.concat(
              Stream.make(firstEvent),
              Stream.fromEffect(awaitLoginCompleted(client, input.instanceId)),
            );
      return { events };
    },
  );

  const logout = Effect.gen(function* () {
    const client = yield* acquireLoginClient(input).pipe(
      Effect.mapError((cause) =>
        loginFailure(input.instanceId, `Could not start Codex for sign-out: ${cause.message}`),
      ),
    );
    yield* client
      .request("account/logout", undefined)
      .pipe(
        Effect.mapError((cause) =>
          loginFailure(input.instanceId, `Codex sign-out failed: ${cause.message}`),
        ),
      );
  }).pipe(Effect.scoped);

  return {
    modes: ["oauth", "deviceCode", "apiKey"],
    supportsLogout: true,
    start,
    logout,
  };
}
