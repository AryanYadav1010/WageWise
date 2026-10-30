// npm run ingest:verify   integrity and provenance checks on stored content; exit 1 if any fail.
import { verifyStore } from "../ingest/verify.ts";
import { runCli, startCli } from "./shared.ts";

const context = startCli("wagewise-verify");

await runCli(context, async () => {
  const report = await verifyStore(context.pool);
  for (const document of report.documents) {
    context.logger.info(document, "document");
  }
  const totals = report.documents.reduce(
    (sum, document) => ({ sections: sum.sections + document.sections, chunks: sum.chunks + document.chunks, versions: sum.versions + document.versions }),
    { sections: 0, chunks: 0, versions: 0 }
  );
  for (const problem of report.problems) {
    context.logger.error(problem, "integrity problem");
  }
  context.logger.info({ documents: report.documents.length, ...totals, problems: report.problems.length }, "verification finished");
  return report.problems.length === 0 ? 0 : 1;
});
