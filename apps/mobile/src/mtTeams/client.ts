/**
 * MT Teams HTTP client for mobile: typed fetch wrapper for the MT Teams
 * service (docs/internals/mt-teams.md) plus Better Auth email/password
 * session management, ported from apps/web/src/mtTeams/client.ts. All
 * user-session endpoints authenticate with
 * `Authorization: Bearer <session token>`.
 *
 * The service origin is baked into the build (`extra.mtTeams.url` in
 * app.config.ts) and never shown in the UI; membership flows through email
 * invites (invite codes are retired, 2026-08-25). Phones are clients, not
 * environments, so the environment-bridge and thread-share endpoints have no
 * mobile counterpart here.
 *
 * Session persistence uses expo-secure-store (the voice-dictation settings
 * idiom) under `mtcode.mt-teams`; only the session survives restarts — the
 * service URL always comes from the build so a stale origin can never shadow
 * it.
 */
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export type MtTeamsThreadStatus = "working" | "input-needed" | "done" | "idle";

export interface MtTeamsUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface MtTeamsMember {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

export interface MtTeamsTeam {
  readonly id: string;
  readonly name: string;
  readonly members: ReadonlyArray<MtTeamsMember>;
}

export interface MtTeamsMe {
  readonly user: MtTeamsUser;
  readonly teams: ReadonlyArray<MtTeamsTeam>;
}

/** A pending invite on a team the caller belongs to (`/api/teams/invites`). */
export interface MtTeamsTeamInvite {
  readonly inviteId: string;
  readonly email: string;
  readonly invitedByName: string;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

/** A pending invite addressed to the caller's account email (`/api/invites/mine`). */
export interface MtTeamsIncomingInvite {
  readonly inviteId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly invitedByName: string;
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

export interface MtTeamsSharedThread {
  readonly sharedThreadId: string;
  readonly teamId: string;
  readonly ownerUserId: string;
  readonly ownerName: string;
  readonly environmentId: string;
  readonly environmentLabel: string;
  readonly threadId: string;
  readonly title: string;
  readonly status: MtTeamsThreadStatus;
  readonly updatedAt: string;
}

export interface MtTeamsStoredSession {
  readonly serviceUrl: string;
  readonly sessionToken: string;
  readonly userName: string;
}

export const MT_TEAMS_STORAGE_KEY = "mtcode.mt-teams";

/** The baked service origin. Empty in builds without MT Teams (e.g. dev). */
export function defaultServiceUrl(): string {
  const extra = Constants.expoConfig?.extra as
    | { readonly mtTeams?: { readonly url?: unknown } }
    | undefined;
  const fromConfig = extra?.mtTeams?.url;
  return typeof fromConfig === "string" ? fromConfig.trim() : "";
}

/** Join a service origin and an API path without doubling slashes. */
export function buildMtTeamsUrl(serviceUrl: string, path: string): string {
  const base = serviceUrl.trim().replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function mtTeamsAuthHeaders(sessionToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sessionToken}`,
  };
}

/**
 * Parse a stored session record. Only the session token and user name are
 * trusted from storage; the service URL is re-derived from the build.
 */
export function parseStoredSessionValue(raw: string): MtTeamsStoredSession | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.sessionToken !== "string" || record.sessionToken.length === 0) {
      return null;
    }
    return {
      serviceUrl: defaultServiceUrl(),
      sessionToken: record.sessionToken,
      userName: typeof record.userName === "string" ? record.userName : "",
    };
  } catch {
    return null;
  }
}

export async function loadStoredSession(): Promise<MtTeamsStoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(MT_TEAMS_STORAGE_KEY);
    if (!raw) return null;
    return parseStoredSessionValue(raw);
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: MtTeamsStoredSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      MT_TEAMS_STORAGE_KEY,
      JSON.stringify({ sessionToken: session.sessionToken, userName: session.userName }),
    );
  } catch {
    // Storage unavailable; the session just won't survive a restart.
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(MT_TEAMS_STORAGE_KEY);
  } catch {
    // Ignore storage errors on cleanup.
  }
}

export class MtTeamsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MtTeamsApiError";
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record.message === "string") return record.message;
      if (typeof record.error === "string") return record.error;
    }
  } catch {
    // Non-JSON error body.
  }
  return `MT Teams request failed (${response.status})`;
}

async function requestJson<T>(
  serviceUrl: string,
  path: string,
  init: {
    readonly method: "GET" | "POST";
    readonly sessionToken?: string;
    readonly body?: unknown;
  },
): Promise<{ data: T; response: Response }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.sessionToken) headers.Authorization = `Bearer ${init.sessionToken}`;
  const response = await fetch(buildMtTeamsUrl(serviceUrl, path), {
    method: init.method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    throw new MtTeamsApiError(response.status, await readErrorMessage(response));
  }
  const data = (await response.json().catch(() => ({}))) as T;
  return { data, response };
}

/** Extract the session token per better-auth's bearer plugin: header first, body fallback. */
export function extractSessionToken(response: Response, body: unknown): string | null {
  const headerToken = response.headers.get("set-auth-token");
  if (headerToken && headerToken.length > 0) return headerToken;
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.token === "string" && record.token.length > 0) return record.token;
  }
  return null;
}

interface AuthResponseBody {
  readonly token?: string;
  readonly user?: { readonly name?: string; readonly email?: string };
}

async function authenticate(
  serviceUrl: string,
  path: string,
  body: Record<string, string>,
): Promise<MtTeamsStoredSession> {
  const { data, response } = await requestJson<AuthResponseBody>(serviceUrl, path, {
    method: "POST",
    body,
  });
  const sessionToken = extractSessionToken(response, data);
  if (!sessionToken) {
    throw new MtTeamsApiError(response.status, "Signed in, but no session token was returned");
  }
  return {
    serviceUrl,
    sessionToken,
    userName: data.user?.name ?? data.user?.email ?? body.email ?? "",
  };
}

export function signUp(input: {
  readonly serviceUrl: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
}): Promise<MtTeamsStoredSession> {
  return authenticate(input.serviceUrl, "/api/auth/sign-up/email", {
    name: input.name,
    email: input.email,
    password: input.password,
  });
}

export function signIn(input: {
  readonly serviceUrl: string;
  readonly email: string;
  readonly password: string;
}): Promise<MtTeamsStoredSession> {
  return authenticate(input.serviceUrl, "/api/auth/sign-in/email", {
    email: input.email,
    password: input.password,
  });
}

export async function signOut(session: MtTeamsStoredSession): Promise<void> {
  try {
    await requestJson<{ success?: boolean }>(session.serviceUrl, "/api/auth/sign-out", {
      method: "POST",
      sessionToken: session.sessionToken,
      body: {},
    });
  } catch {
    // Best effort: the local session is cleared regardless.
  }
}

export function fetchMe(session: MtTeamsStoredSession): Promise<MtTeamsMe> {
  return requestJson<MtTeamsMe>(session.serviceUrl, "/api/teams/me", {
    method: "GET",
    sessionToken: session.sessionToken,
  }).then((result) => result.data);
}

export function createTeam(
  session: MtTeamsStoredSession,
  input: { readonly name: string },
): Promise<{ teamId: string; name: string }> {
  return requestJson<{ teamId: string; name: string }>(session.serviceUrl, "/api/teams/create", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}

export function inviteToTeam(
  session: MtTeamsStoredSession,
  input: { readonly teamId: string; readonly email: string },
): Promise<{ inviteId: string }> {
  return requestJson<{ inviteId: string }>(session.serviceUrl, "/api/teams/invite", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}

export function fetchTeamInvites(
  session: MtTeamsStoredSession,
  input: { readonly teamId: string },
): Promise<{ invites: ReadonlyArray<MtTeamsTeamInvite> }> {
  return requestJson<{ invites: ReadonlyArray<MtTeamsTeamInvite> }>(
    session.serviceUrl,
    `/api/teams/invites?teamId=${encodeURIComponent(input.teamId)}`,
    { method: "GET", sessionToken: session.sessionToken },
  ).then((result) => result.data);
}

export function revokeInvite(
  session: MtTeamsStoredSession,
  input: { readonly inviteId: string },
): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(session.serviceUrl, "/api/teams/invites/revoke", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}

export function fetchMyInvites(
  session: MtTeamsStoredSession,
): Promise<{ invites: ReadonlyArray<MtTeamsIncomingInvite> }> {
  return requestJson<{ invites: ReadonlyArray<MtTeamsIncomingInvite> }>(
    session.serviceUrl,
    "/api/invites/mine",
    { method: "GET", sessionToken: session.sessionToken },
  ).then((result) => result.data);
}

export function acceptInvite(
  session: MtTeamsStoredSession,
  input: { readonly inviteId: string },
): Promise<{ teamId: string; name: string }> {
  return requestJson<{ teamId: string; name: string }>(session.serviceUrl, "/api/invites/accept", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}

export function declineInvite(
  session: MtTeamsStoredSession,
  input: { readonly inviteId: string },
): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(session.serviceUrl, "/api/invites/decline", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}

export function leaveTeam(
  session: MtTeamsStoredSession,
  input: { readonly teamId: string },
): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(session.serviceUrl, "/api/teams/leave", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}

export function removeTeamMember(
  session: MtTeamsStoredSession,
  input: { readonly teamId: string; readonly userId: string },
): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(session.serviceUrl, "/api/teams/members/remove", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}

export function fetchSharedThreads(
  session: MtTeamsStoredSession,
  input: { readonly teamId: string },
): Promise<{ threads: ReadonlyArray<MtTeamsSharedThread> }> {
  return requestJson<{ threads: ReadonlyArray<MtTeamsSharedThread> }>(
    session.serviceUrl,
    `/api/threads/shared?teamId=${encodeURIComponent(input.teamId)}`,
    { method: "GET", sessionToken: session.sessionToken },
  ).then((result) => result.data);
}

export function sendMessage(
  session: MtTeamsStoredSession,
  input: { readonly sharedThreadId: string; readonly text: string },
): Promise<{ messageId: string }> {
  return requestJson<{ messageId: string }>(session.serviceUrl, "/api/messages/send", {
    method: "POST",
    sessionToken: session.sessionToken,
    body: input,
  }).then((result) => result.data);
}
