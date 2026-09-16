import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const sourceThreadId = ThreadId.make("thread-branch-source");
const destinationThreadId = ThreadId.make("thread-branch-destination");
const projectId = ProjectId.make("project-branch");
const turnId = TurnId.make("turn-with-tools");
const assistantMessageId = MessageId.make("assistant-with-tools");
const now = "2026-01-01T00:00:00.000Z";

const seedEvents: ReadonlyArray<OrchestrationEvent> = [
  {
    sequence: 1,
    eventId: EventId.make("event-project"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("command-project"),
    causationEventId: null,
    correlationId: CommandId.make("command-project"),
    metadata: {},
    payload: {
      projectId,
      title: "Branch fixture",
      workspaceRoot: "/tmp/branch-fixture",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  },
  {
    sequence: 2,
    eventId: EventId.make("event-thread"),
    aggregateKind: "thread",
    aggregateId: sourceThreadId,
    type: "thread.created",
    occurredAt: now,
    commandId: CommandId.make("command-thread"),
    causationEventId: null,
    correlationId: CommandId.make("command-thread"),
    metadata: {},
    payload: {
      threadId: sourceThreadId,
      projectId,
      title: "Source thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: "feature/source",
      worktreePath: "/tmp/branch-fixture-worktree",
      createdAt: now,
      updatedAt: now,
    },
  },
  {
    sequence: 3,
    eventId: EventId.make("event-user-message"),
    aggregateKind: "thread",
    aggregateId: sourceThreadId,
    type: "thread.message-sent",
    occurredAt: "2026-01-01T00:00:01.000Z",
    commandId: CommandId.make("command-user-message"),
    causationEventId: null,
    correlationId: CommandId.make("command-user-message"),
    metadata: {},
    payload: {
      threadId: sourceThreadId,
      messageId: MessageId.make("user-with-tools"),
      role: "user",
      text: "Inspect the repository",
      turnId,
      streaming: false,
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    },
  },
  {
    sequence: 4,
    eventId: EventId.make("event-tool-call"),
    aggregateKind: "thread",
    aggregateId: sourceThreadId,
    type: "thread.activity-appended",
    occurredAt: "2026-01-01T00:00:02.000Z",
    commandId: CommandId.make("command-tool-call"),
    causationEventId: null,
    correlationId: CommandId.make("command-tool-call"),
    metadata: {},
    payload: {
      threadId: sourceThreadId,
      activity: {
        id: EventId.make("tool-call"),
        tone: "tool",
        kind: "tool.completed",
        summary: "Read package.json",
        payload: {
          requestId: "tool-request-1",
          itemType: "command_execution",
          command: "cat package.json",
          output: '{"name":"fixture"}',
        },
        turnId,
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    },
  },
  {
    sequence: 5,
    eventId: EventId.make("event-assistant-message"),
    aggregateKind: "thread",
    aggregateId: sourceThreadId,
    type: "thread.message-sent",
    occurredAt: "2026-01-01T00:00:03.000Z",
    commandId: CommandId.make("command-assistant-message"),
    causationEventId: null,
    correlationId: CommandId.make("command-assistant-message"),
    metadata: {},
    payload: {
      threadId: sourceThreadId,
      messageId: assistantMessageId,
      role: "assistant",
      text: "The package is named fixture.",
      turnId,
      streaming: false,
      createdAt: "2026-01-01T00:00:03.000Z",
      updatedAt: "2026-01-01T00:00:03.000Z",
    },
  },
];

it.layer(NodeServices.layer)("thread branch decider", (it) => {
  it.effect("copies messages and tool activities through the selected response", () =>
    Effect.gen(function* () {
      let readModel = createEmptyReadModel(now);
      for (const event of seedEvents) {
        readModel = yield* projectEvent(readModel, event);
      }

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch",
          commandId: CommandId.make("command-branch"),
          sourceThreadId,
          sourceMessageId: assistantMessageId,
          threadId: destinationThreadId,
          createdAt: "2026-01-01T00:01:00.000Z",
        },
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "thread.created",
        "thread.message-sent",
        "thread.activity-appended",
        "thread.message-sent",
        "thread.branch-requested",
      ]);
      const copiedActivity = events.find((event) => event.type === "thread.activity-appended");
      expect(copiedActivity?.payload.activity.payload).toEqual({
        requestId: "tool-request-1",
        itemType: "command_execution",
        command: "cat package.json",
        output: '{"name":"fixture"}',
      });
      const branchRequested = events.find((event) => event.type === "thread.branch-requested");
      expect(branchRequested?.payload.throughTurnId).toBe(turnId);
      expect(branchRequested?.payload.cwd).toBe("/tmp/branch-fixture-worktree");
    }),
  );
});
