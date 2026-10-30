// npm run eval:retrieval                     lexical, vector and hybrid on the configured database
// npm run eval:retrieval -- --modes hybrid   one mode
// npm run eval:retrieval -- --out report.json
// Writes a row to evaluation_runs. Exit 2 if there is no approved content to evaluate.
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createEmbeddingProvider } from "../embeddings/factory.ts";
import { realSleep } from "../ingest/govuk-client.ts";
import { loadDataset } from "../retrieval/eval-dataset.ts";
import { applicableCases, evaluateMode, retrievableSectionUrls, type ModeReport } from "../retrieval/evaluate.ts";
import type { RetrievalMode } from "../retrieval/search.ts";
import { runCli, startCli } from "./shared.ts";

const { values } = parseArgs({ options: { modes: { type: "string", default: "lexical,vector,hybrid" }, out: { type: "string" } } });
const context = startCli("wagewise-eval");
const { config, logger, pool } = context;

const PROJECT_ROOT = realpathSync(new URL("../../../../", import.meta.url));

/** The project's commit, or null if the project is not its own git repository (e.g. nested in another). */
function gitCommit(): string | null {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (realpathSync(git("rev-parse", "--show-toplevel")) !== PROJECT_ROOT) return null;
    return git("rev-parse", "--short", "HEAD");
  } catch {
    return null;
  }
}

function summaryLine(report: ModeReport) {
  const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  return {
    mode: report.mode, evaluated: report.evaluated, answerable: report.answerable,
    recallAt5: percent(report.recallAt5), mrrAt10: report.mrrAt10 === null ? "n/a" : report.mrrAt10.toFixed(3),
    leakageViolations: report.leakageViolations.length, missReasons: report.missReasons,
    unanswerableWithResults: report.unanswerableWithResults, latencyMs: report.latencyMs,
    calibration: report.calibration
  };
}

await runCli(context, async () => {
  const dataset = loadDataset();
  const available = await retrievableSectionUrls(pool);
  if (available.size === 0) {
    logger.error("No approved, live content in this database: benchmark NOT run. Approve licences (docs/LICENCE_REVIEW.md), then run ingest and embed.");
    return 2;
  }
  const { cases, skipped } = applicableCases(dataset, available);
  const provider = createEmbeddingProvider(config.EMBEDDING_PROVIDER);
  const modes = (values.modes ?? "").split(",").filter((mode): mode is RetrievalMode => mode === "lexical" || mode === "vector" || mode === "hybrid");
  // No evidence threshold here: the benchmark measures raw retrieval and calibrates the threshold.
  const dependencies = { pool, provider, logger, retry: { maxAttempts: 2, timeoutMs: 60_000, baseDelayMs: 500, sleep: realSleep }, minSimilarity: null };

  const reports: ModeReport[] = [];
  for (const mode of modes) {
    if (mode !== "lexical" && provider === null) {
      logger.warn({ mode }, "skipped: no embedding provider configured");
      continue;
    }
    const report = await evaluateMode(dependencies, cases, mode, dataset.createdAt);
    reports.push(report);
    logger.info(summaryLine(report), "mode evaluated");
  }

  const output = {
    datasetVersion: dataset.version,
    embeddingModel: provider?.modelId ?? null,
    retrievableSections: available.size,
    casesEvaluated: cases.length,
    casesSkipped: skipped,
    reports
  };
  await pool.query(
    "INSERT INTO evaluation_runs (git_commit, embedding_model, generation_model, test_set_version, metrics, limitations) VALUES ($1, $2, NULL, $3, $4, $5)",
    [gitCommit(), provider?.modelId ?? null, dataset.version, JSON.stringify(reports.map(summaryLine)),
      skipped.length === 0 ? null : `${skipped.length} answerable cases skipped: expected sections not retrievable in this database`]);
  if (values.out !== undefined) writeFileSync(values.out, `${JSON.stringify(output, null, 2)}\n`);
  logger.info({ casesEvaluated: cases.length, casesSkipped: skipped.length, retrievableSections: available.size }, "benchmark finished");
  return 0;
});
