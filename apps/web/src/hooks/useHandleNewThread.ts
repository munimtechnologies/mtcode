import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ScopedProjectRef,
  type T3ProjectFile,
  type ThreadId,
} from "@t3tools/contracts";
import { type AnyRouter, useRouter } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import {
  composerDraftHasUserContent,
  markPromotedDraftThreadByRef,
  type DraftId,
  type DraftSessionState,
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import {
  deriveLogicalProjectKeyFromSettings,
  getProjectOrderKey,
  resolveGroupDefaultProject,
  selectProjectGroupingSettings,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { resolveNewThreadEnvMode, resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadRuntimeMode } from "@t3tools/shared/serverSettings";
import {
  readProjects,
  readThreadShell,
  readThreadShells,
  useProjects,
  useQuietThreadShell,
} from "../state/entities";
import { readPrimaryEnvironmentId } from "../state/environments";
import { environmentPresentations } from "../state/presentation";
import {
  draftModelSelectionApplies,
  hasExplicitComposerModelSelection,
  resolveAvailableNewThreadProjectRef,
  resolveNewDraftStartFromOrigin,
  resolveNewThreadModelSelectionOverride,
  resolveWorkspaceOptionsAfterEnvironmentRetarget,
  threadHasStarted,
} from "../lib/chatThreadActions";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { peekT3ProjectFile, readT3ProjectFile } from "../lib/t3ProjectFileDefaults";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { shouldReadProjectFileForNewThreadDefaults } from "../session-logic";
import { environmentServerConfigsAtom } from "../state/server";
import {
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "../providerInstances";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { getClientSettings, useClientSettings } from "./useSettings";
import { getLocalStorageItem, useLocalStorage } from "./useLocalStorage";
import * as Schema from "effect/Schema";
import { useAtomValue } from "@effect/atom-react";
import { defaultProjectFallbackReadyAtom } from "../state/projects";
import { useThreadRouteTarget } from "./useThreadRouteTarget";
import { readUnloadedThreadCount } from "../state/olderSettledShelf";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";

export const LAST_USED_PROJECT_STORAGE_KEY = "t3code:last-used-project:v1";
export const lastUsedProjectKeySchema = Schema.NullOr(Schema.String);

export function readLastUsedProjectKey(): string | null {
  try {
    return getLocalStorageItem(LAST_USED_PROJECT_STORAGE_KEY, lastUsedProjectKeySchema);
  } catch {
    return null;
  }
}

// Drafts that opened before their project's t3.json was read. A send waits for the file's
// workspace default unless the user has already chosen a workspace.
interface ProvisionalWorkspace {
  readonly envMode: DraftThreadEnvMode;
  // A reused draft keeps an earlier "manual" marker; only a switch to manual after opening is a choice.
  readonly openedManual: boolean;
}

const pendingWorkspaceDefaults = new Map<
  DraftId,
  ProvisionalWorkspace & { readonly settled: Promise<void> }
>();

function keepsProvisionalWorkspace(
  draft: DraftSessionState | null,
  provisional: ProvisionalWorkspace,
): draft is DraftSessionState {
  return (
    draft !== null &&
    draft.promotedTo == null &&
    draft.envMode === provisional.envMode &&
    draft.worktreePath === null &&
    (provisional.openedManual || draft.environmentSelection !== "manual")
  );
}

export function readPendingWorkspaceDefault(draftId: DraftId): Promise<void> | null {
  const pending = pendingWorkspaceDefaults.get(draftId);
  if (pending === undefined) return null;
  const draft = useComposerDraftStore.getState().getDraftSession(draftId);
  return keepsProvisionalWorkspace(draft, pending) ? pending.settled : null;
}

interface NewThreadWorkspaceOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
  startFromOrigin?: boolean;
}

function pickExplicitWorkspaceOptions(options: NewThreadWorkspaceOptions | undefined) {
  return {
    ...(options?.branch !== undefined ? { branch: options.branch } : {}),
    ...(options?.worktreePath !== undefined ? { worktreePath: options.worktreePath } : {}),
    ...(options?.envMode !== undefined ? { envMode: options.envMode } : {}),
    ...(options?.startFromOrigin !== undefined ? { startFromOrigin: options.startFromOrigin } : {}),
  };
}

export function useNewThreadHandler() {
  return createNewThreadHandler(useRouter());
}

export type NewThreadHandler = ReturnType<typeof createNewThreadHandler>;

function readEnvironmentConnectionPhase(environmentId: EnvironmentId) {
  return appAtomRegistry.get(environmentPresentations.presentationsAtom).get(environmentId)
    ?.connection.phase;
}

export function createNewThreadHandler(router: AnyRouter) {
  const getCurrentRouteTarget = () => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
  };

  return (
    requestedProjectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
      replace?: boolean;
      /** Composer text for the draft, set before it shows. A draft with user text keeps it. */
      prompt?: string;
    },
  ): Promise<{ draftId: DraftId; threadId: ThreadId } | null> => {
    const projects = readProjects();
    const projectGroupingSettings = selectProjectGroupingSettings(getClientSettings());
    const primaryEnvironmentId = readPrimaryEnvironmentId();
    // Read at call time; status pushes replace the config map and would recreate every sidebar handler.
    const environmentServerConfigs = appAtomRegistry.get(environmentServerConfigsAtom);
    const {
      getComposerDraft,
      getDraftSessionByLogicalProjectKey,
      getDraftSession,
      getDraftThread,
      applyStickyState,
      setDraftThreadContext,
      setLogicalProjectDraftThreadId,
      setModelSelection,
      setPrompt,
    } = useComposerDraftStore.getState();
    // Never over text the user wrote: a draft can gain some while this awaits.
    const seedPrompt = (draftId: DraftId) => {
      if (options?.prompt === undefined) return;
      if (composerDraftHasUserContent(getComposerDraft(draftId))) return;
      setPrompt(draftId, options.prompt);
    };
    const currentRouteTarget = getCurrentRouteTarget();
    // The target project's configured model and permission defaults win.
    // Interaction mode carries from the thread being viewed. Branch,
    // worktree, and env mode come from configured defaults unless the caller
    // passes them explicitly.
    const carrySourceShell =
      currentRouteTarget?.kind === "server" ? readThreadShell(currentRouteTarget.threadRef) : null;
    const carrySourceDraft =
      currentRouteTarget?.kind === "draft" ? getDraftSession(currentRouteTarget.draftId) : null;
    const carrySourceComposer = currentRouteTarget
      ? getComposerDraft(
          currentRouteTarget.kind === "server"
            ? currentRouteTarget.threadRef
            : currentRouteTarget.draftId,
        )
      : null;
    const composerActiveProvider = draftModelSelectionApplies(
      carrySourceComposer,
      threadHasStarted(carrySourceShell),
    )
      ? (carrySourceComposer?.activeProvider ?? null)
      : null;
    const composerModelSelection = composerActiveProvider
      ? (carrySourceComposer?.modelSelectionByProvider[composerActiveProvider] ?? null)
      : null;
    const carryModelSelection = composerModelSelection ?? carrySourceShell?.modelSelection ?? null;
    const carryInteractionMode =
      carrySourceComposer?.interactionMode ??
      carrySourceShell?.interactionMode ??
      carrySourceDraft?.interactionMode ??
      null;
    const requestedProject = projects.find(
      (candidate) =>
        candidate.id === requestedProjectRef.projectId &&
        candidate.environmentId === requestedProjectRef.environmentId,
    );
    const requestedLogicalProjectKey = requestedProject
      ? deriveLogicalProjectKeyFromSettings(requestedProject, projectGroupingSettings)
      : scopedProjectKey(requestedProjectRef);
    const siblingProjects = requestedProject
      ? projects.filter(
          (candidate) =>
            deriveLogicalProjectKeyFromSettings(candidate, projectGroupingSettings) ===
            requestedLogicalProjectKey,
        )
      : [];
    const projectRef = resolveAvailableNewThreadProjectRef({
      requested: requestedProjectRef,
      members: siblingProjects.map((candidate) => ({
        environmentId: candidate.environmentId,
        projectId: candidate.id,
        isPrimary: candidate.environmentId === primaryEnvironmentId,
      })),
      isEnvironmentReachable: (environmentId) =>
        canCreateProjectInEnvironment(readEnvironmentConnectionPhase(environmentId)),
    });
    const targetServerConfig = environmentServerConfigs.get(projectRef.environmentId);
    const project =
      projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      ) ?? requestedProject;
    // Read the settings of the environment that will actually host the
    // thread (it may differ from the requested one after retargeting).
    const targetServerSettings = targetServerConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
    const projectSettings = resolveProjectSettings(
      targetServerSettings,
      project?.id ?? null,
      project,
    );
    const configuredDefaultModelSelection = projectSettings.settings.defaultModelSelection ?? null;
    const fallbackResolution = resolveNewThreadModelSelection({
      defaultSelection:
        configuredDefaultModelSelection ??
        (carryModelSelection || useComposerDraftStore.getState().stickyActiveProvider !== null
          ? null
          : resolveProjectDefaultProviderModelSelection(
              targetServerConfig?.providers ?? [],
              targetServerSettings,
              projectRef.projectId,
            )),
      fallbackSelection: targetServerSettings.fallbackModelSelection ?? null,
      providers: targetServerConfig?.providers ?? [],
      settings: targetServerSettings,
      projectId: projectRef.projectId,
      now: Date.now(),
    });
    const projectDefaultModelSelection = fallbackResolution.fallback
      ? fallbackResolution.selection
      : configuredDefaultModelSelection;
    const resolveImplicitRuntimeMode = (destinationDraftId: DraftId) => {
      const destinationDraft = getComposerDraft(destinationDraftId);
      if (destinationDraft?.runtimeMode != null) {
        return undefined;
      }
      return resolveNewThreadRuntimeMode(
        projectSettings.settings,
        destinationDraft?.activeProvider ??
          projectDefaultModelSelection?.instanceId ??
          resolveDefaultProviderModelSelection(targetServerConfig?.providers ?? [], null)
            ?.instanceId,
      );
    };
    const resolveModelSelectionOverride = (destinationDraftId: DraftId) =>
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: projectDefaultModelSelection ?? null,
        carrySelection: carryModelSelection,
        carrySourceDraftId:
          currentRouteTarget?.kind === "draft" ? currentRouteTarget.draftId : null,
        destinationDraftId,
      });
    const workspaceOptions = resolveWorkspaceOptionsAfterEnvironmentRetarget({
      requestedEnvironmentId: requestedProjectRef.environmentId,
      targetEnvironmentId: projectRef.environmentId,
      options,
    });
    const envModeFor = (projectFile: T3ProjectFile | null): DraftThreadEnvMode =>
      resolveNewThreadEnvMode({
        projectSettings: resolveProjectSettings(
          targetServerSettings,
          project?.id ?? null,
          project,
          projectFile,
        ),
        workspaceRoot: project?.workspaceRoot ?? null,
        newProjectsRoot: environmentServerConfigs.get(projectRef.environmentId)?.newProjectsRoot,
        projectHasThreads:
          readThreadShells().some(
            (thread) =>
              thread.environmentId === projectRef.environmentId &&
              thread.projectId === projectRef.projectId,
          ) ||
          readUnloadedThreadCount(
            [{ environmentId: projectRef.environmentId, id: projectRef.projectId }],
            [],
          ) > 0,
      });
    const startFromOriginFor = (envMode: DraftThreadEnvMode) =>
      resolveNewDraftStartFromOrigin({
        envMode,
        newWorktreesStartFromOrigin: projectSettings.settings.newWorktreesStartFromOrigin,
      });
    // The draft opens without waiting on t3.json: a cold read takes seconds on a loaded host.
    // Its workspace default lands afterwards unless the user picked a workspace or sent first.
    const resolveDefaultEnvMode = () => {
      // The shared resolver owns the priority order. Environment queries wait on a live RPC, so
      // the t3.json read is skipped when a higher-priority source decides or the machine is down.
      const consultProjectFile =
        project !== undefined &&
        shouldReadProjectFileForNewThreadDefaults(
          projectSettings.settings.defaultThreadEnvMode,
          readEnvironmentConnectionPhase(projectRef.environmentId),
        );
      if (!consultProjectFile) return { envMode: envModeFor(null), applyProjectFile: () => {} };
      const projectFileRead = readT3ProjectFile(project.environmentId, project.workspaceRoot);
      const cachedProjectFile = peekT3ProjectFile(project.environmentId, project.workspaceRoot);
      if (cachedProjectFile !== undefined) {
        return { envMode: envModeFor(cachedProjectFile), applyProjectFile: () => {} };
      }
      const envMode = envModeFor(null);
      const applyProjectFile = (draftId: DraftId) => {
        const provisional: ProvisionalWorkspace = {
          envMode,
          openedManual: getDraftSession(draftId)?.environmentSelection === "manual",
        };
        const settled = projectFileRead
          .then((projectFile) => {
            const fileEnvMode = envModeFor(projectFile);
            const draft = getDraftSession(draftId);
            if (fileEnvMode === envMode || !keepsProvisionalWorkspace(draft, provisional)) return;
            // Commit before a waiting send re-reads the composer's workspace.
            flushSync(() =>
              setDraftThreadContext(draftId, {
                envMode: fileEnvMode,
                ...(draft.startFromOrigin === startFromOriginFor(envMode)
                  ? { startFromOrigin: startFromOriginFor(fileEnvMode) }
                  : {}),
              }),
            );
          })
          .finally(() => {
            if (pendingWorkspaceDefaults.get(draftId)?.settled === settled) {
              pendingWorkspaceDefaults.delete(draftId);
            }
          });
        pendingWorkspaceDefaults.set(draftId, { ...provisional, settled });
      };
      return { envMode, applyProjectFile };
    };
    const logicalProjectKey = project
      ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
      : scopedProjectKey(projectRef);
    const hasBranchOption = workspaceOptions?.branch !== undefined;
    const hasWorktreePathOption = workspaceOptions?.worktreePath !== undefined;
    const hasEnvModeOption = workspaceOptions?.envMode !== undefined;
    const hasStartFromOriginOption = workspaceOptions?.startFromOrigin !== undefined;
    const storedDraftThread = getDraftSessionByLogicalProjectKey(logicalProjectKey);
    const storedDraftThreadRef = storedDraftThread
      ? scopeThreadRef(storedDraftThread.environmentId, storedDraftThread.threadId)
      : null;
    const reusableStoredDraftThread =
      storedDraftThread !== null &&
      storedDraftThread.promotedTo == null &&
      storedDraftThreadRef !== null &&
      readThreadShell(storedDraftThreadRef) === null
        ? storedDraftThread
        : null;
    if (storedDraftThreadRef && reusableStoredDraftThread === null) {
      markPromotedDraftThreadByRef(storedDraftThreadRef);
    }
    const emptyStoredDraftThread =
      reusableStoredDraftThread &&
      !composerDraftHasUserContent(getComposerDraft(reusableStoredDraftThread.draftId))
        ? reusableStoredDraftThread
        : null;
    const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
      ? currentRouteTarget.kind === "server"
        ? getDraftThread(currentRouteTarget.threadRef)
        : getDraftSession(currentRouteTarget.draftId)
      : null;
    if (emptyStoredDraftThread) {
      return (async () => {
        const isDraftAlreadyOpen =
          currentRouteTarget?.kind === "draft" &&
          currentRouteTarget.draftId === emptyStoredDraftThread.draftId;
        const hasExplicitWorkspaceOption =
          hasBranchOption || hasWorktreePathOption || hasEnvModeOption || hasStartFromOriginOption;
        let workspaceContext: NewThreadWorkspaceOptions | null = null;
        let applyProjectFile: ((draftId: DraftId) => void) | null = null;
        if (hasExplicitWorkspaceOption) {
          workspaceContext = pickExplicitWorkspaceOptions(workspaceOptions);
        } else if (!isDraftAlreadyOpen) {
          const defaultEnvMode = resolveDefaultEnvMode();
          applyProjectFile = defaultEnvMode.applyProjectFile;
          workspaceContext = {
            branch: null,
            worktreePath: null,
            envMode: defaultEnvMode.envMode,
            startFromOrigin: startFromOriginFor(defaultEnvMode.envMode),
          };
        }
        if (workspaceContext) {
          setDraftThreadContext(emptyStoredDraftThread.draftId, {
            ...workspaceContext,
            ...(carryInteractionMode ? { interactionMode: carryInteractionMode } : {}),
          });
        }
        const storedDraft = getComposerDraft(emptyStoredDraftThread.draftId);
        const storedDraftHasExplicitModelPick = hasExplicitComposerModelSelection(storedDraft);
        if (!storedDraftHasExplicitModelPick) {
          applyStickyState(emptyStoredDraftThread.draftId);
          const modelSelectionOverride = resolveModelSelectionOverride(
            emptyStoredDraftThread.draftId,
          );
          if (modelSelectionOverride) {
            setModelSelection(emptyStoredDraftThread.draftId, modelSelectionOverride, {
              replaceOptions: true,
            });
          }
        }
        // The workspace context must also ride along here: when projectRef
        // targets a different physical member of the logical project,
        // createDraftThreadState treats the remap as a project change and
        // would otherwise wipe branch/worktree, undoing the write above.
        const implicitRuntimeMode = resolveImplicitRuntimeMode(emptyStoredDraftThread.draftId);
        setLogicalProjectDraftThreadId(
          logicalProjectKey,
          projectRef,
          emptyStoredDraftThread.draftId,
          {
            threadId: emptyStoredDraftThread.threadId,
            ...(implicitRuntimeMode ? { runtimeMode: implicitRuntimeMode } : {}),
            ...workspaceContext,
            ...(carryInteractionMode ? { interactionMode: carryInteractionMode } : {}),
          },
        );
        const opened = {
          draftId: emptyStoredDraftThread.draftId,
          threadId: emptyStoredDraftThread.threadId,
        };
        seedPrompt(emptyStoredDraftThread.draftId);
        applyProjectFile?.(emptyStoredDraftThread.draftId);
        const routeTargetAfterWrites = getCurrentRouteTarget();
        if (
          routeTargetAfterWrites?.kind === "draft" &&
          routeTargetAfterWrites.draftId === emptyStoredDraftThread.draftId
        ) {
          return opened;
        }
        await router.navigate({
          to: "/draft/$draftId",
          params: { draftId: emptyStoredDraftThread.draftId },
          replace: options?.replace ?? false,
        });
        return opened;
      })();
    }

    if (
      latestActiveDraftThread &&
      currentRouteTarget?.kind === "draft" &&
      latestActiveDraftThread.logicalProjectKey === logicalProjectKey &&
      latestActiveDraftThread.promotedTo == null &&
      !composerDraftHasUserContent(getComposerDraft(currentRouteTarget.draftId))
    ) {
      if (
        hasBranchOption ||
        hasWorktreePathOption ||
        hasEnvModeOption ||
        hasStartFromOriginOption
      ) {
        setDraftThreadContext(
          currentRouteTarget.draftId,
          pickExplicitWorkspaceOptions(workspaceOptions),
        );
      }
      setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
        threadId: latestActiveDraftThread.threadId,
        createdAt: latestActiveDraftThread.createdAt,
        runtimeMode:
          resolveImplicitRuntimeMode(currentRouteTarget.draftId) ??
          latestActiveDraftThread.runtimeMode,
        interactionMode: latestActiveDraftThread.interactionMode,
        ...pickExplicitWorkspaceOptions(workspaceOptions),
      });
      seedPrompt(currentRouteTarget.draftId);
      return Promise.resolve({
        draftId: currentRouteTarget.draftId,
        threadId: latestActiveDraftThread.threadId,
      });
    }

    const draftId = newDraftId();
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    return (async () => {
      const defaultEnvMode =
        workspaceOptions?.envMode === undefined ? resolveDefaultEnvMode() : null;
      const initialEnvMode = workspaceOptions?.envMode ?? defaultEnvMode?.envMode ?? "local";
      setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
        threadId,
        createdAt,
        branch: workspaceOptions?.branch ?? null,
        worktreePath: workspaceOptions?.worktreePath ?? null,
        envMode: initialEnvMode,
        startFromOrigin: workspaceOptions?.startFromOrigin ?? startFromOriginFor(initialEnvMode),
        runtimeMode: projectSettings.settings.defaultRuntimeMode,
        ...(carryInteractionMode ? { interactionMode: carryInteractionMode } : {}),
      });
      applyStickyState(draftId);
      const modelSelectionOverride = resolveModelSelectionOverride(draftId);
      if (modelSelectionOverride) {
        setModelSelection(draftId, modelSelectionOverride, { replaceOptions: true });
      }
      setDraftThreadContext(draftId, {
        runtimeMode: resolveNewThreadRuntimeMode(
          projectSettings.settings,
          getComposerDraft(draftId)?.activeProvider ??
            resolveDefaultProviderModelSelection(targetServerConfig?.providers ?? [], null)
              ?.instanceId,
        ),
      });
      seedPrompt(draftId);
      defaultEnvMode?.applyProjectFile(draftId);
      await router.navigate({
        to: "/draft/$draftId",
        params: { draftId },
        replace: options?.replace ?? false,
      });
      return { draftId, threadId };
    })();
  };
}

export function resolveDefaultProjectRef(
  projects: ReadonlyArray<EnvironmentProject>,
  projectOrder: readonly string[],
  lastUsedProjectKey: string | null,
  fallbackReady = true,
  groupingSettings?: ProjectGroupingSettings,
): ScopedProjectRef | null {
  const lastUsed = projects.find(
    (project) =>
      project.archivedAt == null &&
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === lastUsedProjectKey,
  );
  if (lastUsed) return scopeProjectRef(lastUsed.environmentId, lastUsed.id);
  if (!fallbackReady) return null;
  const liveProjects = projects.filter((project) => project.archivedAt == null);
  const [firstProject] = orderItemsByPreferredIds({
    items: liveProjects,
    preferredIds: projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
  if (!firstProject) return null;
  const defaultProject = groupingSettings
    ? resolveGroupDefaultProject(firstProject, liveProjects, groupingSettings)
    : firstProject;
  return scopeProjectRef(defaultProject.environmentId, defaultProject.id);
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const [lastUsedProjectKey] = useLocalStorage(
    LAST_USED_PROJECT_STORAGE_KEY,
    null,
    lastUsedProjectKeySchema,
  );
  const defaultProjectFallbackReady = useAtomValue(
    defaultProjectFallbackReadyAtom(lastUsedProjectKey),
  );
  const routeTarget = useThreadRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const activeThread = useQuietThreadShell(routeThreadRef);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const defaultProjectRef = resolveDefaultProjectRef(
    projects,
    projectOrder,
    lastUsedProjectKey,
    defaultProjectFallbackReady,
    groupingSettings,
  );

  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef,
    defaultProjectFallbackReady,
    handleNewThread,
    routeDraftId,
    routeThreadRef,
  };
}
