import type { UsageProviderKind } from "@t3tools/contracts";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

export const PROVIDER_ORDER: readonly UsageProviderKind[] = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "antigravity",
  "pi",
];

/** The usage series a provider driver reports under, or null for drivers without one. */
export function usageProviderKind(driver: string): UsageProviderKind | null {
  if (driver === "claudeAgent") return "claude";
  return PROVIDER_ORDER.find((kind) => kind === driver) ?? null;
}

export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  pi: "Pi",
};

/**
 * Claude's brand orange holds in both themes; Codex, Cursor, Grok, and OpenCode
 * are neutral and must flip with the theme or their bars vanish against the
 * matching background.
 */
export function useProviderColors(): Record<UsageProviderKind, string> {
  const { themeAppearance: scheme } = useAppearancePreferences();
  return {
    claude: "#d97757",
    codex: scheme === "dark" ? "#e6e6e6" : "#3c3c43",
    cursor: scheme === "dark" ? "#a3a3a3" : "#52525b",
    grok: scheme === "dark" ? "#8b8b8b" : "#636366",
    opencode: scheme === "dark" ? "#8f8b8b" : "#8a8585",
    antigravity: "#8c7bd1",
    pi: "#4d9f8a",
  };
}

export function useUsageMixColors() {
  const { themeAppearance: scheme } = useAppearancePreferences();
  const dark = scheme === "dark";
  return {
    input: dark ? "#737373" : "#848484",
    cacheRead: dark ? "#282828" : "#c0c0c0",
    cacheWrite: dark ? "#949494" : "#6d6d6d",
    output: dark ? "#e6e6e6" : "#3c3c43",
    other: dark ? "#494949" : "#a3a3a3",
    standard: dark ? "#313131" : "#b8b8b8",
    fast: dark ? "#838383" : "#797979",
    ultrafast: dark ? "#e6e6e6" : "#3c3c43",
  };
}
