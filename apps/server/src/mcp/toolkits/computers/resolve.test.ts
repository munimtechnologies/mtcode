import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { mergeComputerCatalog } from "../../ComputerTaskBroker.ts";
import { resolveComputer } from "./resolve.ts";

const mac = EnvironmentId.make("env-mac");
const blade = EnvironmentId.make("env-blade");

const computers = [
  {
    environmentId: mac,
    label: "Sheehan's Mac",
    kind: "local" as const,
    os: "darwin" as const,
    connected: true,
    thisMachine: true,
  },
  {
    environmentId: blade,
    label: "Blade",
    kind: "ssh" as const,
    os: "windows" as const,
    connected: true,
    thisMachine: false,
    sshTarget: "muhha@192.168.50.64",
  },
];

describe("resolveComputer", () => {
  it("resolves this/here to the local machine", () => {
    const resolved = resolveComputer("this", computers);
    expect("thisMachine" in resolved && resolved.thisMachine).toBe(true);
  });

  it("resolves a label or SSH host", () => {
    expect(resolveComputer("Blade", computers)).toMatchObject({ environmentId: blade });
    expect(resolveComputer("muhha@192.168.50.64", computers)).toMatchObject({
      environmentId: blade,
    });
  });

  it("rejects unknown names", () => {
    const resolved = resolveComputer("toaster", computers);
    expect(resolved).toMatchObject({ _tag: "ComputerTaskError", code: "computer_not_found" });
  });
});

describe("mergeComputerCatalog", () => {
  it("always includes this machine and prefers connected peer rows", () => {
    const merged = mergeComputerCatalog(
      {
        environmentId: mac,
        label: "Mac",
        platform: { os: "darwin", arch: "arm64" },
        serverVersion: "0.0.1",
        capabilities: { repositoryIdentity: false },
      },
      [
        [
          {
            environmentId: blade,
            label: "Blade",
            kind: "ssh",
            os: "windows",
            connected: false,
          },
        ],
        [
          {
            environmentId: blade,
            label: "Blade",
            kind: "ssh",
            os: "windows",
            connected: true,
            sshTarget: "muhha@blade",
          },
        ],
      ],
    );
    expect(merged[0]).toMatchObject({ environmentId: mac, thisMachine: true, connected: true });
    expect(merged[1]).toMatchObject({
      environmentId: blade,
      connected: true,
      sshTarget: "muhha@blade",
      thisMachine: false,
    });
  });
});
