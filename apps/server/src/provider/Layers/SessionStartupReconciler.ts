import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CommandId, type OrchestrationThreadShell } from "@t3tools/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import {
  SessionStartupReconciler,
  type SessionStartupReconcilerShape,
} from "../Services/SessionStartupReconciler.ts";

const ORPHANED_SESSION_ERROR =
  "Provider session did not survive a server restart. Send a new message to continue.";

// A session in either of these states claims a live provider process. After a
// restart no provider process exists yet, so any such claim is stale unless
// ProviderService already tracks the thread again.
const isOrphanCandidate = (thread: OrchestrationThreadShell): boolean =>
  thread.session !== null &&
  (thread.session.status === "running" ||
    thread.session.status === "starting" ||
    thread.session.activeTurnId !== null);

const makeSessionStartupReconciler = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;

  const settleOrphan = (thread: OrchestrationThreadShell, now: string, nowMillis: number) =>
    orchestrationEngine
      .dispatch({
        type: "thread.session.set",
        commandId: CommandId.make(`startup-reconcile-${thread.id}-${nowMillis}`),
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "error",
          providerName: thread.session?.providerName ?? null,
          ...(thread.session?.providerInstanceId !== undefined
            ? { providerInstanceId: thread.session.providerInstanceId }
            : {}),
          runtimeMode: thread.session?.runtimeMode ?? "full-access",
          activeTurnId: null,
          lastError: ORPHANED_SESSION_ERROR,
          updatedAt: now,
        },
        createdAt: now,
      })
      .pipe(
        Effect.tap(() =>
          Effect.logInfo("session.startup-reconciler.settled-orphan", {
            threadId: thread.id,
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

  const sweep = Effect.gen(function* () {
    const [shell, archived] = yield* Effect.all([
      projectionSnapshotQuery.getShellSnapshot(),
      projectionSnapshotQuery.getArchivedShellSnapshot(),
    ]);
    const liveSessions = yield* providerService.listSessions();
    const liveThreadIds = new Set(liveSessions.map((session) => session.threadId));

    const orphans = [...shell.threads, ...archived.threads].filter(
      (thread) => isOrphanCandidate(thread) && !liveThreadIds.has(thread.id),
    );
    if (orphans.length === 0) {
      return;
    }

    const nowUtc = yield* DateTime.now;
    const now = DateTime.formatIso(nowUtc);
    const nowMillis = DateTime.toEpochMillis(nowUtc);
    let settledCount = 0;
    for (const thread of orphans) {
      if (yield* settleOrphan(thread, now, nowMillis)) {
        settledCount += 1;
      }
    }

    yield* Effect.logInfo("session.startup-reconciler.complete", {
      orphanCount: orphans.length,
      settledCount,
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
