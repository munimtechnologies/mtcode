import { TurnId } from "@t3tools/contracts";

/**
 * Key stamped into a provider session directory binding's runtime payload when
 * the server marks a running thread to continue after a self-update. The
 * startup pass in `serverRuntimeStartup.ts` owns threads carrying it; the
 * generic resume-on-restart reconciler must leave them alone so a thread is
 * not continued twice.
 */
export const SERVER_UPDATE_CONTINUATION_KEY = "continueAfterServerUpdate";

export function hasServerUpdateContinuationMarker(
  runtimePayload: unknown,
): runtimePayload is Record<string, unknown> {
  return (
    runtimePayload !== null &&
    typeof runtimePayload === "object" &&
    !Array.isArray(runtimePayload) &&
    SERVER_UPDATE_CONTINUATION_KEY in runtimePayload
  );
}

export function readServerUpdateContinuationTurnId(runtimePayload: unknown): TurnId | null {
  if (!hasServerUpdateContinuationMarker(runtimePayload)) {
    return null;
  }
  const value = runtimePayload[SERVER_UPDATE_CONTINUATION_KEY];
  return typeof value === "string" && value.length > 0 ? TurnId.make(value) : null;
}
