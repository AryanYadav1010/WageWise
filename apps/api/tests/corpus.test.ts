import { describe, expect, it } from "vitest";
import { AREAS, CORPUS, validateCorpus } from "../src/ingest/corpus.ts";

describe("curated corpus", () => {
  it("has 20–30 unique guide-level GOV.UK paths", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(CORPUS.length).toBeLessThanOrEqual(30);
    expect(new Set(CORPUS.map(entry => entry.basePath)).size).toBe(CORPUS.length);
  });

  it("covers tax, pensions, employment and benefits", () => {
    for (const area of AREAS) expect(CORPUS.some(entry => entry.area === area)).toBe(true);
  });

  it("records a licence and attribution, and approves nothing without a named reviewer", () => {
    for (const entry of CORPUS) {
      expect(entry.licence.id).toBe("OGL-UK-3.0");
      expect(entry.licence.attribution).toMatch(/Open Government Licence v3\.0/);
      const review = entry.licence.review;
      if (review !== null) expect(review.reviewedBy.trim().length).toBeGreaterThan(1);
    }
  });

  it("gives every period a quoted piece of evidence", () => {
    for (const entry of CORPUS) {
      for (const rule of entry.sectionApplicability) {
        expect(rule.appliesFrom !== null || rule.appliesTo !== null).toBe(true);
        expect(rule.evidence.length).toBeGreaterThan(10);
      }
    }
  });

  it("rejects duplicates, part-level URLs and unknown fields", () => {
    const first = CORPUS[0];
    if (first === undefined) throw new Error("empty corpus");
    expect(() => validateCorpus([first, first])).toThrow(/duplicate/);
    expect(() => validateCorpus([{ ...first, basePath: "https://www.gov.uk/tax-codes" }])).toThrow();
    expect(() => validateCorpus([{ ...first, nations: ["wales", "atlantis"] }])).toThrow();
    expect(() => validateCorpus([{ ...first, extra: true }])).toThrow();
  });

  it("never includes MoneyHelper or other non-GOV.UK sources", () => {
    for (const entry of CORPUS) expect(entry.basePath.startsWith("/")).toBe(true);
  });
});
