import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  type OrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  MT_TEAMS_BRIDGE_CONFIG_SECRET,
  MtTeamsBridge,
  MtTeamsBridgeConfig,
  makeMtTeamsBridgeLive,
} from "./MtTeamsBridge.ts";

const decodeConfigJson = Schema.decodeUnknownSync(Schema.fromJsonString(MtTeamsBridgeConfig));
const encodeConfigJson = Schema.encodeSync(Schema.fromJsonString(MtTeamsBridgeConfig));

const SERVICE_URL = "https://mt-teams.example.convex.site";
const ENVIRONMENT_KEY = "env-key-123";

function shell(partial: Partial<OrchestrationThreadShell>): OrchestrationThreadShell {
  return {
    id: "thread-1",
    title: "Fix login",
    runtimeMode: "local",
    interactionMode: "default",
    updatedAt: "2026-08-25T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    session: null,
    settledOverride: null,
    settledAt: null,
    ...partial,
  } as unknown as OrchestrationThreadShell;
}

function snapshotWith(threads: ReadonlyArray<OrchestrationThreadShell>) {
  return {
    snapshotSequence: 1,
    projects: [],
    threads,
    updatedAt: "2026-08-25T00:00:00.000Z",
  } as unknown as OrchestrationShellSnapshot;
}

function requestBodyJson(request: HttpClientRequest.HttpClientRequest): unknown {
  assert.strictEqual(request.body._tag, "Uint8Array");
  if (request.body._tag !== "Uint8Array") return undefined;
  return JSON.parse(new TextDecoder().decode(request.body.body));
}

function makeHarness(options: {
  readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
  readonly respond?: (request: HttpClientRequest.HttpClientRequest) => Response;
}) {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const dispatched: Array<OrchestrationCommand> = [];
  // Mutable so a test can change service behavior between polls.
  const state = {
    respond:
      options.respond ??
      ((request: HttpClientRequest.HttpClientRequest): Response => {
        if (request.url.endsWith("/api/bridge/publish")) {
          return Response.json({ sharedThreadIds: [] });
        }
        if (request.url.endsWith("/api/bridge/inbox")) {
          return Response.json({ messages: [] });
        }
        return Response.json({ ok: true });
      }),
  };
  const httpClientLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request);
        return HttpClientResponse.fromWeb(request, state.respond(request));
      }),
    ),
  );
  const projectionLayer = Layer.mock(ProjectionSnapshotQuery)({
    getShellSnapshot: () => Effect.succeed(snapshotWith(options.threads ?? [])),
  });
  const engineLayer = Layer.mock(OrchestrationEngineService)({
    dispatch: (command: OrchestrationCommand) => {
      dispatched.push(command);
      return Effect.succeed({ sequence: dispatched.length });
    },
  });
  const secretStoreLayer = ServerSecretStore.layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mt-teams-bridge-test-" })),
  );
  const layer = makeMtTeamsBridgeLive({ pollIntervalMs: 60_000 }).pipe(
    Layer.provide(httpClientLayer),
    Layer.provide(projectionLayer),
    Layer.provide(engineLayer),
    Layer.provideMerge(secretStoreLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  return { layer, requests, dispatched, state, httpClientLayer, projectionLayer, engineLayer };
}

const configureBridge = Effect.gen(function* () {
  const bridge = yield* MtTeamsBridge;
  const result = yield* bridge.configure({
    serviceUrl: SERVICE_URL,
    environmentKey: ENVIRONMENT_KEY,
  });
  expect(result.ok).toBe(true);
  return bridge;
});

describe("MtTeamsBridge", () => {
  it.effect("persists configuration as a secret and clears it on empty strings", () =>
    Effect.gen(function* () {
      const bridge = yield* configureBridge;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const stored = yield* secretStore.get(MT_TEAMS_BRIDGE_CONFIG_SECRET);
      expect(Option.isSome(stored)).toBe(true);
      expect(decodeConfigJson(new TextDecoder().decode(Option.getOrThrow(stored)))).toEqual({
        serviceUrl: SERVICE_URL,
        environmentKey: ENVIRONMENT_KEY,
      });
      const configured = yield* bridge.status;
      expect(configured).toEqual({
        configured: true,
        serviceUrl: SERVICE_URL,
        lastPublishAt: null,
        lastError: null,
      });

      const cleared = yield* bridge.configure({ serviceUrl: "", environmentKey: "" });
      expect(cleared.ok).toBe(true);
      const afterClear = yield* secretStore.get(MT_TEAMS_BRIDGE_CONFIG_SECRET);
      expect(Option.isNone(afterClear)).toBe(true);
      const unconfigured = yield* bridge.status;
      expect(unconfigured.configured).toBe(false);
      expect(unconfigured.serviceUrl).toBeNull();
    }).pipe(Effect.provide(makeHarness({}).layer)),
  );

  it.effect("rejects a half-empty or non-http configuration", () =>
    Effect.gen(function* () {
      const bridge = yield* MtTeamsBridge;
      const halfEmpty = yield* Effect.flip(
        bridge.configure({ serviceUrl: SERVICE_URL, environmentKey: "" }),
      );
      expect(halfEmpty._tag).toBe("MtTeamsBridgeError");
      const badUrl = yield* Effect.flip(
        bridge.configure({ serviceUrl: "ftp://mt.example", environmentKey: ENVIRONMENT_KEY }),
      );
      expect(badUrl._tag).toBe("MtTeamsBridgeError");
    }).pipe(Effect.provide(makeHarness({}).layer)),
  );

  it.effect("loads the persisted configuration at startup", () =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      const secretStoreLayer = ServerSecretStore.layer.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mt-teams-boot-test-" })),
        Layer.provideMerge(NodeServices.layer),
      );
      const context = yield* Layer.build(secretStoreLayer);
      const secretStore = Context.get(context, ServerSecretStore.ServerSecretStore);
      yield* secretStore.set(
        MT_TEAMS_BRIDGE_CONFIG_SECRET,
        new TextEncoder().encode(
          encodeConfigJson({ serviceUrl: SERVICE_URL, environmentKey: ENVIRONMENT_KEY }),
        ),
      );

      const bridgeContext = yield* Layer.build(
        makeMtTeamsBridgeLive({ pollIntervalMs: 60_000 }).pipe(
          Layer.provide(harness.httpClientLayer),
          Layer.provide(harness.projectionLayer),
          Layer.provide(harness.engineLayer),
          Layer.provide(Layer.succeed(ServerSecretStore.ServerSecretStore, secretStore)),
          Layer.provide(NodeServices.layer),
        ),
      );
      const bridge = Context.get(bridgeContext, MtTeamsBridge);
      const status = yield* bridge.status;
      expect(status.configured).toBe(true);
      expect(status.serviceUrl).toBe(SERVICE_URL);
    }).pipe(Effect.scoped),
  );

  it.effect("performs no requests while unconfigured", () =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      const bridge = yield* MtTeamsBridge.pipe(Effect.provide(harness.layer));
      yield* bridge.pollNow;
      expect(harness.requests).toHaveLength(0);
    }),
  );

  it.effect("publishes shared statuses, delivers inbox messages, and acks", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        threads: [
          shell({ id: ThreadId.make("thread-1"), session: { status: "running" } as never }),
          shell({
            id: ThreadId.make("thread-2"),
            title: "Settled thread",
            settledAt: "2026-08-24T00:00:00.000Z",
          }),
        ],
      });
      harness.state.respond = (request) => {
        if (request.url.endsWith("/api/bridge/publish")) {
          return Response.json({ sharedThreadIds: ["thread-1"] });
        }
        if (request.url.endsWith("/api/bridge/inbox")) {
          return Response.json({
            messages: [
              {
                id: "message-1",
                threadId: "thread-1",
                fromUserName: "Ava",
                teamName: "Core",
                text: "Can you also update the docs?",
                createdAt: "2026-08-25T00:00:00.000Z",
              },
              {
                id: "message-2",
                threadId: "thread-gone",
                fromUserName: "Ava",
                teamName: "Core",
                text: "Anyone home?",
                createdAt: "2026-08-25T00:00:00.000Z",
              },
            ],
          });
        }
        return Response.json({ ok: true });
      };
      const bridge = yield* configureBridge.pipe(Effect.provide(harness.layer));
      yield* bridge.pollNow;

      const urls = harness.requests.map((request) => new URL(request.url).pathname);
      expect(urls).toEqual([
        "/api/bridge/publish",
        "/api/bridge/publish",
        "/api/bridge/inbox",
        "/api/bridge/ack",
      ]);
      // First publish learns the shared list, the immediate follow-up carries
      // the newly shared thread's status.
      expect(requestBodyJson(harness.requests[0]!)).toEqual({ threads: [] });
      expect(requestBodyJson(harness.requests[1]!)).toEqual({
        threads: [
          {
            threadId: "thread-1",
            title: "Fix login",
            status: "working",
            updatedAt: "2026-08-25T00:00:00.000Z",
          },
        ],
      });

      // The reachable message became a prefixed user turn; the unreachable one
      // was only acked.
      expect(harness.dispatched).toHaveLength(1);
      const command = harness.dispatched[0];
      if (command?.type !== "thread.turn.start") {
        throw new Error(`expected thread.turn.start, got ${command?.type}`);
      }
      expect(command.threadId).toBe("thread-1");
      expect(command.commandId).toBe("mt-teams:inbox:message-1");
      expect(command.message.text).toBe("[MT Teams] Ava (Core): Can you also update the docs?");
      expect(command.sourceThreadMessage).toBeUndefined();
      expect(requestBodyJson(harness.requests[3]!)).toEqual({
        messageIds: ["message-1", "message-2"],
      });

      const status = yield* bridge.status;
      expect(status.lastError).toBeNull();
      expect(status.lastPublishAt).not.toBeNull();
    }),
  );

  it.effect("records service failures in lastError and recovers on the next poll", () =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      harness.state.respond = () => new Response("boom", { status: 500 });
      const bridge = yield* configureBridge.pipe(Effect.provide(harness.layer));
      yield* bridge.pollNow;
      const failed = yield* bridge.status;
      expect(failed.lastError).toContain("HTTP 500");
      expect(failed.lastPublishAt).toBeNull();

      harness.state.respond = (request) =>
        request.url.endsWith("/api/bridge/inbox")
          ? Response.json({ messages: [] })
          : Response.json({ sharedThreadIds: [] });
      yield* bridge.pollNow;
      const recovered = yield* bridge.status;
      expect(recovered.lastError).toBeNull();
      expect(recovered.lastPublishAt).not.toBeNull();
    }),
  );
});
