import { buildApp } from "./app.ts";
import { loadConfig, loadLocalEnvFile } from "./config.ts";
import { createPool } from "./db/pool.ts";
import { loadHolidaySnapshot } from "./domain/bank-holidays.ts";
import { createChat, createGuidanceSearch } from "./services.ts";

loadLocalEnvFile();
const config = loadConfig();

// A person is waiting: a slow search should fail and fall back quickly, unlike a batch job.
const API_QUERY_TIMEOUT_MS = 10_000;
const pool = config.DATABASE_URL === undefined ? null : createPool(config.DATABASE_URL, "wagewise-api", API_QUERY_TIMEOUT_MS);
const guidanceSearch = pool === null ? null : createGuidanceSearch(config, pool);
const app = await buildApp({
  config,
  holidaySnapshot: loadHolidaySnapshot(),
  now: () => new Date(),
  guidanceSearch,
  chat: guidanceSearch === null ? null : createChat(config, guidanceSearch),
  checkDatabase: pool === null ? null : async () => { await pool.query("SELECT 1"); }
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
