import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";

import { providerDisplayName } from "./lib/providerDisplayName";
import { primaryServerProvidersAtom } from "./state/server";

/**
 * The plan a provider instance runs on, for usage badges: "Claude Max 20x",
 * "ChatGPT Plus", or just "Claude" when the CLI reports no subscription.
 * Derived from the auth label the provider registry already publishes.
 */
export function planLabelForProvider(
  providers: ReadonlyArray<ServerProvider>,
  providerInstanceId: string | null,
): string | null {
  if (providerInstanceId === null) return null;
  const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
  if (!provider) return null;
  const authLabel = provider.auth.label?.trim();
  if (authLabel) {
    return authLabel.replace(/\s+subscription$/i, "").replace(/\s+plan$/i, "");
  }
  return provider.displayName ?? providerDisplayName(provider.driver);
}

export function useUsagePlanLabel(providerInstanceId: string | null): string | null {
  const providers = useAtomValue(primaryServerProvidersAtom);
  return planLabelForProvider(providers, providerInstanceId);
}
