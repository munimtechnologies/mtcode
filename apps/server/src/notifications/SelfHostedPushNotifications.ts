import type { SelfHostedPushDeviceRegistration, ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  agentAwarenessPublishIdentity,
  eventThreadId,
  resolveAgentAwarenessRelayPublishSnapshot,
  shouldPublishAgentAwarenessEvent,
} from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import { isSelfHostedPushNotificationPhase } from "./pushNotificationPhase.ts";

const PushDeviceRow = Schema.Struct({
  deviceId: Schema.String,
  expoPushToken: Schema.String,
  label: Schema.String,
});

const ExpoPushResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      status: Schema.Literals(["ok", "error"]),
      details: Schema.optional(Schema.Struct({ error: Schema.optional(Schema.String) })),
    }),
  ),
});

export class SelfHostedPushNotifications extends Context.Service<
  SelfHostedPushNotifications,
  {
    readonly register: (
      input: SelfHostedPushDeviceRegistration,
    ) => Effect.Effect<void, SelfHostedPushNotificationError>;
    readonly unregister: (deviceId: string) => Effect.Effect<void, SelfHostedPushNotificationError>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/notifications/SelfHostedPushNotifications") {}

export class SelfHostedPushNotificationError extends Schema.TaggedErrorClass<SelfHostedPushNotificationError>()(
  "SelfHostedPushNotificationError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

function shouldNotify(state: RelayAgentActivityState | null): state is RelayAgentActivityState {
  return state !== null && isSelfHostedPushNotificationPhase(state.phase);
}

function notificationBody(state: RelayAgentActivityState): string {
  switch (state.phase) {
    case "waiting_for_approval":
      return "Agent approval required";
    case "waiting_for_input":
      return "Agent is waiting for your input";
    case "failed":
      return "Agent failed";
    default:
      return "Agent finished";
  }
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestration = yield* OrchestrationEngine.OrchestrationEngineService;
  const httpClient = yield* HttpClient.HttpClient;
  const lastStateByThread = yield* Ref.make(new Map<ThreadId, string>());

  const upsertDevice = SqlSchema.void({
    Request: Schema.Struct({
      deviceId: Schema.String,
      expoPushToken: Schema.String,
      label: Schema.String,
      updatedAt: Schema.String,
    }),
    execute: (input) => sql`
      INSERT INTO self_hosted_push_devices (device_id, expo_push_token, label, updated_at)
      VALUES (${input.deviceId}, ${input.expoPushToken}, ${input.label}, ${input.updatedAt})
      ON CONFLICT(device_id) DO UPDATE SET
        expo_push_token = excluded.expo_push_token,
        label = excluded.label,
        updated_at = excluded.updated_at
    `,
  });
  const deleteDevice = SqlSchema.void({
    Request: Schema.Struct({ deviceId: Schema.String }),
    execute: ({ deviceId }) =>
      sql`DELETE FROM self_hosted_push_devices WHERE device_id = ${deviceId}`,
  });
  const listDevices = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: PushDeviceRow,
    execute: () => sql`
      SELECT device_id AS "deviceId", expo_push_token AS "expoPushToken", label
      FROM self_hosted_push_devices
      ORDER BY updated_at DESC
    `,
  });

  const register: SelfHostedPushNotifications["Service"]["register"] = (input) =>
    DateTime.now.pipe(
      Effect.flatMap((now) => upsertDevice({ ...input, updatedAt: DateTime.formatIso(now) })),
      Effect.mapError(
        (cause) => new SelfHostedPushNotificationError({ operation: "register", cause }),
      ),
    );
  const unregister: SelfHostedPushNotifications["Service"]["unregister"] = (deviceId) =>
    deleteDevice({ deviceId }).pipe(
      Effect.mapError(
        (cause) => new SelfHostedPushNotificationError({ operation: "unregister", cause }),
      ),
    );

  const publishThread = Effect.fn("SelfHostedPushNotifications.publishThread")(function* (
    threadId: ThreadId,
  ) {
    const devices = yield* listDevices({});
    if (devices.length === 0) return;

    const thread = yield* snapshots.getThreadShellById(threadId);
    const project = Option.isSome(thread)
      ? yield* snapshots.getProjectShellById(thread.value.projectId)
      : Option.none();
    const state = resolveAgentAwarenessRelayPublishSnapshot({
      environmentId: yield* environment.getEnvironmentId,
      threadId,
      thread,
      project,
    }).state;
    const identity = agentAwarenessPublishIdentity(state);
    const previous = (yield* Ref.get(lastStateByThread)).get(threadId);
    yield* Ref.update(lastStateByThread, (current) => new Map(current).set(threadId, identity));
    if (previous === identity || !shouldNotify(state)) return;

    const response = yield* HttpClientRequest.post("https://exp.host/--/api/v2/push/send").pipe(
      HttpClientRequest.bodyJson(
        devices.map((device) => ({
          to: device.expoPushToken,
          title: state.threadTitle,
          body: notificationBody(state),
          sound: "default",
          channelId: "agent-activity",
          data: {
            environmentId: state.environmentId,
            threadId: state.threadId,
            deepLink: state.deepLink,
          },
        })),
      ),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ExpoPushResponse)),
      Effect.mapError(
        (cause) => new SelfHostedPushNotificationError({ operation: "deliver", cause }),
      ),
    );

    yield* Effect.forEach(response.data, (ticket, index) =>
      ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered"
        ? unregister(devices[index]?.deviceId ?? "")
        : Effect.void,
    );
  });

  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    publishThread(threadId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("self-hosted push delivery failed", { cause }),
      ),
    ),
  );

  const start: SelfHostedPushNotifications["Service"]["start"] = Effect.fn(
    "SelfHostedPushNotifications.start",
  )(function* () {
    yield* forkParked(
      Stream.runForEach(orchestration.streamDomainEvents, (event) => {
        const threadId = eventThreadId(event);
        return threadId !== null && shouldPublishAgentAwarenessEvent(event)
          ? worker.enqueue(threadId)
          : Effect.void;
      }),
    );
  });

  const service = SelfHostedPushNotifications.of({ register, unregister, start });
  yield* service.start();
  return service;
});

export const layer = Layer.effect(SelfHostedPushNotifications, make);
