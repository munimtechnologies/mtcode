# MT Teams

MT Code's team layer. Individuals sync their own machines through T3 Connect
(the free rails); MT Teams adds view/message-based collaboration on top:
teammates see each other's _shared_ threads' status and can send messages into
them. There is deliberately no live cross-machine access — T3's relay only
admits an environment's owner, and Sheehan accepted that boundary (2026-08-25).

Identity and data live in Sheehan's own infrastructure: **Better Auth**
(organizations plugin = teams) running inside a **Convex** deployment — the
same pattern as the Motes app. Clerk is not used. WorkOS is reserved for a
hypothetical future enterprise-SSO add-on.

## Components

- `infra/mt-teams/` — the Convex backend (Better Auth + HTTP API below).
- `apps/server/src/mtTeams/` — the environment bridge: publishes shared-thread
  status to the service and delivers inbox messages into threads (reusing the
  thread-relay delivery path, so messages carry source attribution).
- `apps/web/src/mtTeams/` — sign-in, team management, the Team sidebar
  section, and share/send UI. The web client calls the service directly over
  HTTP with the user's session token; the server bridge authenticates with a
  per-environment key.

## HTTP API (v1)

Base URL: the Convex deployment's HTTP actions origin (`https://<name>.convex.site`).
All bodies JSON. Two auth schemes:

- **User session** — `Authorization: Bearer <better-auth session token>`
  (obtained via Better Auth's standard `/api/auth/*` email+password routes).
- **Environment key** — `X-Environment-Key: <key>` (minted at registration;
  held by the environment's server, never shown to teammates).

### User-session endpoints

| Method/path                       | Body                                       | Returns                                                                                                                              |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| POST `/api/teams/create`          | `{name: string}`                           | `{teamId, name}`                                                                                                                     |
| POST `/api/teams/invite`          | `{teamId: string, email: string}`          | `{inviteId}` — records a pending invite keyed to the lowercased email; idempotent per (team,email)                                   |
| GET `/api/teams/invites?teamId=`  | —                                          | `{invites: [{inviteId, email, invitedByName, createdAt: epoch-ms number}]}` (team members only)                                      |
| POST `/api/teams/invites/revoke`  | `{inviteId: string}`                       | `{ok: true}` (team members only)                                                                                                     |
| GET `/api/invites/mine`           | —                                          | `{invites: [{inviteId, teamId, teamName, invitedByName, createdAt: epoch-ms number}]}` — pending invites for MY account email        |
| POST `/api/invites/accept`        | `{inviteId: string}`                       | `{teamId, name}` — joins the team; 403 unless the invite email matches the caller's account email                                    |
| POST `/api/invites/decline`       | `{inviteId: string}`                       | `{ok: true}`                                                                                                                         |
| POST `/api/teams/leave`           | `{teamId: string}`                         | `{ok: true}`                                                                                                                         |
| POST `/api/teams/members/remove`  | `{teamId: string, userId: string}`         | `{ok: true}` (any member may remove in v1; tighten to roles later)                                                                   |
| GET `/api/teams/me`               | —                                          | `{user: {id, name, email}, teams: [{id, name, members: [{userId, name, email}]}]}`                                                   |
| POST `/api/environments/register` | `{label}`                                  | `{environmentId, environmentKey}`                                                                                                    |
| GET `/api/environments/mine`      | —                                          | `{environments: [{environmentId, label, lastSeenAt}]}`                                                                               |
| POST `/api/threads/share`         | `{teamId, environmentId, threadId, title}` | `{sharedThreadId}`                                                                                                                   |
| POST `/api/threads/unshare`       | `{sharedThreadId}`                         | `{ok: true}`                                                                                                                         |
| GET `/api/threads/shared?teamId=` | —                                          | `{threads: [{sharedThreadId, teamId, ownerUserId, ownerName, environmentId, environmentLabel, threadId, title, status, updatedAt}]}` |
| POST `/api/messages/send`         | `{sharedThreadId, text}`                   | `{messageId}`                                                                                                                        |

### Environment-key endpoints (the server bridge)

| Method/path                | Body                                                                 | Returns                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| POST `/api/bridge/publish` | `{threads: [{threadId, title, status, updatedAt: epoch-ms number}]}` | `{sharedThreadIds: [threadId…]}` — the service updates status for its shared threads and tells the bridge which threads to keep publishing |
| GET `/api/bridge/inbox`    | —                                                                    | `{messages: [{id, threadId, fromUserName, teamName, text, createdAt}]}`                                                                    |
| POST `/api/bridge/ack`     | `{messageIds: [id…]}`                                                | `{ok: true}`                                                                                                                               |

`status` is one of `"working" | "input-needed" | "done" | "idle"` (the bridge
maps the projection's thread state).

## Fork RPCs (client ↔ its own server)

Two WebSocket methods (contracts `WS_METHODS`):

- `mtTeamsConfigure` — `{serviceUrl, environmentKey}` (empty strings clear).
  Persists in server settings; the bridge starts/stops accordingly.
- `mtTeamsStatus` — `{}` → `{configured, serviceUrl, lastPublishAt, lastError}`.

Invite codes are retired (2026-08-25 UX decision): membership flows through
email invites tied to Better Auth account emails. No email is SENT in v1 —
the invite simply appears in the invitee's MT Teams panel when they sign in
with that email (email delivery via a provider like Resend is a later add).
The service URL is never shown in the UI: builds bake it (`VITE_MT_TEAMS_URL`)
and it just works.

## Flow

1. User signs in in Settings → MT Teams (its own top-level panel), creates a
   team, and invites teammates by email.
2. UI registers the current environment → gets `environmentKey` → hands it to
   the environment's server via `mtTeamsConfigure`.
3. User shares a thread from the Team panel; the service records it.
4. The bridge polls every 60s: publishes status for the service's shared list,
   drains the inbox, and delivers messages into threads through the
   thread-relay path (they appear as attributed user messages).
5. Teammates' clients poll `/api/threads/shared` (30s) for the Team sidebar
   section and send messages with `/api/messages/send`.
