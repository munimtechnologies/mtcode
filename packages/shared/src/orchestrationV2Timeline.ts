import {
  MessageId,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  type OrchestrationV2TurnItem,
  type OrchestrationV2UserMessageInputIntent,
  type RunId,
} from "@t3tools/contracts";

type TimelineRun = Pick<OrchestrationV2Run, "id" | "status">;
type TimelineRunAttempt = Pick<OrchestrationV2RunAttempt, "runId" | "rootNodeId" | "status">;
type TimelineTurnItem = Pick<OrchestrationV2TurnItem, "type" | "runId" | "nodeId"> & {
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent;
  readonly messageId?: MessageId;
};

const INTERRUPTED_RUN_CONTINUATION_MESSAGE_PREFIX = "message:interrupted-continuation:";

/**
 * The message the composer's one-tap Continue sends after Stop. It carries the
 * T3-authored continuation prompt to the provider but is not a transcript row:
 * a Continuation has no user message (docs/adr/0005). One id per interrupted
 * run, so a second tap cannot continue the same run twice.
 */
export function interruptedRunContinuationMessageId(runId: RunId): MessageId {
  return MessageId.make(`${INTERRUPTED_RUN_CONTINUATION_MESSAGE_PREFIX}${runId}`);
}

export function isInterruptedRunContinuationMessageId(messageId: string): boolean {
  return messageId.startsWith(INTERRUPTED_RUN_CONTINUATION_MESSAGE_PREFIX);
}

/** Hidden everywhere a timeline is shown, including history a fork inherits. */
export function isOrchestrationV2HiddenContinuationMessage(item: TimelineTurnItem): boolean {
  return (
    item.type === "user_message" &&
    item.messageId !== undefined &&
    isInterruptedRunContinuationMessageId(item.messageId)
  );
}

export function isOrchestrationV2SupersededInterrupt(input: {
  readonly item: TimelineTurnItem;
  readonly attempts: ReadonlyArray<TimelineRunAttempt>;
  readonly items: ReadonlyArray<TimelineTurnItem>;
}): boolean {
  const { item } = input;
  if (item.type !== "run_interrupt_result" || item.runId === null || item.nodeId === null) {
    return false;
  }

  const isSuperseded = input.attempts.some(
    (attempt) =>
      attempt.runId === item.runId &&
      attempt.rootNodeId === item.nodeId &&
      attempt.status === "superseded",
  );
  if (!isSuperseded) {
    return false;
  }

  // Paired stop-then-steer results have a matching request on the same run and
  // must stay visible. Legacy plain-steer results have no request and stay hidden.
  const hasMatchingRequest = input.items.some(
    (candidate) => candidate.type === "run_interrupt_request" && candidate.runId === item.runId,
  );
  return !hasMatchingRequest;
}

export function isOrchestrationV2TurnItemVisible(input: {
  readonly item: TimelineTurnItem;
  readonly runs: ReadonlyArray<TimelineRun>;
  readonly attempts: ReadonlyArray<TimelineRunAttempt>;
  readonly items: ReadonlyArray<TimelineTurnItem>;
}): boolean {
  const { item } = input;
  if (
    item.runId !== null &&
    input.runs.some((run) => run.id === item.runId && run.status === "rolled_back")
  ) {
    return false;
  }

  // A queued message is composer state, not conversation history. When its run
  // is cancelled the input never reached the provider, so it must not surface
  // as a transcript row.
  if (
    item.type === "user_message" &&
    item.inputIntent === "queued_turn" &&
    item.runId !== null &&
    input.runs.some((run) => run.id === item.runId && run.status === "cancelled")
  ) {
    return false;
  }

  if (isOrchestrationV2HiddenContinuationMessage(item)) return false;

  return !isOrchestrationV2SupersededInterrupt({
    item,
    attempts: input.attempts,
    items: input.items,
  });
}

/** Index once when reconciling a whole timeline after run/attempt state changes. */
export function createOrchestrationV2TurnItemVisibility(input: {
  readonly runs: ReadonlyArray<TimelineRun>;
  readonly attempts: ReadonlyArray<TimelineRunAttempt>;
  readonly items: ReadonlyArray<TimelineTurnItem>;
}): (item: TimelineTurnItem) => boolean {
  const statuses = new Map(input.runs.map((run) => [run.id, run.status]));
  const supersededRoots = new Map<
    TimelineRunAttempt["runId"],
    Set<TimelineRunAttempt["rootNodeId"]>
  >();
  for (const attempt of input.attempts) {
    if (attempt.status !== "superseded") continue;
    let roots = supersededRoots.get(attempt.runId);
    if (roots === undefined) supersededRoots.set(attempt.runId, (roots = new Set()));
    roots.add(attempt.rootNodeId);
  }
  const interruptRuns = new Set(
    input.items.filter((item) => item.type === "run_interrupt_request").map((item) => item.runId),
  );
  return (item) => {
    const status = item.runId === null ? undefined : statuses.get(item.runId);
    if (status === "rolled_back") return false;
    if (
      status === "cancelled" &&
      item.type === "user_message" &&
      item.inputIntent === "queued_turn"
    )
      return false;
    if (isOrchestrationV2HiddenContinuationMessage(item)) return false;
    return !(
      item.type === "run_interrupt_result" &&
      item.runId !== null &&
      item.nodeId !== null &&
      supersededRoots.get(item.runId)?.has(item.nodeId) === true &&
      !interruptRuns.has(item.runId)
    );
  };
}
