import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canEmbedClerkProvider,
  parseConnectProviders,
  providerHasRelay,
  resolveDefaultConnectProviderId,
  resolveEmbeddedClerkProvider,
  selectEmbeddableConnectProviderId,
} from "./connectProviders.ts";

const mt = {
  id: "mt" as const,
  label: "MT Connect",
  clerkPublishableKey: "pk_test_mt",
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: "",
  relayUrl: "",
  hostedAppUrl: "https://mtcode.munimtech.com",
};

const t3 = {
  id: "t3" as const,
  label: "T3 Connect",
  clerkPublishableKey: "pk_live_t3",
  clerkJwtTemplate: "t3-relay",
  clerkCliOAuthClientId: "oauth",
  relayUrl: "https://relay.t3.codes",
  hostedAppUrl: "https://app.t3.codes",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseConnectProviders", () => {
  it("returns an empty list for invalid JSON", () => {
    expect(parseConnectProviders("")).toEqual([]);
    expect(parseConnectProviders("{not json")).toEqual([]);
    expect(parseConnectProviders("{}")).toEqual([]);
  });

  it("keeps well-formed MT and T3 providers", () => {
    expect(parseConnectProviders(JSON.stringify([mt, t3]))).toEqual([mt, t3]);
  });
});

describe("canEmbedClerkProvider", () => {
  it("embeds T3 Connect only on Electron or app.t3.codes", () => {
    expect(
      canEmbedClerkProvider(t3, { origin: "https://mtcode.munimtech.com", isElectron: false }),
    ).toBe(false);
    expect(canEmbedClerkProvider(t3, { origin: "https://app.t3.codes", isElectron: false })).toBe(
      true,
    );
    expect(
      canEmbedClerkProvider(t3, { origin: "https://mtcode.munimtech.com", isElectron: true }),
    ).toBe(true);
  });

  it("embeds MT Connect on the hosted web origin", () => {
    expect(
      canEmbedClerkProvider(mt, { origin: "https://mtcode.munimtech.com", isElectron: false }),
    ).toBe(true);
  });
});

describe("resolveDefaultConnectProviderId", () => {
  it("defaults to MT Connect on the hosted web", () => {
    expect(
      resolveDefaultConnectProviderId([mt, t3], {
        origin: "https://mtcode.munimtech.com",
        isElectron: false,
      }),
    ).toBe("mt");
  });

  it("defaults to MT Connect on Electron when both exist", () => {
    expect(
      resolveDefaultConnectProviderId([mt, t3], {
        origin: "file://",
        isElectron: true,
      }),
    ).toBe("mt");
  });
});

describe("resolveEmbeddedClerkProvider", () => {
  it("falls back to MT Connect when T3 cannot embed on the hosted web", () => {
    expect(
      resolveEmbeddedClerkProvider([mt, t3], "t3", {
        origin: "https://mtcode.munimtech.com",
        isElectron: false,
      }),
    ).toEqual(mt);
  });
});

describe("selectEmbeddableConnectProviderId", () => {
  it("rejects T3 on hosted Munim web", () => {
    expect(
      selectEmbeddableConnectProviderId([mt, t3], "t3", {
        origin: "https://mtcode.munimtech.com",
        isElectron: false,
      }),
    ).toBeNull();
    expect(
      selectEmbeddableConnectProviderId([mt, t3], "t3", {
        origin: "file://",
        isElectron: true,
      }),
    ).toBe("t3");
  });
});

describe("providerHasRelay", () => {
  it("requires an https relay URL", () => {
    expect(providerHasRelay(mt)).toBe(false);
    expect(providerHasRelay(t3)).toBe(true);
    expect(providerHasRelay(null)).toBe(false);
  });
});
