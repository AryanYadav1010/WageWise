import pino, { type Logger } from "pino";
import { loadIngestConfig, loadLocalEnvFile, type IngestConfig } from "../config.ts";
import { createPool, describeDatabase, isPooledConnection, type Pool } from "../db/pool.ts";

export type CliContext = { config: IngestConfig; logger: Logger; pool: Pool };

/** Shared start-up for the database CLIs: env, validated config, JSON logger, pool. */
export function startCli(name: string): CliContext {
  loadLocalEnvFile();
  const config = loadIngestConfig();
  const logger = pino({ level: config.LOG_LEVEL, base: { app: name } });
  const connectionString = config.DIRECT_DATABASE_URL ?? config.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL;
  if (isPooledConnection(connectionString)) {
    throw new Error("This command needs a direct (non-pooled) connection: set DATABASE_URL_UNPOOLED (written by `neon env pull`) or DIRECT_DATABASE_URL");
  }
  logger.info({ database: describeDatabase(connectionString) }, "connecting");
  return { config, logger, pool: createPool(connectionString, name) };
}

/** Runs a CLI body, logging failures without stack traces and always closing the pool. */
export async function runCli(context: CliContext, body: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await body();
  } catch (error) {
    context.logger.error({ err: error instanceof Error ? error.message : String(error) }, "command failed");
    process.exitCode = 1;
  } finally {
    await context.pool.end();
  }
}
