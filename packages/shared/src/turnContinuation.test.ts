import { describe, expect, it } from "vite-plus/test";

import { buildInterruptedTurnContinuationPrompt } from "./turnContinuation.ts";

describe("buildInterruptedTurnContinuationPrompt", () => {
  it("asks to resume the stopped work without repeating it", () => {
    const prompt = buildInterruptedTurnContinuationPrompt();
    expect(prompt).toContain("interrupted");
    expect(prompt).toContain("Do not repeat work that is already done");
  });
});
