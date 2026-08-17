import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, TurnId, type OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
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

function makeThreadShell(id: ThreadId, session: TestSession | null) {
  return {
    id,
    title: `Thread ${id}`,
    session,
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
    readonly dispatchImplementation?: () => ReturnType<
      OrchestrationEngineService["Service"]["dispatch"]
    >;
  }) {
    const dispatched: Array<OrchestrationCommand> = [];
    const dispatch = vi.fn((command: OrchestrationCommand) => {
      dispatched.push(command);
      return input.dispatchImplementation
        ? input.dispatchImplementation()
        : (Effect.void as ReturnType<OrchestrationEngineService["Service"]["dispatch"]>);
    });

    const providerService: Partial<ProviderServiceShape> = {
      listSessions: () =>
        Effect.succeed(
          (input.liveSessionThreadIds ?? []).map((threadId) => ({ threadId })),
        ) as ReturnType<ProviderServiceShape["listSessions"]>,
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

    const layer = SessionStartupReconcilerLive.pipe(
      Layer.provideMerge(
        Layer.succeed(OrchestrationEngineService, {
          readEvents: () => unsupported(),
          dispatch,
          streamDomainEvents: Stream.empty,
          latestSequence: Effect.succeed(0),
        } as unknown as OrchestrationEngineService["Service"]),
      ),
      Layer.provideMerge(
        Layer.succeed(ProviderService, providerService as ProviderServiceShape),
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

  it("settles running sessions with no live provider process as errors", async () => {
    const threadId = ThreadId.make("thread-orphan-running");
    const harness = createHarness({
      threads: [
        makeThreadShell(threadId, {
          threadId,
          status: "running",
          providerName: "claudeAgent",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-orphaned"),
          lastError: null,
          updatedAt: now,
        }),
      ],
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

  it("settles archived threads and sessions stuck in starting", async () => {
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
      archivedThreads: [
        makeThreadShell(archivedId, {
          threadId: archivedId,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-archived"),
          lastError: null,
          updatedAt: now,
        }),
      ],
    });

    await runReconcile();

    expect(harness.dispatched.map((command) => command.threadId)).toEqual([activeId, archivedId]);
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
        makeThreadShell(liveId, {
          threadId: liveId,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-live"),
          lastError: null,
          updatedAt: now,
        }),
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
    const session = (threadId: ThreadId): TestSession => ({
      threadId,
      status: "running",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: TurnId.make(`turn-${threadId}`),
      lastError: null,
      updatedAt: now,
    });
    const harness = createHarness({
      threads: [
        makeThreadShell(firstId, session(firstId)),
        makeThreadShell(secondId, session(secondId)),
      ],
      dispatchImplementation: () =>
        Effect.fail(new Error("dispatch rejected")) as ReturnType<
          OrchestrationEngineService["Service"]["dispatch"]
        >,
    });

    await runReconcile();

    expect(harness.dispatched.map((command) => command.threadId)).toEqual([firstId, secondId]);
  });
});
