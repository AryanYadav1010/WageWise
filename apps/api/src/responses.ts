import { z } from "zod";

// Every response is checked before it leaves the server. `.strict()` is the point: a field that
// shouldn't be public (like a search result's full passage) fails loudly instead of leaking.

const ANSWER_SOURCE_ORIGIN = "https://www.gov.uk/";
const LINK_ORIGINS = [ANSWER_SOURCE_ORIGIN, "https://www.moneyhelper.org.uk/", "https://www.fca.org.uk/", "https://www.fscs.org.uk/"];

const govukUrl = z.string().startsWith(ANSWER_SOURCE_ORIGIN);
const nation = z.string();
const applicability = z.discriminatedUnion("status", [
  z.object({ status: z.literal("stated"), appliesFrom: z.string().nullable(), appliesTo: z.string().nullable() }).strict(),
  z.object({ status: z.literal("not_stated") }).strict()
]);

const chatSource = z.object({
  id: z.string(), cited: z.boolean(), sectionTitle: z.string(), documentTitle: z.string(), url: govukUrl, excerpt: z.string(),
  nations: z.array(nation), applicability, sourceFetchedAt: z.string(), sourceCheckedAt: z.string().nullable(), attribution: z.string()
}).strict();

export const chatResponse = z.object({
  mode: z.enum(["grounded_answer", "abstained"]), isGroundedAnswer: z.boolean(), traceId: z.string(),
  request: z.object({ jurisdiction: nation.nullable(), asOfDate: z.string() }).strict(),
  answer: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()) }).strict()),
  message: z.string().nullable(), abstainReason: z.string().nullable(), clarifyNations: z.array(nation), sources: z.array(chatSource),
  notices: z.array(z.string()), model: z.string().nullable(), disclaimer: z.string()
}).strict();

const guidanceResult = z.object({
  rank: z.number(), sectionUrl: govukUrl, sectionTitle: z.string(), documentTitle: z.string(), canonicalUrl: govukUrl, heading: z.string(), excerpt: z.string(),
  nations: z.array(nation), nationsBasis: z.string(), applicability, sourceFetchedAt: z.string(), sourceCheckedAt: z.string().nullable(), attribution: z.string(),
  match: z.object({ lexicalRank: z.number().nullable(), vectorRank: z.number().nullable(), vectorSimilarity: z.number().nullable(), fusedScore: z.number() }).strict()
}).strict();

export const guidanceResponse = z.object({
  mode: z.literal("source_discovery"), isGroundedAnswer: z.literal(false), traceId: z.string(), status: z.enum(["ok", "partial", "no_results"]),
  request: z.object({ jurisdiction: nation.nullable(), asOfDate: z.string(), limit: z.number() }).strict(),
  results: z.array(guidanceResult), retrieval: z.object({ lexical: z.string(), vector: z.string() }).strict(),
  notices: z.array(z.string()), disclaimer: z.string()
}).strict();

export const linkResponse = z.object({
  mode: z.literal("directory_only"), isGroundedAnswer: z.literal(false), message: z.string(),
  sources: z.array(z.object({
    title: z.string(), url: z.string().refine(url => LINK_ORIGINS.some(origin => url.startsWith(origin)), "Unexpected link origin"),
    description: z.string(), topic: z.string(), jurisdiction: z.string(), publisher: z.string()
  }).strict())
}).strict();

export const budgetResponse = z.object({
  mode: z.literal("synthetic_calculator"), today: z.string(), jurisdiction: z.string(),
  payday: z.object({ scheduledDate: z.string(), effectiveDate: z.string(), skippedDates: z.array(z.object({ date: z.string(), reason: z.string() }).strict()) }).strict(),
  budget: z.object({ daysUntilPayday: z.number().int(), projectedBalancePence: z.number().int(), shortfallPence: z.number().int(), dailyAllowancePence: z.number().int() }).strict(),
  bankHolidayData: z.object({ source: z.string(), fetchedAt: z.string(), licence: z.string() }).strict(), disclaimer: z.string()
}).strict();
