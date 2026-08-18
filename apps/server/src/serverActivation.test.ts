import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { forkParked, forkStreamParked, ServerActivation } from "./serverActivation.ts";

it.effect("proves a root is parked before returning and releases it with one gate", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activation = yield* Deferred.make<void>();
      const ran = yield* Deferred.make<void>();

      yield* forkParked(Deferred.succeed(ran, undefined)).pipe(
        Effect.provideService(ServerActivation, Deferred.await(activation)),
      );
      expect(yield* Deferred.isDone(ran)).toBe(false);

      yield* Deferred.succeed(activation, undefined);
      yield* Deferred.await(ran);
      expect(yield* Deferred.isDone(ran)).toBe(true);
    }),
  ),
);

it.effect("keeps PubSub items published before activation and processes them after", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activation = yield* Deferred.make<void>();
      const received = yield* Deferred.make<string>();
      const pubsub = yield* PubSub.unbounded<string>();

      yield* forkStreamParked(Stream.fromPubSub(pubsub), (item) =>
        Deferred.succeed(received, item),
      ).pipe(Effect.provideService(ServerActivation, Deferred.await(activation)));

      // Let the forked fiber acquire its PubSub subscription before publish.
      yield* Effect.yieldNow;
      yield* PubSub.publish(pubsub, "resume-after-restart");
      expect(yield* Deferred.isDone(received)).toBe(false);

      yield* Deferred.succeed(activation, undefined);
      expect(yield* Deferred.await(received)).toBe("resume-after-restart");
    }),
  ),
);
