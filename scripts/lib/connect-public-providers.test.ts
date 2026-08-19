import { describe, expect, it } from "vite-plus/test";

import { T3_CONNECT_PUBLISHABLE_KEY, buildConnectProviders } from "./connect-public-providers.ts";

describe("buildConnectProviders", () => {
  it("always includes T3 Connect public identifiers", () => {
    const providers = buildConnectProviders({});
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("t3");
    expect(providers[0]?.clerkPublishableKey).toBe(T3_CONNECT_PUBLISHABLE_KEY);
  });

  it("puts MT Connect first when Munim Clerk keys are present", () => {
    const providers = buildConnectProviders({
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_munim",
      T3CODE_CLERK_JWT_TEMPLATE: "t3-relay",
      T3CODE_HOSTED_APP_URL: "https://mtcode.munimtech.com",
    });
    expect(providers.map((provider) => provider.id)).toEqual(["mt", "t3"]);
    expect(providers[0]?.relayUrl).toBe("");
  });

  it("does not treat T3's publishable key as MT Connect", () => {
    const providers = buildConnectProviders({
      T3CODE_CLERK_PUBLISHABLE_KEY: T3_CONNECT_PUBLISHABLE_KEY,
      T3CODE_CLERK_JWT_TEMPLATE: "t3-relay",
      T3CODE_RELAY_URL: "https://relay.t3.codes",
    });
    expect(providers.map((provider) => provider.id)).toEqual(["t3"]);
  });
});
