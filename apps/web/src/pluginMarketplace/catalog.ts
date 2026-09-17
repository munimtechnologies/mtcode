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
  claude: "Claude Code",
  cursor: "Cursor",
};

export const CHATGPT_PUBLIC_MARKETPLACE_NAME = "ChatGPT Public";

/** Marketplace name as shown to users; older servers only send the raw marketplace id. */
export function marketplaceDisplayName(
  plugin: Pick<MarketplacePlugin, "marketplaceLabel" | "marketplaceName">,
): string {
  return plugin.marketplaceLabel?.trim() || plugin.marketplaceName;
}

function discoverScore(plugin: MarketplacePlugin): number {
  return (
    (plugin.featured ? 8 : 0) +
    (listingHasArtwork(plugin) ? 4 : 0) +
    (plugin.category !== "Other" ? 2 : 0) +
    (plugin.marketplaceName !== CHATGPT_PUBLIC_MARKETPLACE_NAME ? 1 : 0) +
    (plugin.installPolicy === "AVAILABLE" ? 1 : 0)
  );
}

/**
 * Featured picks for the browse view: uninstalled plugins that the marketplace features or that
 * have artwork and a real category, spread across harnesses instead of taking the first names.
 */
export function pickDiscoverPlugins(
  plugins: ReadonlyArray<MarketplacePlugin>,
  count = 4,
): MarketplacePlugin[] {
  const buckets = new Map<MarketplaceHarnessId, MarketplacePlugin[]>();
  const ranked = plugins
    .filter((plugin) => !plugin.installed)
    .toSorted(
      (left, right) =>
        discoverScore(right) - discoverScore(left) || left.name.localeCompare(right.name),
    );
  for (const plugin of ranked) {
    const bucket = buckets.get(plugin.sourceHarness) ?? [];
    bucket.push(plugin);
    buckets.set(plugin.sourceHarness, bucket);
  }
  const picks: MarketplacePlugin[] = [];
  const queues = MARKETPLACE_HARNESSES.map((harness) => buckets.get(harness) ?? []);
  while (picks.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) picks.push(next);
      if (picks.length >= count) break;
    }
  }
  return picks;
}

export interface MarketplaceCategorySection {
  readonly category: string;
  readonly plugins: MarketplacePlugin[];
}

export interface MarketplaceSections {
  readonly installed: MarketplacePlugin[];
  readonly discover: MarketplacePlugin[];
  readonly categories: MarketplaceCategorySection[];
}

function compareBrowseOrder(left: MarketplacePlugin, right: MarketplacePlugin): number {
  return (
    Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
    Number(listingHasArtwork(right)) - Number(listingHasArtwork(left)) ||
    left.name.localeCompare(right.name)
  );
}

/**
 * Browse layout: installed plugins first, then featured picks, then categories ordered by size
 * with the catch-all "Other" last. A plugin appears in exactly one section.
 */
export function groupMarketplaceSections(
  plugins: ReadonlyArray<MarketplacePlugin>,
  discoverCount = 4,
): MarketplaceSections {
  const installed = plugins.filter((plugin) => plugin.installed).toSorted(compareBrowseOrder);
  const discover = pickDiscoverPlugins(plugins, discoverCount);
  const placed = new Set([...installed, ...discover].map((plugin) => plugin.id));
  const byCategory = new Map<string, MarketplacePlugin[]>();
  for (const plugin of plugins) {
    if (placed.has(plugin.id)) continue;
    const group = byCategory.get(plugin.category) ?? [];
    group.push(plugin);
    byCategory.set(plugin.category, group);
  }
  const categories = [...byCategory.entries()]
    .map(([category, group]) => ({ category, plugins: group.toSorted(compareBrowseOrder) }))
    .toSorted(
      (left, right) =>
        Number(left.category === "Other") - Number(right.category === "Other") ||
        right.plugins.length - left.plugins.length ||
        left.category.localeCompare(right.category),
    );
  return { installed, discover, categories };
}

export function marketplaceListingGroupKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

const LISTING_HARNESS_RANK: Readonly<Record<MarketplaceHarnessId, number>> = {
  codex: 0,
  claude: 1,
  cursor: 2,
};

function listingHasArtwork(plugin: Pick<MarketplacePlugin, "hasLocalLogo" | "logoUrl">) {
  return plugin.hasLocalLogo || Boolean(plugin.logoUrl?.trim());
}

function compareMarketplaceListings(left: MarketplacePlugin, right: MarketplacePlugin): number {
  return (
    Number(right.installed) - Number(left.installed) ||
    Number(listingHasArtwork(right)) - Number(listingHasArtwork(left)) ||
    Number(right.installPolicy === "AVAILABLE") - Number(left.installPolicy === "AVAILABLE") ||
    Number(right.marketplaceName !== "ChatGPT Public") -
      Number(left.marketplaceName !== "ChatGPT Public") ||
    LISTING_HARNESS_RANK[left.sourceHarness] - LISTING_HARNESS_RANK[right.sourceHarness] ||
    left.id.localeCompare(right.id)
  );
}

export function mergeMarketplaceListings(
  plugins: ReadonlyArray<MarketplacePlugin>,
): MarketplacePlugin[] {
  const groups = new Map<string, MarketplacePlugin[]>();
  for (const plugin of plugins) {
    const key = marketplaceListingGroupKey(plugin.name);
    const group = groups.get(key) ?? [];
    group.push(plugin);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const primary = [...group].toSorted(compareMarketplaceListings)[0]!;
    const byHarness = new Map<MarketplaceHarnessId, MarketplaceHarnessSupport>();
    for (const plugin of group) {
      for (const entry of plugin.support) {
        const current = byHarness.get(entry.harness);
        byHarness.set(entry.harness, {
          harness: entry.harness,
          mcp: Boolean(current?.mcp || entry.mcp),
          skills: Boolean(current?.skills || entry.skills),
          apps: Boolean(current?.apps || entry.apps),
        });
      }
    }
    return {
      ...primary,
      installed: group.some((plugin) => plugin.installed),
      enabled: group.some((plugin) => plugin.enabled),
      support: [...byHarness.values()].toSorted(
        (left, right) => LISTING_HARNESS_RANK[left.harness] - LISTING_HARNESS_RANK[right.harness],
      ),
      contents: {
        skillCount: Math.max(0, ...group.map((plugin) => plugin.contents.skillCount)),
        mcpServerCount: Math.max(0, ...group.map((plugin) => plugin.contents.mcpServerCount)),
        appCount: Math.max(0, ...group.map((plugin) => plugin.contents.appCount)),
        commandCount: Math.max(0, ...group.map((plugin) => plugin.contents.commandCount)),
        agentCount: Math.max(0, ...group.map((plugin) => plugin.contents.agentCount)),
        ruleCount: Math.max(0, ...group.map((plugin) => plugin.contents.ruleCount)),
        hookCount: Math.max(0, ...group.map((plugin) => plugin.contents.hookCount)),
        hasHooks: group.some((plugin) => plugin.contents.hasHooks),
      },
    };
  });
}

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
