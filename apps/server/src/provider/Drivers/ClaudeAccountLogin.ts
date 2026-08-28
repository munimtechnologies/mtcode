/**
 * In-app Claude sign-in.
 *
 * Claude Code has no login server T3 can drive, so the subscription flow
 * wraps `claude setup-token` in a hidden PTY: the CLI prints an OAuth URL,
 * the user authorizes in a browser and pastes the resulting code back, and
 * the CLI prints a long-lived token. T3 stores that token as a sensitive
 * `CLAUDE_CODE_OAUTH_TOKEN` environment variable on this provider instance,
 * which keeps each account's credential with its instance (no keychain or
 * config-dir contention between accounts) and makes sign-out a plain
 * variable removal. API-key sign-in stores `ANTHROPIC_API_KEY` the same way.
 */
import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import type * as Cause from "effect/Cause";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  ProviderAccountLoginError,
  type ClaudeSettings,
  type ProviderAccountLoginEvent,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";

import type { ServerSettingsService } from "../../serverSettings.ts";
import type { PtyAdapter } from "../../terminal/PtyAdapter.ts";
import { deriveProviderInstanceConfigMap } from "../Layers/ProviderInstanceRegistryHydration.ts";
import type { ProviderAccountLoginFlow, ProviderAccountLoginSupport } from "../ProviderDriver.ts";
import { resolveAppDisplayName } from "../../appDisplayName.ts";

export const CLAUDE_OAUTH_TOKEN_ENV_VAR = "CLAUDE_CODE_OAUTH_TOKEN";
export const CLAUDE_API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

/** Wide enough that the OAuth URL never soft-wraps mid-token. */
const LOGIN_PTY_COLS = 500;
const LOGIN_PTY_ROWS = 40;

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)/g, "");
}

/** First https URL in the CLI output — the OAuth authorize link. */
export function extractClaudeLoginUrl(output: string): string | null {
  const match = stripAnsi(output).match(/https:\/\/[^\s"'`)\]]+/);
  return match ? match[0] : null;
}

/** Long-lived OAuth token printed after a successful code exchange. */
export function extractClaudeOauthToken(output: string): string | null {
  const match = stripAnsi(output).match(/sk-ant-oat[A-Za-z0-9_-]*-[A-Za-z0-9_-]{8,}/);
  return match ? match[0] : null;
}

/**
 * Upsert one environment variable on this instance's `providerInstances`
 * entry. The map is derived first so a default-slot instance that only
 * exists as the legacy provider blob gets claimed with its current config
 * intact rather than a bare envelope.
 */
export const persistInstanceEnvironmentVariable = Effect.fn("persistInstanceEnvironmentVariable")(
  function* (input: {
    readonly settings: ServerSettingsService["Service"];
    readonly instanceId: ProviderInstanceId;
    readonly name: string;
    readonly value: string | null;
  }) {
    const current: ServerSettings = yield* input.settings.getSettings;
    const instance = deriveProviderInstanceConfigMap(current)[input.instanceId];
    if (instance === undefined) {
      return yield* new ProviderAccountLoginError({
        instanceId: input.instanceId,
        message: `Provider instance '${input.instanceId}' is not configured.`,
      });
    }
    const existing: ReadonlyArray<ProviderInstanceEnvironmentVariable> = instance.environment ?? [];
    const withoutVariable = existing.filter((variable) => variable.name !== input.name);
    const environment =
      input.value === null
        ? withoutVariable
        : [...withoutVariable, { name: input.name, value: input.value, sensitive: true }];
    const { environment: _previousEnvironment, ...instanceWithoutEnvironment } = instance;
    const nextInstance: ProviderInstanceConfig = {
      ...instanceWithoutEnvironment,
      ...(environment.length > 0 ? { environment } : {}),
    };
    // Claim only this instance's slot: writing the whole derived map would
    // claim every driver's default slot and detach them from the legacy
    // `providers.*` mirrors.
    yield* input.settings.updateSettings({
      providerInstances: { ...(current.providerInstances ?? {}), [input.instanceId]: nextInstance },
    });
  },
);

interface ClaudeAccountLoginInput {
  readonly instanceId: ProviderInstanceId;
  readonly config: ClaudeSettings;
  /** Instance environment with `CLAUDE_CONFIG_DIR` already applied. */
  readonly environment: NodeJS.ProcessEnv;
  readonly pty: PtyAdapter["Service"];
  readonly settings: ServerSettingsService["Service"];
}

type SetupTokenSignal =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "exit"; readonly exitCode: number };

export function makeClaudeAccountLogin(
  input: ClaudeAccountLoginInput,
): ProviderAccountLoginSupport {
  const failure = (message: string) =>
    new ProviderAccountLoginError({ instanceId: input.instanceId, message });

  const start: ProviderAccountLoginSupport["start"] = Effect.fn("claudeAccountLogin.start")(
    function* ({ mode, apiKey }) {
      if (mode === "apiKey") {
        if (!apiKey || apiKey.trim().length === 0) {
          return yield* failure("An API key is required for this sign-in.");
        }
        yield* persistInstanceEnvironmentVariable({
          settings: input.settings,
          instanceId: input.instanceId,
          name: CLAUDE_API_KEY_ENV_VAR,
          value: apiKey.trim(),
        }).pipe(
          Effect.catchTag("ServerSettingsError", (cause) =>
            Effect.fail(failure(`Could not store the API key: ${cause.message}`)),
          ),
        );
        return {
          events: Stream.make({ type: "complete" } as const satisfies ProviderAccountLoginEvent),
        } satisfies ProviderAccountLoginFlow;
      }

      const process = yield* input.pty
        .spawn({
          shell: input.config.binaryPath,
          args: ["setup-token"],
          cwd: NodeOS.homedir(),
          cols: LOGIN_PTY_COLS,
          rows: LOGIN_PTY_ROWS,
          env: input.environment,
        })
        .pipe(
          Effect.mapError((cause) =>
            failure(`Could not start \`${input.config.binaryPath} setup-token\`: ${cause.message}`),
          ),
        );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          try {
            process.kill();
          } catch {
            // Already exited.
          }
        }),
      );

      // The exit handler ends the queue, which Effect models as a `Done`
      // failure, so the queue has to admit it.
      const signals = yield* Queue.unbounded<SetupTokenSignal, Cause.Done>();
      let transcript = "";
      let sawUrl = false;
      process.onData((data) => {
        transcript += data;
        if (!sawUrl) {
          const url = extractClaudeLoginUrl(transcript);
          if (url !== null) {
            sawUrl = true;
            Queue.offerUnsafe(signals, { kind: "url", url });
          }
        }
      });
      process.onExit((event) => {
        Queue.offerUnsafe(signals, { kind: "exit", exitCode: event.exitCode });
        Queue.endUnsafe(signals);
      });

      const settle = Effect.gen(function* () {
        const token = extractClaudeOauthToken(transcript);
        if (token === null) {
          const detail = stripAnsi(transcript).trim().split("\n").slice(-3).join(" ").trim();
          return yield* failure(
            detail.length > 0
              ? `Claude sign-in did not complete: ${detail}`
              : "Claude sign-in did not complete.",
          );
        }
        yield* persistInstanceEnvironmentVariable({
          settings: input.settings,
          instanceId: input.instanceId,
          name: CLAUDE_OAUTH_TOKEN_ENV_VAR,
          value: token,
        }).pipe(
          Effect.catchTag("ServerSettingsError", (cause) =>
            Effect.fail(failure(`Could not store the sign-in token: ${cause.message}`)),
          ),
        );
        return { type: "complete" } as const satisfies ProviderAccountLoginEvent;
      });

      const events: ProviderAccountLoginFlow["events"] = Stream.fromQueue(signals).pipe(
        Stream.mapEffect(
          (signal): Effect.Effect<ProviderAccountLoginEvent, ProviderAccountLoginError> =>
            signal.kind === "url"
              ? Effect.succeed({
                  type: "awaitingCode",
                  url: signal.url,
                } as const satisfies ProviderAccountLoginEvent)
              : settle,
        ),
      );

      return {
        events,
        submitCode: (code: string) =>
          Effect.sync(() => {
            process.write(`${code.trim()}\r`);
          }),
      } satisfies ProviderAccountLoginFlow;
    },
  );

  const logout = Effect.gen(function* () {
    const current = yield* input.settings.getSettings.pipe(
      Effect.mapError((cause) => failure(`Could not read settings: ${cause.message}`)),
    );
    const instance = deriveProviderInstanceConfigMap(current)[input.instanceId];
    const managed = (instance?.environment ?? []).some(
      (variable) =>
        variable.name === CLAUDE_OAUTH_TOKEN_ENV_VAR || variable.name === CLAUDE_API_KEY_ENV_VAR,
    );
    if (!managed) {
      return yield* failure(
        `This account was signed in outside ${resolveAppDisplayName()}. Run \`claude /logout\` in a terminal to sign it out.`,
      );
    }
    yield* persistInstanceEnvironmentVariable({
      settings: input.settings,
      instanceId: input.instanceId,
      name: CLAUDE_OAUTH_TOKEN_ENV_VAR,
      value: null,
    }).pipe(Effect.mapError((cause) => failure(cause.message)));
    yield* persistInstanceEnvironmentVariable({
      settings: input.settings,
      instanceId: input.instanceId,
      name: CLAUDE_API_KEY_ENV_VAR,
      value: null,
    }).pipe(Effect.mapError((cause) => failure(cause.message)));
  });

  return {
    modes: ["oauth", "apiKey"],
    supportsLogout: true,
    start,
    logout,
  };
}
