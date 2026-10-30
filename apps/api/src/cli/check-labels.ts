// npm run eval:check-labels   confirm every evaluation label against the stored corpus.
import { checkLabels, loadDataset } from "../retrieval/eval-dataset.ts";
import { runCli, startCli } from "./shared.ts";

const context = startCli("wagewise-check-labels");

await runCli(context, async () => {
  const dataset = loadDataset();
  const problems = await checkLabels(context.pool, dataset);
  for (const problem of problems) context.logger.error(problem, "label problem");
  context.logger.info({ version: dataset.version, cases: dataset.cases.length, problems: problems.length }, "labels checked");
  return problems.length === 0 ? 0 : 1;
});
