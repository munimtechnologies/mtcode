/**
 * MT Code: the fork's Monitor toolkit (`monitor_start` / `monitor_unsubscribe`)
 * for Codex sessions under orchestration-v2.
 *
 * `monitor_start` runs a command through the session's app-server
 * `command/exec` and returns at once. Each complete output line, the exit, or a
 * launch failure becomes a wake: the thread is woken through
 * ProviderContinuationRequests (the mechanism upstream uses for post-settle
 * background command completions), so the orchestrator queues a new run behind
 * any active work. Wakes are delivered one at a time per thread; output that
 * arrives while a wake is still waiting for its turn is merged into the next one.
 * Stop terminates the thread's monitors and suppresses wakes until the user's
 * next message.
 */
import { randomUUID } from "node:crypto";

import type { ProviderDriverKind, ProviderThreadId, ThreadId } from "@t3tools/contracts";
import type * as CodexSchema from "effect-codex-app-server/schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as MonitorSession from "../../mcp/MonitorSession.ts";
import {
  CodexBackgroundTasks,
  supportsCodexMonitoring,
} from "../../provider/CodexBackgroundTasks.ts";
import { backgroundWorkNotification } from "../Notification.ts";
import type { ProviderAdapterV2TurnMessage } from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderContinuationRequest } from "@t3tools/provider-core/server/continuationRequests";

const isMonitorStoppedError = Schema.is(MonitorSession.MonitorStoppedError);

/** The two app-server calls a monitor needs, kept narrow so tests can fake them. */
export interface CodexMonitorClient {
  readonly exec: (
    params: CodexSchema.V2CommandExecParams,
  ) => Effect.Effect<{ readonly exitCode: number }, Error>;
  readonly terminate: (processId: string) => Effect.Effect<unknown, Error>;
}

/** Where a thread's monitors run and which provider thread their wakes target. */
export interface CodexMonitorRoute {
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId;
  readonly cwd: string | null;
  readonly sandboxPolicy: CodexSchema.V2CommandExecParams["sandboxPolicy"];
}

type MonitorWake = NonNullable<ReturnType<CodexBackgroundTasks["takeWake"]>>;

interface WakeOffer {
  readonly wake: MonitorWake;
  readonly detail: string;
  /** Handed to the orchestrator as a queued message; cleared when its turn starts. */
  dispatched: boolean;
}

interface ThreadMonitorState {
  route: CodexMonitorRoute;
  readonly tasks: CodexBackgroundTasks;
  offer: WakeOffer | undefined;
  /** Set by Stop or a rejected wake; the next user message clears it. */
  suppressed: boolean;
}

interface MonitorCommand {
  readonly threadId: ThreadId;
  readonly stdout: InstanceType<typeof TextDecoder>;
  readonly stderr: InstanceType<typeof TextDecoder>;
  stopped: boolean;
}

export function codexMonitorWakeText(input: {
  readonly monitorId: string;
  readonly description: string | undefined;
  readonly output: string;
}): string {
  const named =
    input.description === undefined
      ? `Background monitor ${input.monitorId}`
      : `Background monitor ${input.monitorId} (${input.description})`;
  return (
    `${named} reported:\n\n${input.output}\n\n` +
    `This turn was started by monitor_start. To stop these wakes, call monitor_unsubscribe with processId ${input.monitorId}.`
  );
}

export interface CodexMonitorRuntime {
  /** Wire to the client's `command/exec/outputDelta` notification. */
  readonly onOutputDelta: (
    payload: CodexSchema.V2CommandExecOutputDeltaNotification,
  ) => Effect.Effect<void>;
  /** Call before each root turn or steer reaches the provider. */
  readonly noteTurn: (input: {
    readonly route: CodexMonitorRoute;
    readonly message: ProviderAdapterV2TurnMessage;
    readonly mcpCredentialId: string | undefined;
  }) => Effect.Effect<void>;
  readonly noteSteer: (input: {
    readonly threadId: ThreadId;
    readonly message: ProviderAdapterV2TurnMessage;
  }) => Effect.Effect<void>;
  /** Stop: cancel pending wakes and terminate the thread's monitors. */
  readonly stopThread: (providerThreadId: ProviderThreadId) => Effect.Effect<void>;
  readonly hasRunningMonitors: Effect.Effect<boolean>;
  readonly start: (
    threadId: ThreadId,
    command: ReadonlyArray<string>,
  ) => Effect.Effect<
    { monitorId: string; status: "scheduled" },
    typeof MonitorSession.MonitorError.Type
  >;
  readonly unsubscribe: (threadId: ThreadId, processId: string) => Effect.Effect<void>;
}

/**
 * Builds the session's monitor runtime. The returned runtime lives for the
 * provider session scope; monitor registrations are released with it.
 */
export const makeCodexMonitorRuntime = (input: {
  readonly driver: ProviderDriverKind;
  readonly client: CodexMonitorClient;
  readonly userAgent: Effect.Effect<string | undefined>;
  readonly monitorSessions: MonitorSession.MonitorSessions["Service"] | undefined;
  readonly continuationRequests:
    | { readonly offer: (request: ProviderContinuationRequest) => Effect.Effect<void> }
    | undefined;
}): Effect.Effect<CodexMonitorRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const sessionScope = yield* Scope.Scope;
    const threads = new Map<ThreadId, ThreadMonitorState>();
    const commands = new Map<string, MonitorCommand>();
    const descriptions = new Map<string, string>();
    const registeredCredentials = new Set<string>();
    let closed = false;

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        for (const state of threads.values()) {
          state.offer = undefined;
          state.tasks.stop();
        }
        commands.clear();
      }),
    );

    const available = Effect.map(
      input.userAgent,
      (userAgent) =>
        input.monitorSessions !== undefined &&
        input.continuationRequests !== undefined &&
        userAgent !== undefined &&
        supportsCodexMonitoring(userAgent),
    );

    const pump = (threadId: ThreadId): Effect.Effect<void> =>
      Effect.suspend(() => {
        const state = threads.get(threadId);
        const continuationRequests = input.continuationRequests;
        if (
          closed ||
          continuationRequests === undefined ||
          state === undefined ||
          state.suppressed ||
          state.offer !== undefined
        ) {
          return Effect.void;
        }
        const wake = state.tasks.takeWake();
        if (wake === undefined) return Effect.void;
        const description = descriptions.get(wake.taskId);
        const offer: WakeOffer = {
          wake,
          detail: codexMonitorWakeText({
            monitorId: wake.taskId,
            description,
            output: wake.output,
          }),
          dispatched: false,
        };
        state.offer = offer;
        const notification = backgroundWorkNotification([
          { kind: "monitor", label: description, outcome: "updated" },
        ]);
        return continuationRequests.offer({
          threadId: state.route.threadId,
          providerThreadId: state.route.providerThreadId,
          driver: input.driver,
          detail: offer.detail,
          notification,
          // No provider-side buffer: the text is the whole wake.
          delivery: "message_text",
          dispatchIfCurrent: (dispatch) =>
            Effect.suspend(() => {
              if (closed || state.offer !== offer) {
                return Effect.succeedNone;
              }
              return dispatch.pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    offer.dispatched = true;
                  }),
                ),
                Effect.tapCause((cause) =>
                  Effect.gen(function* () {
                    if (state.offer !== offer) return;
                    // A rejected wake must not retry indefinitely; keep the
                    // event so the next user message can resume monitoring.
                    state.tasks.restoreWake(wake);
                    state.offer = undefined;
                    state.suppressed = true;
                    yield* Effect.logWarning("Codex monitor wake failed", { cause });
                  }),
                ),
                Effect.asSome,
              );
            }),
          clearIfCurrent: () =>
            Effect.sync(() => {
              if (state.offer === offer) state.offer = undefined;
            }),
        });
      });

    const start = (
      threadId: ThreadId,
      command: ReadonlyArray<string>,
    ): Effect.Effect<
      { monitorId: string; status: "scheduled" },
      typeof MonitorSession.MonitorError.Type
    > =>
      Effect.gen(function* () {
        const state = threads.get(threadId);
        if (closed || state === undefined || state.suppressed || !(yield* available)) {
          return yield* new MonitorSession.MonitorStoppedError({});
        }
        const monitorId = randomUUID();
        const description = command.join(" ");
        descriptions.set(monitorId, description);
        state.tasks.register(monitorId, monitorId, description);
        const monitor: MonitorCommand = {
          threadId,
          stdout: new TextDecoder(),
          stderr: new TextDecoder(),
          stopped: false,
        };
        commands.set(monitorId, monitor);
        const { route } = state;
        // The native RPC replies at exit, not startup. Capture is registered
        // first and the tool reports scheduled rather than running.
        yield* input.client
          .exec({
            command,
            processId: monitorId,
            ...(route.cwd === null ? {} : { cwd: route.cwd }),
            ...(route.sandboxPolicy === undefined ? {} : { sandboxPolicy: route.sandboxPolicy }),
            streamStdoutStderr: true,
            disableTimeout: true,
            disableOutputCap: true,
          })
          .pipe(
            Effect.matchEffect({
              onFailure: (cause) =>
                Effect.logWarning("Codex monitor command failed", { cause }).pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      state.tasks.output(monitorId, "Watcher failed to start or execute.\n");
                      return 1;
                    }),
                  ),
                ),
              onSuccess: ({ exitCode }) => Effect.succeed(exitCode),
            }),
            Effect.flatMap((exitCode) =>
              Effect.suspend(() => {
                state.tasks.output(monitorId, monitor.stdout.decode(), "stdout");
                state.tasks.output(monitorId, monitor.stderr.decode(), "stderr");
                state.tasks.completed({
                  id: monitorId,
                  command: description,
                  exitCode: monitor.stopped ? -1 : exitCode,
                });
                return pump(threadId);
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                commands.delete(monitorId);
              }),
            ),
            Effect.forkIn(sessionScope, { startImmediately: true }),
          );
        return { monitorId, status: "scheduled" as const };
      }).pipe(
        Effect.mapError((cause) =>
          isMonitorStoppedError(cause) ? cause : new MonitorSession.MonitorStartError({ cause }),
        ),
      );

    const unsubscribe = (threadId: ThreadId, processId: string) =>
      Effect.suspend(() => {
        const state = threads.get(threadId);
        if (state === undefined) return Effect.void;
        state.tasks.unsubscribe(processId);
        if (state.offer?.wake.processId === processId && !state.offer.dispatched) {
          state.offer = undefined;
        }
        return pump(threadId);
      });

    const subscribe = (threadId: ThreadId, processId: string) =>
      Effect.gen(function* () {
        const state = threads.get(threadId);
        if (closed || state === undefined || state.suppressed || !(yield* available)) {
          return yield* new MonitorSession.MonitorStoppedError({});
        }
        if (!state.tasks.subscribe(processId)) {
          return yield* new MonitorSession.MonitorProcessMissingError({ processId });
        }
      });

    const register = (threadId: ThreadId, credentialId: string) =>
      Effect.suspend(() => {
        const monitorSessions = input.monitorSessions;
        if (monitorSessions === undefined || registeredCredentials.has(credentialId)) {
          return Effect.void;
        }
        registeredCredentials.add(credentialId);
        // A credential is minted for one app thread, so the registration can
        // bind the thread the MCP call authenticated as.
        return monitorSessions
          .register(credentialId, {
            start: (command) => start(threadId, command),
            subscribe: (processId) => subscribe(threadId, processId),
            unsubscribe: (processId) => unsubscribe(threadId, processId),
          })
          .pipe(Effect.provideService(Scope.Scope, sessionScope));
      });

    const noteMessage = (state: ThreadMonitorState, message: ProviderAdapterV2TurnMessage) => {
      if (state.offer?.dispatched === true && state.offer.detail === message.text) {
        state.offer = undefined;
      }
      if (message.createdBy === "user") {
        // A user send resumes monitoring after Stop or a rejected wake. Also
        // release a dispatched wake the user may have removed from the queue.
        state.suppressed = false;
        if (state.offer?.dispatched === true) state.offer = undefined;
      }
    };

    return {
      onOutputDelta: (payload) =>
        Effect.suspend(() => {
          const monitor = commands.get(payload.processId);
          const state = monitor === undefined ? undefined : threads.get(monitor.threadId);
          if (monitor === undefined || state === undefined) return Effect.void;
          state.tasks.output(
            payload.processId,
            monitor[payload.stream].decode(Buffer.from(payload.deltaBase64, "base64"), {
              stream: true,
            }),
            payload.stream,
          );
          return pump(monitor.threadId);
        }),
      noteTurn: ({ route, message, mcpCredentialId }) =>
        Effect.gen(function* () {
          let state = threads.get(route.threadId);
          if (state === undefined) {
            state = {
              route,
              tasks: new CodexBackgroundTasks(),
              offer: undefined,
              suppressed: false,
            };
            threads.set(route.threadId, state);
          } else {
            state.route = route;
          }
          noteMessage(state, message);
          if (mcpCredentialId !== undefined) yield* register(route.threadId, mcpCredentialId);
          yield* pump(route.threadId);
        }),
      noteSteer: ({ threadId, message }) =>
        Effect.suspend(() => {
          const state = threads.get(threadId);
          if (state === undefined) return Effect.void;
          noteMessage(state, message);
          return pump(threadId);
        }),
      stopThread: (providerThreadId) =>
        Effect.gen(function* () {
          const state = Array.from(threads.values()).find(
            (candidate) => candidate.route.providerThreadId === providerThreadId,
          );
          if (state === undefined) return;
          // Termination output is not a new event to act on.
          state.suppressed = true;
          state.offer = undefined;
          state.tasks.cancelWakes();
          const owned = Array.from(commands.entries()).filter(
            ([, monitor]) => monitor.threadId === state.route.threadId,
          );
          for (const [, monitor] of owned) monitor.stopped = true;
          yield* Effect.forEach(
            owned,
            ([processId]) =>
              input.client.terminate(processId).pipe(
                Effect.timeout("10 seconds"),
                Effect.catchCause((cause) =>
                  Effect.logWarning("Timed out stopping Codex monitor.", { processId, cause }),
                ),
              ),
            { concurrency: "unbounded", discard: true },
          );
          state.tasks.stop();
        }),
      hasRunningMonitors: Effect.sync(() => commands.size > 0),
      start,
      unsubscribe,
    } satisfies CodexMonitorRuntime;
  });
