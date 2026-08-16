import { describe, expect, it } from "vite-plus/test";

import { buildGoalContinuationPrompt, goalContinuationCommandId } from "./goalContinuation.ts";

describe("buildGoalContinuationPrompt", () => {
  it("names the Objective and complete/blocked markers without saying goal", () => {
    const objective = "Reduce p95 below 120ms";
    const prompt = buildGoalContinuationPrompt(objective);
    expect(prompt).toContain(objective);
    expect(prompt).toContain("<objective_complete>");
    expect(prompt).toContain("</objective_complete>");
    expect(prompt).toContain("<objective_blocked>");
    expect(prompt).toContain("</objective_blocked>");
    expect(prompt).not.toMatch(/\bgoal\b/i);
    expect(prompt.toLowerCase()).not.toContain("/goal");
    expect(prompt.toLowerCase()).not.toContain("slash goal");
  });
});

describe("goalContinuationCommandId", () => {
  const input = {
    threadId: "thread-1",
    goalUpdatedAt: "2026-01-01T00:00:00.000Z",
    completedTurnId: "turn-1",
  } as const;

  it("is stable per Goal generation and completed Turn", () => {
    expect(goalContinuationCommandId(input)).toBe(
      "goal-continue:thread-1:2026-01-01T00:00:00.000Z:turn-1",
    );
    expect(goalContinuationCommandId(input)).toBe(goalContinuationCommandId({ ...input }));
  });

  it("differs when completedTurnId or goalUpdatedAt changes", () => {
    const baseline = goalContinuationCommandId(input);
    expect(
      goalContinuationCommandId({
        ...input,
        completedTurnId: "turn-2",
      }),
    ).not.toBe(baseline);
    expect(
      goalContinuationCommandId({
        ...input,
        goalUpdatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).not.toBe(baseline);
  });
});
