// @ts-expect-error Vitest is provided by the repository test runner, not this package.
import { describe, expect, it } from "vitest";

import { isSelfHostedPushNotificationPhase } from "./pushNotificationPhase.ts";

describe("isSelfHostedPushNotificationPhase", () => {
  it("notifies for actionable and terminal phases", () => {
    for (const phase of [
      "waiting_for_approval",
      "waiting_for_input",
      "completed",
      "failed",
    ] as const) {
      expect(isSelfHostedPushNotificationPhase(phase)).toBe(true);
    }
  });

  it("does not notify for non-actionable phases", () => {
    for (const phase of ["starting", "running", "stale"] as const) {
      expect(isSelfHostedPushNotificationPhase(phase)).toBe(false);
    }
  });
});
