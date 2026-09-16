import { describe, expect, it } from "vite-plus/test";

import {
  addTurnTokens,
  buildTurnUsagePayload,
  mergeRateLimitSnapshots,
  normalizeRateLimitSnapshot,
} from "./turnUsage.ts";

describe("normalizeRateLimitSnapshot", () => {
  it("reads the sparse window update the Claude adapter emits", () => {
    expect(
      normalizeRateLimitSnapshot({
        limits: {
          windows: [
            { id: "five_hour", kind: "session", label: "Current session", usedPercent: 83.39 },
          ],
        },
      }),
    ).toEqual({
      usedPercent: 83.4,
      windowLabel: "Current session",
      status: "warning",
      overage: false,
      windows: [{ id: "five_hour", label: "Current session", usedPercent: 83.4 }],
    });
  });

  it("reads the Codex windows and keeps the tightest one, with reset times", () => {
    expect(
      normalizeRateLimitSnapshot({
        limits: {
          windows: [
            {
              id: "primary",
              kind: "session",
              label: "5h Limit",
              usedPercent: 12,
              windowDurationMins: 300,
              resetsAt: "2026-09-02T21:30:00.000Z",
            },
            { id: "secondary", kind: "weekly", label: "Weekly Limit", usedPercent: 41 },
          ],
        },
      }),
    ).toEqual({
      usedPercent: 41,
      windowLabel: "Weekly Limit",
      status: "allowed",
      overage: false,
      windows: [
        { id: "secondary", label: "Weekly Limit", usedPercent: 41 },
        { id: "primary", label: "5h Limit", usedPercent: 12, resetsAt: "2026-09-02T21:30:00.000Z" },
      ],
    });
  });

  it("clamps a window past its limit to a rejection", () => {
    expect(
      normalizeRateLimitSnapshot({
        limits: { windows: [{ id: "five_hour", kind: "session", label: "5h", usedPercent: 105 }] },
      }),
    ).toMatchObject({ usedPercent: 100, windowLabel: "5h", status: "rejected" });
  });

  it("ignores payloads it does not understand", () => {
    expect(normalizeRateLimitSnapshot({ limits: { hello: 1 } })).toBeNull();
    expect(normalizeRateLimitSnapshot({ limits: { windows: [] } })).toBeNull();
    expect(normalizeRateLimitSnapshot({ limits: { windows: [{ label: "x" }] } })).toBeNull();
    expect(normalizeRateLimitSnapshot("nope")).toBeNull();
  });
});

describe("mergeRateLimitSnapshots", () => {
  it("folds a one-window update onto the windows already reported", () => {
    const first = normalizeRateLimitSnapshot({
      limits: {
        windows: [
          { id: "five_hour", kind: "session", label: "5h Limit", usedPercent: 40 },
          { id: "seven_day", kind: "weekly", label: "7d Limit", usedPercent: 90 },
        ],
      },
    })!;
    const update = normalizeRateLimitSnapshot({
      limits: {
        windows: [{ id: "five_hour", kind: "session", label: "5h Limit", usedPercent: 95 }],
      },
    })!;
    expect(mergeRateLimitSnapshots(first, update)).toEqual({
      usedPercent: 95,
      windowLabel: "5h Limit",
      status: "warning",
      overage: false,
      windows: [
        { id: "five_hour", label: "5h Limit", usedPercent: 95 },
        { id: "seven_day", label: "7d Limit", usedPercent: 90 },
      ],
    });
    expect(mergeRateLimitSnapshots(null, update)).toBe(update);
  });
});

describe("buildTurnUsagePayload", () => {
  it("combines tokens, cost, and the window delta around the turn", () => {
    expect(
      buildTurnUsagePayload({
        usage: { input_tokens: 1200, cache_read_input_tokens: 800, output_tokens: 300 },
        totalCostUsd: 0.0421,
        provider: "claude",
        before: {
          usedPercent: 10,
          windowLabel: "5h Limit",
          status: "allowed",
          overage: false,
          windows: [{ label: "5h Limit", usedPercent: 10 }],
        },
        after: {
          usedPercent: 12.5,
          windowLabel: "5h Limit",
          status: "allowed",
          overage: false,
          windows: [{ label: "5h Limit", usedPercent: 12.5 }],
        },
      }),
    ).toEqual({
      provider: "claude",
      inputTokens: 2000,
      outputTokens: 300,
      totalCostUsd: 0.0421,
      windowDeltaPercent: 2.5,
      windowUsedPercent: 12.5,
      windowLabel: "5h Limit",
      windows: [{ label: "5h Limit", usedPercent: 12.5 }],
      billing: "included",
    });
  });

  it("diffs the headline window against the same window before the turn", () => {
    expect(
      buildTurnUsagePayload({
        usage: { input_tokens: 1, output_tokens: 1 },
        totalCostUsd: undefined,
        provider: "claude",
        before: {
          usedPercent: 20,
          windowLabel: "7d Limit",
          status: "allowed",
          overage: false,
          windows: [
            { label: "5h Limit", usedPercent: 97 },
            { label: "7d Limit", usedPercent: 20 },
          ],
        },
        after: {
          usedPercent: 100,
          windowLabel: "5h Limit",
          status: "rejected",
          overage: true,
          windows: [
            { label: "5h Limit", usedPercent: 100 },
            { label: "7d Limit", usedPercent: 22 },
          ],
        },
      }),
    ).toMatchObject({ windowDeltaPercent: 3, windowUsedPercent: 100, billing: "overage" });
  });

  it("bounds the share by the post-turn window when there is no baseline", () => {
    const quiet = {
      usedPercent: 0,
      windowLabel: "5h limit",
      status: "allowed",
      overage: false,
      windows: [{ label: "5h limit", usedPercent: 0 }],
    } as const;
    expect(
      buildTurnUsagePayload({
        provider: "claude",
        usage: { input_tokens: 11_000, output_tokens: 357 },
        totalCostUsd: 0.17,
        before: null,
        after: quiet,
      }),
    ).toMatchObject({ windowDeltaPercent: 0, windowUsedPercent: 0, billing: "included" });
    expect(
      buildTurnUsagePayload({
        provider: "claude",
        usage: undefined,
        totalCostUsd: 0.17,
        before: null,
        after: { ...quiet, usedPercent: 12, windows: [{ label: "5h limit", usedPercent: 12 }] },
      }),
    ).toMatchObject({ windowDeltaPercent: null, windowUsedPercent: 12, billing: "included" });
  });

  it("marks overage and warnings from the post-turn snapshot", () => {
    const base = {
      usage: { input_tokens: 1, output_tokens: 1 },
      totalCostUsd: undefined,
      before: null,
    };
    expect(
      buildTurnUsagePayload({
        ...base,
        after: {
          usedPercent: 100,
          windowLabel: "5h Limit",
          status: "rejected",
          overage: true,
          windows: [],
        },
      })?.billing,
    ).toBe("overage");
    expect(
      buildTurnUsagePayload({
        ...base,
        after: {
          usedPercent: 90,
          windowLabel: "5h Limit",
          status: "warning",
          overage: false,
          windows: [],
        },
      })?.billing,
    ).toBe("warning");
  });

  it("returns nothing when the provider reported nothing", () => {
    expect(
      buildTurnUsagePayload({
        usage: undefined,
        totalCostUsd: undefined,
        before: null,
        after: null,
      }),
    ).toBeNull();
    expect(
      buildTurnUsagePayload({
        usage: undefined,
        totalCostUsd: undefined,
        before: null,
        after: null,
      }),
    ).toBeNull();
  });

  it("stays silent for a completed turn the provider reported nothing about", () => {
    expect(
      buildTurnUsagePayload({
        provider: "cursor",
        usage: undefined,
        totalCostUsd: undefined,
        before: null,
        after: null,
      }),
    ).toBeNull();
  });
});

describe("addTurnTokens", () => {
  it("sums the per-call counts Codex reports while a turn runs", () => {
    const first = addTurnTokens(undefined, {
      usedTokens: 1200,
      lastInputTokens: 1000,
      lastOutputTokens: 200,
    });
    const second = addTurnTokens(first, {
      usedTokens: 1500,
      inputTokens: 1300,
      outputTokens: 200,
      lastInputTokens: 1300,
      lastOutputTokens: 200,
    });
    expect(second).toEqual({ input_tokens: 2300, output_tokens: 400 });
    expect(
      buildTurnUsagePayload({
        provider: "codex",
        usage: second,
        totalCostUsd: undefined,
        before: null,
        after: null,
      }),
    ).toMatchObject({ inputTokens: 2300, outputTokens: 400 });
  });

  it("falls back to the running totals when a report has no per-call counts", () => {
    expect(addTurnTokens(undefined, { usedTokens: 50, inputTokens: 40, outputTokens: 10 })).toEqual(
      {
        input_tokens: 40,
        output_tokens: 10,
      },
    );
  });
});

describe("plan limits without usage numbers", () => {
  it("reads the synthetic plan window Cursor reports and its withdrawal", () => {
    expect(
      normalizeRateLimitSnapshot({
        limits: { windows: [{ id: "plan", kind: "other", label: "Plan Limit", usedPercent: 100 }] },
      }),
    ).toEqual({
      usedPercent: 100,
      windowLabel: "Plan Limit",
      status: "rejected",
      overage: false,
      windows: [{ id: "plan", label: "Plan Limit", usedPercent: 100 }],
    });
    expect(
      normalizeRateLimitSnapshot({
        limits: { windows: [{ id: "plan", kind: "other", label: "Plan Limit", usedPercent: 0 }] },
      }),
    ).toMatchObject({ usedPercent: 0, status: "allowed" });
  });

  it("bills a rejected window as limited unless the plan ran into overage", () => {
    const base = { usage: undefined, totalCostUsd: undefined, before: null };
    const rejected = {
      usedPercent: 100,
      windowLabel: "Plan Limit",
      status: "rejected" as const,
      windows: [{ label: "Plan Limit", usedPercent: 100 }],
    };
    expect(
      buildTurnUsagePayload({ ...base, after: { ...rejected, overage: false } }),
    ).toMatchObject({ windowUsedPercent: 100, windowLabel: "Plan Limit", billing: "limited" });
    expect(buildTurnUsagePayload({ ...base, after: { ...rejected, overage: true } })?.billing).toBe(
      "overage",
    );
  });
});
