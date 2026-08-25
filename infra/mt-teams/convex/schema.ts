import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const threadStatus = v.union(
  v.literal("working"),
  v.literal("input-needed"),
  v.literal("done"),
  v.literal("idle"),
);

export default defineSchema({
  /** One MT Code environment (a running server). Key is stored hashed only. */
  environments: defineTable({
    // Better Auth user id of the environment's owner.
    userId: v.string(),
    label: v.string(),
    // SHA-256 hex of the environment key; the key itself is returned once.
    keyHash: v.string(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_keyHash", ["keyHash"]),

  /** A thread the owner shared into a team. threadId is environment-local. */
  sharedThreads: defineTable({
    // Better Auth organization id (organizations = teams).
    teamId: v.string(),
    ownerUserId: v.string(),
    environmentId: v.id("environments"),
    threadId: v.string(),
    title: v.string(),
    status: threadStatus,
    updatedAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_environment", ["environmentId"]),

  /** Messages teammates send into a shared thread, drained by the bridge. */
  teamMessages: defineTable({
    teamId: v.string(),
    environmentId: v.id("environments"),
    threadId: v.string(),
    fromUserId: v.string(),
    text: v.string(),
    createdAt: v.number(),
    ackedAt: v.optional(v.number()),
  }).index("by_environment", ["environmentId"]),

  /** Short join code per team (keyed by the Better Auth organization id). */
  teamInvites: defineTable({
    teamId: v.string(),
    inviteCode: v.string(),
  })
    .index("by_team", ["teamId"])
    .index("by_code", ["inviteCode"]),
});
