import { createHash } from "node:crypto";
import { z } from "zod";
import { normaliseHtml } from "./normalise.ts";

export const GOVUK_ORIGIN = "https://www.gov.uk";
// Bump when parsing or normalisation changes; stored on every document version.
export const PARSER_VERSION = "govuk-parser-v2";
export const SUPPORTED_SCHEMAS = ["guide", "answer"] as const;

const GUIDE_PATH_PATTERN = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

export function isSafeGovukPath(path: string): boolean {
  return GUIDE_PATH_PATTERN.test(path);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// A live page has `withdrawn_notice: {}`; a withdrawn one has an explanation and/or a date.
const withdrawnNoticeSchema = z.object({
  explanation: z.string().optional(),
  withdrawn_at: z.string().optional()
}).passthrough();

const guidePartSchema = z.object({ title: z.string().min(1), slug: z.string().min(1), body: z.string() });

const contentItemSchema = z.object({
  base_path: z.string().startsWith("/"),
  // Redirect items have a null title; documents must have one (checked below).
  title: z.string().nullable(),
  schema_name: z.string().min(1),
  description: z.string().optional().nullable(),
  public_updated_at: z.string().optional().nullable(),
  updated_at: z.string().optional().nullable(),
  withdrawn_notice: withdrawnNoticeSchema.optional().nullable(),
  redirects: z.array(z.object({ destination: z.string() }).passthrough()).optional().nullable(),
  details: z.object({
    body: z.string().optional(),
    parts: z.array(guidePartSchema).optional()
  }).passthrough().optional().nullable()
}).passthrough();

export type ParsedSection = {
  index: number;
  slug: string | null;
  title: string;
  /** Deep link for citations, e.g. https://www.gov.uk/tax-codes/emergency-tax-codes */
  url: string;
  htmlSha256: string;
  text: string;
};

export type ParsedDocument = {
  basePath: string;
  title: string;
  schemaName: string;
  sourcePublicUpdatedAt: string | null;
  sourceUpdatedAt: string | null;
  sections: ParsedSection[];
  /** Hash of the normalised sections. Cosmetic HTML changes do not change it. */
  contentSha256: string;
};

export type ParseResult =
  | { kind: "document"; document: ParsedDocument }
  | { kind: "withdrawn"; withdrawnAt: string | null }
  // GOV.UK also publishes redirects as content items (HTTP 200, schema_name "redirect").
  | { kind: "redirect_item"; destination: string | null };

export type ContentErrorCode = "invalid_schema" | "path_mismatch" | "unsupported_format" | "empty_content";

export class GovukContentError extends Error {
  constructor(readonly code: ContentErrorCode, message: string) {
    super(message);
    this.name = "GovukContentError";
  }
}

function isWithdrawn(notice: z.infer<typeof withdrawnNoticeSchema> | null | undefined): boolean {
  if (notice === null || notice === undefined) return false;
  const hasExplanation = notice.explanation !== undefined && notice.explanation.trim() !== "";
  return hasExplanation || notice.withdrawn_at !== undefined;
}

function isSupportedSchema(schemaName: string): schemaName is (typeof SUPPORTED_SCHEMAS)[number] {
  return (SUPPORTED_SCHEMAS as readonly string[]).includes(schemaName);
}

type ContentDetails = z.infer<typeof contentItemSchema>["details"];

function buildSections(title: string, details: ContentDetails, canonicalUrl: string): ParsedSection[] {
  const rawSections: Omit<ParsedSection, "index">[] = [];
  const body = details?.body;
  if (body !== undefined) {
    rawSections.push({ slug: null, title, url: canonicalUrl, htmlSha256: sha256(body), text: normaliseHtml(body) });
  }
  // Guides are split into parts. The first part lives at the guide's own URL.
  for (const [partIndex, part] of (details?.parts ?? []).entries()) {
    const url = partIndex === 0 ? canonicalUrl : `${canonicalUrl}/${part.slug}`;
    rawSections.push({ slug: part.slug, title: part.title, url, htmlSha256: sha256(part.body), text: normaliseHtml(part.body) });
  }
  return rawSections
    .filter(section => section.text !== "")
    .map((section, index) => ({ ...section, index }));
}

/** Hash of exactly what we store and cite: each section's URL, title and normalised text. */
export function hashSections(title: string, sections: readonly ParsedSection[]): string {
  return sha256(JSON.stringify({ title, sections: sections.map(section => [section.url, section.title, section.text]) }));
}

// Content API formats vary. Anything we do not explicitly support fails visibly with a code,
// rather than being indexed as an empty or partial document.
export function parseGovukContent(raw: unknown, expectedPath: string): ParseResult {
  const parsed = contentItemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GovukContentError("invalid_schema", "Response did not match the expected Content API shape");
  }
  const item = parsed.data;
  if (item.base_path !== expectedPath) {
    throw new GovukContentError("path_mismatch", `Asked for ${expectedPath} but received ${item.base_path}`);
  }
  if (item.schema_name === "redirect") {
    return { kind: "redirect_item", destination: item.redirects?.[0]?.destination ?? null };
  }
  if (isWithdrawn(item.withdrawn_notice)) {
    return { kind: "withdrawn", withdrawnAt: item.withdrawn_notice?.withdrawn_at ?? null };
  }
  if (!isSupportedSchema(item.schema_name)) {
    throw new GovukContentError("unsupported_format", `Schema "${item.schema_name}" is not a supported guidance format`);
  }
  const title = item.title?.trim() ?? "";
  if (title === "") {
    throw new GovukContentError("invalid_schema", "Document has no title");
  }

  const canonicalUrl = `${GOVUK_ORIGIN}${item.base_path}`;
  // Use the same trimmed title everywhere, so the stored hash can be recomputed from stored rows.
  const sections = buildSections(title, item.details, canonicalUrl);
  if (sections.length === 0) {
    throw new GovukContentError("empty_content", "Document has no text after normalisation");
  }
  return {
    kind: "document",
    document: {
      basePath: item.base_path,
      title,
      schemaName: item.schema_name,
      sourcePublicUpdatedAt: item.public_updated_at ?? null,
      sourceUpdatedAt: item.updated_at ?? null,
      sections,
      contentSha256: hashSections(title, sections)
    }
  };
}
