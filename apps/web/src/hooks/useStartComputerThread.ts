import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  findComputerHomeProjectRef,
  resolveNewThreadEnvironmentId,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import { newProjectId } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { useProjects } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { primaryServerProvidersAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useHandleNewThread } from "./useHandleNewThread";

/**
 * Returns the computer-wide project (the machine's home folder) on an
 * environment, creating it the first time. Null when the machine has not
 * reported its home yet or the create failed; failures are toasted.
 */
export function useEnsureComputerHomeProject() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const createProject = useAtomCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const providers = useAtomValue(primaryServerProvidersAtom);

  return useCallback(
    async (environmentId: EnvironmentId): Promise<ScopedProjectRef | null> => {
      const environment = environments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      const homeDirectory = environment?.serverConfig?.environment.homeDirectory;
      if (!homeDirectory) return null;

      const existing = findComputerHomeProjectRef({ environmentId, homeDirectory, projects });
      if (existing) return existing;

      const projectId = newProjectId();
      const title = environment?.label.trim() || "Computer";
      const targetEnvironmentProviders =
        environment?.serverConfig?.providers ??
        (environmentId === primaryEnvironmentId ? providers : []);
      const createResult = await createProject({
        environmentId,
        input: {
          projectId,
          title,
          workspaceRoot: homeDirectory,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: resolveDefaultProviderModelSelection(
            targetEnvironmentProviders,
            null,
          ),
        },
      });
      if (createResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(createResult)) {
          const error = squashAtomCommandFailure(createResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to start a thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return null;
      }
      return scopeProjectRef(environmentId, projectId);
    },
    [createProject, environments, primaryEnvironmentId, projects, providers],
  );
}

export function useStartComputerThread() {
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const ensureComputerHomeProject = useEnsureComputerHomeProject();

  /**
   * Start a thread scoped to a whole computer. Without an argument that is the
   * computer the user is already working on; pass one to start on another
   * connected computer straight from a picker, with no folder to choose.
   */
  return useCallback(
    async (targetEnvironmentId?: EnvironmentId): Promise<boolean> => {
      const fallback = () =>
        startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
      const environmentId =
        targetEnvironmentId ??
        resolveNewThreadEnvironmentId({
          activeThread,
          activeDraftThread,
          primaryEnvironmentId,
        });
      if (!environmentId) {
        return fallback();
      }

      const environment = environments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      const homeDirectory = environment?.serverConfig?.environment.homeDirectory;
      if (!homeDirectory) {
        // An explicitly picked computer that cannot say where its home is has
        // not advertised itself yet; falling back would start the thread on a
        // different machine than the one that was clicked.
        if (targetEnvironmentId !== undefined) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Computer is not ready",
              description: `${environment?.label ?? "That computer"} has not reported its home directory yet. Try again in a moment.`,
            }),
          );
          return false;
        }
        return fallback();
      }

      const projectRef = await ensureComputerHomeProject(environmentId);
      if (!projectRef) return false;
      await handleNewThread(projectRef, { envMode: "local" });
      return true;
    },
    [
      activeDraftThread,
      activeThread,
      defaultProjectRef,
      ensureComputerHomeProject,
      environments,
      handleNewThread,
      primaryEnvironmentId,
    ],
  );
}
