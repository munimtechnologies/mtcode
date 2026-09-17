import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const sourceCreatedAt = "2026-01-01T00:00:00.000Z";
const sourceUpdatedAt = "2026-01-01T00:00:03.000Z";
const importedAt = "2026-03-01T00:00:00.000Z";

it.layer(NodeServices.layer)("thread import decider", (it) => {
  it.effect("emits one atomic conventional event sequence for imported history", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-import");
      const threadId = ThreadId.make("thread-import");
      const turnId = TurnId.make("native-turn");
      const readModel = yield* projectEvent(createEmptyReadModel(sourceCreatedAt), {
        sequence: 1,
        eventId: EventId.make("event-project-import"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: sourceCreatedAt,
        commandId: CommandId.make("command-project-import"),
        causationEventId: null,
        correlationId: CommandId.make("command-project-import"),
        metadata: {},
        payload: {
          projectId,
          title: "Import fixture",
          workspaceRoot: "/tmp/import-fixture",
          defaultModelSelection: null,
          scripts: [],
          createdAt: sourceCreatedAt,
          updatedAt: sourceCreatedAt,
        },
      });

      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.import",
          commandId: CommandId.make("command-thread-import"),
          threadId,
          projectId,
          title: "Imported conversation",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.3-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          messages: [
            {
              id: MessageId.make("message-import"),
              role: "user",
              text: "Inspect this",
              turnId,
              streaming: false,
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
          activities: [
            {
              id: EventId.make("activity-import"),
              tone: "tool",
              kind: "tool.completed",
              summary: "Command run",
              payload: { itemType: "command_execution", data: { result: "ok" } },
              turnId,
              sequence: 1,
              createdAt: "2026-01-01T00:00:02.000Z",
            },
          ],
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerThreadId: "external-thread-id",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: importedAt,
          },
          sourceCreatedAt,
          sourceUpdatedAt,
          importedAt,
        },
      });

      expect(Array.isArray(result)).toBe(true);
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.created",
        "thread.message-sent",
        "thread.activity-appended",
        "thread.session-set",
      ]);
      expect(events[0]?.occurredAt).toBe(sourceCreatedAt);
      expect(events[3]?.occurredAt).toBe(importedAt);
      expect(events[1]?.payload).toMatchObject({
        threadId,
        text: "Inspect this",
        turnId,
      });
      expect(events[2]?.payload).toMatchObject({
        threadId,
        activity: { kind: "tool.completed", turnId },
      });
    }),
  );
});
