import { describe, expect, it } from "vite-plus/test";

import {
  MAX_RECENT_THREAD_KEYS,
  RECENT_THREADS_FALLBACK_LIMIT,
  resolveRecentThreadSwitcherKeys,
  withRecentThreadKey,
} from "./recentThreadsStore";

describe("withRecentThreadKey", () => {
  it("prepends a newly opened thread", () => {
    expect(withRecentThreadKey(["env:a"], "env:b")).toEqual(["env:b", "env:a"]);
  });

  it("moves a revisited thread to the front without duplicating it", () => {
    expect(withRecentThreadKey(["env:a", "env:b", "env:c"], "env:b")).toEqual([
      "env:b",
      "env:a",
      "env:c",
    ]);
  });

  it("returns the same array when the thread is already at the front", () => {
    const current = ["env:a", "env:b"];
    expect(withRecentThreadKey(current, "env:a")).toBe(current);
  });

  it("caps the list at the maximum", () => {
    const full = Array.from({ length: MAX_RECENT_THREAD_KEYS }, (_, i) => `env:${i}`);
    const next = withRecentThreadKey(full, "env:new");
    expect(next).toHaveLength(MAX_RECENT_THREAD_KEYS);
    expect(next[0]).toBe("env:new");
    expect(next).not.toContain(`env:${MAX_RECENT_THREAD_KEYS - 1}`);
  });
});

describe("resolveRecentThreadSwitcherKeys", () => {
  const liveThreads = [
    { threadKey: "env:old", activityAt: "2026-09-01T00:00:00.000Z" },
    { threadKey: "env:new", activityAt: "2026-09-03T00:00:00.000Z" },
    { threadKey: "env:mid", activityAt: "2026-09-02T00:00:00.000Z" },
  ];

  it("uses the visit history as-is once it holds two live threads", () => {
    expect(
      resolveRecentThreadSwitcherKeys({ liveHistory: ["env:old", "env:mid"], liveThreads }),
    ).toEqual(["env:old", "env:mid"]);
  });

  it("tops up a single-visit history by most recent activity after a reload", () => {
    expect(resolveRecentThreadSwitcherKeys({ liveHistory: ["env:mid"], liveThreads })).toEqual([
      "env:mid",
      "env:new",
      "env:old",
    ]);
  });

  it("falls back to activity order entirely when nothing was visited", () => {
    expect(resolveRecentThreadSwitcherKeys({ liveHistory: [], liveThreads })).toEqual([
      "env:new",
      "env:mid",
      "env:old",
    ]);
  });

  it("breaks activity ties by key so the order is stable", () => {
    expect(
      resolveRecentThreadSwitcherKeys({
        liveHistory: [],
        liveThreads: [
          { threadKey: "env:b", activityAt: "2026-09-01T00:00:00.000Z" },
          { threadKey: "env:a", activityAt: "2026-09-01T00:00:00.000Z" },
        ],
      }),
    ).toEqual(["env:a", "env:b"]);
  });

  it("caps the fallback at the limit", () => {
    const many = Array.from({ length: RECENT_THREADS_FALLBACK_LIMIT + 5 }, (_, i) => ({
      threadKey: `env:${i}`,
      activityAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const keys = resolveRecentThreadSwitcherKeys({ liveHistory: ["env:0"], liveThreads: many });
    expect(keys).toHaveLength(RECENT_THREADS_FALLBACK_LIMIT);
    expect(keys[0]).toBe("env:0");
    expect(keys[1]).toBe(`env:${RECENT_THREADS_FALLBACK_LIMIT + 4}`);
  });
});
