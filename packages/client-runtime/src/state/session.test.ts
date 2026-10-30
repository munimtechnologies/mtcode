import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RpcHttp from "../rpc/http.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createEnvironmentSessionAtoms } from "./session.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: "https://environment.example.test",
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: { _tag: "Bearer", token: "bearer-token" },
  target: TARGET,
};
const SESSION = {
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "t3_session",
  },
  scopes: ["orchestration:read"],
} satisfies AuthSessionState;

const rpcSession = (): RpcSession => ({ closed: Effect.never }) as unknown as RpcSession;

const makeHarness = Effect.fn("TestSessionState.makeHarness")(function* (
  reply: (requestNumber: number) => Promise<Response>,
  options?: { readonly liveClock?: boolean },
) {
  let requestCount = 0;
  const transport = yield* SubscriptionRef.make(Option.some(rpcSession()));
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: transport,
    prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
    _environmentId,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const services = Layer.mergeAll(
    Layer.succeed(
      EnvironmentRegistry.EnvironmentRegistry,
      EnvironmentRegistry.EnvironmentRegistry.of({
        followStream,
      } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
    ),
    RpcHttp.layerRemoteHttpClient(async () => reply(++requestCount)),
  );
  const runtime = Atom.runtime(
    options?.liveClock
      ? services
      : // The test's clock, so the retry wait moves with `TestClock.adjust`.
        Layer.merge(services, Layer.succeed(Clock.Clock, yield* Clock.Clock)),
  );
  const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
    Effect.sync(() => registry.dispose()),
  );
  const results = yield* Queue.unbounded<AsyncResult.AsyncResult<AuthSessionState, unknown>>();
  const observed: Array<string> = [];
  const atom = createEnvironmentSessionAtoms(runtime).sessionStateAtom(TARGET.environmentId);
  const unsubscribe = registry.subscribe(
    atom,
    (result) => {
      observed.push(result._tag);
      Queue.offerUnsafe(results, result);
    },
    { immediate: true },
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  const nextSettled = Effect.fn("TestSessionState.nextSettled")(function* () {
    for (;;) {
      const result = yield* Queue.take(results);
      if (!result.waiting && result._tag !== "Initial") return result;
    }
  });
  return {
    transport,
    nextSettled,
    refresh: () => registry.refresh(atom),
    observed,
    requests: () => requestCount,
  };
});

const unreachable = () => Promise.reject(new TypeError("Network request failed"));

describe("environment session state", () => {
  it.effect("fetches permissions again when the connection is re-established", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness((requestNumber) =>
        requestNumber === 1 ? unreachable() : Promise.resolve(Response.json(SESSION)),
      );
      expect((yield* harness.nextSettled())._tag).toBe("Failure");

      yield* SubscriptionRef.set(harness.transport, Option.some(rpcSession()));

      expect(yield* harness.nextSettled()).toMatchObject({ _tag: "Success", value: SESSION });
    }),
  );

  it.effect("retries a failed permission check with backoff that restarts per connection", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness((requestNumber) =>
        requestNumber <= 3 ? unreachable() : Promise.resolve(Response.json(SESSION)),
      );
      expect((yield* harness.nextSettled())._tag).toBe("Failure");

      yield* TestClock.adjust("2 seconds");
      expect((yield* harness.nextSettled())._tag).toBe("Failure");

      yield* SubscriptionRef.set(harness.transport, Option.some(rpcSession()));
      expect((yield* harness.nextSettled())._tag).toBe("Failure");

      yield* TestClock.adjust("2 seconds");
      expect(yield* harness.nextSettled()).toMatchObject({ _tag: "Success", value: SESSION });
    }),
  );

  it.effect("keeps a confirmed grant through a failed refresh and retries it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        (requestNumber) =>
          requestNumber === 2 ? unreachable() : Promise.resolve(Response.json(SESSION)),
        { liveClock: true },
      );
      expect(yield* harness.nextSettled()).toMatchObject({ _tag: "Success", value: SESSION });

      harness.refresh();
      expect(yield* harness.nextSettled()).toMatchObject({ _tag: "Success", value: SESSION });

      expect(harness.requests()).toBe(3);
      expect(harness.observed).not.toContain("Failure");
    }),
  );

  it.effect("reports a failed first load instead of retrying it in place", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(unreachable);

      expect((yield* harness.nextSettled())._tag).toBe("Failure");
      expect(harness.requests()).toBe(1);
    }),
  );
});
