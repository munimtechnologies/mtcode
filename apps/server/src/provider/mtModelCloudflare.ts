/**
 * Optional Cloudflare classifier for MT Model.
 *
 * MT Code matches T3 Code: local and $0 by default. This client stays dark
 * unless `MT_MODEL_ROUTER_URL` is set to an explicit worker URL. We never
 * enable Workers Paid.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  parseMtTurnClassification,
  type MtTurnClassification,
} from "@t3tools/shared/mtModelRouter";

/** Optional worker URL. Never used unless `MT_MODEL_ROUTER_URL` is set. */
export const OPTIONAL_MT_MODEL_ROUTER_URL = "https://mt-model-router.sheehanmunim.workers.dev";
export const MT_MODEL_CLOUDFLARE_TIMEOUT = Duration.millis(2_500);
const PROMPT_CHAR_LIMIT = 400;
const CACHE_LIMIT = 64;
const FAILURES_BEFORE_SILENCE = 6;
const SILENCE_MS = 60_000;

export class MtModelCloudflareClassifier extends Context.Service<
  MtModelCloudflareClassifier,
  {
    readonly classify: (input: {
      readonly prompt: string;
      readonly interactionMode?: string | undefined;
    }) => Effect.Effect<MtTurnClassification | null>;
  }
>()("t3/provider/MtModelCloudflareClassifier") {}

export function readMtModelRouterUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.MT_MODEL_ROUTER_URL?.trim();
  if (!raw || raw === "0" || raw === "off" || raw === "false") {
    return undefined;
  }
  return raw.replace(/\/+$/, "");
}

export function makeMtModelCloudflareClassifier(input: {
  readonly url?: string | undefined;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly warmup?: boolean;
}): MtModelCloudflareClassifier["Service"] {
  const url = input.url;
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? Duration.toMillis(MT_MODEL_CLOUDFLARE_TIMEOUT);
  const cache = new Map<string, MtTurnClassification>();
  let consecutiveFailures = 0;
  let silencedUntil = 0;
  const shouldWarmup = input.warmup ?? input.fetch === undefined;

  if (shouldWarmup && url && typeof fetchImpl === "function") {
    void fetchImpl(`${url}/health`).catch(() => undefined);
    void fetchImpl(`${url}/classify`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ prompt: "warmup: classify a trivial changelog typo fix" }),
    }).catch(() => undefined);
  }

  const classify = Effect.fn("mtModelCloudflare.classify")(function* (request: {
    readonly prompt: string;
    readonly interactionMode?: string | undefined;
  }) {
    if (!url || typeof fetchImpl !== "function") {
      return null;
    }
    if (now() < silencedUntil) {
      return null;
    }
    const prompt = request.prompt.trim().slice(0, PROMPT_CHAR_LIMIT);
    if (prompt.length === 0) {
      return null;
    }
    const cacheKey = `${request.interactionMode ?? "default"}:${prompt}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const classified = yield* Effect.tryPromise({
      try: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(`${url}/classify`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              prompt,
              ...(request.interactionMode !== undefined
                ? { interactionMode: request.interactionMode }
                : {}),
            }),
            signal: controller.signal,
          });
          if (!response.ok) {
            return null;
          }
          return parseMtTurnClassification(await response.json());
        } finally {
          clearTimeout(timer);
        }
      },
      catch: () => "failed" as const,
    }).pipe(Effect.orElseSucceed(() => null));

    if (classified === null) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= FAILURES_BEFORE_SILENCE) {
        silencedUntil = now() + SILENCE_MS;
      }
      yield* Effect.logDebug("mt model cloudflare classify missed");
      return null;
    }
    consecutiveFailures = 0;
    silencedUntil = 0;
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
    cache.set(cacheKey, classified);
    yield* Effect.logDebug("mt model cloudflare classified", {
      taskKind: classified.taskKind,
      difficulty: classified.difficulty,
    });
    return classified;
  });

  return { classify };
}

export const layer = Layer.effect(
  MtModelCloudflareClassifier,
  Effect.sync(() => makeMtModelCloudflareClassifier({ url: readMtModelRouterUrl() })),
);
