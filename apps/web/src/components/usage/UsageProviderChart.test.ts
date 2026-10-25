import { describe, expect, it } from "vite-plus/test";

import { buildPeriodColumns } from "./UsageProviderChart";

describe("buildPeriodColumns", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const byDay = new Map([
    [
      "2026-08-01",
      {
        day: "2026-08-01",
        costUsd: 52,
        totalTokens: 520,
        byProvider: new Map([
          ["codex" as const, { costUsd: 10, totalTokens: 100 }],
          ["claude" as const, { costUsd: 20, totalTokens: 200 }],
          ["grok" as const, { costUsd: 7, totalTokens: 70 }],
          ["opencode" as const, { costUsd: 3, totalTokens: 30 }],
          ["pi" as const, { costUsd: 5, totalTokens: 50 }],
          ["muse" as const, { costUsd: 7, totalTokens: 70 }],
        ]),
      },
    ],
    [
      "2026-08-03",
      {
        day: "2026-08-03",
        costUsd: 5,
        totalTokens: 50,
        byProvider: new Map([["claude" as const, { costUsd: 5, totalTokens: 50 }]]),
      },
    ],
  ]);

  it("plots each day on its own", () => {
    expect(buildPeriodColumns(days, byDay, "cost").map((column) => column.total)).toEqual([
      52, 0, 5,
    ]);
  });

  it("reads the requested metric", () => {
    expect(buildPeriodColumns(days, byDay, "tokens").map((column) => column.total)).toEqual([
      520, 0, 50,
    ]);
  });

  it("keeps band values absolute rather than cumulative", () => {
    const [first] = buildPeriodColumns(days, byDay, "cost");

    expect(first?.bands).toEqual([
      { provider: "codex", value: 10 },
      { provider: "claude", value: 20 },
      { provider: "cursor", value: 0 },
      { provider: "grok", value: 7 },
      { provider: "opencode", value: 3 },
      { provider: "antigravity", value: 0 },
      { provider: "pi", value: 5 },
      { provider: "muse", value: 7 },
    ]);
  });
});
