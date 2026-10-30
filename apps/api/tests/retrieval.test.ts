import { describe, expect, it } from "vitest";
import { loadDataset, parseDataset } from "../src/retrieval/eval-dataset.ts";
import { calibrateThreshold, scoreCase, summarise } from "../src/retrieval/evaluate.ts";
import { makeExcerpt, queryTerms, reciprocalRankFusion, RRF_K } from "../src/retrieval/search.ts";

describe("queryTerms", () => {
  it("keeps only lowercase letters and digits, so tsquery syntax cannot be injected", () => {
    expect(queryTerms("Tax & code | !1257L:* (K)")).toEqual(["tax", "code", "1257l", "k"]);
    expect(queryTerms("'; DROP TABLE document_chunks; --")).toEqual(["drop", "table", "document", "chunks"]);
  });

  it("de-duplicates, drops absurdly long tokens and caps the number of terms", () => {
    expect(queryTerms("tax TAX Tax")).toEqual(["tax"]);
    expect(queryTerms(`${"x".repeat(41)} tax`)).toEqual(["tax"]);
    expect(queryTerms(Array.from({ length: 50 }, (_, index) => `w${index}`).join(" "))).toHaveLength(32);
  });

  it("returns nothing for punctuation or non-Latin-only input", () => {
    expect(queryTerms("!!! ??? £££")).toEqual([]);
    expect(queryTerms("税金")).toEqual([]);
  });
});

describe("reciprocalRankFusion", () => {
  it("scores 1/(k + rank) from each list and sums them", () => {
    const fused = reciprocalRankFusion([{ chunkId: "a", rank: 1 }, { chunkId: "b", rank: 2 }], [{ chunkId: "b", rank: 1 }]);
    const b = fused.find(item => item.chunkId === "b");
    expect(b?.fusedScore).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 12);
    expect(b).toMatchObject({ lexicalRank: 2, vectorRank: 1 });
    expect(fused[0]?.chunkId).toBe("b"); // found by both lists, so it beats a's single first place
  });

  it("breaks ties deterministically", () => {
    const fused = reciprocalRankFusion([{ chunkId: "z", rank: 1 }], [{ chunkId: "a", rank: 1 }]);
    expect(fused.map(item => item.chunkId)).toEqual(["a", "z"]);
  });

  it("handles empty lists", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });
});

describe("makeExcerpt", () => {
  it("removes heading markers and collapses whitespace", () => {
    expect(makeExcerpt("## Rates\n\nBasic  rate\n20%")).toBe("Rates Basic rate 20%");
  });

  it("marks a chunk that starts mid-sentence inside its section", () => {
    expect(makeExcerpt("on an emergency tax code.", true)).toBe("…on an emergency tax code.");
    expect(makeExcerpt("Emergency tax codes apply.", true)).toBe("Emergency tax codes apply.");
    expect(makeExcerpt("on an emergency tax code.", false)).toBe("on an emergency tax code.");
  });

  it("cuts long text at a word boundary with an ellipsis", () => {
    const excerpt = makeExcerpt("word ".repeat(200));
    expect(excerpt.length).toBeLessThanOrEqual(321);
    expect(excerpt.endsWith("word…")).toBe(true);
  });
});

describe("evaluation dataset", () => {
  const dataset = loadDataset();

  it("has about 60 labelled cases covering every category", () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(55);
    const categories = new Set(dataset.cases.map(item => item.category));
    expect([...categories].sort()).toEqual(["ambiguous", "exact_keyword", "nation_specific", "negative", "paraphrase", "tax_year"]);
    expect(dataset.cases.filter(item => !item.answerable).length).toBeGreaterThanOrEqual(15);
  });

  it("rejects an answerable case without an expected source, and duplicate ids", () => {
    const first = dataset.cases[0];
    if (first === undefined) throw new Error("empty dataset");
    expect(() => parseDataset({ ...dataset, cases: [{ ...first, expected: [] }] })).toThrow();
    expect(() => parseDataset({ ...dataset, cases: [first, first] })).toThrow(/Duplicate/);
  });
});

describe("metrics", () => {
  const answerable = { id: "t-01", category: "paraphrase" as const, question: "q", jurisdiction: null, asOfDate: null, answerable: true,
    expected: [{ url: "https://www.gov.uk/a", evidence: "x" }], mustNotInclude: ["https://www.gov.uk/wrong"], rationale: "test case" };

  it("scores rank, Recall@5 hit, reciprocal rank and leakage", () => {
    const result = scoreCase(answerable, ["https://www.gov.uk/b", "https://www.gov.uk/a", "https://www.gov.uk/wrong"]);
    expect(result).toMatchObject({ firstRelevantRank: 2, hitAtK: true, reciprocalRank: 0.5, leaked: ["https://www.gov.uk/wrong"], missReason: null });
  });

  it("classifies misses", () => {
    const sixth = scoreCase(answerable, ["1", "2", "3", "4", "5", "https://www.gov.uk/a"].map(item => item.startsWith("https") ? item : `https://www.gov.uk/${item}`));
    expect(sixth).toMatchObject({ hitAtK: false, missReason: "ranked_6_to_10", reciprocalRank: 1 / 6 });
    expect(scoreCase(answerable, []).missReason).toBe("no_results");
    expect(scoreCase(answerable, ["https://www.gov.uk/z"]).missReason).toBe("not_in_top_10");
  });

  it("averages only over answerable cases", () => {
    const hit = scoreCase(answerable, ["https://www.gov.uk/a"]);
    const miss = scoreCase({ ...answerable, id: "t-02" }, ["https://www.gov.uk/z"]);
    const negative = scoreCase({ ...answerable, id: "t-03", answerable: false, expected: [], mustNotInclude: [] }, ["https://www.gov.uk/z"]);
    const report = summarise("hybrid", [hit, miss, negative]);
    expect(report).toMatchObject({ evaluated: 3, answerable: 2, recallAt5: 0.5, mrrAt10: 0.5, unanswerableWithResults: 1 });
  });
});

describe("threshold calibration", () => {
  const base = { id: "c-01", category: "paraphrase" as const, question: "q", jurisdiction: null, asOfDate: null, answerable: true,
    expected: [{ url: "https://www.gov.uk/a", evidence: "x" }], mustNotInclude: [], rationale: "calibration case" };
  const answerable = (id: string, score: number) => scoreCase({ ...base, id }, ["https://www.gov.uk/a"], { bestSimilarity: score, latencyMs: 5 });
  const unanswerable = (id: string, score: number) =>
    scoreCase({ ...base, id, answerable: false, expected: [] }, ["https://www.gov.uk/z"], { bestSimilarity: score, latencyMs: 5 });

  it("finds the threshold that separates answerable from unanswerable questions", () => {
    const calibration = calibrateThreshold([answerable("a-01", 0.8), answerable("a-02", 0.75), unanswerable("u-01", 0.5), unanswerable("u-02", 0.55)]);
    expect(calibration?.bestBalanced).toEqual({ threshold: 0.75, answerableKept: 1, unanswerableRejected: 1, balancedAccuracy: 1 });
  });

  it("reports the strictest threshold that keeps 95% of answerable questions when classes overlap", () => {
    const results = [...Array.from({ length: 19 }, (_, i) => answerable(`a-${String(i).padStart(2, "0")}`, 0.7 + i * 0.01)),
      answerable("a-19", 0.5), unanswerable("u-01", 0.6), unanswerable("u-02", 0.65)];
    const calibration = calibrateThreshold(results);
    expect(calibration?.keeps95PercentOfAnswerable?.threshold).toBe(0.7);
    expect(calibration?.keeps95PercentOfAnswerable?.unanswerableRejected).toBe(1);
  });

  it("returns null without both kinds of scored case", () => {
    expect(calibrateThreshold([answerable("a-01", 0.8)])).toBeNull();
    expect(calibrateThreshold([scoreCase(base, [])])).toBeNull();
  });
});
