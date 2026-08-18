import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

export class ServerActivation extends Context.Reference<Effect.Effect<void> | undefined>(
  "t3/serverActivation",
  { defaultValue: () => undefined },
) {}

/** Forks a long-running root before commit and proves it is parked at the activation boundary. */
export const forkParked = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const activation = yield* ServerActivation;
    if (activation === undefined) {
      yield* Effect.forkScoped(effect);
      return;
    }
    const parked = yield* Deferred.make<void>();
    yield* Effect.forkScoped(
      Deferred.succeed(parked, undefined).pipe(Effect.andThen(activation), Effect.andThen(effect)),
    );
    yield* Deferred.await(parked);
  });

/**
 * Subscribe to a live stream immediately, but wait to process items until
 * ServerActivation. Use this instead of `forkParked(Stream.runForEach(...))`
 * when the stream is a PubSub that receives events during startup — parking
 * the subscribe itself drops those events, which is how restart-resume turns
 * were committed to the transcript without a provider ever running them.
 */
export const forkStreamParked = <A, E, R, R2>(
  stream: Stream.Stream<A, E, R>,
  process: (item: A) => Effect.Effect<unknown, never, R2>,
): Effect.Effect<void, never, Scope.Scope | R | R2> =>
  Effect.gen(function* () {
    const activation = yield* ServerActivation;
    const started = yield* Deferred.make<void>();
    const consume =
      activation === undefined
        ? Stream.runForEach(stream, process)
        : Stream.runForEach(stream, (item) => activation.pipe(Effect.andThen(process(item))));
    yield* Effect.forkScoped(Deferred.succeed(started, undefined).pipe(Effect.andThen(consume)));
    yield* Deferred.await(started);
    yield* Effect.yieldNow;
  });
