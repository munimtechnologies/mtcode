import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSyncPhase } from "./threadSync";

describe("resolveThreadSyncPhase", () => {
  it("loads when only shell data is available", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: true,
        status: "synchronizing",
      }),
    ).toBe("loading");
  });

  it("syncs when cached detail is already visible", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "cached",
      }),
    ).toBe("syncing");
  });

  it("reports reconnecting when the subscription is still failing", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "cached",
        hasError: true,
      }),
    ).toBe("reconnecting");
    // No detail yet either: still reconnecting, not a first-time load.
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: true,
        status: "empty",
        hasError: true,
      }),
    ).toBe("reconnecting");
  });

  it("clears the error phase once the thread goes live", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "live",
        hasError: true,
      }),
    ).toBeNull();
  });

  it("does not report a sync phase without a shell or after going live", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: false,
        status: "empty",
      }),
    ).toBeNull();
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "live",
      }),
    ).toBeNull();
  });
});
