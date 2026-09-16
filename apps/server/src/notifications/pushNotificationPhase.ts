import type { RelayAgentActivityState } from "@t3tools/contracts/relay";

export function isSelfHostedPushNotificationPhase(
  phase: RelayAgentActivityState["phase"],
): boolean {
  return (
    phase === "waiting_for_approval" ||
    phase === "waiting_for_input" ||
    phase === "completed" ||
    phase === "failed"
  );
}
