// npm run embed   embed approved, live, active chunks that have no vector for the configured model.
// Exit codes: 0 success (including "nothing to do"), 2 partial, 1 failed, 3 another job running.
import { createEmbeddingProvider } from "../embeddings/factory.ts";
import { EmbeddingJobAlreadyRunningError, runEmbeddingJob } from "../embeddings/job.ts";
import { realSleep } from "../ingest/govuk-client.ts";
import { runCli, startCli } from "./shared.ts";

const context = startCli("wagewise-embed");
const { config, logger, pool } = context;

await runCli(context, async () => {
  const provider = createEmbeddingProvider(config.EMBEDDING_PROVIDER);
  if (provider === null) {
    logger.warn("EMBEDDING_PROVIDER is 'none'; nothing to do");
    return 0;
  }
  try {
    const summary = await runEmbeddingJob(pool, provider, logger, {
      batchSize: config.EMBED_BATCH_SIZE,
      retry: { maxAttempts: 3, timeoutMs: config.EMBED_TIMEOUT_MS, baseDelayMs: 1_000, sleep: realSleep }
    });
    if (summary.candidates === 0) {
      logger.info("No approved chunks are waiting for embeddings (unapproved content is never embedded)");
    }
    if (summary.status === "success") return 0;
    return summary.status === "partial" ? 2 : 1;
  } catch (error) {
    if (error instanceof EmbeddingJobAlreadyRunningError) {
      logger.warn(error.message);
      return 3;
    }
    throw error;
  }
});
