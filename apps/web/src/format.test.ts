import { describe, expect, it } from "vitest";
import { formatIsoDate, formatPence, groupCitations, poundsToPence, sourceNumber } from "./format.ts";

describe("poundsToPence", () => {
  it("converts whole pounds and pence without floating-point error", () => {
    expect(poundsToPence("12")).toBe(1_200);
    expect(poundsToPence("12.5")).toBe(1_250);
    expect(poundsToPence("0.29")).toBe(29); // 0.29 * 100 is 28.999999999999996 in floating point
    expect(poundsToPence("1,234.56")).toBe(123_456);
  });

  it("rejects negatives, extra decimals, text and amounts over the limit", () => {
    expect(poundsToPence("-1")).toBeNull();
    expect(poundsToPence("1.234")).toBeNull();
    expect(poundsToPence("abc")).toBeNull();
    expect(poundsToPence("")).toBeNull();
    expect(poundsToPence("1000000.01")).toBeNull();
  });
});

describe("UK formatting", () => {
  it("formats pence as pounds sterling", () => {
    expect(formatPence(123_456)).toBe("£1,234.56");
    expect(formatPence(-500)).toBe("-£5.00");
  });

  it("formats calendar dates without shifting the day", () => {
    expect(formatIsoDate("2026-12-24")).toBe("Thu, 24 Dec 2026");
  });
});

describe("citation display", () => {
  it("joins neighbouring sentences with the same sources, in any order", () => {
    expect(groupCitations([
      { text: "One.", sourceIds: ["S1", "S2"] },
      { text: "Two.", sourceIds: ["S2", "S1"] },
      { text: "Three.", sourceIds: ["S3"] },
      { text: "Four.", sourceIds: ["S1", "S2"] }
    ])).toEqual([
      { text: "One. Two.", sourceIds: ["S1", "S2"] },
      { text: "Three.", sourceIds: ["S3"] },
      { text: "Four.", sourceIds: ["S1", "S2"] }
    ]);
  });

  it("keeps every sentence and never changes the input", () => {
    const input = [{ text: "A.", sourceIds: ["S1"] }, { text: "B.", sourceIds: ["S1"] }];
    expect(groupCitations(input)).toEqual([{ text: "A. B.", sourceIds: ["S1"] }]);
    expect(input[0]?.text).toBe("A.");
    expect(groupCitations([])).toEqual([]);
  });

  it("shows source ids as plain numbers", () => {
    expect(sourceNumber("S12")).toBe("12");
  });
});
