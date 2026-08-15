import type {
  PluginMarketplaceDetail,
  PluginMarketplaceHarnessId,
  PluginMarketplaceHarnessSupport,
  PluginMarketplacePlugin,
} from "@t3tools/contracts";

export const MARKETPLACE_HARNESSES = ["codex", "claude", "cursor", "grok", "opencode"] as const;

export type MarketplaceHarnessId = PluginMarketplaceHarnessId;
export type MarketplaceHarnessSupport = PluginMarketplaceHarnessSupport;
export type MarketplacePlugin = PluginMarketplacePlugin;
export type MarketplacePluginDetail = PluginMarketplaceDetail;
export type MarketplacePluginKind = "mcp" | "skill" | "app";

export const MARKETPLACE_HARNESS_LABELS: Readonly<Record<MarketplaceHarnessId, string>> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
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
