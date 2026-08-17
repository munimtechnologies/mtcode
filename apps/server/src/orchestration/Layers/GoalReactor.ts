import {
  CommandId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  countTrailingEmptyGoalContinuations,
  EMPTY_GOAL_CONTINUATION_LIMIT,
  goalBlockCommandId,
  goalContinuationCommandId,
} from "@t3tools/shared/goalContinuation";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { hasOpenBlockingRequest, isThreadIdleForGoal } from "../decider.ts";
import {
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
} from "../Errors.ts";
import { forkParked, ServerActivation } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { GoalReactor, type GoalReactorShape } from "../Services/GoalReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

type SessionSetEvent = Extract<OrchestrationEvent, { type: "thread.session-set" }>;

const isIgnorableContinueDispatchError = (error: unknown): boolean =>
  Schema.is(OrchestrationCommandInvariantError)(error) ||
  Schema.is(OrchestrationCommandPreviouslyRejectedError)(error);

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  // Layer construction happens at process boot, so a Session last touched
  // before this timestamp belongs to a previous, now-dead process.
  const processStartedAtMs = yield* Clock.currentTimeMillis;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const dispatchGoalCommand = Effect.fn("dispatchGoalCommand")(function* (
    command: Parameters<typeof orchestrationEngine.dispatch>[0],
    warning: string,
    threadId: string,
  ) {
    yield* orchestrationEngine.dispatch(command).pipe(
      Effect.catchIf(isIgnorableContinueDispatchError, () => Effect.void),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(warning, {
          threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );
  });

  const evaluateGoalContinuation = Effect.fn("evaluateGoalContinuation")(function* (
    thread: OrchestrationThread,
    occurredAt: string,
  ) {
    const goal = thread.goal;
    if (goal?.status !== "active") {
      return;
    }
    if (thread.interactionMode === "plan") {
      return;
    }
    if (hasOpenBlockingRequest(thread)) {
      return;
    }
    if (!isThreadIdleForGoal(thread, occurredAt)) {
      return;
    }
    const completedTurnId = thread.latestTurn?.turnId;
    if (completedTurnId == null || thread.latestTurn?.state === "running") {
      return;
    }

    if (countTrailingEmptyGoalContinuations(thread, occurredAt) >= EMPTY_GOAL_CONTINUATION_LIMIT) {
      yield* dispatchGoalCommand(
        {
          type: "thread.goal.block",
          commandId: CommandId.make(
            goalBlockCommandId({
              threadId: thread.id,
              goalUpdatedAt: goal.updatedAt,
              completedTurnId,
            }),
          ),
          threadId: thread.id,
        },
        "goal reactor failed to Block after empty Continuations",
        thread.id,
      );
      return;
    }

    yield* dispatchGoalCommand(
      {
        type: "thread.goal.continue",
        commandId: CommandId.make(
          goalContinuationCommandId({
            threadId: thread.id,
            goalUpdatedAt: goal.updatedAt,
            completedTurnId,
          }),
        ),
        threadId: thread.id,
        completedTurnId,
      },
      "goal reactor failed to request Continuation",
      thread.id,
    );
  });

  const processSessionSet = Effect.fn("processSessionSet")(function* (event: SessionSetEvent) {
    if (event.payload.session.status !== "ready") {
      return;
    }

    const thread = yield* projectionSnapshotQuery
      .getThreadDetailById(event.payload.threadId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!thread) {
      return;
    }
    yield* evaluateGoalContinuation(thread, event.occurredAt);
  });

  const processSessionSetSafely = (event: SessionSetEvent) =>
    processSessionSet(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning("goal reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processSessionSetSafely);

  // A Turn that was running when the previous process exited never receives
  // the session-set that ends it, so it reads "running" forever and an Active
  // Goal on the thread wedges: no continuation fires and the idle guard keeps
  // rejecting new ones. Settle the phantom Turn, then resume the Goal.
  const resumeInterruptedGoalThread = Effect.fn("resumeInterruptedGoalThread")(function* (
    shell: OrchestrationThreadShell,
  ) {
    const latestTurn = shell.latestTurn;
    if (shell.goal?.status !== "active" || latestTurn?.state !== "running") {
      return;
    }
    if (shell.session !== null && Date.parse(shell.session.updatedAt) >= processStartedAtMs) {
      return;
    }
    const occurredAt = yield* nowIso;
    yield* dispatchGoalCommand(
      {
        type: "thread.session.set",
        commandId: CommandId.make(`goal-restart-settle:${shell.id}:${latestTurn.turnId}`),
        threadId: shell.id,
        session: {
          threadId: shell.id,
          status: "interrupted",
          providerName: shell.session?.providerName ?? null,
          ...(shell.session?.providerInstanceId !== undefined
            ? { providerInstanceId: shell.session.providerInstanceId }
            : {}),
          runtimeMode: shell.session?.runtimeMode ?? shell.runtimeMode,
          activeTurnId: null,
          lastError: shell.session?.lastError ?? null,
          updatedAt: occurredAt,
        },
        createdAt: occurredAt,
      },
      "goal reactor failed to settle a Turn orphaned by restart",
      shell.id,
    );
    yield* Effect.logInfo("goal reactor settled a Turn orphaned by restart", {
      threadId: shell.id,
      turnId: latestTurn.turnId,
    });

    const thread = yield* projectionSnapshotQuery
      .getThreadDetailById(shell.id)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!thread) {
      return;
    }
    // The SQLite projection may not have consumed the settle yet, so evaluate
    // against the state the settle produces rather than the stale read.
    yield* evaluateGoalContinuation(
      {
        ...thread,
        latestTurn:
          thread.latestTurn !== null && thread.latestTurn.turnId === latestTurn.turnId
            ? { ...thread.latestTurn, state: "interrupted", completedAt: occurredAt }
            : thread.latestTurn,
        session:
          thread.session !== null
            ? { ...thread.session, status: "interrupted", activeTurnId: null }
            : thread.session,
      },
      occurredAt,
    );
  });

  const resumeInterruptedGoals = Effect.gen(function* () {
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    yield* Effect.forEach(snapshot.threads, resumeInterruptedGoalThread, {
      discard: true,
    });
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.interrupt;
      }
      return Effect.logWarning("goal reactor failed to resume Goals after restart", {
        cause: Cause.pretty(cause),
      });
    }),
  );

  const start: GoalReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.session-set") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
    const activation = yield* ServerActivation;
    if (activation === undefined) {
      yield* resumeInterruptedGoals;
    } else {
      yield* forkParked(resumeInterruptedGoals);
    }
  });

  return {
    start,
    drain: worker.drain,
  } satisfies GoalReactorShape;
});

export const GoalReactorLive = Layer.effect(GoalReactor, make);
