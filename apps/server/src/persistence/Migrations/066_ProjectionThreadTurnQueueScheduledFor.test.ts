import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("066_ProjectionThreadTurnQueueScheduledFor", (it) => {
  it.effect("adds a nullable scheduled_for column to queued turns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 55 });
      const before = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_turn_queue)
      `;
      assert.isFalse(before.some((column) => column.name === "scheduled_for"));

      yield* runMigrations({ toMigrationInclusive: 66 });
      const after = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_thread_turn_queue)
      `;
      const scheduledFor = after.find((column) => column.name === "scheduled_for");
      assert.equal(scheduledFor?.name, "scheduled_for");
      assert.equal(scheduledFor?.notnull, 0);
    }),
  );
});
