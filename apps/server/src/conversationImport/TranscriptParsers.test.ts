import { describe, expect, it } from "@effect/vitest";

import { parseClaudeTranscript, parseCodexTranscript } from "./TranscriptParsers.ts";

function transcript(records: ReadonlyArray<unknown>): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function activityToolCallId(activity: { readonly payload: unknown }): unknown {
  if (
    activity.payload === null ||
    typeof activity.payload !== "object" ||
    !("data" in activity.payload)
  ) {
    return undefined;
  }
  const data = activity.payload.data;
  return data !== null && typeof data === "object" && "toolCallId" in data
    ? data.toolCallId
    : undefined;
}

describe("external conversation transcript parsers", () => {
  it("preserves Claude messages, tool input, tool output, and continuation points", () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const parsed = parseClaudeTranscript(
      transcript([
        {
          type: "user",
          uuid: "user-1",
          parentUuid: null,
          sessionId,
          cwd: "/workspace/project",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { role: "user", content: "Inspect the repository" },
        },
        {
          type: "assistant",
          uuid: "assistant-1",
          parentUuid: "user-1",
          sessionId,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [
              { type: "text", text: "I will inspect it." },
              {
                type: "tool_use",
                id: "tool-1",
                name: "Bash",
                input: { command: "git status --short" },
              },
            ],
          },
        },
        {
          type: "user",
          uuid: "tool-result-1",
          parentUuid: "assistant-1",
          sessionId,
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: " M src/app.ts",
                is_error: false,
              },
            ],
          },
        },
        {
          type: "assistant",
          uuid: "assistant-2",
          parentUuid: "tool-result-1",
          sessionId,
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [{ type: "text", text: "One file is modified." }],
          },
        },
      ]),
      sessionId,
    );

    expect(parsed?.cwd).toBe("/workspace/project");
    expect(parsed?.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "Inspect the repository"],
      ["assistant", "I will inspect it."],
      ["assistant", "One file is modified."],
    ]);
    expect(parsed?.activities).toHaveLength(1);
    expect(parsed?.activities[0]).toMatchObject({
      kind: "tool.completed",
      payload: {
        itemType: "command_execution",
        data: {
          toolCallId: "tool-1",
          toolName: "Bash",
          input: { command: "git status --short" },
          command: "git status --short",
          result: " M src/app.ts",
          output: " M src/app.ts",
        },
      },
    });
    expect(parsed?.resumeCursor).toMatchObject({
      resume: sessionId,
      resumeSessionAt: "assistant-2",
      turnCount: 1,
    });
  });

  it("uses Codex event messages without importing hidden prompt records", () => {
    const threadId = "22222222-2222-4222-8222-222222222222";
    const turnId = "33333333-3333-4333-8333-333333333333";
    const parsed = parseCodexTranscript(
      transcript([
        {
          type: "session_meta",
          timestamp: "2026-02-01T00:00:00.000Z",
          payload: { id: threadId, cwd: "/workspace/codex" },
        },
        {
          type: "turn_context",
          timestamp: "2026-02-01T00:00:01.000Z",
          payload: { turn_id: turnId, model: "gpt-5.3-codex", cwd: "/workspace/codex" },
        },
        {
          type: "response_item",
          timestamp: "2026-02-01T00:00:01.100Z",
          payload: { type: "message", role: "developer", content: "hidden instructions" },
        },
        {
          type: "event_msg",
          timestamp: "2026-02-01T00:00:02.000Z",
          payload: { type: "user_message", message: "Run the tests" },
        },
        {
          type: "response_item",
          timestamp: "2026-02-01T00:00:03.000Z",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: '{"cmd":"vp test run"}',
            call_id: "call-1",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-02-01T00:00:04.000Z",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "2 tests passed",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-02-01T00:00:04.100Z",
          payload: {
            type: "web_search_call",
            id: "search-1",
            status: "completed",
            action: { type: "search", query: "Effect documentation" },
          },
        },
        {
          type: "response_item",
          timestamp: "2026-02-01T00:00:04.200Z",
          payload: {
            type: "local_shell_call",
            call_id: "shell-1",
            status: "completed",
            action: { type: "exec", command: "pwd" },
          },
        },
        {
          type: "event_msg",
          timestamp: "2026-02-01T00:00:05.000Z",
          payload: { type: "agent_message", message: "The tests pass." },
        },
      ]),
      threadId,
    );

    expect(parsed?.messages.map((message) => message.text)).toEqual([
      "Run the tests",
      "The tests pass.",
    ]);
    expect(parsed?.messages.every((message) => message.turnId === turnId)).toBe(true);
    expect(parsed?.activities).toHaveLength(3);
    expect(
      parsed?.activities.find((activity) => activityToolCallId(activity) === "call-1"),
    ).toMatchObject({
      kind: "tool.completed",
      payload: {
        itemType: "command_execution",
        data: {
          input: { cmd: "vp test run" },
          command: "vp test run",
          rawInput: '{"cmd":"vp test run"}',
          result: "2 tests passed",
          output: "2 tests passed",
        },
      },
    });
    expect(
      parsed?.activities.find((activity) => activityToolCallId(activity) === "search-1"),
    ).toMatchObject({
      kind: "tool.completed",
      payload: {
        itemType: "web_search",
        data: {
          input: { type: "search", query: "Effect documentation" },
          native: { call: { type: "web_search_call" } },
        },
      },
    });
    expect(
      parsed?.activities.find((activity) => activityToolCallId(activity) === "shell-1"),
    ).toMatchObject({
      kind: "tool.completed",
      payload: {
        itemType: "command_execution",
        data: { input: { type: "exec", command: "pwd" } },
      },
    });
    expect(parsed?.resumeCursor).toEqual({ threadId });
  });

  it("creates stable pagination turns when Codex history has no native turn ids", () => {
    const threadId = "44444444-4444-4444-8444-444444444444";
    const parsed = parseCodexTranscript(
      transcript([
        {
          type: "session_meta",
          timestamp: "2026-02-01T00:00:00.000Z",
          payload: { id: threadId },
        },
        {
          type: "turn_context",
          timestamp: "2026-02-01T00:00:01.000Z",
          payload: { model: "gpt-5.3-codex" },
        },
        {
          type: "event_msg",
          timestamp: "2026-02-01T00:00:02.000Z",
          payload: { type: "user_message", message: "First turn" },
        },
        {
          type: "event_msg",
          timestamp: "2026-02-01T00:00:03.000Z",
          payload: { type: "agent_message", message: "First response" },
        },
        {
          type: "turn_context",
          timestamp: "2026-02-01T00:00:04.000Z",
          payload: { model: "gpt-5.3-codex" },
        },
        {
          type: "event_msg",
          timestamp: "2026-02-01T00:00:05.000Z",
          payload: { type: "user_message", message: "Second turn" },
        },
        {
          type: "event_msg",
          timestamp: "2026-02-01T00:00:06.000Z",
          payload: { type: "agent_message", message: "Second response" },
        },
      ]),
      threadId,
    );

    const turnIds = parsed?.messages.map((message) => message.turnId);
    expect(turnIds?.every((turnId) => turnId !== null)).toBe(true);
    expect(turnIds?.[0]).toBe(turnIds?.[1]);
    expect(turnIds?.[2]).toBe(turnIds?.[3]);
    expect(turnIds?.[0]).not.toBe(turnIds?.[2]);
  });
});
