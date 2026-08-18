import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import * as TurnWatchdog from "./TurnWatchdog.ts";

const thread = ThreadId.make("thread-1");
const turn = TurnId.make("turn-1");

const config: TurnWatchdog.TurnWatchdogConfig = {
  stallThresholdMs: 1000,
  hungThresholdMs: null,
};

const withRecovery: TurnWatchdog.TurnWatchdogConfig = {
  stallThresholdMs: 1000,
  hungThresholdMs: 5000,
};

describe("TurnWatchdog", () => {
  it("reports nothing while a watched turn stays active", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    watchdog.recordActivity({ threadId: thread, atMs: 900 });
    expect(watchdog.sweep(1500, config)).toEqual([]);
  });

  it("reports a stalled turn once per silent stretch", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    const findings = watchdog.sweep(1500, config);
    expect(findings).toEqual([
      {
        kind: "stalled",
        threadId: thread,
        turnId: null,
        silentForMs: 1500,
        lastActivityAtMs: 0,
      },
    ]);
    // Same silent stretch: no duplicate report.
    expect(watchdog.sweep(2500, config)).toEqual([]);
  });

  it("re-reports a new stall after the provider recovers", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    expect(watchdog.sweep(1500, config)).toHaveLength(1);
    watchdog.recordActivity({ threadId: thread, atMs: 2000 });
    expect(watchdog.sweep(2500, config)).toEqual([]);
    expect(watchdog.sweep(3500, config)).toHaveLength(1);
  });

  it("does not report a turn that never started or already settled", () => {
    const watchdog = TurnWatchdog.make();
    expect(watchdog.sweep(10_000, config)).toEqual([]);
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    watchdog.recordTurnSettled(thread);
    expect(watchdog.sweep(10_000, config)).toEqual([]);
  });

  it("session death clears the watch", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    watchdog.clearThread(thread);
    expect(watchdog.sweep(10_000, config)).toEqual([]);
  });

  it("activity on an unwatched thread is a no-op", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordActivity({ threadId: thread, atMs: 0 });
    expect(watchdog.sweep(10_000, config)).toEqual([]);
  });

  it("adopts the runtime turn id without restarting the watch", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    // turn.started arrives shortly after with the authoritative id.
    watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: 100 });
    const findings = watchdog.sweep(1500, config);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.turnId).toBe(turn);
    // A repeated turn.started for the SAME turn must not reset the reported
    // flag (no duplicate stall report).
    watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: 100 });
    expect(watchdog.sweep(2500, config)).toEqual([]);
  });

  it("a new turn restarts the watch and reports again", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: 0 });
    expect(watchdog.sweep(1500, config)).toHaveLength(1);
    watchdog.recordTurnStarted({
      threadId: thread,
      turnId: TurnId.make("turn-2"),
      atMs: 2000,
    });
    expect(watchdog.sweep(2500, config)).toEqual([]);
    expect(watchdog.sweep(3500, config)).toHaveLength(1);
  });

  it("open blocking requests pause the clock until resolved", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    watchdog.recordBlockingRequestOpened({ threadId: thread, requestId: "req-1" });
    // Waiting on the human for an hour is not a stall.
    expect(watchdog.sweep(3_600_000, config)).toEqual([]);
    watchdog.recordBlockingRequestResolved({
      threadId: thread,
      requestId: "req-1",
      atMs: 3_600_000,
    });
    // Clock restarts from the resolution.
    expect(watchdog.sweep(3_600_500, config)).toEqual([]);
    expect(watchdog.sweep(3_601_500, config)).toHaveLength(1);
  });

  it("resolving an unknown request id is a no-op", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    watchdog.recordBlockingRequestOpened({ threadId: thread, requestId: "req-1" });
    watchdog.recordBlockingRequestResolved({
      threadId: thread,
      requestId: "req-other",
      atMs: 500,
    });
    expect(watchdog.sweep(3_600_000, config)).toEqual([]);
  });

  it("escalates to hung once when recovery is enabled", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: 0 });
    expect(watchdog.sweep(1500, withRecovery)).toEqual([
      {
        kind: "stalled",
        threadId: thread,
        turnId: turn,
        silentForMs: 1500,
        lastActivityAtMs: 0,
      },
    ]);
    expect(watchdog.sweep(6000, withRecovery)).toEqual([
      {
        kind: "hung",
        threadId: thread,
        turnId: turn,
        silentForMs: 6000,
        lastActivityAtMs: 0,
      },
    ]);
    // Hung is reported at most once per turn.
    expect(watchdog.sweep(60_000, withRecovery)).toEqual([]);
  });

  it("reports hung directly when the stall was never separately observed", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: 0 });
    const findings = watchdog.sweep(6000, withRecovery);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("hung");
    // The implied stall is not re-reported afterwards.
    expect(watchdog.sweep(7000, withRecovery)).toEqual([]);
  });

  it("never reports hung when recovery is disabled", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, turnId: turn, atMs: 0 });
    const findings = watchdog.sweep(60 * 60 * 1000, config);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("stalled");
  });

  it("watches multiple threads independently", () => {
    const otherThread = ThreadId.make("thread-2");
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    watchdog.recordTurnStarted({ threadId: otherThread, atMs: 0 });
    watchdog.recordActivity({ threadId: otherThread, atMs: 1200 });
    const findings = watchdog.sweep(1500, config);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.threadId).toBe(thread);
  });

  it("out-of-order activity never rewinds the clock", () => {
    const watchdog = TurnWatchdog.make();
    watchdog.recordTurnStarted({ threadId: thread, atMs: 0 });
    watchdog.recordActivity({ threadId: thread, atMs: 1000 });
    watchdog.recordActivity({ threadId: thread, atMs: 400 });
    expect(watchdog.sweep(1900, config)).toEqual([]);
  });
});
