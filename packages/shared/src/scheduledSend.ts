/** Pure helpers for scheduled sends, shared by the web and mobile clients. */

export function resolveScheduledSendInstant(
  localDateTime: string,
  nowMs: number = Date.now(),
): { readonly scheduledFor: string | null; readonly error: string | null } {
  if (localDateTime.trim().length === 0) {
    return { scheduledFor: null, error: "Choose a date and time." };
  }
  const scheduledAt = new Date(localDateTime);
  if (!Number.isFinite(scheduledAt.getTime())) {
    return { scheduledFor: null, error: "Choose a valid date and time." };
  }
  if (scheduledAt.getTime() <= nowMs) {
    return { scheduledFor: null, error: "Choose a time in the future." };
  }
  return { scheduledFor: scheduledAt.toISOString(), error: null };
}

export type ScheduledSendRepeat = "daily" | "weekdays" | "weekly" | "monthly";

export interface ScheduledSendRecurrenceRule {
  readonly repeat: ScheduledSendRepeat;
  /** IANA zone the wall-clock time is kept in across DST changes. */
  readonly timezone: string;
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

function zonedOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/** UTC instant for a wall-clock time in a zone. A second pass settles DST boundaries. */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zonedOffsetMs(new Date(guess), timeZone);
  const offset = zonedOffsetMs(new Date(first), timeZone);
  return new Date(guess - offset);
}

/**
 * Next occurrence after `previousIso` at the same wall-clock time in the rule's zone that is
 * still in the future at `nowMs`, so a series catches up after downtime instead of firing
 * every missed slot. Null for malformed input or an unknown zone.
 */
export function nextScheduledSendOccurrence(
  previousIso: string,
  rule: ScheduledSendRecurrenceRule,
  nowMs: number = Date.now(),
): string | null {
  const previous = new Date(previousIso);
  if (!Number.isFinite(previous.getTime())) return null;
  let base: ZonedParts;
  try {
    base = zonedParts(previous, rule.timezone);
  } catch {
    return null;
  }
  const baseWeekday = new Date(Date.UTC(base.year, base.month - 1, base.day)).getUTCDay();
  for (let offset = 1; offset <= 800; offset += 1) {
    const candidate = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const year = candidate.getUTCFullYear();
    const month = candidate.getUTCMonth() + 1;
    const day = candidate.getUTCDate();
    const weekday = candidate.getUTCDay();
    const matches =
      rule.repeat === "daily"
        ? true
        : rule.repeat === "weekdays"
          ? weekday >= 1 && weekday <= 5
          : rule.repeat === "weekly"
            ? weekday === baseWeekday
            : day === base.day;
    if (!matches) continue;
    const instant = zonedTimeToUtc(year, month, day, base.hour, base.minute, rule.timezone);
    if (instant.getTime() <= nowMs) continue;
    return instant.toISOString();
  }
  return null;
}

export function formatScheduledSendRepeatLabel(repeat: ScheduledSendRepeat): string {
  switch (repeat) {
    case "daily":
      return "Repeats daily";
    case "weekdays":
      return "Repeats on weekdays";
    case "weekly":
      return "Repeats weekly";
    case "monthly":
      return "Repeats monthly";
  }
}

/** Local-time label for a scheduled instant, e.g. "Sep 17, 2026, 9:00 AM". */
export function formatScheduledSendLabel(scheduledFor: string): string {
  const date = new Date(scheduledFor);
  if (!Number.isFinite(date.getTime())) return "Scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}
