/**
 * MT Teams client state: one module-level zustand store (the fork's pattern
 * for cross-component state, see threadSelectionStore) holding the session,
 * `/api/teams/me`, and the merged shared-thread list. `useMtTeamsSync()`
 * refcounts mounted consumers and drives the 30s shared-thread poll while a
 * user is signed in (docs/internals/mt-teams.md, flow step 5).
 */
import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";

import {
  clearStoredSession,
  createTeam,
  defaultServiceUrl,
  fetchMe,
  fetchMyEnvironments,
  fetchSharedThreads,
  joinTeam,
  loadStoredSession,
  type MtTeamsEnvironment,
  type MtTeamsMe,
  type MtTeamsSharedThread,
  type MtTeamsStoredSession,
  saveStoredSession,
  signIn,
  signOut,
  signUp,
} from "./client";

export const MT_TEAMS_POLL_INTERVAL_MS = 30_000;

const EMPTY_THREADS: ReadonlyArray<MtTeamsSharedThread> = Object.freeze([]);
const EMPTY_ENVIRONMENTS: ReadonlyArray<MtTeamsEnvironment> = Object.freeze([]);

interface MtTeamsStore {
  readonly serviceUrl: string;
  readonly sessionToken: string;
  readonly userName: string;
  readonly me: MtTeamsMe | null;
  readonly environments: ReadonlyArray<MtTeamsEnvironment>;
  readonly sharedThreads: ReadonlyArray<MtTeamsSharedThread>;
  readonly authPending: boolean;
  readonly authError: string | null;
  readonly syncError: string | null;

  setServiceUrl: (serviceUrl: string) => void;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (name: string, email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshSharedThreads: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The MT Teams request failed.";
}

function currentSession(state: {
  readonly serviceUrl: string;
  readonly sessionToken: string;
  readonly userName: string;
}): MtTeamsStoredSession {
  return {
    serviceUrl: state.serviceUrl.trim(),
    sessionToken: state.sessionToken,
    userName: state.userName,
  };
}

export function isMtTeamsSignedIn(state: { readonly sessionToken: string }): boolean {
  return state.sessionToken.length > 0;
}

/** Snapshot of the signed-in session for one-off client calls in event handlers. */
export function getMtTeamsSession(): MtTeamsStoredSession {
  return currentSession(useMtTeamsStore.getState());
}

const storedSession = loadStoredSession();

export const useMtTeamsStore = create<MtTeamsStore>((set, get) => ({
  serviceUrl: storedSession?.serviceUrl ?? defaultServiceUrl(),
  sessionToken: storedSession?.sessionToken ?? "",
  userName: storedSession?.userName ?? "",
  me: null,
  environments: EMPTY_ENVIRONMENTS,
  sharedThreads: EMPTY_THREADS,
  authPending: false,
  authError: null,
  syncError: null,

  setServiceUrl: (serviceUrl) => {
    set({ serviceUrl });
    // Persist the URL even while signed out so the Settings field survives a
    // reload; an empty token in the stored record means "signed out".
    saveStoredSession(currentSession({ ...get(), serviceUrl }));
  },

  signIn: async (email, password) => {
    const serviceUrl = get().serviceUrl.trim();
    if (serviceUrl.length === 0) {
      set({ authError: "Enter the MT Teams service URL first." });
      return false;
    }
    set({ authPending: true, authError: null });
    try {
      const session = await signIn({ serviceUrl, email, password });
      saveStoredSession(session);
      set({
        sessionToken: session.sessionToken,
        userName: session.userName,
        authPending: false,
      });
      void get().refreshMe();
      return true;
    } catch (error) {
      set({ authPending: false, authError: errorMessage(error) });
      return false;
    }
  },

  signUp: async (name, email, password) => {
    const serviceUrl = get().serviceUrl.trim();
    if (serviceUrl.length === 0) {
      set({ authError: "Enter the MT Teams service URL first." });
      return false;
    }
    set({ authPending: true, authError: null });
    try {
      const session = await signUp({ serviceUrl, name, email, password });
      saveStoredSession(session);
      set({
        sessionToken: session.sessionToken,
        userName: session.userName,
        authPending: false,
      });
      void get().refreshMe();
      return true;
    } catch (error) {
      set({ authPending: false, authError: errorMessage(error) });
      return false;
    }
  },

  signOut: async () => {
    const state = get();
    const session = currentSession(state);
    set({
      sessionToken: "",
      userName: "",
      me: null,
      environments: EMPTY_ENVIRONMENTS,
      sharedThreads: EMPTY_THREADS,
      authError: null,
      syncError: null,
    });
    clearStoredSession();
    // Keep the service URL for the next sign-in.
    saveStoredSession({ serviceUrl: state.serviceUrl, sessionToken: "", userName: "" });
    if (isMtTeamsSignedIn(session)) await signOut(session);
  },

  refreshMe: async () => {
    const state = get();
    if (!isMtTeamsSignedIn(state)) return;
    const session = currentSession(state);
    try {
      const [me, mine] = await Promise.all([fetchMe(session), fetchMyEnvironments(session)]);
      set({ me, environments: mine.environments, syncError: null });
      await get().refreshSharedThreads();
    } catch (error) {
      set({ syncError: errorMessage(error) });
    }
  },

  refreshSharedThreads: async () => {
    const state = get();
    if (!isMtTeamsSignedIn(state)) return;
    const teams = state.me?.teams ?? [];
    if (teams.length === 0) {
      if (state.sharedThreads.length > 0) set({ sharedThreads: EMPTY_THREADS });
      return;
    }
    const session = currentSession(state);
    try {
      const results = await Promise.all(
        teams.map((team) => fetchSharedThreads(session, { teamId: team.id })),
      );
      const byId = new Map<string, MtTeamsSharedThread>();
      for (const result of results) {
        for (const thread of result.threads) byId.set(thread.sharedThreadId, thread);
      }
      const merged = [...byId.values()].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
      set({ sharedThreads: merged, syncError: null });
    } catch (error) {
      set({ syncError: errorMessage(error) });
    }
  },
}));

/**
 * Read from the store with `useSyncExternalStore`. Unlike zustand's own hook
 * (whose server snapshot is the store's *initial* state), the server snapshot
 * here reads the live state, so static/server renders see the same data as
 * the client. Selectors must return stable references (store fields).
 */
export function useMtTeamsSelector<T>(selector: (state: MtTeamsStore) => T): T {
  return useSyncExternalStore(
    useMtTeamsStore.subscribe,
    () => selector(useMtTeamsStore.getState()),
    () => selector(useMtTeamsStore.getState()),
  );
}

let syncConsumers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollTick(): void {
  const state = useMtTeamsStore.getState();
  if (!isMtTeamsSignedIn(state)) return;
  // Re-pull membership when it never loaded (e.g. the app started offline).
  if (state.me === null) {
    void state.refreshMe();
    return;
  }
  void state.refreshSharedThreads();
}

/**
 * Keeps MT Teams data fresh while any consumer (sidebar section, settings
 * panel) is mounted: `/api/teams/me` on mount, shared threads every 30s.
 */
export function useMtTeamsSync(): void {
  useEffect(() => {
    syncConsumers += 1;
    if (syncConsumers === 1) {
      const state = useMtTeamsStore.getState();
      if (isMtTeamsSignedIn(state)) void state.refreshMe();
      pollTimer = setInterval(pollTick, MT_TEAMS_POLL_INTERVAL_MS);
    }
    return () => {
      syncConsumers -= 1;
      if (syncConsumers === 0 && pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, []);
}
