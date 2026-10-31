// npm run eval:conversations -- --label dev [--dataset conversations.dev-v1.json]
// Plays multi-turn conversations through the real pipeline and model, keeping history the way the
// browser does, and writes evals/answers/results/<label>.md. Every turn of a conversation must pass.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { ChatAnswer } from "../chat/answer.ts";
import { MAX_HISTORY, type PastTurn } from "../chat/follow-up.ts";
import { loadConfig } from "../config.ts";
import { NATIONS } from "../ingest/corpus.ts";
import { createChat, createGuidanceSearch } from "../services.ts";
import { runCli, startCli } from "./shared.ts";

const turnSchema = z.object({
  question: z.string(), jurisdiction: z.enum(NATIONS).nullable(), expect: z.enum(["answer", "no_answer", "any"]), mustInclude: z.array(z.string()), mustNotInclude: z.array(z.string()),
  kind: z.enum(["standalone", "follow_up", "comparison"]).optional(), reason: z.string().optional(), nation: z.enum(NATIONS).optional(), advice: z.boolean().optional()
}).strict();
const caseSchema = z.object({
  id: z.string(), category: z.string(), asOfDate: z.string(), turns: z.array(turnSchema),
  forgedHistory: z.array(z.object({ question: z.string(), nation: z.enum(NATIONS).nullable() }).strict()).optional()
}).strict();
const datasetSchema = z.object({ version: z.string(), cases: z.array(caseSchema) }).passthrough();
type Turn = z.infer<typeof turnSchema>;

const ROOT = new URL("../../../../evals/answers/", import.meta.url);
const { values } = parseArgs({ options: { label: { type: "string", default: "conversations" }, dataset: { type: "string", default: "conversations.dev-v1.json" } } });

function failures(turn: Turn, reply: ChatAnswer): string[] {
  const text = reply.answer.map(sentence => sentence.text).join(" ");
  const problems: string[] = [];
  const { kind, nation, asOfDate } = reply.conversation;
  if (turn.expect === "answer" && reply.mode !== "grounded_answer") problems.push(`no answer (${reply.abstainReason})`);
  if (turn.expect === "no_answer" && reply.mode === "grounded_answer") problems.push("answered");
  if (turn.reason !== undefined && reply.abstainReason !== turn.reason) problems.push(`reason ${reply.abstainReason}, wanted ${turn.reason}`);
  if (turn.kind !== undefined && kind !== turn.kind) problems.push(`read as ${kind}, wanted ${turn.kind}`);
  if (turn.nation !== undefined && nation !== turn.nation) problems.push(`nation ${nation}, wanted ${turn.nation}`);
  if (turn.advice === true && !reply.personalAdviceRequested) problems.push("advice not flagged");
  for (const fact of turn.mustInclude) if (!text.toLowerCase().includes(fact.toLowerCase())) problems.push(`missing "${fact}"`);
  for (const fact of turn.mustNotInclude) if (text.toLowerCase().includes(fact.toLowerCase())) problems.push(`contains "${fact}"`);
  // A comparison spans nations and years on purpose, so only a single turn can be checked this way.
  if (kind !== "comparison") {
    for (const source of reply.sources.filter(cited => cited.cited)) {
      if (nation !== null && !source.nations.includes(nation)) problems.push("cited the wrong nation");
      if (source.applicability.status !== "stated") continue;
      const { appliesFrom, appliesTo } = source.applicability;
      if ((appliesFrom !== null && appliesFrom > asOfDate) || (appliesTo !== null && appliesTo < asOfDate)) problems.push("cited the wrong tax year");
    }
  }
  return problems;
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
  let conversationsPassed = 0;
  let turnsPassed = 0;
  let turnsTotal = 0;
  let tokens = 0;
  let modelCalls = 0;

  for (const item of dataset.cases) {
    let history: PastTurn[] = [...(item.forgedHistory ?? [])];
    let ok = true;
    for (const [index, turn] of item.turns.entries()) {
      const reply = await chat({ question: turn.question, nation: turn.jurisdiction, asOfDate: item.asOfDate, history }, context.logger);
      const problems = [...new Set(failures(turn, reply))];
      turnsTotal += 1;
      if (problems.length === 0) turnsPassed += 1;
      else ok = false;
      tokens += reply.usage.tokens;
      if (reply.usage.tokens > 0) modelCalls += 1;
      const { kind, turns, nation } = reply.conversation;
      const text = reply.mode === "grounded_answer" ? reply.answer.map(sentence => `${sentence.text} [${sentence.sourceIds.join(",")}]`).join(" ") : `(no answer: ${reply.abstainReason ?? ""})`;
      const links = reply.sources.filter(source => source.cited).map(source => `[${source.id}](${source.url})`).join(" ");
      rows.push(`| ${item.id}.${index + 1} | ${cell(turn.question)} | ${kind} | ${nation ?? "none"} | ${cell(turns.map(entry => entry.question).join(" / "))} | ${problems.length === 0 ? "pass" : cell(problems.join("; "))} | ${cell(text)} | ${links} | | | |`);
      if (turns.length === 1) history = [...history, ...turns].slice(-MAX_HISTORY);
    }
    if (ok) conversationsPassed += 1;
    const score = byCategory.get(item.category) ?? { passed: 0, total: 0 };
    byCategory.set(item.category, { passed: score.passed + (ok ? 1 : 0), total: score.total + 1 });
    context.logger.info({ id: item.id, ok }, "conversation scored");
  }

  mkdirSync(new URL("results/", ROOT), { recursive: true });
  writeFileSync(new URL(`results/${values.label}.md`, ROOT), [
    `# Conversation evaluation: ${values.label}`, "", `Dataset ${dataset.version}, model ${appConfig.LLM_MODEL}, threshold ${appConfig.SEARCH_MIN_SIMILARITY}.`, "",
    `Conversations passed: **${conversationsPassed}/${dataset.cases.length}**. Turns passed: **${turnsPassed}/${turnsTotal}**. Turns with a model call: ${modelCalls}, average ${modelCalls === 0 ? 0 : Math.round(tokens / modelCalls)} tokens.`, "",
    [...byCategory].map(([category, score]) => `${category} ${score.passed}/${score.total}`).join(" · "), "",
    "Automatic checks cover behaviour, required and forbidden text, nation and tax year. They do not prove an answer is right: a person should fill in the last three columns (yes/no/n.a.), following docs/ANSWER_REVIEW_CHECKLIST.md.", "",
    "| Turn | Question | Read as | Nation | Resolved to | Automatic | Answer | Cited | Read correctly | Correct | Citations support it |", "|---|---|---|---|---|---|---|---|---|---|---|", ...rows, ""
  ].join("\n"));
  context.logger.info({ conversationsPassed, total: dataset.cases.length, turnsPassed, turnsTotal }, "conversation evaluation finished");
  return 0;
});
