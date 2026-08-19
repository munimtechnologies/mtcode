import {
  DEFAULT_MT_MODEL_ROUTE_MODE,
  isMtModelInstanceId,
  MT_MODEL_DISPLAY_NAME,
  MT_MODEL_DRIVER_KIND,
  MT_MODEL_INSTANCE_ID,
  MT_MODEL_PROVIDER_LABEL,
  MT_MODEL_ROUTE_MODE_OPTION_ID,
  MT_MODEL_SLUG,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import type { ProviderInstanceEntry } from "./providerInstances";

export function createMtModelCapabilities() {
  return createModelCapabilities({
    optionDescriptors: [
      {
        id: MT_MODEL_ROUTE_MODE_OPTION_ID,
        label: "Routing",
        description:
          "How aggressively MT Model spends quota on frontier models. Cost keeps chores cheap; Intelligence upgrades harder tasks. Routing is local and free.",
        type: "select",
        currentValue: DEFAULT_MT_MODEL_ROUTE_MODE,
        options: [
          {
            id: "cost",
            label: "Cost",
            description: "Prefer fast, cheaper models unless the task is clearly hard.",
          },
          {
            id: "balance",
            label: "Balance",
            description: "Mix quality, speed, and remaining quota. Default.",
            isDefault: true,
          },
          {
            id: "intelligence",
            label: "Intelligence",
            description: "Reach for frontier models sooner on planning, debugging, and refactors.",
          },
        ],
      },
    ],
  });
}

export function createMtModelProviderModel(): ServerProviderModel {
  return {
    slug: MT_MODEL_SLUG,
    name: MT_MODEL_DISPLAY_NAME,
    shortName: MT_MODEL_DISPLAY_NAME,
    isCustom: false,
    isDefault: true,
    capabilities: createMtModelCapabilities(),
  };
}

export function createMtModelProviderSnapshot(): ServerProvider {
  return {
    instanceId: MT_MODEL_INSTANCE_ID,
    driver: MT_MODEL_DRIVER_KIND,
    displayName: MT_MODEL_PROVIDER_LABEL,
    badgeLabel: "Auto",
    showInteractionModeToggle: true,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "unknown" },
    checkedAt: "1970-01-01T00:00:00.000Z",
    availability: "available",
    message: "Routes each turn to a ready model. Local and free.",
    models: [createMtModelProviderModel()],
    slashCommands: [],
    skills: [],
  };
}

export function withMtModelProvider(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  if (providers.some((provider) => isMtModelInstanceId(provider.instanceId))) {
    return providers;
  }
  const hasReadyBackend = providers.some(
    (provider) =>
      !isMtModelInstanceId(provider.instanceId) &&
      provider.enabled &&
      provider.availability !== "unavailable" &&
      (provider.status === "ready" || provider.status === "warning"),
  );
  if (!hasReadyBackend) {
    return providers;
  }
  return [createMtModelProviderSnapshot(), ...providers];
}

export function prependMtModelPickerEntry(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  if (entries.some((entry) => isMtModelInstanceId(entry.instanceId))) {
    return entries;
  }
  const hasReadyBackend = entries.some(
    (entry) =>
      !isMtModelInstanceId(entry.instanceId) &&
      entry.enabled &&
      entry.isAvailable &&
      (entry.status === "ready" || entry.status === "warning"),
  );
  if (!hasReadyBackend) {
    return entries;
  }
  const snapshot = createMtModelProviderSnapshot();
  const mtEntry: ProviderInstanceEntry = {
    instanceId: MT_MODEL_INSTANCE_ID,
    driverKind: MT_MODEL_DRIVER_KIND,
    displayName: MT_MODEL_PROVIDER_LABEL,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot,
    models: snapshot.models,
  };
  return [mtEntry, ...entries];
}

export function isMtModelPickerKey(instanceId: ProviderInstanceId, slug: string): boolean {
  return isMtModelInstanceId(instanceId) && slug === MT_MODEL_SLUG;
}
