// npm run ingest                                  fetch and store every corpus guide
// npm run ingest -- --only /tax-codes,/child-benefit   a subset (paths must be in the corpus)
// Exit codes: 0 success, 2 partial (some documents failed), 1 failed, 3 another run in progress.
import { parseArgs } from "node:util";
import { chunkerConfigSchema } from "../ingest/chunker.ts";
import { CORPUS } from "../ingest/corpus.ts";
import { fetchGovukDocument, realSleep } from "../ingest/govuk-client.ts";
import { IngestionAlreadyRunningError, runIngestion } from "../ingest/pipeline.ts";
import { runCli, startCli } from "./shared.ts";

const { values } = parseArgs({ options: { only: { type: "string" } } });
const context = startCli("wagewise-ingest");
const { config, logger, pool } = context;

function selectEntries(only: string | undefined) {
  if (only === undefined) return [...CORPUS];
  const wanted = only.split(",").map(path => path.trim()).filter(path => path !== "");
  const unknown = wanted.filter(path => !CORPUS.some(entry => entry.basePath === path));
  if (unknown.length > 0) throw new Error(`Not in the corpus: ${unknown.join(", ")}`);
  return CORPUS.filter(entry => wanted.includes(entry.basePath));
}

await runCli(context, async () => {
  const chunkerConfig = chunkerConfigSchema.parse({ maxChars: config.INGEST_MAX_CHUNK_CHARS, overlapChars: config.INGEST_CHUNK_OVERLAP_CHARS });
  try {
    const summary = await runIngestion(
      {
        pool,
        logger,
        sleep: realSleep,
        fetchDocument: path => fetchGovukDocument(path, { timeoutMs: config.INGEST_TIMEOUT_MS, maxAttempts: config.INGEST_MAX_ATTEMPTS })
      },
      selectEntries(values.only),
      { trigger: "manual", chunkerConfig, delayBetweenRequestsMs: config.INGEST_REQUEST_DELAY_MS }
    );
    if (summary.status === "success") return 0;
    return summary.status === "partial" ? 2 : 1;
  } catch (error) {
    if (error instanceof IngestionAlreadyRunningError) {
      logger.warn(error.message);
      return 3;
    }
    throw error;
  }
});
