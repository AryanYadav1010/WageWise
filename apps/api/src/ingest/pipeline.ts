import type { Logger } from "pino";
import { withTransaction, type Pool } from "../db/pool.ts";
import { CHUNKER_VERSION, chunkSection, type ChunkerConfig } from "./chunker.ts";
import type { CorpusEntry } from "./corpus.ts";
import { PARSER_VERSION } from "./govuk.ts";
import type { FetchOutcome } from "./govuk-client.ts";
import {
  finishRun, insertRunItem, lockDocument, markCheckFailed, markChecked, startRun, storeDocumentContent, upsertCorpusEntry,
  type ChunkFn, type RunItem
} from "./repository.ts";

// Arbitrary constant: at most one ingestion run at a time per database.
const INGESTION_LOCK_ID = 7_120_002;

export class IngestionAlreadyRunningError extends Error {
  constructor() {
    super("Another ingestion run holds the lock; try again when it finishes");
    this.name = "IngestionAlreadyRunningError";
  }
}

export type IngestionDependencies = {
  pool: Pool;
  fetchDocument: (basePath: string) => Promise<FetchOutcome>;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  /** Overridable so tests can inject a faulty chunker and prove the transaction rolls back. */
  chunk?: ChunkFn;
};

export type IngestionOptions = {
  trigger: "manual" | "scheduled";
  chunkerConfig: ChunkerConfig;
  delayBetweenRequestsMs: number;
};

export type RunSummary = {
  runId: string;
  status: "success" | "partial" | "failed";
  items: RunItem[];
};

function runStatus(items: readonly RunItem[]): RunSummary["status"] {
  const failed = items.filter(item => item.outcome === "failed").length;
  if (failed === 0) return "success";
  return failed === items.length ? "failed" : "partial";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Records one fetch outcome in a single transaction. Throws if storage fails (and rolls back). */
async function recordOutcome(
  dependencies: IngestionDependencies,
  runId: string,
  entry: CorpusEntry,
  outcome: FetchOutcome,
  chunk: ChunkFn,
  durationMs: number
): Promise<RunItem> {
  return withTransaction(dependencies.pool, async client => {
    const documentId = await lockDocument(client, entry.basePath);
    const base = { basePath: entry.basePath, attempts: outcome.attempts, durationMs, failureReason: null, message: null, httpStatus: null, versionId: null };
    let item: RunItem;

    if (outcome.kind === "ok") {
      const stored = await storeDocumentContent(client, documentId, {
        runId, entry, document: outcome.document, rawSha256: outcome.rawSha256,
        parserVersion: PARSER_VERSION, chunkerVersion: CHUNKER_VERSION, chunk
      });
      await markChecked(client, documentId, "active", null);
      item = { ...base, outcome: stored.outcome, httpStatus: 200, versionId: stored.versionId,
        message: `${stored.sections} sections, ${stored.chunks} chunks` };
    } else if (outcome.kind === "withdrawn") {
      await markChecked(client, documentId, "withdrawn", null);
      item = { ...base, outcome: "withdrawn", httpStatus: 200, message: `Withdrawn at ${outcome.withdrawnAt ?? "unknown date"}` };
    } else if (outcome.kind === "redirected") {
      const message = `Redirects to ${outcome.destination ?? "unknown"}; update the corpus`;
      await markChecked(client, documentId, "redirected", message);
      item = { ...base, outcome: "redirected", httpStatus: outcome.httpStatus, message };
    } else if (outcome.kind === "removed") {
      await markChecked(client, documentId, "removed", `GOV.UK returned ${outcome.httpStatus}`);
      item = { ...base, outcome: "removed", httpStatus: outcome.httpStatus, message: `GOV.UK returned ${outcome.httpStatus}` };
    } else {
      // Not evidence of withdrawal or removal: keep the page and its active version as they were.
      await markCheckFailed(client, documentId, outcome.reason);
      item = { ...base, outcome: "failed", failureReason: outcome.reason, message: outcome.message, httpStatus: outcome.httpStatus };
    }

    await insertRunItem(client, runId, documentId, item);
    return item;
  });
}

/** Records a storage failure after the document's own transaction has been rolled back. */
async function recordStorageFailure(pool: Pool, runId: string, entry: CorpusEntry, error: unknown, attempts: number, durationMs: number): Promise<RunItem> {
  const item: RunItem = {
    basePath: entry.basePath, outcome: "failed", failureReason: "storage_error", message: errorMessage(error),
    httpStatus: null, attempts, versionId: null, durationMs
  };
  await withTransaction(pool, client => insertRunItem(client, runId, null, item));
  return item;
}

async function processEntry(dependencies: IngestionDependencies, runId: string, entry: CorpusEntry, chunk: ChunkFn): Promise<RunItem> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const outcome = await dependencies.fetchDocument(entry.basePath);
  const durationMs = Math.max(0, now() - startedAt);
  try {
    return await recordOutcome(dependencies, runId, entry, outcome, chunk, durationMs);
  } catch (error) {
    dependencies.logger.error({ runId, basePath: entry.basePath, err: errorMessage(error) }, "storage failed; document transaction rolled back");
    return recordStorageFailure(dependencies.pool, runId, entry, error, outcome.attempts, durationMs);
  }
}

/**
 * Fetches and stores every corpus entry, one at a time (polite to GOV.UK, and no shared
 * mutable state between concurrent tasks). Each document commits or rolls back on its own,
 * so one bad page never loses the others' results.
 */
export async function runIngestion(dependencies: IngestionDependencies, entries: readonly CorpusEntry[], options: IngestionOptions): Promise<RunSummary> {
  const { pool, logger } = dependencies;
  const chunk: ChunkFn = dependencies.chunk ?? ((text, headingPath) => chunkSection(text, headingPath, options.chunkerConfig));

  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [INGESTION_LOCK_ID]);
    if (lock.rows[0]?.locked !== true) throw new IngestionAlreadyRunningError();

    try {
      const runId = await withTransaction(pool, client => startRun(client, options.trigger, { ...options.chunkerConfig, version: CHUNKER_VERSION }));
      logger.info({ runId, documents: entries.length, parserVersion: PARSER_VERSION, chunkerVersion: CHUNKER_VERSION }, "ingestion run started");

      try {
        await withTransaction(pool, async client => {
          for (const entry of entries) await upsertCorpusEntry(client, entry);
        });

        const items: RunItem[] = [];
        for (const [position, entry] of entries.entries()) {
          if (position > 0) await dependencies.sleep(options.delayBetweenRequestsMs);
          const item = await processEntry(dependencies, runId, entry, chunk);
          items.push(item);
          logger.info({
            runId, basePath: item.basePath, outcome: item.outcome, failureReason: item.failureReason,
            attempts: item.attempts, durationMs: item.durationMs, versionId: item.versionId, detail: item.message
          }, "document processed");
        }

        const status = runStatus(items);
        const counts = {
          checked: items.length,
          changed: items.filter(item => item.outcome === "new_version" || item.outcome === "reactivated").length,
          failed: items.filter(item => item.outcome === "failed").length
        };
        await withTransaction(pool, client => finishRun(client, runId, status, counts, null));
        logger.info({ runId, status, ...counts }, "ingestion run finished");
        return { runId, status, items };
      } catch (error) {
        // Unexpected failure outside a single document (e.g. the database went away).
        await withTransaction(pool, client => finishRun(client, runId, "failed", { checked: 0, changed: 0, failed: 0 }, errorMessage(error)))
          .catch(() => undefined);
        throw error;
      }
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [INGESTION_LOCK_ID]);
    }
  } finally {
    lockClient.release();
  }
}
