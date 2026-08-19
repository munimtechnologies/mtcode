// @effect-diagnostics globalTimers:off - the suite stubs fetch, including a deliberately slow one.
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { makeMtModelCloudflareClassifier, readMtModelRouterUrl } from "./mtModelCloudflare.ts";

describe("readMtModelRouterUrl", () => {
  it("stays off unless an explicit worker URL is set", () => {
    expect(readMtModelRouterUrl({})).toBeUndefined();
    expect(readMtModelRouterUrl({ MT_MODEL_ROUTER_URL: "off" })).toBeUndefined();
    expect(readMtModelRouterUrl({ MT_MODEL_ROUTER_URL: "https://example.test/" })).toBe(
      "https://example.test",
    );
  });
});

describe("makeMtModelCloudflareClassifier", () => {
  it("does not call the network when no router URL is configured", async () => {
    let called = false;
    const classifier = makeMtModelCloudflareClassifier({
      fetch: async () => {
        called = true;
        return new Response("nope", { status: 500 });
      },
    });
    expect(await Effect.runPromise(classifier.classify({ prompt: "hello world" }))).toBeNull();
    expect(called).toBe(false);
  });
  it("returns a Cloudflare classification when the worker responds", async () => {
    const classifier = makeMtModelCloudflareClassifier({
      url: "https://mt-model.example",
      timeoutMs: 200,
      fetch: async () =>
        new Response(JSON.stringify({ difficulty: 0.9, taskKind: "debugging" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const result = await Effect.runPromise(
      classifier.classify({ prompt: "this crash has a stack trace" }),
    );
    expect(result).toEqual({
      difficulty: 0.9,
      taskKind: "debugging",
      source: "cloudflare",
    });
  });

  it("falls back to null when the worker is down so the local heuristic can run", async () => {
    const classifier = makeMtModelCloudflareClassifier({
      url: "https://mt-model.example",
      timeoutMs: 50,
      fetch: async () => new Response("nope", { status: 503 }),
    });
    expect(
      await Effect.runPromise(classifier.classify({ prompt: "implement the remaining handlers" })),
    ).toBeNull();
  });

  it("aborts a hung worker so the local heuristic can run", async () => {
    const classifier = makeMtModelCloudflareClassifier({
      url: "https://mt-model.example",
      timeoutMs: 40,
      fetch: (_url, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ difficulty: 0.9, taskKind: "debugging" }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }, 200);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    });
    expect(
      await Effect.runPromise(classifier.classify({ prompt: "this crash has a stack trace" })),
    ).toBeNull();
  });
});
