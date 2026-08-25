import { describe, expect, it } from "vite-plus/test";

import type { MtTeamsThreadStatus } from "./client";
import { mtTeamsStatusDotClassName, mtTeamsStatusLabel } from "./statusDot";

const ALL_STATUSES: ReadonlyArray<MtTeamsThreadStatus> = [
  "working",
  "input-needed",
  "done",
  "idle",
];

describe("mtTeamsStatusDotClassName", () => {
  it("maps each status to its semantic dot color", () => {
    expect(mtTeamsStatusDotClassName("working")).toBe("bg-blue-500");
    expect(mtTeamsStatusDotClassName("input-needed")).toBe("bg-warning");
    expect(mtTeamsStatusDotClassName("done")).toBe("bg-success");
    expect(mtTeamsStatusDotClassName("idle")).toBe("bg-muted-foreground/40");
  });

  it("never emits a continuous animation class", () => {
    for (const status of ALL_STATUSES) {
      const className = mtTeamsStatusDotClassName(status);
      expect(className).not.toMatch(/animate|ping|pulse/);
    }
  });
});

describe("mtTeamsStatusLabel", () => {
  it("labels every status", () => {
    expect(ALL_STATUSES.map(mtTeamsStatusLabel)).toEqual([
      "Working",
      "Needs input",
      "Done",
      "Idle",
    ]);
  });
});
