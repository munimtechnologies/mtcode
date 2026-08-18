import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  type OrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadRelayToolkitHandlersLive } from "./handlers.ts";
import { ThreadRelayToolkit } from "./tools.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-relay");
const sourceThreadId = ThreadId.make("thread-source");
const targetThreadId = ThreadId.make("thread-target");

function makeThread(
  id: ThreadId,
  input: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id,
    projectId,
    title: id === sourceThreadId ? "Source Agent" : "Target Agent",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  };
}

const idleThreadId = ThreadId.make("thread-idle");

const source = makeThread(sourceThreadId);
const target = makeThread(targetThreadId, {
  branch: "feat/parser",
  worktreePath: "/tmp/worktree-target",
  updatedAt: "2026-01-01T00:00:01.000Z",
  backgroundLiveness: "working",
});
const idleSibling = makeThread(idleThreadId, { title: "Idle Agent" });

const snapshot = {
  snapshotSequence: 10,
  projects: [],
  threads: [source, target],
  updatedAt: target.updatedAt,
} satisfies OrchestrationShellSnapshot;

const invocation = {
  environmentId: EnvironmentId.make("environment-relay"),
  threadId: sourceThreadId,
  providerSessionId: "provider-session-relay",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set<never>(),
  issuedAt: 1,
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "thread-relay-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

function makeTestLayer(
  dispatched: Array<OrchestrationCommand>,
  options: {
    readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
    readonly failDispatchOf?: OrchestrationCommand["type"];
  } = {},
) {
  const threads = options.threads ?? snapshot.threads;
  const shellSnapshot = { ...snapshot, threads: [...threads] };
  const query = {
    getShellSnapshot: () => Effect.succeed(shellSnapshot),
    getThreadShellById: (threadId: ThreadId) => {
      const thread = threads.find(({ id }) => id === threadId);
      return Effect.succeed(thread === undefined ? Option.none() : Option.some(thread));
    },
  } as unknown as ProjectionSnapshotQuery["Service"];

  const engine = {
    readEvents: () => Stream.empty,
    dispatch: (command) => {
      dispatched.push(command);
      return command.type === options.failDispatchOf
        ? Effect.fail(new Error(`dispatch of ${command.type} rejected`) as never)
        : Effect.succeed({ sequence: 11 });
    },
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(10),
  } satisfies OrchestrationEngineService["Service"];

  return McpServer.toolkit(ThreadRelayToolkit).pipe(
    Layer.provide(ThreadRelayToolkitHandlersLive),
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, query)),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
    Layer.provideMerge(NodeServices.layer),
  );
}

it.effect("lists siblings and durably dispatches attributed thread messages", () => {
  const dispatched: Array<OrchestrationCommand> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const listTool = server.tools.find(({ tool }) => tool.name === "thread_list");
      expect(listTool?.tool.annotations?.readOnlyHint).toBe(true);
      expect(listTool?.tool.annotations?.idempotentHint).toBe(true);

      const sendTool = server.tools.find(({ tool }) => tool.name === "thread_send");
      expect(sendTool?.tool.annotations?.readOnlyHint).toBe(false);
      expect(sendTool?.tool.annotations?.destructiveHint).toBe(true);
      expect(sendTool?.tool.annotations?.idempotentHint).toBe(false);

      const peers = yield* server
        .callTool({ name: "thread_list", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(peers.isError).toBe(false);
      expect(peers.structuredContent).toEqual({
        threads: [
          {
            threadId: targetThreadId,
            title: "Target Agent",
            status: "working",
            branch: "feat/parser",
            workspace: "worktree",
            updatedAt: target.updatedAt,
          },
        ],
        truncated: false,
      });

      const sent = yield* server
        .callTool({
          name: "thread_send",
          arguments: { threadId: targetThreadId, message: "Please review the parser." },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(sent.isError).toBe(false);
      expect(sent.structuredContent).toMatchObject({
        targetThreadId,
        status: "accepted",
        sequence: 11,
      });
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({
        type: "thread.turn.start",
        threadId: targetThreadId,
        message: { role: "user", text: "Please review the parser." },
        runtimeMode: target.runtimeMode,
        interactionMode: target.interactionMode,
        sourceThreadMessage: { threadId: sourceThreadId },
      });
    }),
  ).pipe(Effect.provide(makeTestLayer(dispatched)));
});

const callTool = (name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  });

it.effect("creates an attributed sibling thread and starts its first turn", () => {
  const dispatched: Array<OrchestrationCommand> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const created = yield* callTool("thread_create", {
        title: "Parser fixes",
        message: "Fix the parser crash on empty input.",
      });
      expect(created.isError).toBe(false);
      expect(created.structuredContent).toMatchObject({ status: "accepted", sequence: 11 });

      expect(dispatched.map(({ type }) => type)).toEqual(["thread.create", "thread.turn.start"]);
      const create = dispatched[0] as Extract<OrchestrationCommand, { type: "thread.create" }>;
      expect(create).toMatchObject({
        projectId,
        title: "Parser fixes",
        modelSelection: source.modelSelection,
        runtimeMode: source.runtimeMode,
        interactionMode: source.interactionMode,
        branch: source.branch,
        worktreePath: source.worktreePath,
      });
      expect(dispatched[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: create.threadId,
        message: { role: "user", text: "Fix the parser crash on empty input." },
        sourceThreadMessage: { threadId: sourceThreadId },
      });
      expect((created.structuredContent as { threadId: string }).threadId).toBe(create.threadId);

      const untitled = yield* callTool("thread_create", { message: "Second delegated task." });
      expect(untitled.isError).toBe(false);
      const untitledCreate = dispatched[2] as Extract<
        OrchestrationCommand,
        { type: "thread.create" }
      >;
      expect(untitledCreate.title).toBe("New thread");
    }),
  ).pipe(Effect.provide(makeTestLayer(dispatched)));
});

it.effect("refuses thread_create while too many project threads are working", () => {
  const dispatched: Array<OrchestrationCommand> = [];
  const busySiblings = Array.from({ length: 8 }, (_, index) =>
    makeThread(ThreadId.make(`thread-busy-${index}`), { backgroundLiveness: "working" }),
  );
  return Effect.scoped(
    Effect.gen(function* () {
      const result = yield* callTool("thread_create", { message: "One more task." });
      expect(result.isError).toBe(true);
      expect(dispatched).toHaveLength(0);
    }),
  ).pipe(Effect.provide(makeTestLayer(dispatched, { threads: [source, ...busySiblings] })));
});

it.effect("rolls back thread creation when the first turn cannot start", () => {
  const dispatched: Array<OrchestrationCommand> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const result = yield* callTool("thread_create", { message: "Doomed first turn." });
      expect(result.isError).toBe(true);
      expect(dispatched.map(({ type }) => type)).toEqual([
        "thread.create",
        "thread.turn.start",
        "thread.delete",
      ]);
      const create = dispatched[0] as Extract<OrchestrationCommand, { type: "thread.create" }>;
      expect(dispatched[2]).toMatchObject({ type: "thread.delete", threadId: create.threadId });
    }),
  ).pipe(Effect.provide(makeTestLayer(dispatched, { failDispatchOf: "thread.turn.start" })));
});

it.effect("archives idle siblings only", () => {
  const dispatched: Array<OrchestrationCommand> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const archived = yield* callTool("thread_archive", { threadId: idleThreadId });
      expect(archived.isError).toBe(false);
      expect(archived.structuredContent).toEqual({ threadId: idleThreadId, status: "archived" });
      expect(dispatched.map(({ type }) => type)).toEqual(["thread.archive"]);

      const busy = yield* callTool("thread_archive", { threadId: targetThreadId });
      expect(busy.isError).toBe(true);

      const self = yield* callTool("thread_archive", { threadId: sourceThreadId });
      expect(self.isError).toBe(true);

      expect(dispatched).toHaveLength(1);
    }),
  ).pipe(Effect.provide(makeTestLayer(dispatched, { threads: [source, target, idleSibling] })));
});
