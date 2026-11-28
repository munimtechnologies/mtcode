import { describe, expect, it } from "@effect/vitest";

import {
  MOBILE_LONG_BACKGROUND_AFTER_MS,
  mobileApplicationActiveWakeup,
  mobileSuspensionStartedAtMs,
} from "./app-state-wakeups";

describe("mobileApplicationActiveWakeup", () => {
  it.each([
    ["inactive without background", null, 5_000, null],
    ["background just under 10 s", 0, 9_999, "application-active-probe"],
    ["background of 10 s or more", 0, 10_000, "application-active-long"],
  ] as const)("%s", (_case, backgroundedAtMs, activeAtMs, expected) => {
    expect(mobileApplicationActiveWakeup(backgroundedAtMs, activeAtMs)).toBe(expected);
  });

  it("uses a fast probe after a short interruption", () => {
    expect(
      mobileApplicationActiveWakeup(20_000, 20_000 + MOBILE_LONG_BACKGROUND_AFTER_MS - 1),
    ).toBe("application-active-probe");
  });

  it("marks a meaningful background suspension as a long resume", () => {
    expect(mobileApplicationActiveWakeup(20_000, 20_000 + MOBILE_LONG_BACKGROUND_AFTER_MS)).toBe(
      "application-active-long",
    );
  });
});

describe("mobileSuspensionStartedAtMs", () => {
  it("starts the clock on inactive so a short permission sheet stays a probe", () => {
    const startedAtMs = mobileSuspensionStartedAtMs(null, "inactive", 20_000);
    expect(startedAtMs).toBe(20_000);
    expect(mobileApplicationActiveWakeup(startedAtMs, 20_500)).toBe("application-active-probe");
  });

  it("starts the clock on background and keeps the first stamp through inactive", () => {
    const afterBackground = mobileSuspensionStartedAtMs(null, "background", 20_000);
    expect(afterBackground).toBe(20_000);
    expect(mobileSuspensionStartedAtMs(afterBackground, "inactive", 25_000)).toBe(20_000);
  });

  it("clears the clock on active and ignores unknown states", () => {
    expect(mobileSuspensionStartedAtMs(20_000, "active", 25_000)).toBeNull();
    expect(mobileSuspensionStartedAtMs(20_000, "unknown", 25_000)).toBe(20_000);
    expect(mobileSuspensionStartedAtMs(null, "active", 20_000)).toBeNull();
  });
});
