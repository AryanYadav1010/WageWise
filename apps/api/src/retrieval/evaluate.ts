import type { Pool } from "../db/pool.ts";
import type { EvalCase, EvalDataset } from "./eval-dataset.ts";
import { searchGuidance, type RetrievalMode, type SearchDependencies } from "./search.ts";

export const RECALL_AT = 5;
export const RESULTS_EXAMINED = 10;

export type MissReason = "no_results" | "ranked_6_to_10" | "not_in_top_10";

export type CaseResult = {
  id: string;
  category: EvalCase["category"];
  answerable: boolean;
  returnedUrls: string[];
  /** 1-based rank of the first expected section, or null. */
  firstRelevantRank: number | null;
  hitAtK: boolean;
  reciprocalRank: number;
  /** mustNotInclude sections that appeared anywhere in the returned results. */
  leaked: string[];
  missReason: MissReason | null;
  /** Cosine similarity of the closest passage (null in lexical mode). */
  bestSimilarity: number | null;
  latencyMs: number;
};

export type ThresholdPoint = { threshold: number; answerableKept: number; unanswerableRejected: number; balancedAccuracy: number };
export type Calibration = {
  casesWithScores: number;
  /** Maximises balanced accuracy (ties: the lower threshold, which keeps more answers). */
  bestBalanced: ThresholdPoint | null;
  /** The strictest threshold that still keeps at least 95% of answerable questions. */
  keeps95PercentOfAnswerable: ThresholdPoint | null;
};

export type ModeReport = {
  mode: RetrievalMode;
  evaluated: number;
  answerable: number;
  recallAt5: number | null;
  mrrAt10: number | null;
  byCategory: Record<string, { answerable: number; recallAt5: number | null }>;
  leakageViolations: { caseId: string; url: string }[];
  missReasons: Record<MissReason, number>;
  /** Unanswerable cases that still returned results. Informational until an evidence threshold exists. */
  unanswerableWithResults: number;
  latencyMs: { p50: number; p95: number; max: number };
  calibration: Calibration | null;
  cases: CaseResult[];
};

export function scoreCase(item: EvalCase, returnedUrls: string[], measured: { bestSimilarity: number | null; latencyMs: number } = { bestSimilarity: null, latencyMs: 0 }): CaseResult {
  const expected = new Set(item.expected.map(entry => entry.url));
  const index = returnedUrls.findIndex(url => expected.has(url));
  const firstRelevantRank = index === -1 ? null : index + 1;
  const hitAtK = firstRelevantRank !== null && firstRelevantRank <= RECALL_AT;
  let missReason: MissReason | null = null;
  if (item.answerable && !hitAtK) {
    if (returnedUrls.length === 0) missReason = "no_results";
    else missReason = firstRelevantRank === null ? "not_in_top_10" : "ranked_6_to_10";
  }
  return {
    id: item.id,
    category: item.category,
    answerable: item.answerable,
    returnedUrls,
    firstRelevantRank,
    hitAtK,
    reciprocalRank: firstRelevantRank === null ? 0 : 1 / firstRelevantRank,
    leaked: item.mustNotInclude.filter(url => returnedUrls.includes(url)),
    missReason,
    bestSimilarity: measured.bestSimilarity,
    latencyMs: measured.latencyMs
  };
}

const mean = (values: number[]): number | null => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

function pointAt(threshold: number, answerable: number[], unanswerable: number[]): ThresholdPoint {
  const answerableKept = answerable.filter(score => score >= threshold).length / answerable.length;
  const unanswerableRejected = unanswerable.filter(score => score < threshold).length / unanswerable.length;
  return { threshold, answerableKept, unanswerableRejected, balancedAccuracy: (answerableKept + unanswerableRejected) / 2 };
}

/**
 * Chooses a minimum similarity from labelled cases: answerable questions should keep their
 * results, unanswerable ones (negative and ambiguous) should get none. Only meaningful on the
 * real corpus; a fixture subset is too small to calibrate on.
 */
export function calibrateThreshold(results: readonly CaseResult[]): Calibration | null {
  const scored = results.filter(result => result.bestSimilarity !== null);
  const answerable = scored.filter(result => result.answerable).map(result => result.bestSimilarity as number);
  const unanswerable = scored.filter(result => !result.answerable).map(result => result.bestSimilarity as number);
  if (answerable.length === 0 || unanswerable.length === 0) return null;

  const candidates = [...new Set([...answerable, ...unanswerable])].sort((a, b) => a - b);
  const points = candidates.map(threshold => pointAt(threshold, answerable, unanswerable));
  const bestBalanced = points.reduce<ThresholdPoint | null>((best, point) =>
    best === null || point.balancedAccuracy > best.balancedAccuracy ? point : best, null);
  const keeps95 = points.filter(point => point.answerableKept >= 0.95);
  return {
    casesWithScores: scored.length,
    bestBalanced,
    keeps95PercentOfAnswerable: keeps95.length === 0 ? null : keeps95[keeps95.length - 1] ?? null
  };
}

export function summarise(mode: RetrievalMode, results: CaseResult[]): ModeReport {
  const answerable = results.filter(result => result.answerable);
  const byCategory: ModeReport["byCategory"] = {};
  for (const category of new Set(results.map(result => result.category))) {
    const inCategory = answerable.filter(result => result.category === category);
    byCategory[category] = { answerable: inCategory.length, recallAt5: mean(inCategory.map(result => (result.hitAtK ? 1 : 0))) };
  }
  const missReasons: Record<MissReason, number> = { no_results: 0, ranked_6_to_10: 0, not_in_top_10: 0 };
  for (const result of answerable) if (result.missReason !== null) missReasons[result.missReason] += 1;
  return {
    mode,
    evaluated: results.length,
    answerable: answerable.length,
    recallAt5: mean(answerable.map(result => (result.hitAtK ? 1 : 0))),
    mrrAt10: mean(answerable.map(result => result.reciprocalRank)),
    byCategory,
    leakageViolations: results.flatMap(result => result.leaked.map(url => ({ caseId: result.id, url }))),
    missReasons,
    unanswerableWithResults: results.filter(result => !result.answerable && result.returnedUrls.length > 0).length,
    latencyMs: {
      p50: percentile(results.map(result => result.latencyMs), 0.5),
      p95: percentile(results.map(result => result.latencyMs), 0.95),
      max: Math.max(0, ...results.map(result => result.latencyMs))
    },
    calibration: mode === "lexical" ? null : calibrateThreshold(results),
    cases: results
  };
}

/** URLs of sections that retrieval can currently return (approved, live, active). */
export async function retrievableSectionUrls(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ section_url: string }>("SELECT DISTINCT section_url FROM retrievable_chunks");
  return new Set(result.rows.map(row => row.section_url));
}

/**
 * Selects the cases that can be evaluated against this database. An answerable case whose
 * expected sections are all absent (e.g. a fixture database with 5 of the 25 guides) is
 * skipped and counted, never scored as a miss or a hit.
 */
export function applicableCases(dataset: EvalDataset, available: Set<string>): { cases: EvalCase[]; skipped: string[] } {
  const cases: EvalCase[] = [];
  const skipped: string[] = [];
  for (const item of dataset.cases) {
    const reachable = item.expected.some(entry => available.has(entry.url));
    if (item.answerable && !reachable) skipped.push(item.id);
    else cases.push(item);
  }
  return { cases, skipped };
}

export async function evaluateMode(dependencies: SearchDependencies, cases: EvalCase[], mode: RetrievalMode, defaultAsOfDate: string): Promise<ModeReport> {
  const results: CaseResult[] = [];
  for (const item of cases) {
    const startedAt = performance.now();
    const outcome = await searchGuidance(dependencies, {
      query: item.question,
      nation: item.jurisdiction,
      asOfDate: item.asOfDate ?? defaultAsOfDate,
      limit: RESULTS_EXAMINED
    }, mode);
    const latencyMs = Math.round(performance.now() - startedAt);
    results.push(scoreCase(item, outcome.results.map(result => result.sectionUrl), { bestSimilarity: outcome.bestSimilarity, latencyMs }));
  }
  return summarise(mode, results);
}
