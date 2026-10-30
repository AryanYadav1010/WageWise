import pg from "pg";

// Return SQL DATE columns as "YYYY-MM-DD" strings. The default parser builds a JS Date at
// local midnight, which can shift the day depending on the machine's time zone.
const SQL_DATE_TYPE_ID = 1082;
pg.types.setTypeParser(SQL_DATE_TYPE_ID, value => value);

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/**
 * node-postgres already treats sslmode=require as verify-full (certificate and host checked)
 * but warns that this will change. Neon URLs say "require"; make the strict mode explicit so
 * a future pg upgrade cannot silently weaken it.
 */
export function withStrictSsl(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

export function createPool(connectionString: string, applicationName: string): Pool {
  const pool = new pg.Pool({
    connectionString: withStrictSsl(connectionString),
    application_name: applicationName,
    max: 5,
    // Hosted Postgres (e.g. Neon) may need a few seconds to wake a suspended compute.
    connectionTimeoutMillis: 15_000,
    // Client-side, not `statement_timeout`: connection poolers such as PgBouncer can reject
    // unknown start-up parameters. A runaway query still fails instead of hanging.
    query_timeout: 60_000
  });
  // Hosted databases close idle connections. Without a listener, that error would crash Node.
  pool.on("error", () => undefined);
  return pool;
}

/** Neon's pooled endpoints contain "-pooler" in the host name. */
export function isPooledConnection(connectionString: string): boolean {
  return new URL(connectionString).hostname.includes("-pooler");
}

/** Runs `work` in a transaction: COMMIT on success, ROLLBACK on any error. */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Describes a connection string for logs without its password. */
export function describeDatabase(connectionString: string): string {
  const url = new URL(connectionString);
  return `${url.hostname}:${url.port === "" ? "5432" : url.port}${url.pathname}`;
}

/**
 * Integration tests and the fixture database create and drop their own databases, so they
 * need a direct connection on a server that is NOT the main development database. With Neon,
 * that means a separate branch (each branch has its own host name).
 */
export function assertSafeTestDatabaseUrl(testUrl: string, mainUrl: string | undefined): void {
  if (isPooledConnection(testUrl)) {
    throw new Error("TEST_DATABASE_URL must be a direct (non-pooled) connection; CREATE DATABASE does not work through a pooler");
  }
  if (mainUrl === undefined || mainUrl === "") return;
  const hostOf = (value: string) => new URL(value).hostname.replace("-pooler", "");
  const main = new URL(mainUrl);
  const sameServer = hostOf(testUrl) === hostOf(mainUrl);
  const isLocal = main.hostname === "localhost" || main.hostname === "127.0.0.1";
  if (sameServer && !isLocal) {
    throw new Error("TEST_DATABASE_URL points at the same server as DATABASE_URL; use a separate Neon branch for tests");
  }
}
