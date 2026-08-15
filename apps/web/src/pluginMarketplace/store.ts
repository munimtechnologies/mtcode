import type { PluginMarketplaceDetail, PluginMarketplacePlugin } from "@t3tools/contracts";
import { create } from "zustand";

import {
  fetchPluginMarketplaceCatalog,
  fetchPluginMarketplaceDetail,
  installPlugin,
  removePlugin,
} from "./api";

type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface PluginDetailState {
  readonly status: LoadStatus;
  readonly plugin: PluginMarketplaceDetail | null;
  readonly error: string | null;
}

interface PluginMarketplaceStoreState {
  readonly catalogStatus: LoadStatus;
  readonly plugins: ReadonlyArray<PluginMarketplacePlugin>;
  readonly catalogError: string | null;
  readonly details: Readonly<Record<string, PluginDetailState | undefined>>;
  readonly pending: Readonly<Record<string, boolean | undefined>>;
  loadCatalog: (force?: boolean) => Promise<void>;
  loadDetail: (pluginId: string, force?: boolean) => Promise<void>;
  setInstalled: (pluginIds: ReadonlyArray<string>, installed: boolean) => Promise<void>;
  install: (pluginId: string) => Promise<void>;
  remove: (pluginId: string) => Promise<void>;
}

export function pluginMarketplaceErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "object" && error !== null && "detail" in error) {
    const detail = Reflect.get(error, "detail");
    if (typeof detail === "string" && detail.trim().length > 0) return detail;
  }
  return "The plugin marketplaces could not be loaded.";
}

let catalogRequest: Promise<void> | null = null;
const detailRequests = new Map<string, Promise<void>>();

export const usePluginMarketplaceStore = create<PluginMarketplaceStoreState>((set, get) => ({
  catalogStatus: "idle",
  plugins: [],
  catalogError: null,
  details: {},
  pending: {},

  loadCatalog: async (force = false) => {
    if (!force && get().catalogStatus === "ready") return;
    if (catalogRequest) return catalogRequest;

    const request = (async () => {
      set({ catalogStatus: "loading", catalogError: null });
      try {
        const catalog = await fetchPluginMarketplaceCatalog();
        set({ catalogStatus: "ready", plugins: catalog.plugins, catalogError: null });
      } catch (error) {
        set({ catalogStatus: "error", catalogError: pluginMarketplaceErrorMessage(error) });
        throw error;
      }
    })();
    catalogRequest = request;
    try {
      await request;
    } finally {
      catalogRequest = null;
    }
  },

  loadDetail: async (pluginId, force = false) => {
    const current = get().details[pluginId];
    if (!force && current?.status === "ready") return;
    const existing = detailRequests.get(pluginId);
    if (existing) return existing;

    const request = (async () => {
      set((state) => ({
        details: {
          ...state.details,
          [pluginId]: { status: "loading", plugin: current?.plugin ?? null, error: null },
        },
      }));
      try {
        const plugin = await fetchPluginMarketplaceDetail(pluginId);
        set((state) => ({
          details: {
            ...state.details,
            [pluginId]: { status: "ready", plugin, error: null },
          },
        }));
      } catch (error) {
        set((state) => ({
          details: {
            ...state.details,
            [pluginId]: {
              status: "error",
              plugin: null,
              error: pluginMarketplaceErrorMessage(error),
            },
          },
        }));
        throw error;
      }
    })();
    detailRequests.set(pluginId, request);
    try {
      await request;
    } finally {
      detailRequests.delete(pluginId);
    }
  },

  setInstalled: async (pluginIds, installed) => {
    const uniquePluginIds = [...new Set(pluginIds)];
    if (uniquePluginIds.length === 0) return;
    const affectedPackages = new Set<string>();
    const currentState = get();
    for (const pluginId of uniquePluginIds) {
      const catalogPlugin = currentState.plugins.find((plugin) => plugin.id === pluginId);
      if (catalogPlugin) affectedPackages.add(catalogPlugin.packageName);
      for (const detail of Object.values(currentState.details)) {
        if (detail?.plugin?.installTargets.some((target) => target.pluginId === pluginId)) {
          affectedPackages.add(detail.plugin.packageName);
        }
      }
    }
    set((state) => ({
      pending: {
        ...state.pending,
        ...Object.fromEntries(uniquePluginIds.map((pluginId) => [pluginId, true])),
      },
    }));
    try {
      const results = await Promise.allSettled(
        uniquePluginIds.map((pluginId) =>
          installed ? installPlugin(pluginId) : removePlugin(pluginId),
        ),
      );
      await get().loadCatalog(true);
      const detailIds = new Set(uniquePluginIds);
      for (const [pluginId, detail] of Object.entries(get().details)) {
        if (detail?.plugin && affectedPackages.has(detail.plugin.packageName)) {
          detailIds.add(pluginId);
        }
      }
      await Promise.all([...detailIds].map((pluginId) => get().loadDetail(pluginId, true)));
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) throw failure.reason;
    } finally {
      set((state) => ({
        pending: {
          ...state.pending,
          ...Object.fromEntries(uniquePluginIds.map((pluginId) => [pluginId, false])),
        },
      }));
    }
  },

  install: async (pluginId) => get().setInstalled([pluginId], true),

  remove: async (pluginId) => get().setInstalled([pluginId], false),
}));
