import { expect, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationMessage,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { buildThreadReferencePage, ThreadReferenceToolkitHandlersLive } from "./handlers.ts";
import { ThreadReferenceToolkit } from "./tools.ts";

const TestLayer = McpServer.toolkit(ThreadReferenceToolkit).pipe(
  Layer.provide(ThreadReferenceToolkitHandlersLive),
  Layer.provideMerge(McpServer.McpServer.layer),
);

const makeMessage = (id: string, text: string): OrchestrationMessage => ({
  id: MessageId.make(id),
  role: "user",
  text,
  turnId: null,
  streaming: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const thread = {
  id: ThreadId.make("thread-referenced"),
  projectId: ProjectId.make("project-1"),
  title: "Referenced work",
  messages: [makeMessage("message-1", "abcdef"), makeMessage("message-2", "ghijkl")],
} as unknown as OrchestrationThread;

it("paginates within a message without losing transcript text", () => {
  const first = buildThreadReferencePage(thread, {
    threadId: thread.id,
    maxChars: 1_000,
  });
  expect(first).toMatchObject({ nextCursor: null, totalMessages: 2 });

  const longThread = {
    ...thread,
    messages: [makeMessage("message-long", "a".repeat(1_100))],
  };
  const longFirst = buildThreadReferencePage(longThread, {
    threadId: thread.id,
    maxChars: 1_000,
  });
  expect(longFirst).toMatchObject({ nextCursor: "0:1000" });
  if ("_tag" in longFirst) throw new Error("unexpected cursor error");
  const longSecond = buildThreadReferencePage(longThread, {
    threadId: thread.id,
    cursor: longFirst.nextCursor!,
    maxChars: 1_000,
  });
  if ("_tag" in longSecond) throw new Error("unexpected cursor error");
  expect(longFirst.messages[0]?.text.length).toBe(1_000);
  expect(longSecond.messages[0]?.text.length).toBe(100);
  expect(longSecond.nextCursor).toBeNull();
});

it.effect("reads a referenced thread through the MCP toolkit", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server.callTool({
      name: "thread_read",
      arguments: { threadId: thread.id },
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      threadId: thread.id,
      title: thread.title,
      totalMessages: 2,
    });
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: "environment-1" as never,
      threadId: ThreadId.make("thread-current"),
      providerSessionId: "provider-session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
      capabilities: new Set(["thread-reference"] as const),
      issuedAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
    }),
    Effect.provideService(McpSchema.McpServerClient, {
      clientId: 1,
      initializePayload: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
      getClient: Effect.die("unused"),
    }),
    Effect.provideService(ProjectionSnapshotQuery, {
      getThreadDetailById: () => Effect.succeed(Option.some(thread)),
    } as never),
    Effect.provide(TestLayer),
  ),
);
