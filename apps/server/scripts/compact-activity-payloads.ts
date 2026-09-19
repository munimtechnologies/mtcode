#!/usr/bin/env node
//
// Re-project the activity payloads already stored in projection_thread_activities.
//
// The projector used to write the provider's whole payload into the read model,
// while both transports projected it on the way out — so a database accumulated
// file-change patches and tool output no client was ever sent. The projector now
// stores the projected form; this rewrites the rows written before that.
//
// Nothing is deleted. `projection_thread_activities` is derived state, the
// projection is idempotent, and `orchestration_events` still holds every
// original payload, so a rebuild can reproduce anything dropped here.
//
// Stop the server first, then:
//   node apps/server/scripts/compact-activity-payloads.ts --base-dir ~/.mt
//   node apps/server/scripts/compact-activity-payloads.ts --base-dir ~/.mt --apply
//
// Without --apply it only reports what it would reclaim.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Command, Flag } from "effect/unstable/cli";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { projectActivityPayload } from "../src/orchestration/ActivityPayloadProjection.ts";

const BATCH = 500;

const decodePayload = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
const encodePayload = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const compact = Effect.fn("compactActivityPayloads")(function* (apply: boolean) {
  const sql = yield* SqlClient.SqlClient;

  const [before] = yield* sql<{ readonly bytes: number; readonly rows: number }>`
    SELECT COALESCE(SUM(LENGTH(payload_json)), 0) AS bytes, COUNT(*) AS rows
    FROM projection_thread_activities
  `;
  yield* Console.log(
    `${before?.rows ?? 0} activities holding ${megabytes(before?.bytes ?? 0)} of payload`,
  );

  let offset = 0;
  let rewritten = 0;
  let saved = 0;
  for (;;) {
    const rows = yield* sql<{
      readonly activity_id: string;
      readonly tone: string;
      readonly kind: string;
      readonly summary: string;
      readonly payload_json: string;
      readonly turn_id: string | null;
      readonly created_at: string;
    }>`
      SELECT activity_id, tone, kind, summary, payload_json, turn_id, created_at
      FROM projection_thread_activities
      ORDER BY activity_id
      LIMIT ${BATCH} OFFSET ${offset}
    `;
    if (rows.length === 0) break;
    offset += rows.length;

    for (const row of rows) {
      const decoded = decodePayload(row.payload_json);
      // A row this script cannot read is a row it must not rewrite.
      if (decoded._tag !== "Success") continue;
      const payload: unknown = decoded.value;
      const projected = projectActivityPayload({
        id: row.activity_id,
        tone: row.tone,
        kind: row.kind,
        summary: row.summary,
        payload,
        turnId: row.turn_id,
        createdAt: row.created_at,
      } as never);
      const next = encodePayload(projected.payload);
      if (next.length >= row.payload_json.length) continue;
      rewritten += 1;
      saved += row.payload_json.length - next.length;
      if (apply) {
        yield* sql`
          UPDATE projection_thread_activities
          SET payload_json = ${next}
          WHERE activity_id = ${row.activity_id}
        `;
      }
    }
  }

  yield* Console.log(
    apply
      ? `rewrote ${rewritten} activities, reclaiming ${megabytes(saved)}`
      : `would rewrite ${rewritten} activities, reclaiming ${megabytes(saved)} (pass --apply)`,
  );

  if (apply && rewritten > 0) {
    yield* Console.log("running VACUUM to return the pages to the filesystem...");
    yield* sql`VACUUM`;
    yield* Console.log("done");
  }
});

const command = Command.make("compact-activity-payloads", {
  baseDir: Flag.String("base-dir").pipe(
    Flag.withDescription("T3 home directory, for example ~/.mt"),
  ),
  apply: Flag.Boolean("apply").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Write the changes. Without it the script only reports."),
  ),
}).pipe(
  Command.withHandler(({ baseDir, apply }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = baseDir.startsWith("~")
        ? path.join(NodeOS.homedir(), baseDir.slice(1))
        : baseDir;
      const database = path.join(home, "userdata", "state.sqlite");
      yield* Console.log(`database: ${database}`);
      yield* compact(apply).pipe(Effect.provide(NodeSqliteClient.layer({ filename: database })));
    }),
  ),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
