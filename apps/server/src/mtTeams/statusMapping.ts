/**
 * MT Teams thread status mapping - projects an OrchestrationThreadShell onto
 * the four collaboration statuses the MT Teams service understands.
 *
 * Precedence mirrors the thread-relay classifier
 * (mcp/toolkits/threads/handlers.ts): a thread waiting on a human wins over
 * "working" because pending approvals arrive while the session is still
 * running, and checking "working" first would hide every approval from
 * teammates.
 *
 * @module mtTeamsStatusMapping
 */
import type { OrchestrationThreadShell } from "@t3tools/contracts";

export type MtTeamsThreadStatus = "working" | "input-needed" | "done" | "idle";

export function mtTeamsThreadStatus(thread: OrchestrationThreadShell): MtTeamsThreadStatus {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return "input-needed";
  }
  if (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.backgroundLiveness === "working"
  ) {
    return "working";
  }
  // A user override wins in both directions; otherwise the projector's
  // settled timestamp decides.
  if (thread.settledOverride === "settled") {
    return "done";
  }
  if (thread.settledOverride === null && thread.settledAt !== null) {
    return "done";
  }
  return "idle";
}
