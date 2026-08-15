import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { Pin, Plus, X } from "lucide-react";
import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DraftId } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProjectFavicon } from "../ProjectFavicon";
import { useThreadShell } from "../../state/entities";
import { serverTabKey, useWorkspaceTabsStore, type WorkspaceTab } from "../../workspaceTabsStore";

interface WorkspaceTabsProps {
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly activeThreadId?: ThreadId | undefined;
  readonly draftId?: DraftId | undefined;
  readonly activeThreadTitle: string;
  readonly activeProjectName?: string | undefined;
  readonly activeProjectCwd?: string | null | undefined;
  readonly activeProjectFaviconPath?: string | null | undefined;
  readonly isWorking?: boolean | undefined;
  readonly onNewTab: () => void;
}

function ServerThreadTabItem({
  tab,
  isActive,
  isDragged,
  isDragOver,
  onActivate,
  onClose,
  onAuxClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  readonly tab: WorkspaceTab;
  readonly isActive: boolean;
  readonly isDragged: boolean;
  readonly isDragOver: boolean;
  readonly onActivate: () => void;
  readonly onClose: (e: ReactMouseEvent) => void;
  readonly onAuxClick: (e: ReactMouseEvent) => void;
  readonly onContextMenu: (e: ReactMouseEvent) => void;
  readonly onDragStart: (e: ReactDragEvent) => void;
  readonly onDragOver: (e: ReactDragEvent) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: (e: ReactDragEvent) => void;
  readonly onDragEnd: () => void;
}) {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useMemo(
    () => scopeThreadRef(tab.environmentId, tab.threadId),
    [tab.environmentId, tab.threadId],
  );
  const shell = useThreadShell(threadRef);
  const title = shell?.title || tab.title || "Thread";
  const fullLabel = tab.projectName ? `${tab.projectName} · ${title}` : title;

  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [isActive]);

  return (
    <div
      ref={itemRef}
      draggable
      data-active-tab={isActive ? "true" : "false"}
      data-tab-key={tab.key}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      className={cn(
        "group/tab relative flex h-7 max-w-48 min-w-24 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-xs transition-all duration-150",
        isActive
          ? "border border-border/80 bg-accent text-foreground shadow-2xs font-medium"
          : "border border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragged && "opacity-40 scale-95",
        isDragOver && !isDragged && "ring-2 ring-primary/80 bg-accent/90",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5" onClick={onActivate}>
        <ProjectFavicon
          environmentId={tab.environmentId}
          cwd={tab.projectCwd ?? ""}
          faviconPath={tab.faviconPath}
          className="size-3.5 shrink-0"
        />
        <Tooltip>
          <TooltipTrigger render={<span className="truncate">{title}</span>} />
          <TooltipPopup side="bottom">{fullLabel}</TooltipPopup>
        </Tooltip>
        {tab.pinned ? <Pin className="size-2.5 shrink-0 rotate-45 opacity-60" /> : null}
      </div>

      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className={cn(
          "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
          isActive
            ? "opacity-60 hover:opacity-100"
            : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function WorkspaceTabs({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  activeProjectCwd,
  activeProjectFaviconPath,
  onNewTab,
}: WorkspaceTabsProps) {
  const navigate = useNavigate();
  const tabs = useWorkspaceTabsStore((state) => state.tabs);
  const openTab = useWorkspaceTabsStore((state) => state.openTab);
  const closeTab = useWorkspaceTabsStore((state) => state.closeTab);
  const closeOtherTabs = useWorkspaceTabsStore((state) => state.closeOtherTabs);
  const closeTabsToRight = useWorkspaceTabsStore((state) => state.closeTabsToRight);
  const closeAllTabs = useWorkspaceTabsStore((state) => state.closeAllTabs);
  const reorderTabs = useWorkspaceTabsStore((state) => state.reorderTabs);
  const togglePinTab = useWorkspaceTabsStore((state) => state.togglePinTab);

  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const currentTabKey = activeThreadId
    ? serverTabKey(activeThreadEnvironmentId, activeThreadId)
    : null;

  const isDraftActive = !activeThreadId || Boolean(draftId);

  useEffect(() => {
    if (!activeThreadId) return;
    openTab({
      key: serverTabKey(activeThreadEnvironmentId, activeThreadId),
      kind: "server",
      environmentId: activeThreadEnvironmentId,
      threadId: activeThreadId,
      title: activeThreadTitle || "Thread",
      projectName: activeProjectName,
      projectCwd: activeProjectCwd,
      faviconPath: activeProjectFaviconPath,
    });
  }, [
    activeProjectCwd,
    activeProjectFaviconPath,
    activeProjectName,
    activeThreadEnvironmentId,
    activeThreadId,
    activeThreadTitle,
    openTab,
  ]);

  const effectiveTabs = useMemo(() => {
    if (
      !activeThreadId ||
      tabs.some(
        (t) => t.threadId === activeThreadId && t.environmentId === activeThreadEnvironmentId,
      )
    ) {
      return tabs;
    }
    const currentTab: WorkspaceTab = {
      key: serverTabKey(activeThreadEnvironmentId, activeThreadId),
      kind: "server",
      environmentId: activeThreadEnvironmentId,
      threadId: activeThreadId,
      title: activeThreadTitle || "Thread",
      projectName: activeProjectName,
      projectCwd: activeProjectCwd,
      faviconPath: activeProjectFaviconPath,
    };
    return [currentTab, ...tabs];
  }, [
    activeProjectCwd,
    activeProjectFaviconPath,
    activeProjectName,
    activeThreadEnvironmentId,
    activeThreadId,
    activeThreadTitle,
    tabs,
  ]);

  const handleNavigateToTab = useCallback(
    (tab: WorkspaceTab) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: tab.environmentId, threadId: tab.threadId },
      });
    },
    [navigate],
  );

  const handleCloseTab = useCallback(
    (tab: WorkspaceTab, event?: ReactMouseEvent) => {
      event?.stopPropagation();
      event?.preventDefault();

      const nextActive = closeTab(tab.key);
      if (tab.key === currentTabKey) {
        if (nextActive) {
          handleNavigateToTab(nextActive);
        } else {
          onNewTab();
        }
      }
    },
    [closeTab, currentTabKey, handleNavigateToTab, onNewTab],
  );

  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, tab: WorkspaceTab) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
        handleCloseTab(tab);
      }
    },
    [handleCloseTab],
  );

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, tab: WorkspaceTab) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const tabIndex = effectiveTabs.findIndex((t) => t.key === tab.key);
      if (tabIndex < 0) return;

      const items = [
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: effectiveTabs.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: tabIndex >= effectiveTabs.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: effectiveTabs.length === 0,
        },
        {
          id: "toggle-pin",
          label: tab.pinned ? "Unpin tab" : "Pin tab",
        },
      ];

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "close":
          handleCloseTab(tab);
          break;
        case "close-others":
          closeOtherTabs(tab.key);
          if (currentTabKey !== tab.key) {
            handleNavigateToTab(tab);
          }
          break;
        case "close-to-right":
          closeTabsToRight(tab.key);
          if (effectiveTabs.findIndex((t) => t.key === currentTabKey) > tabIndex) {
            handleNavigateToTab(tab);
          }
          break;
        case "close-all":
          closeAllTabs();
          onNewTab();
          break;
        case "toggle-pin":
          togglePinTab(tab.key);
          break;
        case null:
          break;
      }
    },
    [
      closeAllTabs,
      closeOtherTabs,
      closeTabsToRight,
      currentTabKey,
      effectiveTabs,
      handleCloseTab,
      handleNavigateToTab,
      onNewTab,
      togglePinTab,
    ],
  );

  const handleDragStart = useCallback((e: ReactDragEvent, tabKey: string) => {
    e.dataTransfer.setData("text/plain", tabKey);
    e.dataTransfer.effectAllowed = "move";
    setDraggedKey(tabKey);
  }, []);

  const handleDragOver = useCallback((e: ReactDragEvent, tabKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverKey(tabKey);
  }, []);

  const handleDragLeave = useCallback((tabKey: string) => {
    setDragOverKey((prev) => (prev === tabKey ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (e: ReactDragEvent, targetKey: string) => {
      e.preventDefault();
      if (draggedKey && draggedKey !== targetKey) {
        const sourceIndex = effectiveTabs.findIndex((t) => t.key === draggedKey);
        const targetIndex = effectiveTabs.findIndex((t) => t.key === targetKey);
        if (sourceIndex >= 0 && targetIndex >= 0) {
          reorderTabs(sourceIndex, targetIndex);
        }
      }
      setDraggedKey(null);
      setDragOverKey(null);
    },
    [draggedKey, effectiveTabs, reorderTabs],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedKey(null);
    setDragOverKey(null);
  }, []);

  const handleWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  }, []);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-workspace-tabs="">
      <ScrollArea
        hideScrollbars
        scrollFade
        className="min-w-0 flex-1 rounded-none"
        data-workspace-tab-list=""
      >
        <div
          onWheel={handleWheel}
          className="flex h-full w-max min-w-full items-center gap-1 py-0.5"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  data-active-tab={isDraftActive ? "true" : "false"}
                  data-tab-key="new-thread"
                  onClick={onNewTab}
                  className={cn(
                    "group/tab relative flex h-7 max-w-40 min-w-24 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors duration-150",
                    isDraftActive
                      ? "border border-border/80 bg-accent text-foreground shadow-2xs font-medium"
                      : "border border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground group-hover/tab:text-foreground" />
                  <span className="truncate">New thread</span>
                </div>
              }
            />
            <TooltipPopup side="bottom">New thread</TooltipPopup>
          </Tooltip>

          {effectiveTabs.map((tab) => {
            const isActive = tab.key === currentTabKey;
            const isDragged = tab.key === draggedKey;
            const isDragOver = tab.key === dragOverKey;

            return (
              <ServerThreadTabItem
                key={tab.key}
                tab={tab}
                isActive={isActive}
                isDragged={isDragged}
                isDragOver={isDragOver}
                onActivate={() => handleNavigateToTab(tab)}
                onClose={(e) => handleCloseTab(tab, e)}
                onAuxClick={(e) => handleTabAuxClick(e, tab)}
                onContextMenu={(e) => void handleTabContextMenu(e, tab)}
                onDragStart={(e) => handleDragStart(e, tab.key)}
                onDragOver={(e) => handleDragOver(e, tab.key)}
                onDragLeave={() => handleDragLeave(tab.key)}
                onDrop={(e) => handleDrop(e, tab.key)}
                onDragEnd={handleDragEnd}
              />
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
