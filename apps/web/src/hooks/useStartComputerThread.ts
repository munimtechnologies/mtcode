import { useAtomValue } from "@effect/atom-react";
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

export function useStartComputerThread() {
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const createProject = useAtomCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const providers = useAtomValue(primaryServerProvidersAtom);

  return useCallback(async (): Promise<boolean> => {
    const fallback = () =>
      startNewThreadFromContext({
        activeDraftThread,
        activeThread: activeThread ?? undefined,
        defaultProjectRef,
        handleNewThread,
      });
    const environmentId = resolveNewThreadEnvironmentId({
      activeThread,
      activeDraftThread,
      primaryEnvironmentId,
    });
    if (!environmentId) {
      return fallback();
    }

    const environment = environments.find((candidate) => candidate.environmentId === environmentId);
    const homeDirectory = environment?.serverConfig?.environment.homeDirectory;
    if (!homeDirectory) {
      return fallback();
    }

    const existing = findComputerHomeProjectRef({
      environmentId,
      homeDirectory,
      projects,
    });
    if (existing) {
      await handleNewThread(existing, { envMode: "local" });
      return true;
    }

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
      return false;
    }

    await handleNewThread(scopeProjectRef(environmentId, projectId), { envMode: "local" });
    return true;
  }, [
    activeDraftThread,
    activeThread,
    createProject,
    defaultProjectRef,
    environments,
    handleNewThread,
    primaryEnvironmentId,
    projects,
    providers,
  ]);
}
