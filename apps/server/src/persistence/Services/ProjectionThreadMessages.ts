/**
 * ProjectionThreadMessageRepository - Projection repository interface for messages.
 *
 * Owns persistence operations for projected thread messages rendered in the
 * orchestration read model.
 *
 * @module ProjectionThreadMessageRepository
 */
import {
  ChatAttachment,
  MessageId,
  OrchestrationMessageRole,
  ThreadId,
  TurnId,
  IsoDateTime,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Struct from "effect/Struct";
import type * as Option from "effect/Option";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadMessage = Schema.Struct({
  messageId: MessageId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  originalText: Schema.NullOr(Schema.String),
  correctionTargetMessageId: Schema.NullOr(MessageId),
  correctionReplacementText: Schema.NullOr(Schema.String),
  isStreaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deliveryState: Schema.optional(Schema.Literal("queued")),
});
export type ProjectionThreadMessage = typeof ProjectionThreadMessage.Type;

// A streaming row is always a fresh assistant message: it never carries a
// correction or a queued delivery state, so those fork columns stay at their
// NULL defaults and are not part of the append input.
export const AppendStreamingProjectionThreadMessage = Schema.Struct(
  Struct.omit(ProjectionThreadMessage.fields, [
    "isStreaming",
    "originalText",
    "correctionTargetMessageId",
    "correctionReplacementText",
    "deliveryState",
  ]),
);
export type AppendStreamingProjectionThreadMessage =
  typeof AppendStreamingProjectionThreadMessage.Type;

export const ListProjectionThreadMessagesInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadMessagesInput = typeof ListProjectionThreadMessagesInput.Type;

export const GetProjectionThreadMessageInput = Schema.Struct({
  messageId: MessageId,
});
export type GetProjectionThreadMessageInput = typeof GetProjectionThreadMessageInput.Type;

export const DeleteProjectionThreadMessagesInput = Schema.Struct({
  threadId: ThreadId,
});
export const SetProjectionThreadMessageDeliveryStateInput = Schema.Struct({
  messageId: MessageId,
  deliveryState: Schema.NullOr(Schema.Literal("queued")),
});
export type DeleteProjectionThreadMessagesInput = typeof DeleteProjectionThreadMessagesInput.Type;

/**
 * ProjectionThreadMessageRepositoryShape - Service API for projected thread messages.
 */
export interface ProjectionThreadMessageRepositoryShape {
  /**
   * Insert or replace a projected thread message row.
   *
   * Upserts by `messageId`.
   */
  readonly upsert: (
    message: ProjectionThreadMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Insert a streaming message or append text to its existing row. */
  readonly appendStreaming: (
    message: AppendStreamingProjectionThreadMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected thread message by id.
   */
  readonly getByMessageId: (
    input: GetProjectionThreadMessageInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadMessage>, ProjectionRepositoryError>;

  readonly setDeliveryState: (
    input: typeof SetProjectionThreadMessageDeliveryStateInput.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly deleteByMessageId: (
    input: GetProjectionThreadMessageInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * List projected thread messages for a thread.
   *
   * Returned in ascending creation order.
   */
  readonly listByThreadId: (
    input: ListProjectionThreadMessagesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadMessage>, ProjectionRepositoryError>;

  /** Read the latest user-message timestamp without loading message bodies. */
  readonly getLatestUserMessageAt: (
    input: ListProjectionThreadMessagesInput,
  ) => Effect.Effect<ProjectionThreadMessage["createdAt"] | null, ProjectionRepositoryError>;

  /**
   * Delete projected thread messages by thread.
   */
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadMessagesInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionThreadMessageRepository - Service tag for message projection persistence.
 */
export class ProjectionThreadMessageRepository extends Context.Service<
  ProjectionThreadMessageRepository,
  ProjectionThreadMessageRepositoryShape
>()("t3/persistence/Services/ProjectionThreadMessages/ProjectionThreadMessageRepository") {}
