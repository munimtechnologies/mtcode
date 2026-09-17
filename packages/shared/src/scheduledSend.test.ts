import { describe, expect, it } from "vitest";

import {
  formatScheduledSendLabel,
  nextScheduledSendOccurrence,
  resolveScheduledSendInstant,
} from "./scheduledSend.ts";

describe("resolveScheduledSendInstant", () => {
  const nowMs = Date.parse("2026-09-16T12:00:00.000Z");

  it("rejects empty, malformed, and past inputs", () => {
    expect(resolveScheduledSendInstant("", nowMs).error).toBe("Choose a date and time.");
    expect(resolveScheduledSendInstant("nope", nowMs).error).toBe("Choose a valid date and time.");
    expect(resolveScheduledSendInstant(new Date(nowMs - 1).toISOString(), nowMs).error).toBe(
      "Choose a time in the future.",
    );
  });

  it("returns a UTC instant for a future time", () => {
    const result = resolveScheduledSendInstant(new Date(nowMs + 60_000).toISOString(), nowMs);
    expect(result.error).toBeNull();
    expect(result.scheduledFor).toBe("2026-09-16T12:01:00.000Z");
  });
});

describe("nextScheduledSendOccurrence", () => {
  const rule = (repeat: "daily" | "weekdays" | "weekly" | "monthly", timezone = "America/New_York") =>
    ({ repeat, timezone }) as const;
  // 2026-09-16 09:00 New York (EDT, UTC-4) is a Wednesday.
  const previous = "2026-09-16T13:00:00.000Z";
  const now = Date.parse("2026-09-16T13:00:01.000Z");

  it("keeps the wall-clock time across a DST change", () => {
    // Daily from Oct 31 09:00 EDT lands on Nov 1 09:00 EST (UTC-5).
    expect(
      nextScheduledSendOccurrence("2026-10-31T13:00:00.000Z", rule("daily"), Date.parse("2026-10-31T13:00:01.000Z")),
    ).toBe("2026-11-01T14:00:00.000Z");
  });

  it("advances daily, weekdays, weekly, and monthly", () => {
    expect(nextScheduledSendOccurrence(previous, rule("daily"), now)).toBe("2026-09-17T13:00:00.000Z");
    // Friday Sep 18 -> Monday Sep 21.
    expect(nextScheduledSendOccurrence("2026-09-18T13:00:00.000Z", rule("weekdays"), Date.parse("2026-09-18T13:00:01.000Z"))).toBe("2026-09-21T13:00:00.000Z");
    expect(nextScheduledSendOccurrence(previous, rule("weekly"), now)).toBe("2026-09-23T13:00:00.000Z");
    expect(nextScheduledSendOccurrence(previous, rule("monthly"), now)).toBe("2026-10-16T13:00:00.000Z");
  });

  it("skips occurrences that already passed while the server was down", () => {
    const later = Date.parse("2026-09-20T18:00:00.000Z");
    expect(nextScheduledSendOccurrence(previous, rule("daily"), later)).toBe("2026-09-21T13:00:00.000Z");
  });

  it("returns null for malformed input", () => {
    expect(nextScheduledSendOccurrence("nope", rule("daily"), now)).toBeNull();
    expect(nextScheduledSendOccurrence(previous, rule("daily", "Not/AZone"), now)).toBeNull();
  });
});

describe("formatScheduledSendLabel", () => {
  it("falls back for malformed instants", () => {
    expect(formatScheduledSendLabel("garbage")).toBe("Scheduled");
  });
});
