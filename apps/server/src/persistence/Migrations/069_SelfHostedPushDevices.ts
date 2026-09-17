import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS self_hosted_push_devices (
      device_id TEXT PRIMARY KEY NOT NULL,
      expo_push_token TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
