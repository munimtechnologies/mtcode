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

/** Local-time label for a scheduled instant, e.g. "Sep 17, 2026, 9:00 AM". */
export function formatScheduledSendLabel(scheduledFor: string): string {
  const date = new Date(scheduledFor);
  if (!Number.isFinite(date.getTime())) return "Scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}
