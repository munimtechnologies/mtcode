/**
 * OpenCode subscription usage. OpenCode itself has no quota surface; what it
 * does hold is the upstream sign-ins in `<data dir>/opencode/auth.json`. Two
 * of those are subscriptions with rate-limit windows:
 *
 * - `openai` (ChatGPT / Codex OAuth): the same `wham/usage` read Codex's
 *   `account/rateLimits/read` performs, keyed by the account id OpenCode
 *   stores beside the token.
 * - `anthropic` (Claude Pro / Max OAuth): the `api/oauth/usage` read Claude
 *   Code's `get_usage` performs.
 *
 * API-key providers have no windows and are reported as `unsupported`.
 * Tokens are used as stored and never refreshed here: OpenCode rotates its
 * refresh tokens on use, so refreshing from outside would invalidate its
 * copy. An expired token is reported as a failed probe with a next step.
 *
 * Window ids are prefixed per upstream account (`chatgpt_primary`,
 * `claude_five_hour`) so both accounts can sit on one instance's snapshot
 * without colliding, and so repeated probes land on the same rows.
 *
 * @module provider/Layers/opencodeUsageLimits
 */
import * as NodeOS from "node:os";
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";

export const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";

const USAGE_FETCH_TIMEOUT_MS = 10_000;
const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

export const OPENCODE_NO_AUTH_FILE_MESSAGE =
  "OpenCode has no saved provider sign-ins, so there are no usage windows to read.";
export const OPENCODE_API_KEYS_ONLY_MESSAGE =
  "OpenCode is signed in with API keys only; usage windows exist for ChatGPT and Claude subscription sign-ins.";
export const OPENCODE_CHATGPT_EXPIRED_MESSAGE =
  "OpenCode's ChatGPT sign-in has expired; run a turn in OpenCode to refresh it.";
export const OPENCODE_CLAUDE_EXPIRED_MESSAGE =
  "OpenCode's Claude sign-in has expired; run a turn in OpenCode to refresh it.";
export const OPENCODE_CHATGPT_FETCH_FAILED_MESSAGE =
  "ChatGPT usage could not be read for OpenCode.";
export const OPENCODE_CLAUDE_FETCH_FAILED_MESSAGE = "Claude usage could not be read for OpenCode.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isoFromEpochSeconds(value: number | undefined): string | undefined {
  if (value === undefined || value <= 0) return undefined;
  const dt = DateTime.make(value * 1000);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
}

function isoFromString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const dt = DateTime.make(value);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
}

function kindForDuration(mins: number): ServerProviderUsageWindow["kind"] {
  if (mins >= MONTH_MINS) return "monthly";
  if (mins >= WEEK_MINS) return "weekly";
  return "session";
}

function kindLabel(kind: ServerProviderUsageWindow["kind"]): string {
  return kind === "session"
    ? "Session"
    : kind === "weekly"
      ? "Weekly"
      : kind === "monthly"
        ? "Monthly"
        : "Other";
}

// ---------------------------------------------------------------------------
// auth.json
// ---------------------------------------------------------------------------

export type OpenCodeAuthCredential =
  | {
      readonly type: "oauth";
      readonly access: string;
      readonly refresh?: string;
      /** Unix milliseconds. */
      readonly expires?: number;
      readonly accountId?: string;
    }
  | { readonly type: "api" }
  | { readonly type: string };

export type OpenCodeAuthFile = Readonly<Record<string, OpenCodeAuthCredential>>;

/** Parses OpenCode's `auth.json`; null when it is not the expected object shape. */
export function parseOpenCodeAuthFile(raw: string): OpenCodeAuthFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const entries: Record<string, OpenCodeAuthCredential> = {};
  for (const [providerId, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    const type = readString(value.type);
    if (type === undefined) continue;
    if (type === "oauth") {
      const access = readString(value.access);
      if (access === undefined) continue;
      const refresh = readString(value.refresh);
      const expires = readNumber(value.expires);
      const accountId = readString(value.accountId);
      entries[providerId] = {
        type,
        access,
        ...(refresh !== undefined ? { refresh } : {}),
        ...(expires !== undefined ? { expires } : {}),
        ...(accountId !== undefined ? { accountId } : {}),
      };
      continue;
    }
    entries[providerId] = { type };
  }
  return entries;
}

/**
 * Where OpenCode keeps its data: `$XDG_DATA_HOME/opencode`, else
 * `~/.local/share/opencode`. Mirrors the usage scanner's resolution so both
 * readers agree on the directory.
 */
export function resolveOpenCodeAuthPath(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly path: Path.Path;
  readonly homeDir: string;
}): string {
  const { environment, path } = input;
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim() || input.homeDir;
  const dataDir = environment.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
  return path.join(dataDir, "opencode", "auth.json");
}

// ---------------------------------------------------------------------------
// ChatGPT (`wham/usage`)
// ---------------------------------------------------------------------------

/**
 * The `wham/usage` response Codex reads for `account/rateLimits/read`:
 * `rate_limit.primary_window` / `secondary_window` each carry `used_percent`,
 * `limit_window_seconds` and `reset_at` (epoch seconds).
 */
export function chatGptUsageToWindows(payload: unknown): ReadonlyArray<ServerProviderUsageWindow> {
  if (!isRecord(payload) || !isRecord(payload.rate_limit)) return [];
  const rateLimit = payload.rate_limit;
  const windows: ServerProviderUsageWindow[] = [];
  const positions = [
    ["primary", rateLimit.primary_window, SESSION_MINS],
    ["secondary", rateLimit.secondary_window, WEEK_MINS],
  ] as const;
  for (const [slot, window, fallbackMins] of positions) {
    if (!isRecord(window)) continue;
    const usedPercent = readNumber(window.used_percent);
    if (usedPercent === undefined) continue;
    const seconds = readNumber(window.limit_window_seconds);
    const windowDurationMins =
      seconds !== undefined && seconds > 0 ? Math.round(seconds / 60) : fallbackMins;
    const kind = kindForDuration(windowDurationMins);
    const resetsAt = isoFromEpochSeconds(readNumber(window.reset_at));
    windows.push({
      id: `chatgpt_${slot}`,
      kind,
      label: `ChatGPT · ${kindLabel(kind)}`,
      usedPercent: clampPercent(usedPercent),
      windowDurationMins,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Claude (`api/oauth/usage`)
// ---------------------------------------------------------------------------

/**
 * The `api/oauth/usage` response Claude Code's `get_usage` reads: `five_hour`
 * and `seven_day` each carry `utilization` (0–100) and an ISO `resets_at`.
 * Model-scoped weeklies are left out, as on the Claude driver's own card.
 */
export function claudeOAuthUsageToWindows(
  payload: unknown,
): ReadonlyArray<ServerProviderUsageWindow> {
  if (!isRecord(payload)) return [];
  const windows: ServerProviderUsageWindow[] = [];
  const buckets = [
    ["five_hour", "session", SESSION_MINS],
    ["seven_day", "weekly", WEEK_MINS],
  ] as const;
  for (const [key, kind, windowDurationMins] of buckets) {
    const bucket = payload[key];
    if (!isRecord(bucket)) continue;
    const utilization = readNumber(bucket.utilization);
    if (utilization === undefined) continue;
    const resetsAt = isoFromString(readString(bucket.resets_at));
    windows.push({
      id: `claude_${key}`,
      kind,
      label: `Claude · ${kindLabel(kind)}`,
      usedPercent: clampPercent(utilization),
      windowDurationMins,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

interface SubscriptionSource {
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly toWindows: (payload: unknown) => ReadonlyArray<ServerProviderUsageWindow>;
  readonly expiredMessage: string;
  readonly failedMessage: string;
  readonly expiresAtMs: number | undefined;
}

function subscriptionSources(auth: OpenCodeAuthFile): ReadonlyArray<SubscriptionSource> {
  const sources: SubscriptionSource[] = [];
  const openai = auth.openai;
  if (openai && openai.type === "oauth" && "access" in openai) {
    const base = HttpClientRequest.get(CHATGPT_USAGE_URL).pipe(
      HttpClientRequest.setHeader("Authorization", `Bearer ${openai.access}`),
      HttpClientRequest.setHeader("Accept", "application/json"),
    );
    sources.push({
      request: openai.accountId
        ? base.pipe(HttpClientRequest.setHeader("ChatGPT-Account-Id", openai.accountId))
        : base,
      toWindows: chatGptUsageToWindows,
      expiredMessage: OPENCODE_CHATGPT_EXPIRED_MESSAGE,
      failedMessage: OPENCODE_CHATGPT_FETCH_FAILED_MESSAGE,
      expiresAtMs: openai.expires,
    });
  }
  const anthropic = auth.anthropic;
  if (anthropic && anthropic.type === "oauth" && "access" in anthropic) {
    sources.push({
      request: HttpClientRequest.get(CLAUDE_OAUTH_USAGE_URL).pipe(
        HttpClientRequest.setHeader("Authorization", `Bearer ${anthropic.access}`),
        HttpClientRequest.setHeader("anthropic-beta", CLAUDE_OAUTH_BETA),
        HttpClientRequest.setHeader("Accept", "application/json"),
      ),
      toWindows: claudeOAuthUsageToWindows,
      expiredMessage: OPENCODE_CLAUDE_EXPIRED_MESSAGE,
      failedMessage: OPENCODE_CLAUDE_FETCH_FAILED_MESSAGE,
      expiresAtMs: anthropic.expires,
    });
  }
  return sources;
}

export interface LoadOpenCodeUsageLimitsOptions {
  /** Environment used to locate the data directory (`XDG_DATA_HOME`, `HOME`). */
  readonly environment: NodeJS.ProcessEnv;
  /** Fallback home when the environment names none; defaults to the OS home. */
  readonly homeDir?: string | undefined;
}

/**
 * Reads OpenCode's saved sign-ins and probes each subscription's usage. Never
 * fails: missing files and API-key-only setups are `unsupported`; an expired
 * token or an unreachable API is `probeFailed` with a next step.
 */
export const loadOpenCodeUsageLimits = Effect.fn("loadOpenCodeUsageLimits")(function* (
  options: LoadOpenCodeUsageLimitsOptions,
): Effect.fn.Return<
  ServerProviderUsageLimits,
  never,
  FileSystem.FileSystem | Path.Path | HttpClient.HttpClient
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const authPath = resolveOpenCodeAuthPath({
    environment: options.environment,
    path,
    homeDir: options.homeDir ?? NodeOS.homedir(),
  });
  const raw = yield* fileSystem.readFileString(authPath).pipe(Effect.option);
  const auth = Option.isSome(raw) ? parseOpenCodeAuthFile(raw.value) : null;
  if (auth === null) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "unsupported",
      message: OPENCODE_NO_AUTH_FILE_MESSAGE,
    });
  }
  const sources = subscriptionSources(auth);
  if (sources.length === 0) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "unsupported",
      message: OPENCODE_API_KEYS_ONLY_MESSAGE,
    });
  }

  const nowMs = Date.parse(checkedAt);
  const windows: ServerProviderUsageWindow[] = [];
  const failures: string[] = [];
  for (const source of sources) {
    if (source.expiresAtMs !== undefined && source.expiresAtMs <= nowMs) {
      failures.push(source.expiredMessage);
      continue;
    }
    const payload = yield* httpClient.execute(source.request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(USAGE_FETCH_TIMEOUT_MS),
      Effect.option,
    );
    if (Option.isNone(payload)) {
      failures.push(source.failedMessage);
      continue;
    }
    windows.push(...source.toWindows(payload.value));
  }
  if (windows.length === 0) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: failures.join(" ") || "OpenCode's subscription sign-ins reported no usage windows.",
    });
  }
  return makeUsageLimits({ checkedAt, windows });
});
