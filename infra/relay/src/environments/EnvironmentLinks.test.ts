import * as NodeServices from "@effect/platform-node/NodeServices";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayDb from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";

describe("EnvironmentLinks", () => {
  it.effect("updates only the active link with matching environment credentials", () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          set: (values: Record<string, unknown>) => {
            updateValues.push(values);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return Effect.void;
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      yield* links.updateLabel({
        environmentId: "env-1",
        environmentPublicKey: "public-key-1",
        label: "Build server",
      });

      expect(updateValues[0]?.environmentLabel).toBe("Build server");
      expect(typeof updateValues[0]?.updatedAt).toBe("string");
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."environment_public_key" = $2');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.params).toEqual(["env-1", "public-key-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("retains link lookup failures with user and environment identity", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: () => ({
              limit: () => Effect.fail(cause),
            }),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.getForUser({ userId: "user-1", environmentId: "env-1" }),
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentLinkLookupPersistenceError",
        userId: "user-1",
        environmentId: "env-1",
      });
      expect(error.cause).toBe(cause);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("identifies delivery-user list failures without retaining key material", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: () => Effect.fail(cause),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.listDeliveryUsersForEnvironment({
          environmentId: "env-1",
          environmentPublicKey: "sensitive-public-key-material",
        }),
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentLinkUserListPersistenceError",
        message: "Environment link user query 'list-delivery-users' failed for environment 'env-1'",
        environmentId: "env-1",
      });
      expect(error.cause).toBe(cause);
      expect(error).not.toHaveProperty("environmentPublicKey");
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("selects notification or Live Activity users by environment key", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      select: (selection: unknown) => {
        expect(selection).toBeDefined();
        return {
          from: (table: unknown) => {
            expect(table).toBe(relayEnvironmentLinks);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return Effect.succeed([]);
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      expect(
        yield* links.listDeliveryUsersForEnvironment({
          environmentId: "env-1",
          environmentPublicKey: "public-key-1",
        }),
      ).toEqual([]);
      expect(whereConditions).toHaveLength(1);

      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.sql).toContain('"relay_environment_links"."notifications_enabled" = $2');
      expect(query.sql).toContain('"relay_environment_links"."live_activities_enabled" = $3');
      expect(query.sql).toContain('"relay_environment_links"."environment_public_key" = $4');
      expect(query.sql).toContain(" or ");
      expect(query.params).toEqual(["env-1", true, true, "public-key-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("carries the webhook-hold opt-in over only from links with the same key", () => {
    const inserted: Array<Record<string, unknown>> = [];
    const revoked: Array<{ values: Record<string, unknown>; condition: unknown }> = [];
    const fakeDb = {
      $client: {
        withTransaction: (effect: Effect.Effect<unknown>) => effect,
      },
      execute: () => Effect.void,
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) =>
            Effect.sync(() => {
              revoked.push({ values, condition });
            }),
        }),
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserted.push(values);
          return { onConflictDoUpdate: () => Effect.void };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      yield* links.upsert({
        userId: "user-1",
        request: {
          notificationsEnabled: false,
          liveActivitiesEnabled: false,
          managedTunnelsEnabled: true,
        } as never,
        proof: {
          environmentId: "env-1",
          environmentPublicKey: "public-key-1",
          descriptor: { label: "Laptop" },
        } as never,
        endpoint: { httpBaseUrl: "https://a.example", wsBaseUrl: "wss://a.example" } as never,
      });
      const query = new PgDialect().sqlToQuery(inserted[0]?.holdWebhooksWhileOffline as never);
      expect(query.sql).toContain("environment_public_key");
      expect(query.params).toEqual(["env-1", "public-key-1"]);
      expect(revoked).toHaveLength(1);
      expect(revoked[0]?.values.revokedAt).toEqual(inserted[0]?.updatedAt);
      const priorLinks = new PgDialect().sqlToQuery(revoked[0]?.condition as never);
      expect(priorLinks.sql).toContain('"user_id" <>');
      expect(priorLinks.sql).toContain('"revoked_at" is null');
      expect(priorLinks.params).toEqual(["env-1", "public-key-1", "user-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("updates Live Activities only on the matching active link", () =>
    Effect.gen(function* () {
      const pg = yield* Effect.acquireRelease(
        Effect.promise(() => PGlite.create()),
        (client) => Effect.promise(() => client.close()),
      );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const migrationsDir = yield* path.fromFileUrl(
        new URL("../../migrations/postgres/", import.meta.url),
      );
      for (const name of (yield* fs.readDirectory(migrationsDir)).toSorted()) {
        const migration = yield* fs.readFileString(`${migrationsDir}${name}/migration.sql`);
        yield* Effect.promise(() => pg.exec(migration));
      }

      const db = drizzle({ client: pg });
      const matching = { userId: "user-1", environmentId: "env-1", environmentPublicKey: "key-1" };
      const revoked = { ...matching, environmentId: "revoked-env" };
      const timestamp = "2026-01-01T00:00:00.000Z";
      const rows = [
        matching,
        { ...matching, userId: "user-2" },
        { ...matching, environmentId: "env-2" },
        { ...matching, userId: "user-3", environmentPublicKey: "key-2" },
        { ...revoked, revokedAt: timestamp },
      ];
      yield* Effect.promise(() =>
        db.insert(relayEnvironmentLinks).values(
          rows.map((row) => ({
            ...row,
            endpointHttpBaseUrl: "https://environment.test",
            endpointWsBaseUrl: "wss://environment.test",
            endpointProviderKind: "cloudflare_tunnel",
            createdAt: timestamp,
            updatedAt: timestamp,
          })),
        ),
      );
      // PGlite returns promises where the production Drizzle driver returns Effects.
      const effectDb = {
        update: (table: typeof relayEnvironmentLinks) => ({
          set: (values: Partial<typeof relayEnvironmentLinks.$inferInsert>) => ({
            where: (condition: SQL | undefined) => ({
              returning: (fields: { environmentId: typeof relayEnvironmentLinks.environmentId }) =>
                Effect.promise(() =>
                  db.update(table).set(values).where(condition).returning(fields),
                ),
            }),
          }),
        }),
      } as unknown as RelayDb.RelayDb["Service"];
      const links = yield* Effect.service(EnvironmentLinks.EnvironmentLinks).pipe(
        Effect.provide(
          EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, effectDb))),
        ),
      );
      expect(
        yield* links.updateLiveActivityPreference({ ...matching, liveActivitiesEnabled: false }),
      ).toBe(true);
      expect(
        yield* links.updateLiveActivityPreference({
          ...matching,
          environmentPublicKey: "key-2",
          liveActivitiesEnabled: false,
        }),
      ).toBe(false);
      expect(
        yield* links.updateLiveActivityPreference({ ...revoked, liveActivitiesEnabled: false }),
      ).toBe(false);

      const updated = yield* Effect.promise(() => db.select().from(relayEnvironmentLinks));
      expect(
        updated
          .filter((row) => !row.liveActivitiesEnabled)
          .map(({ userId, environmentId }) => ({
            userId,
            environmentId,
          })),
      ).toEqual([{ userId: matching.userId, environmentId: matching.environmentId }]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("revokes only the active link owned by the requesting user", () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          set: (values: Record<string, unknown>) => {
            updateValues.push(values);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return {
                  returning: () => {
                    return Effect.succeed([{ environmentId: "env-1" }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const revoked = yield* links.revokeForUser({
        userId: "user-1",
        environmentId: "env-1",
      });

      expect(revoked).toBe(true);
      expect(updateValues).toHaveLength(1);
      expect(updateValues[0]?.revokedAt).toEqual(updateValues[0]?.updatedAt);
      expect(typeof updateValues[0]?.revokedAt).toBe("string");
      expect(whereConditions).toHaveLength(1);

      const dialect = new PgDialect();
      const query = dialect.sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $2');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.params).toEqual(["user-1", "env-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });
});
