/**
 * MT Teams client state: one module-level zustand store (the fork's pattern
 * for cross-component state, see threadSelectionStore) holding the session,
 * `/api/teams/me`, the caller's pending invites (`/api/invites/mine`), each
 * team's outstanding invites, and the merged shared-thread list.
 * `useMtTeamsSync()` refcounts mounted consumers and drives the 30s poll
 * (teams/me + invites/mine + shared threads) while a user is signed in
 * (docs/internals/mt-teams.md, flow step 5).
 *
 * The service URL is never state: it is baked into the build
 * (`VITE_MT_TEAMS_URL`) and read through `defaultServiceUrl()`.
 */
import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";

import {
  clearStoredSession,
  defaultServiceUrl,
  fetchMe,
  fetchMyEnvironments,
  fetchMyInvites,
  fetchSharedThreads,
  fetchTeamInvites,
  loadStoredSession,
  type MtTeamsEnvironment,
  type MtTeamsIncomingInvite,
  type MtTeamsMe,
  type MtTeamsSharedThread,
  type MtTeamsStoredSession,
  type MtTeamsTeamInvite,
  saveStoredSession,
  signIn,
  signOut,
  signUp,
} from "./client";

export const MT_TEAMS_POLL_INTERVAL_MS = 30_000;

const EMPTY_THREADS: ReadonlyArray<MtTeamsSharedThread> = Object.freeze([]);
const EMPTY_ENVIRONMENTS: ReadonlyArray<MtTeamsEnvironment> = Object.freeze([]);
const EMPTY_MY_INVITES: ReadonlyArray<MtTeamsIncomingInvite> = Object.freeze([]);
const EMPTY_TEAM_INVITES: Readonly<Record<string, ReadonlyArray<MtTeamsTeamInvite>>> =
  Object.freeze({});

interface MtTeamsStore {
  readonly sessionToken: string;
  readonly userName: string;
  readonly me: MtTeamsMe | null;
  /** Pending invites addressed to the signed-in account's email. */
  readonly myInvites: ReadonlyArray<MtTeamsIncomingInvite>;
  /** Outstanding invites per team the user belongs to, keyed by team id. */
  readonly teamInvites: Readonly<Record<string, ReadonlyArray<MtTeamsTeamInvite>>>;
  readonly environments: ReadonlyArray<MtTeamsEnvironment>;
  readonly sharedThreads: ReadonlyArray<MtTeamsSharedThread>;
  readonly authPending: boolean;
  readonly authError: string | null;
  readonly syncError: string | null;

  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (name: string, email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshSharedThreads: () => Promise<void>;
  refreshTeamInvites: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The MT Teams request failed.";
}

function currentSession(state: {
  readonly sessionToken: string;
  readonly userName: string;
}): MtTeamsStoredSession {
  return {
    serviceUrl: defaultServiceUrl(),
    sessionToken: state.sessionToken,
    userName: state.userName,
  };
}

export function isMtTeamsSignedIn(state: { readonly sessionToken: string }): boolean {
  return state.sessionToken.length > 0;
}

/** Whether this build carries a team service origin at all. */
export function isMtTeamsConfigured(): boolean {
  return defaultServiceUrl().length > 0;
}

/** Snapshot of the signed-in session for one-off client calls in event handlers. */
export function getMtTeamsSession(): MtTeamsStoredSession {
  return currentSession(useMtTeamsStore.getState());
}

const storedSession = loadStoredSession();

export const useMtTeamsStore = create<MtTeamsStore>((set, get) => ({
  sessionToken: storedSession?.sessionToken ?? "",
  userName: storedSession?.userName ?? "",
  me: null,
  myInvites: EMPTY_MY_INVITES,
  teamInvites: EMPTY_TEAM_INVITES,
  environments: EMPTY_ENVIRONMENTS,
  sharedThreads: EMPTY_THREADS,
  authPending: false,
  authError: null,
  syncError: null,

  signIn: async (email, password) => {
    const serviceUrl = defaultServiceUrl();
    if (serviceUrl.length === 0) {
      set({ authError: "Team service not configured in this build." });
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
    const serviceUrl = defaultServiceUrl();
    if (serviceUrl.length === 0) {
      set({ authError: "Team service not configured in this build." });
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
    const session = currentSession(get());
    set({
      sessionToken: "",
      userName: "",
      me: null,
      myInvites: EMPTY_MY_INVITES,
      teamInvites: EMPTY_TEAM_INVITES,
      environments: EMPTY_ENVIRONMENTS,
      sharedThreads: EMPTY_THREADS,
      authError: null,
      syncError: null,
    });
    clearStoredSession();
    if (isMtTeamsSignedIn(session)) await signOut(session);
  },

  refreshMe: async () => {
    const state = get();
    if (!isMtTeamsSignedIn(state)) return;
    const session = currentSession(state);
    try {
      const [me, mine, invites] = await Promise.all([
        fetchMe(session),
        fetchMyEnvironments(session),
        fetchMyInvites(session),
      ]);
      set({ me, environments: mine.environments, myInvites: invites.invites, syncError: null });
      await Promise.all([get().refreshSharedThreads(), get().refreshTeamInvites()]);
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

  refreshTeamInvites: async () => {
    const state = get();
    if (!isMtTeamsSignedIn(state)) return;
    const teams = state.me?.teams ?? [];
    if (teams.length === 0) {
      if (Object.keys(state.teamInvites).length > 0) set({ teamInvites: EMPTY_TEAM_INVITES });
      return;
    }
    const session = currentSession(state);
    try {
      const results = await Promise.all(
        teams.map(async (team) => {
          const result = await fetchTeamInvites(session, { teamId: team.id });
          return [team.id, result.invites] as const;
        }),
      );
      set({ teamInvites: Object.fromEntries(results), syncError: null });
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
  // One refresh covers membership, invites/mine, shared threads, and each
  // team's outstanding invites, so accepted invites and new teammates appear
  // without a reload.
  void state.refreshMe();
}

/**
 * Keeps MT Teams data fresh while any consumer (sidebar section, settings
 * panel or nav badge) is mounted: `/api/teams/me` + `/api/invites/mine` on
 * mount and every 30s alongside shared threads.
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
