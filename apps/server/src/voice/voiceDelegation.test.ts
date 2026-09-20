import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThread,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  delegateVoiceRequest,
  type VoiceDelegationEngine,
  type VoiceDelegationQuery,
} from "./voiceDelegation.ts";

const THREAD_ID = ThreadId.make("thread-voice");
const NOW = "2026-01-01T00:00:00.000Z";

const sessionSet = (
  sequence: number,
  session: {
    readonly status: string;
    readonly activeTurnId?: string | null;
    readonly lastError?: string;
  },
): OrchestrationEvent =>
  ({
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.session-set",
    payload: { session: { activeTurnId: null, ...session } },
  }) as unknown as OrchestrationEvent;

const messageSent = (
  sequence: number,
  turnId: string,
  text: string,
  messageId = `message-${sequence}`,
): OrchestrationEvent =>
  ({
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.message-sent",
    payload: { messageId: MessageId.make(messageId), role: "assistant", turnId, text },
  }) as unknown as OrchestrationEvent;

const makeThread = (overrides: Record<string, unknown> = {}): OrchestrationThread =>
  ({
    threadId: THREAD_ID,
    archivedAt: null,
    session: { status: "ready", activeTurnId: null },
    modelSelection: { model: "sonnet" },
    runtimeMode: "full-access",
    interactionMode: "agent",
    messages: [],
    ...overrides,
  }) as unknown as OrchestrationThread;

const makeQuery = (thread: Option.Option<OrchestrationThread>): VoiceDelegationQuery => ({
  getThreadDetailById: () => Effect.succeed(thread),
});

const makeEngine = (
  events: ReadonlyArray<OrchestrationEvent>,
  onDispatch?: (command: unknown) => void,
): VoiceDelegationEngine => ({
  dispatch: (command) =>
    Effect.sync(() => {
      onDispatch?.(command);
      return { sequence: 1 };
    }),
  subscribeDomainEvents: Effect.succeed(Stream.fromArray(events)),
});

it.effect("runs the spoken request as a turn and answers with the agent's text", () =>
  Effect.gen(function* () {
    const dispatched: Array<Record<string, unknown>> = [];
    const engine = makeEngine(
      [
        sessionSet(2, { status: "running", activeTurnId: "turn-1" }),
        messageSent(3, "turn-1", "17 times 23 is 391."),
        sessionSet(4, { status: "ready", activeTurnId: null }),
      ],
      (command) => dispatched.push(command as Record<string, unknown>),
    );
    const answer = yield* delegateVoiceRequest(
      engine,
      makeQuery(Option.some(makeThread())),
      THREAD_ID,
      "What is seventeen times twenty-three?",
    );
    expect(answer).toBe("17 times 23 is 391.");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("thread.turn.start");
    // The task's own model selection decides who answers — never the voice layer.
    expect(dispatched[0]?.modelSelection).toEqual({ model: "sonnet" });
  }),
);

it.effect("ignores messages from a turn the request did not start", () =>
  Effect.gen(function* () {
    const engine = makeEngine([
      messageSent(2, "turn-earlier", "leftover from the previous turn"),
      sessionSet(3, { status: "running", activeTurnId: "turn-1" }),
      messageSent(4, "turn-1", "391"),
      sessionSet(5, { status: "ready", activeTurnId: null }),
    ]);
    const answer = yield* delegateVoiceRequest(
      engine,
      makeQuery(Option.some(makeThread())),
      THREAD_ID,
      "What is seventeen times twenty-three?",
    );
    expect(answer).toBe("391");
  }),
);

it.effect("keeps a streamed answer when the final event carries no text", () =>
  Effect.gen(function* () {
    const engine = makeEngine([
      sessionSet(2, { status: "running", activeTurnId: "turn-1" }),
      messageSent(3, "turn-1", "17 x 23 = 391", "message-a"),
      // How a streamed provider message actually ends: same id, empty body.
      messageSent(4, "turn-1", "", "message-a"),
      sessionSet(5, { status: "ready", activeTurnId: null }),
    ]);
    const answer = yield* delegateVoiceRequest(
      engine,
      makeQuery(Option.some(makeThread())),
      THREAD_ID,
      "What is seventeen times twenty-three?",
    );
    expect(answer).toBe("17 x 23 = 391");
  }),
);

it.effect("treats an idle session as a finished turn", () =>
  Effect.gen(function* () {
    const engine = makeEngine([
      sessionSet(2, { status: "running", activeTurnId: "turn-1" }),
      messageSent(3, "turn-1", "Done."),
      sessionSet(4, { status: "idle", activeTurnId: null }),
    ]);
    const answer = yield* delegateVoiceRequest(
      engine,
      makeQuery(Option.some(makeThread())),
      THREAD_ID,
      "Anything",
    );
    expect(answer).toBe("Done.");
  }),
);

it.effect("surfaces a failed turn instead of speaking a made-up answer", () =>
  Effect.gen(function* () {
    const engine = makeEngine([
      sessionSet(2, { status: "running", activeTurnId: "turn-1" }),
      sessionSet(3, {
        status: "error",
        activeTurnId: null,
        lastError: "Claude usage limit reached",
      }),
    ]);
    const failure = yield* delegateVoiceRequest(
      engine,
      makeQuery(Option.some(makeThread())),
      THREAD_ID,
      "Anything",
    ).pipe(Effect.flip);
    expect(failure.message).toBe("Claude usage limit reached");
  }),
);

it.effect("refuses to queue a second request while the agent is still working", () =>
  Effect.gen(function* () {
    const engine = makeEngine([]);
    const failure = yield* delegateVoiceRequest(
      engine,
      makeQuery(
        Option.some(makeThread({ session: { status: "running", activeTurnId: "turn-1" } })),
      ),
      THREAD_ID,
      "Anything",
    ).pipe(Effect.flip);
    expect(failure.message).toContain("already working");
  }),
);

it.effect("refuses to speak into an archived or missing task", () =>
  Effect.gen(function* () {
    const failure = yield* delegateVoiceRequest(
      makeEngine([]),
      makeQuery(Option.none()),
      THREAD_ID,
      "Anything",
    ).pipe(Effect.flip);
    expect(failure._tag).toBe("VoiceApiError");
    expect(failure.message).toContain("active MT Code task");
  }),
);
