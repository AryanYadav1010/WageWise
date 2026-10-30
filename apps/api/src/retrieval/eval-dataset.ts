import { readFileSync } from "node:fs";
import { z } from "zod";
import { isValidIsoDate } from "../domain/dates.ts";
import type { Pool } from "../db/pool.ts";
import { NATIONS } from "../ingest/corpus.ts";

export const DEFAULT_DATASET_URL = new URL("../../../../evals/retrieval/questions.v1.json", import.meta.url);

const govukUrl = z.string().regex(/^https:\/\/www\.gov\.uk\/[a-z0-9/-]+$/);

const caseSchema = z.object({
  id: z.string().regex(/^[a-z]+-\d{2}$/),
  category: z.enum(["exact_keyword", "paraphrase", "nation_specific", "tax_year", "negative", "ambiguous"]),
  question: z.string().min(1).max(500),
  jurisdiction: z.enum(NATIONS).nullable(),
  asOfDate: z.string().refine(isValidIsoDate).nullable(),
  answerable: z.boolean(),
  expected: z.array(z.object({ url: govukUrl, evidence: z.string().min(1) }).strict()),
  mustNotInclude: z.array(govukUrl),
  rationale: z.string().min(10)
}).strict().refine(item => item.answerable === (item.expected.length > 0), {
  message: "answerable cases need expected sections; unanswerable cases must have none"
});

const datasetSchema = z.object({
  version: z.string().min(1),
  createdAt: z.string().refine(isValidIsoDate),
  description: z.string(),
  cases: z.array(caseSchema).min(1)
}).strict();

export type EvalCase = z.infer<typeof caseSchema>;
export type EvalDataset = z.infer<typeof datasetSchema>;

export function parseDataset(raw: unknown): EvalDataset {
  const dataset = datasetSchema.parse(raw);
  const ids = dataset.cases.map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate case id in evaluation dataset");
  return dataset;
}

export function loadDataset(fileUrl: URL = DEFAULT_DATASET_URL): EvalDataset {
  return parseDataset(JSON.parse(readFileSync(fileUrl, "utf8")));
}

export type LabelProblem = { caseId: string; problem: string };

/**
 * Checks labels against the stored corpus (active versions, any licence status): every
 * expected section exists and contains its evidence phrase, and every mustNotInclude URL
 * exists. Reading our own stored text is internal curation, not retrieval or exposure.
 */
export async function checkLabels(pool: Pool, dataset: EvalDataset): Promise<LabelProblem[]> {
  const result = await pool.query<{ url: string; text: string }>(`
    SELECT s.url, s.text FROM document_sections s
    JOIN document_versions v ON v.id = s.version_id AND v.status = 'active'`);
  const textByUrl = new Map(result.rows.map(row => [row.url, row.text.toLowerCase()]));

  const problems: LabelProblem[] = [];
  for (const item of dataset.cases) {
    for (const expected of item.expected) {
      const text = textByUrl.get(expected.url);
      if (text === undefined) {
        problems.push({ caseId: item.id, problem: `expected section not in corpus: ${expected.url}` });
      } else if (!text.includes(expected.evidence.toLowerCase())) {
        problems.push({ caseId: item.id, problem: `evidence "${expected.evidence}" not found in ${expected.url}` });
      }
    }
    for (const url of item.mustNotInclude) {
      if (!textByUrl.has(url)) problems.push({ caseId: item.id, problem: `mustNotInclude section not in corpus: ${url}` });
    }
  }
  return problems;
}
