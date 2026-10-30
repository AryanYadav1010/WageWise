import type { AppConfig } from "./config.ts";
import type { Pool } from "./db/pool.ts";
import { answerQuestion } from "./chat/answer.ts";
import { DraftCache } from "./chat/draft-cache.ts";
import type { ChatService } from "./chat-route.ts";
import { createEmbeddingProvider } from "./embeddings/factory.ts";
import type { GuidanceSearch } from "./guidance-route.ts";
import { realSleep } from "./ingest/govuk-client.ts";
import { AnthropicAnswerModel } from "./llm/anthropic-model.ts";
import { searchGuidance } from "./retrieval/search.ts";

// The server and the answer benchmark share this wiring, so the benchmark measures what users get.

export function createGuidanceSearch(appConfig: AppConfig, pool: Pool): GuidanceSearch {
  const provider = createEmbeddingProvider(appConfig.EMBEDDING_PROVIDER);
  // One quick attempt: a user is waiting, and keyword results are a safe fallback.
  const retry = { maxAttempts: 1, timeoutMs: appConfig.SEARCH_EMBED_TIMEOUT_MS, baseDelayMs: 0, sleep: realSleep };
  const minSimilarity = appConfig.SEARCH_MIN_SIMILARITY ?? null;
  return (request, logger) => searchGuidance({ pool, provider, logger, retry, minSimilarity }, request);
}

/** Chat reuses the same search; it needs a database, an LLM key and a calibrated evidence threshold. */
export function createChat(appConfig: AppConfig, search: GuidanceSearch): ChatService | null {
  if (appConfig.ANTHROPIC_API_KEY === undefined) return null;
  // Without a calibrated evidence threshold every answer would abstain; report chat as not configured instead.
  if (appConfig.SEARCH_MIN_SIMILARITY === undefined) return null;
  const model = new AnthropicAnswerModel({
    apiKey: appConfig.ANTHROPIC_API_KEY, model: appConfig.LLM_MODEL, timeoutMs: appConfig.LLM_TIMEOUT_MS,
    maxConcurrent: appConfig.LLM_MAX_CONCURRENT, dailyTokenLimit: appConfig.LLM_DAILY_TOKEN_LIMIT
  });
  const cache = appConfig.ANSWER_CACHE_ENTRIES === 0 ? undefined : new DraftCache(appConfig.ANSWER_CACHE_ENTRIES, appConfig.ANSWER_CACHE_TTL_MINUTES * 60_000);
  const minAnswerSimilarity = appConfig.ANSWER_MIN_SIMILARITY;
  return (request, logger) => answerQuestion({ search: searchRequest => search(searchRequest, logger), model, logger, minAnswerSimilarity, cache }, request);
}
