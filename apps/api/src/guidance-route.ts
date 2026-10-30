import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isValidIsoDate, londonDateFromInstant } from "./domain/dates.ts";
import { NATIONS } from "./ingest/corpus.ts";
import type { SearchOutcome, SearchRequest, WarnLogger } from "./retrieval/search.ts";

/** What the route needs from the retrieval layer; null when no database is configured. */
export type GuidanceSearch = (request: SearchRequest, logger: WarnLogger) => Promise<SearchOutcome>;

export const MAX_RESULTS = 10;

const guidanceSearchSchema = z.object({
  query: z.string().trim().min(3).max(300),
  // Optional, but strongly encouraged: tax, employment and benefit rules differ by nation.
  jurisdiction: z.enum(NATIONS).nullable().default(null),
  asOfDate: z.string().refine(isValidIsoDate, "Expected a real calendar date in YYYY-MM-DD format")
    .refine(date => date >= "2000-01-01" && date <= "2100-12-31", "Date out of supported range").optional(),
  limit: z.number().int().min(1).max(MAX_RESULTS).default(5)
}).strict();

const DISCLAIMER = "These are excerpts from official GOV.UK guidance, matched to your words. They are not an answer, not advice and not a check of your circumstances. Read the full page on GOV.UK before acting.";

function noticesFor(outcome: SearchOutcome, jurisdiction: string | null): string[] {
  const notices: string[] = [];
  if (outcome.relevance === "below_threshold") {
    notices.push("Nothing in the approved official guidance is a close enough match for your search. Try different words, or search GOV.UK directly.");
  } else if (outcome.results.length === 0) {
    notices.push("No approved official guidance matched your search. Try different words, or search GOV.UK directly.");
  }
  if (outcome.vector === "failed") {
    notices.push("Meaning-based matching is unavailable right now, so these are keyword matches only.");
  }
  if (jurisdiction === null && outcome.results.length > 0) {
    notices.push("No nation selected: results can include guidance for any part of the UK. Check the nations listed on each result.");
  }
  if (outcome.results.some(result => result.applicability.status === "not_stated")) {
    notices.push("Some sections don't state which tax year or dates they apply to. Check the page on GOV.UK for current figures.");
  }
  return notices;
}

export function registerGuidanceSearch(app: FastifyInstance, search: GuidanceSearch | null, now: () => Date, rateLimitPerMinute: number): void {
  app.post("/api/guidance/search", { config: { rateLimit: { max: rateLimitPerMinute, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = guidanceSearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: "Search must be 3–300 characters; nation, date and limit must be valid.",
        details: parsed.error.flatten().fieldErrors,
        requestId: request.id
      });
    }
    if (search === null) {
      return reply.code(503).send({ error: "SEARCH_UNAVAILABLE", message: "Guidance search is not configured on this server.", requestId: request.id });
    }

    const { query, jurisdiction, limit } = parsed.data;
    const asOfDate = parsed.data.asOfDate ?? londonDateFromInstant(now());
    let outcome: SearchOutcome;
    try {
      outcome = await search({ query, nation: jurisdiction, asOfDate, limit }, request.log);
    } catch (error) {
      request.log.error({ err: error instanceof Error ? error.message : String(error) }, "guidance search failed");
      return reply.code(503).send({ error: "SEARCH_UNAVAILABLE", message: "Search is temporarily unavailable. Please try again.", requestId: request.id });
    }

    // Privacy: log the shape of the request, never the query text.
    request.log.info({ queryLength: query.length, jurisdiction, asOfDate, results: outcome.results.length, lexical: outcome.lexical, vector: outcome.vector }, "guidance search");
    return {
      mode: "source_discovery",
      isGroundedAnswer: false,
      traceId: request.id,
      status: outcome.results.length === 0 ? "no_results" : outcome.vector === "failed" ? "partial" : "ok",
      request: { jurisdiction, asOfDate, limit },
      // The full passage stays server-side; the excerpt is what the search UI shows.
      results: outcome.results.map(({ passage: _passage, ...result }) => result),
      retrieval: { lexical: outcome.lexical, vector: outcome.vector },
      notices: noticesFor(outcome, jurisdiction),
      disclaimer: DISCLAIMER
    };
  });
}
