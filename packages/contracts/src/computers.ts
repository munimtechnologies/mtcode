import { EnvironmentId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ExecutionEnvironmentPlatformOs } from "./environment.ts";
import { ModelSelection, ProviderInteractionMode, RuntimeMode } from "./orchestration.ts";
import * as Schema from "effect/Schema";

export const COMPUTER_SEND_MESSAGE_MAX_CHARS = 8_000;
export const COMPUTER_SEND_TIMEOUT_MS = 45_000;

export const ComputerKind = Schema.Literals(["local", "ssh", "connect", "paired"]);
export type ComputerKind = typeof ComputerKind.Type;

export const ComputerPeer = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  kind: ComputerKind,
  os: ExecutionEnvironmentPlatformOs,
  connected: Schema.Boolean,
  sshTarget: Schema.optional(TrimmedNonEmptyString),
});
export type ComputerPeer = typeof ComputerPeer.Type;

export const ComputerListEntry = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  kind: ComputerKind,
  os: ExecutionEnvironmentPlatformOs,
  connected: Schema.Boolean,
  sshTarget: Schema.optional(TrimmedNonEmptyString),
  thisMachine: Schema.Boolean,
});
export type ComputerListEntry = typeof ComputerListEntry.Type;

export const ComputerTaskClientId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ComputerTaskClientId = typeof ComputerTaskClientId.Type;

export const ComputerTaskConnectionId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ComputerTaskConnectionId = typeof ComputerTaskConnectionId.Type;

export const ComputerTaskHost = Schema.Struct({
  clientId: ComputerTaskClientId,
  computers: Schema.Array(ComputerPeer),
});
export type ComputerTaskHost = typeof ComputerTaskHost.Type;

export const ComputerTaskSource = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  label: TrimmedNonEmptyString,
  projectTitle: TrimmedNonEmptyString,
  projectWorkspaceRoot: TrimmedNonEmptyString,
});
export type ComputerTaskSource = typeof ComputerTaskSource.Type;

export const ComputerTaskSendRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  computer: ComputerPeer,
  message: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  source: ComputerTaskSource,
  projectHint: Schema.NullOr(TrimmedNonEmptyString),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type ComputerTaskSendRequest = typeof ComputerTaskSendRequest.Type;

export const ComputerTaskSendResult = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projectId: ProjectId,
});
export type ComputerTaskSendResult = typeof ComputerTaskSendResult.Type;

export const ComputerTaskStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("connected"),
    connectionId: ComputerTaskConnectionId,
  }),
  Schema.Struct({
    type: Schema.Literal("request"),
    connectionId: ComputerTaskConnectionId,
    request: ComputerTaskSendRequest,
  }),
]);
export type ComputerTaskStreamEvent = typeof ComputerTaskStreamEvent.Type;

export const ComputerTaskErrorCode = Schema.Literals([
  "source_unavailable",
  "computer_not_found",
  "computer_offline",
  "no_client",
  "project_not_found",
  "project_ambiguous",
  "query_failed",
  "dispatch_failed",
]);
export type ComputerTaskErrorCode = typeof ComputerTaskErrorCode.Type;

export class ComputerTaskError extends Schema.TaggedErrorClass<ComputerTaskError>()(
  "ComputerTaskError",
  {
    code: ComputerTaskErrorCode,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ComputerTaskResponse = Schema.Struct({
  clientId: ComputerTaskClientId,
  connectionId: ComputerTaskConnectionId,
  requestId: TrimmedNonEmptyString,
  ok: Schema.Boolean,
  result: Schema.optional(ComputerTaskSendResult),
  error: Schema.optional(
    Schema.Struct({
      code: ComputerTaskErrorCode,
      detail: Schema.String,
    }),
  ),
});
export type ComputerTaskResponse = typeof ComputerTaskResponse.Type;

export const ComputerListResult = Schema.Struct({
  thisEnvironmentId: EnvironmentId,
  computers: Schema.Array(ComputerListEntry),
});
export type ComputerListResult = typeof ComputerListResult.Type;
