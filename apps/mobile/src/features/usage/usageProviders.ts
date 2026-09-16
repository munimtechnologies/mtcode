import type { UsageProviderKind } from "@t3tools/contracts";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

/**
 * Series and table order. The chart stacks providers from the bottom in this
 * order, so it also fixes which band sits on top of the bars.
 */
<<<<<<< ours
export const PROVIDER_ORDER: readonly UsageProviderKind[] = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
];
||||||| base
export const PROVIDER_ORDER: readonly UsageProviderKind[] = ["codex", "claude", "grok"];
=======
export const PROVIDER_ORDER: readonly UsageProviderKind[] = ["codex", "claude", "grok", "pi"];
>>>>>>> theirs

export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  pi: "Pi",
};

/**
<<<<<<< ours
 * Claude's brand orange holds in both themes; Codex, Cursor, Grok, and OpenCode
 * are neutral and must flip with the theme or their bars vanish against the
 * matching background.
||||||| base
 * Claude's brand orange holds in both themes; Codex and Grok are neutrals and
 * must flip with the theme or their bars vanish against the matching background.
=======
 * Claude and Pi use fixed brand colors; Codex and Grok are neutrals that must
 * flip with the theme or their bars vanish against the matching background.
>>>>>>> theirs
 */
export function useProviderColors(): Record<UsageProviderKind, string> {
  const { themeAppearance: scheme } = useAppearancePreferences();
  return {
    claude: "#d97757",
    codex: scheme === "dark" ? "#e6e6e6" : "#3c3c43",
    cursor: scheme === "dark" ? "#a3a3a3" : "#52525b",
    grok: scheme === "dark" ? "#8b8b8b" : "#636366",
    opencode: scheme === "dark" ? "#8f8b8b" : "#8a8585",
    pi: "#8b5cf6",
  };
}
