import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { makeMtTeamsServiceClient } from "./MtTeamsServiceClient.ts";

const OPTIONS = {
  serviceUrl: "https://mt-teams.example.convex.site",
  environmentKey: "env-key-123",
};

function requestBodyJson(request: HttpClientRequest.HttpClientRequest): unknown {
  assert.strictEqual(request.body._tag, "Uint8Array");
  if (request.body._tag !== "Uint8Array") return undefined;
  return JSON.parse(new TextDecoder().decode(request.body.body));
}

function makeHarness(respond: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const httpClient = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request);
      return HttpClientResponse.fromWeb(request, respond(request));
    }),
  );
  return { client: makeMtTeamsServiceClient(httpClient, OPTIONS), requests };
}

describe("MtTeamsServiceClient", () => {
  it.effect("publishes thread statuses with the environment key header", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json({ sharedThreadIds: ["thread-1"] }));
      const threads = [
        {
          threadId: "thread-1",
          title: "Fix login",
          status: "working" as const,
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
      ];
      const result = yield* harness.client.publish(threads);

      expect(result.sharedThreadIds).toEqual(["thread-1"]);
      expect(harness.requests).toHaveLength(1);
      const request = harness.requests[0]!;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://mt-teams.example.convex.site/api/bridge/publish");
      expect(request.headers["x-environment-key"]).toBe("env-key-123");
      expect(requestBodyJson(request)).toEqual({ threads });
    }),
  );

  it.effect("normalizes a trailing slash on the service URL", () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = [];
      const httpClient = HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request);
          return HttpClientResponse.fromWeb(request, Response.json({ messages: [] }));
        }),
      );
      const client = makeMtTeamsServiceClient(httpClient, {
        ...OPTIONS,
        serviceUrl: "https://mt-teams.example.convex.site/",
      });
      yield* client.inbox;
      expect(requests[0]!.url).toBe("https://mt-teams.example.convex.site/api/bridge/inbox");
      expect(requests[0]!.method).toBe("GET");
    }),
  );

  it.effect("decodes inbox messages", () =>
    Effect.gen(function* () {
      const message = {
        id: "message-1",
        threadId: "thread-1",
        fromUserName: "Ava",
        teamName: "Core",
        text: "Can you also update the docs?",
        createdAt: "2026-08-25T00:00:00.000Z",
      };
      const harness = makeHarness(() => Response.json({ messages: [message] }));
      const result = yield* harness.client.inbox;
      expect(result.messages).toEqual([message]);
    }),
  );

  it.effect("acks delivered message ids", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json({ ok: true }));
      const result = yield* harness.client.ack(["message-1", "message-2"]);
      expect(result.ok).toBe(true);
      const request = harness.requests[0]!;
      expect(request.url).toBe("https://mt-teams.example.convex.site/api/bridge/ack");
      expect(requestBodyJson(request)).toEqual({ messageIds: ["message-1", "message-2"] });
    }),
  );

  it.effect("surfaces a rejected environment key distinctly", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => new Response("nope", { status: 401 }));
      const error = yield* Effect.flip(harness.client.publish([]));
      expect(error._tag).toBe("MtTeamsServiceError");
      expect(error.message).toContain("rejected this environment key");
      expect(error.message).toContain("HTTP 401");
    }),
  );

  it.effect("fails on a non-2xx response", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => new Response("boom", { status: 500 }));
      const error = yield* Effect.flip(harness.client.inbox);
      expect(error._tag).toBe("MtTeamsServiceError");
      expect(error.message).toContain("HTTP 500");
    }),
  );

  it.effect("fails when the response body does not match the contract", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json({ unexpected: true }));
      const error = yield* Effect.flip(harness.client.ack(["message-1"]));
      expect(error._tag).toBe("MtTeamsServiceError");
      expect(error.message).toContain("invalid response");
    }),
  );
});
