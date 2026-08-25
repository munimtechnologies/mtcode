import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { MtTeamsSharedThread } from "./client";
import { MtTeamsSidebarSection } from "./MtTeamsSidebarSection";
import { useMtTeamsStore } from "./state";

const sharedThread = (overrides: Partial<MtTeamsSharedThread>): MtTeamsSharedThread => ({
  sharedThreadId: "st-1",
  teamId: "team-1",
  ownerUserId: "user-2",
  ownerName: "Priya",
  environmentId: "env-1",
  environmentLabel: "priya-laptop",
  threadId: "thread-1",
  title: "Fix relay reconnect",
  status: "working",
  updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  ...overrides,
});

const initialState = useMtTeamsStore.getState();

afterEach(() => {
  useMtTeamsStore.setState(initialState, true);
  vi.unstubAllGlobals();
});

describe("MtTeamsSidebarSection", () => {
  it("renders nothing while signed out", () => {
    // Network must never be touched from a plain render.
    vi.stubGlobal("fetch", () => {
      throw new Error("unexpected fetch");
    });
    useMtTeamsStore.setState({ sessionToken: "" });
    expect(renderToStaticMarkup(<MtTeamsSidebarSection />)).toBe("");
  });

  it("lists teammates' shared threads with status dot, owner, and relative time", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("unexpected fetch");
    });
    useMtTeamsStore.setState({
      sessionToken: "tok",
      me: {
        user: { id: "user-1", name: "Sheehan", email: "s@example.com" },
        teams: [],
      },
      sharedThreads: [
        sharedThread({}),
        sharedThread({
          sharedThreadId: "st-2",
          status: "input-needed",
          title: "Review PR 42",
        }),
        // Own thread: must not appear in the teammate list.
        sharedThread({ sharedThreadId: "st-3", ownerUserId: "user-1", title: "My own thread" }),
      ],
    });

    const markup = renderToStaticMarkup(<MtTeamsSidebarSection />);
    expect(markup).toContain("Team");
    expect(markup).toContain("Fix relay reconnect");
    expect(markup).toContain("Review PR 42");
    expect(markup).toContain("Priya");
    expect(markup).toContain("bg-blue-500");
    expect(markup).toContain("bg-warning");
    expect(markup).toContain("5m");
    expect(markup).not.toContain("My own thread");
    expect(markup).not.toContain("animate-");
  });
});
