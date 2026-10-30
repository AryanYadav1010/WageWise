import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { Pool } from "./pool.ts";

export const DEFAULT_MIGRATIONS_DIR = new URL("../../../../db/migrations/", import.meta.url);

// Arbitrary constant shared by every migration run, so two runs cannot interleave.
const MIGRATION_LOCK_ID = 7_120_001;
const FILE_NAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export type Migration = { version: number; name: string; sql: string; sha256: string };
export type MigrationStatus = { applied: Migration[]; pending: Migration[] };

export class MigrationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationIntegrityError";
  }
}

export function loadMigrations(directory: URL = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const migrations: Migration[] = [];
  for (const fileName of readdirSync(directory).sort()) {
    if (!fileName.endsWith(".sql")) continue;
    const match = FILE_NAME_PATTERN.exec(fileName);
    if (match === null) {
      throw new MigrationIntegrityError(`Migration file name must look like 0001_name.sql: ${fileName}`);
    }
    const sql = readFileSync(new URL(fileName, directory), "utf8");
    migrations.push({
      version: Number(match[1]),
      name: match[2] ?? "",
      sql,
      sha256: createHash("sha256").update(sql).digest("hex")
    });
  }
  const versions = migrations.map(migration => migration.version);
  if (new Set(versions).size !== versions.length) {
    throw new MigrationIntegrityError("Two migration files share a version number");
  }
  return migrations;
}

type AppliedRow = { version: number; name: string; sha256: string };

async function readApplied(pool: Pool): Promise<AppliedRow[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const result = await pool.query<AppliedRow>("SELECT version, name, sha256 FROM schema_migrations ORDER BY version");
  return result.rows;
}

/**
 * Splits migrations into applied and pending, refusing to continue if an applied
 * migration was edited or deleted: the database would no longer match the files.
 */
function compare(migrations: Migration[], appliedRows: AppliedRow[]): MigrationStatus {
  const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
  for (const row of appliedRows) {
    const file = byVersion.get(row.version);
    if (file === undefined) {
      throw new MigrationIntegrityError(`Applied migration ${row.version}_${row.name} has no file`);
    }
    if (file.sha256 !== row.sha256) {
      throw new MigrationIntegrityError(`Applied migration ${row.version}_${row.name} was edited after it ran`);
    }
  }
  const appliedVersions = new Set(appliedRows.map(row => row.version));
  return {
    applied: migrations.filter(migration => appliedVersions.has(migration.version)),
    pending: migrations.filter(migration => !appliedVersions.has(migration.version))
  };
}

export async function migrationStatus(pool: Pool, migrations: Migration[]): Promise<MigrationStatus> {
  return compare(migrations, await readApplied(pool));
}

/** Applies pending migrations in order, each in its own transaction. Returns those applied. */
export async function migrate(pool: Pool, migrations: Migration[]): Promise<Migration[]> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    const { pending } = compare(migrations, await readApplied(pool));
    const applied: Migration[] = [];
    for (const migration of pending) {
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version, name, sha256) VALUES ($1, $2, $3)",
          [migration.version, migration.name, migration.sha256]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${migration.version}_${migration.name} failed and was rolled back: ${reason}`);
      }
      applied.push(migration);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    client.release();
  }
}
