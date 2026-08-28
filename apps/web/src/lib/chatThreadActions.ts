import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
    // The opened draft's identity, which most callers have no use for.
  ): Promise<unknown>;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveNewThreadModelSelectionOverride(input: {
  readonly projectDefaultSelection: ModelSelection | null;
  readonly carrySelection: ModelSelection | null;
  readonly carrySourceDraftId: string | null;
  readonly destinationDraftId: string;
}): ModelSelection | null {
  return (
    input.projectDefaultSelection ??
    (input.carrySourceDraftId === input.destinationDraftId ? null : input.carrySelection)
  );
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

export function resolveAvailableNewThreadProjectRef(input: {
  requested: ScopedProjectRef;
  members: ReadonlyArray<{
    environmentId: EnvironmentId;
    projectId: ProjectId;
    isPrimary?: boolean;
  }>;
  isEnvironmentReachable: (environmentId: EnvironmentId) => boolean;
}): ScopedProjectRef {
  if (input.isEnvironmentReachable(input.requested.environmentId)) {
    return input.requested;
  }
  const reachable = input.members
    .filter((member) => input.isEnvironmentReachable(member.environmentId))
    .toSorted((left, right) => Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)));
  const next = reachable[0];
  return next ? scopeProjectRef(next.environmentId, next.projectId) : input.requested;
}

export function resolveWorkspaceOptionsAfterEnvironmentRetarget<
  TOptions extends {
    branch?: string | null;
    worktreePath?: string | null;
  },
>(input: {
  requestedEnvironmentId: EnvironmentId;
  targetEnvironmentId: EnvironmentId;
  options: TOptions | undefined;
}): TOptions | undefined {
  if (input.options === undefined) return undefined;
  if (input.requestedEnvironmentId === input.targetEnvironmentId) return input.options;
  return {
    ...input.options,
    ...(input.options.branch !== undefined ? { branch: null } : {}),
    ...(input.options.worktreePath !== undefined ? { worktreePath: null } : {}),
  };
}

// New threads inherit only the *project* from the current context. Branch,
// worktree, and env mode always come from the user's configured defaults —
// carrying them over from the viewed thread meant "new thread" silently
// reused checkouts and branches. Explicit affordances (branch toolbar's
// "new thread in this worktree") pass those options to handleNewThread
// directly instead.
export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}

export function resolveNewThreadEnvironmentId(input: {
  readonly activeThread?: { readonly environmentId: EnvironmentId } | null;
  readonly activeDraftThread?: { readonly environmentId: EnvironmentId } | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): EnvironmentId | null {
  return (
    input.activeThread?.environmentId ??
    input.activeDraftThread?.environmentId ??
    input.primaryEnvironmentId
  );
}

export function isComputerHomeWorkspace(
  workspaceRoot: string | null | undefined,
  homeDirectory: string | null | undefined,
): boolean {
  if (!workspaceRoot || !homeDirectory) {
    return false;
  }
  const normalizedWorkspace = normalizeProjectPathForComparison(workspaceRoot);
  const normalizedHome = normalizeProjectPathForComparison(homeDirectory);
  return normalizedWorkspace.length > 0 && normalizedWorkspace === normalizedHome;
}

export function findComputerHomeProjectRef(input: {
  readonly environmentId: EnvironmentId;
  readonly homeDirectory: string;
  readonly projects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly workspaceRoot?: string;
    readonly cwd?: string;
  }>;
}): ScopedProjectRef | null {
  const match = findProjectByPath(
    input.projects.filter((project) => project.environmentId === input.environmentId),
    input.homeDirectory,
  );
  return match ? scopeProjectRef(input.environmentId, match.id) : null;
}
