import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveAvailableNewThreadProjectRef,
  resolveNewThreadModelSelectionOverride,
  resolveWorkspaceOptionsAfterEnvironmentRetarget,
  resolveNewThreadEnvironmentId,
  isComputerHomeWorkspace,
  findComputerHomeProjectRef,
} from "./chatThreadActions";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");
const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
};

describe("chatThreadActions", () => {
  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
      }),
    ).toBeNull();
  });

  it("keeps the project default above any carried selection", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });

  it("keeps the requested project when its environment is reachable", () => {
    const otherEnvironmentId = EnvironmentId.make("environment-2");
    const requested = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);

    expect(
      resolveAvailableNewThreadProjectRef({
        requested,
        members: [
          { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID, isPrimary: false },
          { environmentId: otherEnvironmentId, projectId: FALLBACK_PROJECT_ID, isPrimary: true },
        ],
        isEnvironmentReachable: () => true,
      }),
    ).toEqual(requested);
  });

  it("retargets an unreachable requested environment to a reachable sibling, preferring primary", () => {
    const reachableEnvironmentId = EnvironmentId.make("environment-2");
    const otherEnvironmentId = EnvironmentId.make("environment-3");

    expect(
      resolveAvailableNewThreadProjectRef({
        requested: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
        members: [
          { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID, isPrimary: false },
          {
            environmentId: otherEnvironmentId,
            projectId: ProjectId.make("project-3"),
            isPrimary: false,
          },
          {
            environmentId: reachableEnvironmentId,
            projectId: FALLBACK_PROJECT_ID,
            isPrimary: true,
          },
        ],
        isEnvironmentReachable: (environmentId) => environmentId !== ENVIRONMENT_ID,
      }),
    ).toEqual(scopeProjectRef(reachableEnvironmentId, FALLBACK_PROJECT_ID));
  });

  it("keeps the requested project when no sibling environment is reachable", () => {
    const requested = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);

    expect(
      resolveAvailableNewThreadProjectRef({
        requested,
        members: [
          { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID },
          { environmentId: EnvironmentId.make("environment-2"), projectId: FALLBACK_PROJECT_ID },
        ],
        isEnvironmentReachable: () => false,
      }),
    ).toEqual(requested);
  });

  it("keeps explicit workspace options when the draft stays on the requested environment", () => {
    expect(
      resolveWorkspaceOptionsAfterEnvironmentRetarget({
        requestedEnvironmentId: ENVIRONMENT_ID,
        targetEnvironmentId: ENVIRONMENT_ID,
        options: {
          branch: "feat/checkout",
          worktreePath: "/dead/machine/worktree",
          envMode: "worktree",
          startFromOrigin: false,
        },
      }),
    ).toEqual({
      branch: "feat/checkout",
      worktreePath: "/dead/machine/worktree",
      envMode: "worktree",
      startFromOrigin: false,
    });
  });

  it("clears machine-specific workspace options when retargeting to another environment", () => {
    const targetEnvironmentId = EnvironmentId.make("environment-2");

    expect(
      resolveWorkspaceOptionsAfterEnvironmentRetarget({
        requestedEnvironmentId: ENVIRONMENT_ID,
        targetEnvironmentId,
        options: {
          branch: "feat/checkout",
          worktreePath: "/dead/machine/worktree",
          envMode: "worktree",
          startFromOrigin: false,
        },
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: false,
    });
  });

  it("prefers the viewed thread's environment, then the draft, then primary", () => {
    expect(
      resolveNewThreadEnvironmentId({
        activeThread: { environmentId: ENVIRONMENT_ID },
        activeDraftThread: { environmentId: EnvironmentId.make("environment-draft") },
        primaryEnvironmentId: EnvironmentId.make("environment-primary"),
      }),
    ).toBe(ENVIRONMENT_ID);
    expect(
      resolveNewThreadEnvironmentId({
        activeDraftThread: { environmentId: EnvironmentId.make("environment-draft") },
        primaryEnvironmentId: EnvironmentId.make("environment-primary"),
      }),
    ).toBe(EnvironmentId.make("environment-draft"));
    expect(
      resolveNewThreadEnvironmentId({
        primaryEnvironmentId: EnvironmentId.make("environment-primary"),
      }),
    ).toBe(EnvironmentId.make("environment-primary"));
    expect(resolveNewThreadEnvironmentId({ primaryEnvironmentId: null })).toBeNull();
  });

  it("matches a computer-home workspace across trailing-slash and case differences", () => {
    expect(isComputerHomeWorkspace("/Users/me/", "/Users/me")).toBe(true);
    expect(isComputerHomeWorkspace("/Users/me/Horus", "/Users/me")).toBe(false);
    expect(isComputerHomeWorkspace("C:\\Users\\me", "C:/Users/me")).toBe(true);
    expect(isComputerHomeWorkspace(null, "/Users/me")).toBe(false);
  });

  it("finds an existing home project on the target environment without duplicating it", () => {
    const otherEnvironmentId = EnvironmentId.make("environment-2");

    expect(
      findComputerHomeProjectRef({
        environmentId: ENVIRONMENT_ID,
        homeDirectory: "/Users/me",
        projects: [
          {
            environmentId: otherEnvironmentId,
            id: FALLBACK_PROJECT_ID,
            workspaceRoot: "/Users/me",
          },
          {
            environmentId: ENVIRONMENT_ID,
            id: PROJECT_ID,
            workspaceRoot: "/Users/me/",
          },
        ],
      }),
    ).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));

    expect(
      findComputerHomeProjectRef({
        environmentId: ENVIRONMENT_ID,
        homeDirectory: "/Users/me",
        projects: [
          {
            environmentId: ENVIRONMENT_ID,
            id: PROJECT_ID,
            workspaceRoot: "/Users/me/Horus",
          },
        ],
      }),
    ).toBeNull();
  });
});
