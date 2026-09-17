import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Lifecycle overrides for external-backed Pi threads. Native Pi sessions live
 * in `~/.pi/agent/sessions`, not in the orchestration tables, so their
 * settled/active state and the command receipts behind it get their own rows.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pi_external_lifecycle_overrides (
      source_key TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      lifecycle_override TEXT NOT NULL
        CHECK (lifecycle_override IN ('settled', 'active')),
      observed_file_size INTEGER NOT NULL,
      observed_file_mtime_ms REAL NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pi_external_lifecycle_command_receipts (
      command_id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      lifecycle_override TEXT NOT NULL
        CHECK (lifecycle_override IN ('settled', 'active')),
      observed_file_size INTEGER NOT NULL,
      observed_file_mtime_ms REAL NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
