import { describe, expect, it } from "vite-plus/test";

import { resolveThreadVisit } from "./threadVisitedState";

const base = {
  appState: "active" as const,
  connectionState: "connected" as const,
  supported: true,
  detailLoaded: true,
  updatedAt: "2026-01-01T00:01:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  lastVisitedAt: "2026-01-01T00:00:30.000Z",
};

describe("resolveThreadVisit", () => {
  it("sends an unseen completion immediately", () => {
    expect(resolveThreadVisit(base)).toBe("now");
    expect(resolveThreadVisit({ ...base, lastVisitedAt: null })).toBe("now");
  });

  it("throttles mid-turn activity that has no new completion", () => {
    expect(
      resolveThreadVisit({ ...base, completedAt: null, updatedAt: "2026-01-01T00:02:00.000Z" }),
    ).toBe("throttled");
    expect(
      resolveThreadVisit({
        ...base,
        completedAt: "2026-01-01T00:00:10.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
      }),
    ).toBe("throttled");
  });

  it("skips when the watermark already covers the latest update", () => {
    expect(resolveThreadVisit({ ...base, lastVisitedAt: base.updatedAt })).toBe("skip");
  });

  it("skips when backgrounded, disconnected, unsupported, or unloaded", () => {
    expect(resolveThreadVisit({ ...base, appState: "background" })).toBe("skip");
    expect(resolveThreadVisit({ ...base, connectionState: "reconnecting" })).toBe("skip");
    expect(resolveThreadVisit({ ...base, supported: false })).toBe("skip");
    expect(resolveThreadVisit({ ...base, detailLoaded: false })).toBe("skip");
  });

  it("never visits on a malformed update timestamp", () => {
    expect(resolveThreadVisit({ ...base, updatedAt: "not-a-date" })).toBe("skip");
  });
});
