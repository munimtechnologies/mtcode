import {
  CommandId,
  MessageId,
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
  readonly interactionMode?: OrchestrationThread["interactionMode"];
  readonly latestTurn?: OrchestrationThread["latestTurn"];
  readonly session?: OrchestrationThread["session"];
  readonly goal?: OrchestrationThread["goal"];
  readonly settledOverride?: OrchestrationThread["settledOverride"];
  readonly snoozedUntil?: string | null;
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
        interactionMode: input.interactionMode ?? "default",
        branch: null,
        worktreePath: null,
        latestTurn: input.latestTurn ?? null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: input.settledOverride ?? null,
        settledAt: null,
        snoozedUntil: input.snoozedUntil ?? null,
        snoozedAt: input.snoozedUntil != null ? NOW : null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: input.session ?? null,
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
      },
    ],
    updatedAt: NOW,
  };
}

function runningTurn(): OrchestrationThread["latestTurn"] {
  return {
    turnId: TurnId.make("turn-running"),
    state: "running",
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: null,
    assistantMessageId: null,
  };
}

function existingGoal(): NonNullable<OrchestrationThread["goal"]> {
  return {
    objective: "Reduce p95 below 120ms",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("Goal decider", (it) => {
  it.effect(
    "sets a Goal on an idle Thread, records the Objective as a user message, and starts a Turn",
    () =>
      Effect.gen(function* () {
        const decided = yield* decideOrchestrationCommand({
          command: {
            type: "thread.goal.set",
            commandId: CommandId.make("cmd-goal-set"),
            threadId: ThreadId.make("thread-1"),
            objective: "Reduce p95 below 120ms",
            messageId: MessageId.make("message-goal-1"),
          },
          readModel: makeReadModel({}),
        });
        const events = Array.isArray(decided) ? decided : [decided];
        expect(events.map((event) => event.type)).toEqual([
          "thread.goal-set",
          "thread.activity-appended",
          "thread.message-sent",
          "thread.turn-start-requested",
        ]);
        const goalSet = events[0];
        if (goalSet?.type !== "thread.goal-set") {
          throw new Error("Expected thread.goal-set.");
        }
        expect(goalSet.payload.objective).toBe("Reduce p95 below 120ms");
        expect(goalSet.payload.status).toBe("active");
        const activity = events[1];
        if (activity?.type !== "thread.activity-appended") {
          throw new Error("Expected thread.activity-appended.");
        }
        expect(activity.payload.activity.kind).toBe("goal.set");
        expect(activity.payload.activity.tone).toBe("info");
        expect(activity.payload.activity.summary).toBe("Reduce p95 below 120ms");
        const messageSent = events[2];
        if (messageSent?.type !== "thread.message-sent") {
          throw new Error("Expected thread.message-sent.");
        }
        expect(messageSent.payload.text).toBe("Reduce p95 below 120ms");
        expect(messageSent.payload.messageId).toBe("message-goal-1");
        const turnStart = events[3];
        if (turnStart?.type !== "thread.turn-start-requested") {
          throw new Error("Expected thread.turn-start-requested.");
        }
        expect(turnStart.payload.messageId).toBe("message-goal-1");
        expect(turnStart.payload.interactionMode).toBe("default");
        expect(turnStart.payload.titleSeed).toBe("Reduce p95 below 120ms");
      }),
  );

  it.effect("sets interaction mode to default when becoming Active in plan mode", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.goal.set",
          commandId: CommandId.make("cmd-goal-set-plan"),
          threadId: ThreadId.make("thread-1"),
          objective: "Implement this plan",
          messageId: MessageId.make("message-goal-plan"),
        },
        readModel: makeReadModel({ interactionMode: "plan" }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toContain("thread.interaction-mode-set");
      const modeSet = events.find((event) => event.type === "thread.interaction-mode-set");
      if (modeSet?.type !== "thread.interaction-mode-set") {
        throw new Error("Expected thread.interaction-mode-set.");
      }
      expect(modeSet.payload.interactionMode).toBe("default");
    }),
  );

  it.effect(
    "attaches or replaces a Goal while a Turn is running without starting a second Turn",
    () =>
      Effect.gen(function* () {
        const decided = yield* decideOrchestrationCommand({
          command: {
            type: "thread.goal.set",
            commandId: CommandId.make("cmd-goal-attach"),
            threadId: ThreadId.make("thread-1"),
            objective: "Ship the migration instead",
          },
          readModel: makeReadModel({
            latestTurn: runningTurn(),
            session: {
              threadId: ThreadId.make("thread-1"),
              status: "running",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("turn-running"),
              lastError: null,
              updatedAt: NOW,
            },
            goal: existingGoal(),
          }),
        });
        const events = Array.isArray(decided) ? decided : [decided];
        expect(events.map((event) => event.type)).not.toContain("thread.turn-start-requested");
        expect(events.map((event) => event.type)).not.toContain("thread.message-sent");
        const goalSet = events.find((event) => event.type === "thread.goal-set");
        if (goalSet?.type !== "thread.goal-set") {
          throw new Error("Expected thread.goal-set.");
        }
        expect(goalSet.payload.objective).toBe("Ship the migration instead");
        expect(goalSet.payload.createdAt).toBe(NOW);
      }),
  );

  it.effect("attaches a Goal while the session is starting without starting a second Turn", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.goal.set",
          commandId: CommandId.make("cmd-goal-starting"),
          threadId: ThreadId.make("thread-1"),
          objective: "Ship the migration instead",
        },
        readModel: makeReadModel({
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "starting",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual([
        "thread.goal-set",
        "thread.activity-appended",
      ]);
    }),
  );

  it.effect("replaces the current Goal so a Thread never has two", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.goal.set",
          commandId: CommandId.make("cmd-goal-replace"),
          threadId: ThreadId.make("thread-1"),
          objective: "the goal of this function is X",
          messageId: MessageId.make("message-replace"),
        },
        readModel: makeReadModel({
          goal: {
            objective: "Reduce p95 below 120ms",
            status: "paused",
            createdAt: NOW,
            updatedAt: NOW,
          },
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      const goalSets = events.filter((event) => event.type === "thread.goal-set");
      expect(goalSets).toHaveLength(1);
      if (goalSets[0]?.type === "thread.goal-set") {
        expect(goalSets[0].payload.objective).toBe("the goal of this function is X");
        expect(goalSets[0].payload.status).toBe("active");
        expect(goalSets[0].payload.createdAt).toBe(NOW);
      }
    }),
  );

  it.effect("clears the Goal", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.goal.clear",
          commandId: CommandId.make("cmd-goal-clear"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({
          goal: existingGoal(),
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual([
        "thread.goal-cleared",
        "thread.activity-appended",
      ]);
      const activity = events[1];
      if (activity?.type !== "thread.activity-appended") {
        throw new Error("Expected thread.activity-appended.");
      }
      expect(activity.payload.activity.kind).toBe("goal.cleared");
      expect(activity.payload.activity.summary).toBe("Objective cleared");
      expect(events.map((event) => event.type)).not.toContain("thread.turn-start-requested");
    }),
  );

  it.effect("pauses an existing Goal without interrupting the Turn", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.goal.pause",
          commandId: CommandId.make("cmd-goal-pause"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({
          latestTurn: runningTurn(),
          goal: existingGoal(),
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual([
        "thread.goal-paused",
        "thread.activity-appended",
      ]);
      expect(events.map((event) => event.type)).not.toContain("thread.turn-interrupt-requested");
    }),
  );

  it.effect("resumes an existing Goal as status-only without starting a Turn", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.goal.resume",
          commandId: CommandId.make("cmd-goal-resume"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({
          interactionMode: "plan",
          goal: {
            ...existingGoal(),
            status: "paused",
          },
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual([
        "thread.goal-resumed",
        "thread.interaction-mode-set",
        "thread.activity-appended",
      ]);
      expect(events.map((event) => event.type)).not.toContain("thread.turn-start-requested");
    }),
  );

  it.effect("refuses an Objective that is itself a command form", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.goal.set",
          commandId: CommandId.make("cmd-goal-form-objective"),
          threadId: ThreadId.make("thread-1"),
          objective: "/goal Reduce p95 below 120ms",
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses thread.turn.start whose user text is a command form", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-goal-form"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-1"),
            role: "user",
            text: "/goal Reduce p95 below 120ms",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses a leading slash goal spoken command form", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-slash-goal"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-2"),
            role: "user",
            text: "slash goal Reduce p95 below 120ms",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("accepts a user message that contains the English word goal", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-english-goal"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-3"),
            role: "user",
            text: "the goal of this function is X",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toContain("thread.message-sent");
      expect(events.map((event) => event.type)).not.toContain("thread.goal-set");
    }),
  );
});
