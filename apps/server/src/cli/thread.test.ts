import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { waitForIdleThread } from "./thread.ts";

it.effect("waits for the running turn to finish before returning the thread", () =>
  Effect.gen(function* () {
    const activeRunIds = ["run-1", "run-2", null];
    let reads = 0;
    const readThread = Effect.sync(() => ({ activeRunId: activeRunIds[reads++] ?? null }));

    const waiting = yield* Effect.forkChild(waitForIdleThread(readThread));
    yield* TestClock.adjust("5 seconds");
    assert.equal(reads, 2);
    yield* TestClock.adjust("5 seconds");
    const thread = yield* Fiber.join(waiting);

    assert.isNull(thread?.activeRunId);
    assert.equal(reads, 3);
  }),
);

it.effect("returns an idle or missing thread without waiting", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* waitForIdleThread(Effect.succeed({ activeRunId: null })), {
      activeRunId: null,
    });
    assert.isUndefined(yield* waitForIdleThread(Effect.succeed(undefined)));
  }),
);
