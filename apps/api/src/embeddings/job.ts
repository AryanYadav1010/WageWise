import type { Logger } from "pino";
import { withTransaction, type Pool, type PoolClient } from "../db/pool.ts";
import { embedWithRetry, toVectorLiteral, type EmbeddingProvider, type RetryOptions } from "./provider.ts";

// Arbitrary constant: one embedding job at a time per database.
const EMBEDDING_LOCK_ID = 7_120_003;

export class EmbeddingJobAlreadyRunningError extends Error {
  constructor() {
    super("Another embedding job holds the lock; try again when it finishes");
    this.name = "EmbeddingJobAlreadyRunningError";
  }
}

export type EmbeddingJobOptions = { batchSize: number; retry: RetryOptions };

export type EmbeddingJobSummary = {
  runId: string;
  status: "success" | "partial" | "failed";
  candidates: number;
  computed: number;
  reused: number;
  failed: number;
};

type Candidate = { chunk_id: string; content: string; content_sha256: string };

/** Registers the model, refusing to continue if the same id was recorded with another dimension. */
async function registerModel(client: PoolClient, provider: EmbeddingProvider): Promise<void> {
  await client.query("INSERT INTO embedding_models (id, dimensions) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [provider.modelId, provider.dimensions]);
  const result = await client.query<{ dimensions: number }>("SELECT dimensions FROM embedding_models WHERE id = $1", [provider.modelId]);
  const stored = result.rows[0]?.dimensions;
  if (stored !== provider.dimensions) {
    throw new Error(`Model ${provider.modelId} is registered with ${stored} dimensions but the provider returns ${provider.dimensions}`);
  }
}

/** Approved, live, active chunks with no vector for this model yet, minus ones that already failed in this run. */
async function nextCandidates(pool: Pool, modelId: string, failedIds: readonly string[], batchSize: number): Promise<Candidate[]> {
  const result = await pool.query<Candidate>(`
    SELECT rc.chunk_id, rc.content, rc.content_sha256
    FROM retrievable_chunks rc
    LEFT JOIN chunk_embeddings e ON e.chunk_id = rc.chunk_id AND e.model_id = $1
    WHERE e.chunk_id IS NULL AND NOT (rc.chunk_id = ANY($2::uuid[]))
    ORDER BY rc.chunk_id
    LIMIT $3`, [modelId, failedIds, batchSize]);
  return result.rows;
}

async function countCandidates(pool: Pool, modelId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(`
    SELECT count(*) AS n FROM retrievable_chunks rc
    LEFT JOIN chunk_embeddings e ON e.chunk_id = rc.chunk_id AND e.model_id = $1
    WHERE e.chunk_id IS NULL`, [modelId]);
  return Number(result.rows[0]?.n ?? "0");
}

/** Copies vectors already computed for identical text with this model. Returns the chunk ids it covered. */
async function reuseExistingVectors(client: PoolClient, modelId: string, batch: readonly Candidate[]): Promise<Set<string>> {
  const result = await client.query<{ chunk_id: string }>(`
    INSERT INTO chunk_embeddings (chunk_id, model_id, content_sha256, embedding, source)
    SELECT c.chunk_id, $1, c.content_sha256, existing.embedding, 'reused'
    FROM unnest($2::uuid[], $3::text[]) AS c(chunk_id, content_sha256)
    JOIN LATERAL (
      SELECT e.embedding FROM chunk_embeddings e
      WHERE e.model_id = $1 AND e.content_sha256 = c.content_sha256 LIMIT 1
    ) existing ON true
    ON CONFLICT (chunk_id, model_id) DO NOTHING
    RETURNING chunk_id`,
    [modelId, batch.map(item => item.chunk_id), batch.map(item => item.content_sha256)]);
  return new Set(result.rows.map(row => row.chunk_id));
}

async function insertComputed(client: PoolClient, modelId: string, batch: readonly Candidate[], vectors: readonly number[][]): Promise<void> {
  if (vectors.length !== batch.length) throw new Error("Vector missing for batch item");
  // One statement per batch (not per vector): each round trip to a remote database is costly.
  await client.query(
    `INSERT INTO chunk_embeddings (chunk_id, model_id, content_sha256, embedding, source)
     SELECT c.chunk_id, $1, c.content_sha256, c.embedding::vector, 'computed'
     FROM unnest($2::uuid[], $3::text[], $4::text[]) AS c(chunk_id, content_sha256, embedding)
     ON CONFLICT (chunk_id, model_id) DO NOTHING`,
    [modelId, batch.map(item => item.chunk_id), batch.map(item => item.content_sha256), vectors.map(toVectorLiteral)]);
}

type BatchResult = { computed: number; reused: number; failedIds: string[] };

/** One batch in one transaction: reuse what we can, compute the rest, or record the batch as failed. */
async function processBatch(pool: Pool, provider: EmbeddingProvider, batch: Candidate[], options: EmbeddingJobOptions, logger: Logger, runId: string): Promise<BatchResult> {
  try {
    return await withTransaction(pool, async client => {
      const reusedIds = await reuseExistingVectors(client, provider.modelId, batch);
      const toCompute = batch.filter(item => !reusedIds.has(item.chunk_id));
      if (toCompute.length > 0) {
        const { vectors, attempts } = await embedWithRetry(provider, toCompute.map(item => item.content), "document", options.retry);
        if (attempts > 1) logger.warn({ runId, attempts, batchSize: toCompute.length }, "embedding batch needed retries");
        await insertComputed(client, provider.modelId, toCompute, vectors);
      }
      return { computed: toCompute.length, reused: reusedIds.size, failedIds: [] };
    });
  } catch (error) {
    logger.error({ runId, batchSize: batch.length, err: error instanceof Error ? error.message : String(error) }, "embedding batch failed; rolled back");
    return { computed: 0, reused: 0, failedIds: batch.map(item => item.chunk_id) };
  }
}

function jobStatus(summary: Omit<EmbeddingJobSummary, "runId" | "status">): EmbeddingJobSummary["status"] {
  if (summary.failed === 0) return "success";
  return summary.computed + summary.reused === 0 ? "failed" : "partial";
}

/**
 * Embeds every retrievable chunk that has no vector for this model. Idempotent and resumable:
 * a second run finds nothing to do; an interrupted run continues where it stopped, because
 * each committed batch is permanent and the next run simply selects what is still missing.
 */
export async function runEmbeddingJob(pool: Pool, provider: EmbeddingProvider, logger: Logger, options: EmbeddingJobOptions): Promise<EmbeddingJobSummary> {
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [EMBEDDING_LOCK_ID]);
    if (lock.rows[0]?.locked !== true) throw new EmbeddingJobAlreadyRunningError();
    try {
      await withTransaction(pool, client => registerModel(client, provider));
      const candidates = await countCandidates(pool, provider.modelId);
      const run = await pool.query<{ id: string }>(
        "INSERT INTO embedding_runs (model_id, status, candidates) VALUES ($1, 'running', $2) RETURNING id", [provider.modelId, candidates]);
      const runId = run.rows[0]?.id;
      if (runId === undefined) throw new Error("Run insert returned no id");
      logger.info({ runId, modelId: provider.modelId, candidates }, "embedding job started");

      const totals = { candidates, computed: 0, reused: 0, failed: 0 };
      const failedIds: string[] = [];
      try {
        for (;;) {
          const batch = await nextCandidates(pool, provider.modelId, failedIds, options.batchSize);
          if (batch.length === 0) break;
          const result = await processBatch(pool, provider, batch, options, logger, runId);
          totals.computed += result.computed;
          totals.reused += result.reused;
          totals.failed += result.failedIds.length;
          failedIds.push(...result.failedIds);
          logger.info({ runId, ...totals }, "embedding progress");
        }
      } catch (error) {
        await pool.query("UPDATE embedding_runs SET status = 'failed', completed_at = now(), error_summary = $2 WHERE id = $1",
          [runId, (error instanceof Error ? error.message : String(error)).slice(0, 1_000)]);
        throw error;
      }

      const status = jobStatus(totals);
      await pool.query(
        "UPDATE embedding_runs SET status = $2, completed_at = now(), computed = $3, reused = $4, failed = $5 WHERE id = $1",
        [runId, status, totals.computed, totals.reused, totals.failed]);
      logger.info({ runId, status, ...totals }, "embedding job finished");
      return { runId, status, ...totals };
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [EMBEDDING_LOCK_ID]);
    }
  } finally {
    lockClient.release();
  }
}
