import { randomBytes } from "node:crypto";
import pg from "pg";
import pino from "pino";
import { loadLocalEnvFile } from "../src/config.ts";
import { loadMigrations, migrate, type Migration } from "../src/db/migrations.ts";
import { assertSafeTestDatabaseUrl, createPool, withStrictSsl, type Pool } from "../src/db/pool.ts";

export const silentLogger = pino({ level: "silent" });

export type TestDatabase = { pool: Pool; url: string; drop: () => Promise<void> };

function adminUrl(): string {
  loadLocalEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("TEST_DATABASE_URL is required for npm run test:db: a direct connection to a separate test database or Neon branch (see .env.example)");
  }
  assertSafeTestDatabaseUrl(url, process.env.DATABASE_URL);
  return url;
}

async function withAdmin(work: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: withStrictSsl(adminUrl()), connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

/** Creates an empty, uniquely named database. Each test gets its own, so tests cannot interfere. */
export async function createTestDatabase(): Promise<TestDatabase> {
  // Identifiers cannot be query parameters; this name is generated here from hex only.
  const name = `wagewise_test_${randomBytes(6).toString("hex")}`;
  await withAdmin(async client => { await client.query(`CREATE DATABASE ${name}`); });
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  const pool = createPool(url.toString(), "wagewise-test");
  return {
    pool,
    url: url.toString(),
    drop: async () => {
      await pool.end();
      await withAdmin(async client => { await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); });
    }
  };
}

export async function createMigratedDatabase(migrations: Migration[] = loadMigrations()): Promise<TestDatabase> {
  const database = await createTestDatabase();
  await migrate(database.pool, migrations);
  return database;
}

export async function count(pool: Pool, sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM (${sql}) AS counted`, params);
  return Number(result.rows[0]?.n ?? "0");
}
