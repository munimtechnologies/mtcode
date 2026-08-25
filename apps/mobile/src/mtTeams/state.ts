/**
 * MT Teams client state for mobile: one module-level store consumed through
 * `useSyncExternalStore` (the voiceTranscriptionSettings idiom — mobile has
 * no zustand) holding the session, `/api/teams/me`, the caller's pending
 * invites (`/api/invites/mine`), each team's outstanding invites, and the
 * merged shared-thread list. `useMtTeamsSync()` refcounts mounted consumers
 * and drives the 30s poll while a user is signed in
 * (docs/internals/mt-teams.md, flow step 5).
 *
 * The service URL is never state: it is baked into the build
 * (`extra.mtTeams.url`) and read through `defaultServiceUrl()`. The stored
 * session hydrates asynchronously from expo-secure-store on first use.
 */
import { useEffect, useSyncExternalStore } from "react";

import {
  clearStoredSession,
  defaultServiceUrl,
  fetchMe,
  fetchMyInvites,
  fetchSharedThreads,
  fetchTeamInvites,
  loadStoredSession,
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
const EMPTY_MY_INVITES: ReadonlyArray<MtTeamsIncomingInvite> = Object.freeze([]);
const EMPTY_TEAM_INVITES: Readonly<Record<string, ReadonlyArray<MtTeamsTeamInvite>>> =
  Object.freeze({});

export interface MtTeamsSnapshot {
  readonly sessionToken: string;
  readonly userName: string;
  /** True once the stored session has been read from the secure store. */
  readonly sessionLoaded: boolean;
  readonly me: MtTeamsMe | null;
  /** Pending invites addressed to the signed-in account's email. */
  readonly myInvites: ReadonlyArray<MtTeamsIncomingInvite>;
  /** Outstanding invites per team the user belongs to, keyed by team id. */
  readonly teamInvites: Readonly<Record<string, ReadonlyArray<MtTeamsTeamInvite>>>;
  readonly sharedThreads: ReadonlyArray<MtTeamsSharedThread>;
  readonly authPending: boolean;
  readonly authError: string | null;
  readonly syncError: string | null;
}

let snapshot: MtTeamsSnapshot = {
  sessionToken: "",
  userName: "",
  sessionLoaded: false,
  me: null,
  myInvites: EMPTY_MY_INVITES,
  teamInvites: EMPTY_TEAM_INVITES,
  sharedThreads: EMPTY_THREADS,
  authPending: false,
  authError: null,
  syncError: null,
};

const listeners = new Set<() => void>();

function publish(patch: Partial<MtTeamsSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMtTeamsSnapshot(): MtTeamsSnapshot {
  return snapshot;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The MT Teams request failed.";
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
  return {
    serviceUrl: defaultServiceUrl(),
    sessionToken: snapshot.sessionToken,
    userName: snapshot.userName,
  };
}

let hydratePromise: Promise<void> | null = null;

/** Load the stored session once; refreshes data when a session was found. */
function hydrateStoredSession(): Promise<void> {
  if (snapshot.sessionLoaded) return Promise.resolve();
  if (hydratePromise) return hydratePromise;
  hydratePromise = loadStoredSession()
    .then((stored) => {
      if (snapshot.sessionLoaded) return;
      publish({
        sessionLoaded: true,
        // A sign-in that races hydration wins: never clobber a live token.
        ...(snapshot.sessionToken.length === 0 && stored !== null
          ? { sessionToken: stored.sessionToken, userName: stored.userName }
          : {}),
      });
    })
    .finally(() => {
      hydratePromise = null;
    });
  return hydratePromise;
}

export async function mtTeamsSignIn(email: string, password: string): Promise<boolean> {
  const serviceUrl = defaultServiceUrl();
  if (serviceUrl.length === 0) {
    publish({ authError: "Team service not configured in this build." });
    return false;
  }
  publish({ authPending: true, authError: null });
  try {
    const session = await signIn({ serviceUrl, email, password });
    await saveStoredSession(session);
    publish({
      sessionToken: session.sessionToken,
      userName: session.userName,
      sessionLoaded: true,
      authPending: false,
    });
    void refreshMtTeamsMe();
    return true;
  } catch (error) {
    publish({ authPending: false, authError: errorMessage(error) });
    return false;
  }
}

export async function mtTeamsSignUp(
  name: string,
  email: string,
  password: string,
): Promise<boolean> {
  const serviceUrl = defaultServiceUrl();
  if (serviceUrl.length === 0) {
    publish({ authError: "Team service not configured in this build." });
    return false;
  }
  publish({ authPending: true, authError: null });
  try {
    const session = await signUp({ serviceUrl, name, email, password });
    await saveStoredSession(session);
    publish({
      sessionToken: session.sessionToken,
      userName: session.userName,
      sessionLoaded: true,
      authPending: false,
    });
    void refreshMtTeamsMe();
    return true;
  } catch (error) {
    publish({ authPending: false, authError: errorMessage(error) });
    return false;
  }
}

export async function mtTeamsSignOut(): Promise<void> {
  const session = getMtTeamsSession();
  publish({
    sessionToken: "",
    userName: "",
    me: null,
    myInvites: EMPTY_MY_INVITES,
    teamInvites: EMPTY_TEAM_INVITES,
    sharedThreads: EMPTY_THREADS,
    authError: null,
    syncError: null,
  });
  await clearStoredSession();
  if (isMtTeamsSignedIn(session)) await signOut(session);
}

export async function refreshMtTeamsMe(): Promise<void> {
  if (!isMtTeamsSignedIn(snapshot)) return;
  const session = getMtTeamsSession();
  try {
    const [me, invites] = await Promise.all([fetchMe(session), fetchMyInvites(session)]);
    publish({ me, myInvites: invites.invites, syncError: null });
    await Promise.all([refreshMtTeamsSharedThreads(), refreshMtTeamsTeamInvites()]);
  } catch (error) {
    publish({ syncError: errorMessage(error) });
  }
}

export async function refreshMtTeamsSharedThreads(): Promise<void> {
  if (!isMtTeamsSignedIn(snapshot)) return;
  const teams = snapshot.me?.teams ?? [];
  if (teams.length === 0) {
    if (snapshot.sharedThreads.length > 0) publish({ sharedThreads: EMPTY_THREADS });
    return;
  }
  const session = getMtTeamsSession();
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
    publish({ sharedThreads: merged, syncError: null });
  } catch (error) {
    publish({ syncError: errorMessage(error) });
  }
}

export async function refreshMtTeamsTeamInvites(): Promise<void> {
  if (!isMtTeamsSignedIn(snapshot)) return;
  const teams = snapshot.me?.teams ?? [];
  if (teams.length === 0) {
    if (Object.keys(snapshot.teamInvites).length > 0) publish({ teamInvites: EMPTY_TEAM_INVITES });
    return;
  }
  const session = getMtTeamsSession();
  try {
    const results = await Promise.all(
      teams.map(async (team) => {
        const result = await fetchTeamInvites(session, { teamId: team.id });
        return [team.id, result.invites] as const;
      }),
    );
    publish({ teamInvites: Object.fromEntries(results), syncError: null });
  } catch (error) {
    publish({ syncError: errorMessage(error) });
  }
}

/** Read from the store. Selectors must return stable references (store fields). */
export function useMtTeamsSelector<T>(selector: (state: MtTeamsSnapshot) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(snapshot),
    () => selector(snapshot),
  );
}

let syncConsumers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollTick(): void {
  if (!isMtTeamsSignedIn(snapshot)) return;
  // One refresh covers membership, invites/mine, shared threads, and each
  // team's outstanding invites, so accepted invites and new teammates appear
  // without reopening the screen.
  void refreshMtTeamsMe();
}

/**
 * Keeps MT Teams data fresh while any consumer (Team shelf or the settings
 * screen) is mounted: hydrates the stored session, refreshes on mount, and
 * polls every 30s while signed in.
 */
export function useMtTeamsSync(): void {
  useEffect(() => {
    syncConsumers += 1;
    if (syncConsumers === 1) {
      void hydrateStoredSession().then(() => {
        if (snapshot.sessionLoaded && isMtTeamsSignedIn(snapshot)) void refreshMtTeamsMe();
      });
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
