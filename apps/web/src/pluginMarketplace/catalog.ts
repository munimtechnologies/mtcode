import type {
  PluginMarketplaceDetail,
  PluginMarketplaceHarnessId,
  PluginMarketplaceHarnessSupport,
  PluginMarketplacePlugin,
} from "@t3tools/contracts";

export const MARKETPLACE_HARNESSES = ["codex", "claude", "cursor"] as const;

export type MarketplaceHarnessId = PluginMarketplaceHarnessId;
export type MarketplaceHarnessSupport = PluginMarketplaceHarnessSupport;
export type MarketplacePlugin = PluginMarketplacePlugin;
export type MarketplacePluginKind = "mcp" | "skill" | "app";

export const MARKETPLACE_HARNESS_LABELS: Readonly<Record<MarketplaceHarnessId, string>> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
};

export function marketplacePluginKinds(
  plugin: Pick<MarketplacePlugin, "contents">,
): ReadonlyArray<MarketplacePluginKind> {
  return [
    plugin.contents.mcpServerCount > 0 ? "mcp" : null,
    plugin.contents.skillCount > 0 ? "skill" : null,
    plugin.contents.appCount > 0 ? "app" : null,
  ].filter((kind): kind is MarketplacePluginKind => kind !== null);
}

const EXTENSION_INCLUDE_LABELS: Readonly<
  Record<PluginMarketplaceDetail["extensions"][number]["kind"], string>
> = {
  command: "Commands",
  agent: "Subagents",
  rule: "Rules",
  hook: "Hooks",
  lsp: "Language servers",
  monitor: "Monitors",
};

export function marketplacePluginIncludeLabels(
  plugin: Pick<PluginMarketplaceDetail, "contents" | "extensions">,
): ReadonlyArray<string> {
  const extensionKinds = [...new Set(plugin.extensions.map((extension) => extension.kind))];
  return [
    ...marketplacePluginKinds(plugin).map((kind) =>
      kind === "mcp" ? "MCP" : kind === "skill" ? "Skills" : "Apps",
    ),
    ...extensionKinds.map((kind) => EXTENSION_INCLUDE_LABELS[kind]),
    ...(plugin.contents.hasHooks && !extensionKinds.includes("hook") ? ["Hooks"] : []),
  ];
}
