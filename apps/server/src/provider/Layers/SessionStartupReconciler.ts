import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { CommandId, MessageId, type OrchestrationThreadShell } from "@t3tools/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { hasServerUpdateContinuationMarker } from "../serverUpdateContinuation.ts";
import {
  SessionStartupReconciler,
  type SessionStartupReconcilerShape,
} from "../Services/SessionStartupReconciler.ts";

const ORPHANED_SESSION_ERROR =
  "Provider session did not survive a server restart. Send a new message to continue.";

// User message of the automatic resume Turn. The resumed provider session
// carries its full history, so the prompt only has to point the agent back at
// its interrupted work.
const RESUME_AFTER_RESTART_PROMPT =
  "The app restarted while you were working and this turn was interrupted. " +
  "Continue exactly where you left off: verify the state of any work that was in flight, " +
  "finish what is incomplete, and do not redo steps that already completed.";

// A session in either of these states claims a live provider process. After a
// restart no provider process exists yet, so any such claim is stale unless
// ProviderService already tracks the thread again.
const isOrphanCandidate = (thread: OrchestrationThreadShell): boolean =>
  thread.session !== null &&
  (thread.session.status === "running" ||
    thread.session.status === "starting" ||
    thread.session.activeTurnId !== null);

// How a specific orphan gets settled. "resume" settles the Turn as interrupted
// and starts an automatic continuation Turn; the provider session is restarted
// from its persisted resume cursor on the way. "interrupt" settles the Turn
// but starts nothing, because another owner delivers the follow-up: the goal
// reactor for Active Goals, the queued-turn recovery for pending user
// messages. "error" is the dead end for sessions with no resume state, where
// only a fresh user message can continue the thread.
type OrphanPlan = "resume" | "interrupt" | "error";

const planForOrphan = (input: {
  readonly thread: OrchestrationThreadShell;
  readonly archived: boolean;
  readonly hasResumeCursor: boolean;
}): OrphanPlan => {
  if (!input.hasResumeCursor || input.archived) {
    return "error";
  }
  if (input.thread.goal?.status === "active" || input.thread.hasQueuedTurns === true) {
    return "interrupt";
  }
  return "resume";
};

const makeSessionStartupReconciler = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const sessionDirectory = yield* ProviderSessionDirectory;

  // What the session directory remembers about an orphan: whether the
  // provider session can be restored from a persisted cursor, and whether the
  // server marked the thread to continue after a self-update. A marked thread
  // belongs to the server-update continuation pass in serverRuntimeStartup,
  // which runs after this sweep; settling or resuming it here would either
  // continue it twice or take it away from that pass.
  const readResumeState = (thread: OrchestrationThreadShell) =>
    sessionDirectory.getBinding(thread.id).pipe(
      Effect.map(
        Option.match({
          onNone: () => ({ hasResumeCursor: false, continuationMarked: false }),
          onSome: (binding) => ({
            hasResumeCursor: binding.resumeCursor != null,
            continuationMarked: hasServerUpdateContinuationMarker(binding.runtimePayload),
          }),
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("session.startup-reconciler.resume-state-read-failed", {
          threadId: thread.id,
          cause,
        }).pipe(Effect.as({ hasResumeCursor: false, continuationMarked: false })),
      ),
    );

  const settleOrphan = (
    thread: OrchestrationThreadShell,
    status: "interrupted" | "error",
    now: string,
    nowMillis: number,
  ) =>
    orchestrationEngine
      .dispatch({
        type: "thread.session.set",
        commandId: CommandId.make(`startup-reconcile-${thread.id}-${nowMillis}`),
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status,
          providerName: thread.session?.providerName ?? null,
          ...(thread.session?.providerInstanceId !== undefined
            ? { providerInstanceId: thread.session.providerInstanceId }
            : {}),
          runtimeMode: thread.session?.runtimeMode ?? "full-access",
          activeTurnId: null,
          lastError: status === "error" ? ORPHANED_SESSION_ERROR : null,
          updatedAt: now,
        },
        createdAt: now,
      })
      .pipe(
        Effect.tap(() =>
          Effect.logInfo("session.startup-reconciler.settled-orphan", {
            threadId: thread.id,
            settledStatus: status,
            previousStatus: thread.session?.status,
            previousActiveTurnId: thread.session?.activeTurnId,
          }),
        ),
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logWarning("session.startup-reconciler.settle-failed", {
            threadId: thread.id,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );

  const startResumeTurn = (thread: OrchestrationThreadShell, now: string, nowMillis: number) =>
    orchestrationEngine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`startup-resume-${thread.id}-${nowMillis}`),
        threadId: thread.id,
        message: {
          messageId: MessageId.make(`restart-resume:${thread.id}:${nowMillis}`),
          role: "user",
          text: RESUME_AFTER_RESTART_PROMPT,
          attachments: [],
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: now,
      })
      .pipe(
        Effect.tap(() =>
          Effect.logInfo("session.startup-reconciler.resumed-orphan", {
            threadId: thread.id,
            previousActiveTurnId: thread.session?.activeTurnId,
          }),
        ),
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logWarning("session.startup-reconciler.resume-failed", {
            threadId: thread.id,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );

  const sweep = Effect.gen(function* () {
    const [shell, archived] = yield* Effect.all([
      projectionSnapshotQuery.getShellSnapshot(),
      projectionSnapshotQuery.getArchivedShellSnapshot(),
    ]);
    const liveSessions = yield* providerService.listSessions();
    const liveThreadIds = new Set(liveSessions.map((session) => session.threadId));

    const orphans = [
      ...shell.threads.map((thread) => ({ thread, archived: false })),
      ...archived.threads.map((thread) => ({ thread, archived: true })),
    ].filter(({ thread }) => isOrphanCandidate(thread) && !liveThreadIds.has(thread.id));
    if (orphans.length === 0) {
      return;
    }

    const nowUtc = yield* DateTime.now;
    const now = DateTime.formatIso(nowUtc);
    const nowMillis = DateTime.toEpochMillis(nowUtc);
    let settledCount = 0;
    let resumedCount = 0;
    let deferredCount = 0;
    for (const orphan of orphans) {
      const resumeState = yield* readResumeState(orphan.thread);
      if (resumeState.continuationMarked) {
        deferredCount += 1;
        yield* Effect.logInfo("session.startup-reconciler.deferred-to-server-update-continuation", {
          threadId: orphan.thread.id,
        });
        continue;
      }
      const plan = planForOrphan({
        ...orphan,
        hasResumeCursor: resumeState.hasResumeCursor,
      });
      const settled = yield* settleOrphan(
        orphan.thread,
        plan === "error" ? "error" : "interrupted",
        now,
        nowMillis,
      );
      if (!settled) {
        continue;
      }
      settledCount += 1;
      if (plan === "resume" && (yield* startResumeTurn(orphan.thread, now, nowMillis))) {
        resumedCount += 1;
      }
    }

    yield* Effect.logInfo("session.startup-reconciler.complete", {
      orphanCount: orphans.length,
      settledCount,
      resumedCount,
      deferredCount,
    });
  });

  const reconcile: SessionStartupReconcilerShape["reconcile"] = () =>
    sweep.pipe(
      Effect.catch((error: unknown) =>
        Effect.logWarning("session.startup-reconciler.failed", { error }),
      ),
      Effect.catchDefect((defect: unknown) =>
        Effect.logWarning("session.startup-reconciler.defect", { defect }),
      ),
    );

  return {
    reconcile,
  } satisfies SessionStartupReconcilerShape;
});

export const SessionStartupReconcilerLive = Layer.effect(
  SessionStartupReconciler,
  makeSessionStartupReconciler,
);
