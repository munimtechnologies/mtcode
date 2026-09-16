export {
  formatScheduledSendLabel,
  resolveScheduledSendInstant,
} from "@t3tools/shared/scheduledSend";

const padDatePart = (value: number): string => String(value).padStart(2, "0");

/** `datetime-local` input value in the browser's local time zone. */
export function toLocalDateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate(),
  )}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

/** An hour out, rounded up to the next five minutes, so the picker opens on a sensible default. */
export function defaultScheduledMessageInputValue(now: Date = new Date()): string {
  const next = new Date(now.getTime() + 60 * 60 * 1_000);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil(next.getMinutes() / 5) * 5);
  return toLocalDateTimeInputValue(next);
}
