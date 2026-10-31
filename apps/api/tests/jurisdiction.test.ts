import { describe, expect, it } from "vitest";
import { currentTaxYearStart, finalQuestion, pinTaxYear, searchSubject, readJurisdiction, taxYearIn, taxYearStart, withoutTaxYear, withTaxYear } from "../src/retrieval/jurisdiction.ts";

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

describe("relative tax years", () => {
  it.each([["2026-04-05", "2025-04-06"], ["2026-04-06", "2026-04-06"], ["2026-10-31", "2026-04-06"], ["2027-01-01", "2026-04-06"]])("the tax year containing %s starts on %s", (date, start) => {
    expect(currentTaxYearStart(date)).toBe(start);
  });

  it.each([
    ["What was the rate last tax year?", "What was the rate the 2025 to 2026 tax year?"],
    ["And last year?", "And the 2025 to 2026 tax year?"],
    ["What was the previous tax year's rate?", "What was the 2025 to 2026 tax year rate?"],
    ["Rates for the past tax year", "Rates for the 2025 to 2026 tax year"],
    ["And this tax year?", "And the 2026 to 2027 tax year?"],
    ["the current year", "the 2026 to 2027 tax year"],
    ["What about next year?", "What about the 2027 to 2028 tax year?"]
  ])("pins %s", (question, pinned) => {
    expect(pinTaxYear(question, "2026-10-31")).toBe(pinned);
  });

  it("pins to the right year either side of 6 April", () => {
    expect(pinTaxYear("last tax year", "2026-04-05")).toBe("the 2024 to 2025 tax year");
    expect(pinTaxYear("last tax year", "2026-04-06")).toBe("the 2025 to 2026 tax year");
  });

  it("leaves other mentions of a year alone", () => {
    for (const question of ["What is a tax year?", "How long is the past year?", "the 2025 to 2026 tax year"]) expect(pinTaxYear(question, "2026-10-31")).toBe(question);
  });

  it("gives a pinned year to everything that reads one", () => {
    const pinned = pinTaxYear("What was it last tax year?", "2026-10-31");
    expect(taxYearStart(pinned)).toBe("2025-04-06");
    expect(taxYearIn(pinned)).toBe("2025 to 2026");
  });

  it("swaps a year, or adds one", () => {
    expect(withTaxYear("What is the rate?", "2025 to 2026")).toBe("What is the rate in 2025 to 2026?");
    expect(withTaxYear("What was the rate in 2024 to 2025?", "2025 to 2026")).toBe("What was the rate in 2025 to 2026?");
  });

  it("removes a year and the words around it", () => {
    expect(withoutTaxYear("And the 2025 to 2026 tax year?")).toBe("And  ?");
  });
});

describe("searchSubject", () => {
  it.each([
    ["additional rate please", "additional rate"],
    ["Please give me the basic rate", "the basic rate"],
    ["Give me the basic rate", "the basic rate"],
    ["Can you tell me the advanced rate?", "the advanced rate?"],
    ["could you please show me the band", "the band"],
    ["I want to know the higher rate", "the higher rate"],
    ["I'd like to check the Personal Allowance", "the Personal Allowance"],
    ["Tell me about Class 2", "Class 2"],
    ["Class 1 rate for 2026 to 2027", "Class 1 rate for"],
    ["basic rate band for the 2026 to 2027 tax year", "basic rate band for"]
  ])("reduces %s to what it asks about", (text, subject) => {
    expect(searchSubject(text)).toBe(subject);
  });

  it("keeps the question when nothing would be left", () => {
    expect(searchSubject("please")).toBe("please");
  });

  it("leaves words that belong to the question", () => {
    for (const text of ["What can I give to charity tax free?", "How do I tell HMRC about a new job?", "What does this show on my payslip?"]) expect(searchSubject(text)).toBe(text);
  });
});

describe("finalQuestion", () => {
  it("finds the question after background", () => {
    expect(finalQuestion("I earn £40,000. What is the rate?")).toBe("What is the rate?");
    expect(finalQuestion("Sorry! I moved home. Which rate applies?")).toBe("Which rate applies?");
  });

  it("leaves anything that doesn't end in a question", () => {
    expect(finalQuestion("What is the rate? I live in Wales.")).toBe("What is the rate? I live in Wales.");
    expect(finalQuestion("higher rate")).toBe("higher rate");
  });
});
