import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
import * as Layer from "effect/Layer";

import type {
  PluginMarketplaceHarnessId,
  PluginMarketplaceMcpAuthStatus,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import * as ProcessRunner from "../processRunner.ts";

export type McpOAuthHarness = Extract<PluginMarketplaceHarnessId, "codex" | "claude" | "cursor">;

export interface McpOAuthServerStatus {
  readonly name: string;
  readonly url: string | null;
  readonly status: PluginMarketplaceMcpAuthStatus;
  readonly detail: string | null;
  readonly canConnect: boolean;
  readonly canDisconnect: boolean;
}

export interface McpOAuthStart {
  readonly authorizationUrl: string;
  readonly callbackRequired: boolean;
}

export class McpOAuthRuntimeError extends Schema.TaggedErrorClass<McpOAuthRuntimeError>()(
  "McpOAuthRuntimeError",
  {
    operation: Schema.Literals(["status", "start", "complete", "disconnect"]),
    harness: Schema.Literals(["codex", "claude", "cursor"]),
    detail: Schema.String,
  },
) {}

export interface McpOAuthRuntime {
  readonly status: (
    harness: McpOAuthHarness,
  ) => Effect.Effect<ReadonlyArray<McpOAuthServerStatus>, McpOAuthRuntimeError>;
  readonly start: (
    harness: McpOAuthHarness,
    name: string,
  ) => Effect.Effect<McpOAuthStart, McpOAuthRuntimeError>;
  readonly complete: (
    harness: McpOAuthHarness,
    name: string,
    callbackUrl: string,
  ) => Effect.Effect<void, McpOAuthRuntimeError>;
  readonly disconnect: (
    harness: McpOAuthHarness,
    name: string,
  ) => Effect.Effect<void, McpOAuthRuntimeError>;
}

const CodexMcpServer = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
  disabled_reason: Schema.NullOr(Schema.String),
  transport: Schema.Struct({
    type: Schema.String,
    url: Schema.optional(Schema.String),
  }),
  auth_status: Schema.String,
});
const decodeCodexMcpServers = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(CodexMcpServer)),
);

function cleanedCliLine(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\u001B\]8;;[^\u0007]*\u0007/gu, "")
    .trim();
}

function findHttpUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s\u0007\u001B]+/u)?.[0];
  return match?.replace(/[),.;]+$/u, "") ?? null;
}

export function parseCodexMcpStatusOutput(output: string): ReadonlyArray<McpOAuthServerStatus> {
  const decoded = decodeCodexMcpServers(output);
  if (Option.isNone(decoded)) return [];
  return decoded.value.map((server) => {
    const authStatus = server.auth_status.toLocaleLowerCase().replaceAll("_", "");
    const connected = authStatus === "oauth" || authStatus === "bearertoken";
    const needsLogin = authStatus === "notloggedin";
    return {
      name: server.name,
      url: server.transport.url ?? null,
      status: !server.enabled
        ? "unavailable"
        : connected
          ? "connected"
          : needsLogin
            ? "not_connected"
            : "unsupported",
      detail: !server.enabled
        ? (server.disabled_reason ?? "Disabled in Codex")
        : authStatus === "oauth"
          ? "Connected with OAuth in Codex"
          : authStatus === "bearertoken"
            ? "Using a bearer token configured in Codex"
            : needsLogin
              ? "Sign in with Codex to use this MCP server"
              : "This Codex MCP server does not use OAuth",
      canConnect: server.enabled && needsLogin && server.transport.url !== undefined,
      canDisconnect: server.enabled && authStatus === "oauth",
    } satisfies McpOAuthServerStatus;
  });
}

export function parseClaudeMcpStatusOutput(output: string): ReadonlyArray<McpOAuthServerStatus> {
  return output
    .split(/\r?\n/gu)
    .map(cleanedCliLine)
    .filter((line) => line.includes(":"))
    .flatMap((line): ReadonlyArray<McpOAuthServerStatus> => {
      const separator = line.indexOf(": ");
      if (separator < 1) return [];
      const name = line.slice(0, separator).trim();
      const description = line.slice(separator + 2).trim();
      if (!name || !description) return [];
      const normalized = description.toLocaleLowerCase();
      const needsLogin =
        normalized.includes("needs authentication") ||
        normalized.includes("requires authentication") ||
        normalized.includes("requires_authentication");
      const failed = normalized.includes("failed to connect");
      const pendingApproval = normalized.includes("pending approval");
      const connected = normalized.includes("connected") && !failed;
      return [
        {
          name,
          url: findHttpUrl(description),
          status: needsLogin
            ? "not_connected"
            : connected
              ? "connected"
              : failed
                ? "failed"
                : pendingApproval
                  ? "unavailable"
                  : "unsupported",
          detail: needsLogin
            ? "Sign in with Claude Code to use this MCP server"
            : connected
              ? "Connected in Claude Code"
              : failed || pendingApproval
                ? (description.split(" — ").at(-1) ?? description)
                : "This Claude Code MCP server does not use OAuth",
          canConnect: needsLogin,
          canDisconnect: connected,
        },
      ];
    });
}

export function parseCursorMcpStatusOutput(output: string): ReadonlyArray<McpOAuthServerStatus> {
  return output
    .split(/\r?\n/gu)
    .map(cleanedCliLine)
    .filter((line) => line.includes(":"))
    .flatMap((line): ReadonlyArray<McpOAuthServerStatus> => {
      const separator = line.indexOf(":");
      const name = line.slice(0, separator).trim();
      const nativeStatus = line
        .slice(separator + 1)
        .trim()
        .toLocaleLowerCase();
      if (!name || !nativeStatus) return [];
      const connected = nativeStatus === "ready";
      const needsLogin = nativeStatus.includes("authentication");
      return [
        {
          name,
          url: null,
          status: connected ? "connected" : needsLogin ? "not_connected" : "unavailable",
          detail: connected
            ? "Connected in Cursor"
            : needsLogin
              ? "Authentication is managed in Cursor"
              : `Cursor reports ${nativeStatus}`,
          canConnect: false,
          canDisconnect: false,
        },
      ];
    });
}

export function validateMcpOAuthCallback(authorizationUrl: string, callbackUrl: string): boolean {
  try {
    const authorization = new URL(authorizationUrl);
    const callback = new URL(callbackUrl);
    const redirectValue = authorization.searchParams.get("redirect_uri");
    if (!redirectValue) return false;
    const redirect = new URL(redirectValue);
    if (redirect.origin !== callback.origin || redirect.pathname !== callback.pathname)
      return false;
    const expectedState = authorization.searchParams.get("state");
    if (expectedState && callback.searchParams.get("state") !== expectedState) return false;
    return callback.searchParams.has("code") || callback.searchParams.has("error");
  } catch {
    return false;
  }
}

interface ActiveSession {
  readonly harness: McpOAuthHarness;
  readonly name: string;
  readonly started: Deferred.Deferred<McpOAuthStart, McpOAuthRuntimeError>;
  readonly cancelled: Deferred.Deferred<void>;
  readonly submitCallback: Ref.Ref<
    ((callbackUrl: string) => Effect.Effect<void, McpOAuthRuntimeError>) | null
  >;
}

function sessionKey(harness: McpOAuthHarness, name: string): string {
  return `${harness}:${name.toLocaleLowerCase()}`;
}

function commandError(
  operation: McpOAuthRuntimeError["operation"],
  harness: McpOAuthHarness,
  detail: string,
) {
  return new McpOAuthRuntimeError({ operation, harness, detail });
}

export const makeMcpOAuthRuntime = Effect.gen(function* () {
  const runtimeScope = yield* Scope.Scope;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const activeSessions = yield* Ref.make(new Map<string, ActiveSession>());
  const failures = yield* Ref.make(new Map<string, string>());
  const sessionLock = yield* Effect.makeSemaphore(1);

  const clearFailure = (key: string) =>
    Ref.update(failures, (current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });

  const recordFailure = (key: string, detail: string) =>
    Ref.update(failures, (current) => {
      const next = new Map(current);
      next.set(key, detail);
      return next;
    });

  const removeSession = (key: string, session: ActiveSession) =>
    Ref.update(activeSessions, (current) => {
      if (current.get(key) !== session) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });

  const runCodexSession = (key: string, session: ActiveSession) =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawnCommand = yield* resolveSpawnCommand("codex", ["app-server"], {
          env: process.env,
          extendEnv: true,
        });
        const child = yield* spawner.spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            cwd: process.cwd(),
            env: process.env,
            extendEnv: true,
            shell: spawnCommand.shell,
            forceKillAfter: "2 seconds",
          }),
        );
        const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
        const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
          Effect.provide(clientContext),
        );
        const completed = yield* Deferred.make<
          { readonly success: boolean; readonly error?: string | null },
          never
        >();
        yield* client.handleServerNotification("mcpServer/oauthLogin/completed", (payload) =>
          payload.name === session.name
            ? Deferred.succeed(completed, payload).pipe(Effect.asVoid)
            : Effect.void,
        );
        yield* client.request("initialize", {
          clientInfo: {
            name: "t3code_mcp_oauth",
            title: "T3 Code MCP Authentication",
            version: "0.1.0",
          },
          capabilities: { experimentalApi: true },
        });
        yield* client.notify("initialized", undefined);
        const response = yield* client.request("mcpServer/oauth/login", {
          name: session.name,
          timeoutSecs: 600,
        });
        yield* Deferred.succeed(session.started, {
          authorizationUrl: response.authorizationUrl,
          callbackRequired: false,
        });
        const result = yield* Effect.raceFirst(
          Deferred.await(completed),
          Deferred.await(session.cancelled).pipe(
            Effect.flatMap(() =>
              Effect.fail(commandError("start", "codex", "Authentication was cancelled.")),
            ),
          ),
        );
        if (!result.success) {
          return yield* commandError(
            "start",
            "codex",
            result.error?.trim() || "Codex did not complete MCP authentication.",
          );
        }
      }),
    ).pipe(
      Effect.tap(() => clearFailure(key)),
      Effect.tapError((error) =>
        Effect.all([
          Deferred.fail(session.started, error).pipe(Effect.ignore),
          recordFailure(key, error.detail),
        ]).pipe(Effect.asVoid),
      ),
      Effect.ensuring(removeSession(key, session)),
      Effect.ignoreCause({ log: true }),
    );

  const runClaudeSession = (key: string, session: ActiveSession) =>
    Effect.scoped(
      Effect.gen(function* () {
        const args = ["mcp", "login", "--no-browser", session.name];
        const spawnCommand = yield* resolveSpawnCommand("claude", args, {
          env: process.env,
          extendEnv: true,
        });
        const child = yield* spawner.spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            cwd: process.cwd(),
            env: process.env,
            extendEnv: true,
            shell: spawnCommand.shell,
            forceKillAfter: "2 seconds",
          }),
        );
        const authorizationUrl = yield* Ref.make<string | null>(null);
        yield* Ref.set(session.submitCallback, (callbackUrl) =>
          Effect.gen(function* () {
            const expected = yield* Ref.get(authorizationUrl);
            if (!expected || !validateMcpOAuthCallback(expected, callbackUrl)) {
              return yield* commandError(
                "complete",
                "claude",
                "The callback URL does not match this authentication request.",
              );
            }
            yield* Stream.run(Stream.encodeText(Stream.make(`${callbackUrl}\n`)), child.stdin).pipe(
              Effect.mapError(() =>
                commandError("complete", "claude", "Claude Code could not accept the callback."),
              ),
            );
          }),
        );

        const scanOutput = (stream: Stream.Stream<Uint8Array, unknown>) => {
          const decoder = new TextDecoder();
          let buffered = "";
          return Stream.runForEach(stream, (chunk) =>
            Effect.gen(function* () {
              buffered = `${buffered}${decoder.decode(chunk, { stream: true })}`.slice(-64 * 1024);
              const url = findHttpUrl(buffered);
              if (!url || (yield* Ref.get(authorizationUrl)) !== null) return;
              yield* Ref.set(authorizationUrl, url);
              yield* Deferred.succeed(session.started, {
                authorizationUrl: url,
                callbackRequired: true,
              });
            }),
          );
        };
        yield* scanOutput(child.stdout).pipe(Effect.ignore, Effect.forkScoped);
        yield* scanOutput(child.stderr).pipe(Effect.ignore, Effect.forkScoped);
        const exitCode = yield* Effect.raceFirst(
          child.exitCode,
          Deferred.await(session.cancelled).pipe(
            Effect.flatMap(() =>
              Effect.fail(commandError("start", "claude", "Authentication was cancelled.")),
            ),
          ),
        );
        if (exitCode !== 0) {
          return yield* commandError(
            "start",
            "claude",
            "Claude Code did not complete MCP authentication.",
          );
        }
        yield* clearFailure(key);
      }),
    ).pipe(
      Effect.tapError((error) =>
        Effect.all([
          Deferred.fail(session.started, error).pipe(Effect.ignore),
          recordFailure(key, error.detail),
        ]).pipe(Effect.asVoid),
      ),
      Effect.ensuring(removeSession(key, session)),
      Effect.ignoreCause({ log: true }),
    );

  const status: McpOAuthRuntime["status"] = (harness) =>
    Effect.gen(function* () {
      const invocation =
        harness === "codex"
          ? { command: "codex", args: ["mcp", "list", "--json"] }
          : harness === "claude"
            ? { command: "claude", args: ["mcp", "list"] }
            : { command: "cursor-agent", args: ["mcp", "list"] };
      const result = yield* processRunner
        .run({
          ...invocation,
          timeout: "30 seconds",
          maxOutputBytes: 2 * 1024 * 1024,
          outputMode: "truncate",
        })
        .pipe(
          Effect.mapError(() =>
            commandError("status", harness, `${harness} could not report MCP connections.`),
          ),
        );
      if (result.code !== 0) {
        return yield* commandError(
          "status",
          harness,
          `${harness} could not report MCP connections.`,
        );
      }
      const parsed =
        harness === "codex"
          ? parseCodexMcpStatusOutput(result.stdout)
          : harness === "claude"
            ? parseClaudeMcpStatusOutput(`${result.stdout}\n${result.stderr}`)
            : parseCursorMcpStatusOutput(`${result.stdout}\n${result.stderr}`);
      const [active, recordedFailures] = yield* Effect.all([
        Ref.get(activeSessions),
        Ref.get(failures),
      ]);
      return parsed.map((server) => {
        const key = sessionKey(harness, server.name);
        const session = active.get(key);
        const failure = recordedFailures.get(key);
        if (session) {
          return {
            ...server,
            status: "connecting",
            detail:
              harness === "claude"
                ? "Finish signing in, then paste the browser callback URL here"
                : "Waiting for browser authentication to finish",
            canConnect: false,
            canDisconnect: true,
          } satisfies McpOAuthServerStatus;
        }
        if (failure && server.status !== "connected") {
          return {
            ...server,
            status: "failed",
            detail: failure,
            canConnect: true,
            canDisconnect: false,
          } satisfies McpOAuthServerStatus;
        }
        return server;
      });
    });

  const start: McpOAuthRuntime["start"] = (harness, name) =>
    sessionLock.withPermits(1)(
      Effect.gen(function* () {
        if (harness === "cursor") {
          return yield* commandError(
            "start",
            harness,
            "Cursor manages MCP authentication in its own Marketplace UI.",
          );
        }
        const key = sessionKey(harness, name);
        const existing = (yield* Ref.get(activeSessions)).get(key);
        if (existing) return yield* Deferred.await(existing.started);
        const session: ActiveSession = {
          harness,
          name,
          started: yield* Deferred.make<McpOAuthStart, McpOAuthRuntimeError>(),
          cancelled: yield* Deferred.make<void>(),
          submitCallback: yield* Ref.make(null),
        };
        yield* Ref.update(activeSessions, (current) => new Map(current).set(key, session));
        yield* clearFailure(key);
        yield* (
          harness === "codex" ? runCodexSession(key, session) : runClaudeSession(key, session)
        ).pipe(Effect.forkIn(runtimeScope));
        const started = yield* Deferred.await(session.started).pipe(Effect.timeout("20 seconds"));
        if (Option.isNone(started)) {
          yield* Deferred.succeed(session.cancelled, undefined);
          return yield* commandError(
            "start",
            harness,
            `${harness} did not produce an authorization URL.`,
          );
        }
        return started.value;
      }),
    );

  const complete: McpOAuthRuntime["complete"] = (harness, name, callbackUrl) =>
    Effect.gen(function* () {
      if (harness !== "claude") {
        return yield* commandError(
          "complete",
          harness,
          "This harness completes authentication directly in the browser.",
        );
      }
      const session = (yield* Ref.get(activeSessions)).get(sessionKey(harness, name));
      const submit = session ? yield* Ref.get(session.submitCallback) : null;
      if (!submit) {
        return yield* commandError(
          "complete",
          harness,
          "There is no pending Claude Code authentication request.",
        );
      }
      yield* submit(callbackUrl);
    });

  const disconnect: McpOAuthRuntime["disconnect"] = (harness, name) =>
    Effect.gen(function* () {
      if (harness === "cursor") {
        return yield* commandError(
          "disconnect",
          harness,
          "Cursor manages MCP authentication in its own settings.",
        );
      }
      const key = sessionKey(harness, name);
      const session = (yield* Ref.get(activeSessions)).get(key);
      if (session) yield* Deferred.succeed(session.cancelled, undefined).pipe(Effect.ignore);
      const result = yield* processRunner
        .run({
          command: harness === "codex" ? "codex" : "claude",
          args: ["mcp", "logout", name],
          timeout: "30 seconds",
          maxOutputBytes: 512 * 1024,
          outputMode: "truncate",
        })
        .pipe(
          Effect.mapError(() =>
            commandError("disconnect", harness, `${harness} could not disconnect the MCP server.`),
          ),
        );
      if (result.code !== 0) {
        return yield* commandError(
          "disconnect",
          harness,
          `${harness} could not disconnect the MCP server.`,
        );
      }
      yield* clearFailure(key);
    });

  return { status, start, complete, disconnect } satisfies McpOAuthRuntime;
});
