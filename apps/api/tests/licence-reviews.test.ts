import { describe, expect, it } from "vitest";
import { CORPUS } from "../src/ingest/corpus.ts";
import { applyLicenceReviews, loadLicenceReviews, parseLicenceReviews, recordDecision } from "../src/ingest/licence-reviews.ts";

const review = { decision: "approved" as const, reviewedBy: "A Reviewer", reviewedAt: "2026-10-29T09:00:00.000Z", notes: null };

describe("licence decisions", () => {
  // The decisions a person has recorded (docs/LICENCE_REVIEW_SUBSET_1.md). Changing this list is a
  // licence decision: update it only together with `npm run licence:review`.
  const HUMAN_APPROVED = ["/income-tax-rates", "/national-insurance", "/scottish-income-tax", "/tax-codes", "/welsh-income-tax"];

  it("ships only the decisions a named person recorded; every other guide is pending", () => {
    const { reviews } = loadLicenceReviews();
    expect(reviews.map(entry => entry.basePath).sort()).toEqual(HUMAN_APPROVED);
    for (const entry of reviews) {
      expect(entry.decision).toBe("approved");
      expect(entry.reviewedBy.trim().length).toBeGreaterThan(1);
      expect(Number.isNaN(Date.parse(entry.reviewedAt))).toBe(false);
    }
    const approved = CORPUS.filter(entry => entry.licence.review !== null).map(entry => entry.basePath).sort();
    expect(approved).toEqual(HUMAN_APPROVED);
  });

  it("applies a decision to exactly one guide", () => {
    const file = recordDecision({ reviews: [] }, "/tax-codes", review);
    const entries = applyLicenceReviews(CORPUS, file);
    expect(entries.filter(entry => entry.licence.review !== null).map(entry => entry.basePath)).toEqual(["/tax-codes"]);
  });

  it("replaces an earlier decision for the same guide instead of duplicating it", () => {
    const first = recordDecision({ reviews: [] }, "/tax-codes", review);
    const second = recordDecision(first, "/tax-codes", { ...review, decision: "rejected", notes: "Third-party image found" });
    expect(second.reviews).toHaveLength(1);
    expect(second.reviews[0]?.decision).toBe("rejected");
  });

  it("rejects decisions without a reviewer, with an unknown decision, or for unknown guides", () => {
    expect(() => parseLicenceReviews({ reviews: [{ ...review, basePath: "/tax-codes", reviewedBy: "" }] })).toThrow();
    expect(() => parseLicenceReviews({ reviews: [{ ...review, basePath: "/tax-codes", decision: "maybe" }] })).toThrow();
    expect(() => applyLicenceReviews(CORPUS, { reviews: [{ ...review, basePath: "/moneyhelper-pensions" }] })).toThrow(/not in the corpus/);
  });

  it("rejects two decisions for one guide", () => {
    expect(() => parseLicenceReviews({ reviews: [{ ...review, basePath: "/tax-codes" }, { ...review, basePath: "/tax-codes" }] })).toThrow(/two decisions/);
  });
});
