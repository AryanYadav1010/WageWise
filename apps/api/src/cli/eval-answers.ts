// npm run eval:answers -- --label baseline [--runs 3] [--dataset questions.holdout-v1.json]
// Runs the frozen answer set through the real pipeline and model on the configured database, and
// writes evals/answers/results/<label>.md: automatic scores, plus blank columns for a person.
// The automatic checks prove nothing about full factual correctness; the human review does that job.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { ChatAnswer } from "../chat/answer.ts";
import { loadConfig } from "../config.ts";
import { NATIONS } from "../ingest/corpus.ts";
import { createChat, createGuidanceSearch } from "../services.ts";
import { runCli, startCli } from "./shared.ts";

const caseSchema = z.object({
  id: z.string(), category: z.string(), question: z.string(), jurisdiction: z.enum(NATIONS).nullable(), asOfDate: z.string(),
  expect: z.enum(["answer", "no_answer", "any"]), mustInclude: z.array(z.string()), mustNotInclude: z.array(z.string())
}).strict();
const datasetSchema = z.object({ version: z.string(), cases: z.array(caseSchema) }).passthrough();
type Case = z.infer<typeof caseSchema>;

const ROOT = new URL("../../../../evals/answers/", import.meta.url);
const { values } = parseArgs({ options: { label: { type: "string", default: "latest" }, runs: { type: "string", default: "1" }, dataset: { type: "string", default: "questions.v1.json" } } });

/** Returns the reasons a run failed; empty means it passed the automatic checks. */
function failures(item: Case, reply: ChatAnswer): string[] {
  const text = reply.answer.map(sentence => sentence.text).join(" ");
  const problems: string[] = [];
  if (item.expect === "answer" && reply.mode !== "grounded_answer") problems.push(`no answer (${reply.abstainReason})`);
  if (item.expect === "no_answer" && reply.mode === "grounded_answer") problems.push("answered");
  for (const fact of item.mustInclude) if (!text.toLowerCase().includes(fact.toLowerCase())) problems.push(`missing "${fact}"`);
  for (const fact of item.mustNotInclude) if (text.toLowerCase().includes(fact.toLowerCase())) problems.push(`contains "${fact}"`);
  const { nation, asOfDate: date } = reply.conversation;
  if (nation !== null && reply.sources.some(source => source.cited && !source.nations.includes(nation))) problems.push("cited the wrong nation");
  for (const source of reply.sources.filter(cited => cited.cited && cited.applicability.status === "stated")) {
    const { appliesFrom, appliesTo } = source.applicability as { appliesFrom: string | null; appliesTo: string | null };
    if ((appliesFrom !== null && appliesFrom > date) || (appliesTo !== null && appliesTo < date)) problems.push("cited the wrong tax year");
  }
  return problems;
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const context = startCli("wagewise-eval-answers");

await runCli(context, async () => {
  const appConfig = loadConfig();
  const chat = createChat(appConfig, createGuidanceSearch(appConfig, context.pool));
  if (chat === null) throw new Error("Chat needs ANTHROPIC_API_KEY and SEARCH_MIN_SIMILARITY");
  const dataset = datasetSchema.parse(JSON.parse(readFileSync(new URL(values.dataset ?? "questions.v1.json", ROOT), "utf8")));
  const runs = Number(values.runs);
  const rows: string[] = [];
  const byCategory = new Map<string, { passed: number; total: number }>();
  let passed = 0;
  let stable = 0;
  const latencies: number[] = [];
  const cachedLatencies: number[] = [];
  const modelLatencies: number[] = [];
  let tokens = 0;
  let modelCalls = 0;
  let dropped = 0;

  for (const item of dataset.cases) {
    const replies: ChatAnswer[] = [];
    for (let run = 0; run < runs; run += 1) {
      const startedAt = performance.now();
      const reply = await chat({ question: item.question, nation: item.jurisdiction, asOfDate: item.asOfDate }, context.logger);
      const elapsed = performance.now() - startedAt;
      if (reply.usage.cached) cachedLatencies.push(elapsed);
      else if (reply.usage.tokens > 0) modelLatencies.push(elapsed);
      else latencies.push(elapsed);
      replies.push(reply);
      tokens += reply.usage.tokens;
      if (reply.usage.tokens > 0) modelCalls += 1;
      dropped += reply.droppedSentences;
    }
    const problems = [...new Set(replies.flatMap(reply => failures(item, reply)))];
    const reply = replies[0];
    if (reply === undefined) continue;
    const ok = problems.length === 0;
    if (ok) passed += 1;
    if (new Set(replies.map(entry => entry.answer.map(sentence => sentence.text).join(" "))).size === 1) stable += 1;
    const score = byCategory.get(item.category) ?? { passed: 0, total: 0 };
    byCategory.set(item.category, { passed: score.passed + (ok ? 1 : 0), total: score.total + 1 });
    const text = reply.mode === "grounded_answer" ? reply.answer.map(sentence => `${sentence.text} [${sentence.sourceIds.join(",")}]`).join(" ") : `(no answer: ${reply.abstainReason ?? ""})`;
    const links = reply.sources.filter(source => source.cited).map(source => `[${source.id}](${source.url})`).join(" ");
    rows.push(`| ${item.id} | ${cell(item.question)} | ${item.jurisdiction ?? "not given"} | ${ok ? "pass" : cell(problems.join("; "))} | ${cell(text)} | ${links} | | | | | | |`);
    context.logger.info({ id: item.id, ok, problems }, "case scored");
  }

  const median = (values: number[]) => Math.round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0);
  const summary = [
    `Automatic score: **${passed}/${dataset.cases.length}**. Runs per question: ${runs}${runs > 1 ? `. Identical text across runs: ${stable}/${dataset.cases.length}` : ""}. Median time: ${median(modelLatencies)} ms with a model call (${modelLatencies.length}), ${median(cachedLatencies)} ms from cache (${cachedLatencies.length}), ${median(latencies)} ms when no model was needed (${latencies.length}).`,
    `Model calls: ${modelCalls}, average ${modelCalls === 0 ? 0 : Math.round(tokens / modelCalls)} tokens per call. Sentences dropped by the checks: ${dropped}.`,
    [...byCategory].map(([category, score]) => `${category} ${score.passed}/${score.total}`).join(" · ")
  ];
  mkdirSync(new URL("results/", ROOT), { recursive: true });
  writeFileSync(new URL(`results/${values.label}.md`, ROOT), [
    `# Answer evaluation: ${values.label}`, "", `Dataset ${dataset.version}, model ${appConfig.LLM_MODEL}, threshold ${appConfig.SEARCH_MIN_SIMILARITY}.`, "",
    ...summary.flatMap(line => [line, ""]),
    "Automatic checks cover behaviour, required and forbidden text, nation and tax year. They do not prove the answer is right: a person should fill in the last six columns (yes/no/n.a.), following docs/ANSWER_REVIEW_CHECKLIST.md.", "",
    "| Id | Question | Nation | Automatic | First answer | Cited | Correct | Citations support it | Complete | Not a recommendation | Right abstention | Injection resisted |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|", ...rows, ""
  ].join("\n"));
  context.logger.info({ passed, total: dataset.cases.length, stable }, "answer evaluation finished");
  return 0;
});
