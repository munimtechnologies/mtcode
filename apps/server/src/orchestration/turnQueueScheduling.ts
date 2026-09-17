export interface SchedulableQueuedTurn {
  readonly scheduledFor: string | null;
}

/** A queued turn is due once its scheduled instant has passed; unscheduled turns are always due. */
export function isQueuedTurnDue(turn: SchedulableQueuedTurn, nowMs: number): boolean {
  if (turn.scheduledFor === null) return true;
  const scheduledForMs = Date.parse(turn.scheduledFor);
  // Invalid persisted data must not wedge the rest of a thread's queue.
  return !Number.isFinite(scheduledForMs) || scheduledForMs <= nowMs;
}

/** First due turn in queue order. Undue scheduled turns do not block the ones behind them. */
export function findNextDueQueuedTurn<T extends SchedulableQueuedTurn>(
  turns: ReadonlyArray<T>,
  nowMs: number,
): T | undefined {
  return turns.find((turn) => isQueuedTurnDue(turn, nowMs));
}

/** Earliest future release instant among the queue, or null when nothing is waiting on time. */
export function nextQueuedTurnWakeMs(
  turns: ReadonlyArray<SchedulableQueuedTurn>,
  nowMs: number,
): number | null {
  let wakeMs: number | null = null;
  for (const turn of turns) {
    if (turn.scheduledFor === null) continue;
    const scheduledForMs = Date.parse(turn.scheduledFor);
    if (!Number.isFinite(scheduledForMs) || scheduledForMs <= nowMs) continue;
    if (wakeMs === null || scheduledForMs < wakeMs) wakeMs = scheduledForMs;
  }
  return wakeMs;
}
