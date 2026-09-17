import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";

/** "Codex" for `codex`; an unknown driver kind is title-cased instead of hidden. */
export function providerDisplayName(provider: string | null): string | null {
  if (provider === null) return null;
  return (
    (PROVIDER_DISPLAY_NAMES as Partial<Record<string, string>>)[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1).replace(/[-_]+/g, " ")
  );
}
