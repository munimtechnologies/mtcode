import { describe, expect, it } from "vite-plus/test";

import { hasQueuedTurnStart } from "./threadSettled.ts";

const NOW = "2026-04-10T00:00:00.000Z";

describe("hasQueuedTurnStart (durable queued turns)", () => {
  it("keeps durable server-queued work blocked beyond the adoption grace window", () => {
    expect(
      hasQueuedTurnStart(
        {
          latestUserMessageAt: "2026-04-01T00:00:00.000Z",
          latestTurn: null,
          session: null,
          hasQueuedTurns: true,
        },
        { now: NOW },
      ),
    ).toBe(true);
  });

  it("falls back to the adoption-window rule when no durable queue is flagged", () => {
    expect(
      hasQueuedTurnStart(
        {
          latestUserMessageAt: "2026-04-01T00:00:00.000Z",
          latestTurn: null,
          session: null,
          hasQueuedTurns: false,
        },
        { now: NOW },
      ),
    ).toBe(false);
  });
});
