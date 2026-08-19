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
import * as ComputerTaskBroker from "../../ComputerTaskBroker.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ComputerToolkitHandlersLive } from "./handlers.ts";
import { ComputerToolkit } from "./tools.ts";

const now = "2026-01-01T00:00:00.000Z";
const environmentId = EnvironmentId.make("environment-mac");
const projectId = ProjectId.make("project-t3");
const sourceThreadId = ThreadId.make("thread-source");

function makeThread(
  id: ThreadId,
  input: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id,
    projectId,
    title: "Source Agent",
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

const source = makeThread(sourceThreadId);
const snapshot = {
  snapshotSequence: 10,
  projects: [
    {
      id: projectId,
      title: "t3code",
      workspaceRoot: "/Users/me/dev/t3code",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  ],
  threads: [source],
  updatedAt: now,
} satisfies OrchestrationShellSnapshot;

const invocation = {
  environmentId,
  threadId: sourceThreadId,
  providerSessionId: "provider-session-computers",
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
    clientInfo: { name: "computer-task-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const descriptor = {
  environmentId,
  label: "Sheehan's Mac",
  platform: { os: "darwin" as const, arch: "arm64" as const },
  serverVersion: "0.0.1",
  capabilities: { repositoryIdentity: false },
};

function makeTestLayer(dispatched: Array<OrchestrationCommand>) {
  const query = {
    getShellSnapshot: () => Effect.succeed(snapshot),
    getThreadShellById: (threadId: ThreadId) => {
      const thread = snapshot.threads.find(({ id }) => id === threadId);
      return Effect.succeed(thread === undefined ? Option.none() : Option.some(thread));
    },
  } as unknown as ProjectionSnapshotQuery["Service"];

  const engine = {
    readEvents: () => Stream.empty,
    dispatch: (command) => {
      dispatched.push(command);
      return Effect.succeed({ sequence: 11 });
    },
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(10),
  } satisfies OrchestrationEngineService["Service"];

  const environment = {
    getEnvironmentId: Effect.succeed(environmentId),
    getDescriptor: Effect.succeed(descriptor),
    // Nothing in these handlers renames the environment; the stub exists so
    // the service shape is complete.
    setEnvironmentLabel: () => Effect.void,
  } satisfies ServerEnvironment.ServerEnvironment["Service"];

  return McpServer.toolkit(ComputerToolkit).pipe(
    Layer.provide(ComputerToolkitHandlersLive),
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(ComputerTaskBroker.layer),
    Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, query)),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
    Layer.provideMerge(Layer.succeed(ServerEnvironment.ServerEnvironment, environment)),
    Layer.provideMerge(NodeServices.layer),
  );
}

it.effect("lists this machine and starts a local thread for computer_send this", () => {
  const dispatched: Array<OrchestrationCommand> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      expect(server.tools.some(({ tool }) => tool.name === "computer_list")).toBe(true);
      expect(server.tools.some(({ tool }) => tool.name === "computer_send")).toBe(true);

      const listed = yield* server
        .callTool({ name: "computer_list", arguments: {} })
        .pipe(
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        );
      expect(listed.isError).toBe(false);
      expect(listed.structuredContent).toMatchObject({
        thisEnvironmentId: environmentId,
        computers: [{ label: "Sheehan's Mac", thisMachine: true }],
      });

      const sent = yield* server
        .callTool({
          name: "computer_send",
          arguments: { computer: "this", message: "Build the Windows installer." },
        })
        .pipe(
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        );
      expect(sent.isError).toBe(false);
      expect(dispatched[0]?.type).toBe("thread.turn.start");
      if (dispatched[0]?.type === "thread.turn.start") {
        expect(dispatched[0].message.text).toContain("Build the Windows installer.");
        expect(dispatched[0].bootstrap?.createThread?.projectId).toBe(projectId);
      }
    }),
  ).pipe(Effect.provide(makeTestLayer(dispatched)));
});

it.effect("refuses an unknown computer", () => {
  const dispatched: Array<OrchestrationCommand> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const sent = yield* server
        .callTool({
          name: "computer_send",
          arguments: { computer: "toaster", message: "hello" },
        })
        .pipe(
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        );
      expect(sent.isError).toBe(true);
      const text = sent.content.find((part) => part.type === "text");
      expect(text?.type === "text" && text.text.includes("No computer matches 'toaster'")).toBe(
        true,
      );
    }),
  ).pipe(Effect.provide(makeTestLayer(dispatched)));
});
