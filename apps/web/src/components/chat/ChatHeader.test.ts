import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveRenameCommit, shouldShowComputerView, shouldShowOpenInPicker } from "./ChatHeader";

describe("shouldShowComputerView", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-primary");
  const remoteEnvironmentId = EnvironmentId.make("environment-remote");

  it("offers the view for a thread on another computer", () => {
    expect(
      shouldShowComputerView({
        capabilityAdvertised: true,
        activeThreadEnvironmentId: remoteEnvironmentId,
        primaryEnvironmentId,
      }),
    ).toBe(true);
  });

  it("hides the view for a thread on this computer", () => {
    expect(
      shouldShowComputerView({
        capabilityAdvertised: true,
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
      }),
    ).toBe(false);
  });

  it("hides the view when the environment does not advertise it", () => {
    expect(
      shouldShowComputerView({
        capabilityAdvertised: false,
        activeThreadEnvironmentId: remoteEnvironmentId,
        primaryEnvironmentId,
      }),
    ).toBe(false);
  });

  it("offers the view when no environment is primary yet", () => {
    expect(
      shouldShowComputerView({
        capabilityAdvertised: true,
        activeThreadEnvironmentId: remoteEnvironmentId,
        primaryEnvironmentId: null,
      }),
    ).toBe(true);
  });
});

describe("shouldShowOpenInPicker", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-primary");

  it("shows the picker for projects in the primary environment", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
  });

  it("shows the picker for remote environments in deep-link mode", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(true);
  });

  it("shows the picker's unavailable state for remote environments without an SSH route", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId: null,
        remoteOpenMode: "remote-unavailable",
      }),
    ).toBe(true);
  });

  it("hides the picker for non-primary local backends", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("shows the picker for a secondary local backend with desktop terminal support", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "repo",
        activeThreadEnvironmentId: EnvironmentId.make("wsl"),
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
        externalTerminalAvailable: true,
      }),
    ).toBe(true);
  });

  it("hides the picker when there is no active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
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
