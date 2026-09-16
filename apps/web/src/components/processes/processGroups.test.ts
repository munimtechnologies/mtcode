import type { ServerProcessDiagnosticsEntry } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  SERVER_HELPERS_GROUP_LABEL,
  formatBytes,
  groupProcesses,
  processDisplayName,
} from "./processGroups";

function entry(
  pid: number,
  command: string,
  origin?: ServerProcessDiagnosticsEntry["origin"],
  depth = 0,
): ServerProcessDiagnosticsEntry {
  return {
    pid,
    startTimeMs: pid * 10,
    ppid: 1,
    pgid: Option.none(),
    status: "Running",
    cpuPercent: 0,
    rssBytes: 1024,
    elapsed: "0:10",
    command,
    depth,
    childPids: [],
    ...(origin ? { origin } : {}),
  };
}

describe("groupProcesses", () => {
  it("groups dev servers found by their ports under the workspace their directory names", () => {
    const listener = (pid: number, cwd: string, port: number): ServerProcessDiagnosticsEntry => ({
      ...entry(pid, "deno run dev", { kind: "listener" }),
      port,
      cwd,
    });
    const groups = groupProcesses(
      [
        entry(1, "codex app-server", { kind: "provider", provider: "codex", threadId: "t-1" }),
        listener(2, "/repo/finance", 3000),
        listener(3, "/repo/finance/.worktrees/fix", 3001),
        listener(4, "/elsewhere", 4000),
      ],
      (threadId) =>
        threadId === "t-1" ? "Fix the login bug" : threadId === "t-2" ? "Try it" : null,
      (cwd) =>
        cwd.startsWith("/repo/finance/.worktrees/fix")
          ? { label: "Try it", threadId: "t-2" }
          : cwd.startsWith("/repo/finance")
            ? { label: "finance", threadId: null }
            : null,
    );
    expect(
      groups.map((group) => [group.kind, group.label, group.processes.map((p) => p.pid)]),
    ).toEqual([
      ["provider", "Codex · Fix the login bug", [1]],
      ["listener", "Dev servers · finance", [2]],
      ["listener", "Dev servers · Try it", [3]],
      ["listener", "Dev servers · Unknown workspace", [4]],
    ]);
    expect(groups[2]?.threadId).toBe("t-2");
  });

  it("groups by origin, names groups after provider and thread, and orders threads first", () => {
    const titles: Record<string, string> = { "t-1": "Fix login", "t-2": "Write docs" };
    const groups = groupProcesses(
      [
        entry(10, "git status"),
        entry(20, "codex app-server", { kind: "provider", provider: "codex", threadId: "t-2" }),
        entry(21, "zsh -lc pnpm test", { kind: "provider", provider: "codex", threadId: "t-2" }, 1),
        entry(30, "/bin/zsh", { kind: "terminal", threadId: "t-1" }),
        entry(40, "claude --session-id abc", {
          kind: "provider",
          provider: "claude",
          threadId: "t-1",
        }),
      ],
      (threadId) => titles[threadId] ?? null,
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Claude · Fix login",
      "Codex · Write docs",
      "Terminal · Fix login",
      SERVER_HELPERS_GROUP_LABEL,
    ]);
    expect(groups[1]?.processes.map((process) => process.pid)).toEqual([20, 21]);
    expect(groups[3]?.kind).toBe("server");
  });

  it("falls back to a neutral thread label when the thread is unknown", () => {
    const groups = groupProcesses(
      [entry(50, "cursor-agent acp", { kind: "provider", provider: "cursor", threadId: "gone" })],
      () => null,
    );
    expect(groups[0]?.label).toBe("Cursor · Untitled thread");
  });
});

describe("process formatting", () => {
  it("shows the executable name and human byte sizes", () => {
    expect(processDisplayName("/usr/local/bin/codex app-server --flag")).toBe("codex");
    expect(processDisplayName('"C:\\tools\\claude.exe" --print')).toBe("claude.exe");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
    expect(formatBytes(15.5 * 1024 * 1024)).toBe("15.5 MB");
  });
});
