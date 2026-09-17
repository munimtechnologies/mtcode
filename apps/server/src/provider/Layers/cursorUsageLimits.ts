/**
 * Cursor subscription usage. Cursor streams no rate-limit events; its monthly
 * pools live on the dashboard behind the desktop session token that the usage
 * CSV export already reads from `state.vscdb`. The probe pulls
 * `GET /api/usage-summary` once per status check and folds it into the shared
 * `ServerProviderUsageLimits` shape with stable ids (`plan`, `auto`, `api`,
 * `on_demand`) so a later probe lands on the same rows.
 *
 * @module provider/Layers/cursorUsageLimits
 */
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  readLocalCursorExportAuth,
  withCursorDashboardAuth,
  type CursorExportAuth,
} from "../../usage/usageCursorExport.ts";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";

export const CURSOR_USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";

/** A dashboard read that has not answered in this long is treated as failed. */
const CURSOR_USAGE_FETCH_TIMEOUT_MS = 10_000;

export const CURSOR_NOT_SIGNED_IN_MESSAGE =
  "Cursor desktop is not signed in on this machine, so its dashboard usage could not be read.";
export const CURSOR_USAGE_FETCH_FAILED_MESSAGE = "Cursor usage summary could not be fetched.";
export const CURSOR_USAGE_UNEXPECTED_SHAPE_MESSAGE =
  "Cursor usage summary had an unexpected shape.";
export const CURSOR_UNLIMITED_PLAN_MESSAGE =
  "Cursor reports this plan as unlimited; there are no usage windows to track.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isoFromUnixMs(value: number): string | undefined {
  const ms = value < 1e12 ? value * 1000 : value;
  const dt = DateTime.make(ms);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
}

/** Cursor ships cycle bounds as ISO strings on `usage-summary` and unix-ms elsewhere. */
function isoFromUnknownTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (/^\d+$/.test(trimmed)) return isoFromUnixMs(Number(trimmed));
    const dt = DateTime.make(trimmed);
    return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return isoFromUnixMs(value);
  }
  return undefined;
}

function windowMinutesFromCycle(start: unknown, end: unknown): number | undefined {
  const startIso = isoFromUnknownTimestamp(start);
  const endIso = isoFromUnknownTimestamp(end);
  if (startIso === undefined || endIso === undefined) return undefined;
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
}

/** Plan name as the dashboard labels it (`Pro`, `Ultra`), when reported. */
export function cursorPlanNameFromUsageSummary(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const membership = readString(payload.membershipType);
  if (membership !== null) return membership.replace(/^./, (c) => c.toUpperCase());
  const planInfo = isRecord(payload.planInfo) ? payload.planInfo : null;
  return planInfo === null ? undefined : (readString(planInfo.planName) ?? undefined);
}

/**
 * Cursor meters two monthly pools (Auto / API) plus an included-spend cap for
 * the billing cycle, and optionally an on-demand spend cap. The dashboard
 * ships that as either `GET /api/usage-summary` (`individualUsage.plan`, ISO
 * cycle timestamps) or the `planUsage` payload of
 * `POST /api/dashboard/get-current-period-usage` (unix-ms). Both fold into
 * the same windows here.
 */
export function cursorUsageSummaryToLimits(input: {
  readonly payload: unknown;
  readonly checkedAt: string;
}): ServerProviderUsageLimits {
  const { payload, checkedAt } = input;
  if (!isRecord(payload)) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: CURSOR_USAGE_UNEXPECTED_SHAPE_MESSAGE,
    });
  }
  if (payload.isUnlimited === true) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "unsupported",
      message: CURSOR_UNLIMITED_PLAN_MESSAGE,
    });
  }

  const planUsage = isRecord(payload.individualUsage)
    ? payload.individualUsage.plan
    : payload.planUsage;
  const onDemand = isRecord(payload.individualUsage)
    ? payload.individualUsage.onDemand
    : isRecord(payload.spendLimitUsage)
      ? payload.spendLimitUsage
      : null;
  if (!isRecord(planUsage) && !isRecord(onDemand)) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: CURSOR_USAGE_UNEXPECTED_SHAPE_MESSAGE,
    });
  }

  const resetsAt = isoFromUnknownTimestamp(payload.billingCycleEnd);
  const windowDurationMins = windowMinutesFromCycle(
    payload.billingCycleStart,
    payload.billingCycleEnd,
  );
  const cycle = {
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
  };
  const monthly = (id: string, label: string, usedPercent: number): ServerProviderUsageWindow => ({
    id,
    kind: "monthly",
    label,
    usedPercent: clampPercent(usedPercent),
    ...cycle,
  });

  const windows: ServerProviderUsageWindow[] = [];
  if (isRecord(planUsage)) {
    const includedUsed = readNumber(planUsage.includedSpend ?? planUsage.used);
    const includedLimit = readNumber(planUsage.limit);
    if (includedUsed !== null && includedLimit !== null && includedLimit > 0) {
      windows.push(monthly("plan", "Monthly", (includedUsed / includedLimit) * 100));
    }
    const autoPercent = readNumber(planUsage.autoPercentUsed);
    if (autoPercent !== null) windows.push(monthly("auto", "Auto", autoPercent));
    const apiPercent = readNumber(planUsage.apiPercentUsed);
    if (apiPercent !== null) windows.push(monthly("api", "API", apiPercent));
    if (windows.length === 0) {
      const totalPercent = readNumber(planUsage.totalPercentUsed);
      if (totalPercent !== null) windows.push(monthly("plan", "Monthly", totalPercent));
    }
  }
  if (isRecord(onDemand) && onDemand.enabled !== false) {
    const used = readNumber(onDemand.individualUsed ?? onDemand.used);
    const limit = readNumber(onDemand.individualLimit ?? onDemand.limit);
    if (used !== null && limit !== null && limit > 0) {
      windows.push({
        id: "on_demand",
        kind: "other",
        label: "On-demand",
        usedPercent: clampPercent((used / limit) * 100),
        ...cycle,
      });
    }
  }
  return makeUsageLimits({ checkedAt, windows });
}

export interface LoadCursorUsageLimitsOptions {
  /** Home directory whose Cursor `state.vscdb` holds the desktop session. */
  readonly homeDir?: string | undefined;
  /** Test seam: replaces the `state.vscdb` read. */
  readonly readAuth?: (homeDir?: string) => CursorExportAuth | null;
}

/**
 * Pulls the signed-in Cursor account's current billing-cycle limits. Never
 * fails: a missing desktop sign-in or an unreachable dashboard becomes a
 * `probeFailed` snapshot, which keeps the last good bars on screen.
 */
export const loadCursorUsageLimits = Effect.fn("loadCursorUsageLimits")(function* (
  options: LoadCursorUsageLimitsOptions = {},
): Effect.fn.Return<ServerProviderUsageLimits, never, HttpClient.HttpClient> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const auth = (options.readAuth ?? readLocalCursorExportAuth)(options.homeDir);
  if (auth === null) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: CURSOR_NOT_SIGNED_IN_MESSAGE,
    });
  }
  const httpClient = yield* HttpClient.HttpClient;
  const request = withCursorDashboardAuth(
    HttpClientRequest.get(CURSOR_USAGE_SUMMARY_URL),
    auth.sessionToken,
  );
  const payload = yield* httpClient.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.timeout(CURSOR_USAGE_FETCH_TIMEOUT_MS),
    Effect.option,
  );
  if (Option.isNone(payload)) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: CURSOR_USAGE_FETCH_FAILED_MESSAGE,
    });
  }
  return cursorUsageSummaryToLimits({ payload: payload.value, checkedAt });
});
