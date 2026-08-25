import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationThreadShell } from "@t3tools/contracts";

import { mtTeamsThreadStatus } from "./statusMapping.ts";

function shell(partial: Partial<OrchestrationThreadShell>): OrchestrationThreadShell {
  return {
    id: "thread-1",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    session: null,
    settledOverride: null,
    settledAt: null,
    ...partial,
  } as unknown as OrchestrationThreadShell;
}

describe("mtTeamsThreadStatus", () => {
  it("maps a starting or running session to working", () => {
    expect(mtTeamsThreadStatus(shell({ session: { status: "starting" } as never }))).toBe(
      "working",
    );
    expect(mtTeamsThreadStatus(shell({ session: { status: "running" } as never }))).toBe("working");
  });

  it("maps live background work to working", () => {
    expect(mtTeamsThreadStatus(shell({ backgroundLiveness: "working" }))).toBe("working");
  });

  it("prefers input-needed over working while a running turn waits on a human", () => {
    expect(
      mtTeamsThreadStatus(
        shell({ hasPendingApprovals: true, session: { status: "running" } as never }),
      ),
    ).toBe("input-needed");
    expect(
      mtTeamsThreadStatus(
        shell({ hasPendingUserInput: true, session: { status: "running" } as never }),
      ),
    ).toBe("input-needed");
  });

  it("maps a settled thread to done", () => {
    expect(mtTeamsThreadStatus(shell({ settledAt: "2026-08-25T00:00:00.000Z" }))).toBe("done");
    expect(mtTeamsThreadStatus(shell({ settledOverride: "settled" }))).toBe("done");
  });

  it("lets a user's active override win over the settled timestamp", () => {
    expect(
      mtTeamsThreadStatus(
        shell({ settledOverride: "active", settledAt: "2026-08-25T00:00:00.000Z" }),
      ),
    ).toBe("idle");
  });

  it("prefers working over done when a settled thread starts a new turn", () => {
    expect(
      mtTeamsThreadStatus(
        shell({ settledAt: "2026-08-25T00:00:00.000Z", session: { status: "running" } as never }),
      ),
    ).toBe("working");
  });

  it("maps everything else, including errored sessions, to idle", () => {
    expect(mtTeamsThreadStatus(shell({}))).toBe("idle");
    expect(mtTeamsThreadStatus(shell({ session: { status: "error" } as never }))).toBe("idle");
    expect(mtTeamsThreadStatus(shell({ session: { status: "ready" } as never }))).toBe("idle");
    expect(mtTeamsThreadStatus(shell({ backgroundLiveness: "monitoring" }))).toBe("idle");
  });
});
