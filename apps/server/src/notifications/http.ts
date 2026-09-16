import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { SelfHostedPushNotifications } from "./SelfHostedPushNotifications.ts";

export const notificationsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "notifications",
  Effect.fnUntraced(function* (handlers) {
    const notifications = yield* Effect.serviceOption(SelfHostedPushNotifications);
    const requireNotifications = Option.match(notifications, {
      onNone: () => failEnvironmentInternal("internal_error"),
      onSome: Effect.succeed,
    });
    return handlers
      .handle(
        "registerDevice",
        Effect.fn("environment.notifications.registerDevice")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const service = yield* requireNotifications;
          yield* service
            .register(args.payload)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
          return { registered: true };
        }),
      )
      .handle(
        "unregisterDevice",
        Effect.fn("environment.notifications.unregisterDevice")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const service = yield* requireNotifications;
          yield* service
            .unregister(args.params.deviceId)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
          return { registered: false };
        }),
      );
  }),
);
