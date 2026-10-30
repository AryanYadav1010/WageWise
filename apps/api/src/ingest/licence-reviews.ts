import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { CorpusEntry } from "./corpus.ts";

// Human licence decisions, one per guide, kept in a small JSON file so each decision is a
// reviewable change in version control. Only `npm run licence:review` (run by a person,
// with their own name) writes it; nothing in the pipeline ever approves content itself.

export const LICENCE_REVIEWS_URL = new URL("../../data/licence-reviews.json", import.meta.url);

export const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewedBy: z.string().trim().min(2).max(100),
  reviewedAt: z.string().datetime(),
  notes: z.string().max(500).nullable()
}).strict();
export type LicenceReview = z.infer<typeof reviewSchema>;

const reviewsFileSchema = z.object({
  reviews: z.array(reviewSchema.extend({ basePath: z.string().startsWith("/") }).strict())
}).strict();
export type LicenceReviewsFile = z.infer<typeof reviewsFileSchema>;

export function parseLicenceReviews(raw: unknown): LicenceReviewsFile {
  const file = reviewsFileSchema.parse(raw);
  const paths = file.reviews.map(review => review.basePath);
  if (new Set(paths).size !== paths.length) throw new Error("licence-reviews.json has two decisions for the same guide");
  return file;
}

export function loadLicenceReviews(fileUrl: URL = LICENCE_REVIEWS_URL): LicenceReviewsFile {
  return parseLicenceReviews(JSON.parse(readFileSync(fileUrl, "utf8")));
}

/** Attaches each recorded decision to its corpus entry; guides without a decision stay pending. */
export function applyLicenceReviews(entries: readonly CorpusEntry[], file: LicenceReviewsFile): CorpusEntry[] {
  const known = new Set(entries.map(entry => entry.basePath));
  const unknown = file.reviews.filter(review => !known.has(review.basePath)).map(review => review.basePath);
  if (unknown.length > 0) throw new Error(`Licence decisions for guides not in the corpus: ${unknown.join(", ")}`);
  const byPath = new Map(file.reviews.map(({ basePath, ...review }) => [basePath, review]));
  return entries.map(entry => ({ ...entry, licence: { ...entry.licence, review: byPath.get(entry.basePath) ?? null } }));
}

/** Returns the file with one guide's decision added or replaced. Pure: the caller writes it. */
export function recordDecision(file: LicenceReviewsFile, basePath: string, review: LicenceReview): LicenceReviewsFile {
  const others = file.reviews.filter(existing => existing.basePath !== basePath);
  const reviews = [...others, { basePath, ...review }].sort((a, b) => a.basePath.localeCompare(b.basePath));
  return parseLicenceReviews({ reviews });
}

export function saveLicenceReviews(file: LicenceReviewsFile, fileUrl: URL = LICENCE_REVIEWS_URL): void {
  writeFileSync(fileUrl, `${JSON.stringify(parseLicenceReviews(file), null, 2)}\n`);
}
