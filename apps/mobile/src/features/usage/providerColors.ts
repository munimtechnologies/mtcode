import type { UsageProviderKind } from "@t3tools/contracts";

// Claude's orange holds in both themes; the neutral providers flip with the theme so their bars
// stay visible against the matching background.
export function providerColors(scheme: "light" | "dark"): Record<UsageProviderKind, string> {
  return {
    claude: "#d97757",
    codex: scheme === "dark" ? "#e6e6e6" : "#3c3c43",
    cursor: scheme === "dark" ? "#a3a3a3" : "#52525b",
    grok: scheme === "dark" ? "#8b8b8b" : "#636366",
    opencode: scheme === "dark" ? "#8f8b8b" : "#8a8585",
    antigravity: "#8c7bd1",
    pi: "#4d9f8a",
    muse: "#0866ff",
  };
}
