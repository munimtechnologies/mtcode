import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function makeReadModel(input: {
  readonly latestTurn?: OrchestrationThread["latestTurn"];
  readonly session?: OrchestrationThread["session"];
  readonly activities?: OrchestrationThread["activities"];
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "plan",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: input.latestTurn ?? null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: input.activities ?? [],
        checkpoints: [],
        session: input.session ?? null,
      },
    ],
    updatedAt: NOW,
  };
}

function interruptedTurn(turnId = "turn-1"): NonNullable<OrchestrationThread["latestTurn"]> {
  return {
    turnId: TurnId.make(turnId),
    state: "interrupted",
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    assistantMessageId: null,
  };
}

function completedTurn(): NonNullable<OrchestrationThread["latestTurn"]> {
  return { ...interruptedTurn(), state: "completed" };
}

function readySession(): NonNullable<OrchestrationThread["session"]> {
  return {
    threadId: ThreadId.make("thread-1"),
    status: "ready",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
  };
}

function continueCommand(interruptedTurnId = "turn-1") {
  return {
    type: "thread.turn.continue" as const,
    commandId: CommandId.make("cmd-turn-continue"),
    threadId: ThreadId.make("thread-1"),
    interruptedTurnId: TurnId.make(interruptedTurnId),
    createdAt: NOW,
  };
}

// The composer's one-tap Continue must take the same shape as a Goal
// Continuation (docs/adr/0005): no thread.message-sent, an activity, and a
// message-less turn start the provider reactor turns into a T3-authored prompt.
it.layer(NodeServices.layer)("thread.turn.continue", (it) => {
  it.effect("continues an interrupted Turn with no user message", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: continueCommand(),
        readModel: makeReadModel({ latestTurn: interruptedTurn(), session: readySession() }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual([
        "thread.activity-appended",
        "thread.turn-start-requested",
      ]);
      const activity = events[0];
      if (activity?.type !== "thread.activity-appended") {
        throw new Error("Expected thread.activity-appended.");
      }
      expect(activity.payload.activity.kind).toBe("turn.continued");
      expect(activity.payload.activity.tone).toBe("info");
      const turnStart = events[1];
      if (turnStart?.type !== "thread.turn-start-requested") {
        throw new Error("Expected thread.turn-start-requested.");
      }
      expect(turnStart.payload.messageId).toBeUndefined();
      expect(turnStart.payload.continuation).toBe("interrupted-turn");
      // The thread's own modes carry, unlike a Goal Continuation which forces "default".
      expect(turnStart.payload.interactionMode).toBe("plan");
      expect(turnStart.payload.runtimeMode).toBe("full-access");
    }),
  );

  it.effect("refuses when the latest Turn is not the interrupted one", () =>
    Effect.gen(function* () {
      const completed = yield* decideOrchestrationCommand({
        command: continueCommand(),
        readModel: makeReadModel({ latestTurn: completedTurn(), session: readySession() }),
      }).pipe(Effect.flip);
      expect(completed._tag).toBe("OrchestrationCommandInvariantError");

      const stale = yield* decideOrchestrationCommand({
        command: continueCommand("turn-0"),
        readModel: makeReadModel({ latestTurn: interruptedTurn(), session: readySession() }),
      }).pipe(Effect.flip);
      expect(stale._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses a second tap after the Turn already continued", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: continueCommand(),
        readModel: makeReadModel({
          latestTurn: interruptedTurn(),
          session: readySession(),
          activities: [
            {
              id: EventId.make("activity-continued"),
              tone: "info",
              kind: "turn.continued",
              summary: "Continued after interruption",
              payload: {},
              turnId: null,
              createdAt: NOW,
            },
          ],
        }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
