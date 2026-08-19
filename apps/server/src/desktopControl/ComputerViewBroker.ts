/**
 * Live remote view of this computer: streams periodic screen captures and
 * injects pointer/keyboard input by driving the bundled desktop-control MCP
 * binary over newline-delimited JSON-RPC.
 *
 * One child process is shared by every viewer and input call, refcounted so
 * it exits when the last subscriber goes away. Enablement mirrors Computer
 * Use: when the desktop MCP is disabled in settings or the binary is absent,
 * every call fails closed with `unavailable`.
 */
import {
  COMPUTER_VIEW_DEFAULT_MAX_WIDTH,
  COMPUTER_VIEW_MIN_INTERVAL_MS,
  ComputerViewError,
  type ComputerViewInput,
  type ComputerViewStreamEvent,
  type ComputerViewStreamInput,
} from "@t3tools/contracts";
import {
  parseComputerViewDisplays,
  selectComputerViewDisplay,
  type ComputerViewDisplayInfo,
} from "@t3tools/shared/computerView";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as Ndjson from "effect/unstable/encoding/Ndjson";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildComputerViewFrame,
  computerViewToolCall,
  toolResultImage,
  toolResultIsError,
  toolResultText,
  type McpToolResult,
} from "./computerViewMcp.ts";
import { makeResolveEnabledDesktopMcp } from "./desktopMcpLaunch.ts";

export class ComputerViewBroker extends Context.Service<
  ComputerViewBroker,
  {
    readonly stream: (
      input: ComputerViewStreamInput,
    ) => Stream.Stream<ComputerViewStreamEvent, ComputerViewError>;
    readonly input: (input: ComputerViewInput) => Effect.Effect<void, ComputerViewError>;
  }
>()("t3/desktopControl/ComputerViewBroker") {}

const INITIALIZE_TIMEOUT = Duration.seconds(5);
const LIST_DISPLAYS_TIMEOUT = Duration.seconds(10);
const CAPTURE_TIMEOUT = Duration.seconds(15);
const INPUT_TIMEOUT = Duration.seconds(10);
/** Consecutive capture failures surface as status events until this cap. */
const MAX_CONSECUTIVE_CAPTURE_FAILURES = 5;
/** Identical captures in a row before the loop decides the screen is idle. */
const IDLE_CAPTURE_RUNS = 8;
/** Capture gap once the screen is idle. Any change still lands within this. */
const IDLE_CAPTURE_INTERVAL_MS = 500;

interface McpRpcResponse {
  readonly result?: McpToolResult;
  readonly errorMessage?: string;
}

interface ActiveClient {
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  /** Owns the child process and its stdout/stderr reader fibers. */
  readonly scope: Scope.Closeable;
  readonly writeMutex: Semaphore.Semaphore;
  readonly pending: Map<number, Deferred.Deferred<McpRpcResponse>>;
  nextRequestId: number;
  refCount: number;
}

const unavailable = (detail: string, cause?: unknown) =>
  new ComputerViewError({
    code: "unavailable",
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

function dispatchLine(pending: Map<number, Deferred.Deferred<McpRpcResponse>>, line: unknown) {
  if (typeof line !== "object" || line === null) return Effect.void;
  const message = line as {
    readonly id?: unknown;
    readonly result?: unknown;
    readonly error?: { readonly message?: unknown };
  };
  if (typeof message.id !== "number") return Effect.void;
  const deferred = pending.get(message.id);
  if (deferred === undefined) return Effect.void;
  pending.delete(message.id);
  if (message.error !== undefined) {
    const detail =
      typeof message.error.message === "string"
        ? message.error.message
        : "The desktop MCP returned an error.";
    return Deferred.succeed(deferred, { errorMessage: detail });
  }
  return Deferred.succeed(deferred, { result: (message.result ?? {}) as McpToolResult });
}

export const make = Effect.gen(function* ComputerViewBrokerMake() {
  const resolveMcp = yield* makeResolveEnabledDesktopMcp();
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const state = yield* SynchronizedRef.make<ActiveClient | null>(null);

  const writeMessage = (client: ActiveClient, message: Record<string, unknown>) =>
    client.writeMutex.withPermits(1)(
      Stream.run(
        Stream.encodeText(Stream.make(`${JSON.stringify(message)}\n`)),
        client.handle.stdin,
      ).pipe(
        Effect.mapError((cause) => unavailable("The desktop MCP process closed its input.", cause)),
      ),
    );

  const requestResponse = Effect.fn("ComputerViewBroker.requestResponse")(function* (
    client: ActiveClient,
    method: string,
    params: Record<string, unknown>,
    timeout: Duration.Duration,
  ) {
    const id = client.nextRequestId++;
    const deferred = yield* Deferred.make<McpRpcResponse>();
    client.pending.set(id, deferred);
    yield* writeMessage(client, { jsonrpc: "2.0", id, method, params }).pipe(
      Effect.onError(() => Effect.sync(() => client.pending.delete(id))),
    );
    const response = yield* Deferred.await(deferred).pipe(
      Effect.timeoutOption(timeout),
      Effect.ensuring(Effect.sync(() => client.pending.delete(id))),
    );
    if (response._tag === "None") {
      return yield* unavailable(`The desktop MCP did not answer '${method}' in time.`);
    }
    return response.value;
  });

  const callTool = Effect.fn("ComputerViewBroker.callTool")(function* (
    client: ActiveClient,
    name: string,
    args: Record<string, unknown>,
    timeout: Duration.Duration,
  ) {
    const response = yield* requestResponse(
      client,
      "tools/call",
      { name, arguments: args },
      timeout,
    );
    if (response.errorMessage !== undefined) {
      return yield* unavailable(response.errorMessage);
    }
    return response.result ?? {};
  });

  const shutdownClient = (client: ActiveClient) =>
    Effect.gen(function* () {
      yield* Scope.close(client.scope, Exit.void);
      const orphaned = [...client.pending.values()];
      client.pending.clear();
      yield* Effect.forEach(
        orphaned,
        (deferred) =>
          Deferred.succeed(deferred, { errorMessage: "The desktop MCP process stopped." }),
        { discard: true },
      );
    });

  const startClient = Effect.gen(function* () {
    const launch = yield* resolveMcp().pipe(
      Effect.mapError((cause) => unavailable("Server settings could not be read.", cause)),
    );
    if (launch === undefined) {
      return yield* unavailable(
        "Computer Use is disabled on this machine or the desktop control binary is missing. Enable Computer Use in Settings on that computer to view it remotely.",
      );
    }
    const command = ChildProcess.make(launch.path, [], {
      env: Object.fromEntries(launch.env.map(({ name, value }) => [name, value])),
      extendEnv: true,
      stdin: { stream: "pipe", endOnDone: false },
      stdout: "pipe",
      stderr: "pipe",
      killSignal: "SIGTERM",
      forceKillAfter: Duration.seconds(2),
    });
    const scope = yield* Scope.make();
    const handle = yield* spawner.spawn(command).pipe(
      Scope.provide(scope),
      Effect.mapError((cause) => unavailable("The desktop MCP failed to start.", cause)),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    const pending = new Map<number, Deferred.Deferred<McpRpcResponse>>();
    yield* handle.stdout.pipe(
      Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
      Stream.runForEach((line) => dispatchLine(pending, line)),
      Effect.ignore,
      Effect.forkScoped,
      Scope.provide(scope),
    );
    yield* handle.stderr.pipe(
      Stream.runDrain,
      Effect.ignore,
      Effect.forkScoped,
      Scope.provide(scope),
    );
    const client: ActiveClient = {
      handle,
      scope,
      writeMutex: yield* Semaphore.make(1),
      pending,
      nextRequestId: 1,
      refCount: 1,
    };
    yield* requestResponse(
      client,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "t3-computer-view", version: "1.0.0" },
      },
      INITIALIZE_TIMEOUT,
    ).pipe(Effect.onError(() => shutdownClient(client)));
    yield* writeMessage(client, { jsonrpc: "2.0", method: "notifications/initialized" }).pipe(
      Effect.onError(() => shutdownClient(client)),
    );
    return client;
  });

  const acquireClient = SynchronizedRef.modifyEffect(state, (current) => {
    if (current !== null) {
      current.refCount += 1;
      return Effect.succeed([current, current] as const);
    }
    return startClient.pipe(Effect.map((client) => [client, client] as const));
  });

  const releaseClient = SynchronizedRef.updateEffect(state, (current) => {
    if (current === null) return Effect.succeed(null);
    current.refCount -= 1;
    if (current.refCount > 0) return Effect.succeed(current);
    return shutdownClient(current).pipe(Effect.as(null));
  });

  const captureFrame = Effect.fn("ComputerViewBroker.captureFrame")(function* (
    client: ActiveClient,
    display: ComputerViewDisplayInfo,
    maxWidth: number,
  ) {
    // Request JPEG for bandwidth; the macOS helper only produces PNG and the
    // frame event carries whichever mime type actually came back.
    const result = yield* callTool(
      client,
      "screenshot",
      { display: display.index, max_width: maxWidth, format: "jpeg" },
      CAPTURE_TIMEOUT,
    ).pipe(
      Effect.mapError(
        (error) => new ComputerViewError({ code: "capture_failed", detail: error.detail }),
      ),
    );
    if (toolResultIsError(result)) {
      return yield* new ComputerViewError({
        code: "capture_failed",
        detail: toolResultText(result) || "Screen capture failed.",
      });
    }
    const image = toolResultImage(result);
    if (image === null) {
      return yield* new ComputerViewError({
        code: "capture_failed",
        detail: "The desktop MCP did not return an image.",
      });
    }
    const frame = buildComputerViewFrame({
      image,
      bytes: Buffer.from(image.data, "base64"),
      display,
    });
    if (frame === null) {
      return yield* new ComputerViewError({
        code: "capture_failed",
        detail: "The captured image could not be decoded.",
      });
    }
    return frame;
  });

  const stream: ComputerViewBroker["Service"]["stream"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Effect.acquireRelease(acquireClient, () => releaseClient);
        const listResult = yield* callTool(client, "list_displays", {}, LIST_DISPLAYS_TIMEOUT);
        const displays = parseComputerViewDisplays(toolResultText(listResult));
        const selected = selectComputerViewDisplay(displays, input.display);
        if (selected === null) {
          return yield* new ComputerViewError({
            code: input.display === undefined ? "capture_failed" : "invalid_display",
            detail:
              displays.length === 0
                ? "No displays were reported. The machine may be headless or missing the Screen Recording permission."
                : `Display ${input.display} was not found.`,
          });
        }
        const ready: ComputerViewStreamEvent = {
          type: "ready",
          displays,
          selectedDisplay: selected.index,
        };
        const maxWidth = input.maxWidth ?? COMPUTER_VIEW_DEFAULT_MAX_WIDTH;
        let lastFrameAt = 0;
        let consecutiveFailures = 0;
        // A still screen encodes to the same bytes every time. Comparing them
        // is what lets the capture loop run fast without paying for it: only
        // changed pixels reach the client.
        let lastFrameData: string | null = null;
        let unchangedRuns = 0;
        const nextEvent = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          // Back off while nothing moves so an idle viewer is not a busy loop
          // on the host, and snap back to full speed the moment it does.
          const interval =
            unchangedRuns >= IDLE_CAPTURE_RUNS
              ? IDLE_CAPTURE_INTERVAL_MS
              : COMPUTER_VIEW_MIN_INTERVAL_MS;
          const wait = lastFrameAt + interval - now;
          if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
          const event: ComputerViewStreamEvent = yield* captureFrame(
            client,
            selected,
            maxWidth,
          ).pipe(
            Effect.map((frame): ComputerViewStreamEvent => {
              consecutiveFailures = 0;
              return frame;
            }),
            Effect.catch((error) => {
              consecutiveFailures += 1;
              if (consecutiveFailures >= MAX_CONSECUTIVE_CAPTURE_FAILURES) {
                return Effect.fail(error);
              }
              return Effect.succeed<ComputerViewStreamEvent>({
                type: "status",
                message: error.detail,
              });
            }),
          );
          lastFrameAt = yield* Clock.currentTimeMillis;
          if (event.type === "frame") {
            if (event.data === lastFrameData) {
              unchangedRuns += 1;
              return null;
            }
            lastFrameData = event.data;
            unchangedRuns = 0;
          }
          return event;
        });
        return Stream.concat(
          Stream.make(ready),
          Stream.fromEffectRepeat(nextEvent).pipe(
            Stream.filter((event): event is ComputerViewStreamEvent => event !== null),
          ),
        );
      }),
    );

  const input: ComputerViewBroker["Service"]["input"] = Effect.fn("ComputerViewBroker.input")(
    (viewInput) =>
      Effect.scoped(
        Effect.gen(function* () {
          // Reuses the streaming client when a viewer is open (the common
          // case); otherwise a one-shot process serves this single call.
          const client = yield* Effect.acquireRelease(acquireClient, () => releaseClient);
          const call = computerViewToolCall(viewInput);
          // acquireClient failures (disabled, missing binary) fail before this
          // call and keep their `unavailable` code; transport errors on a live
          // client read better as input failures.
          const result = yield* callTool(client, call.name, call.arguments, INPUT_TIMEOUT).pipe(
            Effect.mapError(
              (error) => new ComputerViewError({ code: "input_failed", detail: error.detail }),
            ),
          );
          if (toolResultIsError(result)) {
            return yield* new ComputerViewError({
              code: "input_failed",
              detail: toolResultText(result) || `The '${call.name}' input failed.`,
            });
          }
        }),
      ),
  );

  return ComputerViewBroker.of({ stream, input });
}).pipe(Effect.withSpan("ComputerViewBroker.make"));

export const layer = Layer.effect(ComputerViewBroker, make);
