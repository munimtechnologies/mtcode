import type { MessageId } from "@t3tools/contracts";

import type { TimelineEntry } from "../../session-logic";

/**
 * Edit the thread's last user message in place (MT Code fork, first shipped as
 * PR #7237 on the old engine). On orchestration-v2 it is built from upstream
 * primitives: saving rolls the thread back to before the message
 * (`checkpoint.rollback`, keeping files) and sends the edited text as a new
 * message. No server command is involved.
 */

// Text T3 adds around what the user typed. The editor shows only the typed
// part and re-wraps the edit in the same prefix and suffix.
const T3_PROMPT_PREFIXES = ["Ultrathink:\n"] as const;
const STRUCTURED_CONTEXT_BOUNDARY =
  /(?:^|\n\n)(?=<(?:terminal_context|element_context|preview_annotation|review_comment)(?:\s|>))/u;
const LEADING_REVIEW_COMMENT_EDITABLE =
  /^(<review_comment\b[^>]*>\s*)([\s\S]*?)(\n(`{3,})[^\n]*\n[\s\S]*?\n\4\n<\/review_comment>)([\s\S]*)$/u;

export interface EditableUserMessageParts {
  readonly prefix: string;
  readonly editableText: string;
  readonly suffix: string;
}

export function splitEditableUserMessage(messageText: string): EditableUserMessageParts {
  const prefix = T3_PROMPT_PREFIXES.find((candidate) => messageText.startsWith(candidate)) ?? "";
  const withoutPrefix = messageText.slice(prefix.length);
  const leadingReviewComment = LEADING_REVIEW_COMMENT_EDITABLE.exec(withoutPrefix);
  if (leadingReviewComment !== null) {
    return {
      prefix: `${prefix}${leadingReviewComment[1] ?? ""}`,
      editableText: leadingReviewComment[2] ?? "",
      suffix: `${leadingReviewComment[3] ?? ""}${leadingReviewComment[5] ?? ""}`,
    };
  }
  const boundary = STRUCTURED_CONTEXT_BOUNDARY.exec(withoutPrefix);
  const suffixStart = boundary?.index ?? withoutPrefix.length;
  return {
    prefix,
    editableText: withoutPrefix.slice(0, suffixStart),
    suffix: withoutPrefix.slice(suffixStart),
  };
}

export function replaceEditableUserText(messageText: string, replacementText: string): string {
  const parts = splitEditableUserMessage(messageText);
  const contextSeparator =
    parts.editableText.length === 0 && parts.suffix.length > 0 && !parts.suffix.startsWith("\n")
      ? "\n\n"
      : "";
  return `${parts.prefix}${replacementText.trim()}${contextSeparator}${parts.suffix}`;
}

/**
 * The one user message the timeline offers to edit: the last user message,
 * when the user wrote it and it already started a run. The row adds that the
 * run has a checkpoint to roll back to, and disables the action while the
 * thread is working, like "Edit from here".
 */
export function deriveEditableUserMessageId(
  timelineEntries: ReadonlyArray<TimelineEntry>,
): MessageId | null {
  const last = timelineEntries.findLast(
    (entry) => entry.kind === "message" && entry.message.role === "user",
  );
  if (last?.kind !== "message") return null;
  const { message } = last;
  if (message.runId === null) return null;
  if (message.createdBy !== undefined && message.createdBy !== "user") return null;
  return message.id;
}

export interface OptimisticMessageEdit {
  readonly messageId: MessageId;
  readonly text: string;
}

/** Shows the edited text in the original bubble while the rollback runs. */
export function applyOptimisticMessageEdit(
  entries: ReadonlyArray<TimelineEntry>,
  edit: OptimisticMessageEdit | null,
): ReadonlyArray<TimelineEntry> {
  if (edit === null) return entries;
  return entries.map((entry) =>
    entry.kind === "message" && entry.message.id === edit.messageId
      ? { ...entry, message: { ...entry.message, text: edit.text } }
      : entry,
  );
}
