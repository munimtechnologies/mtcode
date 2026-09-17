import { describe, expect, it } from "vite-plus/test";

import { defaultScheduledMessageInputValue, toLocalDateTimeInputValue } from "./scheduleMessage";

describe("scheduleMessage", () => {
  it("formats a local datetime-local value", () => {
    expect(toLocalDateTimeInputValue(new Date(2026, 8, 16, 9, 5))).toBe("2026-09-16T09:05");
  });

  it("defaults to an hour ahead rounded up to five minutes", () => {
    expect(defaultScheduledMessageInputValue(new Date(2026, 8, 16, 9, 1, 30))).toBe(
      "2026-09-16T10:05",
    );
    expect(defaultScheduledMessageInputValue(new Date(2026, 8, 16, 23, 58))).toBe(
      "2026-09-17T01:00",
    );
  });
});
