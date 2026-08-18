/**
 * ProviderAccountLoginRunner — routes account sign-in RPCs to the driver
 * behind a provider instance.
 *
 * One login may be active per instance at a time. The driver's flow (and
 * the CLI process behind it) lives exactly as long as the login event
 * stream: a client that disconnects or cancels tears the flow down via the
 * stream's scope. Paste-back flows register their code sink here so the
 * separate `server.submitProviderLoginCode` request can reach the active
 * flow.
 *
 * @module provider/Services/ProviderAccountLoginRunner
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  ProviderAccountLoginError,
  type ProviderAccountLoginEvent,
  type ProviderAccountLoginInput,
  type ProviderAccountLogoutInput,
  type ProviderInstanceId,
  type ProviderLoginCodeInput,
  type ServerProviderUpdatedPayload,
} from "@t3tools/contracts";

import type { ProviderAccountLoginFlow } from "../ProviderDriver.ts";
import { ProviderInstanceRegistry } from "./ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";

export interface ProviderAccountLoginRunnerShape {
  readonly login: (
    input: ProviderAccountLoginInput,
  ) => Stream.Stream<ProviderAccountLoginEvent, ProviderAccountLoginError>;
  readonly submitCode: (
    input: ProviderLoginCodeInput,
  ) => Effect.Effect<Record<string, never>, ProviderAccountLoginError>;
  readonly logout: (
    input: ProviderAccountLogoutInput,
  ) => Effect.Effect<ServerProviderUpdatedPayload, ProviderAccountLoginError>;
}

export class ProviderAccountLoginRunner extends Context.Service<
  ProviderAccountLoginRunner,
  ProviderAccountLoginRunnerShape
>()("t3/provider/Services/ProviderAccountLoginRunner") {
  static readonly layer = Layer.effect(
    ProviderAccountLoginRunner,
    Effect.gen(function* () {
      const instances = yield* ProviderInstanceRegistry;
      const registry = yield* ProviderRegistry;

      const activeCodeSinks = new Map<
        ProviderInstanceId,
        NonNullable<ProviderAccountLoginFlow["submitCode"]>
      >();

      const resolveLoginSupport = Effect.fn("resolveLoginSupport")(function* (
        instanceId: ProviderInstanceId,
      ) {
        const instance = yield* instances.getInstance(instanceId);
        if (instance === undefined) {
          return yield* new ProviderAccountLoginError({
            instanceId,
            message: `Provider instance '${instanceId}' is not configured.`,
          });
        }
        const support = instance.accountLogin;
        if (support === undefined) {
          return yield* new ProviderAccountLoginError({
            instanceId,
            message: `Provider '${instanceId}' does not support in-app sign-in.`,
          });
        }
        return support;
      });

      const login: ProviderAccountLoginRunnerShape["login"] = (input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const support = yield* resolveLoginSupport(input.instanceId);
            if (!support.modes.includes(input.mode)) {
              return yield* new ProviderAccountLoginError({
                instanceId: input.instanceId,
                message: `Provider '${input.instanceId}' does not support '${input.mode}' sign-in.`,
              });
            }
            const flow = yield* support.start({
              mode: input.mode,
              ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
            });
            const codeSink = flow.submitCode;
            if (codeSink !== undefined) {
              activeCodeSinks.set(input.instanceId, codeSink);
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  if (activeCodeSinks.get(input.instanceId) === codeSink) {
                    activeCodeSinks.delete(input.instanceId);
                  }
                }),
              );
            }
            return flow.events.pipe(
              Stream.tap((event) =>
                event.type === "complete"
                  ? registry.refreshInstance(input.instanceId).pipe(Effect.asVoid)
                  : Effect.void,
              ),
            );
          }),
        );

      const submitCode: ProviderAccountLoginRunnerShape["submitCode"] = Effect.fn(
        "ProviderAccountLoginRunner.submitCode",
      )(function* (input) {
        const sink = activeCodeSinks.get(input.instanceId);
        if (sink === undefined) {
          return yield* new ProviderAccountLoginError({
            instanceId: input.instanceId,
            message: "No sign-in is waiting for a code on this provider.",
          });
        }
        yield* sink(input.code);
        return {};
      });

      const logout: ProviderAccountLoginRunnerShape["logout"] = Effect.fn(
        "ProviderAccountLoginRunner.logout",
      )(function* (input) {
        const support = yield* resolveLoginSupport(input.instanceId);
        if (support.logout === undefined) {
          return yield* new ProviderAccountLoginError({
            instanceId: input.instanceId,
            message: `Provider '${input.instanceId}' does not support in-app sign-out.`,
          });
        }
        yield* support.logout;
        const providers = yield* registry.refreshInstance(input.instanceId);
        return { providers };
      });

      return ProviderAccountLoginRunner.of({ login, submitCode, logout });
    }),
  );
}
