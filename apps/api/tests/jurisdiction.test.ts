import { describe, expect, it } from "vitest";
import { readJurisdiction, taxYearStart } from "../src/retrieval/jurisdiction.ts";

describe("nations named in a question", () => {
  it.each([
    ["What is the higher rate of Income Tax in England?", "england"],
    ["What is the English higher rate?", "england"],
    ["What is the advanced rate in Scotland?", "scotland"],
    ["What is the Scottish advanced rate?", "scotland"],
    ["What are Scotland's rates?", "scotland"],
    ["Who pays Welsh Income Tax?", "wales"],
    ["What is the basic rate in WALES?", "wales"],
    ["What is the basic rate in Northern Ireland?", "northern-ireland"]
  ] as const)("reads %j as %s and takes the name out of the search text", (question, nation) => {
    const read = readJurisdiction(question, null);
    expect(read).toMatchObject({ nation, named: [nation], conflict: false });
    expect(read.text).not.toMatch(/england|english|scot|wales|welsh|northern/i);
  });

  it("gives the same search text and nation whether the nation was typed or selected", () => {
    for (const [nation, name] of [["england", "England"], ["scotland", "Scotland"], ["wales", "Wales"], ["northern-ireland", "Northern Ireland"]] as const) {
      const typed = readJurisdiction(`What is the basic rate in ${name}?`, null);
      const selected = readJurisdiction("What is the basic rate?", nation);
      expect({ nation: typed.nation, text: typed.text }).toEqual({ nation: selected.nation, text: selected.text });
    }
  });

  it.each(["Explain emergency tax in plain English", "Explain this in English", "What is the Bank of England base rate?", "Is the Royal Bank of Scotland open?", "How much NI do I pay?", "I moved from New South Wales", "Tax in Ireland"])("does not read a nation in %j", question => {
    expect(readJurisdiction(question, null)).toMatchObject({ nation: null, named: [], text: question });
  });

  it("keeps the selected nation when the question agrees", () => {
    expect(readJurisdiction("What is the rate in Scotland?", "scotland")).toMatchObject({ nation: "scotland", conflict: false });
  });

  it("flags a question that names a different nation from the one selected", () => {
    expect(readJurisdiction("What is the rate in Scotland?", "england")).toMatchObject({ nation: "england", named: ["scotland"], conflict: true });
  });

  it("does not choose when several nations are named and none is selected", () => {
    expect(readJurisdiction("Do I pay Scottish tax if I live in England?", null)).toMatchObject({ nation: null, named: ["england", "scotland"], conflict: false });
  });

  it("accepts a selected nation that is one of several named", () => {
    expect(readJurisdiction("Do I pay Scottish tax if I live in England?", "england")).toMatchObject({ nation: "england", conflict: false });
  });

  it("keeps a question that is only a nation name, so it reaches the vague-question check", () => {
    expect(readJurisdiction("Scotland", null)).toMatchObject({ nation: "scotland", text: "Scotland" });
  });
});

describe("tax years named in a question", () => {
  it.each(["rates in 2025 to 2026", "rates in 2025-26", "rates in 2025/26", "rates in 2025/2026", "rates in 2025–26"])("reads %j", question => {
    expect(taxYearStart(question)).toBe("2025-04-06");
  });

  it("puts every spelling into GOV.UK's wording", () => {
    expect(readJurisdiction("What was the rate in 2025/26?", null).text).toBe("What was the rate in 2025 to 2026?");
  });

  it.each(["rates in 2025", "2020 to 2030", "earning 2000 to 3000", "1257L", "2025 to 27"])("finds no tax year in %j", question => {
    expect(taxYearStart(question)).toBeNull();
  });
});
