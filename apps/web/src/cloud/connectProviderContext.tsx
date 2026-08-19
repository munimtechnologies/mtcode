import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import {
  canEmbedClerkProvider,
  currentEmbedContext,
  readBakedConnectProviders,
  resolveDefaultConnectProviderId,
  resolveEmbeddedClerkProvider,
  writeStoredConnectProviderId,
  type ConnectProviderId,
  type ConnectProviderPublicConfig,
} from "./connectProviders";

interface ConnectProvidersContextValue {
  readonly providers: ReadonlyArray<ConnectProviderPublicConfig>;
  readonly activeId: ConnectProviderId | null;
  readonly active: ConnectProviderPublicConfig | null;
  readonly embedded: ConnectProviderPublicConfig | null;
  readonly setActiveId: (id: ConnectProviderId) => void;
}

const ConnectProvidersContext = createContext<ConnectProvidersContextValue | null>(null);

export function ConnectProvidersRoot({ children }: { readonly children: ReactNode }) {
  const providers = useMemo(() => readBakedConnectProviders(), []);
  const [activeId, setActiveIdState] = useState<ConnectProviderId | null>(() =>
    resolveDefaultConnectProviderId(providers, currentEmbedContext()),
  );

  const setActiveId = useCallback((id: ConnectProviderId) => {
    setActiveIdState(id);
    writeStoredConnectProviderId(id);
  }, []);

  const value = useMemo<ConnectProvidersContextValue>(() => {
    const ctx = currentEmbedContext();
    const active = providers.find((provider) => provider.id === activeId) ?? null;
    return {
      providers,
      activeId,
      active,
      embedded: resolveEmbeddedClerkProvider(providers, activeId, ctx),
      setActiveId,
    };
  }, [activeId, providers, setActiveId]);

  return (
    <ConnectProvidersContext.Provider value={value}>{children}</ConnectProvidersContext.Provider>
  );
}

export function useConnectProviders(): ConnectProvidersContextValue {
  const value = useContext(ConnectProvidersContext);
  if (!value) {
    throw new Error("useConnectProviders must be used within ConnectProvidersRoot");
  }
  return value;
}

export function useOptionalConnectProviders(): ConnectProvidersContextValue | null {
  return useContext(ConnectProvidersContext);
}

export function canEmbedClerkProviderInThisClient(provider: ConnectProviderPublicConfig): boolean {
  return canEmbedClerkProvider(provider, currentEmbedContext());
}
