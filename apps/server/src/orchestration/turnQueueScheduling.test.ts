import { describe, expect, it } from "vitest";

import {
  findNextDueQueuedTurn,
  isQueuedTurnDue,
  nextQueuedTurnWakeMs,
} from "./turnQueueScheduling.ts";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");

describe("turnQueueScheduling", () => {
  it("treats unscheduled, past, and malformed schedules as due", () => {
    expect(isQueuedTurnDue({ scheduledFor: null }, NOW)).toBe(true);
    expect(isQueuedTurnDue({ scheduledFor: "2026-09-16T11:59:59.000Z" }, NOW)).toBe(true);
    expect(isQueuedTurnDue({ scheduledFor: "not-a-date" }, NOW)).toBe(true);
    expect(isQueuedTurnDue({ scheduledFor: "2026-09-16T12:00:01.000Z" }, NOW)).toBe(false);
  });

  it("skips undue scheduled turns so later unscheduled turns still dispatch", () => {
    const turns = [
      { id: "later", scheduledFor: "2026-09-17T09:00:00.000Z" },
      { id: "now", scheduledFor: null },
    ];
    expect(findNextDueQueuedTurn(turns, NOW)?.id).toBe("now");
    expect(findNextDueQueuedTurn([turns[0]!], NOW)).toBeUndefined();
  });

  it("reports the earliest future release instant", () => {
    expect(nextQueuedTurnWakeMs([{ scheduledFor: null }], NOW)).toBeNull();
    expect(
      nextQueuedTurnWakeMs(
        [
          { scheduledFor: "2026-09-18T09:00:00.000Z" },
          { scheduledFor: "2026-09-16T11:00:00.000Z" },
          { scheduledFor: "2026-09-17T09:00:00.000Z" },
        ],
        NOW,
      ),
    ).toBe(Date.parse("2026-09-17T09:00:00.000Z"));
  });
});
