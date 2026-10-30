import { describe, expect, it } from "vitest";
import { chunkSection, type Chunk, type ChunkerConfig } from "../src/ingest/chunker.ts";
import { parseGovukContent } from "../src/ingest/govuk.ts";
import { fixtureJson } from "./govuk-fixtures.ts";

const small: ChunkerConfig = { maxChars: 200, overlapChars: 40 };

function paragraph(label: string, length: number): string {
  return `${label} ${"word ".repeat(Math.ceil(length / 5))}`.slice(0, length).trimEnd() + ".";
}

/** Invariants every chunking must satisfy, whatever the input. */
function expectInvariants(text: string, chunks: Chunk[], config: ChunkerConfig): void {
  for (const chunk of chunks) {
    expect(chunk.text).toBe(text.slice(chunk.charStart, chunk.charEnd));
    expect(chunk.text.length).toBeLessThanOrEqual(config.maxChars);
    expect(chunk.text).toBe(chunk.text.trim());
  }
  // Every non-whitespace character is in at least one chunk.
  const covered = new Array<boolean>(text.length).fill(false);
  for (const chunk of chunks) covered.fill(true, chunk.charStart, chunk.charEnd);
  for (let position = 0; position < text.length; position += 1) {
    if (!/\s/.test(text[position] ?? "")) expect(covered[position], `character ${position} not covered`).toBe(true);
  }
  // Chunks move forward and overlap by at most overlapChars.
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1];
    const current = chunks[index];
    if (previous === undefined || current === undefined) continue;
    expect(current.charStart).toBeGreaterThan(previous.charStart);
    expect(previous.charEnd - current.charStart).toBeLessThanOrEqual(config.overlapChars);
  }
}

describe("chunk boundaries", () => {
  it("keeps short text in one chunk", () => {
    const chunks = chunkSection("Short text.", ["Guide", "Section"], small);
    expect(chunks).toEqual([{ index: 0, headingPath: ["Guide", "Section"], text: "Short text.", charStart: 0, charEnd: 11 }]);
  });

  it("returns no chunks for whitespace-only text", () => {
    expect(chunkSection("  \n\n ", ["Guide"], small)).toEqual([]);
  });

  it("starts a new chunk at every heading and records the heading path", () => {
    const text = "Intro.\n\n## Rates\n\nBasic rate.\n\n### Scotland\n\nDifferent bands.\n\n## Allowances\n\nPersonal Allowance.";
    const chunks = chunkSection(text, ["Income Tax"], small);
    expect(chunks.map(chunk => chunk.headingPath)).toEqual([
      ["Income Tax"],
      ["Income Tax", "Rates"],
      ["Income Tax", "Rates", "Scotland"],
      ["Income Tax", "Allowances"]
    ]);
    expect(chunks[1]?.text).toBe("## Rates\n\nBasic rate.");
    expectInvariants(text, chunks, small);
  });

  it("packs paragraphs up to maxChars and overlaps consecutive chunks", () => {
    const text = [paragraph("A", 90), paragraph("B", 90), paragraph("C", 90), paragraph("D", 90)].join("\n\n");
    const chunks = chunkSection(text, ["Guide"], small);
    expect(chunks.length).toBeGreaterThan(1);
    expectInvariants(text, chunks, small);
    const [first, second] = chunks;
    expect(first !== undefined && second !== undefined && second.charStart < first.charEnd).toBe(true);
  });

  it("does not overlap when overlapChars is 0", () => {
    const config = { maxChars: 200, overlapChars: 0 };
    const text = [paragraph("A", 150), paragraph("B", 150), paragraph("C", 150)].join("\n\n");
    const chunks = chunkSection(text, ["Guide"], config);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]?.charStart).toBeGreaterThanOrEqual(chunks[index - 1]?.charEnd ?? 0);
    }
    expectInvariants(text, chunks, config);
  });

  it("splits an over-long paragraph at sentence ends", () => {
    const sentences = Array.from({ length: 8 }, (_, index) => `Sentence number ${index} explains one rule about tax.`).join(" ");
    const chunks = chunkSection(sentences, ["Guide"], small);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text).toMatch(/\.$/);
    expectInvariants(sentences, chunks, small);
  });

  it("hard-splits a single token longer than maxChars", () => {
    const token = "x".repeat(450);
    const chunks = chunkSection(token, ["Guide"], small);
    expect(chunks.map(chunk => chunk.text.length)).toEqual([200, 200, 50]);
    expectInvariants(token, chunks, small);
  });

  it("is deterministic", () => {
    const text = [paragraph("A", 120), "## H", paragraph("B", 300)].join("\n\n");
    expect(chunkSection(text, ["G"], small)).toEqual(chunkSection(text, ["G"], small));
  });
});

describe("chunker configuration", () => {
  it("rejects invalid settings", () => {
    expect(() => chunkSection("text", [], { maxChars: 100, overlapChars: 0 })).toThrow();
    expect(() => chunkSection("text", [], { maxChars: 400, overlapChars: 200 })).toThrow(/half/);
    expect(() => chunkSection("text", [], { maxChars: 400.5, overlapChars: 0 })).toThrow();
  });
});

describe("chunking real GOV.UK sections", () => {
  const parsed = parseGovukContent(fixtureJson("tax-codes"), "/tax-codes");
  const sections = parsed.kind === "document" ? parsed.document.sections : [];

  it.each([
    { maxChars: 1_200, overlapChars: 150 },
    { maxChars: 500, overlapChars: 100 },
    { maxChars: 200, overlapChars: 0 }
  ])("satisfies every invariant with %o", config => {
    expect(sections.length).toBe(7);
    for (const section of sections) {
      const chunks = chunkSection(section.text, ["Tax codes", section.title], config);
      expect(chunks.length).toBeGreaterThan(0);
      expectInvariants(section.text, chunks, config);
    }
  });
});
