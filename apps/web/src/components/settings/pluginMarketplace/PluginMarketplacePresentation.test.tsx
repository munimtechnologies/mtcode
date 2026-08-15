import type { PluginMarketplacePlugin } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { HarnessSupportBadges, PluginLogo } from "./PluginMarketplacePresentation";

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

  it("labels harness badges with each real bundle capability", () => {
    const markup = renderToStaticMarkup(<HarnessSupportBadges support={plugin.support} />);

    expect(markup).toContain('aria-label="Codex: MCP + skills + apps"');
    expect(markup).not.toContain('aria-label="Cursor:');
  });
});
