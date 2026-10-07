import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon, MonitorIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isTrailingDoubleClick } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { readLocalApi } from "~/localApi";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { type DraftId } from "~/composerDraftStore";
import { onToggleComputerView } from "../../computerViewBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { useRemoteOpenState, type RemoteOpenMode } from "../../remoteOpen";
import { useEnvironment } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useTabsEnabled } from "~/hooks/useSettings";
import { ComputerViewDialog } from "../computers/ComputerViewDialog";
import { Button } from "../ui/button";
import { WorkspaceTabs } from "./WorkspaceTabs";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  /** Drafts have no server thread yet, so the title carries no action menu. */
  isServerThread: boolean;
  activeProject: EnvironmentProject | null;
  rightPanelOpen: boolean;
  onNewThreadInProject: () => void;
  onOpenProjectSettings?: (() => void) | undefined;
}

/**
 * Rename commit rule shared with the sidebar's inline rename: trim, reject
 * empty (the caller toasts), and skip the mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

// How long a click on the thread title waits before opening the action menu,
// so a double-click-to-rename can cancel it first. Only the native desktop
// menu needs this: it swallows input while open, so the wait must cover the
// OS double-click interval. The browser fallback menu keeps seeing DOM
// events (the second click dismisses it and dblclick still fires), so it
// opens immediately.
const TITLE_MENU_OPEN_DELAY_MS = 500;

/**
 * The monitor button is a remote desktop into *another* machine. On the
 * computer the thread already runs on, the screen it would show is the one the
 * user is looking at, so the button (and its `computerView.toggle` shortcut)
 * stay hidden there even though the capability is advertised.
 *
 * "Another machine" is decided by where the thread's environment runs relative
 * to this client, the same answer the Open picker uses (`useRemoteOpenState`):
 * `local-exec` covers the desktop app's own backend, its WSL sibling, and a
 * browser served from loopback. Everything else is another computer: SSH
 * hosts, paired backends, T3 Connect, and the primary environment itself when
 * this is a browser pointed at a remote server. Comparing against the primary
 * environment id alone got that last case backwards.
 */
export function shouldShowComputerView(input: {
  readonly capabilityAdvertised: boolean;
  readonly threadMachine: RemoteOpenMode;
}): boolean {
  if (!input.capabilityAdvertised) return false;
  return input.threadMachine !== "local-exec";
}
export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  isServerThread,
  activeProject,
  rightPanelOpen,
  onNewThreadInProject,
  onOpenProjectSettings,
}: ChatHeaderProps) {
  const tabsEnabled = useTabsEnabled();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const activeProjectName = activeProject?.title;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const remoteOpenState = useRemoteOpenState(activeThreadEnvironmentId);
  const threadEnvironmentPresentation = useEnvironment(activeThreadEnvironmentId);
  // Gated on the environment's descriptor: the capability is only advertised
  // when the server ships the computerView RPCs and the machine has the
  // desktop-control binary to serve them. Viewing the machine you are sitting
  // at is not remote desktop, so an environment on this machine never offers it.
  const supportsComputerView = shouldShowComputerView({
    capabilityAdvertised:
      threadEnvironmentPresentation?.serverConfig?.environment.capabilities.computerView === true,
    threadMachine: remoteOpenState.mode,
  });
  const [computerViewOpen, setComputerViewOpen] = useState(false);
  useEffect(() => {
    if (!supportsComputerView) return undefined;
    return onToggleComputerView(() => setComputerViewOpen((open) => !open));
  }, [supportsComputerView]);
  const computerViewShortcutLabel = shortcutLabelForCommand(keybindings, "computerView.toggle");
  const activeThreadRef = useMemo(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );
  const canOperateThread = useEnvironmentScope(
    activeThreadEnvironmentId,
    AuthOrchestrationOperateScope,
  );
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Inline rename, keyed by thread: navigating away drops an in-progress
  // rename instead of committing stale text. Cleared on thread change (not
  // just hidden) so returning to the thread doesn't revive the old draft.
  const [renaming, setRenaming] = useState<{
    threadId: ThreadId;
    environmentId: EnvironmentId;
    title: string;
  } | null>(null);
  if (
    renaming !== null &&
    (renaming.threadId !== activeThreadId ||
      renaming.environmentId !== activeThreadEnvironmentId ||
      !canOperateThread)
  ) {
    setRenaming(null);
  }
  const renamingTitle =
    canOperateThread &&
    renaming?.threadId === activeThreadId &&
    renaming.environmentId === activeThreadEnvironmentId
      ? renaming.title
      : null;
  const renameCommittedRef = useRef(false);
  const startRename = useCallback(() => {
    if (
      !isServerThread ||
      !readEnvironmentScope(activeThreadEnvironmentId, AuthOrchestrationOperateScope)
    )
      return;
    renameCommittedRef.current = false;
    setRenaming({
      environmentId: activeThreadEnvironmentId,
      threadId: activeThreadId,
      title: activeThreadTitle,
    });
  }, [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, isServerThread]);
  const commitRename = useCallback(
    (title: string) => {
      setRenaming(null);
      if (!readEnvironmentScope(activeThreadEnvironmentId, AuthOrchestrationOperateScope)) return;
      const resolution = resolveRenameCommit({ title, originalTitle: activeThreadTitle });
      if (resolution.action === "reject-empty") {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (resolution.action === "noop") return;
      void updateThreadMetadata({
        environmentId: activeThreadEnvironmentId,
        input: { threadId: activeThreadId, title: resolution.title },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      });
    },
    [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, updateThreadMetadata],
  );
  const { openMenu, closeMenu } = useThreadActionMenu({
    threadRef: isServerThread ? activeThreadRef : null,
    projectCwd: activeProjectCwd,
    onStartRename: startRename,
  });
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleMenuTimerRef = useRef<number | null>(null);
  const cancelPendingTitleMenu = useCallback(() => {
    if (titleMenuTimerRef.current === null) return;
    clearTimeout(titleMenuTimerRef.current);
    titleMenuTimerRef.current = null;
  }, []);
  // Drop a pending menu-open when the thread changes or the header unmounts,
  // so it can never fire for a thread the user already left.
  useEffect(
    () => () => {
      cancelPendingTitleMenu();
    },
    [activeThreadEnvironmentId, activeThreadId, cancelPendingTitleMenu],
  );
  const openTitleMenuNow = useCallback(() => {
    cancelPendingTitleMenu();
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  }, [cancelPendingTitleMenu, openMenu]);
  const openMenuFromTitle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // The trailing click of a double-click belongs to rename, not the menu.
      if (isTrailingDoubleClick(event.detail)) return;
      // Keyboard activation and the explicit chevron affordance can never be
      // the first half of a double-click, so they open without waiting.
      const clickedChevron =
        (event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null;
      if (event.detail === 0 || clickedChevron || window.desktopBridge === undefined) {
        openTitleMenuNow();
        return;
      }
      // Stay pending long enough for dblclick to cancel the open before the
      // native menu appears and swallows the second click.
      cancelPendingTitleMenu();
      titleMenuTimerRef.current = window.setTimeout(() => {
        titleMenuTimerRef.current = null;
        openTitleMenuNow();
      }, TITLE_MENU_OPEN_DELAY_MS);
    },
    [cancelPendingTitleMenu, openTitleMenuNow],
  );
  const handleTitleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // The chevron is the explicit menu affordance; only the title text renames.
      if ((event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null) return;
      cancelPendingTitleMenu();
      closeMenu();
      startRename();
    },
    [cancelPendingTitleMenu, closeMenu, startRename],
  );
  const handleHeaderContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (renamingTitle !== null) return;
      if (!isServerThread && onOpenProjectSettings === undefined) return;
      cancelPendingTitleMenu();
      event.preventDefault();
      if (!isServerThread) {
        const api = readLocalApi();
        if (!api) return;
        void api.contextMenu
          .show([{ id: "project-settings", label: "Project settings", icon: "settings" }], {
            x: event.clientX,
            y: event.clientY,
          })
          .then((action) => {
            if (action === "project-settings") onOpenProjectSettings?.();
          });
        return;
      }
      openMenu({ x: event.clientX, y: event.clientY });
    },
    [cancelPendingTitleMenu, isServerThread, onOpenProjectSettings, openMenu, renamingTitle],
  );
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        renameCommittedRef.current = true;
        commitRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        renameCommittedRef.current = true;
        setRenaming(null);
      }
    },
    [commitRename],
  );
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 sm:gap-3",
        rightPanelOpen ? "pr-10" : "pr-24",
      )}
      onContextMenu={handleHeaderContextMenu}
    >
      {tabsEnabled ? (
        <WorkspaceTabs
          activeThreadEnvironmentId={activeThreadEnvironmentId}
          activeThreadId={isServerThread ? activeThreadId : undefined}
          draftId={!isServerThread ? draftId : undefined}
          activeThreadTitle={activeThreadTitle}
          activeProjectName={activeProjectName}
          activeProjectCwd={activeProjectCwd}
          activeProjectFaviconPath={activeProject?.faviconPath ?? null}
          onNewTab={onNewThreadInProject}
          renamingTitle={renamingTitle}
          onCommitRename={commitRename}
          onCancelRename={() => {
            renameCommittedRef.current = true;
            setRenaming(null);
          }}
          onRenameKeyDown={handleRenameKeyDown}
          onOpenThreadMenu={(rect) => {
            if (rect) {
              openMenu({ x: rect.left, y: rect.bottom + 4 });
            } else {
              openTitleMenuNow();
            }
          }}
        />
      ) : (
        <WorkspaceBreadcrumb
          ariaLabel="Thread breadcrumb"
          className="flex-1 overflow-clip [overflow-clip-margin:2px]"
        >
          {/* The project always leads the header: knowing which project a
              thread lives in is priority zero, and the thread title alone
              doesn't answer it. */}
          {activeProject ? (
            <>
              <WorkspaceBreadcrumbItem className="shrink">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`New thread in ${activeProjectName}`}
                        onClick={onNewThreadInProject}
                        className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    }
                  >
                    <ProjectFavicon project={activeProject} className="size-3.5" />
                    <WorkspaceBreadcrumbText className="max-w-40">
                      {activeProjectName}
                    </WorkspaceBreadcrumbText>
                  </TooltipTrigger>
                  <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
                </Tooltip>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator>
                <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
              </WorkspaceBreadcrumbSeparator>
            </>
          ) : null}
          <WorkspaceBreadcrumbItem current className="min-w-10 flex-1">
            {renamingTitle !== null ? (
              <input
                autoFocus
                aria-label="Thread title"
                className="min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring"
                defaultValue={renamingTitle}
                onBlur={(event) => {
                  if (renameCommittedRef.current) return;
                  // Focus landing on a navigation button means the rename was
                  // abandoned — discard it rather than persisting a half-draft.
                  if (
                    event.relatedTarget instanceof HTMLElement &&
                    event.relatedTarget.closest("button")
                  ) {
                    setRenaming(null);
                    return;
                  }
                  commitRename(event.currentTarget.value);
                }}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={handleRenameKeyDown}
              />
            ) : isServerThread ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      ref={titleButtonRef}
                      type="button"
                      aria-label={`Thread actions for ${activeThreadTitle}`}
                      aria-haspopup="menu"
                      onClick={openMenuFromTitle}
                      onDoubleClick={canOperateThread ? handleTitleDoubleClick : undefined}
                      onBlur={cancelPendingTitleMenu}
                      className="group/thread-title inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <h2 className="min-w-0">
                    <WorkspaceBreadcrumbText>{activeThreadTitle}</WorkspaceBreadcrumbText>
                  </h2>
                  <ChevronDownIcon
                    aria-hidden
                    data-thread-title-chevron
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100"
                  />
                </TooltipTrigger>
                <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={<h2 aria-label={activeThreadTitle} className="min-w-0 flex-1" />}
                >
                  <WorkspaceBreadcrumbText>{activeThreadTitle}</WorkspaceBreadcrumbText>
                </TooltipTrigger>
                <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
              </Tooltip>
            )}
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      )}
      {supportsComputerView && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label="View this thread's computer"
                onClick={() => setComputerViewOpen(true)}
              />
            }
          >
            <MonitorIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {`View computer${computerViewShortcutLabel ? ` (${computerViewShortcutLabel})` : ""}`}
          </TooltipPopup>
        </Tooltip>
      )}
      {computerViewOpen && supportsComputerView && (
        <ComputerViewDialog
          environmentId={activeThreadEnvironmentId}
          environmentLabel={threadEnvironmentPresentation?.label ?? "this computer"}
          remoteOs={threadEnvironmentPresentation?.serverConfig?.environment.platform.os ?? null}
          keybindings={keybindings}
          onClose={() => setComputerViewOpen(false)}
        />
      )}
    </div>
  );
});
