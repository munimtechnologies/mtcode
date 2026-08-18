import { describe, expect, it } from "@effect/vitest";

import { getSshPasswordPromptTiming } from "./sshPasswordPromptTiming";

const expiresAt = "2026-08-17T10:03:00.000Z";

describe("mobile SSH password prompt timing", () => {
  it("formats the remaining prompt time", () => {
    expect(getSshPasswordPromptTiming(expiresAt, Date.parse("2026-08-17T10:01:29.250Z"))).toEqual({
      isExpired: false,
      remainingLabel: "1:31",
      remainingSeconds: 91,
    });
  });

  it("reports an expired prompt", () => {
    expect(getSshPasswordPromptTiming(expiresAt, Date.parse(expiresAt))).toEqual({
      isExpired: true,
      remainingLabel: "0:00",
      remainingSeconds: 0,
    });
  });

  it("omits timing for an invalid expiry", () => {
    expect(getSshPasswordPromptTiming("invalid", Date.parse(expiresAt))).toEqual({
      isExpired: false,
      remainingLabel: null,
      remainingSeconds: null,
    });
  });
});
