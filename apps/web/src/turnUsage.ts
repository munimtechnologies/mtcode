/**
 * Per-turn usage as the server records it in a `provider.turn.usage`
 * activity (see apps/server/src/orchestration/turnUsage.ts). The badge under
 * an assistant reply reads this shape; both sides parse defensively so an
 * older server or client never crashes.
 */

import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { providerDisplayName } from "./lib/providerDisplayName";

export const TURN_USAGE_ACTIVITY_KIND = "provider.turn.usage";

export type TurnUsageBilling = "included" | "warning" | "overage" | "limited" | "unknown";

export interface TurnUsageWindow {
  readonly label: string;
  readonly usedPercent: number;
  /** ISO timestamp of the window's next reset, when the provider reported one. */
  readonly resetsAt?: string;
}

export interface TurnUsage {
  readonly provider: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalCostUsd: number | null;
  /** Share of the plan window this turn consumed, in percent, when known. */
  readonly windowDeltaPercent: number | null;
  /** Plan window utilization after the turn, in percent, when known. */
  readonly windowUsedPercent: number | null;
  readonly windowLabel: string | null;
  /** Every plan window after the turn, tightest first. */
  readonly windows: ReadonlyArray<TurnUsageWindow>;
  readonly billing: TurnUsageBilling;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseWindows(value: unknown): ReadonlyArray<TurnUsageWindow> {
  if (!Array.isArray(value)) return [];
  const windows: TurnUsageWindow[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const usedPercent = numberOrNull(record.usedPercent);
    if (typeof record.label !== "string" || usedPercent === null) continue;
    const resetsAt =
      typeof record.resetsAt === "string" && Number.isFinite(Date.parse(record.resetsAt))
        ? record.resetsAt
        : null;
    windows.push({
      label: record.label,
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return windows;
}

/**
 * How long until a window resets, coarse enough to change at most once a
 * minute: "3d 4h", "2h 14m", "45m". Past reset times read "now", since the
 * next provider report will replace them.
 */
export function formatResetIn(resetsAt: string, now: number): string | null {
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  const totalMinutes = Math.ceil((at - now) / 60_000);
  if (totalMinutes <= 0) return "now";
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function parseTurnUsagePayload(payload: unknown): TurnUsage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const billing = record.billing;
  const windowUsedPercent = numberOrNull(record.windowUsedPercent);
  const windowLabel = typeof record.windowLabel === "string" ? record.windowLabel : null;
  const parsedWindows = parseWindows(record.windows);
  return {
    provider: typeof record.provider === "string" ? record.provider : null,
    inputTokens: numberOrNull(record.inputTokens),
    outputTokens: numberOrNull(record.outputTokens),
    totalCostUsd: numberOrNull(record.totalCostUsd),
    windowDeltaPercent: numberOrNull(record.windowDeltaPercent),
    windowUsedPercent,
    windowLabel,
    windows:
      parsedWindows.length > 0
        ? parsedWindows
        : windowUsedPercent !== null && windowLabel !== null
          ? [{ label: windowLabel, usedPercent: windowUsedPercent }]
          : [],
    billing:
      billing === "included" ||
      billing === "warning" ||
      billing === "overage" ||
      billing === "limited"
        ? billing
        : "unknown",
  };
}

export function turnUsageByTurnId(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyMap<TurnId, TurnUsage> {
  const map = new Map<TurnId, TurnUsage>();
  for (const activity of activities) {
    if (activity.kind !== TURN_USAGE_ACTIVITY_KIND || activity.turnId === null) continue;
    const usage = parseTurnUsagePayload(activity.payload);
    if (usage) map.set(activity.turnId, usage);
  }
  return map;
}

/** The newest usage report in a thread: what the plan windows look like right now. */
export function latestTurnUsage(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): TurnUsage | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]!;
    if (activity.kind !== TURN_USAGE_ACTIVITY_KIND) continue;
    const usage = parseTurnUsagePayload(activity.payload);
    if (usage) return usage;
  }
  return null;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return String(count);
}

export function formatPercent(percent: number): string {
  if (percent <= 0) return "0%";
  if (percent < 0.05) return "<0.1%";
  return `${percent.toFixed(percent < 1 ? 1 : 0)}%`;
}

/** A plan that never bills, such as "Cursor Free": its turns are free by definition. */
export function isFreePlan(planLabel: string | null): boolean {
  return planLabel !== null && /\bfree\b/i.test(planLabel);
}

export type TurnUsageTone = "free" | "overage" | "warning" | "default";

/**
 * Headline, detail and tone for the badge under a reply, or null when there
 * is nothing honest to say (a paid plan whose provider reported nothing).
 * Limit-based headlines end with " · {plan}" so the reader knows whose limit
 * it is: the plan name when the provider reports one, otherwise the provider
 * name. A window that did not move still reads "<1% of Limit", since the plan
 * counted the turn; "free" is reserved for plans that never bill.
 */
export function formatTurnUsage(
  usage: TurnUsage,
  planLabel: string | null = null,
): {
  readonly headline: string;
  readonly detail: string;
  readonly tone: TurnUsageTone;
} | null {
  const parts: string[] = [];
  let limitBased = false;
  let costInHeadline = false;
  let tone: TurnUsageTone = "default";
  if (usage.billing === "limited") {
    // The plan refused the turn; a share of a window it never ran in says nothing.
    limitBased = true;
    tone = "overage";
    parts.push("Limit Reached");
  } else if (usage.windowDeltaPercent !== null) {
    limitBased = true;
    const share = usage.windowDeltaPercent < 1 ? "<1%" : formatPercent(usage.windowDeltaPercent);
    parts.push(`${share} of ${usage.windowLabel ?? "Limit"}`);
  } else if (usage.windowUsedPercent !== null && usage.billing !== "overage") {
    // A plan window was reported, so the plan covered the turn; only the share
    // is unknown. The provider's cost estimate is not a bill here.
    limitBased = true;
    parts.push("Included");
  } else if (usage.totalCostUsd !== null) {
    costInHeadline = true;
    parts.push(usage.totalCostUsd < 0.005 ? "<$0.01" : `$${usage.totalCostUsd.toFixed(2)}`);
  }
  if (usage.billing === "overage") {
    limitBased = true;
    tone = "overage";
    parts.push("billed over Limit");
  } else if (parts.length === 0) {
    if (usage.billing === "included") {
      limitBased = true;
      parts.push("Included");
    } else if (isFreePlan(planLabel)) {
      limitBased = true;
      tone = "free";
      parts.push("Free");
    } else {
      return null;
    }
  }
  const suffix = limitBased ? (planLabel ?? providerDisplayName(usage.provider)) : null;
  const headline = `${parts.join(" · ")}${suffix ? ` · ${suffix}` : ""}`;

  const detail: string[] = [];
  if (usage.inputTokens !== null || usage.outputTokens !== null) {
    detail.push(
      `${formatTokens(usage.inputTokens ?? 0)} in / ${formatTokens(usage.outputTokens ?? 0)} out`,
    );
  }
  if (usage.windowUsedPercent !== null) {
    detail.push(`${Math.round(usage.windowUsedPercent)}% of ${usage.windowLabel ?? "Limit"} used`);
  }
  // The provider's cost estimate, for plans that cover it: never billed, still informative.
  if (usage.totalCostUsd !== null && limitBased && !costInHeadline) {
    detail.push(`$${usage.totalCostUsd.toFixed(3)}`);
  }
  return { headline, detail: detail.join(" · "), tone };
}
