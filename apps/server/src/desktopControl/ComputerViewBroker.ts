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
  ComputerViewError,
  type ComputerViewInput,
  type ComputerViewQuality,
  type ComputerViewStreamEvent,
  type ComputerViewStreamInput,
} from "@t3tools/contracts";
import {
  parseComputerViewDisplays,
  selectComputerViewDisplay,
  type ComputerViewDisplayInfo,
} from "@t3tools/shared/computerView";
import { MTCODE_DESKTOP_ENV_PREFIX } from "@t3tools/shared/munimComputerUse";
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
import * as Ndjson from "effect/encoding/Ndjson";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  buildComputerViewFrame,
  COMPUTER_VIEW_LIVE_WAIT_MS,
  computerViewCaptureArguments,
  computerViewCaptureIntervalMs,
  computerViewCursorEvent,
  computerViewToolCall,
  type ComputerViewHostCursor,
  toolResultCursor,
  toolResultImage,
  toolResultIsError,
  toolResultLive,
  toolResultText,
  type ComputerViewLiveState,
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
  // Two helper processes: one captures, one takes input. The helper answers
  // one request at a time, so with a single process every click and pointer
  // move waited behind whatever capture was in flight (~100 ms on Windows).
  const captureState = yield* SynchronizedRef.make<ActiveClient | null>(null);
  const inputState = yield* SynchronizedRef.make<ActiveClient | null>(null);
  // The capture helper keeps one live capture, of one display. Viewers of that
  // display share it; a viewer of another display on the same machine falls
  // back to ordinary screenshots rather than make the two take turns
  // restarting it. Display index -> live viewers.
  const liveViewers = new Map<number, number>();

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
      env: {
        ...Object.fromEntries(launch.env.map(({ name, value }) => [name, value])),
        // This process exists to be driven by a person watching the screen it
        // captures, so its input takes over the real pointer and keyboard
        // instead of being routed to a window in the background. Agent
        // sessions run their own desktop-MCP process, which keeps the
        // background behaviour and leaves this machine's user alone.
        [`${MTCODE_DESKTOP_ENV_PREFIX}REMOTE_CONTROL`]: "1",
      },
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

  const acquireClient = (state: SynchronizedRef.SynchronizedRef<ActiveClient | null>) =>
    SynchronizedRef.modifyEffect(state, (current) => {
      if (current !== null) {
        current.refCount += 1;
        return Effect.succeed([current, current] as const);
      }
      return startClient.pipe(Effect.map((client) => [client, client] as const));
    });

  const releaseClient = (state: SynchronizedRef.SynchronizedRef<ActiveClient | null>) =>
    SynchronizedRef.updateEffect(state, (current) => {
      if (current === null) return Effect.succeed(null);
      current.refCount -= 1;
      if (current.refCount > 0) return Effect.succeed(current);
      return shutdownClient(current).pipe(Effect.as(null));
    });

  const captureFrame = Effect.fn("ComputerViewBroker.captureFrame")(function* (
    client: ActiveClient,
    display: ComputerViewDisplayInfo,
    maxWidth: number,
    quality: ComputerViewQuality | undefined,
    cursor: boolean,
    live: { readonly after: number | null } | null,
  ) {
    // The frame event carries whichever mime type actually came back: macOS
    // helpers before 0.6.0 only produce PNG whatever was asked for.
    const result = yield* callTool(
      client,
      "screenshot",
      computerViewCaptureArguments({
        display: display.index,
        maxWidth,
        quality,
        cursor,
        ...(live === null
          ? {}
          : { live: { after: live.after, waitMs: COMPUTER_VIEW_LIVE_WAIT_MS } }),
      }),
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
    const liveState: ComputerViewLiveState | null = live === null ? null : toolResultLive(result);
    const hostCursor = cursor ? toolResultCursor(result) : null;
    // Nothing changed within the wait: no image, only the frame number (and
    // the pointer, which may have moved on its own).
    if (liveState !== null && !liveState.changed) {
      return { frame: null, cursor: hostCursor, live: liveState };
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
    return { frame, cursor: hostCursor, live: liveState };
  });

  const stream: ComputerViewBroker["Service"]["stream"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* Effect.acquireRelease(acquireClient(captureState), () =>
          releaseClient(captureState),
        );
        // Keep the input process warm for as long as someone is watching, so
        // the first click does not pay for a process start.
        yield* Effect.acquireRelease(acquireClient(inputState), () => releaseClient(inputState));
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
        const live = yield* Effect.acquireRelease(
          Effect.sync(() => {
            if ([...liveViewers.keys()].some((index) => index !== selected.index)) return false;
            liveViewers.set(selected.index, (liveViewers.get(selected.index) ?? 0) + 1);
            return true;
          }),
          (claimed) =>
            Effect.sync(() => {
              if (!claimed) return;
              const remaining = (liveViewers.get(selected.index) ?? 1) - 1;
              if (remaining > 0) liveViewers.set(selected.index, remaining);
              else liveViewers.delete(selected.index);
            }),
        );
        const maxWidth = input.maxWidth ?? COMPUTER_VIEW_DEFAULT_MAX_WIDTH;
        const activeInterval = computerViewCaptureIntervalMs(input.frameRate);
        let lastFrameAt = 0;
        let consecutiveFailures = 0;
        // The newest live frame this viewer has. The host waits for the screen
        // to change past it, so the loop neither polls an idle screen nor
        // compares bytes.
        let lastSeq: number | null = null;
        // A still screen encodes to the same bytes every time. Comparing them
        // is what lets the capture loop run fast without paying for it: only
        // changed pixels reach the client.
        let lastFrameData: string | null = null;
        let unchangedRuns = 0;
        const wantsCursor = input.cursor === true;
        let lastCursor: ComputerViewHostCursor | null = null;
        const sentCursorImages = new Set<string>();
        const nextEvents = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          // Back off while nothing moves so an idle viewer is not a busy loop
          // on the host, and snap back to full speed the moment it does.
          const interval =
            unchangedRuns >= IDLE_CAPTURE_RUNS
              ? Math.max(IDLE_CAPTURE_INTERVAL_MS, activeInterval)
              : activeInterval;
          const wait = lastFrameAt + interval - now;
          if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
          const captured = yield* captureFrame(
            client,
            selected,
            maxWidth,
            input.quality,
            wantsCursor,
            live ? { after: lastSeq } : null,
          ).pipe(
            Effect.map((capture) => {
              consecutiveFailures = 0;
              return capture;
            }),
            Effect.catch((error) => {
              consecutiveFailures += 1;
              if (consecutiveFailures >= MAX_CONSECUTIVE_CAPTURE_FAILURES) {
                return Effect.fail(error);
              }
              return Effect.succeed(error.detail);
            }),
          );
          const capturedAt = yield* Clock.currentTimeMillis;
          if (typeof captured === "string") {
            lastFrameAt = capturedAt;
            return [{ type: "status", message: captured } satisfies ComputerViewStreamEvent];
          }
          const events: ComputerViewStreamEvent[] = [];
          // Captures leave the pointer out, so a moving pointer over a still
          // screen is activity too.
          const cursorEvent =
            captured.cursor === null
              ? null
              : computerViewCursorEvent(captured.cursor, lastCursor, sentCursorImages);
          if (captured.cursor !== null) lastCursor = captured.cursor;
          if (cursorEvent !== null) {
            if (cursorEvent.image !== undefined) sentCursorImages.add(cursorEvent.id);
            events.push(cursorEvent);
          }
          if (captured.live !== null) {
            // The host already waited for a change; a frame here is news. Pace
            // from the last delivered frame, so a call that came back empty
            // after waiting is followed straight away by the next one.
            lastSeq = captured.live.seq;
            unchangedRuns = 0;
            if (captured.frame !== null || cursorEvent !== null) lastFrameAt = capturedAt;
            if (captured.frame !== null) {
              lastFrameData = captured.frame.data;
              events.push(captured.frame);
            }
            return events;
          }
          // An ordinary screenshot: an older host, Linux, or a display the
          // host has no live capture for.
          lastFrameAt = capturedAt;
          if (captured.frame === null || captured.frame.data === lastFrameData) {
            unchangedRuns = cursorEvent === null ? unchangedRuns + 1 : 0;
          } else {
            lastFrameData = captured.frame.data;
            unchangedRuns = 0;
            events.push(captured.frame);
          }
          return events;
        });
        return Stream.concat(
          Stream.make(ready),
          Stream.fromEffectRepeat(nextEvents).pipe(Stream.flatMap(Stream.fromIterable)),
        );
      }),
    );

  const input: ComputerViewBroker["Service"]["input"] = Effect.fn("ComputerViewBroker.input")(
    (viewInput) =>
      Effect.scoped(
        Effect.gen(function* () {
          // Reuses the input process a viewer keeps open (the common case);
          // otherwise a one-shot process serves this single call.
          const client = yield* Effect.acquireRelease(acquireClient(inputState), () =>
            releaseClient(inputState),
          );
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
