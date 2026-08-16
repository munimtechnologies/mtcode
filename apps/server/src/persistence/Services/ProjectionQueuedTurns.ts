import {
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  OrchestrationProposedPlanId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionQueuedTurnStatus = Schema.Literals(["queued", "ready"]);

export const ProjectionQueuedTurn = Schema.Struct({
  messageId: MessageId,
  threadId: ThreadId,
  eventId: EventId,
  commandId: CommandId,
  modelSelection: Schema.NullOr(ModelSelection),
  titleSeed: Schema.NullOr(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  queuedAt: IsoDateTime,
  eventSequence: NonNegativeInt,
  status: ProjectionQueuedTurnStatus,
});
export type ProjectionQueuedTurn = typeof ProjectionQueuedTurn.Type;

export const ProjectionQueuedTurnMessageInput = Schema.Struct({
  messageId: MessageId,
});
export const ProjectionQueuedTurnThreadInput = Schema.Struct({
  threadId: ThreadId,
});

export interface ProjectionQueuedTurnRepositoryShape {
  readonly upsert: (row: ProjectionQueuedTurn) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly markReady: (
    input: typeof ProjectionQueuedTurnMessageInput.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByMessageId: (
    input: typeof ProjectionQueuedTurnMessageInput.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteReadyByThreadId: (
    input: typeof ProjectionQueuedTurnThreadInput.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: typeof ProjectionQueuedTurnThreadInput.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: typeof ProjectionQueuedTurnThreadInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionQueuedTurn>, ProjectionRepositoryError>;
  readonly listAll: Effect.Effect<ReadonlyArray<ProjectionQueuedTurn>, ProjectionRepositoryError>;
}

export class ProjectionQueuedTurnRepository extends Context.Service<
  ProjectionQueuedTurnRepository,
  ProjectionQueuedTurnRepositoryShape
>()("t3/persistence/Services/ProjectionQueuedTurns/ProjectionQueuedTurnRepository") {}
