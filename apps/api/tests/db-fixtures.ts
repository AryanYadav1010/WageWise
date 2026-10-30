import { CORPUS, type CorpusEntry } from "../src/ingest/corpus.ts";
import { fetchGovukDocument } from "../src/ingest/govuk-client.ts";
import { runIngestion } from "../src/ingest/pipeline.ts";
import type { Pool } from "../src/db/pool.ts";
import { silentLogger } from "./db-helpers.ts";
import { fixtureBody, type FixtureName } from "./govuk-fixtures.ts";

export const FIXTURE_GUIDES = ["/tax-codes", "/income-tax-rates", "/scottish-income-tax", "/welsh-income-tax", "/national-insurance"] as const;
export type FixtureGuide = (typeof FIXTURE_GUIDES)[number];

// A test reviewer: these tests prove the licence gate, they are not licence decisions.
const TEST_REVIEW = { decision: "approved", reviewedBy: "Test Reviewer (fixture data)", reviewedAt: "2026-10-28T12:00:00Z", notes: null } as const;

/** Upstream bodies by path. Tests may replace an entry to simulate a GOV.UK change. */
export function fixtureUpstream(): Map<string, string> {
  return new Map(FIXTURE_GUIDES.map(path => [path, fixtureBody(path.slice(1) as FixtureName)]));
}

export function corpusEntries(paths: readonly string[], approved: readonly string[]): CorpusEntry[] {
  return CORPUS
    .filter(entry => paths.includes(entry.basePath))
    .map(entry => ({ ...entry, licence: { ...entry.licence, review: approved.includes(entry.basePath) ? TEST_REVIEW : null } }));
}

export async function ingestFixtures(pool: Pool, options: { paths?: readonly string[]; approved: readonly string[]; upstream?: Map<string, string> }) {
  const upstream = options.upstream ?? fixtureUpstream();
  const fakeFetch: typeof fetch = async input => {
    const body = upstream.get(new URL(String(input)).pathname.replace("/api/content", ""));
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  };
  return runIngestion(
    { pool, logger: silentLogger, sleep: async () => undefined, fetchDocument: path => fetchGovukDocument(path, { fetchImpl: fakeFetch }) },
    corpusEntries(options.paths ?? FIXTURE_GUIDES, options.approved),
    { trigger: "manual", chunkerConfig: { maxChars: 800, overlapChars: 100 }, delayBetweenRequestsMs: 0 }
  );
}
