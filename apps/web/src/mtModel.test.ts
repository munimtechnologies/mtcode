import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { prependMtModelPickerEntry, withMtModelProvider } from "./mtModel.ts";

describe("withMtModelProvider", () => {
  it("prepends MT Model when another provider is ready", () => {
    const providers = withMtModelProvider([
      {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        driver: ProviderDriverKind.make("claudeAgent"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "unknown" },
        checkedAt: "2026-08-18T00:00:00.000Z",
        models: [
          {
            slug: "claude-sonnet-5",
            name: "Sonnet 5",
            isCustom: false,
            isDefault: true,
            capabilities: null,
          },
        ],
        slashCommands: [],
        skills: [],
      },
    ]);
    expect(providers[0]?.instanceId).toBe("mt");
    expect(providers[0]?.models[0]?.slug).toBe("mt-auto");
  });

  it("hides MT Model when no backend is ready", () => {
    expect(
      withMtModelProvider([
        {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          installed: false,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          checkedAt: "2026-08-18T00:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
        },
      ]).some((provider) => provider.instanceId === "mt"),
    ).toBe(false);
  });

  it("still offers MT Model when the only backend is in warning", () => {
    expect(
      withMtModelProvider([
        {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          checkedAt: "2026-08-18T00:00:00.000Z",
          models: [
            {
              slug: "claude-sonnet-5",
              name: "Sonnet 5",
              isCustom: false,
              isDefault: true,
              capabilities: null,
            },
          ],
          slashCommands: [],
          skills: [],
        },
      ])[0]?.instanceId,
    ).toBe("mt");
  });
});
