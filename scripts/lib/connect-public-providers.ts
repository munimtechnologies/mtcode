/**
 * Public Connect identifiers baked into client builds. T3's values are the same
 * ones in `.env.example` (publishable key, JWT template, OAuth client id, relay
 * URL) — not secrets. Munim's Clerk keys come from the process env when
 * `~/.mt/munim-connect.env` is loaded.
 */

export const T3_CONNECT_PUBLISHABLE_KEY = "pk_live_Y2xlcmsudDMuY29kZXMk";
export const T3_CONNECT_JWT_TEMPLATE = "t3-relay";
export const T3_CONNECT_CLI_OAUTH_CLIENT_ID = "hzxSgY2cH10sDU2r";
export const T3_CONNECT_RELAY_URL = "https://relay.t3.codes";
export const T3_CONNECT_HOSTED_APP_URL = "https://app.t3.codes";
export const MT_CONNECT_HOSTED_APP_URL = "https://mtcode.munimtech.com";

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

export const T3_CONNECT_PUBLIC_PROVIDER: ConnectProviderPublicConfig = {
  id: "t3",
  label: "T3 Connect",
  clerkPublishableKey: T3_CONNECT_PUBLISHABLE_KEY,
  clerkJwtTemplate: T3_CONNECT_JWT_TEMPLATE,
  clerkCliOAuthClientId: T3_CONNECT_CLI_OAUTH_CLIENT_ID,
  relayUrl: T3_CONNECT_RELAY_URL,
  hostedAppUrl: T3_CONNECT_HOSTED_APP_URL,
};

export function isT3ConnectPublishableKey(value: string | undefined): boolean {
  return value?.trim() === T3_CONNECT_PUBLISHABLE_KEY;
}

export function buildConnectProviders(
  _env: Readonly<Record<string, string | undefined>>,
): ConnectProviderPublicConfig[] {
  // Clerk-based MT Connect is retired (2026-08-25): teams run on MT Teams
  // (Better Auth + Convex) and machine sync runs on T3 Connect. One Connect
  // identity means no identity switch and no "Use MT Connect" affordance.
  return [T3_CONNECT_PUBLIC_PROVIDER];
}

export function serializeConnectProviders(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return JSON.stringify(buildConnectProviders(env));
}
