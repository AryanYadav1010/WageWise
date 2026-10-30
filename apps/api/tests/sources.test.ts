import { describe, expect, it } from "vitest";
import { findSourceLinks } from "../src/domain/source-directory.ts";

describe("source directory", () => {
  it("returns only known GOV.UK links for a matching topic", () => {
    expect(findSourceLinks("Can I understand my pension contributions?")[0]?.topic).toBe("pensions");
  });

  it("returns nothing rather than a guess for an unrelated question", () => {
    expect(findSourceLinks("quantum rocket lasers")).toEqual([]);
  });
});
