/**
 * MtTeamsBridge - the environment side of MT Teams
 * (docs/internals/mt-teams.md).
 *
 * When configured with a service URL and per-environment key, a 60s loop
 * publishes the shared threads' statuses to the service, drains the inbox,
 * and delivers each message into its target thread through the same
 * `thread.turn.start` dispatch the thread-relay tool uses. The decider's
 * `sourceThreadMessage` attribution requires a same-project source *thread*,
 * which a human teammate is not, so attribution rides in the message text as
 * an `[MT Teams] <name> (<team>):` prefix instead.
 *
 * Configuration persists as one JSON secret in the ServerSecretStore (the
 * environment key is a credential); the poll loop starts parked at the
 * activation boundary and never crashes - failures land in `lastError` for
 * the `mtTeams.status` RPC.
 *
 * @module MtTeamsBridge
 */
import {
  CommandId,
  MessageId,
  MtTeamsBridgeError,
  type MtTeamsBridgeStatus,
  type MtTeamsConfigureInput,
  type MtTeamsConfigureResult,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";
import {
  makeMtTeamsServiceClient,
  type MtTeamsInboxMessage,
  type MtTeamsPublishThread,
} from "./MtTeamsServiceClient.ts";
import { mtTeamsThreadStatus } from "./statusMapping.ts";

export const MT_TEAMS_BRIDGE_CONFIG_SECRET = "mt-teams-bridge-config";

const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;

export const MtTeamsBridgeConfig = Schema.Struct({
  serviceUrl: Schema.String,
  environmentKey: Schema.String,
});
export type MtTeamsBridgeConfig = typeof MtTeamsBridgeConfig.Type;

const encodeConfigJson = Schema.encodeEffect(Schema.fromJsonString(MtTeamsBridgeConfig));
const decodeConfigJsonOption = Schema.decodeUnknownOption(
  Schema.fromJsonString(MtTeamsBridgeConfig),
);

function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToString(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function describeBridgeFailure(error: unknown): string {
  if (
    Predicate.isObject(error) &&
    "message" in error &&
    Predicate.isString(error.message) &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return String(error);
}

interface MtTeamsBridgeState {
  readonly config: MtTeamsBridgeConfig | null;
  readonly sharedThreadIds: ReadonlyArray<string>;
  readonly lastPublishAt: string | null;
  readonly lastError: string | null;
}

const IDLE_STATE: MtTeamsBridgeState = {
  config: null,
  sharedThreadIds: [],
  lastPublishAt: null,
  lastError: null,
};

export class MtTeamsBridge extends Context.Service<
  MtTeamsBridge,
  {
    readonly configure: (
      input: MtTeamsConfigureInput,
    ) => Effect.Effect<MtTeamsConfigureResult, MtTeamsBridgeError>;
    readonly status: Effect.Effect<MtTeamsBridgeStatus>;
    /** One publish/inbox/ack cycle. Intended for tests, so assertions never rely on timing. */
    readonly pollNow: Effect.Effect<void>;
  }
>()("t3/mtTeams/MtTeamsBridge") {}

export interface MtTeamsBridgeLiveOptions {
  readonly pollIntervalMs?: number;
}

export const make = (options?: MtTeamsBridgeLiveOptions) =>
  Effect.gen(function* () {
    const secretStore = yield* ServerSecretStore.ServerSecretStore;
    const httpClient = yield* HttpClient.HttpClient;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const crypto = yield* Crypto.Crypto;

    const pollIntervalMs = Math.max(1, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

    const persisted = yield* secretStore.get(MT_TEAMS_BRIDGE_CONFIG_SECRET).pipe(
      Effect.map(Option.map(bytesToString)),
      Effect.map(Option.flatMap(decodeConfigJsonOption)),
      Effect.catch((cause) =>
        Effect.logWarning("mtTeams.bridge.config-read-failed", {
          detail: cause.message,
        }).pipe(Effect.as(Option.none<MtTeamsBridgeConfig>())),
      ),
    );
    const state = yield* Ref.make<MtTeamsBridgeState>({
      ...IDLE_STATE,
      config: Option.getOrNull(persisted),
    });

    /**
     * Delivers one inbox message into its target thread. Returns true when
     * the message should be acked: delivered, already delivered (stable
     * commandId), or permanently undeliverable - leaving those unacked would
     * jam the inbox with a poison message forever.
     */
    const deliverMessage = Effect.fn("MtTeamsBridge.deliverMessage")(function* (
      threadsById: ReadonlyMap<string, OrchestrationThreadShell>,
      message: MtTeamsInboxMessage,
    ) {
      const target = threadsById.get(message.threadId);
      if (target === undefined) {
        yield* Effect.logWarning("mtTeams.inbox.target-missing", {
          threadId: message.threadId,
          messageId: message.id,
        });
        return true;
      }
      return yield* Effect.gen(function* () {
        const messageUuid = yield* crypto.randomUUIDv4;
        const createdAt = yield* nowIso;
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          // Stable per service message id: a redelivery after a lost ack
          // re-dispatches the same command instead of double-posting.
          commandId: CommandId.make(`mt-teams:inbox:${message.id}`),
          threadId: target.id,
          message: {
            messageId: MessageId.make(messageUuid),
            role: "user",
            text: `[MT Teams] ${message.fromUserName} (${message.teamName}): ${message.text}`,
            attachments: [],
          },
          runtimeMode: target.runtimeMode,
          interactionMode: target.interactionMode,
          createdAt,
        });
        return true;
      }).pipe(
        Effect.catchTags({
          // Permanently rejected by the decider (archived target, goal-form
          // text, ...): surface it once and ack so it is not retried forever.
          OrchestrationCommandInvariantError: (error) =>
            Effect.logWarning("mtTeams.inbox.rejected", {
              threadId: message.threadId,
              messageId: message.id,
              detail: error.detail,
            }).pipe(Effect.as(true)),
          OrchestrationCommandPreviouslyRejectedError: () => Effect.succeed(true),
        }),
        Effect.catch((error) =>
          Effect.logWarning("mtTeams.inbox.delivery-failed", {
            threadId: message.threadId,
            messageId: message.id,
            detail: describeBridgeFailure(error),
          }).pipe(Effect.as(false)),
        ),
      );
    });

    const pollOnce = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      const config = current.config;
      if (config === null) {
        return;
      }
      const client = makeMtTeamsServiceClient(httpClient, config);
      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const threadsById = new Map<string, OrchestrationThreadShell>(
        snapshot.threads.map((thread): [string, OrchestrationThreadShell] => [thread.id, thread]),
      );
      const toPublishThreads = (threadIds: ReadonlyArray<string>) =>
        threadIds.flatMap((threadId): Array<MtTeamsPublishThread> => {
          const thread = threadsById.get(threadId);
          // Threads the service still shares but this environment no longer
          // has (deleted or archived) simply drop out of the publish.
          return thread === undefined
            ? []
            : [
                {
                  threadId,
                  title: thread.title,
                  status: mtTeamsThreadStatus(thread),
                  updatedAt: Date.parse(thread.updatedAt),
                },
              ];
        });

      const first = yield* client.publish(toPublishThreads(current.sharedThreadIds));
      let sharedThreadIds = first.sharedThreadIds;
      // Newly shared threads should not wait a full interval for their first
      // status; one immediate follow-up publish covers them.
      const alreadyPublished = new Set(current.sharedThreadIds);
      if (sharedThreadIds.some((threadId) => !alreadyPublished.has(threadId))) {
        const second = yield* client.publish(toPublishThreads(sharedThreadIds));
        sharedThreadIds = second.sharedThreadIds;
      }
      const lastPublishAt = yield* nowIso;
      // Reconfigured or cleared mid-poll: this cycle's results describe the
      // old service, so drop them instead of resurrecting stale state.
      yield* Ref.update(state, (previous) =>
        previous.config === config ? { ...previous, sharedThreadIds, lastPublishAt } : previous,
      );

      const inbox = yield* client.inbox;
      const deliveredMessageIds: Array<string> = [];
      for (const message of inbox.messages) {
        if (yield* deliverMessage(threadsById, message)) {
          deliveredMessageIds.push(message.id);
        }
      }
      if (deliveredMessageIds.length > 0) {
        yield* client.ack(deliveredMessageIds);
      }
      yield* Ref.update(state, (previous) =>
        previous.config === config ? { ...previous, lastError: null } : previous,
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const detail = describeBridgeFailure(error);
          yield* Ref.update(state, (previous) => ({ ...previous, lastError: detail }));
          yield* Effect.logWarning("mtTeams.bridge.poll-failed", { detail });
        }),
      ),
      Effect.withSpan("MtTeamsBridge.pollOnce"),
    );

    const configure: MtTeamsBridge["Service"]["configure"] = Effect.fn("MtTeamsBridge.configure")(
      function* (input) {
        const serviceUrl = input.serviceUrl.trim();
        const environmentKey = input.environmentKey.trim();
        if (serviceUrl === "" && environmentKey === "") {
          yield* secretStore.remove(MT_TEAMS_BRIDGE_CONFIG_SECRET).pipe(
            Effect.mapError(
              () =>
                new MtTeamsBridgeError({
                  message: "T3 could not clear the saved MT Teams configuration.",
                }),
            ),
          );
          yield* Ref.set(state, IDLE_STATE);
          return { ok: true };
        }
        if (serviceUrl === "" || environmentKey === "") {
          return yield* new MtTeamsBridgeError({
            message:
              "Provide both a service URL and an environment key, or two empty strings to clear.",
          });
        }
        if (!isHttpUrl(serviceUrl)) {
          return yield* new MtTeamsBridgeError({
            message: "The MT Teams service URL must be an http(s) URL.",
          });
        }
        const config: MtTeamsBridgeConfig = { serviceUrl, environmentKey };
        const json = yield* encodeConfigJson(config).pipe(
          Effect.mapError(
            () =>
              new MtTeamsBridgeError({
                message: "T3 could not encode the MT Teams configuration.",
              }),
          ),
        );
        yield* secretStore.set(MT_TEAMS_BRIDGE_CONFIG_SECRET, stringToBytes(json)).pipe(
          Effect.mapError(
            () =>
              new MtTeamsBridgeError({
                message: "T3 could not persist the MT Teams configuration.",
              }),
          ),
        );
        // A reconfigured bridge learns its shared list on the next publish.
        yield* Ref.set(state, { ...IDLE_STATE, config });
        return { ok: true };
      },
    );

    const status: MtTeamsBridge["Service"]["status"] = Ref.get(state).pipe(
      Effect.map(
        (current): MtTeamsBridgeStatus => ({
          configured: current.config !== null,
          serviceUrl: current.config?.serviceUrl ?? null,
          lastPublishAt: current.lastPublishAt,
          lastError: current.lastError,
        }),
      ),
      Effect.withSpan("MtTeamsBridge.status"),
    );

    yield* forkParked(
      pollOnce.pipe(
        Effect.catchDefect((defect: unknown) =>
          Effect.logWarning("mtTeams.bridge.poll-defect", { defect }),
        ),
        Effect.repeat(Schedule.spaced(Duration.millis(pollIntervalMs))),
      ),
    );

    return MtTeamsBridge.of({
      configure,
      status,
      pollNow: pollOnce,
    });
  });

export const makeMtTeamsBridgeLive = (options?: MtTeamsBridgeLiveOptions) =>
  Layer.effect(MtTeamsBridge, make(options));

export const MtTeamsBridgeLive = makeMtTeamsBridgeLive();
