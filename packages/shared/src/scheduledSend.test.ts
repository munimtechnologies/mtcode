import { describe, expect, it } from "vitest";

import { formatScheduledSendLabel, resolveScheduledSendInstant } from "./scheduledSend.ts";

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

describe("formatScheduledSendLabel", () => {
  it("falls back for malformed instants", () => {
    expect(formatScheduledSendLabel("garbage")).toBe("Scheduled");
  });
});
