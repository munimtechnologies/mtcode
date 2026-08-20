import { describe, expect, it } from "vite-plus/test";

import {
  resolveMobileDistroId,
  resolveMobileDistroIdentity,
  resolveMobileDistroRaw,
  resolveMobileUpdatesUrl,
} from "./mobile-distro.ts";

describe("mobile-distro", () => {
  it("defaults to the official T3 Code identity", () => {
    expect(resolveMobileDistroId("")).toBe("default");
    expect(resolveMobileDistroIdentity("").productName).toBe("T3 Code");
    expect(resolveMobileDistroIdentity("").iosBundleIdentifier).toBe("com.t3tools.t3code");
  });

  it("prefers T3CODE_MOBILE_DISTRO over T3CODE_DESKTOP_DISTRO", () => {
    expect(
      resolveMobileDistroRaw({
        T3CODE_MOBILE_DISTRO: "munim",
        T3CODE_DESKTOP_DISTRO: "default",
      }),
    ).toBe("munim");
  });

  it("falls back to T3CODE_DESKTOP_DISTRO", () => {
    expect(resolveMobileDistroId("munim")).toBe("munim");
    expect(resolveMobileDistroIdentity("munim").productName).toBe("MT Code");
    expect(resolveMobileDistroIdentity("munim").scheme).toBe("mtcode");
    expect(resolveMobileDistroIdentity("munim").iosBundleIdentifier).toBe("com.munim.mtcode");
    expect(resolveMobileDistroIdentity("munim").appleTeamId).toBe("6T5J6U2UVT");
    expect(resolveMobileDistroIdentity("munim").clerkRelyingParty).toBe(
      "clerk.mtcode.munimtech.com",
    );
    expect(resolveMobileDistroIdentity("munim").hostedAppDomain).toBe("mtcode.munimtech.com");
  });

  it("omits Expo updates for Munim until a dedicated project exists", () => {
    const munim = resolveMobileDistroIdentity("munim");
    expect(munim.easProjectId).toBeUndefined();
    expect(resolveMobileUpdatesUrl(munim)).toBeUndefined();
    expect(resolveMobileUpdatesUrl(resolveMobileDistroIdentity(""))).toBe(
      "https://u.expo.dev/d763fcb8-d37c-41ea-a773-b54a0ab4a454",
    );
  });
});
