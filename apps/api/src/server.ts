import { buildApp } from "./app.ts";
import { loadConfig, loadLocalEnvFile, type AppConfig } from "./config.ts";
import { createPool, type Pool } from "./db/pool.ts";
import { loadHolidaySnapshot } from "./domain/bank-holidays.ts";
import { createEmbeddingProvider } from "./embeddings/factory.ts";
import type { GuidanceSearch } from "./guidance-route.ts";
import { answerQuestion } from "./chat/answer.ts";
import type { ChatService } from "./chat-route.ts";
import { AnthropicAnswerModel } from "./llm/anthropic-model.ts";
import { realSleep } from "./ingest/govuk-client.ts";
import { searchGuidance } from "./retrieval/search.ts";

loadLocalEnvFile();
const config = loadConfig();

function createGuidanceSearch(appConfig: AppConfig, pool: Pool): GuidanceSearch {
  const provider = createEmbeddingProvider(appConfig.EMBEDDING_PROVIDER);
  // One quick attempt: a user is waiting, and keyword results are a safe fallback.
  const retry = { maxAttempts: 1, timeoutMs: appConfig.SEARCH_EMBED_TIMEOUT_MS, baseDelayMs: 0, sleep: realSleep };
  const minSimilarity = appConfig.SEARCH_MIN_SIMILARITY ?? null;
  return (request, logger) => searchGuidance({ pool, provider, logger, retry, minSimilarity }, request);
}

/** Chat reuses the same search; it needs a database, an LLM key and a calibrated evidence threshold. */
function createChat(appConfig: AppConfig, search: GuidanceSearch): ChatService | null {
  if (appConfig.ANTHROPIC_API_KEY === undefined) return null;
  // Without a calibrated evidence threshold every answer would abstain; report chat as not configured instead.
  if (appConfig.SEARCH_MIN_SIMILARITY === undefined) return null;
  const model = new AnthropicAnswerModel({ apiKey: appConfig.ANTHROPIC_API_KEY, model: appConfig.LLM_MODEL, timeoutMs: appConfig.LLM_TIMEOUT_MS });
  return (request, logger) => answerQuestion({ search: searchRequest => search(searchRequest, logger), model, logger }, request);
}

const pool = config.DATABASE_URL === undefined ? null : createPool(config.DATABASE_URL, "wagewise-api");
const guidanceSearch = pool === null ? null : createGuidanceSearch(config, pool);
const app = await buildApp({
  config,
  holidaySnapshot: loadHolidaySnapshot(),
  now: () => new Date(),
  guidanceSearch,
  chat: guidanceSearch === null ? null : createChat(config, guidanceSearch)
});
app.addHook("onClose", async () => { await pool?.end(); });
if (config.ANTHROPIC_API_KEY !== undefined && config.SEARCH_MIN_SIMILARITY === undefined) {
  app.log.warn("chat disabled: SEARCH_MIN_SIMILARITY is not set (calibrate it with npm run eval:retrieval)");
}

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error({ err: error }, "Unable to start API");
  process.exitCode = 1;
}
