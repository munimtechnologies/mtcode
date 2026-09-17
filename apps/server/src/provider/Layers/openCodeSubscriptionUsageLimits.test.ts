import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  CHATGPT_USAGE_URL,
  CLAUDE_OAUTH_USAGE_URL,
  OPENCODE_API_KEYS_ONLY_MESSAGE,
  OPENCODE_CHATGPT_EXPIRED_MESSAGE,
  OPENCODE_CHATGPT_FETCH_FAILED_MESSAGE,
  OPENCODE_NO_AUTH_FILE_MESSAGE,
  chatGptUsageToWindows,
  claudeOAuthUsageToWindows,
  loadOpenCodeUsageLimits,
  parseOpenCodeAuthFile,
  resolveOpenCodeAuthPath,
} from "./openCodeSubscriptionUsageLimits.ts";

/** `wham/usage` as Codex reads it: primary = 5h, secondary = weekly. */
const chatGptUsageFixture = {
  plan_type: "plus",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 23,
      limit_window_seconds: 18_000,
      reset_after_seconds: 9_000,
      reset_at: 1_789_000_000,
    },
    secondary_window: {
      used_percent: 61.5,
      limit_window_seconds: 604_800,
      reset_after_seconds: 300_000,
      reset_at: 1_789_300_000,
    },
  },
};

/** `api/oauth/usage` as Claude Code's `get_usage` reads it. */
const claudeUsageFixture = {
  five_hour: { utilization: 12, resets_at: "2026-09-16T14:00:00Z" },
  seven_day: { utilization: 48.25, resets_at: "2026-09-20T00:00:00Z" },
  seven_day_opus: { utilization: 3, resets_at: "2026-09-20T00:00:00Z" },
  extra_usage: { is_enabled: false },
};

const FAR_FUTURE_MS = 4_102_444_800_000;

/** `auth.json` fixtures, serialised once here so the effectful tests stay plain. */
const API_KEY_ONLY_AUTH = JSON.stringify({ opencode: { type: "api", key: "sk" } });
const BOTH_SUBSCRIPTIONS_AUTH = JSON.stringify({
  openai: { type: "oauth", access: "chatgpt-token", expires: FAR_FUTURE_MS, accountId: "acct-1" },
  anthropic: { type: "oauth", access: "claude-token", expires: FAR_FUTURE_MS },
});
const EXPIRED_CHATGPT_AUTH = JSON.stringify({
  openai: { type: "oauth", access: "old", expires: 1_000 },
});
const CHATGPT_ONLY_AUTH = JSON.stringify({
  openai: { type: "oauth", access: "chatgpt-token", expires: FAR_FUTURE_MS },
});

describe("chatGptUsageToWindows", () => {
  it("maps both windows with prefixed ids, kinds by duration, and ISO resets", () => {
    expect(chatGptUsageToWindows(chatGptUsageFixture)).toEqual([
      {
        id: "chatgpt_primary",
        kind: "session",
        label: "ChatGPT · Session",
        usedPercent: 23,
        windowDurationMins: 300,
        resetsAt: "2026-09-10T00:26:40.000Z",
      },
      {
        id: "chatgpt_secondary",
        kind: "weekly",
        label: "ChatGPT · Weekly",
        usedPercent: 61.5,
        windowDurationMins: 10_080,
        resetsAt: "2026-09-13T11:46:40.000Z",
      },
    ]);
  });

  it("ignores payloads without a rate_limit block", () => {
    expect(chatGptUsageToWindows({ plan_type: "free" })).toEqual([]);
    expect(chatGptUsageToWindows(null)).toEqual([]);
  });
});

describe("claudeOAuthUsageToWindows", () => {
  it("maps the account-wide windows and leaves model-scoped buckets out", () => {
    expect(claudeOAuthUsageToWindows(claudeUsageFixture)).toEqual([
      {
        id: "claude_five_hour",
        kind: "session",
        label: "Claude · Session",
        usedPercent: 12,
        windowDurationMins: 300,
        resetsAt: "2026-09-16T14:00:00.000Z",
      },
      {
        id: "claude_seven_day",
        kind: "weekly",
        label: "Claude · Weekly",
        usedPercent: 48.25,
        windowDurationMins: 10_080,
        resetsAt: "2026-09-20T00:00:00.000Z",
      },
    ]);
  });
});

describe("parseOpenCodeAuthFile", () => {
  it("keeps oauth credentials and reduces everything else to its type", () => {
    expect(
      parseOpenCodeAuthFile(
        JSON.stringify({
          opencode: { type: "api", key: "sk-zen" },
          openai: {
            type: "oauth",
            access: "at",
            refresh: "rt",
            expires: 123,
            accountId: "acct",
          },
          broken: "nope",
        }),
      ),
    ).toEqual({
      opencode: { type: "api" },
      openai: { type: "oauth", access: "at", refresh: "rt", expires: 123, accountId: "acct" },
    });
  });

  it("returns null for malformed JSON", () => {
    expect(parseOpenCodeAuthFile("{")).toBeNull();
    expect(parseOpenCodeAuthFile("[]")).toEqual({});
  });
});

describe("resolveOpenCodeAuthPath", () => {
  it.effect("honours XDG_DATA_HOME and falls back to ~/.local/share", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      expect(
        resolveOpenCodeAuthPath({
          environment: { XDG_DATA_HOME: "/xdg" },
          path,
          homeDir: "/home/fallback",
        }),
      ).toBe("/xdg/opencode/auth.json");
      expect(
        resolveOpenCodeAuthPath({ environment: { HOME: "/home/me" }, path, homeDir: "/nope" }),
      ).toBe("/home/me/.local/share/opencode/auth.json");
      expect(resolveOpenCodeAuthPath({ environment: {}, path, homeDir: "/home/fallback" })).toBe(
        "/home/fallback/.local/share/opencode/auth.json",
      );
    }).pipe(Effect.provide(Path.layer)),
  );
});

describe("loadOpenCodeUsageLimits", () => {
  const authPath = "/home/me/.local/share/opencode/auth.json";

  /** An in-memory data dir: only `auth.json` exists, with the given contents. */
  const fileSystemLayer = (authJson: string | null) =>
    FileSystem.layerNoop({
      readFileString: (path) =>
        path === authPath && authJson !== null
          ? Effect.succeed(authJson)
          : Effect.fail(
              new PlatformError.PlatformError(
                new PlatformError.SystemError({
                  _tag: "NotFound",
                  module: "FileSystem",
                  method: "readFileString",
                  pathOrDescriptor: path,
                }),
              ),
            ),
    });

  const load = (
    authJson: string | null,
    respond: (request: HttpClientRequest.HttpClientRequest) => Response,
    seen: HttpClientRequest.HttpClientRequest[] = [],
  ) =>
    loadOpenCodeUsageLimits({ environment: { HOME: "/home/me" }, homeDir: "/nope" }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            seen.push(request);
            return HttpClientResponse.fromWeb(request, respond(request));
          }),
        ),
      ),
      Effect.provide(Layer.merge(fileSystemLayer(authJson), Path.layer)),
    );

  it.effect("reports unsupported when auth.json is missing", () =>
    Effect.gen(function* () {
      const limits = yield* load(null, () => Response.json({}));
      expect(limits.unavailable).toEqual({
        reason: "unsupported",
        message: OPENCODE_NO_AUTH_FILE_MESSAGE,
      });
    }),
  );

  it.effect("reports unsupported for API-key-only sign-ins without a network call", () =>
    Effect.gen(function* () {
      const seen: HttpClientRequest.HttpClientRequest[] = [];
      const limits = yield* load(API_KEY_ONLY_AUTH, () => Response.json({}), seen);
      expect(seen).toHaveLength(0);
      expect(limits.unavailable).toEqual({
        reason: "unsupported",
        message: OPENCODE_API_KEYS_ONLY_MESSAGE,
      });
    }),
  );

  it.effect("reads ChatGPT and Claude usage with the stored tokens and merges the windows", () =>
    Effect.gen(function* () {
      const seen: HttpClientRequest.HttpClientRequest[] = [];
      const limits = yield* load(
        BOTH_SUBSCRIPTIONS_AUTH,
        (request) =>
          request.url === CHATGPT_USAGE_URL
            ? Response.json(chatGptUsageFixture)
            : Response.json(claudeUsageFixture),
        seen,
      );
      expect(seen.map((request) => request.url)).toEqual([
        CHATGPT_USAGE_URL,
        CLAUDE_OAUTH_USAGE_URL,
      ]);
      expect(seen[0]?.headers["authorization"]).toBe("Bearer chatgpt-token");
      expect(seen[0]?.headers["chatgpt-account-id"]).toBe("acct-1");
      expect(seen[1]?.headers["authorization"]).toBe("Bearer claude-token");
      expect(seen[1]?.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      expect(limits.unavailable).toBeUndefined();
      expect(limits.windows.map((window) => window.id)).toEqual([
        "chatgpt_primary",
        "claude_five_hour",
        "chatgpt_secondary",
        "claude_seven_day",
      ]);
    }),
  );

  // Live clock: expiry is judged against the Effect clock, which `it.effect`
  // pins to the epoch, where a 1970 timestamp would still count as unexpired.
  it.live("reports an expired token as a failed probe without calling the API", () =>
    Effect.gen(function* () {
      const seen: HttpClientRequest.HttpClientRequest[] = [];
      const limits = yield* load(
        EXPIRED_CHATGPT_AUTH,
        () => Response.json(chatGptUsageFixture),
        seen,
      );
      expect(seen).toHaveLength(0);
      expect(limits.unavailable).toEqual({
        reason: "probeFailed",
        message: OPENCODE_CHATGPT_EXPIRED_MESSAGE,
      });
    }),
  );

  it.effect("keeps the windows one account reported when the other fails", () =>
    Effect.gen(function* () {
      const limits = yield* load(BOTH_SUBSCRIPTIONS_AUTH, (request) =>
        request.url === CHATGPT_USAGE_URL
          ? new Response("unauthorized", { status: 401 })
          : Response.json(claudeUsageFixture),
      );
      expect(limits.unavailable).toBeUndefined();
      expect(limits.windows.map((window) => window.id)).toEqual([
        "claude_five_hour",
        "claude_seven_day",
      ]);
    }),
  );

  it.effect("reports probeFailed with the reason when every account fails", () =>
    Effect.gen(function* () {
      const limits = yield* load(CHATGPT_ONLY_AUTH, () => new Response("nope", { status: 500 }));
      expect(limits.unavailable).toEqual({
        reason: "probeFailed",
        message: OPENCODE_CHATGPT_FETCH_FAILED_MESSAGE,
      });
    }),
  );
});
