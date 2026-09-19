import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("067_ProjectionThreadTurnQueueRecurrence", (it) => {
  it.effect("adds a nullable recurrence_json column to queued turns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 67 });
      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_thread_turn_queue)
      `;
      const recurrence = columns.find((column) => column.name === "recurrence_json");
      assert.equal(recurrence?.name, "recurrence_json");
      assert.equal(recurrence?.notnull, 0);
    }),
  );
});
