import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { threadStatus } from "./schema";

// -- Team email invites -----------------------------------------------------

/** Idempotent per (team, email): re-inviting returns the existing pending invite. */
export const createEmailInvite = internalMutation({
  args: { teamId: v.string(), email: v.string(), invitedByUserId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("teamEmailInvites")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .filter((q) => q.eq(q.field("email"), args.email))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("teamEmailInvites", { ...args, createdAt: Date.now() });
  },
});

export const getEmailInvite = internalQuery({
  args: { inviteId: v.id("teamEmailInvites") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.inviteId);
  },
});

export const listEmailInvitesByTeam = internalQuery({
  args: { teamId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("teamEmailInvites")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

export const listEmailInvitesByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("teamEmailInvites")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
  },
});

export const deleteEmailInvite = internalMutation({
  args: { inviteId: v.id("teamEmailInvites") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.inviteId);
  },
});

// -- Environments -----------------------------------------------------------

export const registerEnvironment = internalMutation({
  args: { userId: v.string(), label: v.string(), keyHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("environments", args);
  },
});

export const listEnvironments = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("environments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getEnvironment = internalQuery({
  args: { environmentId: v.id("environments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.environmentId);
  },
});

/** Bridge auth: resolve an environment by key hash and bump lastSeenAt. */
export const touchEnvironmentByKeyHash = internalMutation({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const environment = await ctx.db
      .query("environments")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (!environment) return null;
    await ctx.db.patch(environment._id, { lastSeenAt: Date.now() });
    return environment;
  },
});

// -- Shared threads ---------------------------------------------------------

export const shareThread = internalMutation({
  args: {
    teamId: v.string(),
    ownerUserId: v.string(),
    environmentId: v.id("environments"),
    threadId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sharedThreads")
      .withIndex("by_environment", (q) => q.eq("environmentId", args.environmentId))
      .filter((q) =>
        q.and(q.eq(q.field("teamId"), args.teamId), q.eq(q.field("threadId"), args.threadId)),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { title: args.title, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("sharedThreads", {
      ...args,
      status: "idle",
      updatedAt: Date.now(),
    });
  },
});

export const unshareThread = internalMutation({
  args: { sharedThreadId: v.id("sharedThreads"), userId: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.sharedThreadId);
    if (!thread) return { ok: false as const, reason: "not-found" as const };
    if (thread.ownerUserId !== args.userId) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    await ctx.db.delete(args.sharedThreadId);
    return { ok: true as const };
  },
});

export const getSharedThread = internalQuery({
  args: { sharedThreadId: v.id("sharedThreads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sharedThreadId);
  },
});

export const listSharedByTeams = internalQuery({
  args: { teamIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const threads = [];
    for (const teamId of args.teamIds) {
      const teamThreads = await ctx.db
        .query("sharedThreads")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .collect();
      threads.push(...teamThreads);
    }
    return threads;
  },
});

/** Update status for an environment's shared threads; return its thread ids. */
export const publishStatus = internalMutation({
  args: {
    environmentId: v.id("environments"),
    threads: v.array(
      v.object({
        threadId: v.string(),
        title: v.string(),
        status: threadStatus,
        updatedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const shared = await ctx.db
      .query("sharedThreads")
      .withIndex("by_environment", (q) => q.eq("environmentId", args.environmentId))
      .collect();
    const updates = new Map(args.threads.map((thread) => [thread.threadId, thread]));
    for (const thread of shared) {
      const update = updates.get(thread.threadId);
      if (!update) continue;
      await ctx.db.patch(thread._id, {
        title: update.title,
        status: update.status,
        updatedAt: update.updatedAt,
      });
    }
    return [...new Set(shared.map((thread) => thread.threadId))];
  },
});

// -- Team messages ----------------------------------------------------------

export const sendMessage = internalMutation({
  args: {
    teamId: v.string(),
    environmentId: v.id("environments"),
    threadId: v.string(),
    fromUserId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("teamMessages", { ...args, createdAt: Date.now() });
  },
});

export const listInbox = internalQuery({
  args: { environmentId: v.id("environments") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("teamMessages")
      .withIndex("by_environment", (q) => q.eq("environmentId", args.environmentId))
      .collect();
    return messages.filter((message) => message.ackedAt === undefined);
  },
});

export const ackMessages = internalMutation({
  args: { environmentId: v.id("environments"), messageIds: v.array(v.id("teamMessages")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const messageId of args.messageIds) {
      const message = await ctx.db.get(messageId);
      if (!message || message.environmentId !== args.environmentId) continue;
      if (message.ackedAt !== undefined) continue;
      await ctx.db.patch(messageId, { ackedAt: now });
    }
  },
});
