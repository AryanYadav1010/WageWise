// Records a HUMAN licence decision for one GOV.UK guide. Run it yourself, after checking the
// page against docs/LICENCE_REVIEW.md:
//   npm run licence:review -- --path /tax-codes --decision approved --reviewer "Your Name" [--notes "..."]
//   npm run licence:review -- --list
// Then run `npm run ingest` (applies the decision) and `npm run embed` (embeds approved content).
import { parseArgs } from "node:util";
import { CORPUS } from "../ingest/corpus.ts";
import { loadLicenceReviews, recordDecision, reviewSchema, saveLicenceReviews } from "../ingest/licence-reviews.ts";

const { values } = parseArgs({
  options: {
    path: { type: "string" },
    decision: { type: "string" },
    reviewer: { type: "string" },
    notes: { type: "string" },
    list: { type: "boolean", default: false }
  }
});

const file = loadLicenceReviews();

if (values.list) {
  const decided = new Map(file.reviews.map(review => [review.basePath, review]));
  for (const entry of CORPUS) {
    const review = decided.get(entry.basePath);
    const status = review === undefined ? "PENDING" : `${review.decision.toUpperCase()} by ${review.reviewedBy} on ${review.reviewedAt.slice(0, 10)}`;
    console.log(`${entry.basePath.padEnd(38)} ${status}`);
  }
  process.exit(0);
}

if (values.path === undefined || !CORPUS.some(entry => entry.basePath === values.path)) {
  console.error(`--path must be one of the corpus guides:\n${CORPUS.map(entry => `  ${entry.basePath}`).join("\n")}`);
  process.exit(1);
}

const review = reviewSchema.safeParse({
  decision: values.decision,
  reviewedBy: values.reviewer,
  reviewedAt: new Date().toISOString(),
  notes: values.notes ?? null
});
if (!review.success) {
  console.error("Provide --decision approved|rejected and --reviewer \"Your Name\" (2–100 characters).");
  process.exit(1);
}

saveLicenceReviews(recordDecision(file, values.path, review.data));
console.log(`Recorded: ${values.path} ${review.data.decision} by ${review.data.reviewedBy}.`);
console.log("Next: npm run ingest (applies the decision), then npm run embed.");
