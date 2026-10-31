// npm run review:sheet -- --commit abc1234
// Builds the priority human review from the latest benchmark sheets: the answers where a mistake
// costs most, one row for each distinct set of figures. It marks nothing as reviewed. Re-run it
// after any change to answers, because a sign-off only covers the answers it saw.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { asksForPersonalAdvice, figuresIn } from "../chat/answer.ts";
import { readJurisdiction, taxYearsIn } from "../retrieval/jurisdiction.ts";

const CURRENT_YEAR = "2026 to 2027";
const ROOT = new URL("../../../../evals/answers/", import.meta.url);
const CONVERSATION_SHEETS = ["37-dev-v2-final", "40-holdout-v3", "48-holdout-v2-conversations-final", "38-dev-v1-final"];
const QUESTION_SHEETS = ["42-advice-final", "43-advice-holdout-final", "41-jurisdiction-final", "32-frozen-final", "46-holdout-v3-single-final"];
const RISKS = ["Comparison", "Past tax year", "Advice", "Figures"] as const;
type Risk = (typeof RISKS)[number];
type Row = { risk: Risk; sheet: string; id: string; question: string; reading: string; nation: string; answer: string; cited: string };

const { values } = parseArgs({ options: { commit: { type: "string", default: "not recorded" } } });

function tableRows(sheet: string): string[][] {
  const lines = readFileSync(new URL(`results/${sheet}.md`, ROOT), "utf8").split("\n").filter(line => line.startsWith("| ") && !line.startsWith("| Id ") && !line.startsWith("| Turn ") && !line.startsWith("| Measure ") && !line.startsWith("| Conversation resolution"));
  return lines.map(line => line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim())).filter(cells => cells.length >= 6 && !/^-+$/.test(cells[0] ?? ""));
}

function riskOf(kind: string, question: string, reading: string, answer: string): Risk | null {
  if (answer.startsWith("(no answer")) return null;
  if (kind === "comparison") return "Comparison";
  if (asksForPersonalAdvice(question)) return "Advice";
  if (taxYearsIn(`${question} ${reading}`).some(year => year !== CURRENT_YEAR)) return "Past tax year";
  return figuresIn(answer).length > 0 ? "Figures" : null;
}

const conversationRows = CONVERSATION_SHEETS.flatMap(sheet => tableRows(sheet).map(([id = "", question = "", kind = "", nation = "", reading = "", , answer = "", cited = ""]) => ({ sheet, id, question, reading, nation, answer, cited, risk: riskOf(kind, question, reading, answer) })));
const questionRows = QUESTION_SHEETS.flatMap(sheet => tableRows(sheet).map(([id = "", question = "", nation = "", , answer = "", cited = ""]) => ({ sheet, id, question, reading: "", nation, answer, cited, risk: riskOf("standalone", question, "", answer) })));

// The same fact for the same nation needs checking once, however the sentence is worded.
const seen = new Set<string>();
const rows = [...conversationRows, ...questionRows].flatMap(row => {
  if (row.risk === null) return [];
  // The leading figures are the fact being stated. Later ones are usually the Personal Allowance, repeated in every answer.
  const nations = [...row.reading.matchAll(/\(([a-z-]+)\)/g)].map(([, nation]) => nation).join(" ") || (readJurisdiction(row.question, null).nation ?? row.nation);
  const key = [row.risk, nations, ...[...new Set(figuresIn(row.answer))].slice(0, row.risk === "Comparison" ? 4 : 2)].join(" ");
  if (seen.has(key)) return [];
  seen.add(key);
  return [row as Row];
}).sort((a, b) => RISKS.indexOf(a.risk) - RISKS.indexOf(b.risk));

const lines = [
  "# Priority human review", "",
  "**Status: NOT REVIEWED.** Nobody has signed this off. Automatic checks and an AI reading these answers are not a human review.", "",
  `Answers from commit \`${values.commit}\`. ${rows.length} rows: ${RISKS.map(risk => `${rows.filter(row => row.risk === risk).length} ${risk.toLowerCase()}`).join(", ")}. Allow about 2 minutes a row. How to mark them is in [the checklist](../../../docs/ANSWER_REVIEW_CHECKLIST.md).`, "",
  "| Risk | Sheet | Row | Question | Read as | Nation | Answer | Cited | Correct | Citations support it | Not a recommendation | Note |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(row => `| ${row.risk} | ${row.sheet.split("-")[0]} | ${row.id} | ${row.question} | ${row.reading} | ${row.nation} | ${row.answer} | ${row.cited} | | | | |`), "",
  "## Sign-off", "",
  "A sign-off covers only these answers from this commit. Any change to the model, prompt, thresholds, guides or answer code needs this sheet regenerated and reviewed again.", "",
  "| Reviewer | Date | Commit reviewed | Rows marked no | Stop items | Decision (pass or fail) |", "|---|---|---|---|---|---|", "| | | | | | |", ""
];
mkdirSync(new URL("review/", ROOT), { recursive: true });
writeFileSync(new URL("review/v3-priority.md", ROOT), lines.join("\n"));
console.log(`${rows.length} rows: ${RISKS.map(risk => `${risk} ${rows.filter(row => row.risk === risk).length}`).join(", ")}`);
