import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  MtTeamsInvitationsRow,
  MtTeamsSettings,
  MtTeamsTeamsRow,
  mtTeamsInitials,
} from "./MtTeamsSettings";
import { useMtTeamsStore } from "./state";

const initialState = useMtTeamsStore.getState();

afterEach(() => {
  useMtTeamsStore.setState(initialState, true);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Static renders must never reach the network. */
function forbidFetch(): void {
  vi.stubGlobal("fetch", () => {
    throw new Error("unexpected fetch");
  });
}

describe("mtTeamsInitials", () => {
  it("takes the first and last name initials, falling back to the email", () => {
    expect(mtTeamsInitials("Ada Lovelace", "ada@example.com")).toBe("AL");
    expect(mtTeamsInitials("Priya", "priya@example.com")).toBe("P");
    expect(mtTeamsInitials("", "sheehan@example.com")).toBe("S");
    expect(mtTeamsInitials("", "")).toBe("?");
  });
});

describe("MtTeamsSettings", () => {
  it("shows a single quiet line when the build carries no service URL", () => {
    // The dev env may carry a real VITE_MT_TEAMS_URL; simulate a bare build.
    vi.stubEnv("VITE_MT_TEAMS_URL", "");
    forbidFetch();
    const markup = renderToStaticMarkup(<MtTeamsSettings />);
    expect(markup).toContain("Team service not configured in this build.");
    expect(markup).not.toContain("Sign in");
    expect(markup).not.toContain("Service URL");
    expect(markup).not.toContain("https://");
  });

  it("shows the email+password form when configured and signed out, with no URL field", () => {
    vi.stubEnv("VITE_MT_TEAMS_URL", "https://acme.convex.site");
    forbidFetch();
    useMtTeamsStore.setState({ sessionToken: "" });
    const markup = renderToStaticMarkup(<MtTeamsSettings />);
    expect(markup).toContain("Sign in");
    expect(markup).toContain("Email");
    expect(markup).toContain("Password");
    // The baked service origin must never surface in the UI.
    expect(markup).not.toContain("Service URL");
    expect(markup).not.toContain("convex.site");
    expect(markup).not.toContain("Invite code");
  });
});

describe("MtTeamsInvitationsRow", () => {
  it("renders nothing without pending invites", () => {
    forbidFetch();
    useMtTeamsStore.setState({ sessionToken: "tok", myInvites: [] });
    expect(renderToStaticMarkup(<MtTeamsInvitationsRow />)).toBe("");
  });

  it("tolerates a partial invite response without an invites array", () => {
    forbidFetch();
    useMtTeamsStore.setState({
      sessionToken: "tok",
      myInvites: undefined as unknown as ReturnType<typeof useMtTeamsStore.getState>["myInvites"],
    });

    expect(renderToStaticMarkup(<MtTeamsInvitationsRow />)).toBe("");
  });

  it("lists invites to my email with who invited, Accept, and Decline", () => {
    forbidFetch();
    useMtTeamsStore.setState({
      sessionToken: "tok",
      myInvites: [
        {
          inviteId: "inv-1",
          teamId: "team-1",
          teamName: "Relay Crew",
          invitedByName: "Priya",
          createdAt: Date.now() - 60_000,
        },
      ],
    });
    const markup = renderToStaticMarkup(<MtTeamsInvitationsRow />);
    expect(markup).toContain("Invitations");
    expect(markup).toContain("Relay Crew");
    expect(markup).toContain("Invited by Priya");
    expect(markup).toContain("Accept");
    expect(markup).toContain("Decline");
    expect(markup).not.toContain("animate-");
  });
});

describe("MtTeamsTeamsRow", () => {
  it("lists members with initials avatars and Remove, pending invites with Revoke, and an email invite form", () => {
    forbidFetch();
    useMtTeamsStore.setState({
      sessionToken: "tok",
      me: {
        user: { id: "user-1", name: "Sheehan Munim", email: "sheehan@example.com" },
        teams: [
          {
            id: "team-1",
            name: "Relay Crew",
            members: [
              { userId: "user-1", name: "Sheehan Munim", email: "sheehan@example.com" },
              { userId: "user-2", name: "Priya Patel", email: "priya@example.com" },
            ],
          },
        ],
      },
      teamInvites: {
        "team-1": [
          {
            inviteId: "inv-1",
            email: "ada@example.com",
            invitedByName: "Sheehan Munim",
            createdAt: Date.now() - 5 * 60_000,
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(<MtTeamsTeamsRow />);
    // Members: name, email, initials avatar; Remove only for teammates.
    expect(markup).toContain("Priya Patel");
    expect(markup).toContain("priya@example.com");
    expect(markup).toContain("SM");
    expect(markup).toContain("PP");
    expect(markup.match(/Remove/g)).toHaveLength(1);
    expect(markup).toContain("Leave team");
    // Pending invite with who invited and Revoke.
    expect(markup).toContain("ada@example.com");
    expect(markup).toContain("invited by Sheehan Munim");
    expect(markup).toContain("Revoke");
    // Email invite form; invite codes are gone.
    expect(markup).toContain("Invite");
    expect(markup).toContain("teammate@example.com");
    expect(markup).not.toContain("Invite code");
    expect(markup).not.toContain("Join");
  });

  it("offers create-team by name only when there are no teams", () => {
    forbidFetch();
    useMtTeamsStore.setState({
      sessionToken: "tok",
      me: { user: { id: "user-1", name: "Sheehan", email: "s@example.com" }, teams: [] },
    });
    const markup = renderToStaticMarkup(<MtTeamsTeamsRow />);
    expect(markup).toContain("New team name");
    expect(markup).toContain("Create");
    expect(markup).not.toContain("Invite code");
  });
});
