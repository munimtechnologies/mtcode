import { describe, expect, it } from "vite-plus/test";

import {
  formatGoalStatusMessage,
  GOAL_OBJECTIVE_PREVIEW_MAX_CHARS,
  isGoalCommandForm,
  parseGoalComposerCommand,
  serializeComposerFileLink,
  serializeComposerMentionPath,
  truncateGoalObjectivePreview,
} from "./composerTrigger.ts";

describe("serializeComposerMentionPath", () => {
  it("keeps simple mention paths unquoted", () => {
    expect(serializeComposerMentionPath("src/index.ts")).toBe("src/index.ts");
  });

  it("quotes mention paths containing whitespace", () => {
    expect(serializeComposerMentionPath("docs/My File.md")).toBe('"docs/My File.md"');
  });

  it("escapes quoted mention path content", () => {
    expect(serializeComposerMentionPath('docs/My "File".md')).toBe('"docs/My \\"File\\".md"');
  });
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});

describe("isGoalCommandForm", () => {
  it("detects a leading /goal token in any case, with or without arguments", () => {
    expect(isGoalCommandForm("/goal")).toBe(true);
    expect(isGoalCommandForm("  /GOAL foo  ")).toBe(true);
    expect(isGoalCommandForm("/goal pause")).toBe(true);
  });

  it("detects slash goal at the start", () => {
    expect(isGoalCommandForm("slash goal Reduce p95 below 120ms")).toBe(true);
    expect(isGoalCommandForm("SLASH GOAL")).toBe(true);
  });

  it("detects /goal as the first path-like token", () => {
    expect(isGoalCommandForm("/goal/x")).toBe(true);
    expect(isGoalCommandForm("/goal/extra still a command")).toBe(true);
  });

  it("allows the English word goal elsewhere", () => {
    expect(isGoalCommandForm("the goal of this function is X")).toBe(false);
    expect(isGoalCommandForm("Please /goal this")).toBe(false);
  });
});

describe("parseGoalComposerCommand", () => {
  it("treats /goal with no arguments as status", () => {
    expect(parseGoalComposerCommand(" /goal ")).toEqual({ action: "status" });
  });

  it("classifies pause, resume, and clear from the exact rest", () => {
    expect(parseGoalComposerCommand("/goal pause")).toEqual({ action: "pause" });
    expect(parseGoalComposerCommand("/GOAL resume")).toEqual({ action: "resume" });
    expect(parseGoalComposerCommand("/goal clear")).toEqual({ action: "clear" });
  });

  it("treats any other arguments as the Objective", () => {
    expect(parseGoalComposerCommand("/goal Reduce p95 below 120ms")).toEqual({
      action: "set",
      objective: "Reduce p95 below 120ms",
    });
    expect(parseGoalComposerCommand("/goal the goal of this function is X")).toEqual({
      action: "set",
      objective: "the goal of this function is X",
    });
    expect(parseGoalComposerCommand("/goal complete")).toEqual({
      action: "set",
      objective: "complete",
    });
  });

  it("refuses spoken command forms instead of parsing them into a set", () => {
    expect(parseGoalComposerCommand("slash goal Reduce p95")).toEqual({ action: "refuse" });
  });

  it("returns null when the text is not a command form", () => {
    expect(parseGoalComposerCommand("the goal of this function is X")).toBeNull();
  });
});

describe("formatGoalStatusMessage", () => {
  it("explains how to set an Objective when none exists", () => {
    expect(formatGoalStatusMessage(null)).toBe(
      "No Objective on this Thread. Type /goal followed by the outcome to set one.",
    );
    expect(formatGoalStatusMessage(undefined)).toBe(
      "No Objective on this Thread. Type /goal followed by the outcome to set one.",
    );
  });

  it("shows status and Objective", () => {
    expect(formatGoalStatusMessage({ status: "active", objective: "Reduce p95 below 120ms" })).toBe(
      "Active: Reduce p95 below 120ms",
    );
    expect(formatGoalStatusMessage({ status: "paused", objective: "Reduce p95 below 120ms" })).toBe(
      "Paused: Reduce p95 below 120ms",
    );
    expect(
      formatGoalStatusMessage({ status: "usageLimited", objective: "Reduce p95 below 120ms" }),
    ).toBe("Usage-limited: Reduce p95 below 120ms");
  });
});

describe("truncateGoalObjectivePreview", () => {
  it("keeps short Objectives intact", () => {
    expect(truncateGoalObjectivePreview("Reduce p95")).toBe("Reduce p95");
    expect(truncateGoalObjectivePreview("a".repeat(GOAL_OBJECTIVE_PREVIEW_MAX_CHARS))).toBe(
      "a".repeat(GOAL_OBJECTIVE_PREVIEW_MAX_CHARS),
    );
  });

  it("truncates Objectives longer than 80 characters", () => {
    expect(truncateGoalObjectivePreview("a".repeat(GOAL_OBJECTIVE_PREVIEW_MAX_CHARS + 1))).toBe(
      `${"a".repeat(GOAL_OBJECTIVE_PREVIEW_MAX_CHARS - 1)}…`,
    );
  });
});
