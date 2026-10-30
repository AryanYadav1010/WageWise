import { existsSync } from "node:fs";
import { z } from "zod";

const LOCAL_ENV_FILE = new URL("../../../.env", import.meta.url);

/** Local convenience only: in containers and production the environment is injected. */
export function loadLocalEnvFile(): void {
  if (process.env.NODE_ENV !== "production" && existsSync(LOCAL_ENV_FILE)) {
    process.loadEnvFile(LOCAL_ENV_FILE);
  }
}

function invalidKeys(error: z.ZodError): string {
  return Object.keys(error.flatten().fieldErrors).join(", ");
}

const postgresUrl = z.string().url().refine(value => /^postgres(ql)?:\/\//.test(value), "Must be a postgres:// URL");

// "local-bge-small" runs BAAI bge-small-en-v1.5 on this machine; "none" disables semantic search.
export const EMBEDDING_PROVIDERS = ["local-bge-small", "none"] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

// All runtime configuration is read and validated once at startup. Future provider keys
// (LLM_API_KEY, EMBEDDING_API_KEY) belong here, never in the web app's VITE_ variables.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  // Reverse proxies in front of the API (e.g. 1 on Render). Rate limits key on the client IP, so
  // behind a proxy this must be set, or every visitor shares one limit. 0 ignores X-Forwarded-For,
  // so a client cannot spoof it to escape the limit.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Guidance search is optional: without DATABASE_URL the endpoint answers 503 "not configured".
  DATABASE_URL: postgresUrl.optional(),
  EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDERS).default("local-bge-small"),
  SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  SEARCH_EMBED_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  // Evidence gate. Unset until calibrated with `npm run eval:retrieval` on approved content.
  SEARCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).optional(),
  // Answers (chat). Server-side only.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default("claude-haiku-5-5"),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Report which variables are wrong, never their values: they may be secrets.
    throw new Error(`Invalid environment configuration: ${invalidKeys(result.error)}`);
  }
  return result.data;
}

// Configuration for the ingestion and migration CLIs. DATABASE_URL contains a password,
// so it is never logged; use describeDatabase() for log output.
const ingestEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  // Direct (non-pooled) connection for migrations, ingestion and embedding: they hold
  // session-level advisory locks, which transaction-mode poolers cannot keep.
  // `neon env pull` writes it as DATABASE_URL_UNPOOLED; DIRECT_DATABASE_URL overrides it.
  DIRECT_DATABASE_URL: postgresUrl.optional(),
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  INGEST_MAX_CHUNK_CHARS: z.coerce.number().int().default(1_200),
  INGEST_CHUNK_OVERLAP_CHARS: z.coerce.number().int().default(150),
  INGEST_REQUEST_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(250),
  INGEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  INGEST_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDERS).default("local-bge-small"),
  EMBED_BATCH_SIZE: z.coerce.number().int().min(1).max(256).default(32),
  // Generous: the first batch includes loading the model from disk (or downloading it once).
  EMBED_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000)
});

export type IngestConfig = z.infer<typeof ingestEnvSchema>;

export function loadIngestConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const result = ingestEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${invalidKeys(result.error)}`);
  }
  return result.data;
}
