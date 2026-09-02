import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, TurnId, type OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderSessionDirectoryShape,
} from "../Services/ProviderSessionDirectory.ts";
import { SessionStartupReconciler } from "../Services/SessionStartupReconciler.ts";
import { SessionStartupReconcilerLive } from "./SessionStartupReconciler.ts";

const unsupported = () => Effect.die(new Error("Unsupported call in test")) as never;

const now = "2026-01-01T00:00:00.000Z";

interface TestSession {
  readonly threadId: ThreadId;
  readonly status: "starting" | "running" | "ready" | "interrupted" | "stopped" | "error";
  readonly providerName: "codex" | "claudeAgent";
  readonly runtimeMode: "approval-required" | "full-access" | "auto-accept-edits";
  readonly activeTurnId: TurnId | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

function makeThreadShell(
  id: ThreadId,
  session: TestSession | null,
  extras?: {
    readonly goal?: { readonly status: "active" | "completed" | "blocked" };
    readonly hasQueuedTurns?: boolean;
  },
) {
  return {
    id,
    title: `Thread ${id}`,
    runtimeMode: "full-access",
    interactionMode: "default",
    session,
    ...extras,
  };
}

describe("SessionStartupReconciler", () => {
  let runtime: ManagedRuntime.ManagedRuntime<SessionStartupReconciler, unknown> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  function createHarness(input: {
    readonly threads: ReadonlyArray<ReturnType<typeof makeThreadShell>>;
    readonly archivedThreads?: ReadonlyArray<ReturnType<typeof makeThreadShell>>;
    readonly liveSessionThreadIds?: ReadonlyArray<ThreadId>;
    readonly resumableThreadIds?: ReadonlyArray<ThreadId>;
    /** Threads the server marked to continue after a self-update. */
    readonly continuationMarkedThreadIds?: ReadonlyArray<ThreadId>;
    readonly dispatchImplementation?: () => ReturnType<
      OrchestrationEngineService["Service"]["dispatch"]
    >;
  }) {
    const dispatched: Array<OrchestrationCommand> = [];
    const dispatch = vi.fn((command: OrchestrationCommand) => {
      dispatched.push(command);
      return input.dispatchImplementation
        ? input.dispatchImplementation()
        : (Effect.succeed({ sequence: dispatched.length }) as ReturnType<
            OrchestrationEngineService["Service"]["dispatch"]
          >);
    });

    const providerService: Partial<ProviderServiceShape> = {
      listSessions: () =>
        Effect.succeed(
          (input.liveSessionThreadIds ?? []).map((threadId) => ({ threadId })),
        ) as unknown as ReturnType<ProviderServiceShape["listSessions"]>,
      startSession: () => unsupported(),
      sendTurn: () => unsupported(),
      interruptTurn: () => unsupported(),
      respondToRequest: () => unsupported(),
      respondToUserInput: () => unsupported(),
      stopSession: () => unsupported(),
      getCapabilities: () => unsupported(),
      getInstanceInfo: () => unsupported(),
      rollbackConversation: () => unsupported(),
      streamEvents: Stream.empty,
    };

    const resumable = new Set(input.resumableThreadIds ?? []);
    const continuationMarked = new Set(input.continuationMarkedThreadIds ?? []);
    const sessionDirectory: Partial<ProviderSessionDirectoryShape> = {
      getBinding: (threadId) =>
        Effect.succeed(
          resumable.has(threadId) || continuationMarked.has(threadId)
            ? Option.some({
                threadId,
                provider: "codex",
                ...(resumable.has(threadId)
                  ? { resumeCursor: { threadId: `provider-${threadId}` } }
                  : {}),
                ...(continuationMarked.has(threadId)
                  ? { runtimePayload: { continueAfterServerUpdate: `turn-${threadId}` } }
                  : {}),
              } as ProviderRuntimeBinding)
            : Option.none(),
        ),
      upsert: () => unsupported(),
      getProvider: () => unsupported(),
      listThreadIds: () => unsupported(),
      listBindings: () => unsupported(),
    };

    const layer = SessionStartupReconcilerLive.pipe(
      Layer.provideMerge(
        Layer.succeed(OrchestrationEngineService, {
          readEvents: () => unsupported(),
          dispatch,
          streamDomainEvents: Stream.empty,
          latestSequence: Effect.succeed(0),
        } as unknown as OrchestrationEngineService["Service"]),
      ),
      Layer.provideMerge(Layer.succeed(ProviderService, providerService as ProviderServiceShape)),
      Layer.provideMerge(
        Layer.succeed(ProviderSessionDirectory, sessionDirectory as ProviderSessionDirectoryShape),
      ),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getShellSnapshot: () =>
            Effect.succeed({ snapshotSequence: 0, updatedAt: now, threads: input.threads }),
          getArchivedShellSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 0,
              updatedAt: now,
              threads: input.archivedThreads ?? [],
            }),
        } as unknown as ProjectionSnapshotQuery["Service"]),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    return { dispatch, dispatched };
  }

  async function runReconcile() {
    const reconciler = await runtime!.runPromise(Effect.service(SessionStartupReconciler));
    await runtime!.runPromise(reconciler.reconcile());
  }

  function runningSession(threadId: ThreadId): TestSession {
    return {
      threadId,
      status: "running",
      providerName: "claudeAgent",
      runtimeMode: "full-access",
      activeTurnId: TurnId.make(`turn-${threadId}`),
      lastError: null,
      updatedAt: now,
    };
  }

  it("settles running sessions with no live provider process and no resume state as errors", async () => {
    const threadId = ThreadId.make("thread-orphan-running");
    const harness = createHarness({
      threads: [makeThreadShell(threadId, runningSession(threadId))],
    });

    await runReconcile();

    expect(harness.dispatched).toHaveLength(1);
    const command = harness.dispatched[0]!;
    expect(command.type).toBe("thread.session.set");
    if (command.type === "thread.session.set") {
      expect(command.threadId).toBe(threadId);
      expect(command.session.status).toBe("error");
      expect(command.session.activeTurnId).toBeNull();
      expect(command.session.providerName).toBe("claudeAgent");
      expect(command.session.lastError).toContain("did not survive");
    }
  });

  it("resumes a running session that has persisted resume state", async () => {
    const threadId = ThreadId.make("thread-orphan-resumable");
    const harness = createHarness({
      threads: [makeThreadShell(threadId, runningSession(threadId))],
      resumableThreadIds: [threadId],
    });

    await runReconcile();

    expect(harness.dispatched).toHaveLength(2);
    const settle = harness.dispatched[0]!;
    expect(settle.type).toBe("thread.session.set");
    if (settle.type === "thread.session.set") {
      expect(settle.threadId).toBe(threadId);
      expect(settle.session.status).toBe("interrupted");
      expect(settle.session.activeTurnId).toBeNull();
      expect(settle.session.lastError).toBeNull();
    }
    const resume = harness.dispatched[1]!;
    expect(resume.type).toBe("thread.turn.start");
    if (resume.type === "thread.turn.start") {
      expect(resume.threadId).toBe(threadId);
      expect(resume.message.role).toBe("user");
      expect(resume.message.text).toContain("Continue exactly where you left off");
    }
  });

  it("leaves a thread marked for server-update continuation to the startup continuation pass", async () => {
    const markedThreadId = ThreadId.make("thread-orphan-marked");
    const plainThreadId = ThreadId.make("thread-orphan-plain");
    const harness = createHarness({
      threads: [
        makeThreadShell(markedThreadId, runningSession(markedThreadId)),
        makeThreadShell(plainThreadId, runningSession(plainThreadId)),
      ],
      resumableThreadIds: [markedThreadId, plainThreadId],
      continuationMarkedThreadIds: [markedThreadId],
    });

    await runReconcile();

    // The marked thread is neither settled nor resumed here: serverRuntimeStartup's
    // continuation pass owns it, and a second resume would run the turn twice.
    expect(harness.dispatched.map((command) => command.threadId)).toEqual([
      plainThreadId,
      plainThreadId,
    ]);
    expect(harness.dispatched.map((command) => command.type)).toEqual([
      "thread.session.set",
      "thread.turn.start",
    ]);
  });

  it("settles as interrupted without a resume turn when a queued message will restart the thread", async () => {
    const threadId = ThreadId.make("thread-orphan-queued");
    const harness = createHarness({
      threads: [makeThreadShell(threadId, runningSession(threadId), { hasQueuedTurns: true })],
      resumableThreadIds: [threadId],
    });

    await runReconcile();

    expect(harness.dispatched).toHaveLength(1);
    const command = harness.dispatched[0]!;
    expect(command.type).toBe("thread.session.set");
    if (command.type === "thread.session.set") {
      expect(command.session.status).toBe("interrupted");
    }
  });

  it("leaves Active Goal threads to the goal reactor", async () => {
    const threadId = ThreadId.make("thread-orphan-goal");
    const harness = createHarness({
      threads: [
        makeThreadShell(threadId, runningSession(threadId), { goal: { status: "active" } }),
      ],
      resumableThreadIds: [threadId],
    });

    await runReconcile();

    expect(harness.dispatched).toHaveLength(1);
    const command = harness.dispatched[0]!;
    expect(command.type).toBe("thread.session.set");
    if (command.type === "thread.session.set") {
      expect(command.session.status).toBe("interrupted");
    }
  });

  it("settles archived threads as errors even with resume state, and sessions stuck in starting", async () => {
    const activeId = ThreadId.make("thread-orphan-starting");
    const archivedId = ThreadId.make("thread-orphan-archived");
    const harness = createHarness({
      threads: [
        makeThreadShell(activeId, {
          threadId: activeId,
          status: "starting",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        }),
      ],
      archivedThreads: [makeThreadShell(archivedId, runningSession(archivedId))],
      resumableThreadIds: [archivedId],
    });

    await runReconcile();

    const settled = harness.dispatched.flatMap((command) =>
      command.type === "thread.session.set"
        ? [{ threadId: command.threadId, status: command.session.status }]
        : [],
    );
    expect(settled).toEqual([
      { threadId: activeId, status: "error" },
      { threadId: archivedId, status: "error" },
    ]);
  });

  it("skips settled sessions and sessions with a live provider process", async () => {
    const settledId = ThreadId.make("thread-settled");
    const liveId = ThreadId.make("thread-live");
    const harness = createHarness({
      threads: [
        makeThreadShell(settledId, {
          threadId: settledId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        }),
        makeThreadShell(liveId, runningSession(liveId)),
        makeThreadShell(ThreadId.make("thread-no-session"), null),
      ],
      liveSessionThreadIds: [liveId],
    });

    await runReconcile();

    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("continues past dispatch failures without failing startup", async () => {
    const firstId = ThreadId.make("thread-orphan-first");
    const secondId = ThreadId.make("thread-orphan-second");
    const harness = createHarness({
      threads: [
        makeThreadShell(firstId, runningSession(firstId)),
        makeThreadShell(secondId, runningSession(secondId)),
      ],
      dispatchImplementation: () =>
        Effect.die(new Error("dispatch rejected")) as ReturnType<
          OrchestrationEngineService["Service"]["dispatch"]
        >,
    });

    await runReconcile();

    const attemptedThreadIds = harness.dispatched.flatMap((command) =>
      command.type === "thread.session.set" ? [command.threadId] : [],
    );
    expect(attemptedThreadIds).toEqual([firstId, secondId]);
  });
});
