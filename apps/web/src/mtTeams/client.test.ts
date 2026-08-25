import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildMtTeamsUrl,
  clearStoredSession,
  extractSessionToken,
  loadStoredSession,
  MT_TEAMS_STORAGE_KEY,
  mtTeamsAuthHeaders,
  saveStoredSession,
} from "./client";

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildMtTeamsUrl", () => {
  it("joins the service origin and path without doubling slashes", () => {
    expect(buildMtTeamsUrl("https://acme.convex.site", "/api/teams/me")).toBe(
      "https://acme.convex.site/api/teams/me",
    );
    expect(buildMtTeamsUrl("https://acme.convex.site/", "/api/teams/me")).toBe(
      "https://acme.convex.site/api/teams/me",
    );
    expect(buildMtTeamsUrl("  https://acme.convex.site//  ".trim(), "api/teams/me")).toBe(
      "https://acme.convex.site/api/teams/me",
    );
  });

  it("URL-encodes query values the callers pass through", () => {
    expect(
      buildMtTeamsUrl(
        "https://acme.convex.site",
        `/api/threads/shared?teamId=${encodeURIComponent("team/1 2")}`,
      ),
    ).toBe("https://acme.convex.site/api/threads/shared?teamId=team%2F1%202");
  });
});

describe("mtTeamsAuthHeaders", () => {
  it("builds a bearer Authorization header with JSON content type", () => {
    expect(mtTeamsAuthHeaders("session-token-1")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer session-token-1",
    });
  });
});

describe("extractSessionToken", () => {
  it("prefers the set-auth-token response header", () => {
    const response = new Response("{}", { headers: { "set-auth-token": "header-token" } });
    expect(extractSessionToken(response, { token: "body-token" })).toBe("header-token");
  });

  it("falls back to the body token, and to null when absent", () => {
    const response = new Response("{}");
    expect(extractSessionToken(response, { token: "body-token" })).toBe("body-token");
    expect(extractSessionToken(response, {})).toBeNull();
    expect(extractSessionToken(response, null)).toBeNull();
  });
});

describe("stored session", () => {
  it("round-trips through localStorage under the mtcode.mt-teams key", () => {
    const store = stubLocalStorage();
    saveStoredSession({
      serviceUrl: "https://acme.convex.site",
      sessionToken: "tok",
      userName: "Sheehan",
    });
    expect(store.has(MT_TEAMS_STORAGE_KEY)).toBe(true);
    expect(loadStoredSession()).toEqual({
      serviceUrl: "https://acme.convex.site",
      sessionToken: "tok",
      userName: "Sheehan",
    });
    clearStoredSession();
    expect(loadStoredSession()).toBeNull();
  });

  it("returns null for malformed or missing records instead of throwing", () => {
    const store = stubLocalStorage();
    store.set(MT_TEAMS_STORAGE_KEY, "not json");
    expect(loadStoredSession()).toBeNull();
    store.set(MT_TEAMS_STORAGE_KEY, JSON.stringify({ serviceUrl: 5 }));
    expect(loadStoredSession()).toBeNull();
  });
});
