/**
 * MT Code fork-only orchestration RPC contracts that have no upstream
 * equivalent in the orchestration-v2 rewrite: on-demand provider agent
 * history (take #11138). These schemas lived in the old `orchestration.ts`,
 * which upstream deleted with the new orchestrator (de34391427). The fork's
 * Claude Code / Codex conversation import was dropped for upstream's
 * `agentSessions.*` importer.
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** WebSocket method names kept on the `orchestration.*` namespace for wire compatibility. */
export const MT_ORCHESTRATION_WS_METHODS = {
  getAgentHistory: "orchestration.getAgentHistory",
} as const;

/** Provider history is read on demand, independently of retained thread activities. */
export const OrchestrationGetAgentHistoryInput = Schema.Struct({
  threadId: ThreadId,
  agentId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  offset: NonNegativeInt,
  view: Schema.optional(Schema.Literals(["recent-tools", "latest"])),
});
export type OrchestrationGetAgentHistoryInput = typeof OrchestrationGetAgentHistoryInput.Type;

export const AgentHistoryEntry = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["tool", "file-edit", "assistant", "user", "reasoning"]),
  title: Schema.String.check(Schema.isMaxLength(500)),
  detail: Schema.String.check(Schema.isMaxLength(8000)),
  truncated: Schema.Boolean,
});
export type AgentHistoryEntry = typeof AgentHistoryEntry.Type;

export const OrchestrationGetAgentHistoryResult = Schema.Struct({
  status: Schema.Literals(["ready", "unavailable", "unsupported"]),
  entries: Schema.Array(AgentHistoryEntry).check(Schema.isMaxLength(50)),
  nextOffset: Schema.NullOr(NonNegativeInt),
  startOffset: Schema.optional(NonNegativeInt),
  message: Schema.NullOr(Schema.String),
});
export type OrchestrationGetAgentHistoryResult = typeof OrchestrationGetAgentHistoryResult.Type;

export class OrchestrationGetAgentHistoryError extends Schema.TaggedError<OrchestrationGetAgentHistoryError>()(
  "OrchestrationGetAgentHistoryError",
  { message: Schema.String },
) {}

export const MtOrchestrationRpcSchemas = {
  getAgentHistory: {
    input: OrchestrationGetAgentHistoryInput,
    output: OrchestrationGetAgentHistoryResult,
  },
} as const;
