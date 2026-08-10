// @effect-diagnostics nodeBuiltinImport:off -- SQLite integration coverage needs a real temporary file.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";

import { parseOpenCodeUsageRow, readOpenCodeUsage } from "./usageOpenCode.ts";

function row(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "msg_01",
    sessionId: "ses_01",
    timestampMs: 1_786_053_607_405,
    providerId: "github-copilot",
    modelId: "gpt-5.6-sol",
    inputTokens: 4194,
    outputTokens: 91,
    reasoningTokens: 263,
    cacheReadTokens: 22_912,
    cacheWriteTokens: 17,
    costUsd: 0.42,
    ...overrides,
  };
}

describe("parseOpenCodeUsageRow", () => {
  it("maps OpenCode assistant usage into the shared token convention", () => {
    const record = parseOpenCodeUsageRow(row());

    expect(record).toEqual({
      provider: "opencode",
      timestampMs: 1_786_053_607_405,
      model: "github-copilot/gpt-5.6-sol",
      sessionId: "ses_01",
      totals: {
        uncachedInputTokens: 4194,
        cachedInputTokens: 22_912,
        cacheCreationTokens: 17,
        outputTokens: 354,
        reasoningTokens: 263,
      },
      reportedCostUsd: 0.42,
      dedupeKey: "opencode:msg_01",
    });
  });

  it("keeps a reported zero cost for free OpenCode models", () => {
    expect(parseOpenCodeUsageRow(row({ costUsd: 0 }))?.reportedCostUsd).toBe(0);
  });

  it("falls back to model pricing when cost is absent", () => {
    expect(parseOpenCodeUsageRow(row({ costUsd: null }))?.reportedCostUsd).toBeNull();
  });

  it("ignores malformed rows and empty assistant attempts", () => {
    expect(parseOpenCodeUsageRow(row({ modelId: null }))).toBeNull();
    expect(
      parseOpenCodeUsageRow(
        row({
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("readOpenCodeUsage", () => {
  it("reads assistant usage without selecting conversation content", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-opencode-usage-"));
    const databasePath = NodePath.join(directory, "opencode.db");
    let database: NodeSqlite.DatabaseSync | undefined;
    try {
      database = new NodeSqlite.DatabaseSync(databasePath);
      database.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          data TEXT NOT NULL
        )
      `);
      const insert = database.prepare(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      );
      insert.run(
        "msg_01",
        "ses_01",
        2000,
        JSON.stringify({
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 10, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
          cost: 0.25,
          hiddenConversationContent: "must never be selected",
        }),
      );
      insert.run(
        "msg_user",
        "ses_01",
        2001,
        JSON.stringify({ role: "user", content: "not usage" }),
      );
      database.close();
      database = undefined;

      const result = await readOpenCodeUsage(databasePath, 1500);

      expect(result?.malformedRecords).toBe(0);
      expect(result?.records).toHaveLength(1);
      expect(result?.records[0]).toMatchObject({
        provider: "opencode",
        model: "openai/gpt-5",
        totals: { outputTokens: 5, reasoningTokens: 3 },
      });
      expect(result?.records[0]).not.toHaveProperty("hiddenConversationContent");
    } finally {
      database?.close();
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
});
