import { describe, expect, it } from "vitest";
import { GovukContentError, hashSections, parseGovukContent, type ParsedDocument } from "../src/ingest/govuk.ts";
import { normaliseHtml } from "../src/ingest/normalise.ts";
import { fixtureJson } from "./govuk-fixtures.ts";

function parseDocument(raw: unknown, path: string): ParsedDocument {
  const result = parseGovukContent(raw, path);
  if (result.kind !== "document") throw new Error(`Expected a document, got ${result.kind}`);
  return result.document;
}

function contentErrorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof GovukContentError ? error.code : "not a GovukContentError";
  }
}

describe("normaliseHtml", () => {
  it("keeps headings as markers the chunker can find", () => {
    expect(normaliseHtml("<h2>Rates</h2><p>Text</p><h3>Scotland</h3><p>More</p>"))
      .toBe("## Rates\n\nText\n\n### Scotland\n\nMore");
  });

  it("drops link targets and images but keeps link text", () => {
    expect(normaliseHtml('<p>See <a href="/income-tax-rates">current rates</a>.<img src="x.png" alt="chart"></p>'))
      .toBe("See current rates.");
  });

  it("normalises whitespace, non-breaking spaces and Unicode form", () => {
    expect(normaliseHtml("<p>£12,570 a year</p>\n\n\n\n<p>Café</p>")).toBe("£12,570 a year\n\nCafé");
  });

  it("is deterministic", () => {
    const html = "<h2>A</h2><ul><li>one</li><li>two</li></ul><table><tr><th>Band</th><th>Rate</th></tr><tr><td>Basic</td><td>20%</td></tr></table>";
    expect(normaliseHtml(html)).toBe(normaliseHtml(html));
    expect(normaliseHtml(html)).toContain(" - one");
    expect(normaliseHtml(html)).toMatch(/Basic\s+20%/);
  });
});

describe("parseGovukContent with real responses", () => {
  it("splits a guide into sections with deep links, in order", () => {
    const document = parseDocument(fixtureJson("tax-codes"), "/tax-codes");
    expect(document.schemaName).toBe("guide");
    expect(document.sections).toHaveLength(7);
    expect(document.sections[0]?.url).toBe("https://www.gov.uk/tax-codes");
    expect(document.sections[2]?.url).toBe("https://www.gov.uk/tax-codes/what-your-tax-code-means");
    expect(document.sections.map(section => section.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("preserves headings and the source date", () => {
    const document = parseDocument(fixtureJson("income-tax-rates"), "/income-tax-rates");
    expect(document.sections[0]?.text).toContain("## Income Tax rates and bands");
    expect(document.sections[0]?.text).toContain("The current tax year is from 6 April 2026 to 5 April 2027.");
    expect(document.sourcePublicUpdatedAt).toBe("2024-11-07T14:57:18+00:00");
  });

  it("reads single-body answer pages", () => {
    const document = parseDocument(fixtureJson("welsh-income-tax"), "/welsh-income-tax");
    expect(document.schemaName).toBe("answer");
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0]?.slug).toBeNull();
  });

  it("recognises a redirect published as a content item", () => {
    expect(parseGovukContent(fixtureJson("redundant-your-rights"), "/redundant-your-rights"))
      .toEqual({ kind: "redirect_item", destination: "/redundancy-your-rights" });
  });

  it("rejects formats that are not guidance prose", () => {
    expect(contentErrorCode(() => parseGovukContent(fixtureJson("plan-for-retirement"), "/plan-for-retirement"))).toBe("unsupported_format");
  });
});

describe("withdrawal and invalid content", () => {
  const live = fixtureJson("welsh-income-tax");

  it("treats an empty withdrawn_notice as a live page", () => {
    expect(parseGovukContent({ ...live, withdrawn_notice: {} }, "/welsh-income-tax").kind).toBe("document");
  });

  it("reports a populated withdrawn_notice as withdrawn", () => {
    const withdrawn = { ...live, withdrawn_notice: { explanation: "<p>No longer current.</p>", withdrawn_at: "2025-01-01T00:00:00Z" } };
    expect(parseGovukContent(withdrawn, "/welsh-income-tax")).toEqual({ kind: "withdrawn", withdrawnAt: "2025-01-01T00:00:00Z" });
  });

  it("rejects a response for a different path", () => {
    expect(contentErrorCode(() => parseGovukContent(live, "/income-tax-rates"))).toBe("path_mismatch");
  });

  it("rejects a malformed shape", () => {
    expect(contentErrorCode(() => parseGovukContent({ base_path: 42 }, "/welsh-income-tax"))).toBe("invalid_schema");
    expect(contentErrorCode(() => parseGovukContent([], "/welsh-income-tax"))).toBe("invalid_schema");
  });

  it("rejects a document with no title", () => {
    expect(contentErrorCode(() => parseGovukContent({ ...live, title: null }, "/welsh-income-tax"))).toBe("invalid_schema");
  });

  it("rejects documents with no text instead of storing an empty version", () => {
    expect(contentErrorCode(() => parseGovukContent({ ...live, details: { body: "<p> </p>" } }, "/welsh-income-tax"))).toBe("empty_content");
    expect(contentErrorCode(() => parseGovukContent({ ...live, details: {} }, "/welsh-income-tax"))).toBe("empty_content");
  });
});

describe("content hashing", () => {
  it("can be recomputed from the stored title and sections (income-tax-rates has a padded upstream title)", () => {
    for (const name of ["tax-codes", "income-tax-rates", "welsh-income-tax"] as const) {
      const document = parseDocument(fixtureJson(name), `/${name}`);
      expect(hashSections(document.title, document.sections)).toBe(document.contentSha256);
    }
  });

  it("is stable for the same content", () => {
    expect(parseDocument(fixtureJson("tax-codes"), "/tax-codes").contentSha256)
      .toBe(parseDocument(structuredClone(fixtureJson("tax-codes")), "/tax-codes").contentSha256);
  });

  it("ignores cosmetic HTML changes that do not change the text", () => {
    const original = fixtureJson("welsh-income-tax") as { details: { body: string } };
    const restyled = { ...original, details: { body: original.details.body.replaceAll("<p>", '<p class="govuk-body">') } };
    expect(parseDocument(restyled, "/welsh-income-tax").contentSha256).toBe(parseDocument(original, "/welsh-income-tax").contentSha256);
  });

  it("changes when wording changes", () => {
    const original = fixtureJson("welsh-income-tax") as { details: { body: string } };
    const edited = { ...original, details: { body: original.details.body.replace("Wales", "Cymru") } };
    expect(parseDocument(edited, "/welsh-income-tax").contentSha256).not.toBe(parseDocument(original, "/welsh-income-tax").contentSha256);
  });
});
