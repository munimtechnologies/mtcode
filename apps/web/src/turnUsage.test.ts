import { describe, expect, it } from "vite-plus/test";

import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  formatResetIn,
  formatTurnUsage,
  isFreePlan,
  latestTurnUsage,
  parseTurnUsagePayload,
  TURN_USAGE_ACTIVITY_KIND,
  turnUsageByTurnId,
} from "./turnUsage";

describe("turn usage", () => {
  it("parses payloads defensively", () => {
    expect(parseTurnUsagePayload(null)).toBeNull();
    expect(parseTurnUsagePayload("nope")).toBeNull();
    expect(
      parseTurnUsagePayload({
        inputTokens: 1200,
        outputTokens: "many",
        totalCostUsd: 0.42,
        windowDeltaPercent: 2.5,
        windowUsedPercent: 61,
        windowLabel: "5h window",
        billing: "included",
      }),
    ).toEqual({
      provider: null,
      inputTokens: 1200,
      outputTokens: null,
      totalCostUsd: 0.42,
      windowDeltaPercent: 2.5,
      windowUsedPercent: 61,
      windowLabel: "5h window",
      windows: [{ label: "5h window", usedPercent: 61 }],
      billing: "included",
    });
    expect(parseTurnUsagePayload({ billing: "mystery" })?.billing).toBe("unknown");
  });

  it("keeps a window's reset time only when it is a valid timestamp", () => {
    expect(
      parseTurnUsagePayload({
        windows: [
          { label: "5h Limit", usedPercent: 40, resetsAt: "2026-09-02T21:30:00.000Z" },
          { label: "7d Limit", usedPercent: 10, resetsAt: "soon" },
        ],
      })?.windows,
    ).toEqual([
      { label: "5h Limit", usedPercent: 40, resetsAt: "2026-09-02T21:30:00.000Z" },
      { label: "7d Limit", usedPercent: 10 },
    ]);
  });

  it("formats the time until a window resets", () => {
    const now = Date.parse("2026-09-02T18:00:00.000Z");
    expect(formatResetIn("2026-09-02T21:30:00.000Z", now)).toBe("3h 30m");
    expect(formatResetIn("2026-09-02T18:45:00.000Z", now)).toBe("45m");
    expect(formatResetIn("2026-09-02T20:00:00.000Z", now)).toBe("2h");
    expect(formatResetIn("2026-09-05T11:00:00.000Z", now)).toBe("2d 17h");
    expect(formatResetIn("2026-09-02T17:59:00.000Z", now)).toBe("now");
    expect(formatResetIn("garbage", now)).toBeNull();
  });

  it("indexes usage activities by turn", () => {
    const activities = [
      { kind: TURN_USAGE_ACTIVITY_KIND, turnId: "turn-1", payload: { billing: "included" } },
      { kind: "provider.other", turnId: "turn-2", payload: { billing: "included" } },
      { kind: TURN_USAGE_ACTIVITY_KIND, turnId: null, payload: { billing: "included" } },
    ] as unknown as ReadonlyArray<OrchestrationThreadActivity>;
    const map = turnUsageByTurnId(activities);
    expect([...map.keys()]).toEqual(["turn-1"]);
  });

  it("formats free, percentage, and billed turns with the plan suffix", () => {
    const base = parseTurnUsagePayload({
      provider: "claude",
      inputTokens: 15_000,
      outputTokens: 800,
    })!;
    expect(formatTurnUsage({ ...base, billing: "included" })?.headline).toBe("Included · Claude");
    // An unchanged window still counted the turn: say so instead of calling it free.
    expect(
      formatTurnUsage(
        { ...base, windowDeltaPercent: 0, windowLabel: "5h Limit", billing: "included" },
        "Claude Max 20x",
      ),
    ).toMatchObject({ headline: "<1% of 5h Limit · Claude Max 20x", tone: "default" });
    expect(
      formatTurnUsage(
        { ...base, windowDeltaPercent: 3.2, windowLabel: "Weekly Limit", billing: "included" },
        "Claude Max 20x",
      )?.headline,
    ).toBe("3% of Weekly Limit · Claude Max 20x");
    expect(
      formatTurnUsage({ ...base, windowDeltaPercent: 0.4, billing: "included" })?.headline,
    ).toBe("<1% of Limit · Claude");
    // A reported window with no baseline: covered by the plan, cost only in the detail.
    expect(
      formatTurnUsage(
        {
          ...base,
          windowUsedPercent: 0,
          windowLabel: "5h Limit",
          totalCostUsd: 0.17,
          billing: "included",
        },
        "Claude Max 20x",
      ),
    ).toMatchObject({
      headline: "Included · Claude Max 20x",
      detail: "15k in / 800 out · 0% of 5h Limit used · $0.170",
    });
    const billed = formatTurnUsage({ ...base, totalCostUsd: 1.5, billing: "overage" }, "Codex");
    expect(billed).toMatchObject({
      headline: "$1.50 · billed over Limit · Codex",
      detail: "15k in / 800 out",
      tone: "overage",
    });
    expect(
      formatTurnUsage({ ...base, provider: null, totalCostUsd: 0.2, billing: "unknown" })?.headline,
    ).toBe("$0.20");
  });

  it("labels reportless turns from the plan: free plans say free, paid plans stay silent", () => {
    const silent = parseTurnUsagePayload({ provider: "cursor", billing: "unknown" })!;
    expect(formatTurnUsage(silent, "Cursor Free")).toMatchObject({
      headline: "Free · Cursor Free",
      tone: "free",
    });
    expect(formatTurnUsage(silent, "Cursor Pro")).toBeNull();
    expect(formatTurnUsage(silent, null)).toBeNull();
    expect(isFreePlan("Cursor Free")).toBe(true);
    expect(isFreePlan("Claude Max 20x")).toBe(false);
    expect(isFreePlan("Freedom Tier")).toBe(false);
  });

  it("finds the newest usage report in a thread", () => {
    const activities = [
      { kind: TURN_USAGE_ACTIVITY_KIND, turnId: "a", payload: { windowUsedPercent: 10 } },
      { kind: "other", turnId: "b", payload: {} },
      { kind: TURN_USAGE_ACTIVITY_KIND, turnId: "c", payload: { windowUsedPercent: 30 } },
    ] as unknown as ReadonlyArray<OrchestrationThreadActivity>;
    expect(latestTurnUsage(activities)?.windowUsedPercent).toBe(30);
    expect(latestTurnUsage([])).toBeNull();
  });
});

describe("formatTurnUsage for a refused turn", () => {
  it("says Limit Reached with the plan instead of a share of the window", () => {
    const limited = parseTurnUsagePayload({
      provider: "cursor",
      windowUsedPercent: 100,
      windowLabel: "Plan Limit",
      billing: "limited",
    })!;
    expect(limited.billing).toBe("limited");
    expect(formatTurnUsage(limited, "Cursor Free")).toMatchObject({
      headline: "Limit Reached · Cursor Free",
      tone: "overage",
    });
    expect(formatTurnUsage(limited, null)?.headline).toBe("Limit Reached · Cursor");
  });
});
