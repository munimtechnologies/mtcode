import { httpRouter } from "convex/server";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: { allowedOrigins: ["*"] } });

// -- Helpers ----------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Environment-Key",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function error(status: number, message: string): Response {
  return json(status, { error: message });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function randomCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type HttpCtx = Parameters<Parameters<typeof httpAction>[0]>[0];

type SessionUser = { id: string; name: string; email: string };

async function getSessionUser(ctx: HttpCtx, request: Request): Promise<SessionUser | null> {
  const auth = createAuth(ctx);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

async function getEnvironmentByKey(
  ctx: HttpCtx,
  request: Request,
): Promise<Doc<"environments"> | null> {
  const key = request.headers.get("x-environment-key");
  if (!key) return null;
  const keyHash = await sha256Hex(key);
  return await ctx.runMutation(internal.data.touchEnvironmentByKeyHash, { keyHash });
}

function getMembership(ctx: HttpCtx, teamId: string, userId: string) {
  return ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "member",
    where: [
      { field: "organizationId", value: teamId },
      { field: "userId", value: userId },
    ],
  });
}

function getOrganization(ctx: HttpCtx, teamId: string) {
  return ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "organization",
    where: [{ field: "_id", value: teamId }],
  });
}

function getAuthUserById(ctx: HttpCtx, userId: string) {
  return ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: userId }],
  });
}

function getAuthUserByEmail(ctx: HttpCtx, email: string) {
  return ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", value: email }],
  });
}

function removeMembership(ctx: HttpCtx, teamId: string, userId: string) {
  return ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: {
      model: "member",
      where: [
        { field: "organizationId", value: teamId },
        { field: "userId", value: userId },
      ],
    },
  });
}

/** The caller's account email, normalized the same way invites are stored. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function listByField(
  ctx: HttpCtx,
  model: "member",
  field: "userId" | "organizationId",
  value: string,
): Promise<Array<Record<string, any>>> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model,
    where: [{ field, value }],
    paginationOpts: { numItems: 200, cursor: null },
  });
  return result.page;
}

/** Register an endpoint plus its CORS preflight twin. */
function route(
  path: string,
  method: "GET" | "POST",
  handler: (ctx: HttpCtx, request: Request) => Promise<Response>,
) {
  http.route({
    path,
    method,
    handler: httpAction(async (ctx, request) => {
      try {
        return await handler(ctx, request);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return error(400, message);
      }
    }),
  });
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })),
  });
}

// -- Teams ------------------------------------------------------------------

route("/api/teams/create", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { name } = await readBody(request);
  if (typeof name !== "string" || name.trim() === "") return error(400, "name is required");

  const auth = createAuth(ctx);
  const slugBase =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "team";
  const organization = await auth.api.createOrganization({
    body: { name: name.trim(), slug: `${slugBase}-${randomCode(6).toLowerCase()}` },
    headers: request.headers,
  });
  if (!organization) return error(500, "Failed to create team");

  return json(200, { teamId: organization.id, name: organization.name });
});

// Invite codes are retired (2026-08-25); kept only so older clients get a
// clear 410 instead of a router 404.
route("/api/teams/join", "POST", async () => {
  return error(410, "invite codes are retired");
});

// -- Email invites ----------------------------------------------------------

route("/api/teams/invite", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { teamId, email } = await readBody(request);
  if (typeof teamId !== "string" || typeof email !== "string" || email.trim() === "") {
    return error(400, "teamId and email are required");
  }

  const membership = await getMembership(ctx, teamId, user.id);
  if (!membership) return error(403, "Not a member of this team");

  const invitedEmail = normalizeEmail(email);
  const invitedUser = await getAuthUserByEmail(ctx, invitedEmail);
  if (invitedUser) {
    const invitedMembership = await getMembership(ctx, teamId, invitedUser._id as string);
    if (invitedMembership) {
      return error(409, `${invitedEmail} is already a member of this team`);
    }
  }

  const inviteId = await ctx.runMutation(internal.data.createEmailInvite, {
    teamId,
    email: invitedEmail,
    invitedByUserId: user.id,
  });
  return json(200, { inviteId });
});

route("/api/teams/invites", "GET", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const teamId = new URL(request.url).searchParams.get("teamId");
  if (!teamId) return error(400, "teamId is required");

  const membership = await getMembership(ctx, teamId, user.id);
  if (!membership) return error(403, "Not a member of this team");

  const pending = await ctx.runQuery(internal.data.listEmailInvitesByTeam, { teamId });
  const invites = [];
  for (const invite of pending) {
    const invitedBy = await getAuthUserById(ctx, invite.invitedByUserId);
    invites.push({
      inviteId: invite._id,
      email: invite.email,
      invitedByName: invitedBy?.name ?? "",
      createdAt: invite.createdAt,
    });
  }
  return json(200, { invites });
});

route("/api/teams/invites/revoke", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { inviteId } = await readBody(request);
  if (typeof inviteId !== "string") return error(400, "inviteId is required");

  const invite = await ctx.runQuery(internal.data.getEmailInvite, {
    inviteId: inviteId as Id<"teamEmailInvites">,
  });
  if (!invite) return error(404, "Invite not found");
  const membership = await getMembership(ctx, invite.teamId, user.id);
  if (!membership) return error(403, "Not a member of this team");

  await ctx.runMutation(internal.data.deleteEmailInvite, { inviteId: invite._id });
  return json(200, { ok: true });
});

route("/api/invites/mine", "GET", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");

  const pending = await ctx.runQuery(internal.data.listEmailInvitesByEmail, {
    email: normalizeEmail(user.email),
  });
  const invites = [];
  for (const invite of pending) {
    const organization = await getOrganization(ctx, invite.teamId);
    const invitedBy = await getAuthUserById(ctx, invite.invitedByUserId);
    invites.push({
      inviteId: invite._id,
      teamId: invite.teamId,
      teamName: organization?.name ?? "",
      invitedByName: invitedBy?.name ?? "",
      createdAt: invite.createdAt,
    });
  }
  return json(200, { invites });
});

route("/api/invites/accept", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { inviteId } = await readBody(request);
  if (typeof inviteId !== "string") return error(400, "inviteId is required");

  const invite = await ctx.runQuery(internal.data.getEmailInvite, {
    inviteId: inviteId as Id<"teamEmailInvites">,
  });
  if (!invite) return error(404, "Invite not found");
  if (invite.email !== normalizeEmail(user.email)) {
    return error(403, "This invite is for a different email");
  }

  const membership = await getMembership(ctx, invite.teamId, user.id);
  if (!membership) {
    const auth = createAuth(ctx);
    await auth.api.addMember({
      body: { userId: user.id, organizationId: invite.teamId, role: "member" },
    });
  }
  await ctx.runMutation(internal.data.deleteEmailInvite, { inviteId: invite._id });
  const organization = await getOrganization(ctx, invite.teamId);
  return json(200, { teamId: invite.teamId, name: organization?.name ?? "" });
});

route("/api/invites/decline", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { inviteId } = await readBody(request);
  if (typeof inviteId !== "string") return error(400, "inviteId is required");

  const invite = await ctx.runQuery(internal.data.getEmailInvite, {
    inviteId: inviteId as Id<"teamEmailInvites">,
  });
  if (!invite) return error(404, "Invite not found");
  if (invite.email !== normalizeEmail(user.email)) {
    return error(403, "This invite is for a different email");
  }

  await ctx.runMutation(internal.data.deleteEmailInvite, { inviteId: invite._id });
  return json(200, { ok: true });
});

// -- Membership -------------------------------------------------------------

route("/api/teams/leave", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { teamId } = await readBody(request);
  if (typeof teamId !== "string") return error(400, "teamId is required");

  const membership = await getMembership(ctx, teamId, user.id);
  if (!membership) return error(403, "Not a member of this team");

  await removeMembership(ctx, teamId, user.id);
  return json(200, { ok: true });
});

route("/api/teams/members/remove", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { teamId, userId } = await readBody(request);
  if (typeof teamId !== "string" || typeof userId !== "string") {
    return error(400, "teamId and userId are required");
  }

  const membership = await getMembership(ctx, teamId, user.id);
  if (!membership) return error(403, "Not a member of this team");
  if (userId === user.id) {
    return error(400, "Use /api/teams/leave to remove yourself");
  }
  const targetMembership = await getMembership(ctx, teamId, userId);
  if (!targetMembership) return error(404, "That user is not a member of this team");

  await removeMembership(ctx, teamId, userId);
  return json(200, { ok: true });
});

route("/api/teams/me", "GET", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");

  const memberships = await listByField(ctx, "member", "userId", user.id);
  const teams = [];
  for (const membership of memberships) {
    const teamId = membership.organizationId as string;
    const organization = await getOrganization(ctx, teamId);
    if (!organization) continue;
    const teamMembers = await listByField(ctx, "member", "organizationId", teamId);
    const members = [];
    for (const teamMember of teamMembers) {
      const memberUser = await getAuthUserById(ctx, teamMember.userId as string);
      members.push({
        userId: teamMember.userId,
        name: memberUser?.name ?? "",
        email: memberUser?.email ?? "",
      });
    }
    teams.push({
      id: teamId,
      name: organization.name,
      members,
    });
  }
  return json(200, { user: { id: user.id, name: user.name, email: user.email }, teams });
});

// -- Environments -----------------------------------------------------------

route("/api/environments/register", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { label } = await readBody(request);
  if (typeof label !== "string" || label.trim() === "") return error(400, "label is required");

  const environmentKey = randomKey();
  const environmentId = await ctx.runMutation(internal.data.registerEnvironment, {
    userId: user.id,
    label: label.trim(),
    keyHash: await sha256Hex(environmentKey),
  });
  return json(200, { environmentId, environmentKey });
});

route("/api/environments/mine", "GET", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const environments = await ctx.runQuery(internal.data.listEnvironments, { userId: user.id });
  return json(200, {
    environments: environments.map((environment) => ({
      environmentId: environment._id,
      label: environment.label,
      lastSeenAt: environment.lastSeenAt ?? null,
    })),
  });
});

// -- Shared threads ---------------------------------------------------------

route("/api/threads/share", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { teamId, environmentId, threadId, title } = await readBody(request);
  if (
    typeof teamId !== "string" ||
    typeof environmentId !== "string" ||
    typeof threadId !== "string" ||
    typeof title !== "string"
  ) {
    return error(400, "teamId, environmentId, threadId, and title are required");
  }

  const membership = await getMembership(ctx, teamId, user.id);
  if (!membership) return error(403, "Not a member of this team");
  const environment = await ctx.runQuery(internal.data.getEnvironment, {
    environmentId: environmentId as Id<"environments">,
  });
  if (!environment || environment.userId !== user.id) return error(403, "Not your environment");

  const sharedThreadId = await ctx.runMutation(internal.data.shareThread, {
    teamId,
    ownerUserId: user.id,
    environmentId: environment._id,
    threadId,
    title,
  });
  return json(200, { sharedThreadId });
});

route("/api/threads/unshare", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { sharedThreadId } = await readBody(request);
  if (typeof sharedThreadId !== "string") return error(400, "sharedThreadId is required");

  const result = await ctx.runMutation(internal.data.unshareThread, {
    sharedThreadId: sharedThreadId as Id<"sharedThreads">,
    userId: user.id,
  });
  if (!result.ok) {
    return result.reason === "not-found"
      ? error(404, "Shared thread not found")
      : error(403, "Only the owner can unshare");
  }
  return json(200, { ok: true });
});

route("/api/threads/shared", "GET", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");

  const teamIdParam = new URL(request.url).searchParams.get("teamId");
  let teamIds: string[];
  if (teamIdParam) {
    const membership = await getMembership(ctx, teamIdParam, user.id);
    if (!membership) return error(403, "Not a member of this team");
    teamIds = [teamIdParam];
  } else {
    const memberships = await listByField(ctx, "member", "userId", user.id);
    teamIds = memberships.map((membership) => membership.organizationId as string);
  }

  const sharedThreads = await ctx.runQuery(internal.data.listSharedByTeams, { teamIds });
  const threads = [];
  for (const thread of sharedThreads) {
    const owner = await getAuthUserById(ctx, thread.ownerUserId);
    const environment = await ctx.runQuery(internal.data.getEnvironment, {
      environmentId: thread.environmentId,
    });
    threads.push({
      sharedThreadId: thread._id,
      teamId: thread.teamId,
      ownerUserId: thread.ownerUserId,
      ownerName: owner?.name ?? "",
      environmentId: thread.environmentId,
      environmentLabel: environment?.label ?? "",
      threadId: thread.threadId,
      title: thread.title,
      status: thread.status,
      updatedAt: thread.updatedAt,
    });
  }
  return json(200, { threads });
});

// -- Messages ---------------------------------------------------------------

route("/api/messages/send", "POST", async (ctx, request) => {
  const user = await getSessionUser(ctx, request);
  if (!user) return error(401, "Not signed in");
  const { sharedThreadId, text } = await readBody(request);
  if (typeof sharedThreadId !== "string" || typeof text !== "string" || text.trim() === "") {
    return error(400, "sharedThreadId and text are required");
  }

  const thread = await ctx.runQuery(internal.data.getSharedThread, {
    sharedThreadId: sharedThreadId as Id<"sharedThreads">,
  });
  if (!thread) return error(404, "Shared thread not found");
  const membership = await getMembership(ctx, thread.teamId, user.id);
  if (!membership) return error(403, "Not a member of this team");

  const messageId = await ctx.runMutation(internal.data.sendMessage, {
    teamId: thread.teamId,
    environmentId: thread.environmentId,
    threadId: thread.threadId,
    fromUserId: user.id,
    text,
  });
  return json(200, { messageId });
});

// -- Bridge (environment-key auth) ------------------------------------------

const THREAD_STATUSES = new Set(["working", "input-needed", "done", "idle"]);

route("/api/bridge/publish", "POST", async (ctx, request) => {
  const environment = await getEnvironmentByKey(ctx, request);
  if (!environment) return error(401, "Invalid environment key");
  const { threads } = await readBody(request);
  if (!Array.isArray(threads)) return error(400, "threads is required");
  for (const thread of threads) {
    if (
      typeof thread?.threadId !== "string" ||
      typeof thread?.title !== "string" ||
      typeof thread?.updatedAt !== "number" ||
      !THREAD_STATUSES.has(thread?.status)
    ) {
      return error(400, "each thread needs threadId, title, status, and updatedAt");
    }
  }

  const sharedThreadIds = await ctx.runMutation(internal.data.publishStatus, {
    environmentId: environment._id,
    threads: threads.map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
      status: thread.status,
      updatedAt: thread.updatedAt,
    })),
  });
  return json(200, { sharedThreadIds });
});

route("/api/bridge/inbox", "GET", async (ctx, request) => {
  const environment = await getEnvironmentByKey(ctx, request);
  if (!environment) return error(401, "Invalid environment key");

  const inbox = await ctx.runQuery(internal.data.listInbox, { environmentId: environment._id });
  const messages = [];
  for (const message of inbox) {
    const from = await getAuthUserById(ctx, message.fromUserId);
    const organization = await getOrganization(ctx, message.teamId);
    messages.push({
      id: message._id,
      threadId: message.threadId,
      fromUserName: from?.name ?? "",
      teamName: organization?.name ?? "",
      text: message.text,
      createdAt: message.createdAt,
    });
  }
  return json(200, { messages });
});

route("/api/bridge/ack", "POST", async (ctx, request) => {
  const environment = await getEnvironmentByKey(ctx, request);
  if (!environment) return error(401, "Invalid environment key");
  const { messageIds } = await readBody(request);
  if (!Array.isArray(messageIds) || messageIds.some((id) => typeof id !== "string")) {
    return error(400, "messageIds is required");
  }

  await ctx.runMutation(internal.data.ackMessages, {
    environmentId: environment._id,
    messageIds: messageIds as Id<"teamMessages">[],
  });
  return json(200, { ok: true });
});

export default http;
