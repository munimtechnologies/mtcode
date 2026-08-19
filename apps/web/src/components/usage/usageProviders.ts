import type { UsageProviderKind } from "@t3tools/contracts";

import { ClaudeAI, CursorIcon, GrokIcon, type Icon, OpenAI, OpenCodeIcon } from "../Icons";

type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly mark: Icon;
};

/**
 * Exhaustive presentation for providers supported by the usage contract.
 * Declaration order is reused by every chart, table, legend, and skeleton, so
 * adding a provider only requires its contract support and one entry here.
 */
export const PROVIDER_PRESENTATION = {
  codex: {
    label: "Codex",
    color: "var(--foreground)",
    mark: OpenAI,
  },
  claude: {
    label: "Claude Code",
    color: "#d97757",
    mark: ClaudeAI,
  },
  cursor: {
    label: "Cursor",
    color: "var(--muted-foreground)",
    mark: CursorIcon,
  },
  grok: {
    label: "Grok",
    color: "#8b8b8b",
    mark: GrokIcon,
  },
  opencode: {
    label: "OpenCode",
    color: "#8f8b8b",
    mark: OpenCodeIcon,
  },
} satisfies Record<UsageProviderKind, UsageProviderPresentation>;

/** Stable provider reading order across charts, summaries, tables, and hover rows. */
export const PROVIDER_ORDER = Object.keys(PROVIDER_PRESENTATION) as UsageProviderKind[];

/** Claude, Codex, and Cursor are the providers with subscription rate-limit windows today. */
export const LIMITS_PROVIDER_ORDER: readonly UsageProviderKind[] = ["codex", "claude", "cursor"];

export function providerHasLimitWindows(
  rows: ReadonlyArray<{ readonly snapshot: { readonly windows: readonly unknown[] } }> | undefined,
): boolean {
  return (rows ?? []).some((row) => row.snapshot.windows.length > 0);
}

/**
 * Codex/Claude/Cursor by default; other providers only once they actually
 * report windows. Providers switched off in Settings drop out entirely,
 * unless they still report a window (an account that is out of quota is worth
 * seeing even while the driver is off). `enabled` is null before any computer
 * has streamed its provider config - show the default set rather than blink.
 */
export function visibleLimitsProviders(
  byProvider: ReadonlyMap<
    UsageProviderKind,
    ReadonlyArray<{ readonly snapshot: { readonly windows: readonly unknown[] } }>
  >,
  enabled?: ReadonlySet<UsageProviderKind> | null,
): readonly UsageProviderKind[] {
  const hasWindows = (provider: UsageProviderKind) =>
    providerHasLimitWindows(byProvider.get(provider));
  const isVisible = (provider: UsageProviderKind) =>
    enabled == null || enabled.has(provider) || hasWindows(provider);
  const base = LIMITS_PROVIDER_ORDER.filter(isVisible);
  const extras = PROVIDER_ORDER.filter(
    (provider) =>
      !LIMITS_PROVIDER_ORDER.includes(provider) && hasWindows(provider) && isVisible(provider),
  );
  return [...base, ...extras];
}

export const PROVIDER_LABEL = Object.fromEntries(
  Object.entries(PROVIDER_PRESENTATION).map(([provider, presentation]) => [
    provider,
    presentation.label,
  ]),
) as Record<UsageProviderKind, string>;

export const PROVIDER_COLOR = Object.fromEntries(
  Object.entries(PROVIDER_PRESENTATION).map(([provider, presentation]) => [
    provider,
    presentation.color,
  ]),
) as Record<UsageProviderKind, string>;

export const PROVIDER_MARK = Object.fromEntries(
  Object.entries(PROVIDER_PRESENTATION).map(([provider, presentation]) => [
    provider,
    presentation.mark,
  ]),
) as Record<UsageProviderKind, Icon>;
