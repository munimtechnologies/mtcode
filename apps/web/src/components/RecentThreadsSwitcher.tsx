/**
 * Alt-tab style switcher over the threads opened this session, newest first
 * (topped up by most recent activity until two have been visited, so it works
 * straight after a reload).
 * Ctrl+Tab opens it and advances, Ctrl+Shift+Tab goes back, releasing the
 * held modifier opens the highlighted thread, Escape cancels. Mounted once at
 * the root so it works on every route, with or without the sidebar.
 *
 * The list is frozen on open: a thread deleted or archived mid-switch keeps
 * its row as a muted placeholder so the highlight never slides onto a
 * different thread, and committing on it just closes. A route change made
 * elsewhere while the switcher is open (another shortcut, a click, a remote
 * event) also turns the commit into a plain close.
 *
 * Browsers reserve Ctrl+Tab for their own tab switching, so the default
 * shortcut only ever reaches us in the desktop app; in a browser the commands
 * stay inert until the user rebinds them to reachable keys.
 */
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { recentThreadsDirectionFromCommand, resolveShortcutCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { cn } from "../lib/utils";
import {
  type RecentThreadActivity,
  resolveRecentThreadSwitcherKeys,
  useRecentThreadsStore,
} from "../recentThreadsStore";
import { readProject, readThreadShell, readThreadShells } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";

interface SwitcherSession {
  /** Scoped thread keys frozen when the switcher opened, newest visit first. */
  entries: ReadonlyArray<string>;
  selectedIndex: number;
  /** Modifiers held on open; releasing all of them commits the selection. */
  holdsCtrl: boolean;
  holdsMeta: boolean;
  holdsAlt: boolean;
  /**
   * Router pathname when the switcher opened. Read from the router's history
   * rather than the rendered params: the URL moves before React renders the
   * new route, and desktop routes live in the hash.
   */
  originPathname: string;
}

/**
 * Thread keys to offer on open: the live, unarchived visit history, topped
 * up by activity order when that history is too short to switch between.
 */
function switcherThreadKeys(): string[] {
  const liveHistory: string[] = [];
  for (const key of useRecentThreadsStore.getState().recentThreadKeys) {
    const ref = parseScopedThreadKey(key);
    if (!ref) continue;
    const shell = readThreadShell(ref);
    if (shell === null || shell.archivedAt !== null) continue;
    liveHistory.push(key);
  }
  if (liveHistory.length >= 2) return liveHistory;
  const liveThreads: RecentThreadActivity[] = [];
  for (const shell of readThreadShells()) {
    if (shell.archivedAt !== null) continue;
    liveThreads.push({
      threadKey: scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
      activityAt: shell.latestUserMessageAt ?? shell.updatedAt,
    });
  }
  return resolveRecentThreadSwitcherKeys({ liveHistory, liveThreads });
}

type SwitcherEntryView =
  | { available: true; title: string; description: string }
  | { available: false; title: string };

/**
 * What a frozen entry shows right now. A thread deleted or archived since the
 * switcher opened reads as unavailable instead of vanishing, so every row
 * keeps its index.
 */
function describeSwitcherEntry(threadKey: string): SwitcherEntryView {
  const ref = parseScopedThreadKey(threadKey);
  const shell = ref ? readThreadShell(ref) : null;
  if (!ref || !shell) return { available: false, title: "Removed thread" };
  if (shell.archivedAt !== null) return { available: false, title: "Archived thread" };
  const projectTitle = readProject(scopeProjectRef(ref.environmentId, shell.projectId))?.title;
  const description = [projectTitle, shell.branch ? `#${shell.branch}` : null]
    .filter(Boolean)
    .join(" · ");
  return { available: true, title: shell.title, description };
}

export function RecentThreadsSwitcher() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const navigate = useNavigate();
  const router = useRouter();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const [session, setSession] = useState<SwitcherSession | null>(null);
  // Keydown and keyup are native window listeners with no React flush between
  // them, so the ref is written eagerly on every transition — reading state
  // through the render-synced ref would let a keyup commit a cancelled session.
  const sessionRef = useRef(session);
  const updateSession = (next: SwitcherSession | null) => {
    sessionRef.current = next;
    setSession(next);
  };

  const cancel = useEffectEvent(() => {
    if (sessionRef.current === null) return;
    updateSession(null);
  });

  const commit = useEffectEvent((index?: number) => {
    const current = sessionRef.current;
    if (!current) return;
    updateSession(null);
    // The route moved while the switcher was open, and not through it: the
    // user is already somewhere else, so don't yank them to the selection.
    if (router.history.location.pathname !== current.originPathname) return;
    const key = current.entries[index ?? current.selectedIndex];
    const ref = key === undefined ? null : parseScopedThreadKey(key);
    const shell = ref === null ? null : readThreadShell(ref);
    if (!ref || shell === null || shell.archivedAt !== null) return;
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  });

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const current = sessionRef.current;
    if (current) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit();
        return;
      }
    }
    if (event.defaultPrevented) return;
    if (event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]")) {
      return;
    }
    const direction = recentThreadsDirectionFromCommand(
      resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      }),
    );
    if (direction === null) return;
    if (!current && isCommandPaletteOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    // Swallow key repeats after claiming the shortcut: one step per physical
    // press keeps held-modifier cycling controllable.
    if (event.repeat) return;
    const step = direction === "next" ? 1 : -1;
    if (current) {
      const count = current.entries.length;
      updateSession({
        ...current,
        selectedIndex: (current.selectedIndex + step + count) % count,
      });
      return;
    }
    const entries = switcherThreadKeys();
    const routeThreadKey =
      routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;
    if (entries.length === 0 || (entries.length === 1 && entries[0] === routeThreadKey)) return;
    const start =
      entries[0] === routeThreadKey && direction === "next"
        ? 1
        : direction === "next"
          ? 0
          : entries.length - 1;
    updateSession({
      entries,
      selectedIndex: start,
      holdsCtrl: event.ctrlKey,
      holdsMeta: event.metaKey,
      holdsAlt: event.altKey,
      originPathname: router.history.location.pathname,
    });
  });

  const handleWindowKeyUp = useEffectEvent((event: KeyboardEvent) => {
    const current = sessionRef.current;
    if (!current) return;
    if (!current.holdsCtrl && !current.holdsMeta && !current.holdsAlt) return;
    const stillHeld =
      (current.holdsCtrl && event.getModifierState("Control")) ||
      (current.holdsMeta && event.getModifierState("Meta")) ||
      (current.holdsAlt && event.getModifierState("Alt"));
    if (!stillHeld) commit();
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleWindowKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => handleWindowKeyUp(event);
    const onWindowBlur = () => cancel();
    // Capture phase so held-modifier cycling beats focused editors and the
    // terminal drawer, mirroring the sidebar toggle listener.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  if (!session) return null;
  return (
    <RecentThreadsSwitcherOverlay
      entries={session.entries}
      selectedIndex={session.selectedIndex}
      onSelect={commit}
    />
  );
}

function RecentThreadsSwitcherOverlay({
  entries,
  selectedIndex,
  onSelect,
}: {
  entries: ReadonlyArray<string>;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectedKey = entries[selectedIndex];
  const announcement =
    selectedKey === undefined
      ? ""
      : `${describeSwitcherEntry(selectedKey).title}, ${selectedIndex + 1} of ${entries.length}`;

  return (
    <div className="pointer-events-none fixed inset-0 z-100 flex justify-center px-4">
      {/* Focus stays in the app while switching, so the listbox's selection is
          never announced on its own. Kept outside the listbox, which may only
          contain options. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Recent threads"
        data-testid="recent-threads-switcher"
        className="dialog-glass pointer-events-auto mt-[14vh] flex h-fit max-h-[60vh] w-full max-w-md flex-col gap-0.5 overflow-y-auto rounded-2xl border p-1.5"
      >
        {entries.map((threadKey, index) => (
          <RecentThreadsSwitcherRow
            key={threadKey}
            threadKey={threadKey}
            selected={index === selectedIndex}
            onClick={() => onSelect(index)}
          />
        ))}
      </div>
    </div>
  );
}

function RecentThreadsSwitcherRow({
  threadKey,
  selected,
  onClick,
}: {
  threadKey: string;
  selected: boolean;
  onClick: () => void;
}) {
  const entry = describeSwitcherEntry(threadKey);

  // An unavailable row stays clickable: commit() refuses to navigate to it, so
  // clicking just closes the switcher, same as releasing on it.
  return (
    <button
      type="button"
      role="option"
      // Keyboard interaction is owned by the window listener; keep rows out of
      // the tab order so focus stays where the user left it.
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={entry.available ? undefined : true}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <span
        className={cn(
          "w-full truncate text-sm font-medium",
          !entry.available && "font-normal text-muted-foreground italic",
        )}
      >
        {entry.title}
      </span>
      {entry.available && entry.description.length > 0 ? (
        <span className="w-full truncate text-xs text-muted-foreground">{entry.description}</span>
      ) : null}
    </button>
  );
}
