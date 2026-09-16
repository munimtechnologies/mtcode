import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  registerCommandTokenOrigin,
  registerProcessOrigin,
  resetProcessOriginsForTest,
  resolveProcessOrigins,
  unregisterProcessOrigin,
} from "./ProcessOrigins.ts";

const server = { pid: 100, ppid: 1, command: "node t3 server" };

describe("resolveProcessOrigins", () => {
  beforeEach(() => {
    resetProcessOriginsForTest();
  });

  it("labels a registered root and every descendant, and leaves the rest alone", () => {
    registerProcessOrigin(200, { kind: "provider", provider: "codex", threadId: "t-1" });
    const origins = resolveProcessOrigins([
      server,
      { pid: 200, ppid: 100, command: "codex app-server" },
      { pid: 300, ppid: 200, command: "/bin/zsh -lc 'pnpm test'" },
      { pid: 400, ppid: 300, command: "node vitest" },
      { pid: 500, ppid: 100, command: "git status" },
    ]);
    expect(origins.get(200)).toEqual({ kind: "provider", provider: "codex", threadId: "t-1" });
    expect(origins.get(400)).toEqual({ kind: "provider", provider: "codex", threadId: "t-1" });
    expect(origins.has(500)).toBe(false);
    expect(origins.has(100)).toBe(false);
  });

  it("matches Claude sessions by the session id in the command line", () => {
    registerCommandTokenOrigin("6f1c2b8e-1234-4a5b-9c0d-abcdefabcdef", {
      kind: "provider",
      provider: "claude",
      threadId: "t-2",
    });
    const origins = resolveProcessOrigins([
      server,
      {
        pid: 210,
        ppid: 100,
        command:
          "claude --output-format stream-json --session-id 6f1c2b8e-1234-4a5b-9c0d-abcdefabcdef",
      },
      { pid: 310, ppid: 210, command: "bash -c ls" },
    ]);
    expect(origins.get(310)?.threadId).toBe("t-2");
  });

  it("forgets unregistered roots and survives parent cycles", () => {
    registerProcessOrigin(220, { kind: "terminal", threadId: "t-3" });
    unregisterProcessOrigin(220);
    const origins = resolveProcessOrigins([
      { pid: 220, ppid: 230, command: "zsh" },
      { pid: 230, ppid: 220, command: "zsh" },
    ]);
    expect(origins.size).toBe(0);
  });
});
