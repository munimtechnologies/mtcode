export type ConnectProviderId = "mt" | "t3";

export interface ConnectProviderPublicConfig {
  readonly id: ConnectProviderId;
  readonly label: string;
  readonly clerkPublishableKey: string;
  readonly clerkJwtTemplate: string;
  readonly clerkCliOAuthClientId: string;
  readonly relayUrl: string;
  readonly hostedAppUrl: string;
}

const T3_CONNECT_HOSTED_APP_URL = "https://app.t3.codes";

export const CONNECT_PROVIDER_STORAGE_KEY = "mtcode.connect-provider";

export interface ConnectEmbedContext {
  readonly origin: string;
  readonly isElectron: boolean;
}

export function parseConnectProviders(raw: string | undefined): ConnectProviderPublicConfig[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const id = record.id === "mt" || record.id === "t3" ? record.id : null;
      const clerkPublishableKey =
        typeof record.clerkPublishableKey === "string" ? record.clerkPublishableKey.trim() : "";
      const clerkJwtTemplate =
        typeof record.clerkJwtTemplate === "string" ? record.clerkJwtTemplate.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      if (!id || !clerkPublishableKey || !clerkJwtTemplate || !label) return [];
      return [
        {
          id,
          label,
          clerkPublishableKey,
          clerkJwtTemplate,
          clerkCliOAuthClientId:
            typeof record.clerkCliOAuthClientId === "string"
              ? record.clerkCliOAuthClientId.trim()
              : "",
          relayUrl: typeof record.relayUrl === "string" ? record.relayUrl.trim() : "",
          hostedAppUrl:
            typeof record.hostedAppUrl === "string" && record.hostedAppUrl.trim()
              ? record.hostedAppUrl.trim()
              : id === "t3"
                ? T3_CONNECT_HOSTED_APP_URL
                : "",
        } satisfies ConnectProviderPublicConfig,
      ];
    });
  } catch {
    return [];
  }
}

export function readBakedConnectProviders(): ConnectProviderPublicConfig[] {
  const baked = parseConnectProviders(import.meta.env.VITE_CONNECT_PROVIDERS as string | undefined);
  if (baked.length > 0) return baked;

  const clerkPublishableKey = (
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined
  )?.trim();
  const clerkJwtTemplate = (import.meta.env.VITE_CLERK_JWT_TEMPLATE as string | undefined)?.trim();
  if (!clerkPublishableKey || !clerkJwtTemplate) return [];

  const relayUrl = (import.meta.env.VITE_T3CODE_RELAY_URL as string | undefined)?.trim() ?? "";
  return [
    {
      id: "t3",
      label: "T3 Connect",
      clerkPublishableKey,
      clerkJwtTemplate,
      clerkCliOAuthClientId:
        (import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID as string | undefined)?.trim() ?? "",
      relayUrl,
      hostedAppUrl:
        (import.meta.env.VITE_HOSTED_APP_URL as string | undefined)?.trim() ||
        T3_CONNECT_HOSTED_APP_URL,
    },
  ];
}

export function canEmbedClerkProvider(
  provider: ConnectProviderPublicConfig,
  ctx: ConnectEmbedContext,
): boolean {
  if (provider.id === "t3") {
    // T3's production Clerk instance rejects origins other than app.t3.codes.
    // Electron already talks to that instance successfully.
    return ctx.isElectron || ctx.origin === T3_CONNECT_HOSTED_APP_URL;
  }
  return true;
}

export function readStoredConnectProviderId(): ConnectProviderId | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(CONNECT_PROVIDER_STORAGE_KEY);
    return value === "mt" || value === "t3" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredConnectProviderId(id: ConnectProviderId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONNECT_PROVIDER_STORAGE_KEY, id);
  } catch {
    // Ignore quota / private-mode failures; the in-memory selection still applies.
  }
}

export function resolveDefaultConnectProviderId(
  providers: ReadonlyArray<ConnectProviderPublicConfig>,
  ctx: ConnectEmbedContext,
): ConnectProviderId | null {
  if (providers.length === 0) return null;
  const stored = readStoredConnectProviderId();
  if (stored) {
    const storedProvider = providers.find((provider) => provider.id === stored) ?? null;
    // Ignore a persisted T3 selection on origins where T3 Clerk cannot embed —
    // otherwise the UI claims "T3" while the session stays on MT Connect.
    if (storedProvider && canEmbedClerkProvider(storedProvider, ctx)) {
      return stored;
    }
    if (storedProvider && !canEmbedClerkProvider(storedProvider, ctx)) {
      const fallback = providers.find((provider) => canEmbedClerkProvider(provider, ctx))?.id;
      if (fallback) writeStoredConnectProviderId(fallback);
    }
  }
  // Prefer the provider that can actually tunnel (Sheehan, 2026-08-25):
  // cross-machine sync goes through T3 Connect's relay, so a relay-capable
  // provider outranks a Clerk-only one. MT Connect stays one switch away for
  // mtcode.munimtech.com sign-in; on origins where T3 Clerk cannot embed
  // (the hosted web app) the Clerk-only provider remains the default.
  const relayCapable = providers.find(
    (provider) => provider.relayUrl !== "" && canEmbedClerkProvider(provider, ctx),
  );
  if (relayCapable) return relayCapable.id;
  const mt = providers.find((provider) => provider.id === "mt");
  if (mt) return "mt";
  const embeddable = providers.find((provider) => canEmbedClerkProvider(provider, ctx));
  return embeddable?.id ?? providers[0]?.id ?? null;
}

/** Persist an in-app Connect identity only when Clerk can actually embed it. */
export function selectEmbeddableConnectProviderId(
  providers: ReadonlyArray<ConnectProviderPublicConfig>,
  id: ConnectProviderId,
  ctx: ConnectEmbedContext,
): ConnectProviderId | null {
  const provider = providers.find((entry) => entry.id === id) ?? null;
  if (!provider) return null;
  if (canEmbedClerkProvider(provider, ctx)) return id;
  return null;
}

export function resolveEmbeddedClerkProvider(
  providers: ReadonlyArray<ConnectProviderPublicConfig>,
  activeId: ConnectProviderId | null,
  ctx: ConnectEmbedContext,
): ConnectProviderPublicConfig | null {
  const active = providers.find((provider) => provider.id === activeId) ?? null;
  if (active && canEmbedClerkProvider(active, ctx)) return active;
  return providers.find((provider) => canEmbedClerkProvider(provider, ctx)) ?? null;
}

export function providerHasRelay(provider: ConnectProviderPublicConfig | null): boolean {
  const relayUrl = provider?.relayUrl?.trim() ?? "";
  return Boolean(provider && relayUrl.startsWith("https://"));
}

export function currentEmbedContext(): ConnectEmbedContext {
  return {
    origin: typeof window === "undefined" ? "" : window.location.origin,
    isElectron: typeof window !== "undefined" && window.desktopBridge !== undefined,
  };
}
