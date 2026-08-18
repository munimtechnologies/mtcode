/**
 * TurnWatchdogReactorLive - background sweeper over the TurnWatchdogService
 * registry.
 *
 * Two failure modes leave a thread stuck in `running` with no recourse today:
 * ProviderCommandReactor forks `providerService.sendTurn` fire-and-forget (a
 * hung sendTurn never resolves), and the strict lifecycle guard drops a
 * `turn.completed` whose turnId conflicts with the active turn. The watchdog
 * catches both by watching for runtime-event silence while a turn is active.
 *
 * On each sweep, a finding is first cross-checked against the projection: if
 * the thread's session is no longer starting/running the watch entry is
 * stale (the turn settled through a path that emitted no runtime event, e.g.
 * a spawn failure settling the session via thread.session.set) and is
 * dropped instead of surfaced.
 *
 * - "stalled" findings append a warning activity to the thread transcript.
 * - "hung" findings (opt-in) additionally dispatch thread.turn.interrupt so
 *   the session settles and queued work can proceed.
 *
 * Configuration comes from options (tests) or environment variables:
 * - T3CODE_TURN_WATCHDOG=0 disables the watchdog entirely.
 * - T3CODE_TURN_WATCHDOG_STALL_SECONDS overrides the stall threshold
 *   (default 300).
 * - T3CODE_TURN_WATCHDOG_INTERRUPT_SECONDS enables hung-turn recovery after
 *   that much silence (disabled by default).
 *
 * @module TurnWatchdogReactorLive
 */
import { CommandId, EventId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  TurnWatchdogReactor,
  type TurnWatchdogReactorShape,
} from "../Services/TurnWatchdogReactor.ts";
import { TurnWatchdogService, type TurnWatchdogFinding } from "../TurnWatchdog.ts";

const DEFAULT_STALL_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 30 * 1000;

export interface TurnWatchdogReactorLiveOptions {
  readonly enabled?: boolean;
  readonly stallThresholdMs?: number;
  /** Null (default) disables hung-turn recovery. */
  readonly hungThresholdMs?: number | null;
  readonly sweepIntervalMs?: number;
}

function envSeconds(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : null;
}

function formatSilence(silentForMs: number): string {
  const totalSeconds = Math.max(1, Math.round(silentForMs / 1000));
  if (totalSeconds < 120) {
    return `${totalSeconds}s`;
  }
  return `${Math.round(totalSeconds / 60)}m`;
}

const makeTurnWatchdogReactor = (options?: TurnWatchdogReactorLiveOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const turnWatchdog = yield* TurnWatchdogService;

    const enabled = options?.enabled ?? process.env.T3CODE_TURN_WATCHDOG !== "0";
    const stallThresholdMs = Math.max(
      1,
      options?.stallThresholdMs ??
        envSeconds("T3CODE_TURN_WATCHDOG_STALL_SECONDS") ??
        DEFAULT_STALL_THRESHOLD_MS,
    );
    const hungThresholdMs =
      options?.hungThresholdMs !== undefined
        ? options.hungThresholdMs
        : envSeconds("T3CODE_TURN_WATCHDOG_INTERRUPT_SECONDS");
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

    const dispatchWatchdogCommand = Effect.fn("dispatchWatchdogCommand")(function* (
      command: Parameters<typeof orchestrationEngine.dispatch>[0],
      warning: string,
      threadId: string,
    ) {
      yield* orchestrationEngine.dispatch(command).pipe(
        // Duplicate sweeps re-dispatch stable command ids by design; only
        // unexpected failures are worth a warning.
        Effect.catchTags({
          OrchestrationCommandInvariantError: () => Effect.void,
          OrchestrationCommandPreviouslyRejectedError: () => Effect.void,
        }),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.interrupt;
          }
          return Effect.logWarning(warning, {
            threadId,
            cause: Cause.pretty(cause),
          });
        }),
      );
    });

    const appendWatchdogActivity = Effect.fn("appendWatchdogActivity")(function* (
      finding: TurnWatchdogFinding,
      kind: "turn.watchdog.stalled" | "turn.watchdog.interrupted",
      summary: string,
    ) {
      const createdAt = yield* nowIso;
      const markerId = `${kind}:${finding.threadId}:${finding.turnId ?? "pending"}:${finding.lastActivityAtMs}`;
      yield* dispatchWatchdogCommand(
        {
          type: "thread.activity.append",
          commandId: CommandId.make(markerId),
          threadId: finding.threadId,
          activity: {
            id: EventId.make(markerId),
            tone: "error",
            kind,
            summary,
            payload: {
              silentForMs: finding.silentForMs,
              stallThresholdMs,
              hungThresholdMs,
              lastActivityAtMs: finding.lastActivityAtMs,
            },
            turnId: finding.turnId,
            createdAt,
          },
          createdAt,
        },
        "turn watchdog failed to append activity",
        finding.threadId,
      );
    });

    const handleFinding = Effect.fn("handleTurnWatchdogFinding")(function* (
      finding: TurnWatchdogFinding,
    ) {
      // Cross-check the projection: a turn can settle through paths that
      // emit no provider runtime event (spawn failure, session.set by the
      // startup reconciler). Drop stale watches instead of surfacing them.
      const thread = yield* projectionSnapshotQuery.getThreadShellById(finding.threadId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.catch(() => Effect.succeed(undefined)),
      );
      const sessionStatus = thread?.session?.status;
      const turnStillActive = sessionStatus === "starting" || sessionStatus === "running";
      if (!turnStillActive) {
        turnWatchdog.recordTurnSettled(finding.threadId);
        return;
      }

      const silence = formatSilence(finding.silentForMs);
      if (finding.kind === "stalled") {
        yield* Effect.logWarning("turn.watchdog.stalled", {
          threadId: finding.threadId,
          turnId: finding.turnId,
          silentForMs: finding.silentForMs,
        });
        yield* appendWatchdogActivity(
          finding,
          "turn.watchdog.stalled",
          `No agent activity for ${silence}; the turn may be stalled.`,
        );
        return;
      }

      yield* Effect.logWarning("turn.watchdog.interrupting-hung-turn", {
        threadId: finding.threadId,
        turnId: finding.turnId,
        silentForMs: finding.silentForMs,
      });
      const createdAt = yield* nowIso;
      yield* dispatchWatchdogCommand(
        {
          type: "thread.turn.interrupt",
          commandId: CommandId.make(
            `turn.watchdog.interrupt:${finding.threadId}:${finding.turnId ?? "pending"}:${finding.lastActivityAtMs}`,
          ),
          threadId: finding.threadId,
          ...(finding.turnId !== null ? { turnId: finding.turnId } : {}),
          createdAt,
        },
        "turn watchdog failed to interrupt hung turn",
        finding.threadId,
      );
      yield* appendWatchdogActivity(
        finding,
        "turn.watchdog.interrupted",
        `No agent activity for ${silence}; the watchdog interrupted the hung turn.`,
      );
    });

    const sweepNow: TurnWatchdogReactorShape["sweepNow"] = Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const findings = turnWatchdog.sweep(nowMs, { stallThresholdMs, hungThresholdMs });
      yield* Effect.forEach(findings, handleFinding, { discard: true });
    });

    const start: TurnWatchdogReactorShape["start"] = () =>
      Effect.gen(function* () {
        if (!enabled) {
          yield* Effect.logInfo("turn.watchdog.disabled");
          return;
        }
        yield* forkParked(
          sweepNow.pipe(
            Effect.catchDefect((defect: unknown) =>
              Effect.logWarning("turn.watchdog.sweep-defect", { defect }),
            ),
            Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs))),
          ),
        );
        yield* Effect.logInfo("turn.watchdog.started", {
          stallThresholdMs,
          hungThresholdMs,
          sweepIntervalMs,
        });
      });

    return {
      start,
      sweepNow,
    } satisfies TurnWatchdogReactorShape;
  });

export const makeTurnWatchdogReactorLive = (options?: TurnWatchdogReactorLiveOptions) =>
  Layer.effect(TurnWatchdogReactor, makeTurnWatchdogReactor(options));

export const TurnWatchdogReactorLive = makeTurnWatchdogReactorLive();
