import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { goalContinuationCommandId } from "@t3tools/shared/goalContinuation";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { GoalReactorLive } from "./GoalReactor.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { GoalReactor } from "../Services/GoalReactor.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<void> => {
    if (await predicate()) {
      return;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await Effect.runPromise(Effect.yieldNow);
    return poll();
  };
  return poll();
}

function makeThread(input: {
  readonly id?: ThreadId;
  readonly goal?: OrchestrationThread["goal"];
  readonly interactionMode?: OrchestrationThread["interactionMode"];
  readonly latestTurn?: OrchestrationThread["latestTurn"];
  readonly session?: OrchestrationThread["session"];
  readonly activities?: OrchestrationThread["activities"];
}): OrchestrationThread {
  return {
    id: input.id ?? THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: input.interactionMode ?? "default",
    branch: null,
    worktreePath: null,
    latestTurn:
      input.latestTurn ??
      ({
        turnId: TURN_ID,
        state: "completed",
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        assistantMessageId: null,
      } satisfies NonNullable<OrchestrationThread["latestTurn"]>),
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: input.activities ?? [],
    checkpoints: [],
    session:
      input.session ??
      ({
        threadId: input.id ?? THREAD_ID,
        status: "ready",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      } satisfies NonNullable<OrchestrationThread["session"]>),
    ...(input.goal !== undefined ? { goal: input.goal } : {}),
  };
}

function activeGoal(
  status: NonNullable<OrchestrationThread["goal"]>["status"] = "active",
): NonNullable<OrchestrationThread["goal"]> {
  return {
    objective: "Reduce p95 below 120ms",
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sessionSetEvent(input: {
  readonly threadId?: ThreadId;
  readonly status: NonNullable<OrchestrationThread["session"]>["status"];
  readonly sequence?: number;
  readonly occurredAt?: string;
}): OrchestrationEvent {
  const threadId = input.threadId ?? THREAD_ID;
  const occurredAt = input.occurredAt ?? NOW;
  return {
    sequence: input.sequence ?? 1,
    eventId: EventId.make(`event-session-set-${input.sequence ?? 1}`),
    type: "thread.session-set",
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt,
    commandId: CommandId.make(`cmd-session-set-${input.sequence ?? 1}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId,
      session: {
        threadId,
        status: input.status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: input.status === "running" ? TURN_ID : null,
        lastError: null,
        updatedAt: NOW,
      },
    },
  };
}

describe("GoalReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<GoalReactor, unknown> | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  async function createHarness(threads: ReadonlyArray<OrchestrationThread>) {
    const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
    const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
    const events = Effect.runSync(Queue.unbounded<OrchestrationEvent>());
    const getThreadDetailById = vi.fn((threadId: ThreadId) =>
      Effect.succeed(Option.fromNullishOr(threadsById.get(threadId))),
    );

    const engine = {
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: Stream.fromQueue(events),
      latestSequence: Effect.succeed(0),
    } satisfies OrchestrationEngineShape;

    const snapshotQuery = {
      getThreadDetailById,
    } as unknown as ProjectionSnapshotQueryShape;

    runtime = ManagedRuntime.make(
      GoalReactorLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
        Layer.provide(Layer.succeed(ProjectionSnapshotQuery, snapshotQuery)),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(GoalReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

    return {
      dispatch,
      getThreadDetailById,
      offer: (event: OrchestrationEvent) => Effect.runPromise(Queue.offer(events, event)),
      drain: () => runtime!.runPromise(reactor.drain),
    };
  }

  it("requests a Continuation when an Active Goal's Session becomes ready", async () => {
    const harness = await createHarness([makeThread({ goal: activeGoal() })]);
    await harness.offer(sessionSetEvent({ status: "ready" }));
    await waitFor(() => harness.dispatch.mock.calls.length === 1);
    await harness.drain();

    expect(harness.dispatch).toHaveBeenCalledWith({
      type: "thread.goal.continue",
      commandId: CommandId.make(
        goalContinuationCommandId({
          threadId: THREAD_ID,
          goalUpdatedAt: NOW,
          completedTurnId: TURN_ID,
        }),
      ),
      threadId: THREAD_ID,
      completedTurnId: TURN_ID,
    });
  });

  it("does not request a Continuation when the Goal is paused", async () => {
    const harness = await createHarness([makeThread({ goal: activeGoal("paused") })]);
    await harness.offer(sessionSetEvent({ status: "ready" }));
    await waitFor(() => harness.getThreadDetailById.mock.calls.length === 1);
    await harness.drain();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("does not request a Continuation when the Goal is Usage-limited", async () => {
    const harness = await createHarness([makeThread({ goal: activeGoal("usageLimited") })]);
    await harness.offer(sessionSetEvent({ status: "ready" }));
    await waitFor(() => harness.getThreadDetailById.mock.calls.length === 1);
    await harness.drain();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("does not request a Continuation in plan mode", async () => {
    const harness = await createHarness([
      makeThread({ goal: activeGoal(), interactionMode: "plan" }),
    ]);
    await harness.offer(sessionSetEvent({ status: "ready" }));
    await waitFor(() => harness.getThreadDetailById.mock.calls.length === 1);
    await harness.drain();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("does not request a Continuation while a pending approval is open", async () => {
    const harness = await createHarness([
      makeThread({
        goal: activeGoal(),
        activities: [
          {
            id: EventId.make("activity-approval"),
            tone: "approval",
            kind: "approval.requested",
            summary: "approval.requested",
            payload: { requestId: "req-1" },
            turnId: null,
            createdAt: NOW,
          },
        ],
      }),
    ]);
    await harness.offer(sessionSetEvent({ status: "ready" }));
    await waitFor(() => harness.getThreadDetailById.mock.calls.length === 1);
    await harness.drain();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("does not request a Continuation for a non-ready Session", async () => {
    const readyThreadId = ThreadId.make("thread-ready");
    const harness = await createHarness([
      makeThread({ goal: activeGoal() }),
      makeThread({
        id: readyThreadId,
        goal: activeGoal(),
        session: {
          threadId: readyThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    ]);
    await harness.offer(sessionSetEvent({ status: "running", sequence: 1 }));
    await harness.offer(sessionSetEvent({ threadId: readyThreadId, status: "ready", sequence: 2 }));
    await waitFor(() => harness.dispatch.mock.calls.length === 1);
    await harness.drain();
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.goal.continue",
        threadId: readyThreadId,
      }),
    );
  });

  it("uses a stable command id for duplicate Session-ready events", async () => {
    const harness = await createHarness([makeThread({ goal: activeGoal() })]);
    await harness.offer(sessionSetEvent({ status: "ready", sequence: 1 }));
    await harness.offer(sessionSetEvent({ status: "ready", sequence: 2 }));
    await waitFor(() => harness.dispatch.mock.calls.length === 2);
    await harness.drain();

    const commandId = CommandId.make(
      goalContinuationCommandId({
        threadId: THREAD_ID,
        goalUpdatedAt: NOW,
        completedTurnId: TURN_ID,
      }),
    );
    expect(harness.dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ commandId }));
    expect(harness.dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({ commandId }));
  });
});
