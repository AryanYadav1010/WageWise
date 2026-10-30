// npm run ingest:check   compares GOV.UK with the stored guides and changes nothing.
// Exit codes: 0 nothing changed, 2 a guide changed or disappeared (act on it), 1 the check failed.
// An upstream error is not a change: only a new hash, a withdrawal, a redirect or a 404 counts.
import { CORPUS } from "../ingest/corpus.ts";
import { fetchGovukDocument, realSleep } from "../ingest/govuk-client.ts";
import { runCli, startCli } from "./shared.ts";

const context = startCli("wagewise-freshness");
const { config, logger, pool } = context;

await runCli(context, async () => {
  const stored = await pool.query<{ base_path: string; content_sha256: string; licence_status: string }>(`
    SELECT d.base_path, v.content_sha256, d.licence_status
    FROM source_documents d JOIN document_versions v ON v.document_id = d.id AND v.status = 'active'`);
  const byPath = new Map(stored.rows.map(row => [row.base_path, row]));
  let attention = 0;
  let failed = 0;

  for (const entry of CORPUS) {
    const outcome = await fetchGovukDocument(entry.basePath, { timeoutMs: config.INGEST_TIMEOUT_MS, maxAttempts: config.INGEST_MAX_ATTEMPTS });
    const known = byPath.get(entry.basePath);
    const changed = outcome.kind === "ok" ? outcome.document.contentSha256 !== known?.content_sha256 : outcome.kind !== "failed";
    if (outcome.kind === "failed") {
      failed += 1;
      logger.warn({ basePath: entry.basePath, reason: outcome.reason }, "could not check this guide");
    } else if (changed) {
      attention += 1;
      // Changes to approved guides matter most: they can alter what users are told.
      logger.warn({ basePath: entry.basePath, change: outcome.kind, approved: known?.licence_status === "approved" }, "guide changed on GOV.UK");
    }
    await realSleep(config.INGEST_REQUEST_DELAY_MS);
  }
  logger.info({ checked: CORPUS.length, changed: attention, failed }, "freshness check finished");
  if (attention > 0) return 2;
  return failed === CORPUS.length ? 1 : 0;
});
