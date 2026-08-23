import { afterEach, describe, expect, it, vi } from "@effect/vitest";

describe("mobile branding helpers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("expo-constants");
  });

  it("defaults to T3 Code when branding extra is missing", async () => {
    vi.doMock("expo-constants", () => ({
      default: { expoConfig: { name: "T3 Code", extra: { appVariant: "production" } } },
    }));
    const branding = await import("./branding.ts");
    expect(branding.getProductName()).toBe("T3 Code");
    expect(branding.getConnectName()).toBe("T3 Connect");
    expect(branding.getAppScheme()).toBe("t3code");
    expect(branding.isMunimDistro()).toBe(false);
  });

  it("reads Munim branding from expo extra", async () => {
    vi.doMock("expo-constants", () => ({
      default: {
        expoConfig: {
          name: "MT Code",
          extra: {
            branding: {
              distroId: "munim",
              productName: "MT Code",
              connectProductName: "MT Connect",
              scheme: "mtcode",
              schemeDev: "mtcode-dev",
              schemePreview: "mtcode-preview",
            },
          },
        },
      },
    }));
    const branding = await import("./branding.ts");
    expect(branding.getProductName()).toBe("MT Code");
    expect(branding.getConnectName()).toBe("MT Connect");
    expect(branding.getMobileClientLabel()).toBe("MT Code Mobile");
    expect(branding.getAppScheme()).toBe("mtcode");
    expect(branding.getBrandMark()).toBe("MT");
    expect(branding.getBrandLabel()).toBe("Code");
    expect(branding.isMunimDistro()).toBe(true);
  });
});
