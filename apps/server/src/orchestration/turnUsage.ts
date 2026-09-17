/**
 * Turns provider usage reports into one `provider.turn.usage` activity per
 * turn so clients can show what a turn cost. Rate limits arrive as the
 * adapters' normalized window updates (`account.rate-limits.updated`); this
 * module folds them into one snapshot per account and diffs it around a turn.
 */

import type {
  OrchestrationThreadActivity,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const TURN_USAGE_ACTIVITY_KIND = "provider.turn.usage";

/**
 * "limited": the plan refused the turn without billing overage. Only a turn
 * that actually ended on the limit is limited; a saturated window that did not
 * stop the turn (a model-scoped bucket for another model, or a turn the user
 * interrupted) never is.
 */
export type TurnUsageBilling = "included" | "warning" | "overage" | "limited" | "unknown";

export interface RateLimitWindow {
  /** Provider-stable window id (`five_hour`, `primary`), used to merge sparse updates. */
  readonly id?: string;
  readonly label: string;
  readonly usedPercent: number;
  /** When the window resets, as an ISO timestamp, when the provider says. */
  readonly resetsAt?: string;
}

export interface RateLimitSnapshot {
  /** Utilization of the most constrained plan window, in percent. */
  readonly usedPercent: number;
  readonly windowLabel: string;
  readonly status: "allowed" | "warning" | "rejected";
  readonly overage: boolean;
  /** Every plan window the provider reported, tightest first. */
  readonly windows: ReadonlyArray<RateLimitWindow>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function numberField(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Adapters send ISO timestamps; the raw provider shapes used unix seconds. */
function resetsAtIso(value: unknown): string | undefined {
  if (typeof value === "string") {
    return Number.isFinite(Date.parse(value)) ? value : undefined;
  }
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? DateTime.formatIso(DateTime.makeUnsafe(value * 1000))
    : undefined;
}

function snapshotFromWindows(windows: ReadonlyArray<RateLimitWindow>): RateLimitSnapshot {
  const sorted = [...windows].sort((a, b) => b.usedPercent - a.usedPercent);
  const tightest = sorted[0]!;
  return {
    usedPercent: tightest.usedPercent,
    windowLabel: tightest.label,
    status:
      tightest.usedPercent >= 100 ? "rejected" : tightest.usedPercent >= 80 ? "warning" : "allowed",
    overage: false,
    windows: sorted,
  };
}

/**
 * Adapters normalize their native reports before emitting
 * `account.rate-limits.updated` (`ProviderUsageLimitsUpdate`): a sparse list
 * of windows with a stable id, a label and a percent. Claude names one window
 * per `rate_limit_event`, Codex sends its primary and secondary windows, and
 * Cursor reports a synthetic plan window when it refuses a prompt. Percents
 * are kept to one decimal; a bare `{ windows }` is read the same way.
 */
export function normalizeRateLimitSnapshot(payload: unknown): RateLimitSnapshot | null {
  const record = asRecord(payload);
  if (!record) return null;
  const limits = asRecord(record.limits) ?? record;
  if (!Array.isArray(limits.windows)) return null;
  const windows = limits.windows.flatMap((window): RateLimitWindow[] => {
    const windowRecord = asRecord(window);
    const usedPercent = numberField(windowRecord, "usedPercent");
    const label = typeof windowRecord?.label === "string" ? windowRecord.label : null;
    if (usedPercent === null || label === null) return [];
    const id = typeof windowRecord?.id === "string" ? windowRecord.id : undefined;
    const resetsAt = resetsAtIso(windowRecord?.resetsAt);
    return [
      {
        ...(id ? { id } : {}),
        label,
        usedPercent: Math.round(Math.max(0, Math.min(100, usedPercent)) * 10) / 10,
        ...(resetsAt ? { resetsAt } : {}),
      },
    ];
  });
  if (windows.length === 0) return null;
  return snapshotFromWindows(windows);
}

/**
 * Sparse updates only carry the windows that changed, so the latest snapshot
 * per provider instance is the union of what was known and what just arrived,
 * keyed by window id (label when the adapter sent none).
 */
export function mergeRateLimitSnapshots(
  previous: RateLimitSnapshot | null,
  update: RateLimitSnapshot,
): RateLimitSnapshot {
  if (!previous) return update;
  const key = (window: RateLimitWindow) => window.id ?? window.label;
  const merged = new Map(previous.windows.map((window) => [key(window), window]));
  for (const window of update.windows) merged.set(key(window), window);
  return snapshotFromWindows([...merged.values()]);
}

/** Token totals of one turn, in the shape `buildTurnUsagePayload` reads as `usage`. */
export interface TurnTokenTotals {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

/**
 * Codex reports tokens per model call (`thread.token-usage.updated`, with the
 * call's counts in `last*`) rather than on `turn.completed`, so a turn's total
 * is the sum of the reports made while it ran.
 */
export function addTurnTokens(
  totals: TurnTokenTotals | undefined,
  snapshot: ThreadTokenUsageSnapshot,
): TurnTokenTotals {
  return {
    input_tokens:
      (totals?.input_tokens ?? 0) + (snapshot.lastInputTokens ?? snapshot.inputTokens ?? 0),
    output_tokens:
      (totals?.output_tokens ?? 0) + (snapshot.lastOutputTokens ?? snapshot.outputTokens ?? 0),
  };
}

export interface TurnUsageActivityPayload {
  /** Provider that ran the turn, so clients can attach a plan or provider name. */
  readonly provider: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalCostUsd: number | null;
  readonly windowDeltaPercent: number | null;
  readonly windowUsedPercent: number | null;
  readonly windowLabel: string | null;
  /** Every plan window after the turn, tightest first. */
  readonly windows: ReadonlyArray<RateLimitWindow>;
  readonly billing: TurnUsageBilling;
}

function tokenCount(
  usage: Record<string, unknown> | null,
  keys: ReadonlyArray<string>,
): number | null {
  if (!usage) return null;
  let total: number | null = null;
  for (const key of keys) {
    const value = numberField(usage, key);
    if (value !== null) total = (total ?? 0) + value;
  }
  return total;
}

/** How the turn ended, as `turn.completed` reports it. */
export interface TurnUsageOutcome {
  readonly state: "completed" | "failed" | "interrupted" | "cancelled";
  /** "usage_limit" when the adapter classified the failure as a limit stop. */
  readonly failureReason?: "usage_limit" | undefined;
}

function isExhausted(usedPercent: number): boolean {
  return usedPercent >= 100;
}

export function buildTurnUsagePayload(input: {
  readonly provider?: string | null;
  readonly usage: unknown;
  readonly totalCostUsd: number | undefined;
  readonly before: RateLimitSnapshot | null;
  readonly after: RateLimitSnapshot | null;
  /**
   * How the turn ended. Without it (older callers) a rejected snapshot still
   * reads as a limit stop; with it, only a failed turn can be limited.
   */
  readonly outcome?: TurnUsageOutcome;
}): TurnUsageActivityPayload | null {
  const usage = asRecord(input.usage);
  const inputTokens = tokenCount(usage, [
    "input_tokens",
    "inputTokens",
    "cache_read_input_tokens",
    "cacheReadInputTokens",
    "cached_input_tokens",
  ]);
  const outputTokens = tokenCount(usage, ["output_tokens", "outputTokens"]);
  const totalCostUsd =
    typeof input.totalCostUsd === "number" && Number.isFinite(input.totalCostUsd)
      ? input.totalCostUsd
      : null;
  const after = input.after;
  const outcome = input.outcome;
  const beforeUsedPercent = (label: string): number | null => {
    if (!input.before) return null;
    const window = input.before.windows.find((candidate) => candidate.label === label);
    if (window) return window.usedPercent;
    return input.before.windowLabel === label ? input.before.usedPercent : null;
  };
  // A limit stop needs the turn to have ended on it. An interrupted, cancelled
  // or completed turn ran (or was stopped by the user) whatever the account
  // snapshot says; only a failed turn can have been refused.
  const stoppedByLimit =
    outcome === undefined
      ? after?.status === "rejected"
      : outcome.failureReason === "usage_limit" ||
        (outcome.state === "failed" && after?.status === "rejected");
  // The headline window. A window that was already exhausted before the turn
  // (or with no baseline to say otherwise) and still let the turn run was not
  // binding it — typically a model-scoped weekly bucket for a different model
  // — so it must not headline the badge of a turn it did not stop.
  const headline: { readonly label: string; readonly usedPercent: number } | null = (() => {
    if (!after) return null;
    const tightest = { label: after.windowLabel, usedPercent: after.usedPercent };
    if (stoppedByLimit) return tightest;
    const windows = after.windows.length > 0 ? after.windows : [tightest];
    const binding = windows.filter((window) => {
      if (!isExhausted(window.usedPercent)) return true;
      const before = beforeUsedPercent(window.label);
      return before !== null && !isExhausted(before);
    });
    const pick = binding.length > 0 ? binding : windows;
    return pick.reduce((tightest, window) =>
      window.usedPercent > tightest.usedPercent ? window : tightest,
    );
  })();
  // Diff the headline window against the same window before the turn, even
  // when the provider flagged a different window back then.
  const beforeWindowPercent = headline ? beforeUsedPercent(headline.label) : null;
  // Without a baseline (the first turn since the server saw this account) a
  // window still under 1% after the turn bounds the turn's share all the same.
  const windowDeltaPercent =
    headline && beforeWindowPercent !== null
      ? Math.max(0, headline.usedPercent - beforeWindowPercent)
      : headline && headline.usedPercent < 1
        ? headline.usedPercent
        : null;
  // A turn the provider said nothing about stays silent: a badge with no
  // numbers behind it would only restate the plan name.
  if (inputTokens === null && outputTokens === null && totalCostUsd === null && after === null) {
    return null;
  }
  const billing: TurnUsageBilling = after
    ? after.overage
      ? "overage"
      : stoppedByLimit
        ? "limited"
        : headline && headline.usedPercent >= 80
          ? "warning"
          : "included"
    : "unknown";
  return {
    provider: input.provider ?? null,
    inputTokens,
    outputTokens,
    totalCostUsd,
    windowDeltaPercent,
    windowUsedPercent: headline?.usedPercent ?? null,
    windowLabel: headline?.label ?? null,
    windows: after?.windows ?? [],
    billing,
  };
}

export function turnUsageActivity(input: {
  readonly eventId: string;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
  readonly payload: TurnUsageActivityPayload;
}): OrchestrationThreadActivity {
  return {
    id: `${input.eventId}:usage` as OrchestrationThreadActivity["id"],
    createdAt: input.createdAt as OrchestrationThreadActivity["createdAt"],
    tone: "info",
    kind: TURN_USAGE_ACTIVITY_KIND,
    summary: "Turn usage",
    payload: input.payload,
    turnId: input.turnId,
  };
}
