/**
 * TurnWatchdogService - in-memory per-thread stall detection for active turns.
 *
 * Complements ProviderSessionReaper (which reaps IDLE sessions and explicitly
 * skips active turns): the watchdog watches ACTIVE turns. A turn is "watched"
 * from thread.turn-start-requested until the runtime settles it
 * (turn.completed / turn.aborted / session.exited). Every provider runtime
 * event for the thread bumps the activity clock; when a watched turn goes
 * silent past the stall threshold the sweep reports it once so the reactor
 * can surface a warning activity, and past the (optional) hung threshold it
 * reports it once so the reactor can recover by interrupting the turn.
 *
 * Turns legitimately go quiet while a blocking request (tool approval or
 * user-input question) waits on the human, so request.opened /
 * user-input.requested pause the clock and the matching resolutions restart
 * it. Like ThreadBackgroundLiveness, state is in-memory only: after a server
 * restart nothing is watched until new turn-start events arrive, which
 * matches reality because orphaned turns are settled by the startup
 * reconciler.
 *
 * @module TurnWatchdogService
 */
import type { ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type TurnWatchdogFindingKind = "stalled" | "hung";

export interface TurnWatchdogFinding {
  readonly kind: TurnWatchdogFindingKind;
  readonly threadId: ThreadId;
  /** Null until the runtime's turn.started reveals the turn id. */
  readonly turnId: TurnId | null;
  readonly silentForMs: number;
  readonly lastActivityAtMs: number;
}

export interface TurnWatchdogConfig {
  /** Silence on a watched turn before it is reported as stalled. */
  readonly stallThresholdMs: number;
  /**
   * Silence before the turn is reported as hung (recovery candidate).
   * Null disables hung findings entirely (surface-only watchdog).
   */
  readonly hungThresholdMs: number | null;
}

interface WatchedTurnState {
  turnId: TurnId | null;
  lastActivityAtMs: number;
  stallReported: boolean;
  hungReported: boolean;
  /** Open blocking requests (approvals / user-input) pause the clock. */
  readonly openRequestIds: Set<string>;
}

export class TurnWatchdogService extends Context.Service<
  TurnWatchdogService,
  {
    /**
     * Begin (or restart) watching a thread's turn. Called for both the
     * domain thread.turn-start-requested event (turnId unknown yet) and the
     * runtime turn.started event (authoritative turnId). Restarting resets
     * the activity clock and reported flags; open blocking requests carry
     * over because a queued follow-up turn cannot begin while one is open.
     */
    readonly recordTurnStarted: (input: {
      readonly threadId: ThreadId;
      readonly turnId?: TurnId | undefined;
      readonly atMs: number;
    }) => void;

    /**
     * Any provider runtime event for a watched thread proves the provider is
     * alive. Also clears a previously reported stall so a NEW stall on the
     * same turn is reported again.
     */
    readonly recordActivity: (input: {
      readonly threadId: ThreadId;
      readonly atMs: number;
    }) => void;

    /** request.opened / user-input.requested — waiting on the human. */
    readonly recordBlockingRequestOpened: (input: {
      readonly threadId: ThreadId;
      readonly requestId: string;
    }) => void;

    /** request.resolved / user-input.resolved — clock restarts from now. */
    readonly recordBlockingRequestResolved: (input: {
      readonly threadId: ThreadId;
      readonly requestId: string;
      readonly atMs: number;
    }) => void;

    /** turn.completed / turn.aborted — the turn is no longer watched. */
    readonly recordTurnSettled: (threadId: ThreadId) => void;

    /** session.exited — session death settles everything for the thread. */
    readonly clearThread: (threadId: ThreadId) => void;

    /**
     * Report watched turns that crossed a threshold. Each turn reports
     * "stalled" at most once per silent stretch and "hung" at most once per
     * turn; a hung finding implies the stall was already reported or is
     * superseded. Threads with open blocking requests are skipped.
     */
    readonly sweep: (
      nowMs: number,
      config: TurnWatchdogConfig,
    ) => ReadonlyArray<TurnWatchdogFinding>;
  }
>()("t3/orchestration/TurnWatchdog/TurnWatchdogService") {}

export function make(): TurnWatchdogService["Service"] {
  const watchedByThreadId = new Map<ThreadId, WatchedTurnState>();

  return {
    recordTurnStarted: (input) => {
      const existing = watchedByThreadId.get(input.threadId);
      // The runtime's turn.started for the turn we are already watching must
      // not reset the reported flags (it is not new activity evidence beyond
      // the activity bump the ingestion hook already applies).
      if (existing && input.turnId !== undefined && existing.turnId === input.turnId) {
        existing.lastActivityAtMs = Math.max(existing.lastActivityAtMs, input.atMs);
        return;
      }
      // A turn.started following a turn-start-requested names the same turn:
      // adopt the id instead of restarting the watch.
      if (existing && existing.turnId === null && input.turnId !== undefined) {
        existing.turnId = input.turnId;
        existing.lastActivityAtMs = Math.max(existing.lastActivityAtMs, input.atMs);
        return;
      }
      watchedByThreadId.set(input.threadId, {
        turnId: input.turnId ?? null,
        lastActivityAtMs: input.atMs,
        stallReported: false,
        hungReported: false,
        openRequestIds: existing?.openRequestIds ?? new Set(),
      });
    },

    recordActivity: (input) => {
      const state = watchedByThreadId.get(input.threadId);
      if (!state) {
        return;
      }
      state.lastActivityAtMs = Math.max(state.lastActivityAtMs, input.atMs);
      // The provider recovered on its own: a later stall is a new incident.
      state.stallReported = false;
    },

    recordBlockingRequestOpened: (input) => {
      const state = watchedByThreadId.get(input.threadId);
      if (!state) {
        return;
      }
      state.openRequestIds.add(input.requestId);
    },

    recordBlockingRequestResolved: (input) => {
      const state = watchedByThreadId.get(input.threadId);
      if (!state) {
        return;
      }
      state.openRequestIds.delete(input.requestId);
      state.lastActivityAtMs = Math.max(state.lastActivityAtMs, input.atMs);
      state.stallReported = false;
    },

    recordTurnSettled: (threadId) => {
      watchedByThreadId.delete(threadId);
    },

    clearThread: (threadId) => {
      watchedByThreadId.delete(threadId);
    },

    sweep: (nowMs, config) => {
      const findings: Array<TurnWatchdogFinding> = [];
      for (const [threadId, state] of watchedByThreadId) {
        if (state.openRequestIds.size > 0) {
          continue;
        }
        const silentForMs = nowMs - state.lastActivityAtMs;
        if (
          config.hungThresholdMs !== null &&
          silentForMs >= config.hungThresholdMs &&
          !state.hungReported
        ) {
          state.hungReported = true;
          state.stallReported = true;
          findings.push({
            kind: "hung",
            threadId,
            turnId: state.turnId,
            silentForMs,
            lastActivityAtMs: state.lastActivityAtMs,
          });
          continue;
        }
        if (silentForMs >= config.stallThresholdMs && !state.stallReported) {
          state.stallReported = true;
          findings.push({
            kind: "stalled",
            threadId,
            turnId: state.turnId,
            silentForMs,
            lastActivityAtMs: state.lastActivityAtMs,
          });
        }
      }
      return findings;
    },
  };
}

export const layer = Layer.effect(TurnWatchdogService, Effect.sync(make));
