import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChatAttachment } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  AppendStreamingProjectionThreadMessage,
  GetProjectionThreadMessageInput,
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessageRepositoryShape,
  DeleteProjectionThreadMessagesInput,
  ListProjectionThreadMessagesInput,
  ProjectionThreadMessage,
  SetProjectionThreadMessageDeliveryStateInput,
} from "../Services/ProjectionThreadMessages.ts";

const ProjectionThreadMessageDbRowSchema = Schema.Struct({
  ...ProjectionThreadMessage.fields,
  isStreaming: Schema.Number,
  attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  deliveryState: Schema.NullOr(Schema.Literal("queued")),
});

function toProjectionThreadMessage(
  row: Schema.Schema.Type<typeof ProjectionThreadMessageDbRowSchema>,
): ProjectionThreadMessage {
  return {
    messageId: row.messageId,
    threadId: row.threadId,
    turnId: row.turnId,
    role: row.role,
    text: row.text,
    originalText: row.originalText,
    correctionTargetMessageId: row.correctionTargetMessageId,
    correctionReplacementText: row.correctionReplacementText,
    isStreaming: row.isStreaming === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
    ...(row.deliveryState !== null ? { deliveryState: row.deliveryState } : {}),
  };
}

const makeProjectionThreadMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadMessageRow = SqlSchema.void({
    Request: ProjectionThreadMessage,
    execute: (row) => {
      const nextAttachmentsJson =
        row.attachments !== undefined ? JSON.stringify(row.attachments) : null;
      return sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          original_text,
          correction_target_message_id,
          correction_replacement_text,
          is_streaming,
          delivery_state,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          COALESCE(
            ${nextAttachmentsJson},
            (
              SELECT attachments_json
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          ${row.originalText},
          ${row.correctionTargetMessageId},
          ${row.correctionReplacementText},
          ${row.isStreaming ? 1 : 0},
          COALESCE(
            ${row.deliveryState ?? null},
            (
              SELECT delivery_state
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_messages.attachments_json
          ),
          original_text = excluded.original_text,
          correction_target_message_id = excluded.correction_target_message_id,
          correction_replacement_text = excluded.correction_replacement_text,
          is_streaming = excluded.is_streaming,
          delivery_state = COALESCE(
            excluded.delivery_state,
            projection_thread_messages.delivery_state
          ),
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
  });

  const appendStreamingProjectionThreadMessageRow = SqlSchema.void({
    Request: AppendStreamingProjectionThreadMessage,
    execute: (row) => {
      const nextAttachmentsJson =
        row.attachments !== undefined ? JSON.stringify(row.attachments) : null;
      return sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          ${nextAttachmentsJson},
          1,
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = projection_thread_messages.text || excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_messages.attachments_json
          ),
          is_streaming = 1,
          updated_at = excluded.updated_at
      `;
    },
  });

  const getProjectionThreadMessageRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadMessageInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ messageId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          original_text AS "originalText",
          correction_target_message_id AS "correctionTargetMessageId",
          correction_replacement_text AS "correctionReplacementText",
          is_streaming AS "isStreaming",
          delivery_state AS "deliveryState",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE message_id = ${messageId}
        LIMIT 1
      `,
  });

  const listProjectionThreadMessageRows = SqlSchema.findAll({
    Request: ListProjectionThreadMessagesInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          original_text AS "originalText",
          correction_target_message_id AS "correctionTargetMessageId",
          correction_replacement_text AS "correctionReplacementText",
          is_streaming AS "isStreaming",
          delivery_state AS "deliveryState",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const getLatestUserMessageAtRow = SqlSchema.findOne({
    Request: ListProjectionThreadMessagesInput,
    Result: Schema.Struct({
      latestUserMessageAt: Schema.NullOr(ProjectionThreadMessage.fields.createdAt),
    }),
    execute: ({ threadId }) => sql`
      SELECT MAX(created_at) AS "latestUserMessageAt"
      FROM projection_thread_messages
      WHERE thread_id = ${threadId} AND role = 'user'
        AND message_id NOT GLOB 'import:*'
    `,
  });

  const deleteProjectionThreadMessageRows = SqlSchema.void({
    Request: DeleteProjectionThreadMessagesInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_messages
        WHERE thread_id = ${threadId}
      `,
  });

  const setProjectionThreadMessageDeliveryState = SqlSchema.void({
    Request: SetProjectionThreadMessageDeliveryStateInput,
    execute: ({ messageId, deliveryState }) => sql`
      UPDATE projection_thread_messages
      SET delivery_state = ${deliveryState}
      WHERE message_id = ${messageId}
    `,
  });

  const deleteProjectionThreadMessageRow = SqlSchema.void({
    Request: GetProjectionThreadMessageInput,
    execute: ({ messageId }) => sql`
      DELETE FROM projection_thread_messages
      WHERE message_id = ${messageId}
    `,
  });

  const upsert: ProjectionThreadMessageRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadMessageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.upsert:query")),
    );

  const appendStreaming: ProjectionThreadMessageRepositoryShape["appendStreaming"] = (row) =>
    appendStreamingProjectionThreadMessageRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.appendStreaming:query"),
      ),
    );

  const getByMessageId: ProjectionThreadMessageRepositoryShape["getByMessageId"] = (input) =>
    getProjectionThreadMessageRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.getByMessageId:query"),
      ),
      Effect.map(Option.map(toProjectionThreadMessage)),
    );

  const listByThreadId: ProjectionThreadMessageRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.listByThreadId:query"),
      ),
      Effect.map((rows) => rows.map(toProjectionThreadMessage)),
    );

  const setDeliveryState: ProjectionThreadMessageRepositoryShape["setDeliveryState"] = (input) =>
    setProjectionThreadMessageDeliveryState(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.setDeliveryState:query"),
      ),
    );

  const deleteByMessageId: ProjectionThreadMessageRepositoryShape["deleteByMessageId"] = (input) =>
    deleteProjectionThreadMessageRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.deleteByMessageId:query"),
      ),
    );

  const getLatestUserMessageAt: ProjectionThreadMessageRepositoryShape["getLatestUserMessageAt"] = (
    input,
  ) =>
    getLatestUserMessageAtRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.getLatestUserMessageAt:query"),
      ),
      Effect.map((row) => row.latestUserMessageAt),
    );

  const deleteByThreadId: ProjectionThreadMessageRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    appendStreaming,
    getByMessageId,
    setDeliveryState,
    deleteByMessageId,
    listByThreadId,
    getLatestUserMessageAt,
    deleteByThreadId,
  } satisfies ProjectionThreadMessageRepositoryShape;
});

export const ProjectionThreadMessageRepositoryLive = Layer.effect(
  ProjectionThreadMessageRepository,
  makeProjectionThreadMessageRepository,
);
