import { EnvironmentId, ProjectId, type OrchestrationProjectShell } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { PrimaryConnectionTarget, SshConnectionTarget } from "../connection/model.ts";
import { SshConnectionProfile } from "../connection/catalog.ts";
import { computerPeerFromPresentation } from "./catalog.ts";
import { matchProject, requireMatchedProject, ComputerTaskDispatchError } from "./matchProject.ts";

const now = "2026-01-01T00:00:00.000Z";

describe("matchProject", () => {
  const projects: ReadonlyArray<OrchestrationProjectShell> = [
    {
      id: ProjectId.make("project-mac"),
      title: "t3code",
      workspaceRoot: "/Users/me/dev/t3code",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ProjectId.make("project-other"),
      title: "notes",
      workspaceRoot: "C:/Users/me/notes",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  ];

  it("matches the source project title", () => {
    const matched = matchProject({
      projects,
      hint: null,
      sourceTitle: "t3code",
      sourceWorkspaceRoot: "/elsewhere/t3code",
    });
    expect("id" in matched && matched.id).toBe("project-mac");
  });

  it("matches a hint to a workspace basename", () => {
    const matched = matchProject({
      projects,
      hint: "notes",
      sourceTitle: "t3code",
      sourceWorkspaceRoot: "/Users/me/dev/t3code",
    });
    expect("id" in matched && matched.id).toBe("project-other");
  });

  it("reports ambiguity when nothing unique matches", () => {
    const matched = matchProject({
      projects,
      hint: null,
      sourceTitle: "unrelated",
      sourceWorkspaceRoot: "/tmp/unrelated",
    });
    expect("error" in matched && matched.error).toBe("ambiguous");
    expect(() => requireMatchedProject(matched)).toThrow(ComputerTaskDispatchError);
  });
});

describe("computerPeerFromPresentation", () => {
  it("maps an SSH environment including user@host", () => {
    const environmentId = EnvironmentId.make("env-blade");
    const peer = computerPeerFromPresentation({
      entry: {
        target: new SshConnectionTarget({
          environmentId,
          label: "Blade",
          connectionId: "ssh-1",
        }),
        profile: Option.some(
          new SshConnectionProfile({
            connectionId: "ssh-1",
            environmentId,
            label: "Blade",
            target: {
              alias: "blade",
              hostname: "192.168.50.64",
              username: "muhha",
              port: 22,
            },
          }),
        ),
      },
      connection: { phase: "connected", error: null, traceId: null },
      serverConfig: {
        environment: {
          environmentId,
          label: "Blade",
          platform: { os: "windows", arch: "x64" },
          serverVersion: "0.0.1",
          capabilities: {},
        },
      } as never,
    });
    expect(peer).toMatchObject({
      environmentId,
      label: "Blade",
      kind: "ssh",
      os: "windows",
      connected: true,
      sshTarget: "muhha@blade",
    });
  });

  it("maps the primary local environment", () => {
    const environmentId = EnvironmentId.make("env-mac");
    const peer = computerPeerFromPresentation({
      entry: {
        target: new PrimaryConnectionTarget({
          environmentId,
          label: "This device",
          httpBaseUrl: "http://127.0.0.1:3773",
          wsBaseUrl: "ws://127.0.0.1:3773",
        }),
        profile: Option.none(),
      },
      connection: { phase: "connecting", error: null, traceId: null },
      serverConfig: null,
    });
    expect(peer).toMatchObject({
      kind: "local",
      os: "unknown",
      connected: false,
      label: "This device",
    });
  });
});
