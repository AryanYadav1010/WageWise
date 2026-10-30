import { z } from "zod";

export const CHUNKER_VERSION = "heading-paragraph-v1";

export const chunkerConfigSchema = z.object({
  maxChars: z.number().int().min(200).max(8_000),
  overlapChars: z.number().int().min(0)
}).refine(config => config.overlapChars < config.maxChars / 2, {
  message: "overlapChars must be less than half of maxChars"
});
export type ChunkerConfig = z.infer<typeof chunkerConfigSchema>;

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = { maxChars: 1_200, overlapChars: 150 };

export type Chunk = {
  /** Position within the section, from 0. */
  index: number;
  /** e.g. ["Income Tax rates and Personal Allowances", "Current rates and allowances", "Income Tax rates and bands"] */
  headingPath: string[];
  /** Always exactly sectionText.slice(charStart, charEnd), so a citation can be checked against the source. */
  text: string;
  charStart: number;
  charEnd: number;
};

type Span = { start: number; end: number };
type Block = Span & { headingPath: string[] };

const HEADING_LINE = /^(#{2,4}) (.+)$/gm;

/** Splits text into blocks at heading lines, tracking the heading path of each block. */
function findBlocks(text: string, basePath: readonly string[]): Block[] {
  const blocks: Block[] = [];
  const headingStack: string[] = [];
  let blockStart = 0;
  let currentPath = [...basePath];
  for (const match of text.matchAll(HEADING_LINE)) {
    blocks.push({ start: blockStart, end: match.index, headingPath: currentPath });
    const level = (match[1] ?? "##").length; // 2, 3 or 4
    headingStack.length = Math.min(headingStack.length, level - 2);
    headingStack.push((match[2] ?? "").trim());
    currentPath = [...basePath, ...headingStack];
    blockStart = match.index;
  }
  blocks.push({ start: blockStart, end: text.length, headingPath: currentPath });
  return blocks;
}

/** Spans of non-whitespace content between separators, trimmed to their first/last visible character. */
function splitSpan(text: string, span: Span, separator: RegExp): Span[] {
  const spans: Span[] = [];
  const pattern = new RegExp(separator.source, "g");
  let pieceStart = span.start;
  const piece = text.slice(span.start, span.end);
  const boundaries = [...piece.matchAll(pattern)].map(match => ({ at: span.start + match.index, length: match[0].length }));
  for (const boundary of [...boundaries, { at: span.end, length: 0 }]) {
    const trimmed = trimSpan(text, { start: pieceStart, end: boundary.at });
    if (trimmed !== null) spans.push(trimmed);
    pieceStart = boundary.at + boundary.length;
  }
  return spans;
}

function trimSpan(text: string, span: Span): Span | null {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  return start < end ? { start, end } : null;
}

// Split points from coarsest to finest. Sentence ends keep their punctuation.
const SPLIT_STRATEGIES: RegExp[] = [/\n{2,}/, /\n/, /(?<=[.!?])\s+/, /\s+/];

/** Breaks a span into pieces no longer than maxChars, preferring the coarsest natural boundary. */
function toUnits(text: string, span: Span, maxChars: number, strategyIndex = 0): Span[] {
  if (span.end - span.start <= maxChars) return [span];
  const strategy = SPLIT_STRATEGIES[strategyIndex];
  if (strategy === undefined) {
    // A single "word" longer than maxChars: cut it at fixed positions.
    const pieces: Span[] = [];
    for (let start = span.start; start < span.end; start += maxChars) {
      pieces.push({ start, end: Math.min(start + maxChars, span.end) });
    }
    return pieces;
  }
  const pieces = splitSpan(text, span, strategy);
  if (pieces.length <= 1) return toUnits(text, span, maxChars, strategyIndex + 1);
  return pieces.flatMap(piece => toUnits(text, piece, maxChars, strategyIndex + 1));
}

/** Start of the overlap: about overlapChars before `end`, moved forward to the start of a word. */
function overlapStart(text: string, chunkStart: number, end: number, overlapChars: number): number | null {
  if (overlapChars === 0) return null;
  let start = Math.max(chunkStart + 1, end - overlapChars);
  while (start < end && !/\s/.test(text[start - 1] ?? " ")) start += 1;
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  return start < end ? start : null;
}

/** Greedily packs units into chunks of at most maxChars, repeating a little text between chunks. */
function packUnits(text: string, units: Span[], config: ChunkerConfig): Span[] {
  const chunks: Span[] = [];
  let chunkStart: number | null = null;
  let chunkEnd = 0;
  for (const unit of units) {
    if (chunkStart === null) {
      chunkStart = unit.start;
      chunkEnd = unit.end;
      continue;
    }
    if (unit.end - chunkStart <= config.maxChars) {
      chunkEnd = unit.end;
      continue;
    }
    chunks.push({ start: chunkStart, end: chunkEnd });
    const overlap = overlapStart(text, chunkStart, chunkEnd, config.overlapChars);
    // Drop the overlap if it would push this chunk over the limit.
    chunkStart = overlap !== null && unit.end - overlap <= config.maxChars ? overlap : unit.start;
    chunkEnd = unit.end;
  }
  if (chunkStart !== null) chunks.push({ start: chunkStart, end: chunkEnd });
  return chunks;
}

/**
 * Splits one section's normalised text into chunks. Deterministic: the same text and config
 * always give the same chunks. Overlap is applied only within a heading block, never across
 * headings, so a chunk never mixes two topics.
 */
export function chunkSection(sectionText: string, baseHeadingPath: readonly string[], config: ChunkerConfig): Chunk[] {
  const validConfig = chunkerConfigSchema.parse(config);
  const chunks: Chunk[] = [];
  for (const block of findBlocks(sectionText, baseHeadingPath)) {
    const content = trimSpan(sectionText, block);
    if (content === null) continue;
    const units = toUnits(sectionText, content, validConfig.maxChars);
    for (const span of packUnits(sectionText, units, validConfig)) {
      chunks.push({
        index: chunks.length,
        headingPath: block.headingPath,
        text: sectionText.slice(span.start, span.end),
        charStart: span.start,
        charEnd: span.end
      });
    }
  }
  return chunks;
}
