import { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionQueuedTurn,
  ProjectionQueuedTurnMessageInput,
  ProjectionQueuedTurnRepository,
  type ProjectionQueuedTurnRepositoryShape,
  ProjectionQueuedTurnThreadInput,
} from "../Services/ProjectionQueuedTurns.ts";

const ProjectionQueuedTurnDbRow = Schema.Struct({
  ...ProjectionQueuedTurn.fields,
  modelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionQueuedTurn,
    execute: (row) => sql`
      INSERT INTO projection_thread_turn_queue (
        message_id,
        thread_id,
        event_id,
        command_id,
        model_selection_json,
        title_seed,
        runtime_mode,
        interaction_mode,
        source_proposed_plan_thread_id,
        source_proposed_plan_id,
        queued_at,
        event_sequence,
        status
      ) VALUES (
        ${row.messageId},
        ${row.threadId},
        ${row.eventId},
        ${row.commandId},
        ${row.modelSelection === null ? null : JSON.stringify(row.modelSelection)},
        ${row.titleSeed},
        ${row.runtimeMode},
        ${row.interactionMode},
        ${row.sourceProposedPlanThreadId},
        ${row.sourceProposedPlanId},
        ${row.queuedAt},
        ${row.eventSequence},
        ${row.status}
      )
      ON CONFLICT (message_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        event_id = excluded.event_id,
        command_id = excluded.command_id,
        model_selection_json = excluded.model_selection_json,
        title_seed = excluded.title_seed,
        runtime_mode = excluded.runtime_mode,
        interaction_mode = excluded.interaction_mode,
        source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
        source_proposed_plan_id = excluded.source_proposed_plan_id,
        queued_at = excluded.queued_at,
        event_sequence = excluded.event_sequence,
        status = excluded.status
    `,
  });

  const markReadyRow = SqlSchema.void({
    Request: ProjectionQueuedTurnMessageInput,
    execute: ({ messageId }) => sql`
      UPDATE projection_thread_turn_queue
      SET status = 'ready'
      WHERE message_id = ${messageId}
        AND status = 'queued'
    `,
  });

  const deleteMessageRow = SqlSchema.void({
    Request: ProjectionQueuedTurnMessageInput,
    execute: ({ messageId }) => sql`
      DELETE FROM projection_thread_turn_queue
      WHERE message_id = ${messageId}
    `,
  });

  const deleteReadyThreadRows = SqlSchema.void({
    Request: ProjectionQueuedTurnThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_turn_queue
      WHERE thread_id = ${threadId}
        AND status = 'ready'
    `,
  });

  const deleteThreadRows = SqlSchema.void({
    Request: ProjectionQueuedTurnThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_turn_queue
      WHERE thread_id = ${threadId}
    `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: ProjectionQueuedTurnThreadInput,
    Result: ProjectionQueuedTurnDbRow,
    execute: ({ threadId }) => sql`
      SELECT
        message_id AS "messageId",
        thread_id AS "threadId",
        event_id AS "eventId",
        command_id AS "commandId",
        model_selection_json AS "modelSelection",
        title_seed AS "titleSeed",
        runtime_mode AS "runtimeMode",
        interaction_mode AS "interactionMode",
        source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
        source_proposed_plan_id AS "sourceProposedPlanId",
        queued_at AS "queuedAt",
        event_sequence AS "eventSequence",
        status
      FROM projection_thread_turn_queue
      WHERE thread_id = ${threadId}
      ORDER BY event_sequence ASC
    `,
  });

  const listAllRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionQueuedTurnDbRow,
    execute: () => sql`
      SELECT
        message_id AS "messageId",
        thread_id AS "threadId",
        event_id AS "eventId",
        command_id AS "commandId",
        model_selection_json AS "modelSelection",
        title_seed AS "titleSeed",
        runtime_mode AS "runtimeMode",
        interaction_mode AS "interactionMode",
        source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
        source_proposed_plan_id AS "sourceProposedPlanId",
        queued_at AS "queuedAt",
        event_sequence AS "eventSequence",
        status
      FROM projection_thread_turn_queue
      ORDER BY event_sequence ASC
    `,
  });

  const mapError = (operation: string) =>
    Effect.mapError((cause: unknown) =>
      Schema.isSchemaError(cause)
        ? toPersistenceDecodeError(`${operation}:decode`)(cause)
        : toPersistenceSqlError(operation)(cause),
    );
  const upsert: ProjectionQueuedTurnRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(mapError("ProjectionQueuedTurnRepository.upsert:query"));
  const markReady: ProjectionQueuedTurnRepositoryShape["markReady"] = (input) =>
    markReadyRow(input).pipe(mapError("ProjectionQueuedTurnRepository.markReady:query"));
  const deleteByMessageId: ProjectionQueuedTurnRepositoryShape["deleteByMessageId"] = (input) =>
    deleteMessageRow(input).pipe(
      mapError("ProjectionQueuedTurnRepository.deleteByMessageId:query"),
    );
  const deleteReadyByThreadId: ProjectionQueuedTurnRepositoryShape["deleteReadyByThreadId"] = (
    input,
  ) =>
    deleteReadyThreadRows(input).pipe(
      mapError("ProjectionQueuedTurnRepository.deleteReadyByThreadId:query"),
    );
  const deleteByThreadId: ProjectionQueuedTurnRepositoryShape["deleteByThreadId"] = (input) =>
    deleteThreadRows(input).pipe(mapError("ProjectionQueuedTurnRepository.deleteByThreadId:query"));
  const listByThreadId: ProjectionQueuedTurnRepositoryShape["listByThreadId"] = (input) =>
    listThreadRows(input).pipe(mapError("ProjectionQueuedTurnRepository.listByThreadId:query"));
  const listAll: ProjectionQueuedTurnRepositoryShape["listAll"] = listAllRows(undefined).pipe(
    mapError("ProjectionQueuedTurnRepository.listAll:query"),
  );

  return {
    upsert,
    markReady,
    deleteByMessageId,
    deleteReadyByThreadId,
    deleteByThreadId,
    listByThreadId,
    listAll,
  } satisfies ProjectionQueuedTurnRepositoryShape;
});

export const ProjectionQueuedTurnRepositoryLive = Layer.effect(
  ProjectionQueuedTurnRepository,
  make,
);
