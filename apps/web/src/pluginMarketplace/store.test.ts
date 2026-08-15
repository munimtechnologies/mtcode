import type { PluginMarketplaceDetail, PluginMarketplacePlugin } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./api", () => ({
  fetchPluginMarketplaceCatalog: vi.fn(),
  fetchPluginMarketplaceDetail: vi.fn(),
  installPlugin: vi.fn(),
  removePlugin: vi.fn(),
}));

import {
  fetchPluginMarketplaceCatalog,
  fetchPluginMarketplaceDetail,
  installPlugin,
  removePlugin,
} from "./api";
import { usePluginMarketplaceStore } from "./store";

const summary: PluginMarketplacePlugin = {
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
  installed: false,
  enabled: false,
  brandColor: null,
  hasLocalLogo: false,
  logoDataUrl: null,
  logoUrl: null,
  contents: {
    skillCount: 1,
    mcpServerCount: 1,
    appCount: 0,
    commandCount: 0,
    agentCount: 0,
    ruleCount: 0,
    hookCount: 0,
    hasHooks: false,
  },
  support: [{ harness: "codex", mcp: true, skills: true, apps: false }],
};

const detail: PluginMarketplaceDetail = {
  ...summary,
  installed: true,
  enabled: true,
  description: "Controls local apps through the real Codex plugin.",
  marketplaceUrl: null,
  homepage: null,
  repository: null,
  capabilities: [],
  defaultPrompts: [],
  skills: [
    {
      id: "computer-use",
      name: "Computer Use",
      description: "Operate local app UI.",
      invocation: "$computer-use:computer-use",
    },
  ],
  mcpServers: [
    {
      id: "computer-use",
      name: "Computer Use",
      transport: "stdio",
      url: null,
      command: "computer-use",
      arguments: [],
      workingDirectory: null,
      oauthResource: null,
      note: null,
      toolTimeoutSeconds: null,
      environmentVariables: [],
    },
  ],
  apps: [],
  extensions: [],
  installTargets: [
    {
      pluginId: summary.id,
      harness: "codex",
      marketplaceName: "openai-bundled",
      version: "1.0.0",
      installed: true,
      enabled: true,
      installPolicy: "AVAILABLE",
      marketplaceUrl: null,
      contents: summary.contents,
    },
  ],
};

describe("plugin marketplace store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    usePluginMarketplaceStore.setState({
      catalogStatus: "idle",
      plugins: [],
      catalogError: null,
      details: {},
      pending: {},
    });
  });

  it("loads the Codex catalog from the environment API", async () => {
    vi.mocked(fetchPluginMarketplaceCatalog).mockResolvedValue({ plugins: [summary] });

    await usePluginMarketplaceStore.getState().loadCatalog();

    expect(fetchPluginMarketplaceCatalog).toHaveBeenCalledOnce();
    expect(usePluginMarketplaceStore.getState().plugins).toEqual([summary]);
    expect(usePluginMarketplaceStore.getState().catalogStatus).toBe("ready");
  });

  it("runs a real install mutation and refreshes catalog and details", async () => {
    vi.mocked(installPlugin).mockResolvedValue({ pluginId: summary.id, installed: true });
    vi.mocked(fetchPluginMarketplaceCatalog).mockResolvedValue({
      plugins: [{ ...summary, installed: true, enabled: true }],
    });
    vi.mocked(fetchPluginMarketplaceDetail).mockResolvedValue(detail);

    await usePluginMarketplaceStore.getState().install(summary.id);

    expect(installPlugin).toHaveBeenCalledWith(summary.id);
    expect(usePluginMarketplaceStore.getState().plugins[0]?.installed).toBe(true);
    expect(usePluginMarketplaceStore.getState().details[summary.id]?.plugin).toEqual(detail);
    expect(usePluginMarketplaceStore.getState().pending[summary.id]).toBe(false);
  });

  it("runs remove through Codex", async () => {
    vi.mocked(removePlugin).mockResolvedValue({ pluginId: summary.id, installed: false });
    vi.mocked(fetchPluginMarketplaceCatalog).mockResolvedValue({ plugins: [summary] });
    vi.mocked(fetchPluginMarketplaceDetail).mockResolvedValue({
      ...detail,
      installed: false,
      enabled: false,
    });

    await usePluginMarketplaceStore.getState().remove(summary.id);

    expect(removePlugin).toHaveBeenCalledWith(summary.id);
    expect(usePluginMarketplaceStore.getState().details[summary.id]?.plugin?.installed).toBe(false);
  });

  it("installs one package on multiple harnesses and refreshes their shared detail", async () => {
    const claudeId = "claude:computer-use@claude-plugins-official";
    const sharedDetail = {
      ...detail,
      installed: false,
      enabled: false,
      installTargets: [
        { ...detail.installTargets[0]!, installed: false, enabled: false },
        {
          ...detail.installTargets[0]!,
          pluginId: claudeId,
          harness: "claude" as const,
          marketplaceName: "claude-plugins-official",
          installed: false,
          enabled: false,
        },
      ],
    };
    usePluginMarketplaceStore.setState({
      catalogStatus: "ready",
      plugins: [summary],
      details: {
        [summary.id]: { status: "ready", plugin: sharedDetail, error: null },
      },
    });
    vi.mocked(installPlugin).mockImplementation(async (pluginId) => ({
      pluginId,
      installed: true,
    }));
    vi.mocked(fetchPluginMarketplaceCatalog).mockResolvedValue({
      plugins: [{ ...summary, installed: true, enabled: true }],
    });
    vi.mocked(fetchPluginMarketplaceDetail).mockImplementation(async (pluginId) => ({
      ...sharedDetail,
      id: pluginId,
      installed: true,
      enabled: true,
      installTargets: sharedDetail.installTargets.map((target) => ({
        ...target,
        installed: true,
        enabled: true,
      })),
    }));

    await usePluginMarketplaceStore.getState().setInstalled([summary.id, claudeId], true);

    expect(installPlugin).toHaveBeenCalledTimes(2);
    expect(installPlugin).toHaveBeenCalledWith(summary.id);
    expect(installPlugin).toHaveBeenCalledWith(claudeId);
    expect(fetchPluginMarketplaceCatalog).toHaveBeenCalledOnce();
    expect(
      usePluginMarketplaceStore.getState().details[summary.id]?.plugin?.installTargets,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ harness: "claude", installed: true })]),
    );
  });
});
