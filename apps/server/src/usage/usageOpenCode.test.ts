// @effect-diagnostics nodeBuiltinImport:off -- SQLite integration coverage needs a real temporary file.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";

import {
  parseOpenCodeUsageRow,
  readOpenCodeUsage,
  resolveOpenCodeDatabasePaths,
} from "./usageOpenCode.ts";

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
          costUsd: 0,
        }),
      ),
    ).toBeNull();
  });
});

describe("resolveOpenCodeDatabasePaths", () => {
  const dataDir = NodePath.resolve("opencode-data");

  it("honors absolute and data-directory-relative OPENCODE_DB overrides", () => {
    const absoluteOverride = NodePath.resolve("custom-opencode.db");
    expect(
      resolveOpenCodeDatabasePaths({
        dataDir,
        databaseOverride: absoluteOverride,
        disableChannelDatabase: undefined,
        directoryEntries: ["opencode.db"],
        path: NodePath,
      }),
    ).toEqual([absoluteOverride]);
    expect(
      resolveOpenCodeDatabasePaths({
        dataDir,
        databaseOverride: "custom/opencode.db",
        disableChannelDatabase: undefined,
        directoryEntries: ["opencode.db"],
        path: NodePath,
      }),
    ).toEqual([NodePath.join(dataDir, "custom/opencode.db")]);
  });

  it("discovers stable and channel databases while ignoring SQLite sidecars", () => {
    expect(
      resolveOpenCodeDatabasePaths({
        dataDir,
        databaseOverride: undefined,
        disableChannelDatabase: undefined,
        directoryEntries: [
          "opencode-nightly.db",
          "opencode.db-wal",
          "opencode.db",
          "opencode-canary.db",
          "notes.txt",
        ],
        path: NodePath,
      }),
    ).toEqual([
      NodePath.join(dataDir, "opencode-canary.db"),
      NodePath.join(dataDir, "opencode-nightly.db"),
      NodePath.join(dataDir, "opencode.db"),
    ]);
  });

  it("uses only the stable database when channels are disabled", () => {
    expect(
      resolveOpenCodeDatabasePaths({
        dataDir,
        databaseOverride: undefined,
        disableChannelDatabase: "true",
        directoryEntries: ["opencode-canary.db"],
        path: NodePath,
      }),
    ).toEqual([NodePath.join(dataDir, "opencode.db")]);
  });

  it("does not try to attach to another process's in-memory database", () => {
    expect(
      resolveOpenCodeDatabasePaths({
        dataDir,
        databaseOverride: ":memory:",
        disableChannelDatabase: undefined,
        directoryEntries: [],
        path: NodePath,
      }),
    ).toEqual([]);
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
      insert.run(
        "msg_placeholder",
        "ses_placeholder",
        2002,
        JSON.stringify({
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        }),
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
