import { afterEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, migrationStatus, MigrationIntegrityError, type Migration } from "../src/db/migrations.ts";
import { count, createTestDatabase, type TestDatabase } from "./db-helpers.ts";

let database: TestDatabase | undefined;
afterEach(async () => {
  await database?.drop();
  database = undefined;
});

const migrations = loadMigrations();

describe("migration runner", () => {
  it("finds the numbered migration files in order", () => {
    expect(migrations.map(migration => `${migration.version}_${migration.name}`)).toEqual(["1_initial_schema", "2_ingestion_storage", "3_embeddings"]);
  });

  it("applies every migration to an empty database, then does nothing on a second run", async () => {
    database = await createTestDatabase();
    expect((await migrate(database.pool, migrations)).map(migration => migration.version)).toEqual([1, 2, 3]);
    expect(await migrate(database.pool, migrations)).toEqual([]);
    expect(await count(database.pool, "SELECT * FROM schema_migrations")).toBe(3);
    expect((await migrationStatus(database.pool, migrations)).pending).toEqual([]);
  });

  it("is safe when two runners start at once", async () => {
    database = await createTestDatabase();
    const [first, second] = await Promise.all([migrate(database.pool, migrations), migrate(database.pool, migrations)]);
    expect(first.length + second.length).toBe(3);
    expect(await count(database.pool, "SELECT * FROM schema_migrations")).toBe(3);
  });

  it("refuses to run if an applied migration file was edited", async () => {
    database = await createTestDatabase();
    await migrate(database.pool, migrations);
    const edited: Migration[] = migrations.map(migration => migration.version === 1 ? { ...migration, sha256: "0".repeat(64) } : migration);
    await expect(migrate(database.pool, edited)).rejects.toThrow(MigrationIntegrityError);
  });

  it("rolls back a failing migration completely and records nothing", async () => {
    database = await createTestDatabase();
    const broken: Migration = { version: 99, name: "broken", sha256: "f".repeat(64),
      sql: "CREATE TABLE half_done (id INTEGER); SELECT * FROM table_that_does_not_exist;" };
    await expect(migrate(database.pool, [...migrations, broken])).rejects.toThrow(/99_broken failed and was rolled back/);
    expect(await count(database.pool, "SELECT * FROM schema_migrations")).toBe(3);
    expect(await count(database.pool, "SELECT * FROM pg_tables WHERE tablename = 'half_done'")).toBe(0);
  });
});

describe("upgrading a Milestone 1 database", () => {
  it("backfills nations from the old jurisdiction column and clears 'fetch_failing'", async () => {
    database = await createTestDatabase();
    await migrate(database.pool, migrations.filter(migration => migration.version === 1));
    await database.pool.query(`
      INSERT INTO source_documents (publisher, base_path, canonical_url, title, topics, jurisdiction, lifecycle_status)
      VALUES ('govuk', '/statutory-sick-pay', 'https://www.gov.uk/statutory-sick-pay', 'SSP', '{employment}', 'great-britain', 'fetch_failing'),
             ('govuk', '/tax-codes', 'https://www.gov.uk/tax-codes', 'Tax codes', '{tax}', 'uk', 'active')`);

    await migrate(database.pool, migrations);

    const rows = (await database.pool.query<{ base_path: string; nations: string[]; lifecycle_status: string }>(
      "SELECT base_path, nations, lifecycle_status FROM source_documents ORDER BY base_path")).rows;
    expect(rows).toEqual([
      { base_path: "/statutory-sick-pay", nations: ["england", "wales", "scotland"], lifecycle_status: "active" },
      { base_path: "/tax-codes", nations: ["england", "wales", "scotland", "northern-ireland"], lifecycle_status: "active" }
    ]);
  });
});
