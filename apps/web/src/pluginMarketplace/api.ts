import * as Effect from "effect/Effect";

import type { PluginMarketplaceSetupAction } from "@t3tools/contracts";
import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";

export function fetchPluginMarketplaceCatalog() {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.plugins.catalog({ headers: {} })),
    ),
  );
}

export function fetchPluginMarketplaceDetail(pluginId: string) {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.plugins.detail({ headers: {}, params: { pluginId } })),
    ),
  );
}

export function fetchPluginMarketplaceLogo(pluginId: string) {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.plugins.logo({ headers: {}, params: { pluginId } })),
    ),
  );
}

export function installPlugin(pluginId: string) {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.plugins.install({ headers: {}, params: { pluginId } })),
    ),
  );
}

export function openPluginSetup(pluginId: string, action: PluginMarketplaceSetupAction) {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.plugins.setup({ headers: {}, params: { pluginId }, payload: { action } }),
      ),
    ),
  );
}

export function removePlugin(pluginId: string) {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.plugins.remove({ headers: {}, params: { pluginId } })),
    ),
  );
}
