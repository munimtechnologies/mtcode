import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { CodexPluginMarketplace } from "./CodexPluginMarketplace.ts";

export const pluginMarketplaceHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "plugins",
  Effect.fnUntraced(function* (handlers) {
    const marketplace = yield* CodexPluginMarketplace;

    return handlers
      .handle(
        "catalog",
        Effect.fn("environment.plugins.catalog")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* marketplace.catalog();
        }),
      )
      .handle(
        "detail",
        Effect.fn("environment.plugins.detail")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* marketplace.detail(args.params.pluginId);
        }),
      )
      .handle(
        "logo",
        Effect.fn("environment.plugins.logo")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* marketplace.logo(args.params.pluginId);
        }),
      )
      .handle(
        "install",
        Effect.fn("environment.plugins.install")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* marketplace.install(args.params.pluginId);
        }),
      )
      .handle(
        "setup",
        Effect.fn("environment.plugins.setup")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* marketplace.setup(args.params.pluginId, args.payload.action);
        }),
      )
      .handle(
        "remove",
        Effect.fn("environment.plugins.remove")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* marketplace.remove(args.params.pluginId);
        }),
      );
  }),
);
