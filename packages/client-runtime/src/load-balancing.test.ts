import { describe, expect, it } from "vite-plus/test";

import {
  chooseTaskEnvironment,
  detectTaskPlatform,
  extractMentionedPaths,
  findMentionedEnvironment,
  type TaskRoutingCandidate,
} from "./load-balancing.ts";

describe("detectTaskPlatform", () => {
  it("reads Mac-only work", () => {
    expect(detectTaskPlatform("Build the iOS app with xcodebuild")).toBe("mac");
    expect(detectTaskPlatform("add a note in Notes using osascript")).toBe("mac");
    expect(detectTaskPlatform("run pod install and fix the build")).toBe("mac");
    expect(detectTaskPlatform("check the logs on my Mac")).toBe("mac");
  });

  it("reads Windows-only work", () => {
    expect(detectTaskPlatform("write a PowerShell script that cleans temp")).toBe("windows");
    expect(detectTaskPlatform("run setup.exe and report the result")).toBe("windows");
    expect(detectTaskPlatform("open the .sln in Visual Studio")).toBe("windows");
    expect(detectTaskPlatform("install it with winget")).toBe("windows");
  });

  it("reads Linux-only work", () => {
    expect(detectTaskPlatform("sudo apt install ffmpeg then systemctl restart it")).toBe("linux");
  });

  it("returns null for portable work or when several platforms are named", () => {
    expect(detectTaskPlatform("refactor the parser and run the tests")).toBeNull();
    expect(detectTaskPlatform("open Visual Studio Code and format the file")).toBeNull();
    expect(detectTaskPlatform("close all the browser windows")).toBeNull();
    expect(detectTaskPlatform("port the xcodebuild step to a PowerShell script")).toBeNull();
  });
});

describe("extractMentionedPaths", () => {
  it("finds home-relative, absolute, Windows and relative paths", () => {
    expect(
      extractMentionedPaths(
        "Fix ~/dev/bitloom/src/top.v, compare with /Users/me/notes.md and C:\\Users\\me\\dev\\app, then check dev/mv2.",
      ),
    ).toEqual([
      "~/dev/bitloom/src/top.v",
      "C:\\Users\\me\\dev\\app",
      "/Users/me/notes.md",
      "dev/mv2",
    ]);
  });

  it("keeps quoted paths with spaces", () => {
    expect(extractMentionedPaths('open "~/Documents/Location Changer/app.py" please')).toContain(
      "~/Documents/Location Changer/app.py",
    );
  });

  it("skips URLs and plain words", () => {
    expect(extractMentionedPaths("see https://github.com/org/repo for details")).toEqual([]);
    expect(extractMentionedPaths("make it faster")).toEqual([]);
  });
});

describe("findMentionedEnvironment", () => {
  const machines = [
    { environmentId: "blade", label: "Blade" },
    { environmentId: "mac", label: "MacBook Air" },
  ];

  it("matches a machine named as the place to run", () => {
    expect(findMentionedEnvironment("train the model on Blade tonight", machines)).toBe("blade");
    expect(findMentionedEnvironment("use the MacBook Air for this", machines)).toBe("mac");
  });

  it("ignores passing mentions", () => {
    expect(findMentionedEnvironment("Blade's fan is loud", machines)).toBeNull();
    expect(findMentionedEnvironment("on Bladesmith forums", machines)).toBeNull();
  });
});

describe("chooseTaskEnvironment", () => {
  const now = 100_000;
  const idle = {
    sampledAt: now,
    cpuUtilization: 0.1,
    cpuCount: 8,
    availableMemoryBytes: 12_000,
    totalMemoryBytes: 16_000,
  };
  const busy = { ...idle, cpuUtilization: 0.85, availableMemoryBytes: 2_000 };
  const candidate = (
    environmentId: string,
    platform: TaskRoutingCandidate["platform"],
    resources: TaskRoutingCandidate["resources"],
    existingPaths: readonly string[] | null = [],
  ): TaskRoutingCandidate => ({
    environmentId,
    label: environmentId,
    platform,
    resources,
    weight: 50,
    existingPaths: existingPaths === null ? null : new Set(existingPaths),
  });

  it("sends portable work from a busy Mac to an idle Windows machine", () => {
    expect(
      chooseTaskEnvironment({
        prompt: "refactor the parser",
        candidates: [candidate("mac", "mac", busy), candidate("blade", "windows", idle)],
        mentionedPaths: [],
        platformOverride: null,
        now,
      }),
    ).toEqual({ kind: "chosen", environmentId: "blade", reason: "balanced" });
  });

  it("keeps Mac-only work on the Mac even when it is busy", () => {
    expect(
      chooseTaskEnvironment({
        prompt: "build the iOS app with xcodebuild",
        candidates: [candidate("mac", "mac", busy), candidate("blade", "windows", idle)],
        mentionedPaths: [],
        platformOverride: null,
        now,
      }),
    ).toEqual({ kind: "chosen", environmentId: "mac", reason: "balanced" });
  });

  it("only picks machines that hold every mentioned path that exists somewhere", () => {
    expect(
      chooseTaskEnvironment({
        prompt: "work on ~/dev/bitloom and dev/typo",
        candidates: [
          candidate("mac", "mac", busy, ["~/dev/bitloom"]),
          candidate("blade", "windows", idle, []),
          candidate("dell", "windows", idle, null),
        ],
        mentionedPaths: ["~/dev/bitloom", "dev/typo"],
        platformOverride: null,
        now,
      }),
    ).toEqual({ kind: "chosen", environmentId: "mac", reason: "balanced" });
  });

  it("honours the Run on override over the prompt", () => {
    expect(
      chooseTaskEnvironment({
        prompt: "build the iOS app",
        candidates: [candidate("mac", "mac", idle), candidate("blade", "windows", idle)],
        mentionedPaths: [],
        platformOverride: "windows",
        now,
      }),
    ).toEqual({ kind: "chosen", environmentId: "blade", reason: "balanced" });
  });

  it("goes straight to a machine the prompt names", () => {
    expect(
      chooseTaskEnvironment({
        prompt: "run the training on blade",
        candidates: [candidate("mac", "mac", idle), candidate("blade", "windows", busy)],
        mentionedPaths: [],
        platformOverride: null,
        now,
      }),
    ).toEqual({ kind: "chosen", environmentId: "blade", reason: "named" });
  });

  it("explains why nothing fits", () => {
    const base = { mentionedPaths: [], platformOverride: null, now };
    expect(
      chooseTaskEnvironment({
        ...base,
        prompt: "write a PowerShell script",
        candidates: [candidate("mac", "mac", idle)],
      }),
    ).toEqual({ kind: "none", reason: "no-platform-match" });
    expect(
      chooseTaskEnvironment({
        ...base,
        prompt: "anything",
        candidates: [candidate("mac", "mac", { ...idle, cpuUtilization: 0.99 })],
      }),
    ).toEqual({ kind: "none", reason: "no-capacity" });
    expect(
      chooseTaskEnvironment({
        prompt: "open ~/a and ~/b",
        mentionedPaths: ["~/a", "~/b"],
        platformOverride: null,
        now,
        candidates: [
          candidate("mac", "mac", idle, ["~/a"]),
          candidate("blade", "windows", idle, ["~/b"]),
        ],
      }),
    ).toEqual({ kind: "none", reason: "no-path-match" });
  });
});
