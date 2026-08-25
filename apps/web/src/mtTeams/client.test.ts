import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  acceptInvite,
  buildMtTeamsUrl,
  clearStoredSession,
  createTeam,
  declineInvite,
  extractSessionToken,
  fetchMyInvites,
  fetchTeamInvites,
  inviteToTeam,
  leaveTeam,
  loadStoredSession,
  MT_TEAMS_STORAGE_KEY,
  mtTeamsAuthHeaders,
  type MtTeamsStoredSession,
  removeTeamMember,
  revokeInvite,
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
  vi.unstubAllEnvs();
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
  it("persists only the session (never a URL) and rehydrates the baked service URL", () => {
    vi.stubEnv("VITE_MT_TEAMS_URL", "https://acme.convex.site");
    const store = stubLocalStorage();
    saveStoredSession({
      serviceUrl: "https://elsewhere.convex.site",
      sessionToken: "tok",
      userName: "Sheehan",
    });
    // The service URL comes from the build, not storage.
    expect(store.get(MT_TEAMS_STORAGE_KEY)).not.toContain("convex.site");
    expect(loadStoredSession()).toEqual({
      serviceUrl: "https://acme.convex.site",
      sessionToken: "tok",
      userName: "Sheehan",
    });
    clearStoredSession();
    expect(loadStoredSession()).toBeNull();
  });

  it("ignores a legacy stored serviceUrl so it can never shadow the baked one", () => {
    vi.stubEnv("VITE_MT_TEAMS_URL", "https://acme.convex.site");
    const store = stubLocalStorage();
    store.set(
      MT_TEAMS_STORAGE_KEY,
      JSON.stringify({ serviceUrl: "https://stale.convex.site", sessionToken: "tok" }),
    );
    expect(loadStoredSession()).toEqual({
      serviceUrl: "https://acme.convex.site",
      sessionToken: "tok",
      userName: "",
    });
  });

  it("returns null for malformed or missing records instead of throwing", () => {
    const store = stubLocalStorage();
    store.set(MT_TEAMS_STORAGE_KEY, "not json");
    expect(loadStoredSession()).toBeNull();
    store.set(MT_TEAMS_STORAGE_KEY, JSON.stringify({ sessionToken: 5 }));
    expect(loadStoredSession()).toBeNull();
  });
});

describe("invite endpoints", () => {
  const session: MtTeamsStoredSession = {
    serviceUrl: "https://acme.convex.site",
    sessionToken: "tok",
    userName: "Sheehan",
  };

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): {
    url: string;
    method: string | undefined;
    auth: string | undefined;
    body: unknown;
  } {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
  }

  it("posts email invites to /api/teams/invite with the session token", async () => {
    const fetchMock = stubFetch({ inviteId: "inv-1" });
    await expect(
      inviteToTeam(session, { teamId: "team-1", email: "priya@example.com" }),
    ).resolves.toEqual({ inviteId: "inv-1" });
    expect(requestOf(fetchMock)).toEqual({
      url: "https://acme.convex.site/api/teams/invite",
      method: "POST",
      auth: "Bearer tok",
      body: { teamId: "team-1", email: "priya@example.com" },
    });
  });

  it("reads a team's pending invites from /api/teams/invites?teamId=", async () => {
    const invites = [
      { inviteId: "inv-1", email: "priya@example.com", invitedByName: "Sheehan", createdAt: 1 },
    ];
    const fetchMock = stubFetch({ invites });
    await expect(fetchTeamInvites(session, { teamId: "team/1" })).resolves.toEqual({ invites });
    expect(requestOf(fetchMock).url).toBe(
      "https://acme.convex.site/api/teams/invites?teamId=team%2F1",
    );
    expect(requestOf(fetchMock).method).toBe("GET");
  });

  it("revokes, accepts, declines, leaves, and removes through the documented paths", async () => {
    const cases: ReadonlyArray<{
      run: () => Promise<unknown>;
      path: string;
      body: unknown;
    }> = [
      {
        run: () => revokeInvite(session, { inviteId: "inv-1" }),
        path: "/api/teams/invites/revoke",
        body: { inviteId: "inv-1" },
      },
      {
        run: () => acceptInvite(session, { inviteId: "inv-1" }),
        path: "/api/invites/accept",
        body: { inviteId: "inv-1" },
      },
      {
        run: () => declineInvite(session, { inviteId: "inv-1" }),
        path: "/api/invites/decline",
        body: { inviteId: "inv-1" },
      },
      {
        run: () => leaveTeam(session, { teamId: "team-1" }),
        path: "/api/teams/leave",
        body: { teamId: "team-1" },
      },
      {
        run: () => removeTeamMember(session, { teamId: "team-1", userId: "user-2" }),
        path: "/api/teams/members/remove",
        body: { teamId: "team-1", userId: "user-2" },
      },
    ];
    for (const testCase of cases) {
      const fetchMock = stubFetch({ ok: true, teamId: "team-1", name: "Relay" });
      await testCase.run();
      const request = requestOf(fetchMock);
      expect(request.url).toBe(`https://acme.convex.site${testCase.path}`);
      expect(request.method).toBe("POST");
      expect(request.auth).toBe("Bearer tok");
      expect(request.body).toEqual(testCase.body);
      vi.unstubAllGlobals();
    }
  });

  it("reads my pending invites from /api/invites/mine", async () => {
    const invites = [
      {
        inviteId: "inv-2",
        teamId: "team-1",
        teamName: "Relay",
        invitedByName: "Priya",
        createdAt: 2,
      },
    ];
    const fetchMock = stubFetch({ invites });
    await expect(fetchMyInvites(session)).resolves.toEqual({ invites });
    expect(requestOf(fetchMock).url).toBe("https://acme.convex.site/api/invites/mine");
  });

  it("creates teams with a name only — no invite code in the response contract", async () => {
    const fetchMock = stubFetch({ teamId: "team-1", name: "Relay" });
    await expect(createTeam(session, { name: "Relay" })).resolves.toEqual({
      teamId: "team-1",
      name: "Relay",
    });
    expect(requestOf(fetchMock).body).toEqual({ name: "Relay" });
  });
});
