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

/** Claude and Codex are the only providers with subscription rate-limit windows today. */
export const LIMITS_PROVIDER_ORDER: readonly UsageProviderKind[] = ["codex", "claude"];

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
