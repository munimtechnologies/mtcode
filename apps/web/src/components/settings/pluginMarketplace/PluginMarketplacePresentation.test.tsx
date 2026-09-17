import type { PluginMarketplacePlugin } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  groupMarketplaceSections,
  marketplaceDisplayName,
  marketplacePluginIncludeLabels,
  pickDiscoverPlugins,
} from "~/pluginMarketplace/catalog";

import {
  HarnessSupportBadges,
  PluginLogo,
  pluginLogoSource,
} from "./PluginMarketplacePresentation";

const plugin: PluginMarketplacePlugin = {
  id: "computer-use@openai-bundled",
  sourceHarness: "codex",
  packageName: "computer-use",
  name: "Computer Use",
  summary: "Control local Mac apps from Codex",
  developer: "OpenAI",
  category: "Productivity",
  version: "1.0.0",
  marketplaceName: "openai-bundled",
  marketplaceSourceType: "git",
  installPolicy: "AVAILABLE",
  authPolicy: "ON_INSTALL",
  installed: true,
  enabled: true,
  brandColor: null,
  hasLocalLogo: true,
  logoDataUrl: "data:image/png;base64,aWNvbg==",
  logoUrl: null,
  contents: {
    skillCount: 1,
    mcpServerCount: 1,
    appCount: 1,
    commandCount: 0,
    agentCount: 0,
    ruleCount: 0,
    hookCount: 0,
    hasHooks: false,
  },
  support: [{ harness: "codex", mcp: true, skills: true, apps: true }],
};

describe("plugin marketplace presentation", () => {
  it("renders the plugin artwork returned by Codex", () => {
    const markup = renderToStaticMarkup(<PluginLogo plugin={plugin} />);

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Computer Use logo"');
    expect(markup).toContain('src="data:image/png;base64,aWNvbg=="');
  });

  it("renders a signed remote Codex logo URL with its query intact", () => {
    const logoUrl =
      "https://files.openai.com/content?id=file_00000000888c81f58498ed091b03bc04&cdn=1&cp=pi&sig=2fbc&v=0";
    const markup = renderToStaticMarkup(
      <PluginLogo
        plugin={{ ...plugin, name: "Notion", hasLocalLogo: false, logoDataUrl: null, logoUrl }}
      />,
    );

    expect(markup).toContain(`src="${logoUrl.replaceAll("&", "&amp;")}"`);
  });

  it("falls back from missing or failed artwork to the remote logo, then to letters", () => {
    const remote = "https://files.openai.com/content?id=file_1&sig=abc";
    const base = {
      logoDataUrl: null,
      hasLocalLogo: true,
      localLogoResolved: false,
      localLogoDataUrl: null,
      logoUrl: remote,
      failedSources: [],
    };
    // Waits for the on-disk logo before showing the remote one.
    expect(pluginLogoSource(base)).toBeNull();
    expect(pluginLogoSource({ ...base, localLogoResolved: true, localLogoDataUrl: "data:a" })).toBe(
      "data:a",
    );
    // On-disk logo missing or broken: use the source's remote logo.
    expect(pluginLogoSource({ ...base, localLogoResolved: true })).toBe(remote);
    expect(
      pluginLogoSource({
        ...base,
        localLogoResolved: true,
        localLogoDataUrl: "data:a",
        failedSources: ["data:a"],
      }),
    ).toBe(remote);
    // Every candidate failed: letter avatar.
    expect(pluginLogoSource({ ...base, hasLocalLogo: false, failedSources: [remote] })).toBeNull();
    expect(pluginLogoSource({ ...base, hasLocalLogo: false, logoUrl: "  " })).toBeNull();
  });

  it("uses readable fallback logo text in light and dark themes", () => {
    const markup = renderToStaticMarkup(
      <PluginLogo plugin={{ ...plugin, hasLocalLogo: false, logoDataUrl: null, logoUrl: null }} />,
    );

    expect(markup).toMatch(/text-(?:blue|emerald|violet|amber|rose|cyan)-700/);
    expect(markup).toMatch(/dark:text-(?:blue|emerald|violet|amber|rose|cyan)-300/);
  });

  it("labels harness badges with each real bundle capability", () => {
    const markup = renderToStaticMarkup(<HarnessSupportBadges support={plugin.support} />);

    expect(markup).toContain('role="group"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Codex: MCP + skills + apps"');
    expect(markup).not.toContain('aria-label="Cursor:');
  });

  it("shows the marketplace display name and falls back to the raw marketplace id", () => {
    expect(marketplaceDisplayName({ ...plugin, marketplaceLabel: "Codex official" })).toBe(
      "Codex official",
    );
    expect(marketplaceDisplayName(plugin)).toBe("openai-bundled");
  });

  it("includes every extension kind without duplicating hooks", () => {
    expect(
      marketplacePluginIncludeLabels({
        contents: { ...plugin.contents, hasHooks: true },
        extensions: [
          { id: "run", name: "Run", kind: "command", description: "", sourceUrl: null },
          { id: "review", name: "Review", kind: "agent", description: "", sourceUrl: null },
          { id: "start", name: "Start", kind: "hook", description: "", sourceUrl: null },
          { id: "typescript", name: "TypeScript", kind: "lsp", description: "", sourceUrl: null },
          { id: "health", name: "Health", kind: "monitor", description: "", sourceUrl: null },
        ],
      }),
    ).toEqual([
      "MCP",
      "Skills",
      "Apps",
      "Commands",
      "Subagents",
      "Hooks",
      "Language servers",
      "Monitors",
    ]);
  });
});

function listing(
  id: string,
  input: {
    readonly harness?: PluginMarketplacePlugin["sourceHarness"];
    readonly category?: string;
    readonly installed?: boolean;
    readonly featured?: boolean;
    readonly artwork?: boolean;
  } = {},
): PluginMarketplacePlugin {
  const harness = input.harness ?? "codex";
  return {
    ...plugin,
    id: `${harness}:${id}`,
    sourceHarness: harness,
    packageName: id,
    name: id,
    category: input.category ?? "Productivity",
    installed: input.installed ?? false,
    enabled: input.installed ?? false,
    hasLocalLogo: input.artwork ?? false,
    logoDataUrl: null,
    logoUrl: null,
    ...(input.featured ? { featured: true } : {}),
    support: [{ harness, mcp: true, skills: false, apps: false }],
  };
}

describe("plugin marketplace browse grouping", () => {
  it("spreads featured picks across harnesses and never features installed plugins", () => {
    const picks = pickDiscoverPlugins([
      listing("zeta-installed", { installed: true, featured: true }),
      listing("plain-codex"),
      listing("art-codex", { artwork: true }),
      listing("featured-codex", { featured: true }),
      listing("art-claude", { harness: "claude", artwork: true }),
      listing("plain-cursor", { harness: "cursor", category: "Other" }),
    ]);

    expect(picks.map((entry) => entry.packageName)).toEqual([
      "featured-codex",
      "art-claude",
      "plain-cursor",
      "art-codex",
    ]);
  });

  it("lists installed plugins first, then sized categories with Other last", () => {
    const sections = groupMarketplaceSections(
      [
        listing("one", { installed: true, category: "Other" }),
        listing("two", { category: "Other" }),
        listing("three", { category: "Other" }),
        listing("four", { category: "Design" }),
        listing("five", { category: "Design", artwork: true }),
        listing("six", { category: "Finance" }),
      ],
      1,
    );

    expect(sections.installed.map((entry) => entry.packageName)).toEqual(["one"]);
    expect(sections.discover.map((entry) => entry.packageName)).toEqual(["five"]);
    expect(sections.categories.map((section) => section.category)).toEqual([
      "Design",
      "Finance",
      "Other",
    ]);
    expect(sections.categories[2]?.plugins.map((entry) => entry.packageName)).toEqual([
      "three",
      "two",
    ]);
  });
});
