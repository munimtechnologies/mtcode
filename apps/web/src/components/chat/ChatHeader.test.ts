import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { desktopLocalConnectionId } from "../../connection/desktopLocal";
import { resolveRemoteOpenState } from "../../remoteOpen";

import { resolveRenameCommit, shouldShowComputerView } from "./ChatHeader";

describe("shouldShowComputerView", () => {
  it("offers the view for a thread on another computer", () => {
    // Paired backends and T3 Connect environments resolve to remote links or,
    // without an advertised host, to remote-unavailable. Both are elsewhere.
    for (const threadMachine of ["remote-links", "remote-unavailable"] as const) {
      expect(shouldShowComputerView({ capabilityAdvertised: true, threadMachine })).toBe(true);
    }
  });

  it("hides the view for a thread on this computer", () => {
    expect(
      shouldShowComputerView({ capabilityAdvertised: true, threadMachine: "local-exec" }),
    ).toBe(false);
  });

  it("hides the view when the environment does not advertise it", () => {
    expect(
      shouldShowComputerView({ capabilityAdvertised: false, threadMachine: "remote-links" }),
    ).toBe(false);
  });
});

describe("Computer View machine resolution", () => {
  const environmentId = EnvironmentId.make("environment-thread");
  const gate = (
    target: Parameters<typeof resolveRemoteOpenState>[0]["target"],
    options: { sshAlias?: string; isDesktopRenderer?: boolean } = {},
  ) =>
    shouldShowComputerView({
      capabilityAdvertised: true,
      threadMachine: resolveRemoteOpenState({
        target,
        sshAlias: options.sshAlias ?? null,
        remoteOpenTargets: undefined,
        isDesktopRenderer: options.isDesktopRenderer ?? true,
      }).mode,
    });

  it("hides it for the desktop app's own backend", () => {
    expect(
      gate(
        new PrimaryConnectionTarget({
          environmentId,
          label: "Sheehan's MacBook Air",
          httpBaseUrl: "http://127.0.0.1:3773",
          wsBaseUrl: "ws://127.0.0.1:3773",
        }),
      ),
    ).toBe(false);
  });

  it("hides it for a desktop-local sibling backend such as WSL", () => {
    expect(
      gate(
        new BearerConnectionTarget({
          environmentId,
          label: "WSL (Ubuntu)",
          connectionId: desktopLocalConnectionId("wsl:Ubuntu"),
        }),
      ),
    ).toBe(false);
  });

  it("offers it for an SSH host picked in Run on", () => {
    expect(
      gate(new SshConnectionTarget({ environmentId, label: "devbox", connectionId: "ssh-1" }), {
        sshAlias: "devbox",
      }),
    ).toBe(true);
  });

  it("offers it for a paired backend on another computer", () => {
    expect(
      gate(
        new BearerConnectionTarget({
          environmentId,
          label: "DESKTOP-6ILJVR4",
          connectionId: "paired-1",
        }),
      ),
    ).toBe(true);
  });

  it("offers it for the primary server when the browser is on another computer", () => {
    expect(
      gate(
        new PrimaryConnectionTarget({
          environmentId,
          label: "DESKTOP-6ILJVR4",
          httpBaseUrl: "http://100.96.214.85:3773",
          wsBaseUrl: "ws://100.96.214.85:3773",
        }),
        { isDesktopRenderer: false },
      ),
    ).toBe(true);
  });

  it("hides it for a browser served from this computer", () => {
    expect(
      gate(
        new PrimaryConnectionTarget({
          environmentId,
          label: "Sheehan's MacBook Air",
          httpBaseUrl: "http://localhost:3773",
          wsBaseUrl: "ws://localhost:3773",
        }),
        { isDesktopRenderer: false },
      ),
    ).toBe(false);
  });
});

describe("resolveRenameCommit", () => {
  it("commits a trimmed changed title", () => {
    expect(resolveRenameCommit({ title: "  New title ", originalTitle: "Old" })).toEqual({
      action: "commit",
      title: "New title",
    });
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(resolveRenameCommit({ title: "   ", originalTitle: "Old" })).toEqual({
      action: "reject-empty",
    });
  });

  it("no-ops when the trimmed title is unchanged", () => {
    expect(resolveRenameCommit({ title: " Old ", originalTitle: "Old" })).toEqual({
      action: "noop",
    });
  });
});
