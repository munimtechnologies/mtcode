import { CommandId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  countTrailingEmptyGoalContinuations,
  EMPTY_GOAL_CONTINUATION_LIMIT,
  goalBlockCommandId,
  goalContinuationCommandId,
} from "@t3tools/shared/goalContinuation";
import * as Cause from "effect/Cause";
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
import { forkParked } from "../../serverActivation.ts";
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
    if (!isThreadIdleForGoal(thread, event.occurredAt)) {
      return;
    }
    const completedTurnId = thread.latestTurn?.turnId;
    if (completedTurnId == null || thread.latestTurn?.state === "running") {
      return;
    }

    if (
      countTrailingEmptyGoalContinuations(thread, event.occurredAt) >= EMPTY_GOAL_CONTINUATION_LIMIT
    ) {
      yield* orchestrationEngine
        .dispatch({
          type: "thread.goal.block",
          commandId: CommandId.make(
            goalBlockCommandId({
              threadId: thread.id,
              goalUpdatedAt: goal.updatedAt,
              completedTurnId,
            }),
          ),
          threadId: thread.id,
        })
        .pipe(
          Effect.catchIf(isIgnorableContinueDispatchError, () => Effect.void),
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.interrupt;
            }
            return Effect.logWarning("goal reactor failed to Block after empty Continuations", {
              threadId: thread.id,
              cause: Cause.pretty(cause),
            });
          }),
        );
      return;
    }

    yield* orchestrationEngine
      .dispatch({
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
      })
      .pipe(
        Effect.catchIf(isIgnorableContinueDispatchError, () => Effect.void),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.interrupt;
          }
          return Effect.logWarning("goal reactor failed to request Continuation", {
            threadId: thread.id,
            cause: Cause.pretty(cause),
          });
        }),
      );
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

  const start: GoalReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.session-set") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies GoalReactorShape;
});

export const GoalReactorLive = Layer.effect(GoalReactor, make);
