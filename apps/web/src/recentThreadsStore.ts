/**
 * Session-scoped record of the threads the user opened, most recent first.
 * Deliberately in-memory: the recent-threads switcher cycles what was
 * visited since the app loaded, not a persisted history. Only right after a
 * reload, when that history is too short to switch between, does the
 * switcher fall back to activity order (see resolveRecentThreadSwitcherKeys).
 */
import { create } from "zustand";

export const MAX_RECENT_THREAD_KEYS = 50;

/**
 * Moves an opened thread key to the front. Returns the SAME array when
 * nothing changed so subscribers keyed on identity skip redundant updates.
 */
export function withRecentThreadKey(
  current: ReadonlyArray<string>,
  opened: string,
): ReadonlyArray<string> {
  if (current[0] === opened) return current;
  return [opened, ...current.filter((key) => key !== opened)].slice(0, MAX_RECENT_THREAD_KEYS);
}

/**
 * How many threads the activity fallback offers. Reaching further back is the
 * command palette's job; an overlay long enough to scroll stops being a
 * switcher.
 */
export const RECENT_THREADS_FALLBACK_LIMIT = 10;

export interface RecentThreadActivity {
  threadKey: string;
  /** ISO timestamp of the thread's latest activity, compared as a string. */
  activityAt: string;
}

/**
 * Thread keys the switcher offers when it opens. `liveHistory` is the visit
 * history already filtered to live, unarchived threads; `liveThreads` is every
 * live, unarchived thread. With two or more visited threads the history is
 * used as-is. Below that — right after a reload, when only the current thread
 * has been visited — the list is topped up from the other live threads by most
 * recent activity, so Ctrl+Tab has somewhere to go before a second visit.
 */
export function resolveRecentThreadSwitcherKeys(input: {
  liveHistory: ReadonlyArray<string>;
  liveThreads: ReadonlyArray<RecentThreadActivity>;
}): string[] {
  const keys = [...input.liveHistory];
  if (keys.length >= 2) return keys;
  const taken = new Set(keys);
  const fallback = input.liveThreads
    .filter((thread) => !taken.has(thread.threadKey))
    .toSorted(
      (left, right) =>
        right.activityAt.localeCompare(left.activityAt) ||
        left.threadKey.localeCompare(right.threadKey),
    );
  for (const thread of fallback) {
    if (keys.length >= RECENT_THREADS_FALLBACK_LIMIT) break;
    if (taken.has(thread.threadKey)) continue;
    taken.add(thread.threadKey);
    keys.push(thread.threadKey);
  }
  return keys;
}

interface RecentThreadsStore {
  /** Scoped thread keys in visit order, newest first. */
  recentThreadKeys: ReadonlyArray<string>;
  recordThreadVisit: (threadKey: string) => void;
}

export const useRecentThreadsStore = create<RecentThreadsStore>((set) => ({
  recentThreadKeys: [],
  recordThreadVisit: (threadKey) => {
    set((state) => {
      const next = withRecentThreadKey(state.recentThreadKeys, threadKey);
      return next === state.recentThreadKeys ? state : { recentThreadKeys: next };
    });
  },
}));
