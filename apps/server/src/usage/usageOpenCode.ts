/**
 * Read-only OpenCode usage database access.
 *
 * OpenCode stores one usage-bearing JSON object per assistant message in its
 * global SQLite database. Only the scalar fields needed for usage reporting are
 * selected; prompts, responses, and tool output never leave the database.
 *
 * @module usageOpenCode
 */
import type { UsageRecord } from "./usageTranscripts.ts";

// Kept non-literal so the Node-targeted bundle leaves Bun's runtime module
// external without asking its resolver to load a module Node cannot provide.
const BUN_SQLITE_MODULE_ID: string = "bun:sqlite";

const OPEN_CODE_USAGE_QUERY = `
  SELECT
    id AS messageId,
    session_id AS sessionId,
    time_created AS timestampMs,
    json_extract(data, '$.providerID') AS providerId,
    json_extract(data, '$.modelID') AS modelId,
    json_extract(data, '$.tokens.input') AS inputTokens,
    json_extract(data, '$.tokens.output') AS outputTokens,
    json_extract(data, '$.tokens.reasoning') AS reasoningTokens,
    json_extract(data, '$.tokens.cache.read') AS cacheReadTokens,
    json_extract(data, '$.tokens.cache.write') AS cacheWriteTokens,
    json_extract(data, '$.cost') AS costUsd
  FROM message
  WHERE time_created >= ?
    AND json_valid(data)
    AND json_extract(data, '$.role') = 'assistant'
`;

const OPEN_CODE_MALFORMED_QUERY = `
  SELECT COUNT(*) AS records
  FROM message
  WHERE time_created >= ? AND NOT json_valid(data)
`;

interface OpenCodeUsageRow {
  readonly messageId?: unknown;
  readonly sessionId?: unknown;
  readonly timestampMs?: unknown;
  readonly providerId?: unknown;
  readonly modelId?: unknown;
  readonly inputTokens?: unknown;
  readonly outputTokens?: unknown;
  readonly reasoningTokens?: unknown;
  readonly cacheReadTokens?: unknown;
  readonly cacheWriteTokens?: unknown;
  readonly costUsd?: unknown;
}

interface CountRow {
  readonly records?: unknown;
}

interface SqliteStatement {
  readonly all: (sinceMs: number) => readonly unknown[];
}

interface SqliteDatabase {
  readonly statement: (sql: string) => SqliteStatement;
  readonly close: () => void;
}

export interface OpenCodeUsageRead {
  readonly records: readonly UsageRecord[];
  readonly malformedRecords: number;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Converts one assistant-message projection into the shared usage shape. */
export function parseOpenCodeUsageRow(value: unknown): UsageRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as OpenCodeUsageRow;
  if (
    typeof row.messageId !== "string" ||
    row.messageId.length === 0 ||
    typeof row.sessionId !== "string" ||
    typeof row.timestampMs !== "number" ||
    !Number.isFinite(row.timestampMs) ||
    typeof row.providerId !== "string" ||
    row.providerId.length === 0 ||
    typeof row.modelId !== "string" ||
    row.modelId.length === 0
  ) {
    return null;
  }

  const uncachedInputTokens = nonNegativeInt(row.inputTokens);
  const cachedInputTokens = nonNegativeInt(row.cacheReadTokens);
  const cacheCreationTokens = nonNegativeInt(row.cacheWriteTokens);
  const generatedOutputTokens = nonNegativeInt(row.outputTokens);
  const reasoningTokens = nonNegativeInt(row.reasoningTokens);

  // OpenCode reports generated text and reasoning as disjoint counts. The
  // shared contract treats reasoning as a subset of output, so combine them in
  // outputTokens while retaining the reasoning slice for the token-mix UI.
  const outputTokens = generatedOutputTokens + reasoningTokens;
  if (
    uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens === 0 &&
    finiteNonNegative(row.costUsd) === null
  ) {
    return null;
  }

  return {
    provider: "opencode",
    timestampMs: row.timestampMs,
    model: `${row.providerId}/${row.modelId}`,
    sessionId: row.sessionId,
    totals: {
      uncachedInputTokens,
      cachedInputTokens,
      cacheCreationTokens,
      outputTokens,
      reasoningTokens,
    },
    reportedCostUsd: finiteNonNegative(row.costUsd),
    dedupeKey: `opencode:${row.messageId}`,
  };
}

async function openDatabase(databasePath: string): Promise<SqliteDatabase> {
  if (process.versions.bun !== undefined) {
    const { Database } = (await import(BUN_SQLITE_MODULE_ID)) as typeof import("bun:sqlite");
    const database = new Database(databasePath, { readonly: true, create: false });
    return {
      statement: (sql) => {
        const statement = database.query(sql);
        return { all: (sinceMs) => statement.all(sinceMs) };
      },
      close: () => database.close(),
    };
  }

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  return {
    statement: (sql) => {
      const statement = database.prepare(sql);
      return { all: (sinceMs) => statement.all(sinceMs) };
    },
    close: () => database.close(),
  };
}

/**
 * Reads assistant usage at or after `sinceMs`, returning `null` when the
 * database is unavailable or has an unsupported schema.
 */
export async function readOpenCodeUsage(
  databasePath: string,
  sinceMs: number,
): Promise<OpenCodeUsageRead | null> {
  let database: SqliteDatabase | undefined;
  try {
    database = await openDatabase(databasePath);
    const rows = database.statement(OPEN_CODE_USAGE_QUERY).all(sinceMs);
    const records: UsageRecord[] = [];
    let malformedRecords = 0;
    for (const row of rows) {
      const record = parseOpenCodeUsageRow(row);
      if (record === null) malformedRecords += 1;
      else records.push(record);
    }

    const [malformed] = database.statement(OPEN_CODE_MALFORMED_QUERY).all(sinceMs);
    const invalidJsonRecords = nonNegativeInt((malformed as CountRow | undefined)?.records);
    return { records, malformedRecords: malformedRecords + invalidJsonRecords };
  } catch {
    return null;
  } finally {
    try {
      database?.close();
    } catch {
      // A failed close must not turn a successful read into a failed RPC.
    }
  }
}
