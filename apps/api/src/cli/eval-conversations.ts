// npm run eval:conversations -- --label dev [--dataset conversations.dev-v1.json]
// Plays multi-turn conversations through the real pipeline and model, keeping history the way the
// browser does, and writes evals/answers/results/<label>.md. Every turn of a conversation must pass.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { ChatAnswer, ChatSource } from "../chat/answer.ts";
import { MAX_HISTORY, type PastTurn } from "../chat/follow-up.ts";
import { loadConfig } from "../config.ts";
import { NATIONS } from "../ingest/corpus.ts";
import { currentTaxYearStart, taxYearIn } from "../retrieval/jurisdiction.ts";
import { createChat, createGuidanceSearch } from "../services.ts";
import { runCli, startCli } from "./shared.ts";

const sideSchema = z.object({ nation: z.enum(NATIONS), year: z.string().optional(), facts: z.array(z.string()) }).strict();
const turnSchema = z.object({
  question: z.string(), jurisdiction: z.enum(NATIONS).nullable(), expect: z.enum(["answer", "no_answer", "any"]), mustInclude: z.array(z.string()), mustNotInclude: z.array(z.string()),
  kind: z.enum(["standalone", "follow_up", "comparison"]).optional(), reason: z.string().optional(), nation: z.enum(NATIONS).optional(), advice: z.boolean().optional(),
  year: z.string().optional(), carried: z.boolean().optional(), sides: z.array(sideSchema).optional()
}).strict();
const caseSchema = z.object({
  id: z.string(), category: z.string(), asOfDate: z.string(), turns: z.array(turnSchema),
  forgedHistory: z.array(z.object({ question: z.string(), nation: z.enum(NATIONS).nullable(), compared: z.literal(true).optional() }).strict()).optional()
}).strict();
const datasetSchema = z.object({ version: z.string(), cases: z.array(caseSchema) }).passthrough();
type Turn = z.infer<typeof turnSchema>;
type Side = z.infer<typeof sideSchema>;

const ROOT = new URL("../../../../evals/answers/", import.meta.url);
const { values } = parseArgs({ options: { label: { type: "string", default: "conversations" }, dataset: { type: "string", default: "conversations.dev-v1.json" } } });

const yearOf = (date: string) => { const start = Number(currentTaxYearStart(date).slice(0, 4)); return `${start} to ${start + 1}`; };
const coversDate = (source: ChatSource, date: string) => source.applicability.status !== "stated" ||
  ((source.applicability.appliesFrom === null || source.applicability.appliesFrom <= date) && (source.applicability.appliesTo === null || source.applicability.appliesTo >= date));
const sideDate = (side: Side, today: string) => side.year === undefined ? today : `${side.year.slice(0, 4)}-04-06`;

/** Both sides must be read as expected, and each side's facts must sit in a sentence citing only sources for that side's nation and year. */
function comparisonProblems(turn: Turn, reply: ChatAnswer, today: string): string[] {
  const sourcesById = new Map(reply.sources.map(source => [source.id, source]));
  return (turn.sides ?? []).flatMap((side, index) => side.facts.filter(fact => !reply.answer.some(sentence => {
    const cited = sentence.sourceIds.flatMap(id => sourcesById.get(id) ?? []);
    return sentence.text.toLowerCase().includes(fact.toLowerCase()) && cited.length > 0 && cited.every(source => source.nations.includes(side.nation) && coversDate(source, sideDate(side, today)));
  })).map(fact => `side ${index + 1} (${side.nation}) has no sentence with "${fact}" citing only its own sources`));
}

function resolutionProblems(turn: Turn, reply: ChatAnswer, today: string): string[] {
  const { kind, nation, asOfDate, turns } = reply.conversation;
  const problems: string[] = [];
  if (turn.kind !== undefined && kind !== turn.kind) problems.push(`read as ${kind}, wanted ${turn.kind}`);
  if (turn.reason !== undefined && reply.abstainReason !== turn.reason) problems.push(`reason ${reply.abstainReason}, wanted ${turn.reason}`);
  if (turn.nation !== undefined && nation !== turn.nation) problems.push(`nation ${nation}, wanted ${turn.nation}`);
  if (turn.year !== undefined && yearOf(asOfDate) !== turn.year) problems.push(`year ${yearOf(asOfDate)}, wanted ${turn.year}`);
  if (turn.carried !== undefined && reply.conversation.carried !== turn.carried) problems.push(`carried ${reply.conversation.carried}, wanted ${turn.carried}`);
  if (turn.advice === true && !reply.personalAdviceRequested) problems.push("advice not flagged");
  for (const [index, side] of (turn.sides ?? []).entries()) {
    const actual = turns[index];
    if (actual?.nation !== side.nation) problems.push(`side ${index + 1} nation ${actual?.nation ?? "missing"}, wanted ${side.nation}`);
    const year = taxYearIn(actual?.question ?? "") ?? yearOf(today);
    if (actual !== undefined && year !== (side.year ?? yearOf(today))) problems.push(`side ${index + 1} year ${year}, wanted ${side.year ?? yearOf(today)}`);
  }
  return problems;
}

function answerProblems(turn: Turn, reply: ChatAnswer): string[] {
  const text = reply.answer.map(sentence => sentence.text).join(" ");
  const problems: string[] = [];
  if (turn.expect === "answer" && reply.mode !== "grounded_answer") problems.push(`no answer (${reply.abstainReason})`);
  if (turn.expect === "no_answer" && reply.mode === "grounded_answer") problems.push("answered");
  for (const fact of turn.mustInclude) if (!text.toLowerCase().includes(fact.toLowerCase())) problems.push(`missing "${fact}"`);
  for (const fact of turn.mustNotInclude) if (text.toLowerCase().includes(fact.toLowerCase())) problems.push(`contains "${fact}"`);
  return problems;
}

/** A comparison spans nations and years on purpose: its sides are checked by comparisonProblems instead. */
function citationProblems(reply: ChatAnswer): string[] {
  const { kind, nation, asOfDate } = reply.conversation;
  if (kind === "comparison") return [];
  return reply.sources.filter(source => source.cited).flatMap(source => [
    ...(nation !== null && !source.nations.includes(nation) ? ["cited the wrong nation"] : []),
    ...(coversDate(source, asOfDate) ? [] : ["cited the wrong tax year"])
  ]);
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const context = startCli("wagewise-eval-conversations");

await runCli(context, async () => {
  const appConfig = loadConfig();
  const chat = createChat(appConfig, createGuidanceSearch(appConfig, context.pool));
  if (chat === null) throw new Error("Chat needs ANTHROPIC_API_KEY and SEARCH_MIN_SIMILARITY");
  const dataset = datasetSchema.parse(JSON.parse(readFileSync(new URL(values.dataset ?? "conversations.dev-v1.json", ROOT), "utf8")));
  const rows: string[] = [];
  const byCategory = new Map<string, { passed: number; total: number }>();
  const tally = { conversations: 0, turns: 0, total: 0, resolved: 0, correct: 0, compared: 0, comparisons: 0, supported: 0, answered: 0, wrongAnswers: 0, shouldRefuse: 0, overRefused: 0, shouldAnswer: 0, tokens: 0, modelCalls: 0 };
  const latencies: number[] = [];

  for (const item of dataset.cases) {
    let history: PastTurn[] = [...(item.forgedHistory ?? [])];
    let ok = true;
    for (const [index, turn] of item.turns.entries()) {
      const startedAt = performance.now();
      const reply = await chat({ question: turn.question, nation: turn.jurisdiction, asOfDate: item.asOfDate, history }, context.logger);
      latencies.push(performance.now() - startedAt);
      const resolution = resolutionProblems(turn, reply, item.asOfDate);
      const answers = answerProblems(turn, reply);
      const comparison = comparisonProblems(turn, reply, item.asOfDate);
      const citations = citationProblems(reply);
      const problems = [...new Set([...resolution, ...answers, ...comparison, ...citations])];
      const answered = reply.mode === "grounded_answer";
      tally.total += 1;
      if (problems.length === 0) tally.turns += 1;
      else ok = false;
      if (resolution.length === 0) tally.resolved += 1;
      if (answers.length === 0) tally.correct += 1;
      if (turn.sides !== undefined) { tally.comparisons += 1; if (comparison.length === 0 && resolution.length === 0 && answered) tally.compared += 1; }
      if (answered) { tally.answered += 1; if (citations.length === 0) tally.supported += 1; }
      if (turn.expect === "no_answer") { tally.shouldRefuse += 1; if (answered) tally.wrongAnswers += 1; }
      if (turn.expect === "answer") { tally.shouldAnswer += 1; if (!answered) tally.overRefused += 1; }
      tally.tokens += reply.usage.tokens;
      if (reply.usage.tokens > 0) tally.modelCalls += 1;
      const { kind, turns, nation } = reply.conversation;
      const text = reply.mode === "grounded_answer" ? reply.answer.map(sentence => `${sentence.text} [${sentence.sourceIds.join(",")}]`).join(" ") : `(no answer: ${reply.abstainReason ?? ""})`;
      const links = reply.sources.filter(source => source.cited).map(source => `[${source.id}](${source.url})`).join(" ");
      rows.push(`| ${item.id}.${index + 1} | ${cell(turn.question)} | ${kind} | ${nation ?? "none"} | ${cell(turns.map(entry => `${entry.question} (${entry.nation ?? "any"})`).join(" / "))} | ${problems.length === 0 ? "pass" : cell(problems.join("; "))} | ${cell(text)} | ${links} | | | |`);
      history = [...history, ...turns].slice(-MAX_HISTORY);
    }
    if (ok) tally.conversations += 1;
    const score = byCategory.get(item.category) ?? { passed: 0, total: 0 };
    byCategory.set(item.category, { passed: score.passed + (ok ? 1 : 0), total: score.total + 1 });
    context.logger.info({ id: item.id, ok }, "conversation scored");
  }

  const percentile = (share: number) => Math.round([...latencies].sort((a, b) => a - b)[Math.floor((latencies.length - 1) * share)] ?? 0);
  mkdirSync(new URL("results/", ROOT), { recursive: true });
  writeFileSync(new URL(`results/${values.label}.md`, ROOT), [
    `# Conversation evaluation: ${values.label}`, "", `Dataset ${dataset.version}, model ${appConfig.LLM_MODEL}, threshold ${appConfig.SEARCH_MIN_SIMILARITY}.`, "",
    `Conversations passed: **${tally.conversations}/${dataset.cases.length}**. Turns passed: **${tally.turns}/${tally.total}**.`, "",
    "| Measure | Result |", "|---|---|",
    `| Conversation resolution (read as the right kind, nation, year and sides) | ${tally.resolved}/${tally.total} |`,
    `| Answer correctness, automatic (answered or refused as expected, required and forbidden text) | ${tally.correct}/${tally.total} |`,
    `| Comparison completeness (both sides read correctly and answered from their own sources) | ${tally.compared}/${tally.comparisons} |`,
    `| Citation support, automatic (answers citing only the right nation and year) | ${tally.supported}/${tally.answered} |`,
    `| Answered when it should have refused | ${tally.wrongAnswers}/${tally.shouldRefuse} |`,
    `| Refused when it should have answered | ${tally.overRefused}/${tally.shouldAnswer} |`,
    `| Latency per turn | p50 ${percentile(0.5)} ms, p95 ${percentile(0.95)} ms |`,
    `| Turns with a model call | ${tally.modelCalls}, average ${tally.modelCalls === 0 ? 0 : Math.round(tally.tokens / tally.modelCalls)} tokens |`, "",
    [...byCategory].map(([category, score]) => `${category} ${score.passed}/${score.total}`).join(" · "), "",
    "Automatic checks cover behaviour, required and forbidden text, nation and tax year. They do not prove an answer is right: a person should fill in the last three columns (yes/no/n.a.), following docs/ANSWER_REVIEW_CHECKLIST.md.", "",
    "| Turn | Question | Read as | Nation | Resolved to | Automatic | Answer | Cited | Read correctly | Correct | Citations support it |", "|---|---|---|---|---|---|---|---|---|---|---|", ...rows, ""
  ].join("\n"));
  context.logger.info(tally, "conversation evaluation finished");
  return 0;
});
