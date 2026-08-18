import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationCommand, OrchestrationThreadShell } from "@t3tools/contracts";
import { ThreadId, TurnId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TurnWatchdogReactor } from "../Services/TurnWatchdogReactor.ts";
import * as TurnWatchdog from "../TurnWatchdog.ts";
import { TurnWatchdogService } from "../TurnWatchdog.ts";
import { makeTurnWatchdogReactorLive } from "./TurnWatchdogReactor.ts";

const thread = ThreadId.make("thread-1");
const turn = TurnId.make("turn-1");

function shellWithSessionStatus(status: string): OrchestrationThreadShell {
  return { id: thread, session: { status } } as unknown as OrchestrationThreadShell;
}

function makeHarness(options: {
  readonly hungThresholdMs?: number | null;
  readonly sessionStatus?: string | null;
}) {
  const dispatched: Array<OrchestrationCommand> = [];
  const engineLayer = Layer.mock(OrchestrationEngineService)({
    dispatch: (command: OrchestrationCommand) => {
      dispatched.push(command);
      return Effect.succeed({ sequence: dispatched.length });
    },
  });
  const snapshotLayer = Layer.mock(ProjectionSnapshotQuery)({
    getThreadShellById: () =>
      Effect.succeed(
        options.sessionStatus == null
          ? Option.none()
          : Option.some(shellWithSessionStatus(options.sessionStatus)),
      ),
  });
  const layer = makeTurnWatchdogReactorLive({
    enabled: true,
    stallThresholdMs: 1000,
    hungThresholdMs: options.hungThresholdMs ?? null,
    sweepIntervalMs: 60_000,
  }).pipe(
    Layer.provideMerge(Layer.succeed(TurnWatchdogService, TurnWatchdog.make())),
    // Layer.mock leaves unimplemented methods as defects; only the mocked
    // methods are exercised here.
    Layer.provide(engineLayer),
    Layer.provide(snapshotLayer),
  );
  return { layer, dispatched };
}

describe("TurnWatchdogReactor", () => {
  it.effect("surfaces a stalled turn as an error activity", () => {
    const harness = makeHarness({ sessionStatus: "running" });
    return Effect.gen(function* () {
      const watchdog = yield* TurnWatchdogService;
      const reactor = yield* TurnWatchdogReactor;
      const nowMs = yield* Clock.currentTimeMillis;
      watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: nowMs - 5000 });
      yield* reactor.sweepNow;

      expect(harness.dispatched).toHaveLength(1);
      const command = harness.dispatched[0];
      if (command?.type !== "thread.activity.append") {
        throw new Error(`expected activity append, got ${command?.type}`);
      }
      expect(command.threadId).toBe(thread);
      expect(command.activity.kind).toBe("turn.watchdog.stalled");
      expect(command.activity.tone).toBe("error");
      expect(command.activity.turnId).toBe(turn);

      // Same silent stretch: the next sweep must not duplicate the report.
      yield* reactor.sweepNow;
      expect(harness.dispatched).toHaveLength(1);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("interrupts a hung turn when recovery is enabled", () => {
    const harness = makeHarness({ sessionStatus: "running", hungThresholdMs: 2000 });
    return Effect.gen(function* () {
      const watchdog = yield* TurnWatchdogService;
      const reactor = yield* TurnWatchdogReactor;
      const nowMs = yield* Clock.currentTimeMillis;
      watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: nowMs - 5000 });
      yield* reactor.sweepNow;

      expect(harness.dispatched.map((command) => command.type)).toEqual([
        "thread.turn.interrupt",
        "thread.activity.append",
      ]);
      const interrupt = harness.dispatched[0];
      if (interrupt?.type !== "thread.turn.interrupt") {
        throw new Error("expected interrupt command");
      }
      expect(interrupt.threadId).toBe(thread);
      expect(interrupt.turnId).toBe(turn);
      const activity = harness.dispatched[1];
      if (activity?.type !== "thread.activity.append") {
        throw new Error("expected activity append");
      }
      expect(activity.activity.kind).toBe("turn.watchdog.interrupted");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("drops a stale watch instead of surfacing it when the session already settled", () => {
    const harness = makeHarness({ sessionStatus: "ready" });
    return Effect.gen(function* () {
      const watchdog = yield* TurnWatchdogService;
      const reactor = yield* TurnWatchdogReactor;
      const nowMs = yield* Clock.currentTimeMillis;
      watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: nowMs - 5000 });
      yield* reactor.sweepNow;
      // The watch entry is gone: nothing to report even much later.
      yield* reactor.sweepNow;
      expect(harness.dispatched).toHaveLength(0);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("drops a watch whose thread no longer exists", () => {
    const harness = makeHarness({ sessionStatus: null });
    return Effect.gen(function* () {
      const watchdog = yield* TurnWatchdogService;
      const reactor = yield* TurnWatchdogReactor;
      const nowMs = yield* Clock.currentTimeMillis;
      watchdog.recordTurnStarted({ threadId: thread, atMs: nowMs - 5000 });
      yield* reactor.sweepNow;
      expect(harness.dispatched).toHaveLength(0);
    }).pipe(Effect.provide(harness.layer));
  });
});
