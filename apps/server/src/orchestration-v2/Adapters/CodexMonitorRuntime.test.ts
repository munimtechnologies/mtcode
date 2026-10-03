import { assert, it } from "@effect/vitest";
import { MessageId, ProviderDriverKind, ProviderThreadId, ThreadId } from "@t3tools/contracts";
import type * as CodexSchema from "effect-codex-app-server/schema";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

import * as MonitorSession from "../../mcp/MonitorSession.ts";
import type { ProviderAdapterV2TurnMessage } from "../ProviderAdapter.ts";
import type { ProviderContinuationRequest } from "../ProviderContinuationRequests.ts";
import { makeCodexMonitorRuntime } from "./CodexMonitorRuntime.ts";

const threadId = ThreadId.make("monitor-thread");
const providerThreadId = ProviderThreadId.make("monitor-provider-thread");
const credentialId = "monitor-credential";

const message = (
  text: string,
  createdBy: ProviderAdapterV2TurnMessage["createdBy"] = "user",
): ProviderAdapterV2TurnMessage => ({
  messageId: MessageId.make(`message-${text.length}-${createdBy}`),
  text,
  attachments: [],
  createdBy,
  creationSource: createdBy === "user" ? "web" : "server",
});

const waitFor = (predicate: () => boolean, label: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (predicate()) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`Timed out waiting for ${label}.`);
  });

const delta = (processId: string, text: string, stream: "stdout" | "stderr" = "stdout") =>
  ({
    processId,
    stream,
    deltaBase64: Buffer.from(text).toString("base64"),
    capReached: false,
  }) satisfies CodexSchema.V2CommandExecOutputDeltaNotification;

const setup = Effect.fn("setup")(function* (userAgent = "Codex Desktop/0.156.1") {
  const executions: Array<CodexSchema.V2CommandExecParams> = [];
  const exits = new Map<string, Deferred.Deferred<{ readonly exitCode: number }, Error>>();
  const terminated: Array<string> = [];
  const offers: Array<ProviderContinuationRequest> = [];
  const monitors = yield* makeCodexMonitorRuntime({
    driver: ProviderDriverKind.make("codex"),
    client: {
      exec: (params) =>
        Effect.gen(function* () {
          const exit = yield* Deferred.make<{ readonly exitCode: number }, Error>();
          executions.push(params);
          exits.set(params.processId ?? "", exit);
          return yield* Deferred.await(exit);
        }),
      terminate: (processId) =>
        Effect.sync(() => {
          terminated.push(processId);
        }),
    },
    userAgent: Effect.succeed(userAgent),
    monitorSessions: yield* MonitorSession.MonitorSessions,
    continuationRequests: {
      offer: (request) =>
        Effect.sync(() => {
          offers.push(request);
        }),
    },
  });
  const noteTurn = (text: string, createdBy: ProviderAdapterV2TurnMessage["createdBy"] = "user") =>
    monitors.noteTurn({
      route: {
        threadId,
        providerThreadId,
        cwd: "/workspace",
        sandboxPolicy: { type: "readOnly" },
      },
      message: message(text, createdBy),
      mcpCredentialId: credentialId,
    });
  const sessions = yield* MonitorSession.MonitorSessions;
  const startMonitor = (command: ReadonlyArray<string>) => sessions.start(credentialId, command);
  const unsubscribe = (processId: string) =>
    sessions.invoke(credentialId, "unsubscribe", processId);
  // Waits for every monitor command fiber to finish its exit handling.
  const settle = Effect.gen(function* () {
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (!(yield* monitors.hasRunningMonitors)) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die("Timed out waiting for monitors to settle.");
  });
  return {
    monitors,
    executions,
    exits,
    terminated,
    offers,
    noteTurn,
    startMonitor,
    unsubscribe,
    settle,
  };
});

const run = <A, E>(effect: Effect.Effect<A, E, MonitorSession.MonitorSessions | Scope.Scope>) =>
  effect.pipe(Effect.scoped, Effect.provide(MonitorSession.layer));

it.effect("starts a monitor in the thread sandbox and wakes the thread one event at a time", () =>
  run(
    Effect.gen(function* () {
      const harness = yield* setup();
      yield* harness.noteTurn("watch CI");
      const monitor = yield* harness.startMonitor(["watch-ci", "--follow"]);
      assert.equal(monitor.status, "scheduled");
      yield* waitFor(() => harness.executions.length === 1, "command/exec");
      assert.deepStrictEqual(harness.executions[0], {
        command: ["watch-ci", "--follow"],
        processId: monitor.monitorId,
        cwd: "/workspace",
        sandboxPolicy: { type: "readOnly" },
        streamStdoutStderr: true,
        disableTimeout: true,
        disableOutputCap: true,
      });
      assert.isTrue(yield* harness.monitors.hasRunningMonitors);

      // Split chunks are not event boundaries.
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "first "));
      assert.lengthOf(harness.offers, 0);
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "event\n"));
      assert.lengthOf(harness.offers, 1);
      const first = harness.offers[0]!;
      assert.equal(first.threadId, threadId);
      assert.equal(first.providerThreadId, providerThreadId);
      assert.equal(first.delivery, "message_text");
      assert.include(first.detail ?? "", "first event");
      assert.include(first.detail ?? "", monitor.monitorId);
      assert.equal(first.notification?.source.kind, "monitor");

      // Output while the wake waits for its turn merges into the next wake.
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "second\n"));
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "third\n"));
      assert.lengthOf(harness.offers, 1);
      const dispatched = yield* first.dispatchIfCurrent!(Effect.succeed("queued"));
      assert.deepStrictEqual(dispatched, Option.some("queued"));
      assert.lengthOf(harness.offers, 1);

      yield* harness.noteTurn(first.detail!, "agent");
      assert.lengthOf(harness.offers, 2);
      assert.include(harness.offers[1]!.detail ?? "", "second\nthird");
    }),
  ),
);

it.effect("reports exit and launch failure through the wake", () =>
  run(
    Effect.gen(function* () {
      const harness = yield* setup();
      yield* harness.noteTurn("watch");
      const monitor = yield* harness.startMonitor(["fail"]);
      yield* waitFor(() => harness.exits.has(monitor.monitorId), "command/exec");
      yield* Deferred.fail(harness.exits.get(monitor.monitorId)!, new Error("spawn failed"));
      yield* waitFor(() => harness.offers.length === 1, "failure wake");
      assert.include(harness.offers[0]!.detail ?? "", "Watcher failed to start or execute.");
      assert.include(harness.offers[0]!.detail ?? "", "Watcher exited with code 1.");
      yield* harness.settle;
      assert.isFalse(yield* harness.monitors.hasRunningMonitors);
    }),
  ),
);

it.effect("Stop terminates monitors without a shutdown wake until the user sends again", () =>
  run(
    Effect.gen(function* () {
      const harness = yield* setup();
      yield* harness.noteTurn("watch");
      const monitor = yield* harness.startMonitor(["quiet"]);
      yield* waitFor(() => harness.exits.has(monitor.monitorId), "command/exec");
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "half a line"));
      yield* harness.monitors.stopThread(providerThreadId);
      assert.deepStrictEqual(harness.terminated, [monitor.monitorId]);
      yield* Deferred.succeed(harness.exits.get(monitor.monitorId)!, { exitCode: 143 });
      yield* harness.settle;
      assert.lengthOf(harness.offers, 0);
      assert.isFalse(yield* harness.monitors.hasRunningMonitors);

      const stopped = yield* harness.startMonitor(["quiet"]).pipe(Effect.flip);
      assert.equal(stopped._tag, "MonitorStoppedError");
      yield* harness.noteTurn("resume");
      assert.equal((yield* harness.startMonitor(["quiet"])).status, "scheduled");
    }),
  ),
);

it.effect("unsubscribe discards pending wakes and later output", () =>
  run(
    Effect.gen(function* () {
      const harness = yield* setup();
      yield* harness.noteTurn("watch");
      const monitor = yield* harness.startMonitor(["watch-ci"]);
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "first\n"));
      assert.lengthOf(harness.offers, 1);
      yield* harness.unsubscribe(monitor.monitorId);
      // The undispatched wake is withdrawn.
      assert.deepStrictEqual(
        yield* harness.offers[0]!.dispatchIfCurrent!(Effect.succeed("queued")),
        Option.none(),
      );
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "later\n"));
      assert.lengthOf(harness.offers, 1);
    }),
  ),
);

it.effect("a rejected wake suppresses monitoring until the next user message", () =>
  run(
    Effect.gen(function* () {
      const harness = yield* setup();
      yield* harness.noteTurn("watch");
      const monitor = yield* harness.startMonitor(["watch-ci"]);
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "event\n"));
      const result = yield* harness.offers[0]!.dispatchIfCurrent!(Effect.fail("rejected")).pipe(
        Effect.flip,
      );
      assert.equal(result, "rejected");
      yield* harness.monitors.onOutputDelta(delta(monitor.monitorId, "more\n"));
      assert.lengthOf(harness.offers, 1);
      yield* harness.noteTurn("continue");
      assert.lengthOf(harness.offers, 2);
      assert.include(harness.offers[1]!.detail ?? "", "event\nmore");
    }),
  ),
);

it.effect("rejects monitors on Codex builds without command/exec streaming", () =>
  run(
    Effect.gen(function* () {
      const harness = yield* setup("Codex Desktop/0.150.0");
      yield* harness.noteTurn("watch");
      const error = yield* harness.startMonitor(["watch-ci"]).pipe(Effect.flip);
      assert.equal(error._tag, "MonitorStoppedError");
    }),
  ),
);

it.effect("MCP calls for an unregistered credential report unavailable", () =>
  run(
    Effect.gen(function* () {
      yield* setup();
      // No turn yet, so the credential was never registered.
      const error = yield* (yield* MonitorSession.MonitorSessions)
        .start(credentialId, ["watch-ci"])
        .pipe(Effect.flip);
      assert.equal(error._tag, "MonitorUnavailableError");
    }),
  ),
);
