/**
 * MtTeamsServiceClient - typed HTTP client for the MT Teams service's
 * environment-key bridge endpoints (docs/internals/mt-teams.md, "HTTP API").
 *
 * The bridge authenticates with the per-environment key minted at
 * registration; the key travels in the `X-Environment-Key` header and never
 * appears in errors or logs.
 *
 * @module MtTeamsServiceClient
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { HttpClient } from "effect/unstable/http";
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import type { MtTeamsThreadStatus } from "./statusMapping.ts";

export class MtTeamsServiceError extends Schema.TaggedErrorClass<MtTeamsServiceError>()(
  "MtTeamsServiceError",
  {
    message: Schema.String,
  },
) {}

export interface MtTeamsPublishThread {
  readonly threadId: string;
  readonly title: string;
  readonly status: MtTeamsThreadStatus;
  /** Epoch milliseconds — the service validates this as a number. */
  readonly updatedAt: number;
}

export const MtTeamsInboxMessage = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  fromUserName: Schema.String,
  teamName: Schema.String,
  text: Schema.String,
  createdAt: Schema.String,
});
export type MtTeamsInboxMessage = typeof MtTeamsInboxMessage.Type;

const PublishResponse = Schema.Struct({
  sharedThreadIds: Schema.Array(Schema.String),
});

const InboxResponse = Schema.Struct({
  messages: Schema.Array(MtTeamsInboxMessage),
});

const AckResponse = Schema.Struct({
  ok: Schema.Boolean,
});

export interface MtTeamsServiceClientOptions {
  readonly serviceUrl: string;
  readonly environmentKey: string;
}

export interface MtTeamsServiceClientShape {
  readonly publish: (
    threads: ReadonlyArray<MtTeamsPublishThread>,
  ) => Effect.Effect<typeof PublishResponse.Type, MtTeamsServiceError>;
  readonly inbox: Effect.Effect<typeof InboxResponse.Type, MtTeamsServiceError>;
  readonly ack: (
    messageIds: ReadonlyArray<string>,
  ) => Effect.Effect<typeof AckResponse.Type, MtTeamsServiceError>;
}

export function makeMtTeamsServiceClient(
  httpClient: HttpClient.HttpClient,
  options: MtTeamsServiceClientOptions,
): MtTeamsServiceClientShape {
  const baseUrl = options.serviceUrl.replace(/\/+$/, "");

  const execute = <A, E>(
    endpoint: string,
    request: HttpClientRequest.HttpClientRequest,
    decodeBody: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
  ): Effect.Effect<A, MtTeamsServiceError> =>
    Effect.gen(function* () {
      const response = yield* httpClient
        .execute(HttpClientRequest.setHeader("x-environment-key", options.environmentKey)(request))
        .pipe(
          Effect.mapError(
            () =>
              new MtTeamsServiceError({
                message: `The MT Teams service could not be reached (${endpoint}).`,
              }),
          ),
        );
      if (response.status < 200 || response.status >= 300) {
        return yield* new MtTeamsServiceError({
          message:
            response.status === 401 || response.status === 403
              ? `The MT Teams service rejected this environment key (${endpoint}, HTTP ${response.status}).`
              : `The MT Teams service failed (${endpoint}, HTTP ${response.status}).`,
        });
      }
      return yield* decodeBody(response).pipe(
        Effect.mapError(
          () =>
            new MtTeamsServiceError({
              message: `The MT Teams service returned an invalid response (${endpoint}).`,
            }),
        ),
      );
    });

  const postJson = (endpoint: string, body: unknown) =>
    HttpClientRequest.post(`${baseUrl}${endpoint}`).pipe(
      HttpClientRequest.bodyJson(body),
      Effect.mapError(
        () =>
          new MtTeamsServiceError({
            message: `T3 could not prepare the MT Teams request (${endpoint}).`,
          }),
      ),
    );

  const publish: MtTeamsServiceClientShape["publish"] = Effect.fn("MtTeamsServiceClient.publish")(
    function* (threads) {
      const request = yield* postJson("/api/bridge/publish", { threads });
      return yield* execute(
        "/api/bridge/publish",
        request,
        HttpClientResponse.schemaBodyJson(PublishResponse),
      );
    },
  );

  const inbox: MtTeamsServiceClientShape["inbox"] = execute(
    "/api/bridge/inbox",
    HttpClientRequest.get(`${baseUrl}/api/bridge/inbox`),
    HttpClientResponse.schemaBodyJson(InboxResponse),
  ).pipe(Effect.withSpan("MtTeamsServiceClient.inbox"));

  const ack: MtTeamsServiceClientShape["ack"] = Effect.fn("MtTeamsServiceClient.ack")(
    function* (messageIds) {
      const request = yield* postJson("/api/bridge/ack", { messageIds });
      return yield* execute(
        "/api/bridge/ack",
        request,
        HttpClientResponse.schemaBodyJson(AckResponse),
      );
    },
  );

  return { publish, inbox, ack };
}
