import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { AppStateStatus } from "react-native";

/** Trailing coalesce window for visit watermarks while a turn streams. */
export const VISIT_DISPATCH_THROTTLE_MS = 10_000;

/**
 * Decides whether the focused thread route should record a visit and how
 * urgently. Skipped when the app is not in front, the environment is not
 * connected, the server does not track visits, the thread's messages have
 * not loaded (the user cannot have read what they cannot see), or the
 * server watermark already covers the thread's latest update. An unseen
 * completion sends immediately; mid-turn activity bumps coalesce into a
 * trailing visit so streaming does not flood the server.
 */
export function resolveThreadVisit(input: {
  readonly appState: AppStateStatus;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly supported: boolean;
  readonly detailLoaded: boolean;
  readonly updatedAt: string;
  readonly completedAt: string | null | undefined;
  readonly lastVisitedAt: string | null | undefined;
}): "now" | "throttled" | "skip" {
  if (input.appState !== "active" || input.connectionState !== "connected" || !input.supported) {
    return "skip";
  }
  if (!input.detailLoaded) return "skip";
  const updatedAtMs = Date.parse(input.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return "skip";
  const lastVisitedAtMs = input.lastVisitedAt ? Date.parse(input.lastVisitedAt) : NaN;
  if (Number.isFinite(lastVisitedAtMs) && lastVisitedAtMs >= updatedAtMs) return "skip";
  const completedAtMs = input.completedAt ? Date.parse(input.completedAt) : NaN;
  const hasUnseenCompletion =
    Number.isFinite(completedAtMs) &&
    (!Number.isFinite(lastVisitedAtMs) || completedAtMs > lastVisitedAtMs);
  return hasUnseenCompletion ? "now" : "throttled";
}
